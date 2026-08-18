import { createHash, createPublicKey, verify } from 'node:crypto'

export const CATALOG_SCHEMA = 'editweave-creator-catalog-v1'
export const PACK_SCHEMA = 'editweave-creator-pack-v2'
export const MAX_CATALOG_BYTES = 1_000_000
export const MAX_PACK_BYTES = 2_000_000
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  return JSON.stringify(value)
}

export function catalogSigningPayload(catalog) {
  return stableStringify({ schema: CATALOG_SCHEMA, generatedAt: catalog.generatedAt, authority: catalog.authority, keyId: catalog.keyId ?? null, entries: catalog.entries, revocations: catalog.revocations })
}

export function validateSignedPackArtifact(raw, sourceName = 'Creator Pack') {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
  if (!bytes.length || bytes.length > MAX_PACK_BYTES) throw new Error(`${sourceName}: Pack size must be 1..${MAX_PACK_BYTES} bytes`)
  let pack
  try { pack = JSON.parse(bytes.toString('utf8')) } catch { throw new Error(`${sourceName}: invalid Creator Pack JSON`) }
  if (!pack || typeof pack !== 'object' || Array.isArray(pack) || pack.schema !== PACK_SCHEMA) throw new Error(`${sourceName}: schema must be ${PACK_SCHEMA}`)
  if (pack.apiVersion !== '1.0.0' || !pack.compatibility || typeof pack.compatibility !== 'object') throw new Error(`${sourceName}: Pack API contract is invalid`)
  if (!SEMVER.test(pack.version) || typeof pack.id !== 'string' || !pack.id || pack.id.length > 160 || typeof pack.name !== 'string' || !pack.name || pack.name.length > 100 || typeof pack.publisher !== 'string' || !pack.publisher || pack.publisher.length > 100) throw new Error(`${sourceName}: Pack identity is invalid`)
  if (pack.security?.executableCode !== false || pack.security?.networkAccess !== false || pack.security?.filesystemAccess !== false) throw new Error(`${sourceName}: Pack requests prohibited privileges`)
  if (!pack.contents || typeof pack.contents !== 'object' || Array.isArray(pack.contents)) throw new Error(`${sourceName}: Pack contents are invalid`)
  const limits = { motionTemplates: 100, speedTemplates: 100, audioTemplates: 50, titleStyleTemplates: 100, exportPresets: 100, transitionPresets: 100 }
  for (const [key, maximum] of Object.entries(limits)) if (!Array.isArray(pack.contents[key]) || pack.contents[key].length > maximum) throw new Error(`${sourceName}: ${key} exceeds its limit`)
  if (pack.integrity?.algorithm !== 'SHA-256' || typeof pack.integrity.digest !== 'string' || !/^[0-9a-f]{64}$/i.test(pack.integrity.digest)) throw new Error(`${sourceName}: Pack integrity is missing`)
  const canonical = structuredClone(pack)
  delete canonical.integrity; delete canonical.signature; delete canonical.verification
  const actualIntegrity = sha256(Buffer.from(stableStringify(canonical)))
  if (actualIntegrity !== pack.integrity.digest.toLowerCase()) throw new Error(`${sourceName}: Pack integrity mismatch`)
  if (pack.signature?.algorithm !== 'Ed25519' || typeof pack.signature.keyId !== 'string' || !pack.signature.keyId || pack.signature.keyId.length > 120 || typeof pack.signature.publicKey !== 'string' || typeof pack.signature.value !== 'string') throw new Error(`${sourceName}: a publisher Ed25519 signature is required`)
  const publicKeyBytes = decodeBase64(pack.signature.publicKey, `${sourceName} publisher public key`)
  const signatureBytes = decodeBase64(pack.signature.value, `${sourceName} publisher signature`)
  if (publicKeyBytes.length !== 32 || signatureBytes.length !== 64) throw new Error(`${sourceName}: publisher key or signature length is invalid`)
  const payload = Buffer.from(`editweave-creator-pack-v2\n${pack.integrity.digest.toLowerCase()}`)
  if (!verify(null, payload, ed25519PublicKey(publicKeyBytes), signatureBytes)) throw new Error(`${sourceName}: publisher signature is invalid`)
  const categories = [
    ['motionTemplates', 'motion'], ['speedTemplates', 'speed'], ['audioTemplates', 'audio'], ['titleStyleTemplates', 'title'], ['exportPresets', 'export'], ['transitionPresets', 'transition'],
  ].filter(([key]) => pack.contents[key].length > 0).map(([, category]) => category)
  return { pack, artifactSha256: sha256(bytes), publisherKeyFingerprint: sha256(publicKeyBytes), categories }
}

