import { beforeEach, describe, expect, it } from 'vitest'
import creatorPackSchema from '../../schemas/cutline-creator-pack-v2.schema.json'
import { readTitleStyleTemplates, writeTitleStyleTemplates, type TitleStyleTemplate } from './titleStyleTemplates'
import {
  assessCreatorPackInstall,
  assessCreatorPackTrust,
  createCreatorPack,
  installCreatorPack,
  parseCreatorPack,
  readCreatorPackPublisherTrust,
  readInstalledCreatorPacks,
  sealCreatorPack,
  serializeCreatorPack,
  setCreatorPackPublisherTrust,
  signCreatorPack,
  uninstallCreatorPack,
} from './creatorPacks'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true })
  Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true })
})

describe('Creator Pack v2 envelope', () => {
  it('keeps the published JSON Schema aligned with the runtime contract', () => {
    expect(creatorPackSchema.properties.schema.const).toBe('cutline-creator-pack-v2')
    expect(creatorPackSchema.properties.apiVersion.const).toBe('1.0.0')
    expect(creatorPackSchema.properties.security.properties).toMatchObject({ executableCode: { const: false }, networkAccess: { const: false }, filesystemAccess: { const: false } })
    expect(creatorPackSchema.properties.contents.properties.audioTemplates).toEqual({ $ref: '#/$defs/templateList50' })
  })

  it('seals and verifies a versioned declarative pack with SHA-256', async () => {
    const serialized = await serializeCreatorPack(createCreatorPack('Studio Pack', 'Creator'))
    const parsed = await parseCreatorPack(serialized)
    expect(parsed).toMatchObject({ schema: 'cutline-creator-pack-v2', apiVersion: '1.0.0', name: 'Studio Pack', verification: { integrity: 'verified', signature: 'unsigned' } })
    expect(parsed.integrity?.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(parsed.contents.titleStyleTemplates).toEqual([])
  })

  it('rejects tampering, privilege requests, and incompatible API ranges', async () => {
    const raw = await serializeCreatorPack(createCreatorPack('Safe', 'Creator'))
    const tampered = JSON.parse(raw)
    tampered.name = 'Changed after sealing'
    await expect(parseCreatorPack(JSON.stringify(tampered))).rejects.toThrow(/변경/)
    const privileged = JSON.parse(raw)
    privileged.security.networkAccess = true
    await expect(parseCreatorPack(JSON.stringify(privileged))).rejects.toThrow(/권한/)
    const incompatible = await sealCreatorPack({ ...createCreatorPack('Future', 'Creator'), compatibility: { minimumApiVersion: '2.0.0' } })
    await expect(parseCreatorPack(JSON.stringify(incompatible))).rejects.toThrow(/현재 API/)
  })

  it('migrates legacy v1 packs without granting privileges', async () => {
    const legacy = {
      schema: 'cutline-creator-pack-v1', id: 'legacy', name: 'Legacy', version: '1.0.0', publisher: 'Creator', createdAt: '2026-01-01T00:00:00.000Z',
      security: { executableCode: false, networkAccess: false, filesystemAccess: false },
      contents: { motionTemplates: [], speedTemplates: [], audioTemplates: [], exportPresets: [], transitionPresets: [] },
    }
    await expect(parseCreatorPack(JSON.stringify(legacy))).resolves.toMatchObject({ schema: 'cutline-creator-pack-v2', verification: { integrity: 'legacy-unsigned', signature: 'unsigned' } })
  })

  it('verifies an optional Ed25519 publisher signature', async () => {
    const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
    const signed = await signCreatorPack(createCreatorPack('Signed', 'Studio'), keys.privateKey, keys.publicKey, 'studio-2026')
    await expect(parseCreatorPack(JSON.stringify(signed))).resolves.toMatchObject({ verification: { integrity: 'verified', signature: 'verified', keyId: 'studio-2026' } })
    const broken = structuredClone(signed)
    broken.signature!.value = `${broken.signature!.value[0] === 'A' ? 'B' : 'A'}${broken.signature!.value.slice(1)}`
    await expect(parseCreatorPack(JSON.stringify(broken))).rejects.toThrow(/서명/)
  })
})

describe('Creator Pack install lifecycle', () => {
  it('deduplicates install content and preserves user-modified templates on uninstall', async () => {
    const title = { id: 'title', name: 'Creator Lower Third', version: 'cutline-title-style-v1', createdAt: '2026-01-01T00:00:00.000Z', style: { fontSize: 90 } } as unknown as TitleStyleTemplate
    const source = createCreatorPack('Titles', 'Creator')
    source.contents.titleStyleTemplates = [title]
    const pack = await parseCreatorPack(await serializeCreatorPack(source))
    expect(installCreatorPack(pack).titleStyleTemplates).toBe(1)
    expect(installCreatorPack(pack).titleStyleTemplates).toBe(0)
    expect(readInstalledCreatorPacks()).toHaveLength(1)
    const installed = readTitleStyleTemplates()
    writeTitleStyleTemplates([{ ...installed[0], style: { ...installed[0].style, fontSize: 120 } }])
    expect(uninstallCreatorPack(pack.id)).toEqual({ removed: 0, preservedModified: 1 })
    expect(readTitleStyleTemplates()[0].style.fontSize).toBe(120)
    expect(readInstalledCreatorPacks()).toEqual([])
  })

  it('refuses to install an unverified in-memory pack', () => {
    expect(() => installCreatorPack(createCreatorPack('Unsealed', 'Creator'))).toThrow(/무결성/)
  })

  it('requires an explicit trust decision for signed publishers and pins the key fingerprint', async () => {
    const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
    const pack = await parseCreatorPack(JSON.stringify(await signCreatorPack(createCreatorPack('Trusted Pack', 'Studio'), keys.privateKey, keys.publicKey, 'studio-main')))
    expect(assessCreatorPackTrust(pack)).toEqual({ status: 'untrusted' })
    expect(() => installCreatorPack(pack)).toThrow(/신뢰/)
    const record = setCreatorPackPublisherTrust(pack, 'trusted')
    expect(record).toMatchObject({ keyId: 'studio-main', publisher: 'Studio', state: 'trusted', keyFingerprint: pack.verification?.keyFingerprint })
    expect(readCreatorPackPublisherTrust()).toHaveLength(1)
    expect(assessCreatorPackTrust(pack).status).toBe('trusted')
    installCreatorPack(pack)
    expect(readInstalledCreatorPacks()[0].publisherKeyFingerprint).toBe(pack.verification?.keyFingerprint)
  })

  it('blocks denied publishers and detects key replacement under the same keyId', async () => {
    const firstKeys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
    const secondKeys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
    const first = await parseCreatorPack(JSON.stringify(await signCreatorPack(createCreatorPack('First', 'Studio'), firstKeys.privateKey, firstKeys.publicKey, 'studio-main')))
    setCreatorPackPublisherTrust(first, 'blocked')
    expect(assessCreatorPackTrust(first).status).toBe('blocked')
    expect(() => installCreatorPack(first)).toThrow(/차단/)

    const replacement = await parseCreatorPack(JSON.stringify(await signCreatorPack(createCreatorPack('Replacement', 'Studio'), secondKeys.privateKey, secondKeys.publicKey, 'studio-main')))
    expect(assessCreatorPackTrust(replacement)).toMatchObject({ status: 'key-changed', record: { keyId: 'studio-main' } })
    expect(() => installCreatorPack(replacement)).toThrow(/다른 공개키/)
  })

  it('rejects an update signed by a different trusted publisher key', async () => {
    const firstKeys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
    const nextKeys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
    const draft = createCreatorPack('Pinned Pack', 'Studio')
    const first = await parseCreatorPack(JSON.stringify(await signCreatorPack(draft, firstKeys.privateKey, firstKeys.publicKey, 'studio-2026')))
    setCreatorPackPublisherTrust(first, 'trusted')
    installCreatorPack(first)

    const next = await parseCreatorPack(JSON.stringify(await signCreatorPack({ ...draft, version: '1.1.0' }, nextKeys.privateKey, nextKeys.publicKey, 'studio-2027')))
    setCreatorPackPublisherTrust(next, 'trusted')
    expect(assessCreatorPackTrust(next).status).toBe('trusted')
    expect(assessCreatorPackInstall(next)).toEqual({ status: 'publisher-key-changed', installedVersion: '1.0.0' })
    expect(() => installCreatorPack(next)).toThrow(/키 지문/)
  })

  it('classifies upgrades and blocks silent downgrades', async () => {
    const draft = createCreatorPack('Versioned Pack', 'Creator')
    draft.version = '1.1.0'
    const installedPack = await parseCreatorPack(await serializeCreatorPack(draft))
    expect(assessCreatorPackInstall(installedPack).status).toBe('new')
    installCreatorPack(installedPack)

    const upgrade = await parseCreatorPack(await serializeCreatorPack({ ...draft, version: '1.2.0' }))
    expect(assessCreatorPackInstall(upgrade)).toEqual({ status: 'upgrade', installedVersion: '1.1.0' })
    installCreatorPack(upgrade)
    expect(readInstalledCreatorPacks()[0].version).toBe('1.2.0')

    const downgrade = await parseCreatorPack(await serializeCreatorPack({ ...draft, version: '1.0.0' }))
    expect(assessCreatorPackInstall(downgrade)).toEqual({ status: 'downgrade', installedVersion: '1.2.0' })
    expect(() => installCreatorPack(downgrade)).toThrow(/다운그레이드/)
  })
})
