import { invoke, isTauri } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { save } from '@tauri-apps/plugin-dialog'

export interface UpdateManifest {
  schema: 'editweave-update-v1'
  version: string
  platform: 'windows-x86_64' | 'windows-aarch64' | 'macos-x86_64' | 'macos-aarch64' | 'macos-universal'
  notes?: string
  publishedAt?: string
  downloadUrl: string
  sha256: string
  channel?: 'stable' | 'beta'
  minimumSupportedVersion?: string
  keyId?: string
  signature?: string
}

export interface UpdateCheckResult {
  available: boolean
  manifest?: UpdateManifest
  configured: boolean
}

export interface DownloadedUpdateInstaller {
  path: string
  size: number
  sha256: string
  signer: string
  token: string
}

export interface StoredUpdateInstaller {
  schema: 'editweave-update-attempt-v1'
  targetVersion: string
  previousVersion: string
  platform: UpdateManifest['platform']
  signedPayload: string
  signature: string
  installerPath: string
  verifiedAt: number
  launchedAt?: number
  launchSessionId?: string
}

export type UpdateAttemptResult =
  | { status: 'none' | 'ready' | 'pending' }
  | { status: 'applied' | 'not-applied' | 'expired'; targetVersion: string; installerPath?: string }

interface SigningPayload {
  schema: 'editweave-update-v1'
  version: string
  platform: UpdateManifest['platform']
  channel: 'stable' | 'beta' | null
  publishedAt: string | null
  minimumSupportedVersion: string | null
  notes: string | null
  downloadUrl: string
  sha256: string
}

const UPDATE_SCHEMA = 'editweave-update-v1' as const
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const UPDATE_ATTEMPT_KEY = 'editweave-update-attempt-v1'
const UPDATE_ATTEMPT_MAX_AGE = 7 * 24 * 60 * 60 * 1000
const UPDATE_LAUNCH_GRACE = 10 * 60 * 1000
const UPDATE_SESSION_ID = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

export async function checkForUpdate(currentVersion: string, signal?: AbortSignal): Promise<UpdateCheckResult> {
  const endpoint = import.meta.env.VITE_EDITWEAVE_UPDATE_MANIFEST as string | undefined
  if (!endpoint) return { available: false, configured: false }
  const endpointUrl = assertSafeUpdateUrl(endpoint, '업데이트 매니페스트')
  const response = await fetch(endpointUrl, { cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal })
  if (!response.ok) throw new Error(`업데이트 서버 응답 오류 (${response.status})`)
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (declaredLength > 65_536) throw new Error('업데이트 매니페스트가 허용 크기를 초과했습니다.')
  const body = await response.text()
  if (body.length > 65_536) throw new Error('업데이트 매니페스트가 허용 크기를 초과했습니다.')
  let decoded: unknown
  try { decoded = JSON.parse(body) } catch { throw new Error('업데이트 매니페스트 JSON 형식이 올바르지 않습니다.') }
  const manifest = parseUpdateManifest(decoded)
  const downloadUrl = assertSafeUpdateUrl(manifest.downloadUrl, '업데이트 다운로드')
  const localEndpoint = isLocalUrl(endpointUrl)
  if (!localEndpoint && isLocalUrl(downloadUrl)) throw new Error('운영 업데이트는 localhost 다운로드 주소를 사용할 수 없습니다.')
  await verifyManifestSignature(manifest, localEndpoint)
  await assertCurrentPlatform(manifest.platform)
  return { configured: true, available: compareVersions(manifest.version, currentVersion) > 0, manifest }
}

export async function currentEditWeaveVersion(): Promise<string> {
  if (isTauri()) return getVersion()
  return (import.meta.env.VITE_EDITWEAVE_APP_VERSION as string | undefined) ?? '0.1.0'
}

export async function selectUpdateInstallerDestination(manifest: UpdateManifest): Promise<string | undefined> {
  if (!isTauri()) return undefined
  const fileName = installerFileName(manifest.downloadUrl)
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  const mac = /Macintosh|Mac OS X/i.test(navigator.userAgent)
  const allowed = mac ? ['dmg', 'pkg'] : ['exe', 'msi']
  if (!allowed.includes(extension)) throw new Error(`현재 운영체제용 업데이트 설치 파일이 아닙니다: .${extension || 'unknown'}`)
  return await save({ title: `EditWeave ${manifest.version} 업데이트 저장`, defaultPath: fileName, filters: [{ name: 'EditWeave Installer', extensions: [extension] }] }) ?? undefined
}

