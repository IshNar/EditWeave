import { createHash, createPublicKey, verify } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import { createServer } from 'node:http'

const SERVICE_VERSION = '1.0.0'
const SCHEMA = 'cutline-update-v1'
const PLATFORMS = new Set(['windows-x86_64', 'windows-aarch64', 'macos-x86_64', 'macos-aarch64', 'macos-universal'])
const CHANNELS = new Set(['stable', 'beta'])
const HOST = process.env.CUTLINE_UPDATE_HOST?.trim() || '127.0.0.1'
const PORT = integerSetting('CUTLINE_UPDATE_PORT', 8790, 1, 65_535)
const CHANNEL_DIR = resolve(process.env.CUTLINE_UPDATE_CHANNEL_DIR?.trim() || 'release/update-channel')
const PUBLIC_ORIGIN = strictOrigin(process.env.CUTLINE_UPDATE_PUBLIC_ORIGIN)
const EXPECTED_KEY_ID = requiredSetting('CUTLINE_UPDATE_KEY_ID', 80)
if (!/^[a-zA-Z0-9._-]{4,80}$/.test(EXPECTED_KEY_ID)) throw new Error('CUTLINE_UPDATE_KEY_ID format is invalid')
const PUBLIC_KEY_BYTES = decodeBase64(requiredSetting('CUTLINE_UPDATE_PUBLIC_KEY', 100), 'CUTLINE_UPDATE_PUBLIC_KEY')
const PUBLIC_KEY = ed25519PublicKey(PUBLIC_KEY_BYTES)
const TRUST_PROXY = process.env.CUTLINE_UPDATE_TRUST_PROXY === '1'
const ALLOWED_ORIGINS = new Set(csvSetting('CUTLINE_UPDATE_ALLOWED_ORIGINS', [
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
]))
const MAX_ACTIVE_DOWNLOADS = integerSetting('CUTLINE_UPDATE_MAX_ACTIVE_DOWNLOADS', 100, 1, 10_000)
const MAX_DOWNLOADS_PER_IP = integerSetting('CUTLINE_UPDATE_MAX_DOWNLOADS_PER_IP', 4, 1, 100)
const MAX_INSTALLER_BYTES = 2 * 1024 * 1024 * 1024

let catalog = await loadCatalog()
let shuttingDown = false
let activeDownloads = 0
const downloadsByAddress = new Map()

const server = createServer(async (request, response) => {
  applyCommonHeaders(response)
  const origin = headerValue(request.headers.origin)
  if (!allowOrigin(origin, response)) {
    sendJson(response, 403, { error: 'origin_not_allowed' })
    return
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,HEAD,OPTIONS',
      'access-control-max-age': '600',
    })
    response.end()
    return
  }

  let pathname
  try {
    pathname = new URL(request.url || '/', 'http://cutline.local').pathname
  } catch {
    sendJson(response, 400, { error: 'invalid_url' })
    return
  }

  if (request.method === 'GET' && pathname === '/healthz') {
    sendJson(response, shuttingDown ? 503 : 200, {
      status: shuttingDown ? 'stopping' : 'ok',
      service: 'cutline-update-server',
      version: SERVICE_VERSION,
      manifests: catalog.manifests.size,
      artifacts: catalog.artifacts.size,
    })
    return
  }
  if (shuttingDown) {
    sendJson(response, 503, { error: 'shutting_down' })
    return
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('allow', 'GET, HEAD, OPTIONS')
    sendJson(response, 405, { error: 'method_not_allowed' })
    return
  }

  const manifest = catalog.manifests.get(pathname)
  if (manifest) {
    serveManifest(request, response, manifest)
    return
  }
  const artifact = catalog.artifacts.get(pathname)
  if (artifact) {
    await serveArtifact(request, response, artifact)
    return
  }
  sendJson(response, 404, { error: 'not_found' })
})

server.requestTimeout = 15_000
server.headersTimeout = 10_000
server.keepAliveTimeout = 5_000
server.maxRequestsPerSocket = 100
server.listen(PORT, HOST, () => {
  console.log(`[update-server] listening on http://${HOST}:${PORT}`)
  console.log(`[update-server] origin=${PUBLIC_ORIGIN} manifests=${catalog.manifests.size} artifacts=${catalog.artifacts.size}`)
})

