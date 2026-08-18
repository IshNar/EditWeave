import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { CATALOG_SCHEMA, strictHttpsOrigin, validateRevocation, validateSignedPackArtifact } from './creator-pack-catalog-lib.mjs'

const [packDirectoryArgument, originArgument, authorityArgument, revocationsArgument, outputArgument] = process.argv.slice(2)
if (!packDirectoryArgument || !originArgument || !authorityArgument) {
  console.error('Usage: node release/create-creator-pack-catalog.mjs <pack-directory> <https-origin> <authority> [revocations.json|-] [output.json]')
  process.exitCode = 1
} else {
  const directory = resolve(packDirectoryArgument)
  const origin = strictHttpsOrigin(originArgument)
  if (!authorityArgument.trim() || authorityArgument.length > 120) throw new Error('authority는 1~120자여야 합니다.')
  const directoryInfo = await stat(directory)
  if (!directoryInfo.isDirectory()) throw new Error('pack-directory가 디렉터리가 아닙니다.')
  const files = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.editweave-pack.json')).sort((left, right) => left.name.localeCompare(right.name))
  if (!files.length || files.length > 1_000) throw new Error('Pack artifact는 1~1,000개여야 합니다.')
  const entries = []
  for (const file of files) {
    if (!/^[A-Za-z0-9._+-]{1,180}$/.test(file.name)) throw new Error(`안전하지 않은 Pack 파일명입니다: ${file.name}`)
    const raw = await readFile(resolve(directory, file.name))
    const verified = validateSignedPackArtifact(raw, file.name)
    if (!file.name.includes(verified.pack.version)) throw new Error(`immutable 캐시를 위해 파일명에 버전 ${verified.pack.version}이 필요합니다: ${file.name}`)
    entries.push({
      packId: verified.pack.id, name: verified.pack.name, version: verified.pack.version, publisher: verified.pack.publisher,
      categories: verified.categories, downloadUrl: `${origin}/editweave/packs/${encodeURIComponent(file.name)}`, artifactSha256: verified.artifactSha256,
      publisherKeyFingerprint: verified.publisherKeyFingerprint, minimumApiVersion: verified.pack.compatibility.minimumApiVersion,
      ...(verified.pack.compatibility.maximumApiVersion ? { maximumApiVersion: verified.pack.compatibility.maximumApiVersion } : {}), publishedAt: verified.pack.createdAt,
    })
  }
  if (new Set(entries.map((entry) => `${entry.packId}@${entry.version}`)).size !== entries.length) throw new Error('같은 Pack ID와 버전이 중복됐습니다.')
  let revocations = []
  if (revocationsArgument && revocationsArgument !== '-') {
    const decoded = JSON.parse(await readFile(resolve(revocationsArgument), 'utf8'))
    if (!Array.isArray(decoded) || decoded.length > 1_000) throw new Error('revocations 파일은 최대 1,000개 배열이어야 합니다.')
    revocations = decoded.map(validateRevocation)
  }
  const output = resolve(outputArgument || 'release/creator-pack-channel/catalog.unsigned.json')
  const catalog = { schema: CATALOG_SCHEMA, generatedAt: new Date().toISOString(), authority: authorityArgument.trim(), entries, revocations }
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(catalog, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(`Created unsigned Creator Pack catalog: ${output}`)
  console.log(`Artifacts remain immutable under: ${directory}`)
  console.log(`Next: node release/sign-creator-pack-catalog.mjs "${output}" <ed25519-private-key.pem> [signed-output.json]`)
}
