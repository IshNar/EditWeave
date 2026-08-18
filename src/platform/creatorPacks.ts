import { parseAudioTeamTemplate, readAudioTeamTemplates, writeAudioTeamTemplates, type AudioTeamTemplate } from './audioTemplates'
import { normalizeUserExportPreset, readUserExportPresets, writeUserExportPresets, type SavedExportPreset } from './exportPresets'
import { parseMotionTemplate, readMotionTemplates, writeMotionTemplates, type MotionTemplate } from './motionTemplates'
import { parseSpeedTemplate, readSpeedTemplates, writeSpeedTemplates, type SpeedTemplate } from './speedTemplates'
import { parseTitleStyleTemplate, readTitleStyleTemplates, writeTitleStyleTemplates, type TitleStyleTemplate } from './titleStyleTemplates'
import { parseTransitionPreset, readTransitionPresets, writeTransitionPresets, type TransitionPreset } from './transitionPresets'

export const CREATOR_PACK_CHANGED_EVENT = 'editweave-creator-pack-changed'
export const CREATOR_PACK_API_VERSION = '1.0.0'
const INSTALL_REGISTRY_KEY = 'editweave.creator-pack-installs.v1'
const PUBLISHER_TRUST_REGISTRY_KEY = 'editweave.creator-pack-publisher-trust.v1'

export interface CreatorPackIntegrity { algorithm: 'SHA-256'; digest: string }
export interface CreatorPackSignature { algorithm: 'Ed25519'; keyId: string; publicKey: string; value: string }
export interface CreatorPackVerification { integrity: 'verified' | 'legacy-unsigned'; signature: 'verified' | 'unsigned'; keyId?: string; keyFingerprint?: string; artifactSha256?: string }
export interface CreatorPackPublisherTrust {
  keyId: string
  publisher: string
  publicKey: string
  keyFingerprint: string
  state: 'trusted' | 'blocked'
  createdAt: string
  updatedAt: string
}
export interface CreatorPackTrustAssessment { status: 'unsigned' | 'untrusted' | 'trusted' | 'blocked' | 'key-changed'; record?: CreatorPackPublisherTrust }
export interface CreatorPackInstallDecision { status: 'new' | 'reinstall' | 'upgrade' | 'downgrade' | 'publisher-key-changed'; installedVersion?: string }

export interface CreatorPack {
  schema: 'editweave-creator-pack-v2'
  apiVersion: '1.0.0'
  compatibility: { minimumApiVersion: string; maximumApiVersion?: string }
  id: string
  name: string
  version: string
  publisher: string
  createdAt: string
  security: { executableCode: false; networkAccess: false; filesystemAccess: false }
  contents: {
    motionTemplates: MotionTemplate[]
    speedTemplates: SpeedTemplate[]
    audioTemplates: AudioTeamTemplate[]
    titleStyleTemplates: TitleStyleTemplate[]
    exportPresets: SavedExportPreset[]
    transitionPresets: TransitionPreset[]
  }
  integrity?: CreatorPackIntegrity
  signature?: CreatorPackSignature
  verification?: CreatorPackVerification
}

export interface CreatorPackInstallResult {
  motionTemplates: number
  speedTemplates: number
  audioTemplates: number
  titleStyleTemplates: number
  exportPresets: number
  transitionPresets: number
}

interface InstalledItem { id: string; signature: string }
export interface InstalledCreatorPack {
  id: string
  name: string
  version: string
  publisher: string
  installedAt: string
  verification: CreatorPackVerification
  publisherKeyFingerprint?: string
  artifactSha256?: string
  items: Record<keyof CreatorPackInstallResult, InstalledItem[]>
}

export function createCreatorPack(name: string, publisher: string): CreatorPack {
  return {
    schema: 'editweave-creator-pack-v2', apiVersion: CREATOR_PACK_API_VERSION,
    compatibility: { minimumApiVersion: CREATOR_PACK_API_VERSION },
    id: crypto.randomUUID(), name: name.trim().slice(0, 100) || 'Creator Pack', version: '1.0.0',
    publisher: publisher.trim().slice(0, 100) || 'EditWeave 사용자', createdAt: new Date().toISOString(),
    security: { executableCode: false, networkAccess: false, filesystemAccess: false },
    contents: {
      motionTemplates: readMotionTemplates(), speedTemplates: readSpeedTemplates(), audioTemplates: readAudioTeamTemplates(),
      titleStyleTemplates: readTitleStyleTemplates(), exportPresets: readUserExportPresets(), transitionPresets: readTransitionPresets(),
    },
  }
}