process.on('SIGHUP', () => {
  void loadCatalog().then((next) => {
    catalog = next
    console.log(`[update-server] catalog reloaded manifests=${catalog.manifests.size} artifacts=${catalog.artifacts.size}`)
  }).catch((error) => console.error('[update-server] reload rejected:', safeErrorMessage(error)))
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(signal))

function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[update-server] ${signal} received; waiting for ${activeDownloads} download(s)`)
  server.close(() => { process.exitCode = 0 })
  setTimeout(() => {
    console.error('[update-server] graceful shutdown timed out')
    process.exitCode = 1
    server.closeAllConnections()
  }, 30 * 60_000).unref()
}

async function loadCatalog() {
  const manifests = new Map()
  const artifacts = new Map()
  for (const channel of CHANNELS) {
    const directory = resolve(CHANNEL_DIR, 'manifests', channel)
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const platform = entry.name.slice(0, -5)
      if (!PLATFORMS.has(platform)) throw new Error(`Unsupported manifest file name: ${channel}/${entry.name}`)
      const file = resolve(directory, entry.name)
      const raw = await readFile(file)
      if (!raw.length || raw.length > 65_536) throw new Error(`Manifest must be 1..65536 bytes: ${file}`)
      let decoded
      try { decoded = JSON.parse(raw.toString('utf8')) } catch { throw new Error(`Invalid manifest JSON: ${file}`) }
      const manifest = validateManifest(decoded, channel, platform)
      const payload = signingPayload(manifest)
      const signature = decodeBase64(manifest.signature, `signature in ${file}`)
      if (signature.length !== 64 || !verify(null, Buffer.from(payload), PUBLIC_KEY, signature)) throw new Error(`Invalid Ed25519 signature: ${file}`)
      const download = new URL(manifest.downloadUrl)
      if (download.origin !== PUBLIC_ORIGIN || download.search || download.hash || !download.pathname.startsWith('/cutline/artifacts/')) {
        throw new Error(`downloadUrl must use ${PUBLIC_ORIGIN}/cutline/artifacts/: ${file}`)
      }
      const encodedName = download.pathname.split('/').pop() || ''
      let artifactName
      try { artifactName = decodeURIComponent(encodedName) } catch { throw new Error(`Invalid artifact URL encoding: ${file}`) }
      if (artifactName !== basename(artifactName) || !/^[A-Za-z0-9._+-]{1,180}$/.test(artifactName)) throw new Error(`Unsafe artifact file name: ${file}`)
      if (download.pathname !== `/cutline/artifacts/${encodeURIComponent(artifactName)}`) throw new Error(`Artifact URL must contain one canonical file name: ${file}`)
      if (!artifactName.includes(manifest.version)) throw new Error(`Immutable artifact file name must include version ${manifest.version}: ${file}`)
      assertInstallerExtension(platform, artifactName)
      const artifactFile = resolve(CHANNEL_DIR, 'artifacts', artifactName)
      const details = await stat(artifactFile)
      if (!details.isFile() || details.size < 1 || details.size > MAX_INSTALLER_BYTES) throw new Error(`Installer size is outside 1..2GB: ${artifactFile}`)
      const existingArtifact = artifacts.get(download.pathname)
      if (existingArtifact) {
        if (existingArtifact.file !== artifactFile || existingArtifact.sha256 !== manifest.sha256 || existingArtifact.size !== details.size || existingArtifact.modifiedMs !== details.mtimeMs) throw new Error(`Conflicting artifact route: ${download.pathname}`)
      } else {
        const actualHash = await sha256File(artifactFile)
        if (actualHash !== manifest.sha256) throw new Error(`Installer SHA-256 does not match manifest: ${artifactFile}`)
      }
      const manifestPath = `/cutline/manifests/${channel}/${platform}.json`
      if (manifests.has(manifestPath)) throw new Error(`Duplicate manifest route: ${manifestPath}`)
      const manifestBody = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
      manifests.set(manifestPath, {
        body: manifestBody,
        etag: `"${createHash('sha256').update(manifestBody).digest('hex')}"`,
      })
      if (!existingArtifact) {
        artifacts.set(download.pathname, {
          file: artifactFile,
          name: artifactName,
          size: details.size,
          modifiedMs: details.mtimeMs,
          sha256: manifest.sha256,
        })
      }
    }
  }
  if (!manifests.size) throw new Error(`No signed manifests found under ${resolve(CHANNEL_DIR, 'manifests')}`)
  return { manifests, artifacts }
}

function validateManifest(value, expectedChannel, expectedPlatform) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Manifest must be an object')
  const allowed = new Set(['schema', 'version', 'platform', 'channel', 'publishedAt', 'minimumSupportedVersion', 'notes', 'downloadUrl', 'sha256', 'keyId', 'signature'])
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('Manifest contains an unknown field')
  if (value.schema !== SCHEMA) throw new Error(`Manifest schema must be ${SCHEMA}`)
  if (typeof value.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version)) throw new Error('Manifest version is invalid')
  if (value.platform !== expectedPlatform) throw new Error(`Manifest platform must match ${expectedPlatform}.json`)
  if (value.channel !== expectedChannel) throw new Error(`Manifest channel must match directory ${expectedChannel}`)
  if (typeof value.publishedAt !== 'string' || !Number.isFinite(Date.parse(value.publishedAt))) throw new Error('Manifest publishedAt is required')
  if (value.minimumSupportedVersion !== undefined && (typeof value.minimumSupportedVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.minimumSupportedVersion))) throw new Error('Manifest minimumSupportedVersion is invalid')
  if (value.notes !== undefined && (typeof value.notes !== 'string' || value.notes.length > 8_000)) throw new Error('Manifest notes are invalid')
  if (typeof value.downloadUrl !== 'string') throw new Error('Manifest downloadUrl is required')
  const download = new URL(value.downloadUrl)
  if (download.protocol !== 'https:' || download.username || download.password) throw new Error('Manifest downloadUrl must be credential-free HTTPS')
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.sha256)) throw new Error('Manifest sha256 must be hexadecimal')
  if (value.keyId !== EXPECTED_KEY_ID) throw new Error('Manifest keyId does not match the server key')
  if (typeof value.signature !== 'string' || value.signature.length > 120) throw new Error('Manifest signature is invalid')
  return { ...value, sha256: value.sha256.toLowerCase() }
}

function serveManifest(request, response, manifest) {
  response.setHeader('cache-control', 'no-store, no-cache, must-revalidate')
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('content-length', manifest.body.length)
  response.setHeader('etag', manifest.etag)
  if (request.headers['if-none-match'] === manifest.etag) {
    response.writeHead(304)
    response.end()
    return
  }
  response.writeHead(200)
  if (request.method === 'HEAD') response.end()
  else response.end(manifest.body)
}

async function serveArtifact(request, response, artifact) {
  const address = clientAddress(request)
  let current
  try { current = await stat(artifact.file) } catch { current = undefined }
  if (!current?.isFile() || current.size !== artifact.size || current.mtimeMs !== artifact.modifiedMs) {
    sendJson(response, 503, { error: 'catalog_reload_required' })
    return
  }
  const range = parseRange(headerValue(request.headers.range), artifact.size)
  if (range === false) {
    response.setHeader('content-range', `bytes */${artifact.size}`)
    sendJson(response, 416, { error: 'invalid_range' })
    return
  }
  if (request.method !== 'HEAD' && (activeDownloads >= MAX_ACTIVE_DOWNLOADS || (downloadsByAddress.get(address) || 0) >= MAX_DOWNLOADS_PER_IP)) {
    response.setHeader('retry-after', '30')
    sendJson(response, 429, { error: 'download_capacity_reached' })
    return
  }
  const start = range?.start ?? 0
  const end = range?.end ?? artifact.size - 1
  const length = end - start + 1
  response.setHeader('accept-ranges', 'bytes')
  response.setHeader('cache-control', 'public, max-age=31536000, immutable')
  response.setHeader('content-disposition', `attachment; filename="${artifact.name}"`)
  response.setHeader('content-length', length)
  response.setHeader('content-type', installerContentType(artifact.name))
  response.setHeader('etag', `"sha256-${artifact.sha256}"`)
  response.setHeader('x-content-sha256', artifact.sha256)
  if (range) response.setHeader('content-range', `bytes ${start}-${end}/${artifact.size}`)
  response.writeHead(range ? 206 : 200)
  if (request.method === 'HEAD') {
    response.end()
    return
  }

  activeDownloads += 1
  downloadsByAddress.set(address, (downloadsByAddress.get(address) || 0) + 1)
  const stream = createReadStream(artifact.file, { start, end })
  const release = once(() => {
    activeDownloads -= 1
    const remaining = (downloadsByAddress.get(address) || 1) - 1
    if (remaining > 0) downloadsByAddress.set(address, remaining)
    else downloadsByAddress.delete(address)
  })
  stream.on('error', (error) => {
    console.error(`[update-server] artifact stream failed name=${artifact.name}:`, safeErrorMessage(error))
    release()
    response.destroy(error)
  })
  stream.on('close', release)
  response.on('close', () => {
    if (!stream.destroyed) stream.destroy()
    release()
  })
  stream.pipe(response)
}

function signingPayload(manifest) {
  return JSON.stringify({
    schema: SCHEMA,
    version: manifest.version,
    platform: manifest.platform,
    channel: manifest.channel ?? null,
    publishedAt: manifest.publishedAt ?? null,
    minimumSupportedVersion: manifest.minimumSupportedVersion ?? null,
    notes: manifest.notes ?? null,
    downloadUrl: manifest.downloadUrl,
    sha256: manifest.sha256.toLowerCase(),
  })
}

function parseRange(value, size) {
  if (!value) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2])) return false
  let start
  let end
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return false
    end = Math.min(end, size - 1)
  }
  return { start, end }
}

async function sha256File(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

function assertInstallerExtension(platform, name) {
  const extension = extname(name).toLowerCase()
  const allowed = platform.startsWith('windows-') ? new Set(['.exe', '.msi']) : new Set(['.dmg', '.pkg'])
  if (!allowed.has(extension)) throw new Error(`Installer extension ${extension || '(none)'} does not match ${platform}`)
}

function installerContentType(name) {
  const extension = extname(name).toLowerCase()
  if (extension === '.msi') return 'application/x-msi'
  if (extension === '.dmg') return 'application/x-apple-diskimage'
  if (extension === '.pkg') return 'application/vnd.apple.installer+xml'
  return 'application/vnd.microsoft.portable-executable'
}

function strictOrigin(value) {
  const raw = requiredValue(value, 'CUTLINE_UPDATE_PUBLIC_ORIGIN', 240)
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('CUTLINE_UPDATE_PUBLIC_ORIGIN must be a credential-free HTTPS origin')
  return url.origin
}

function ed25519PublicKey(raw) {
  if (raw.length !== 32) throw new Error('CUTLINE_UPDATE_PUBLIC_KEY must decode to 32 bytes')
  const prefix = Buffer.from('302a300506032b6570032100', 'hex')
  return createPublicKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'spki' })
}

function decodeBase64(value, label) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw new Error(`${label} is not valid Base64`)
  const bytes = Buffer.from(normalized, 'base64')
  if (!bytes.length) throw new Error(`${label} is empty`)
  return bytes
}

function allowOrigin(origin, response) {
  if (!origin) return true
  if (!ALLOWED_ORIGINS.has(origin)) return false
  response.setHeader('access-control-allow-origin', origin)
  response.setHeader('vary', 'Origin')
  return true
}

function applyCommonHeaders(response) {
  response.setHeader('cache-control', 'no-store')
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
  response.setHeader('cross-origin-resource-policy', 'cross-origin')
  response.setHeader('referrer-policy', 'no-referrer')
  response.setHeader('x-content-type-options', 'nosniff')
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  response.end(body)
}

function clientAddress(request) {
  if (TRUST_PROXY) {
    const forwarded = headerValue(request.headers['x-forwarded-for']).split(',')[0]?.trim()
    if (forwarded && forwarded.length <= 80) return forwarded
  }
  return request.socket.remoteAddress || 'unknown'
}

function headerValue(value) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function requiredSetting(name, maximum) {
  return requiredValue(process.env[name], name, maximum)
}

function requiredValue(value, name, maximum) {
  const cleaned = value?.trim()
  if (!cleaned || cleaned.length > maximum) throw new Error(`${name} is required and must be at most ${maximum} characters`)
  return cleaned
}

function integerSetting(name, fallback, minimum, maximum) {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  return value
}

function csvSetting(name, fallback) {
  const raw = process.env[name]
  return raw ? raw.split(',').map((value) => value.trim()).filter(Boolean) : fallback
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message.slice(0, 300) : 'unknown error'
}

function once(callback) {
  let called = false
  return () => {
    if (called) return
    called = true
    callback()
  }
}
