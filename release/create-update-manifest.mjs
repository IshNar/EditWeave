import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'

const [installerArgument, version, platform, channel, originArgument, minimumSupportedVersion, notesArgument] = process.argv.slice(2)
const platforms = new Set(['windows-x86_64', 'windows-aarch64', 'macos-x86_64', 'macos-aarch64', 'macos-universal'])
if (!installerArgument || !version || !platform || !channel || !originArgument) {
  console.error('Usage: node release/create-update-manifest.mjs <installer> <version> <platform> <stable|beta> <https-origin> [minimum-version] [notes]')
  process.exitCode = 1
} else {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('version은 SemVer 형식이어야 합니다.')
  if (!platforms.has(platform)) throw new Error('지원하지 않는 platform입니다.')
  if (channel !== 'stable' && channel !== 'beta') throw new Error('channel은 stable 또는 beta여야 합니다.')
  if (minimumSupportedVersion && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(minimumSupportedVersion)) throw new Error('minimum version은 SemVer 형식이어야 합니다.')
  if (notesArgument && notesArgument.length > 8_000) throw new Error('notes는 8,000자를 넘을 수 없습니다.')
  const origin = new URL(originArgument)
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('origin은 경로·자격 증명이 없는 HTTPS origin이어야 합니다.')
  const installer = resolve(installerArgument)
  const details = await stat(installer)
  if (!details.isFile() || details.size < 1 || details.size > 2 * 1024 * 1024 * 1024) throw new Error('설치 파일 크기는 1바이트 이상 2GB 이하여야 합니다.')
  const fileName = basename(installer)
  if (!/^[A-Za-z0-9._+-]{1,180}$/.test(fileName)) throw new Error('설치 파일명은 영문, 숫자, 점, 밑줄, 더하기, 빼기만 사용할 수 있습니다.')
  if (!fileName.includes(version)) throw new Error('immutable 캐시 안전을 위해 설치 파일명에 전체 version을 포함해야 합니다.')
  const extension = extname(fileName).toLowerCase()
  const allowedExtensions = platform.startsWith('windows-') ? new Set(['.exe', '.msi']) : new Set(['.dmg', '.pkg'])
  if (!allowedExtensions.has(extension)) throw new Error(`설치 파일 확장자 ${extension || '(없음)'}가 ${platform}과 맞지 않습니다.`)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(installer)) hash.update(chunk)
  const outputDirectory = resolve('release', 'update-channel', 'manifests', channel)
  const output = resolve(outputDirectory, `${platform}.json`)
  await mkdir(outputDirectory, { recursive: true })
  const manifest = {
    schema: 'editweave-update-v1',
    version,
    platform,
    channel,
    publishedAt: new Date().toISOString(),
    ...(minimumSupportedVersion ? { minimumSupportedVersion } : {}),
    ...(notesArgument ? { notes: notesArgument } : {}),
    downloadUrl: `${origin.origin}/editweave/artifacts/${encodeURIComponent(fileName)}`,
    sha256: hash.digest('hex'),
  }
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(`Created unsigned manifest: ${output}`)
  console.log(`Copy installer without changing bytes: release/update-channel/artifacts/${fileName}`)
  console.log(`Next: node release/sign-update-manifest.mjs "${output}" <ed25519-private-key.pem>`)
}
