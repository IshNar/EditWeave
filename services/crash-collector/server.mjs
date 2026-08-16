import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { mkdir, open, readdir, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'

const SERVICE_VERSION = '1.0.0'
const SCHEMA = 'cutline-crash-v1'
const FILE_PATTERN = /^crashes-(\d{4}-\d{2}-\d{2})\.jsonl$/
const PORT = integerSetting('CUTLINE_CRASH_PORT', 8787, 1, 65_535)
const HOST = process.env.CUTLINE_CRASH_HOST?.trim() || '127.0.0.1'
const DATA_DIR = resolve(process.env.CUTLINE_CRASH_DATA_DIR?.trim() || 'var/crash-reports')
const RETENTION_DAYS = integerSetting('CUTLINE_CRASH_RETENTION_DAYS', 30, 1, 365)
const MAX_STORAGE_BYTES = integerSetting('CUTLINE_CRASH_MAX_STORAGE_MB', 512, 16, 102_400) * 1024 * 1024
const MAX_BODY_BYTES = integerSetting('CUTLINE_CRASH_MAX_BODY_KB', 32, 8, 128) * 1024
const RATE_LIMIT = integerSetting('CUTLINE_CRASH_RATE_LIMIT_PER_MINUTE', 60, 1, 10_000)
const TRUST_PROXY = process.env.CUTLINE_CRASH_TRUST_PROXY === '1'
const ALLOWED_ORIGINS = new Set(csvSetting('CUTLINE_CRASH_ALLOWED_ORIGINS', [
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
]))
const MAX_REMEMBERED_IDS = 250_000
const MAX_RATE_WINDOWS = 50_000

const rateWindows = new Map()
const knownIds = new Set()
const knownIdOrder = []
let storedBytes = 0
let writeTail = Promise.resolve()
let shuttingDown = false

await mkdir(DATA_DIR, { recursive: true, mode: 0o700 })
storedBytes = await pruneStorage(0)
await restoreKnownIds()

const server = createServer(async (request, response) => {
  applyCommonHeaders(response)
  const origin = headerValue(request.headers.origin)
  if (!allowOrigin(origin, response)) {
    sendJson(response, 403, { error: 'origin_not_allowed' })
    return
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-headers': 'content-type,x-cutline-schema',
      'access-control-allow-methods': 'POST,OPTIONS',
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
      service: 'cutline-crash-collector',
      version: SERVICE_VERSION,
      schema: SCHEMA,
    })
    return
  }

  if (request.method !== 'POST' || pathname !== '/api/cutline/crashes') {
    sendJson(response, 404, { error: 'not_found' })
    return
  }
  if (shuttingDown) {
    sendJson(response, 503, { error: 'shutting_down' })
    return
  }
  if (!consumeRateLimit(clientAddress(request))) {
    response.setHeader('retry-after', '60')
    sendJson(response, 429, { error: 'rate_limited' })
    return
  }
  if (!headerValue(request.headers['content-type']).toLowerCase().startsWith('application/json')) {
    sendJson(response, 415, { error: 'application_json_required' })
    return
  }
  const schemaHeader = headerValue(request.headers['x-cutline-schema'])
  if (schemaHeader && schemaHeader !== SCHEMA) {
    sendJson(response, 400, { error: 'unsupported_schema' })
    return
  }

  try {
    const input = await readJsonBody(request)
    const report = validateReport(input)
    const result = await serializeWrite(() => persistReport(report))
    sendJson(response, result.duplicate ? 200 : 202, {
      accepted: true,
      duplicate: result.duplicate,
      id: report.id,
    })
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    if (status >= 500) console.error('[crash-collector] ingest failed:', safeErrorMessage(error))
    sendJson(response, status, { error: error instanceof HttpError ? error.code : 'storage_failure' })
  }
})

server.requestTimeout = 15_000
server.headersTimeout = 10_000
server.keepAliveTimeout = 5_000
server.maxRequestsPerSocket = 100
server.listen(PORT, HOST, () => {
  console.log(`[crash-collector] listening on http://${HOST}:${PORT}`)
  console.log(`[crash-collector] data=${DATA_DIR} retention=${RETENTION_DAYS}d quota=${Math.round(MAX_STORAGE_BYTES / 1024 / 1024)}MB`)
})