export async function downloadVerifiedUpdateInstaller(manifest: UpdateManifest, destinationPath: string): Promise<DownloadedUpdateInstaller> {
  if (!isTauri()) throw new Error('설치 파일 직접 다운로드는 데스크톱 앱에서만 사용할 수 있습니다.')
  const publicKey = (import.meta.env.VITE_EDITWEAVE_UPDATE_PUBLIC_KEY as string | undefined)?.trim()
  if (!publicKey || !manifest.signature) throw new Error('서명된 운영 업데이트만 앱에서 직접 다운로드할 수 있습니다.')
  return invoke<DownloadedUpdateInstaller>('download_update_installer', { publicKey, signature: manifest.signature, payload: createUpdateSigningPayload(manifest), destinationPath })
}

export async function prepareExistingVerifiedUpdateInstaller(manifest: UpdateManifest, installerPath: string): Promise<DownloadedUpdateInstaller> {
  if (!isTauri()) throw new Error('기존 설치 파일 재검증은 데스크톱 앱에서만 사용할 수 있습니다.')
  const publicKey = (import.meta.env.VITE_EDITWEAVE_UPDATE_PUBLIC_KEY as string | undefined)?.trim()
  if (!publicKey || !manifest.signature) throw new Error('서명된 운영 업데이트만 다시 실행할 수 있습니다.')
  return invoke<DownloadedUpdateInstaller>('prepare_existing_update_installer', { publicKey, signature: manifest.signature, payload: createUpdateSigningPayload(manifest), installerPath })
}

export async function launchVerifiedUpdateInstaller(installer: DownloadedUpdateInstaller): Promise<void> {
  if (!isTauri()) throw new Error('업데이트 설치 실행은 데스크톱 앱에서만 사용할 수 있습니다.')
  await invoke('launch_verified_update', { token: installer.token })
}

export function rememberVerifiedUpdateInstaller(manifest: UpdateManifest, installer: DownloadedUpdateInstaller, previousVersion: string): void {
  if (!manifest.signature) return
  writeStoredUpdate({ schema: 'editweave-update-attempt-v1', targetVersion: manifest.version, previousVersion, platform: manifest.platform, signedPayload: createUpdateSigningPayload(manifest), signature: manifest.signature, installerPath: installer.path, verifiedAt: Date.now() })
}

export function markUpdateInstallerLaunched(): void {
  const stored = readStoredUpdate()
  if (!stored) return
  writeStoredUpdate({ ...stored, launchedAt: Date.now(), launchSessionId: UPDATE_SESSION_ID })
}

export function markUpdateInstallerLaunchFailed(): void {
  const stored = readStoredUpdate()
  if (!stored) return
  writeStoredUpdate({ ...stored, launchedAt: undefined, launchSessionId: undefined })
}

export function matchingStoredUpdateInstaller(manifest: UpdateManifest): StoredUpdateInstaller | undefined {
  const stored = readStoredUpdate()
  if (!stored || !manifest.signature || stored.verifiedAt < Date.now() - UPDATE_ATTEMPT_MAX_AGE) return undefined
  return stored.targetVersion === manifest.version && stored.platform === manifest.platform && stored.signature === manifest.signature && stored.signedPayload === createUpdateSigningPayload(manifest) ? stored : undefined
}

export function reconcileStoredUpdateAttempt(currentVersion: string): UpdateAttemptResult {
  const stored = readStoredUpdate()
  if (!stored) return { status: 'none' }
  if (stored.verifiedAt < Date.now() - UPDATE_ATTEMPT_MAX_AGE) {
    clearStoredUpdateAttempt()
    return { status: 'expired', targetVersion: stored.targetVersion, installerPath: stored.installerPath }
  }
  if (compareVersions(currentVersion, stored.targetVersion) >= 0) {
    clearStoredUpdateAttempt()
    return { status: 'applied', targetVersion: stored.targetVersion }
  }
  if (!stored.launchedAt) return { status: 'ready' }
  if (stored.launchSessionId === UPDATE_SESSION_ID) return { status: 'pending' }
  if (stored.launchedAt > Date.now() - UPDATE_LAUNCH_GRACE) return { status: 'pending' }
  markUpdateInstallerLaunchFailed()
  return { status: 'not-applied', targetVersion: stored.targetVersion, installerPath: stored.installerPath }
}

export function clearStoredUpdateAttempt(): void {
  try { localStorage.removeItem(UPDATE_ATTEMPT_KEY) } catch { /* storage unavailable */ }
}

export function createUpdateSigningPayload(manifest: Pick<UpdateManifest, keyof SigningPayload>): string {
  const payload: SigningPayload = {
    schema: UPDATE_SCHEMA,
    version: manifest.version,
    platform: manifest.platform,
    channel: manifest.channel ?? null,
    publishedAt: manifest.publishedAt ?? null,
    minimumSupportedVersion: manifest.minimumSupportedVersion ?? null,
    notes: manifest.notes ?? null,
    downloadUrl: manifest.downloadUrl,
    sha256: manifest.sha256.toLowerCase(),
  }
  return JSON.stringify(payload)
}

