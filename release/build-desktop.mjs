import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const platforms = new Set(['windows-x86_64', 'windows-aarch64', 'macos-x86_64', 'macos-aarch64', 'macos-universal'])
const platform = required('EDITWEAVE_RELEASE_PLATFORM')
const channel = process.env.EDITWEAVE_RELEASE_CHANNEL?.trim() || 'stable'
if (!platforms.has(platform)) throw new Error(`EDITWEAVE_RELEASE_PLATFORM is invalid: ${platform}`)
if (channel !== 'stable' && channel !== 'beta') throw new Error('EDITWEAVE_RELEASE_CHANNEL must be stable or beta')

const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const version = String(packageJson.version || '')
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('package.json version is not SemVer')

const updateOrigin = process.env.EDITWEAVE_UPDATE_ORIGIN?.trim()
const updatePublicKey = process.env.EDITWEAVE_UPDATE_PUBLIC_KEY?.trim()
const updateKeyId = process.env.EDITWEAVE_UPDATE_KEY_ID?.trim()
let updateManifest = ''
if (updateOrigin || updatePublicKey || updateKeyId) {
  if (!updateOrigin || !updatePublicKey || !updateKeyId) throw new Error('Update origin, public key and key ID must be configured together')
  const origin = new URL(updateOrigin)
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('EDITWEAVE_UPDATE_ORIGIN must be a credential-free HTTPS origin')
  if (!/^[a-zA-Z0-9._-]{4,80}$/.test(updateKeyId)) throw new Error('EDITWEAVE_UPDATE_KEY_ID format is invalid')
  const normalizedKey = updatePublicKey.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalizedKey) || normalizedKey.length > 100) throw new Error('EDITWEAVE_UPDATE_PUBLIC_KEY Base64 format is invalid')
  const keyBytes = Buffer.from(normalizedKey, 'base64')
  if (keyBytes.length !== 32) throw new Error('EDITWEAVE_UPDATE_PUBLIC_KEY must decode to 32 bytes')
  updateManifest = `${origin.origin}/editweave/manifests/${channel}/${platform}.json`
}

const crashEndpoint = process.env.VITE_EDITWEAVE_CRASH_ENDPOINT?.trim()
if (crashEndpoint) {
  const endpoint = new URL(crashEndpoint)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('VITE_EDITWEAVE_CRASH_ENDPOINT must be credential-free HTTPS without query or hash')
}

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const tauriConfig = process.env.EDITWEAVE_TAURI_CONFIG?.trim()
const buildArgs = ['exec', 'tauri', 'build']
if (tauriConfig) buildArgs.push('--config', tauriConfig)
const child = spawn(command, buildArgs, {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_EDITWEAVE_APP_VERSION: version,
    VITE_EDITWEAVE_UPDATE_MANIFEST: updateManifest,
    VITE_EDITWEAVE_UPDATE_PUBLIC_KEY: updatePublicKey || '',
    VITE_EDITWEAVE_UPDATE_KEY_ID: updateKeyId || '',
  },
})
const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', (code, signal) => signal ? reject(new Error(`desktop build terminated by ${signal}`)) : resolve(code ?? 1))
})
if (exitCode !== 0) process.exitCode = exitCode

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