export async function serializeCreatorPack(pack: CreatorPack): Promise<string> {
  return JSON.stringify(await sealCreatorPack(pack), null, 2)
}

export async function sealCreatorPack(pack: CreatorPack): Promise<CreatorPack> {
  const normalized: CreatorPack = { ...pack, schema: 'editweave-creator-pack-v2', apiVersion: CREATOR_PACK_API_VERSION, verification: undefined }
  const digest = await creatorPackDigest(normalized)
  const signature = pack.integrity?.digest.toLowerCase() === digest ? pack.signature : undefined
  return { ...normalized, signature, integrity: { algorithm: 'SHA-256', digest } }
}

export async function signCreatorPack(pack: CreatorPack, privateKey: CryptoKey, publicKey: CryptoKey, keyId: string): Promise<CreatorPack> {
  const sealed = await sealCreatorPack({ ...pack, signature: undefined })
  const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey))
  const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, signingPayload(sealed)))
  return {
    ...sealed,
    signature: { algorithm: 'Ed25519', keyId: safeText(keyId, 120, 'publisher-key'), publicKey: bytesToBase64(publicKeyBytes), value: bytesToBase64(signature) },
  }
}

export async function parseCreatorPack(raw: string, currentApiVersion = CREATOR_PACK_API_VERSION): Promise<CreatorPack> {
  const rawBytes = new TextEncoder().encode(raw)
  if (rawBytes.byteLength > 2_000_000) throw new Error('Creator Pack이 안전 제한(2MB)을 넘습니다.')
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object') throw new Error('Creator Pack 형식이 아닙니다.')
  const source = value as Record<string, unknown>
  const legacy = source.schema === 'editweave-creator-pack-v1'
  if (!legacy && source.schema !== 'editweave-creator-pack-v2') throw new Error('지원되는 EditWeave Creator Pack이 아닙니다.')
  assertNoPrivileges(source.security)
  const compatibility = legacy ? { minimumApiVersion: CREATOR_PACK_API_VERSION } : parseCompatibility(source.compatibility)
  assertCompatibleApi(compatibility, currentApiVersion)
  const envelopeVerification: CreatorPackVerification = legacy
    ? { integrity: 'legacy-unsigned', signature: 'unsigned' }
    : await verifyPackEnvelope(source)
  const verification: CreatorPackVerification = { ...envelopeVerification, artifactSha256: await sha256Hex(rawBytes) }
  const contents = source.contents as Partial<CreatorPack['contents']> | undefined
  if (!contents || typeof source.name !== 'string') throw new Error('Creator Pack 콘텐츠가 없습니다.')
  const motion = boundedArray(contents.motionTemplates, 100, '모션').map((template) => parseMotionTemplate(JSON.stringify(template)))
  const speed = boundedArray(contents.speedTemplates, 100, '속도').map((template) => parseSpeedTemplate(JSON.stringify(template)))
  const audio = boundedArray(contents.audioTemplates, 50, '오디오').map((template) => {
    const parsed = parseAudioTeamTemplate(JSON.stringify(template)); const now = new Date().toISOString()
    return { ...parsed, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
  })
  const titles = boundedArray(contents.titleStyleTemplates, 100, '타이틀 스타일').map((template) => parseTitleStyleTemplate(JSON.stringify(template)))
  const exports = boundedArray(contents.exportPresets, 100, '출력').map((preset) => normalizeUserExportPreset(preset, true))
  const transitions = boundedArray(contents.transitionPresets, 100, '전환').map((preset) => parseTransitionPreset(JSON.stringify(preset)))
  return {
    schema: 'editweave-creator-pack-v2', apiVersion: CREATOR_PACK_API_VERSION, compatibility,
    id: safeText(source.id, 160, crypto.randomUUID()), name: safeText(source.name, 100, 'Creator Pack'),
    version: requireSemver(source.version, 'Pack 버전'), publisher: safeText(source.publisher, 100, '알 수 없음'),
    createdAt: safeText(source.createdAt, 80, new Date().toISOString()),
    security: { executableCode: false, networkAccess: false, filesystemAccess: false },
    contents: { motionTemplates: motion, speedTemplates: speed, audioTemplates: audio, titleStyleTemplates: titles, exportPresets: exports, transitionPresets: transitions },
    integrity: legacy ? undefined : source.integrity as CreatorPackIntegrity,
    signature: legacy ? undefined : source.signature as CreatorPackSignature | undefined,
    verification,
  }
}

export function assessCreatorPackTrust(pack: CreatorPack): CreatorPackTrustAssessment {
  if (pack.verification?.signature !== 'verified' || !pack.signature || !pack.verification.keyFingerprint) return { status: 'unsigned' }
  const records = readCreatorPackPublisherTrust()
  const exact = records.find((record) => record.keyId === pack.signature!.keyId && record.publicKey === pack.signature!.publicKey)
  if (exact) return { status: exact.state, record: exact }
  const reusedKeyId = records.find((record) => record.keyId === pack.signature!.keyId)
  return reusedKeyId ? { status: 'key-changed', record: reusedKeyId } : { status: 'untrusted' }
}

export function setCreatorPackPublisherTrust(pack: CreatorPack, state: CreatorPackPublisherTrust['state']): CreatorPackPublisherTrust {
  if (pack.verification?.signature !== 'verified' || !pack.signature || !pack.verification.keyFingerprint) throw new Error('유효한 제작자 서명이 있는 Pack만 신뢰하거나 차단할 수 있습니다.')
  const records = readCreatorPackPublisherTrust()
  const previous = records.find((record) => record.keyId === pack.signature!.keyId && record.publicKey === pack.signature!.publicKey)
  const now = new Date().toISOString()
  const record: CreatorPackPublisherTrust = {
    keyId: pack.signature.keyId, publisher: pack.publisher, publicKey: pack.signature.publicKey, keyFingerprint: pack.verification.keyFingerprint,
    state, createdAt: previous?.createdAt ?? now, updatedAt: now,
  }
  writeCreatorPackPublisherTrust([...records.filter((item) => !(item.keyId === record.keyId && item.publicKey === record.publicKey)), record])
  dispatchPackChanged()
  return record
}

export function readCreatorPackPublisherTrust(): CreatorPackPublisherTrust[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PUBLISHER_TRUST_REGISTRY_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(isCreatorPackPublisherTrust).slice(-200) : []
  } catch { return [] }
}