function parseUpdateManifest(value: unknown): UpdateManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('업데이트 매니페스트 형식이 올바르지 않습니다.')
  const candidate = value as Record<string, unknown>
  if (candidate.schema !== UPDATE_SCHEMA) throw new Error(`업데이트 매니페스트 schema는 ${UPDATE_SCHEMA}이어야 합니다.`)
  if (typeof candidate.version !== 'string' || !VERSION_PATTERN.test(candidate.version)) throw new Error('업데이트 버전 형식이 올바르지 않습니다.')
  const platform = optionalString(candidate.platform, 'platform')
  if (!platform || !['windows-x86_64', 'windows-aarch64', 'macos-x86_64', 'macos-aarch64', 'macos-universal'].includes(platform)) throw new Error('업데이트 platform 형식이 올바르지 않습니다.')
  if (typeof candidate.downloadUrl !== 'string' || !candidate.downloadUrl.trim()) throw new Error('업데이트 다운로드 주소가 없습니다.')
  const channel = optionalString(candidate.channel, 'channel')
  if (channel && channel !== 'stable' && channel !== 'beta') throw new Error('업데이트 channel은 stable 또는 beta여야 합니다.')
  const publishedAt = optionalString(candidate.publishedAt, 'publishedAt')
  if (publishedAt && !Number.isFinite(Date.parse(publishedAt))) throw new Error('업데이트 publishedAt 형식이 올바르지 않습니다.')
  const minimumSupportedVersion = optionalString(candidate.minimumSupportedVersion, 'minimumSupportedVersion')
  if (minimumSupportedVersion && !VERSION_PATTERN.test(minimumSupportedVersion)) throw new Error('최소 지원 버전 형식이 올바르지 않습니다.')
  const notes = optionalString(candidate.notes, 'notes')
  if (notes && notes.length > 8_000) throw new Error('업데이트 안내가 허용 길이를 초과했습니다.')
  const sha256 = optionalString(candidate.sha256, 'sha256')
  if (!sha256 || !/^[a-f0-9]{64}$/i.test(sha256)) throw new Error('업데이트 매니페스트에는 64자리 SHA-256이 필요합니다.')
  const keyId = optionalString(candidate.keyId, 'keyId')
  if (keyId && !/^[a-zA-Z0-9._-]{4,80}$/.test(keyId)) throw new Error('업데이트 서명 keyId 형식이 올바르지 않습니다.')
  const signature = optionalString(candidate.signature, 'signature')
  if (signature && signature.length > 120) throw new Error('업데이트 서명 길이가 올바르지 않습니다.')
  return {
    schema: UPDATE_SCHEMA,
    version: candidate.version,
    platform: platform as UpdateManifest['platform'],
    downloadUrl: candidate.downloadUrl,
    channel: channel as UpdateManifest['channel'],
    publishedAt,
    minimumSupportedVersion,
    notes,
    sha256: sha256.toLowerCase(),
    keyId,
    signature,
  }
}

function readStoredUpdate(): StoredUpdateInstaller | undefined {
  try {
    const raw = localStorage.getItem(UPDATE_ATTEMPT_KEY)
    if (!raw) return undefined
    const value = JSON.parse(raw) as Partial<StoredUpdateInstaller>
    if (value.schema !== 'editweave-update-attempt-v1' || typeof value.targetVersion !== 'string' || !VERSION_PATTERN.test(value.targetVersion) || typeof value.previousVersion !== 'string' || !VERSION_PATTERN.test(value.previousVersion) || typeof value.platform !== 'string' || !['windows-x86_64', 'windows-aarch64', 'macos-x86_64', 'macos-aarch64', 'macos-universal'].includes(value.platform) || typeof value.signedPayload !== 'string' || value.signedPayload.length > 16_384 || typeof value.signature !== 'string' || value.signature.length > 120 || typeof value.installerPath !== 'string' || value.installerPath.length > 1_024 || typeof value.verifiedAt !== 'number' || !Number.isFinite(value.verifiedAt)) return undefined
    return value as StoredUpdateInstaller
  } catch { return undefined }
}

function writeStoredUpdate(value: StoredUpdateInstaller): void {
  try { localStorage.setItem(UPDATE_ATTEMPT_KEY, JSON.stringify(value)) } catch { /* storage unavailable */ }
}

