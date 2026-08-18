import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { CATALOG_SCHEMA, catalogSigningPayload, validateCatalog } from './creator-pack-catalog-lib.mjs'

const [inputArgument, privateKeyArgument, outputArgument] = process.argv.slice(2)
if (!inputArgument || !privateKeyArgument) {
  console.error('Usage: node release/sign-creator-pack-catalog.mjs <catalog.json> <ed25519-private-key.pem> [output.json]')
  process.exitCode = 1
} else {
  const input = resolve(inputArgument)
  const output = resolve(outputArgument || inputArgument)
  const catalog = validateCatalog(JSON.parse(await readFile(input, 'utf8')))
  const privateKey = createPrivateKey(await readFile(resolve(privateKeyArgument), 'utf8'))
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Creator Pack catalog 개인 키는 Ed25519여야 합니다.')
  const der = createPublicKey(privateKey).export({ format: 'der', type: 'spki' })
  const publicKey = der.subarray(der.length - 32)
  const keyId = catalog.keyId || `creator-catalog-${createHash('sha256').update(publicKey).digest('hex').slice(0, 16)}`
  const unsigned = { ...catalog, schema: CATALOG_SCHEMA, keyId }
  delete unsigned.signature
  const signature = sign(null, Buffer.from(catalogSigningPayload(unsigned)), privateKey).toString('base64')
  await writeFile(output, `${JSON.stringify({ ...unsigned, signature }, null, 2)}\n`, 'utf8')
  console.log(`Signed Creator Pack catalog: ${output}`)
  console.log(`VITE_EDITWEAVE_CREATOR_CATALOG_KEY_ID=${keyId}`)
  console.log(`VITE_EDITWEAVE_CREATOR_CATALOG_PUBLIC_KEY=${publicKey.toString('base64')}`)
}
