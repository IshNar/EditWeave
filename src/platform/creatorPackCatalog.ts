import { CREATOR_PACK_API_VERSION, parseCreatorPack, type CreatorPack, type InstalledCreatorPack } from './creatorPacks'

export const CREATOR_PACK_CATALOG_SCHEMA = 'cutline-creator-catalog-v1' as const
const MAX_CATALOG_BYTES = 1_000_000
const MAX_PACK_BYTES = 2_000_000
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export interface CreatorPackCatalogEntry {
  packId: string
  name: string
  version: string
  publisher: string
  description?: string
  categories: Array<'motion' | 'speed' | 'audio' | 'title' | 'export' | 'transition'>
  downloadUrl: string
  artifactSha256: string
  publisherKeyFingerprint: string
  minimumApiVersion: string
  maximumApiVersion?: string
  publishedAt: string
}

export interface CreatorPackRevocation {
  packId: string
  version?: string
  artifactSha256?: string
  publisherKeyFingerprint?: string
  reason: string
  publishedAt: string
}

export interface CreatorPackCatalog {
  schema: typeof CREATOR_PACK_CATALOG_SCHEMA
  generatedAt: string
  authority: string
  keyId?: string
  entries: CreatorPackCatalogEntry[]
  revocations: CreatorPackRevocation[]
  signature?: string
  verification: 'signed' | 'local-untrusted'
}

export interface CreatorPackCatalogStatus {
  entry: CreatorPackCatalogEntry
  status: 'available' | 'installed' | 'update' | 'older' | 'revoked'
  installedVersion?: string
}

export interface InstalledPackRevocation { installed: InstalledCreatorPack; revocation: CreatorPackRevocation }

export function creatorPackCatalogConfigured(): boolean {
  return Boolean((import.meta.env.VITE_CUTLINE_CREATOR_CATALOG_URL as string | undefined)?.trim())
}

export async function loadConfiguredCreatorPackCatalog(signal?: AbortSignal): Promise<CreatorPackCatalog> {
  const endpoint = (import.meta.env.VITE_CUTLINE_CREATOR_CATALOG_URL as string | undefined)?.trim()
  const publicKey = (import.meta.env.VITE_CUTLINE_CREATOR_CATALOG_PUBLIC_KEY as string | undefined)?.trim()
  const keyId = (import.meta.env.VITE_CUTLINE_CREATOR_CATALOG_KEY_ID as string | undefined)?.trim()
  if (!endpoint) throw new Error('Creator Pack 카탈로그 URL이 설정되지 않았습니다.')
  if (!publicKey || !keyId) throw new Error('운영 Creator Pack 카탈로그 공개키와 keyId가 설정되지 않았습니다.')
  const url = safeHttpsUrl(endpoint, 'Creator Pack 카탈로그')
  const response = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal })
  if (!response.ok) throw new Error(`Creator Pack 카탈로그 응답 오류 (${response.status})`)
  const payload = await limitedResponse(response, MAX_CATALOG_BYTES, 'Creator Pack 카탈로그')
  return parseCreatorPackCatalog(payload.text, { expectedPublicKey: publicKey, expectedKeyId: keyId })
}

