import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sha256, stableStringify, validateSignedPackArtifact } from './creator-pack-catalog-lib.mjs'

const [inputArgument, privateKeyArgument, keyIdArgument, outputArgument] = process.argv.slice(2)
if (!inputArgument || !privateKeyArgument) {
  console.error('Usage: node release/sign-creator-pack.mjs <pack.json> <ed25519-private-key.pem> [key-id] [output.json]')
  process.exitCode = 1
} else {
  const input = resolve(inputArgument)
  const privateKey = createPrivateKey(await readFile(resolve(privateKeyArgument), 'utf8'))
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Creator Pack 개인 키는 Ed25519여야 합니다.')
  const der = createPublicKey(privateKey).export({ format: 'der', type: 'spki' })
  const publicKey = der.subarray(der.length - 32)
  const keyId = keyIdArgument || `creator-${createHash('sha256').update(publicKey).digest('hex').slice(0, 16)}`
  if (!/^[A-Za-z0-9._-]{4,120}$/.test(keyId)) throw new Error('key-id는 영문·숫자·점·밑줄·빼기 4~120자여야 합니다.')
  let pack
  try { pack = JSON.parse(await readFile(input, 'utf8')) } catch { throw new Error('Creator Pack JSON 형식이 올바르지 않습니다.') }
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw new Error('Creator Pack JSON 객체가 필요합니다.')
  const canonical = structuredClone(pack)
  delete canonical.integrity; delete canonical.signature; delete canonical.verification
  const digest = sha256(Buffer.from(stableStringify(canonical)))
  const signature = sign(null, Buffer.from(`cutline-creator-pack-v2\n${digest}`), privateKey).toString('base64')
  const signed = { ...canonical, integrity: { algorithm: 'SHA-256', digest }, signature: { algorithm: 'Ed25519', keyId, publicKey: publicKey.toString('base64'), value: signature } }
  validateSignedPackArtifact(Buffer.from(JSON.stringify(signed)), input)
  const defaultOutput = input.endsWith('.cutline-pack.json') ? input.replace(/\.cutline-pack\.json$/, '.signed.cutline-pack.json') : `${input}.signed.cutline-pack.json`
  const output = resolve(outputArgument || defaultOutput)
  await writeFile(output, `${JSON.stringify(signed, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(`Signed Creator Pack: ${output}`)
  console.log(`Publisher keyId: ${keyId}`)
  console.log(`Publisher key fingerprint: ${sha256(publicKey)}`)
}