export function assessCreatorPackInstall(pack: CreatorPack, installed = readInstalledCreatorPacks()): CreatorPackInstallDecision {
  const previous = installed.find((item) => item.id === pack.id)
  if (!previous) return { status: 'new' }
  const nextFingerprint = pack.verification?.keyFingerprint
  if (previous.publisherKeyFingerprint && previous.publisherKeyFingerprint !== nextFingerprint) return { status: 'publisher-key-changed', installedVersion: previous.version }
  const comparison = compareSemver(pack.version, previous.version)
  return { status: comparison > 0 ? 'upgrade' : comparison < 0 ? 'downgrade' : 'reinstall', installedVersion: previous.version }
}

export function installCreatorPack(pack: CreatorPack, options: { allowDowngrade?: boolean } = {}): CreatorPackInstallResult {
  if (!pack.verification) throw new Error('무결성을 검증한 Creator Pack만 설치할 수 있습니다.')
  const trust = assessCreatorPackTrust(pack)
  if (trust.status === 'blocked') throw new Error('차단한 제작자 키로 서명된 Creator Pack입니다.')
  if (trust.status === 'key-changed') throw new Error('같은 keyId에 다른 공개키가 사용됐습니다. 제작자 키 변경을 확인해야 합니다.')
  if (trust.status === 'untrusted') throw new Error('서명된 Creator Pack은 제작자 키를 신뢰한 뒤 설치할 수 있습니다.')
  const installDecision = assessCreatorPackInstall(pack)
  if (installDecision.status === 'publisher-key-changed') throw new Error('설치된 Pack과 제작자 키 지문이 달라 업데이트를 차단했습니다.')
  if (installDecision.status === 'downgrade' && !options.allowDowngrade) throw new Error(`설치된 v${installDecision.installedVersion}보다 낮은 v${pack.version} 다운그레이드를 차단했습니다.`)
  const before = snapshotStores()
  const motion = mergeBySignature(before.motionTemplates, pack.contents.motionTemplates)
  const speed = mergeBySignature(before.speedTemplates, pack.contents.speedTemplates)
  const audio = mergeBySignature(before.audioTemplates, pack.contents.audioTemplates)
  const titles = mergeBySignature(before.titleStyleTemplates, pack.contents.titleStyleTemplates)
  const exports = mergeBySignature(before.exportPresets, pack.contents.exportPresets)
  const transitions = mergeBySignature(before.transitionPresets, pack.contents.transitionPresets)
  const installedRecords = readInstalledCreatorPacks()
  const previousRecord = installedRecords.find((item) => item.id === pack.id)
  const addedItems: InstalledCreatorPack['items'] = {
      motionTemplates: installedItems(motion.addedValues), speedTemplates: installedItems(speed.addedValues), audioTemplates: installedItems(audio.addedValues),
      titleStyleTemplates: installedItems(titles.addedValues), exportPresets: installedItems(exports.addedValues), transitionPresets: installedItems(transitions.addedValues),
  }
  const record: InstalledCreatorPack = {
    id: pack.id, name: pack.name, version: pack.version, publisher: pack.publisher, installedAt: previousRecord?.installedAt ?? new Date().toISOString(), verification: pack.verification,
    publisherKeyFingerprint: pack.verification.keyFingerprint,
    artifactSha256: pack.verification.artifactSha256,
    items: Object.fromEntries((Object.keys(addedItems) as Array<keyof CreatorPackInstallResult>).map((key) => {
      const combined = [...(previousRecord?.items[key] ?? []), ...addedItems[key]]
      return [key, [...new Map(combined.map((item) => [item.id, item])).values()]]
    })) as InstalledCreatorPack['items'],
  }
  try {
    writeMotionTemplates(motion.values); writeSpeedTemplates(speed.values); writeAudioTeamTemplates(audio.values); writeTitleStyleTemplates(titles.values)
    writeUserExportPresets(exports.values); writeTransitionPresets(transitions.values)
    writeInstalledCreatorPacks([...installedRecords.filter((item) => item.id !== pack.id), record])
  } catch (error) {
    restoreStores(before)
    throw new Error(`Creator Pack 설치를 롤백했습니다: ${error instanceof Error ? error.message : String(error)}`)
  }
  dispatchPackChanged()
  return { motionTemplates: motion.added, speedTemplates: speed.added, audioTemplates: audio.added, titleStyleTemplates: titles.added, exportPresets: exports.added, transitionPresets: transitions.added }
}