export async function parseCreatorPackCatalog(raw: string, options: { expectedPublicKey?: string; expectedKeyId?: string; allowUnsignedLocal?: boolean } = {}): Promise<CreatorPackCatalog> {
  if (new TextEncoder().encode(raw).byteLength > MAX_CATALOG_BYTES) throw new Error('Creator Pack 카탈로그가 안전 제한(1MB)을 넘습니다.')
  let decoded: unknown
  try { decoded = JSON.parse(raw) } catch { throw new Error('Creator Pack 카탈로그 JSON 형식이 올바르지 않습니다.') }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('Creator Pack 카탈로그 형식이 올바르지 않습니다.')
  const source = decoded as Record<string, unknown>
  assertKeys(source, ['schema', 'generatedAt', 'authority', 'keyId', 'entries', 'revocations', 'signature'], '카탈로그')
  if (source.schema !== CREATOR_PACK_CATALOG_SCHEMA) throw new Error(`Creator Pack 카탈로그 schema는 ${CREATOR_PACK_CATALOG_SCHEMA}이어야 합니다.`)
  const entries = boundedArray(source.entries, 1_000, '카탈로그 항목').map(parseCatalogEntry)
  if (new Set(entries.map((entry) => `${entry.packId}@${entry.version}`)).size !== entries.length) throw new Error('Creator Pack 카탈로그에 같은 Pack 버전이 중복됐습니다.')
  const revocations = boundedArray(source.revocations, 1_000, '회수 항목').map(parseRevocation)
  const generatedAt = requiredDate(source.generatedAt, 'generatedAt')
  const authority = requiredText(source.authority, 120, 'authority')
  const keyId = optionalText(source.keyId, 120, 'keyId')
  const signature = optionalText(source.signature, 160, 'signature')
  const expectedPublicKey = options.expectedPublicKey?.trim()
  if (expectedPublicKey) {
    if (!options.expectedKeyId || keyId !== options.expectedKeyId) throw new Error('Creator Pack 카탈로그 keyId가 허용된 키와 다릅니다.')
    if (!signature) throw new Error('운영 Creator Pack 카탈로그 서명이 없습니다.')
    await verifyCatalogSignature({ schema: CREATOR_PACK_CATALOG_SCHEMA, generatedAt, authority, keyId, entries, revocations, signature }, expectedPublicKey)
    return { schema: CREATOR_PACK_CATALOG_SCHEMA, generatedAt, authority, keyId, entries, revocations, signature, verification: 'signed' }
  }
  if (!options.allowUnsignedLocal) throw new Error('Creator Pack 카탈로그를 검증할 공개키가 없습니다.')
  return { schema: CREATOR_PACK_CATALOG_SCHEMA, generatedAt, authority, keyId, entries, revocations, signature, verification: 'local-untrusted' }
}

export function createCreatorPackCatalogSigningPayload(catalog: Omit<CreatorPackCatalog, 'verification' | 'signature'> | CreatorPackCatalog): string {
  return stableStringify({
    schema: CREATOR_PACK_CATALOG_SCHEMA,
    generatedAt: catalog.generatedAt,
    authority: catalog.authority,
    keyId: catalog.keyId ?? null,
    entries: catalog.entries,
    revocations: catalog.revocations,
  })
}

export function searchCreatorPackCatalog(catalog: CreatorPackCatalog, query: string, installed: InstalledCreatorPack[]): CreatorPackCatalogStatus[] {
  const terms = query.trim().toLocaleLowerCase('ko').split(/\s+/).filter(Boolean)
  return catalog.entries.filter((entry) => {
    const haystack = `${entry.name} ${entry.publisher} ${entry.description ?? ''} ${entry.categories.join(' ')}`.toLocaleLowerCase('ko')
    return terms.every((term) => haystack.includes(term))
  }).map((entry) => {
    if (catalog.verification === 'signed' && catalog.revocations.some((revocation) => revocationMatchesEntry(revocation, entry))) return { entry, status: 'revoked' as const }
    const previous = installed.find((item) => item.id === entry.packId)
    if (!previous) return { entry, status: 'available' as const }
    const comparison = compareSemver(entry.version, previous.version)
    return { entry, status: comparison > 0 ? 'update' as const : comparison < 0 ? 'older' as const : 'installed' as const, installedVersion: previous.version }
  }).sort((left, right) => statusOrder(left.status) - statusOrder(right.status) || right.entry.publishedAt.localeCompare(left.entry.publishedAt) || left.entry.name.localeCompare(right.entry.name, 'ko'))
}

export function findInstalledPackRevocations(catalog: CreatorPackCatalog, installed: InstalledCreatorPack[]): InstalledPackRevocation[] {
  if (catalog.verification !== 'signed') return []
  return installed.flatMap((record) => catalog.revocations.filter((revocation) => revocation.packId === record.id
    && (!revocation.version || revocation.version === record.version)
    && (!revocation.artifactSha256 || revocation.artifactSha256 === record.artifactSha256)
    && (!revocation.publisherKeyFingerprint || revocation.publisherKeyFingerprint === record.publisherKeyFingerprint))
    .map((revocation) => ({ installed: record, revocation })))
}