async function verifyManifestSignature(manifest: UpdateManifest, localEndpoint: boolean): Promise<void> {
  const encodedPublicKey = (import.meta.env.VITE_EDITWEAVE_UPDATE_PUBLIC_KEY as string | undefined)?.trim()
  const expectedKeyId = (import.meta.env.VITE_EDITWEAVE_UPDATE_KEY_ID as string | undefined)?.trim()
  if (!encodedPublicKey) {
    if (localEndpoint) return
    throw new Error('운영 업데이트 공개 키가 설정되지 않았습니다.')
  }
  if (encodedPublicKey.length > 100) throw new Error('업데이트 공개 키 길이가 올바르지 않습니다.')
  if (!manifest.signature || !manifest.keyId) throw new Error('업데이트 매니페스트 서명이 없습니다.')
  if (expectedKeyId && manifest.keyId !== expectedKeyId) throw new Error('업데이트 매니페스트 서명 키가 허용된 키와 다릅니다.')
  const publicKeyBytes = decodeBase64(encodedPublicKey, '업데이트 공개 키')
  const signatureBytes = decodeBase64(manifest.signature, '업데이트 서명')
  if (publicKeyBytes.byteLength !== 32) throw new Error('Ed25519 업데이트 공개 키는 32바이트여야 합니다.')
  if (signatureBytes.byteLength !== 64) throw new Error('Ed25519 업데이트 서명은 64바이트여야 합니다.')
  const payload = createUpdateSigningPayload(manifest)
  if (isTauri()) {
    const verified = await invoke<boolean>('verify_update_signature', { publicKey: encodedPublicKey, signature: manifest.signature, payload })
    if (!verified) throw new Error('업데이트 매니페스트 서명이 올바르지 않습니다.')
    return
  }
  if (!globalThis.crypto?.subtle) throw new Error('이 환경에서는 업데이트 서명 검증을 사용할 수 없습니다.')
  let key: CryptoKey
  try {
    key = await globalThis.crypto.subtle.importKey('raw', publicKeyBytes, { name: 'Ed25519' }, false, ['verify'])
  } catch {
    throw new Error('이 WebView는 Ed25519 업데이트 서명 검증을 지원하지 않습니다.')
  }
  const encodedPayload = new TextEncoder().encode(payload)
  const verified = await globalThis.crypto.subtle.verify({ name: 'Ed25519' }, key, signatureBytes, encodedPayload)
  if (!verified) throw new Error('업데이트 매니페스트 서명이 올바르지 않습니다.')
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`업데이트 ${label} 형식이 올바르지 않습니다.`)
  return value
}

function decodeBase64(value: string, label: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw new Error(`${label} Base64 형식이 올바르지 않습니다.`)
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
  } catch {
    throw new Error(`${label} Base64 형식이 올바르지 않습니다.`)
  }
}

function assertSafeUpdateUrl(value: string, label: string): URL {
  let url: URL
  try { url = new URL(value, window.location.href) } catch { throw new Error(`${label} 주소 형식이 올바르지 않습니다.`) }
  if (url.username || url.password) throw new Error(`${label} 주소에는 사용자 정보를 포함할 수 없습니다.`)
  if (url.protocol !== 'https:' && !isLocalUrl(url)) throw new Error(`${label} 주소는 HTTPS여야 합니다.`)
  return url
}

function isLocalUrl(url: URL): boolean {
  return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
}

function installerFileName(downloadUrl: string): string {
  const pathName = new URL(downloadUrl).pathname
  const encoded = pathName.split('/').filter(Boolean).pop() ?? 'EditWeave-update'
  let candidate: string
  try { candidate = decodeURIComponent(encoded) } catch { candidate = 'EditWeave-update' }
  const safe = candidate.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 180)
  return safe || 'EditWeave-update'
}

async function assertCurrentPlatform(target: UpdateManifest['platform']): Promise<void> {
  if (!isTauri()) return
  const environment = await invoke<{ platform: string; arch: string }>('app_environment')
  const current = `${environment.platform}-${environment.arch}`
  const compatible = target === current || (target === 'macos-universal' && environment.platform === 'macos')
  if (!compatible) throw new Error(`이 업데이트는 현재 앱 대상(${current})과 맞지 않습니다: ${target}`)
}

function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < 3; index++) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index]
  }
  if (!a.prerelease.length && b.prerelease.length) return 1
  if (a.prerelease.length && !b.prerelease.length) return -1
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber
    if (leftNumber !== undefined) return -1
    if (rightNumber !== undefined) return 1
    return leftPart.localeCompare(rightPart)
  }
  return 0
}

function parseVersion(value: string): { core: [number, number, number]; prerelease: string[] } {
  const [coreValue, prereleaseValue = ''] = value.replace(/^v/, '').split('-', 2)
  const coreParts = coreValue.split('.').slice(0, 3).map((part) => Number(part) || 0)
  return { core: [coreParts[0] ?? 0, coreParts[1] ?? 0, coreParts[2] ?? 0], prerelease: prereleaseValue ? prereleaseValue.split('.') : [] }
}