export function readInstalledCreatorPacks(): InstalledCreatorPack[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(INSTALL_REGISTRY_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(isInstalledCreatorPack).slice(-100) : []
  } catch { return [] }
}

export function uninstallCreatorPack(packId: string): { removed: number; preservedModified: number } {
  const installed = readInstalledCreatorPacks()
  const record = installed.find((item) => item.id === packId)
  if (!record) throw new Error('설치 기록에서 Creator Pack을 찾지 못했습니다.')
  const before = snapshotStores()
  let preservedModified = 0
  const remove = <T extends { id: string; name: string }>(values: T[], items: InstalledItem[]): T[] => {
    const byId = new Map(items.map((item) => [item.id, item.signature]))
    return values.filter((value) => {
      const signature = byId.get(value.id)
      if (!signature) return true
      if (signature !== templateSignature(value as T & Record<string, unknown>)) { preservedModified++; return true }
      return false
    })
  }
  const next = {
    motionTemplates: remove(before.motionTemplates, record.items.motionTemplates), speedTemplates: remove(before.speedTemplates, record.items.speedTemplates),
    audioTemplates: remove(before.audioTemplates, record.items.audioTemplates), titleStyleTemplates: remove(before.titleStyleTemplates, record.items.titleStyleTemplates),
    exportPresets: remove(before.exportPresets, record.items.exportPresets), transitionPresets: remove(before.transitionPresets, record.items.transitionPresets),
  }
  try {
    restoreStores(next); writeInstalledCreatorPacks(installed.filter((item) => item.id !== packId))
  } catch (error) {
    restoreStores(before)
    throw new Error(`Creator Pack 제거를 롤백했습니다: ${error instanceof Error ? error.message : String(error)}`)
  }
  dispatchPackChanged()
  const previousCount = Object.values(before).reduce((sum, values) => sum + values.length, 0)
  const nextCount = Object.values(next).reduce((sum, values) => sum + values.length, 0)
  return { removed: previousCount - nextCount, preservedModified }
}