export async function downloadCatalogCreatorPack(entry: CreatorPackCatalogEntry, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<CreatorPack> {
  const url = safeHttpsUrl(entry.downloadUrl, 'Creator Pack 다운로드')
  const response = await fetcher(url, { cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal })
  if (!response.ok) throw new Error(`Creator Pack 다운로드 응답 오류 (${response.status})`)
  const payload = await limitedResponse(response, MAX_PACK_BYTES, 'Creator Pack')
  const artifactDigest = await sha256Hex(payload.bytes)
  if (artifactDigest !== entry.artifactSha256) throw new Error('다운로드한 Creator Pack의 catalog SHA-256이 일치하지 않습니다.')
  const pack = await parseCreatorPack(payload.text)
  if (pack.verification?.signature !== 'verified' || !pack.verification.keyFingerprint) throw new Error('카탈로그 배포 Pack은 유효한 제작자 서명이 필요합니다.')
  if (pack.id !== entry.packId || pack.version !== entry.version || pack.publisher !== entry.publisher) throw new Error('다운로드한 Creator Pack의 ID·버전·제작자가 catalog와 일치하지 않습니다.')
  if (pack.verification.keyFingerprint !== entry.publisherKeyFingerprint) throw new Error('다운로드한 Creator Pack의 제작자 키 지문이 catalog와 일치하지 않습니다.')
  return pack
}

async function verifyCatalogSignature(catalog: Omit<CreatorPackCatalog, 'verification'>, encodedPublicKey: string): Promise<void> {
  const publicKeyBytes = decodeBase64(encodedPublicKey, '카탈로그 공개키')
  const signatureBytes = decodeBase64(catalog.signature ?? '', '카탈로그 서명')
  if (publicKeyBytes.byteLength !== 32 || signatureBytes.byteLength !== 64) throw new Error('Creator Pack 카탈로그 Ed25519 키 또는 서명 길이가 올바르지 않습니다.')
  const key = await crypto.subtle.importKey('raw', ownedBuffer(publicKeyBytes), 'Ed25519', false, ['verify'])
  const valid = await crypto.subtle.verify('Ed25519', key, ownedBuffer(signatureBytes), new TextEncoder().encode(createCreatorPackCatalogSigningPayload(catalog as CreatorPackCatalog)))
  if (!valid) throw new Error('Creator Pack 카탈로그 서명이 올바르지 않습니다.')
}

function parseCatalogEntry(value: unknown): CreatorPackCatalogEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Creator Pack 카탈로그 항목 형식이 올바르지 않습니다.')
  const candidate = value as Record<string, unknown>
  assertKeys(candidate, ['packId', 'name', 'version', 'publisher', 'description', 'categories', 'downloadUrl', 'artifactSha256', 'publisherKeyFingerprint', 'minimumApiVersion', 'maximumApiVersion', 'publishedAt'], '카탈로그 항목')
  const categories = boundedArray(candidate.categories, 6, '카테고리').map((item) => requiredText(item, 20, 'category'))
  if (categories.some((item) => !['motion', 'speed', 'audio', 'title', 'export', 'transition'].includes(item))) throw new Error('Creator Pack 카탈로그 category가 올바르지 않습니다.')
  const minimumApiVersion = requiredSemver(candidate.minimumApiVersion, 'minimumApiVersion')
  const maximumApiVersion = candidate.maximumApiVersion === undefined ? undefined : requiredSemver(candidate.maximumApiVersion, 'maximumApiVersion')
  if (compareSemver(CREATOR_PACK_API_VERSION, minimumApiVersion) < 0 || maximumApiVersion && compareSemver(CREATOR_PACK_API_VERSION, maximumApiVersion) > 0) throw new Error('현재 Creator Pack API와 호환되지 않는 catalog 항목입니다.')
  return {
    packId: requiredText(candidate.packId, 160, 'packId'), name: requiredText(candidate.name, 100, 'name'), version: requiredSemver(candidate.version, 'version'),
    publisher: requiredText(candidate.publisher, 100, 'publisher'), description: optionalText(candidate.description, 500, 'description'),
    categories: [...new Set(categories)] as CreatorPackCatalogEntry['categories'], downloadUrl: safeHttpsUrl(requiredText(candidate.downloadUrl, 2_048, 'downloadUrl'), 'Creator Pack 다운로드').toString(),
    artifactSha256: requiredDigest(candidate.artifactSha256, 'artifactSha256'), publisherKeyFingerprint: requiredDigest(candidate.publisherKeyFingerprint, 'publisherKeyFingerprint'),
    minimumApiVersion, maximumApiVersion, publishedAt: requiredDate(candidate.publishedAt, 'publishedAt'),
  }
}

