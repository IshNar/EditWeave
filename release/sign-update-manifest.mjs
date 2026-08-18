import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [inputArgument, privateKeyArgument, outputArgument] = process.argv.slice(2)
if (!inputArgument || !privateKeyArgument) {
  console.error('Usage: node release/sign-update-manifest.mjs <manifest.json> <ed25519-private-key.pem> [output.json]')
  process.exitCode = 1
} else {
  const inputPath = resolve(inputArgument)
  const privateKeyPath = resolve(privateKeyArgument)
  const outputPath = resolve(outputArgument ?? inputArgument)
  const manifest = JSON.parse(await readFile(inputPath, 'utf8'))
  validateManifest(manifest)
  const privateKey = createPrivateKey(await readFile(privateKeyPath, 'utf8'))
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('업데이트 개인 키는 Ed25519여야 합니다.')
  const publicKeyDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' })
  const publicKey = publicKeyDer.subarray(publicKeyDer.length - 32)
  const keyId = manifest.keyId || `ed25519-${createHash('sha256').update(publicKey).digest('hex').slice(0, 16)}`
  const payload = signingPayload(manifest)
  const signature = sign(null, Buffer.from(payload), privateKey).toString('base64')
  const signed = { ...manifest, schema: 'editweave-update-v1', keyId, signature }
  await writeFile(outputPath, `${JSON.stringify(signed, null, 2)}\n`, 'utf8')
  console.log(`Signed: ${outputPath}`)
  console.log(`VITE_EDITWEAVE_UPDATE_KEY_ID=${keyId}`)
  console.log(`VITE_EDITWEAVE_UPDATE_PUBLIC_KEY=${publicKey.toString('base64')}`)
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('매니페스트 JSON 객체가 필요합니다.')
  if (manifest.schema !== undefined && manifest.schema !== 'editweave-update-v1') throw new Error('schema는 editweave-update-v1이어야 합니다.')
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) throw new Error('version은 SemVer 형식이어야 합니다.')
  if (!['windows-x86_64', 'windows-aarch64', 'macos-x86_64', 'macos-aarch64', 'macos-universal'].includes(manifest.platform)) throw new Error('platform 형식이 올바르지 않습니다.')
  if (typeof manifest.downloadUrl !== 'string' || !manifest.downloadUrl.startsWith('https://')) throw new Error('downloadUrl은 HTTPS여야 합니다.')
  if (typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(manifest.sha256)) throw new Error('sha256은 필수 64자리 16진수여야 합니다.')
  if (manifest.channel !== undefined && manifest.channel !== 'stable' && manifest.channel !== 'beta') throw new Error('channel은 stable 또는 beta여야 합니다.')
  if (manifest.keyId !== undefined && !/^[a-zA-Z0-9._-]{4,80}$/.test(manifest.keyId)) throw new Error('keyId 형식이 올바르지 않습니다.')
  if (manifest.publishedAt !== undefined && (typeof manifest.publishedAt !== 'string' || !Number.isFinite(Date.parse(manifest.publishedAt)))) throw new Error('publishedAt 형식이 올바르지 않습니다.')
  if (manifest.minimumSupportedVersion !== undefined && (typeof manifest.minimumSupportedVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.minimumSupportedVersion))) throw new Error('minimumSupportedVersion 형식이 올바르지 않습니다.')
  if (manifest.notes !== undefined && (typeof manifest.notes !== 'string' || manifest.notes.length > 8_000)) throw new Error('notes 형식 또는 길이가 올바르지 않습니다.')
}

function signingPayload(manifest) {
  return JSON.stringify({
    schema: 'editweave-update-v1',
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
