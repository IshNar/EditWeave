import { createReadStream } from 'node:fs'
import { lstat, readFile, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import {
  MAX_CATALOG_BYTES,
  decodeBase64,
  ed25519PublicKey,
  sha256,
  strictHttpsOrigin,
  validateCatalog,
  validateSignedPackArtifact,
} from '../../release/creator-pack-catalog-lib.mjs'

export async function loadCreatorPackCatalog(options) {
  const directory = resolve(options.channelDirectory)
  const catalogFile = resolve(directory, 'catalog.json')
  const raw = await readFile(catalogFile)
  if (!raw.length || raw.length > MAX_CATALOG_BYTES) throw new Error(`Catalog must be 1..${MAX_CATALOG_BYTES} bytes`)
  let decoded
  try { decoded = JSON.parse(raw.toString('utf8')) } catch { throw new Error('Catalog JSON is invalid') }
  const catalog = validateCatalog(decoded, { expectedKeyId: options.expectedKeyId, publicKey: options.publicKey })
  const artifacts = new Map()
  for (const entry of catalog.entries) {
    const download = new URL(entry.downloadUrl)
    if (download.origin !== options.publicOrigin || download.search || download.hash || !download.pathname.startsWith('/cutline/packs/')) throw new Error(`Pack URL must use ${options.publicOrigin}/cutline/packs/: ${entry.name}`)
    const encodedName = download.pathname.split('/').pop() || ''
    let fileName
    try { fileName = decodeURIComponent(encodedName) } catch { throw new Error(`Pack URL encoding is invalid: ${entry.name}`) }
    if (fileName !== basename(fileName) || !/^[A-Za-z0-9._+-]{1,180}$/.test(fileName) || !fileName.endsWith('.cutline-pack.json')) throw new Error(`Pack filename is unsafe: ${entry.name}`)
    if (download.pathname !== `/cutline/packs/${encodeURIComponent(fileName)}` || !fileName.includes(entry.version)) throw new Error(`Pack URL is not canonical or versioned: ${entry.name}`)
    const file = resolve(directory, 'packs', fileName)
    const linkDetails = await lstat(file)
    if (linkDetails.isSymbolicLink()) throw new Error(`Pack artifact symlinks are not allowed: ${fileName}`)
    const details = await stat(file)
    const artifact = await readFile(file)
    const verified = validateSignedPackArtifact(artifact, fileName)
    if (verified.artifactSha256 !== entry.artifactSha256 || verified.pack.id !== entry.packId || verified.pack.version !== entry.version || verified.pack.name !== entry.name || verified.pack.publisher !== entry.publisher || verified.publisherKeyFingerprint !== entry.publisherKeyFingerprint || verified.pack.compatibility.minimumApiVersion !== entry.minimumApiVersion || verified.pack.compatibility.maximumApiVersion !== entry.maximumApiVersion || JSON.stringify(verified.categories) !== JSON.stringify(entry.categories)) throw new Error(`Pack artifact does not match catalog entry: ${entry.name}`)
    if (artifacts.has(download.pathname)) throw new Error(`Duplicate Pack route: ${download.pathname}`)
    artifacts.set(download.pathname, { file, fileName, size: details.size, modifiedMs: details.mtimeMs, sha256: verified.artifactSha256 })
  }
  const body = Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`)
  return { catalog, catalogBody: body, catalogEtag: `"${sha256(body)}"`, artifacts }
}

export function createCreatorPackServer(options) {
  let snapshot = options.snapshot
  let activeDownloads = 0
  const downloadsByAddress = new Map()
  let shuttingDown = false
  const server = createServer(async (request, response) => {
    commonHeaders(response)
    const origin = header(request.headers.origin)
    if (origin && !options.allowedOrigins.has(origin)) return sendJson(response, 403, { error: 'origin_not_allowed' })
    if (origin) response.setHeader('access-control-allow-origin', origin)
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,HEAD,OPTIONS', 'access-control-max-age': '600' }); response.end(); return
    }
    let pathname
    try { pathname = new URL(request.url || '/', 'http://cutline.local').pathname } catch { return sendJson(response, 400, { error: 'invalid_url' }) }
    if (request.method === 'GET' && pathname === '/healthz') return sendJson(response, shuttingDown ? 503 : 200, { status: shuttingDown ? 'stopping' : 'ok', service: 'cutline-creator-pack-server', entries: snapshot.catalog.entries.length, revocations: snapshot.catalog.revocations.length, artifacts: snapshot.artifacts.size })
    if (shuttingDown) return sendJson(response, 503, { error: 'shutting_down' })
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.setHeader('allow', 'GET, HEAD, OPTIONS'); return sendJson(response, 405, { error: 'method_not_allowed' }) }
    if (pathname === '/cutline/catalog.json') return serveCatalog(request, response, snapshot)
    const artifact = snapshot.artifacts.get(pathname)
    if (artifact) return serveArtifact(request, response, artifact)
    return sendJson(response, 404, { error: 'not_found' })
  })
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 5_000
  server.maxRequestsPerSocket = 100

  async function serveArtifact(request, response, artifact) {
    let current
    try { current = await stat(artifact.file) } catch { current = undefined }
    if (!current?.isFile() || current.size !== artifact.size || current.mtimeMs !== artifact.modifiedMs) return sendJson(response, 503, { error: 'catalog_reload_required' })
    const range = parseRange(header(request.headers.range), artifact.size)
    if (range === false) { response.setHeader('content-range', `bytes */${artifact.size}`); return sendJson(response, 416, { error: 'invalid_range' }) }
    const address = request.socket.remoteAddress || 'unknown'
    if (request.method !== 'HEAD' && (activeDownloads >= options.maxActiveDownloads || (downloadsByAddress.get(address) || 0) >= options.maxDownloadsPerIp)) { response.setHeader('retry-after', '30'); return sendJson(response, 429, { error: 'download_capacity_reached' }) }
    const start = range?.start ?? 0; const end = range?.end ?? artifact.size - 1; const length = end - start + 1
    response.setHeader('accept-ranges', 'bytes'); response.setHeader('cache-control', 'public, max-age=31536000, immutable'); response.setHeader('content-type', 'application/json; charset=utf-8'); response.setHeader('content-disposition', `attachment; filename="${artifact.fileName}"`); response.setHeader('content-length', length); response.setHeader('etag', `"sha256-${artifact.sha256}"`); response.setHeader('x-content-sha256', artifact.sha256)
    if (range) response.setHeader('content-range', `bytes ${start}-${end}/${artifact.size}`)
    response.writeHead(range ? 206 : 200)
    if (request.method === 'HEAD') return response.end()
    activeDownloads += 1; downloadsByAddress.set(address, (downloadsByAddress.get(address) || 0) + 1)
    const stream = createReadStream(artifact.file, { start, end })
    let released = false
    const release = () => { if (released) return; released = true; activeDownloads -= 1; const remaining = (downloadsByAddress.get(address) || 1) - 1; if (remaining) downloadsByAddress.set(address, remaining); else downloadsByAddress.delete(address) }
    stream.on('error', (error) => { release(); response.destroy(error) }); stream.on('close', release); response.on('close', () => { if (!stream.destroyed) stream.destroy(); release() }); stream.pipe(response)
  }

  return {
    server,
    replaceSnapshot(next) { snapshot = next },
    beginShutdown() { shuttingDown = true },
    activeDownloads() { return activeDownloads },
  }
}

function serveCatalog(request, response, snapshot) {
  response.setHeader('cache-control', 'no-store, no-cache, must-revalidate'); response.setHeader('content-type', 'application/json; charset=utf-8'); response.setHeader('content-length', snapshot.catalogBody.length); response.setHeader('etag', snapshot.catalogEtag)
  if (request.headers['if-none-match'] === snapshot.catalogEtag) { response.writeHead(304); response.end(); return }
  response.writeHead(200); if (request.method === 'HEAD') response.end(); else response.end(snapshot.catalogBody)
}

function parseRange(value, size) {
  if (!value) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2])) return false
  let start; let end
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) return false; start = Math.max(0, size - suffix); end = size - 1 }
  else { start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1; if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return false; end = Math.min(end, size - 1) }
  return { start, end }
}

function commonHeaders(response) { response.setHeader('x-content-type-options', 'nosniff'); response.setHeader('referrer-policy', 'no-referrer'); response.setHeader('x-frame-options', 'DENY'); response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()'); response.setHeader('cross-origin-resource-policy', 'cross-origin') }
function sendJson(response, status, value) { const body = Buffer.from(JSON.stringify(value)); response.setHeader('cache-control', 'no-store'); response.setHeader('content-type', 'application/json; charset=utf-8'); response.setHeader('content-length', body.length); response.writeHead(status); response.end(body) }
function header(value) { return Array.isArray(value) ? value[0] : value }
function integerSetting(name, fallback, minimum, maximum) { const value = process.env[name]; if (!value) return fallback; const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`); return parsed }
function requiredSetting(name, maximum) { const value = process.env[name]?.trim(); if (!value || value.length > maximum) throw new Error(`${name} is required and must be at most ${maximum} characters`); return value }
function csvSetting(name, fallback) { const value = process.env[name]; return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : fallback }