function parseRevocation(value: unknown): CreatorPackRevocation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Creator Pack 회수 항목 형식이 올바르지 않습니다.')
  const candidate = value as Record<string, unknown>
  assertKeys(candidate, ['packId', 'version', 'artifactSha256', 'publisherKeyFingerprint', 'reason', 'publishedAt'], '회수 항목')
  const version = candidate.version === undefined ? undefined : requiredSemver(candidate.version, 'revocation version')
  const artifactSha256 = candidate.artifactSha256 === undefined ? undefined : requiredDigest(candidate.artifactSha256, 'revocation artifactSha256')
  const publisherKeyFingerprint = candidate.publisherKeyFingerprint === undefined ? undefined : requiredDigest(candidate.publisherKeyFingerprint, 'revocation publisherKeyFingerprint')
  if (!version && !artifactSha256 && !publisherKeyFingerprint) throw new Error('회수 항목에는 버전·artifact digest·제작자 키 지문 중 하나가 필요합니다.')
  return { packId: requiredText(candidate.packId, 160, 'revocation packId'), version, artifactSha256, publisherKeyFingerprint, reason: requiredText(candidate.reason, 500, 'revocation reason'), publishedAt: requiredDate(candidate.publishedAt, 'revocation publishedAt') }
}

async function limitedResponse(response: Response, maximum: number, label: string): Promise<{ text: string; bytes: Uint8Array }> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (declaredLength > maximum) throw new Error(`${label}이 안전 제한을 넘습니다.`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maximum) throw new Error(`${label}이 안전 제한을 넘습니다.`)
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), bytes } } catch { throw new Error(`${label} UTF-8 형식이 올바르지 않습니다.`) }
}

function safeHttpsUrl(value: string, label: string): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new Error(`${label} 주소가 올바르지 않습니다.`) }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error(`${label} 주소는 자격 증명·fragment 없는 HTTPS여야 합니다.`)
  return url
}

function boundedArray(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label} 수가 안전 제한(${maximum}개)을 넘거나 형식이 올바르지 않습니다.`)
  return value
}

function requiredText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(`Creator Pack 카탈로그 ${label} 형식이 올바르지 않습니다.`)
  return value.trim()
}

function optionalText(value: unknown, maximum: number, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requiredText(value, maximum, label)
}

function requiredDate(value: unknown, label: string): string {
  const text = requiredText(value, 80, label)
  if (!Number.isFinite(Date.parse(text))) throw new Error(`Creator Pack 카탈로그 ${label} 날짜가 올바르지 않습니다.`)
  return text
}

function requiredSemver(value: unknown, label: string): string {
  const text = requiredText(value, 40, label)
  if (!SEMVER_PATTERN.test(text)) throw new Error(`Creator Pack 카탈로그 ${label} 버전이 올바르지 않습니다.`)
  return text
}

function requiredDigest(value: unknown, label: string): string {
  const text = requiredText(value, 64, label).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(text)) throw new Error(`Creator Pack 카탈로그 ${label} SHA-256이 올바르지 않습니다.`)
  return text
}

function compareSemver(left: string, right: string): number {
  const a = left.split('.').map(Number); const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] - b[index]
  return 0
}

function statusOrder(status: CreatorPackCatalogStatus['status']): number {
  return status === 'update' ? 0 : status === 'available' ? 1 : status === 'installed' ? 2 : status === 'older' ? 3 : 4
}

function revocationMatchesEntry(revocation: CreatorPackRevocation, entry: CreatorPackCatalogEntry): boolean {
  return revocation.packId === entry.packId
    && (!revocation.version || revocation.version === entry.version)
    && (!revocation.artifactSha256 || revocation.artifactSha256 === entry.artifactSha256)
    && (!revocation.publisherKeyFingerprint || revocation.publisherKeyFingerprint === entry.publisherKeyFingerprint)
}

function assertKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key))
  if (unknown) throw new Error(`Creator Pack ${label}에 지원하지 않는 필드가 있습니다: ${unknown}`)
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  return JSON.stringify(value)
}

function decodeBase64(value: string, label: string): Uint8Array {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '')
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw new Error()
    return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')), (character) => character.charCodeAt(0))
  } catch { throw new Error(`Creator Pack ${label} Base64 형식이 올바르지 않습니다.`) }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', ownedBuffer(bytes))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer
}