async function verifyPackEnvelope(source: Record<string, unknown>): Promise<CreatorPackVerification> {
  const integrity = source.integrity as Partial<CreatorPackIntegrity> | undefined
  if (integrity?.algorithm !== 'SHA-256' || typeof integrity.digest !== 'string' || !/^[0-9a-f]{64}$/i.test(integrity.digest)) throw new Error('Creator Pack SHA-256 무결성 정보가 없습니다.')
  const actual = await creatorPackDigest(source)
  if (actual !== integrity.digest.toLowerCase()) throw new Error('Creator Pack 내용이 무결성 생성 이후 변경됐습니다.')
  const signature = source.signature as Partial<CreatorPackSignature> | undefined
  if (!signature) return { integrity: 'verified', signature: 'unsigned' }
  if (signature.algorithm !== 'Ed25519' || typeof signature.keyId !== 'string' || typeof signature.publicKey !== 'string' || typeof signature.value !== 'string') throw new Error('Creator Pack 제작자 서명 형식이 올바르지 않습니다.')
  const publicKeyBytes = base64ToBytes(signature.publicKey)
  const signatureBytes = base64ToBytes(signature.value)
  if (publicKeyBytes.byteLength !== 32 || signatureBytes.byteLength !== 64) throw new Error('Creator Pack Ed25519 키 또는 서명 길이가 올바르지 않습니다.')
  const key = await crypto.subtle.importKey('raw', ownedBuffer(publicKeyBytes), 'Ed25519', false, ['verify'])
  const verified = await crypto.subtle.verify('Ed25519', key, ownedBuffer(signatureBytes), signingPayload(source as unknown as CreatorPack))
  if (!verified) throw new Error('Creator Pack 제작자 서명이 올바르지 않습니다.')
  return { integrity: 'verified', signature: 'verified', keyId: signature.keyId.slice(0, 120), keyFingerprint: await sha256Hex(publicKeyBytes) }
}

async function creatorPackDigest(pack: CreatorPack | Record<string, unknown>): Promise<string> {
  const source = structuredClone(pack) as Record<string, unknown>
  delete source.integrity; delete source.signature; delete source.verification
  return sha256Hex(new TextEncoder().encode(stableStringify(source)))
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', ownedBuffer(bytes))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function signingPayload(pack: CreatorPack | Record<string, unknown>): ArrayBuffer {
  const integrity = (pack.integrity as CreatorPackIntegrity | undefined)?.digest ?? ''
  return ownedBuffer(new TextEncoder().encode(`editweave-creator-pack-v2\n${integrity.toLowerCase()}`))
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  return JSON.stringify(value)
}

function assertNoPrivileges(value: unknown): void {
  const security = value as Partial<CreatorPack['security']> | undefined
  if (security?.executableCode !== false || security.networkAccess !== false || security.filesystemAccess !== false) throw new Error('코드 실행이나 외부 권한을 요구하는 Pack은 설치할 수 없습니다.')
}

function parseCompatibility(value: unknown): CreatorPack['compatibility'] {
  const candidate = value as Partial<CreatorPack['compatibility']> | undefined
  return { minimumApiVersion: requireSemver(candidate?.minimumApiVersion, '최소 Pack API 버전'), maximumApiVersion: candidate?.maximumApiVersion === undefined ? undefined : requireSemver(candidate.maximumApiVersion, '최대 Pack API 버전') }
}

function assertCompatibleApi(range: CreatorPack['compatibility'], current: string): void {
  const currentVersion = requireSemver(current, '현재 Pack API 버전')
  if (compareSemver(currentVersion, range.minimumApiVersion) < 0 || range.maximumApiVersion && compareSemver(currentVersion, range.maximumApiVersion) > 0) throw new Error(`이 Pack은 Creator Pack API ${range.minimumApiVersion}${range.maximumApiVersion ? `~${range.maximumApiVersion}` : ' 이상'}용입니다. 현재 API는 ${currentVersion}입니다.`)
}

function compareSemver(left: string, right: string): number {
  const a = left.split('.').map(Number); const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] - b[index]
  return 0
}

function requireSemver(value: unknown, label: string): string {
  const text = String(value ?? '')
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(text)) throw new Error(`${label} 형식이 올바르지 않습니다.`)
  return text
}