export function validateCatalog(catalog, options = {}) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) throw new Error('Catalog must be an object')
  assertKeys(catalog, ['schema', 'generatedAt', 'authority', 'keyId', 'entries', 'revocations', 'signature'], 'Catalog')
  if (catalog.schema !== CATALOG_SCHEMA || typeof catalog.generatedAt !== 'string' || !Number.isFinite(Date.parse(catalog.generatedAt)) || typeof catalog.authority !== 'string' || !catalog.authority || catalog.authority.length > 120) throw new Error('Catalog envelope is invalid')
  if (!Array.isArray(catalog.entries) || catalog.entries.length > 1_000 || !Array.isArray(catalog.revocations) || catalog.revocations.length > 1_000) throw new Error('Catalog entry limit is invalid')
  const entries = catalog.entries.map(validateCatalogEntry)
  if (new Set(entries.map((entry) => `${entry.packId}@${entry.version}`)).size !== entries.length) throw new Error('Catalog contains a duplicate Pack version')
  const revocations = catalog.revocations.map(validateRevocation)
  if (options.expectedKeyId !== undefined && catalog.keyId !== options.expectedKeyId) throw new Error('Catalog keyId does not match')
  if (options.publicKey !== undefined) {
    if (typeof catalog.signature !== 'string') throw new Error('Catalog signature is required')
    const signature = decodeBase64(catalog.signature, 'Catalog signature')
    if (signature.length !== 64 || !verify(null, Buffer.from(catalogSigningPayload({ ...catalog, entries, revocations })), options.publicKey, signature)) throw new Error('Catalog Ed25519 signature is invalid')
  }
  return { ...catalog, entries, revocations }
}

export function validateCatalogEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Catalog entry must be an object')
  assertKeys(value, ['packId', 'name', 'version', 'publisher', 'description', 'categories', 'downloadUrl', 'artifactSha256', 'publisherKeyFingerprint', 'minimumApiVersion', 'maximumApiVersion', 'publishedAt'], 'Catalog entry')
  if (typeof value.packId !== 'string' || !value.packId || value.packId.length > 160 || typeof value.name !== 'string' || !value.name || value.name.length > 100 || typeof value.publisher !== 'string' || !value.publisher || value.publisher.length > 100 || !SEMVER.test(value.version)) throw new Error('Catalog entry identity is invalid')
  if (value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 500)) throw new Error('Catalog entry description is invalid')
  if (!Array.isArray(value.categories) || value.categories.length > 6 || value.categories.some((category) => !['motion', 'speed', 'audio', 'title', 'export', 'transition'].includes(category)) || new Set(value.categories).size !== value.categories.length) throw new Error('Catalog entry categories are invalid')
  const url = strictHttpsUrl(value.downloadUrl, 'Catalog downloadUrl')
  if (!/^[0-9a-f]{64}$/i.test(value.artifactSha256) || !/^[0-9a-f]{64}$/i.test(value.publisherKeyFingerprint) || !SEMVER.test(value.minimumApiVersion) || value.maximumApiVersion !== undefined && !SEMVER.test(value.maximumApiVersion) || typeof value.publishedAt !== 'string' || !Number.isFinite(Date.parse(value.publishedAt))) throw new Error('Catalog entry verification metadata is invalid')
  return { ...value, downloadUrl: url.toString(), artifactSha256: value.artifactSha256.toLowerCase(), publisherKeyFingerprint: value.publisherKeyFingerprint.toLowerCase() }
}

export function validateRevocation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Revocation must be an object')
  assertKeys(value, ['packId', 'version', 'artifactSha256', 'publisherKeyFingerprint', 'reason', 'publishedAt'], 'Revocation')
  if (typeof value.packId !== 'string' || !value.packId || value.packId.length > 160 || value.version !== undefined && !SEMVER.test(value.version) || value.artifactSha256 !== undefined && !/^[0-9a-f]{64}$/i.test(value.artifactSha256) || value.publisherKeyFingerprint !== undefined && !/^[0-9a-f]{64}$/i.test(value.publisherKeyFingerprint) || !value.version && !value.artifactSha256 && !value.publisherKeyFingerprint || typeof value.reason !== 'string' || !value.reason || value.reason.length > 500 || typeof value.publishedAt !== 'string' || !Number.isFinite(Date.parse(value.publishedAt))) throw new Error('Revocation is invalid')
  return { ...value, ...(value.artifactSha256 ? { artifactSha256: value.artifactSha256.toLowerCase() } : {}), ...(value.publisherKeyFingerprint ? { publisherKeyFingerprint: value.publisherKeyFingerprint.toLowerCase() } : {}) }
}

export function strictHttpsOrigin(value) {
  const url = strictHttpsUrl(value, 'Origin')
  if (url.pathname !== '/' || url.search) throw new Error('Origin must not include a path or query')
  return url.origin
}

export function strictHttpsUrl(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be a URL`)
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error(`${label} must be credential-free HTTPS without a fragment`)
  return url
}

export function ed25519PublicKey(raw) {
  if (raw.length !== 32) throw new Error('Ed25519 public key must be 32 bytes')
  return createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' })
}

export function decodeBase64(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be Base64`)
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw new Error(`${label} is not valid Base64`)
  const bytes = Buffer.from(normalized, 'base64')
  if (!bytes.length) throw new Error(`${label} is empty`)
  return bytes
}

function assertKeys(value, allowed, label) {
  const accepted = new Set(allowed)
  const unknown = Object.keys(value).find((key) => !accepted.has(key))
  if (unknown) throw new Error(`${label} contains an unknown field: ${unknown}`)
}
