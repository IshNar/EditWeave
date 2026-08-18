import { generateKeyPairSync, sign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
import { sha256, stableStringify, validateSignedPackArtifact } from '../../release/creator-pack-catalog-lib.mjs'
import { createCreatorPackServer, loadCreatorPackCatalog } from './server.mjs'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('catalog CLI, offline signature, server validation and range delivery form one verified path', async (context) => {
  const fixture = await createFixture(context)
  const unsigned = resolve(fixture.root, 'catalog.unsigned.json')
  const signedCatalog = resolve(fixture.root, 'catalog.json')
  execFileSync(process.execPath, [resolve(workspace, 'release/create-creator-pack-catalog.mjs'), fixture.packs, fixture.origin, 'Test Catalog', '-', unsigned], { cwd: workspace })
  execFileSync(process.execPath, [resolve(workspace, 'release/sign-creator-pack-catalog.mjs'), unsigned, fixture.catalogPrivateKeyFile, signedCatalog], { cwd: workspace })
  const decoded = JSON.parse(await readFile(signedCatalog, 'utf8'))
  const snapshot = await loadCreatorPackCatalog({ channelDirectory: fixture.root, publicOrigin: fixture.origin, expectedKeyId: decoded.keyId, publicKey: fixture.catalogPublicKey })
  assert.equal(snapshot.catalog.entries.length, 1)
  assert.equal(snapshot.artifacts.size, 1)

  const controller = createCreatorPackServer({ snapshot, allowedOrigins: new Set(), maxActiveDownloads: 4, maxDownloadsPerIp: 2 })
  await new Promise((resolveListen) => controller.server.listen(0, '127.0.0.1', resolveListen))
  context.after(() => new Promise((resolveClose) => controller.server.close(resolveClose)))
  const address = controller.server.address()
  assert.ok(address && typeof address === 'object')
  const localOrigin = `http://127.0.0.1:${address.port}`
  const health = await fetch(`${localOrigin}/healthz`).then((response) => response.json())
  assert.deepEqual(health, { status: 'ok', service: 'editweave-creator-pack-server', entries: 1, revocations: 0, artifacts: 1 })
  const catalogResponse = await fetch(`${localOrigin}/editweave/catalog.json`)
  assert.equal(catalogResponse.status, 200)
  assert.equal(catalogResponse.headers.get('cache-control'), 'no-store, no-cache, must-revalidate')
  const entry = snapshot.catalog.entries[0]
  const pathname = new URL(entry.downloadUrl).pathname
  const range = await fetch(`${localOrigin}${pathname}`, { headers: { range: 'bytes=0-31' } })
  assert.equal(range.status, 206)
  assert.equal((await range.arrayBuffer()).byteLength, 32)
  assert.equal(range.headers.get('x-content-sha256'), entry.artifactSha256)
})

test('server startup rejects a Pack changed after catalog signing', async (context) => {
  const fixture = await createFixture(context)
  const unsigned = resolve(fixture.root, 'catalog.unsigned.json')
  const signedCatalog = resolve(fixture.root, 'catalog.json')
  execFileSync(process.execPath, [resolve(workspace, 'release/create-creator-pack-catalog.mjs'), fixture.packs, fixture.origin, 'Test Catalog', '-', unsigned], { cwd: workspace })
  execFileSync(process.execPath, [resolve(workspace, 'release/sign-creator-pack-catalog.mjs'), unsigned, fixture.catalogPrivateKeyFile, signedCatalog], { cwd: workspace })
  const decoded = JSON.parse(await readFile(signedCatalog, 'utf8'))
  await writeFile(fixture.packFile, `${await readFile(fixture.packFile, 'utf8')} `)
  await assert.rejects(loadCreatorPackCatalog({ channelDirectory: fixture.root, publicOrigin: fixture.origin, expectedKeyId: decoded.keyId, publicKey: fixture.catalogPublicKey }), /does not match catalog/)
})

test('publisher CLI signs an exported declarative Pack with a persistent Ed25519 identity', async (context) => {
  const fixture = await createFixture(context)
  const exported = JSON.parse(await readFile(fixture.packFile, 'utf8'))
  delete exported.integrity
  delete exported.signature
  const input = resolve(fixture.root, 'exported.editweave-pack.json')
  const output = resolve(fixture.root, 'publisher-signed-1.0.0.editweave-pack.json')
  await writeFile(input, `${JSON.stringify(exported, null, 2)}\n`)
  execFileSync(process.execPath, [resolve(workspace, 'release/sign-creator-pack.mjs'), input, fixture.publisherPrivateKeyFile, 'test-studio', output], { cwd: workspace })
  const verified = validateSignedPackArtifact(await readFile(output), 'publisher-signed fixture')
  assert.equal(verified.pack.signature.keyId, 'test-studio')
  assert.equal(verified.pack.publisher, 'Test Studio')
})

async function createFixture(context) {
  const root = await mkdtemp(resolve(tmpdir(), 'editweave-creator-pack-server-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const packs = resolve(root, 'packs')
  await mkdir(packs)
  const publisherKeys = generateKeyPairSync('ed25519')
  const publisherPrivateKeyFile = resolve(root, 'publisher-private.pem')
  await writeFile(publisherPrivateKeyFile, publisherKeys.privateKey.export({ format: 'pem', type: 'pkcs8' }))
  const publisherPublicDer = publisherKeys.publicKey.export({ format: 'der', type: 'spki' })
  const publisherPublicRaw = publisherPublicDer.subarray(publisherPublicDer.length - 32)
  const pack = {
    schema: 'editweave-creator-pack-v2', apiVersion: '1.0.0', compatibility: { minimumApiVersion: '1.0.0' }, id: 'test-pack', name: 'Test Titles', version: '1.0.0', publisher: 'Test Studio', createdAt: '2026-08-15T00:00:00.000Z',
    security: { executableCode: false, networkAccess: false, filesystemAccess: false },
    contents: { motionTemplates: [], speedTemplates: [], audioTemplates: [], titleStyleTemplates: [], exportPresets: [], transitionPresets: [] },
  }
  const digest = sha256(Buffer.from(stableStringify(pack)))
  const signature = sign(null, Buffer.from(`editweave-creator-pack-v2\n${digest}`), publisherKeys.privateKey).toString('base64')
  const signedPack = { ...pack, integrity: { algorithm: 'SHA-256', digest }, signature: { algorithm: 'Ed25519', keyId: 'test-studio', publicKey: publisherPublicRaw.toString('base64'), value: signature } }
  const packFile = resolve(packs, 'test-titles-1.0.0.editweave-pack.json')
  await writeFile(packFile, `${JSON.stringify(signedPack, null, 2)}\n`)

  const catalogKeys = generateKeyPairSync('ed25519')
  const catalogPrivateKeyFile = resolve(root, 'catalog-private.pem')
  await writeFile(catalogPrivateKeyFile, catalogKeys.privateKey.export({ format: 'pem', type: 'pkcs8' }))
  return { root, packs, packFile, publisherPrivateKeyFile, catalogPrivateKeyFile, catalogPublicKey: catalogKeys.publicKey, origin: 'https://packs.example.com' }
}