async function main() {
  const host = process.env.CUTLINE_CREATOR_PACK_HOST?.trim() || '127.0.0.1'
  const port = integerSetting('CUTLINE_CREATOR_PACK_PORT', 8792, 1, 65_535)
  const channelDirectory = resolve(process.env.CUTLINE_CREATOR_PACK_CHANNEL_DIR?.trim() || 'release/creator-pack-channel')
  const publicOrigin = strictHttpsOrigin(requiredSetting('CUTLINE_CREATOR_PACK_PUBLIC_ORIGIN', 240))
  const expectedKeyId = requiredSetting('CUTLINE_CREATOR_PACK_KEY_ID', 120)
  const publicKeyBytes = decodeBase64(requiredSetting('CUTLINE_CREATOR_PACK_PUBLIC_KEY', 100), 'CUTLINE_CREATOR_PACK_PUBLIC_KEY')
  const config = { channelDirectory, publicOrigin, expectedKeyId, publicKey: ed25519PublicKey(publicKeyBytes) }
  const snapshot = await loadCreatorPackCatalog(config)
  const controller = createCreatorPackServer({ snapshot, allowedOrigins: new Set(csvSetting('CUTLINE_CREATOR_PACK_ALLOWED_ORIGINS', ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'])), maxActiveDownloads: integerSetting('CUTLINE_CREATOR_PACK_MAX_ACTIVE_DOWNLOADS', 100, 1, 10_000), maxDownloadsPerIp: integerSetting('CUTLINE_CREATOR_PACK_MAX_DOWNLOADS_PER_IP', 8, 1, 100) })
  controller.server.listen(port, host, () => console.log(`[creator-pack-server] listening on http://${host}:${port} entries=${snapshot.catalog.entries.length}`))
  process.on('SIGHUP', () => { void loadCreatorPackCatalog(config).then((next) => { controller.replaceSnapshot(next); console.log(`[creator-pack-server] catalog reloaded entries=${next.catalog.entries.length}`) }).catch((error) => console.error('[creator-pack-server] reload rejected:', error instanceof Error ? error.message : String(error))) })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { controller.beginShutdown(); controller.server.close(); setTimeout(() => controller.server.closeAllConnections(), 30_000).unref() })
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main()
