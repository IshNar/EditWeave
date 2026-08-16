import { chmod, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const binaryDirectory = resolve(workspace, 'src-tauri', 'resources', 'bin')
const licenseDirectory = resolve(workspace, 'src-tauri', 'resources', 'licenses')

const ffmpegModule = await import('ffmpeg-static')
const ffprobeModule = await import('ffprobe-static')
const ffmpegSource = ffmpegModule.default
const ffprobeSource = (ffprobeModule.default ?? ffprobeModule).path

if (typeof ffmpegSource !== 'string') throw new Error('ffmpeg-static 실행 파일 경로를 찾지 못했습니다.')
if (typeof ffprobeSource !== 'string') throw new Error('ffprobe-static 실행 파일 경로를 찾지 못했습니다.')

await Promise.all([stat(ffmpegSource), stat(ffprobeSource)])
await Promise.all([mkdir(binaryDirectory, { recursive: true }), mkdir(licenseDirectory, { recursive: true })])

const extension = process.platform === 'win32' ? '.exe' : ''
const ffmpegTarget = resolve(binaryDirectory, `ffmpeg${extension}`)
const ffprobeTarget = resolve(binaryDirectory, `ffprobe${extension}`)
await Promise.all([
  copyFile(ffmpegSource, ffmpegTarget),
  copyFile(ffprobeSource, ffprobeTarget),
  copyLicense('ffmpeg-static', 'ffmpeg-static-LICENSE.txt'),
  copyLicense('ffprobe-static', 'ffprobe-static-LICENSE.txt'),
])
if (process.platform !== 'win32') await Promise.all([chmod(ffmpegTarget, 0o755), chmod(ffprobeTarget, 0o755)])

const manifest = {
  schema: 'cutline-codec-toolchain-v1',
  platform: process.platform,
  arch: process.arch,
  ffmpeg: basename(ffmpegTarget),
  ffprobe: basename(ffprobeTarget),
}
await writeFile(resolve(binaryDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`Cutline codec toolchain prepared: ${ffmpegTarget}, ${ffprobeTarget}`)

async function copyLicense(packageName, targetName) {
  const packageJsonPath = fileURLToPath(import.meta.resolve(`${packageName}/package.json`))
  const packageDirectory = dirname(packageJsonPath)
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  const licenseName = typeof packageJson.license === 'string' ? packageJson.license : 'See package license'
  const licensePath = resolve(packageDirectory, 'LICENSE')
  try {
    await copyFile(licensePath, resolve(licenseDirectory, targetName))
  } catch {
    await writeFile(resolve(licenseDirectory, targetName), `${packageName}: ${licenseName}\n`, 'utf8')
  }
}
