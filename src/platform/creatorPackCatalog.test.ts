import { beforeEach, describe, expect, it } from 'vitest'
import catalogSchema from '../../schemas/editweave-creator-catalog-v1.schema.json'
import {
  createCreatorPackCatalogSigningPayload,
  downloadCatalogCreatorPack,
  findInstalledPackRevocations,
  parseCreatorPackCatalog,
  searchCreatorPackCatalog,
  type CreatorPackCatalog,
  type CreatorPackCatalogEntry,
} from './creatorPackCatalog'
import { createCreatorPack, installCreatorPack, parseCreatorPack, readInstalledCreatorPacks, setCreatorPackPublisherTrust, signCreatorPack } from './creatorPacks'

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

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((byte) => byte.toString(16).padStart(2, '0')).join('')

async function signedPackFixture(version = '1.0.0') {
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
  const draft = createCreatorPack('Catalog Titles', 'Example Studio')
  draft.id = 'catalog-pack'
  draft.version = version
  const signed = await signCreatorPack(draft, keys.privateKey, keys.publicKey, 'studio-main')
  const raw = JSON.stringify(signed)
  const parsed = await parseCreatorPack(raw)
  const entry: CreatorPackCatalogEntry = {
    packId: parsed.id, name: parsed.name, version: parsed.version, publisher: parsed.publisher, description: 'Titles for interviews', categories: ['title'],
    downloadUrl: `https://packs.example.com/${version}.json`, artifactSha256: await sha256(raw), publisherKeyFingerprint: parsed.verification!.keyFingerprint!,
    minimumApiVersion: '1.0.0', publishedAt: '2026-08-15T00:00:00.000Z',
  }
  return { keys, raw, parsed, entry }
}

async function signedCatalog(entry: CreatorPackCatalogEntry, revocations: CreatorPackCatalog['revocations'] = []) {
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
  const publicKey = base64(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)))
  const draft = { schema: 'editweave-creator-catalog-v1' as const, generatedAt: '2026-08-15T01:00:00.000Z', authority: 'EditWeave Catalog', keyId: 'catalog-2026', entries: [entry], revocations }
  const signature = base64(new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, new TextEncoder().encode(createCreatorPackCatalogSigningPayload(draft)))))
  return { raw: JSON.stringify({ ...draft, signature }), publicKey }
}

describe('Creator Pack catalog contract', () => {
  it('keeps the published schema aligned and rejects unsafe local entries', async () => {
    expect(catalogSchema.properties.schema.const).toBe('editweave-creator-catalog-v1')
    const fixture = await signedPackFixture()
    const local = { schema: 'editweave-creator-catalog-v1', generatedAt: '2026-08-15T00:00:00.000Z', authority: 'Local', entries: [fixture.entry], revocations: [] }
    await expect(parseCreatorPackCatalog(JSON.stringify(local), { allowUnsignedLocal: true })).resolves.toMatchObject({ verification: 'local-untrusted', entries: [{ packId: 'catalog-pack' }] })
    await expect(parseCreatorPackCatalog(JSON.stringify({ ...local, entries: [{ ...fixture.entry, downloadUrl: 'http://packs.example.com/pack.json' }] }), { allowUnsignedLocal: true })).rejects.toThrow(/HTTPS/)
    await expect(parseCreatorPackCatalog(JSON.stringify({ ...local, entries: [{ ...fixture.entry, minimumApiVersion: '2.0.0' }] }), { allowUnsignedLocal: true })).rejects.toThrow(/호환/)
    await expect(parseCreatorPackCatalog(JSON.stringify({ ...local, unexpected: true }), { allowUnsignedLocal: true })).rejects.toThrow(/지원하지 않는 필드/)
    await expect(parseCreatorPackCatalog(JSON.stringify({ ...local, entries: [fixture.entry, fixture.entry] }), { allowUnsignedLocal: true })).rejects.toThrow(/중복/)
  })

  it('verifies a pinned catalog authority signature and rejects tampering', async () => {
    const fixture = await signedPackFixture()
    const catalog = await signedCatalog(fixture.entry)
    await expect(parseCreatorPackCatalog(catalog.raw, { expectedPublicKey: catalog.publicKey, expectedKeyId: 'catalog-2026' })).resolves.toMatchObject({ verification: 'signed', authority: 'EditWeave Catalog' })
    const tampered = JSON.parse(catalog.raw)
    tampered.entries[0].name = 'Tampered'
    await expect(parseCreatorPackCatalog(JSON.stringify(tampered), { expectedPublicKey: catalog.publicKey, expectedKeyId: 'catalog-2026' })).rejects.toThrow(/서명/)
  })

  it('downloads only an artifact and publisher identity matching the catalog', async () => {
    const fixture = await signedPackFixture()
    const fetcher = async () => new Response(fixture.raw, { status: 200, headers: { 'content-type': 'application/json' } })
    await expect(downloadCatalogCreatorPack(fixture.entry, undefined, fetcher as typeof fetch)).resolves.toMatchObject({ id: fixture.entry.packId, version: '1.0.0', verification: { signature: 'verified' } })
    await expect(downloadCatalogCreatorPack({ ...fixture.entry, artifactSha256: '0'.repeat(64) }, undefined, fetcher as typeof fetch)).rejects.toThrow(/SHA-256/)
    await expect(downloadCatalogCreatorPack({ ...fixture.entry, publisherKeyFingerprint: '1'.repeat(64) }, undefined, fetcher as typeof fetch)).rejects.toThrow(/키 지문/)
  })

  it('prioritizes updates and applies revocations only from signed catalogs', async () => {
    const fixture = await signedPackFixture('1.0.0')
    setCreatorPackPublisherTrust(fixture.parsed, 'trusted')
    installCreatorPack(fixture.parsed)
    const updateFixture = await signedPackFixture('1.1.0')
    const revocation = { packId: fixture.parsed.id, artifactSha256: fixture.entry.artifactSha256, reason: 'Broken title metadata', publishedAt: '2026-08-15T02:00:00.000Z' }
    const signed = await signedCatalog(updateFixture.entry, [revocation])
    const catalog = await parseCreatorPackCatalog(signed.raw, { expectedPublicKey: signed.publicKey, expectedKeyId: 'catalog-2026' })
    expect(searchCreatorPackCatalog(catalog, 'interview title', readInstalledCreatorPacks())).toMatchObject([{ status: 'update', installedVersion: '1.0.0' }])
    expect(findInstalledPackRevocations(catalog, readInstalledCreatorPacks())).toMatchObject([{ revocation: { reason: 'Broken title metadata' } }])
    expect(findInstalledPackRevocations({ ...catalog, verification: 'local-untrusted' }, readInstalledCreatorPacks())).toEqual([])

    const recalledCatalog = { ...catalog, revocations: [{ packId: updateFixture.entry.packId, version: updateFixture.entry.version, reason: 'Unsafe update', publishedAt: '2026-08-15T03:00:00.000Z' }] } as CreatorPackCatalog
    expect(searchCreatorPackCatalog(recalledCatalog, '', readInstalledCreatorPacks())[0].status).toBe('revoked')
  })
})