const housekeeping = setInterval(() => {
  void serializeWrite(async () => {
    storedBytes = await pruneStorage(0)
  }).catch((error) => console.error('[crash-collector] retention cleanup failed:', safeErrorMessage(error)))
  const currentMinute = Math.floor(Date.now() / 60_000)
  for (const [address, entry] of rateWindows) {
    if (entry.minute < currentMinute - 1) rateWindows.delete(address)
  }
}, 60 * 60_000)
housekeeping.unref()

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => void shutdown(signal))
}

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[crash-collector] ${signal} received; draining writes`)
  clearInterval(housekeeping)
  server.close(async () => {
    try {
      await writeTail
      process.exitCode = 0
    } catch {
      process.exitCode = 1
    }
  })
  setTimeout(() => {
    console.error('[crash-collector] graceful shutdown timed out')
    process.exitCode = 1
    server.closeAllConnections()
  }, 10_000).unref()
}

async function persistReport(report) {
  if (knownIds.has(report.id)) return { duplicate: true }
  const receivedAt = new Date().toISOString()
  const record = {
    receivedAt,
    fingerprint: fingerprint(report),
    ...report,
  }
  const line = `${JSON.stringify(record)}\n`
  const lineBytes = Buffer.byteLength(line)
  if (storedBytes + lineBytes > MAX_STORAGE_BYTES) storedBytes = await pruneStorage(lineBytes)
  if (storedBytes + lineBytes > MAX_STORAGE_BYTES) throw new HttpError(507, 'storage_quota_exceeded')
  const file = resolve(DATA_DIR, `crashes-${receivedAt.slice(0, 10)}.jsonl`)
  await appendDurably(file, line)
  storedBytes += lineBytes
  rememberId(report.id)
  console.log(`[crash-collector] accepted id=${report.id} kind=${report.kind} app=${report.appVersion} fingerprint=${record.fingerprint}`)
  return { duplicate: false }
}

function validateReport(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'invalid_json_object')
  const allowed = new Set(['schema', 'id', 'occurredAt', 'kind', 'errorName', 'message', 'stack', 'componentStack', 'userAgent', 'appVersion', 'runtime'])
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new HttpError(400, 'unknown_field')
  if (input.schema !== SCHEMA) throw new HttpError(400, 'unsupported_schema')
  const id = requiredText(input.id, 80, 'invalid_id')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new HttpError(400, 'invalid_id')
  const occurredAt = requiredText(input.occurredAt, 40, 'invalid_occurred_at')
  const occurredMs = Date.parse(occurredAt)
  if (!Number.isFinite(occurredMs) || occurredMs > Date.now() + 5 * 60_000 || occurredMs < Date.now() - 365 * 24 * 60 * 60_000) {
    throw new HttpError(400, 'invalid_occurred_at')
  }
  if (!['react', 'window', 'promise'].includes(input.kind)) throw new HttpError(400, 'invalid_kind')
  const runtime = input.runtime === undefined ? 'unknown' : requiredText(input.runtime, 16, 'invalid_runtime')
  if (!['desktop', 'browser', 'unknown'].includes(runtime)) throw new HttpError(400, 'invalid_runtime')
  return {
    schema: SCHEMA,
    id,
    occurredAt: new Date(occurredMs).toISOString(),
    kind: input.kind,
    errorName: redactSensitive(requiredText(input.errorName, 120, 'invalid_error_name'), 120),
    message: redactSensitive(requiredText(input.message, 2_000, 'invalid_message'), 2_000),
    ...optionalField('stack', input.stack, 12_000, 'invalid_stack'),
    ...optionalField('componentStack', input.componentStack, 12_000, 'invalid_component_stack'),
    userAgent: requiredText(input.userAgent, 1_000, 'invalid_user_agent'),
    appVersion: requiredText(input.appVersion, 80, 'invalid_app_version'),
    runtime,
  }
}

async function readJsonBody(request) {
  const declared = Number(headerValue(request.headers['content-length']))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large')
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large')
    chunks.push(chunk)
  }
  if (!size) throw new HttpError(400, 'empty_body')
  try {
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'))
  } catch {
    throw new HttpError(400, 'invalid_json')
  }
}

async function restoreKnownIds() {
  const files = await dataFilesOldestFirst()
  for (const entry of files) {
    const lines = createInterface({ input: createReadStream(entry.path, { encoding: 'utf8' }), crlfDelay: Infinity })
    try {
      for await (const line of lines) {
        if (!line) continue
        try {
          const value = JSON.parse(line)
          if (typeof value.id === 'string') rememberId(value.id)
        } catch {
          // An incomplete line is ignored; fsynced records around it remain readable.
        }
      }
    } catch (error) {
      console.error(`[crash-collector] cannot index ${entry.name}:`, safeErrorMessage(error))
    } finally {
      lines.close()
    }
  }
}

async function appendDurably(file, line) {
  const handle = await open(file, 'a', 0o600)
  try {
    await handle.appendFile(line, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function pruneStorage(requiredBytes) {
  const files = await dataFilesOldestFirst()
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60_000
  const today = new Date().toISOString().slice(0, 10)
  let total = files.reduce((sum, file) => sum + file.size, 0)
  for (const file of files) {
    const expired = Date.parse(`${file.date}T00:00:00.000Z`) < cutoff
    const overQuota = total + requiredBytes > MAX_STORAGE_BYTES && file.date !== today
    if (!expired && !overQuota) continue
    await rm(file.path, { force: true })
    total -= file.size
    console.log(`[crash-collector] removed retained file ${file.name}`)
  }
  return Math.max(0, total)
}

async function dataFilesOldestFirst() {
  const entries = await readdir(DATA_DIR, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const match = FILE_PATTERN.exec(entry.name)
    if (!match) continue
    const path = resolve(DATA_DIR, entry.name)
    const details = await stat(path)
    files.push({ name: entry.name, path, date: match[1], size: details.size })
  }
  return files.sort((left, right) => left.date.localeCompare(right.date))
}

function serializeWrite(task) {
  const result = writeTail.then(task)
  writeTail = result.catch(() => {})
  return result
}

function rememberId(id) {
  if (knownIds.has(id)) return
  knownIds.add(id)
  knownIdOrder.push(id)
  if (knownIdOrder.length > MAX_REMEMBERED_IDS) knownIds.delete(knownIdOrder.shift())
}

function fingerprint(report) {
  const topFrames = (report.stack || report.componentStack || '').split('\n').slice(0, 4).join('\n')
  return createHash('sha256').update(`${report.kind}\n${report.message}\n${topFrames}`).digest('hex').slice(0, 24)
}

function consumeRateLimit(address) {
  const minute = Math.floor(Date.now() / 60_000)
  const current = rateWindows.get(address)
  if (!current || current.minute !== minute) {
    if (!current && rateWindows.size >= MAX_RATE_WINDOWS) rateWindows.delete(rateWindows.keys().next().value)
    rateWindows.set(address, { minute, count: 1 })
    return true
  }
  current.count += 1
  return current.count <= RATE_LIMIT
}

function clientAddress(request) {
  if (TRUST_PROXY) {
    const forwarded = headerValue(request.headers['x-forwarded-for']).split(',')[0]?.trim()
    if (forwarded && forwarded.length <= 80) return forwarded
  }
  return request.socket.remoteAddress || 'unknown'
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

function requiredText(value, maximum, code) {
  if (typeof value !== 'string') throw new HttpError(400, code)
  const cleaned = cleanText(value, maximum)
  if (!cleaned) throw new HttpError(400, code)
  return cleaned
}

function optionalText(value, maximum, code) {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new HttpError(400, code)
  return cleanText(value, maximum) || undefined
}

function optionalField(name, value, maximum, code) {
  const text = optionalText(value, maximum, code)
  return text ? { [name]: redactSensitive(text, maximum) } : {}
}

function cleanText(value, maximum) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, maximum).trim()
}

function redactSensitive(value, maximum) {
  return cleanText(value, maximum)
    .replace(/file:\/\/\/?[^\s)'"<>]+/gi, '<local-file>')
    .replace(/\\\\[^\\/\s]+\\[^\s)'"<>]+/g, '<network-path>')
    .replace(/\b[A-Za-z]:[\\/][^\s)'"<>]+/g, '<local-path>')
    .replace(/\/(Users|home)\/[^/\s]+/g, '/$1/<user>')
    .replace(/https?:\/\/[^\s)'"<>]+/gi, (match) => safePublicUrl(match))
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<email>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/(["'])(?:(?!\1).){2,240}\1/g, '$1<value>$1')
    .slice(0, maximum)
}

function safePublicUrl(value) {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return '<url>'
  }
}

function headerValue(value) {
  return Array.isArray(value) ? value[0] || '' : value || ''
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

class HttpError extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
    this.code = code
  }
}
