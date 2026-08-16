import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const rawVersion = process.argv[2]?.trim() || process.env.RELEASE_VERSION?.trim() || ''
const version = rawVersion.replace(/^v/, '')
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('Usage: node release/set-version.mjs <semver>')
}

const packagePath = resolve('package.json')
const tauriPath = resolve('src-tauri', 'tauri.conf.json')
const cargoPath = resolve('src-tauri', 'Cargo.toml')
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
const tauriJson = JSON.parse(await readFile(tauriPath, 'utf8'))
packageJson.version = version
tauriJson.version = version

const cargo = await readFile(cargoPath, 'utf8')
const packageSection = /(^\[package\]\r?\n[\s\S]*?^version\s*=\s*")[^"]+("\s*$)/m
if (!packageSection.test(cargo)) throw new Error('Cargo.toml [package] version을 찾지 못했습니다.')
const nextCargo = cargo.replace(packageSection, `$1${version}$2`)

await Promise.all([
  writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8'),
  writeFile(tauriPath, `${JSON.stringify(tauriJson, null, 2)}\n`, 'utf8'),
  writeFile(cargoPath, nextCargo, 'utf8'),
])

if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`, 'utf8')
console.log(`Cutline release version synchronized: ${version}`)