function boundedArray<T>(value: T[] | undefined, maximum: number, label: string): T[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label} 템플릿 수가 안전 제한(${maximum}개)을 넘습니다.`)
  return value
}

function safeText(value: unknown, maximum: number, fallback: string): string {
  const text = typeof value === 'string' ? value.trim().slice(0, maximum) : ''
  return text || fallback
}

function templateSignature(value: { name: string; [key: string]: unknown }): string {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...content } = value
  return stableStringify({ name: value.name.trim().toLocaleLowerCase('ko'), content })
}

function mergeBySignature<T extends { id: string; name: string }>(current: T[], incoming: T[]): { values: T[]; added: number; addedValues: T[] } {
  const signatures = new Set(current.map((value) => templateSignature(value as T & Record<string, unknown>)))
  const values = [...current]; const addedValues: T[] = []
  incoming.forEach((value) => { const key = templateSignature(value as T & Record<string, unknown>); if (!signatures.has(key)) { values.push(value); addedValues.push(value); signatures.add(key) } })
  return { values, added: addedValues.length, addedValues }
}

function installedItems<T extends { id: string; name: string }>(values: T[]): InstalledItem[] {
  return values.map((value) => ({ id: value.id, signature: templateSignature(value as T & Record<string, unknown>) }))
}

function snapshotStores() {
  return {
    motionTemplates: readMotionTemplates(), speedTemplates: readSpeedTemplates(), audioTemplates: readAudioTeamTemplates(),
    titleStyleTemplates: readTitleStyleTemplates(), exportPresets: readUserExportPresets(), transitionPresets: readTransitionPresets(),
  }
}

function restoreStores(snapshot: ReturnType<typeof snapshotStores>): void {
  writeMotionTemplates(snapshot.motionTemplates); writeSpeedTemplates(snapshot.speedTemplates); writeAudioTeamTemplates(snapshot.audioTemplates)
  writeTitleStyleTemplates(snapshot.titleStyleTemplates); writeUserExportPresets(snapshot.exportPresets); writeTransitionPresets(snapshot.transitionPresets)
}

function writeInstalledCreatorPacks(records: InstalledCreatorPack[]): void {
  localStorage.setItem(INSTALL_REGISTRY_KEY, JSON.stringify(records.slice(-100)))
}

function writeCreatorPackPublisherTrust(records: CreatorPackPublisherTrust[]): void {
  localStorage.setItem(PUBLISHER_TRUST_REGISTRY_KEY, JSON.stringify(records.slice(-200)))
}

function isInstalledCreatorPack(value: unknown): value is InstalledCreatorPack {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<InstalledCreatorPack>
  const itemKeys: Array<keyof CreatorPackInstallResult> = ['motionTemplates', 'speedTemplates', 'audioTemplates', 'titleStyleTemplates', 'exportPresets', 'transitionPresets']
  const items = candidate.items as Partial<InstalledCreatorPack['items']> | undefined
  const validItems = Boolean(items) && itemKeys.every((key) => Array.isArray(items?.[key]) && items[key]!.every((item) => typeof item?.id === 'string' && typeof item.signature === 'string'))
  const verification = candidate.verification
  const validVerification = (verification?.integrity === 'verified' || verification?.integrity === 'legacy-unsigned')
    && (verification.signature === 'verified' || verification.signature === 'unsigned')
  return typeof candidate.id === 'string' && typeof candidate.name === 'string' && typeof candidate.version === 'string'
    && typeof candidate.publisher === 'string' && typeof candidate.installedAt === 'string' && validItems && validVerification
}

function isCreatorPackPublisherTrust(value: unknown): value is CreatorPackPublisherTrust {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CreatorPackPublisherTrust>
  return typeof candidate.keyId === 'string' && candidate.keyId.length > 0 && candidate.keyId.length <= 120
    && typeof candidate.publisher === 'string' && typeof candidate.publicKey === 'string'
    && typeof candidate.keyFingerprint === 'string' && /^[0-9a-f]{64}$/.test(candidate.keyFingerprint)
    && (candidate.state === 'trusted' || candidate.state === 'blocked')
    && typeof candidate.createdAt === 'string' && typeof candidate.updatedAt === 'string'
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  try { const binary = atob(value); return Uint8Array.from(binary, (character) => character.charCodeAt(0)) } catch { throw new Error('Creator Pack 서명의 Base64 인코딩이 올바르지 않습니다.') }
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer
}

function dispatchPackChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CREATOR_PACK_CHANGED_EVENT))
}
