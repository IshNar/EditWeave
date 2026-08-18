import { convertFileSrc, isTauri } from '@tauri-apps/api/core'
import { appCacheDir, join } from '@tauri-apps/api/path'
import { BaseDirectory, SeekMode, exists, mkdir, open as openFile, remove, stat, writeFile } from '@tauri-apps/plugin-fs'
import type { StreamTargetChunk } from 'mediabunny'
import { createPositionedFileStream } from './positionedFileStream'
import { isKnownScratchPath, scratchManagedPath } from './scratchDisks'

const PROXY_CACHE_ROOT = 'proxies'
const SAFE_CACHE_PATH = /^proxies\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.(?:mp4|wav|png)$/

function safePart(value: string, fallback: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || fallback
}

export function createProxyCachePath(projectId: string, assetId: string): string {
  return scratchManagedPath('proxy', [projectId, `${assetId}.mp4`]) ?? `${PROXY_CACHE_ROOT}/${safePart(projectId, 'project')}/${safePart(assetId, 'asset')}.mp4`
}

export function createAudioProxyCachePath(projectId: string, assetId: string): string {
  return scratchManagedPath('proxy', [projectId, `${assetId}.wav`]) ?? `${PROXY_CACHE_ROOT}/${safePart(projectId, 'project')}/${safePart(assetId, 'asset')}.wav`
}

export function createImageProxyCachePath(projectId: string, assetId: string): string {
  return scratchManagedPath('proxy', [projectId, `${assetId}.png`]) ?? `${PROXY_CACHE_ROOT}/${safePart(projectId, 'project')}/${safePart(assetId, 'asset')}.png`
}

export function isProxyCachePath(path: string): boolean {
  return SAFE_CACHE_PATH.test(path) || isKnownScratchPath('proxy', path)
}

export async function persistProxyFile(projectId: string, assetId: string, file: File): Promise<{ cachePath: string; cachedAt: string } | undefined> {
  if (!isTauri()) return undefined
  const cachePath = createProxyCachePath(projectId, assetId)
  const absolute = !SAFE_CACHE_PATH.test(cachePath)
  const directory = cachePath.slice(0, Math.max(cachePath.lastIndexOf('/'), cachePath.lastIndexOf('\\')))
  if (absolute) {
    await mkdir(directory, { recursive: true })
    await writeFile(cachePath, new Uint8Array(await file.arrayBuffer()))
  } else {
    await mkdir(directory, { baseDir: BaseDirectory.AppCache, recursive: true })
    await writeFile(cachePath, new Uint8Array(await file.arrayBuffer()), { baseDir: BaseDirectory.AppCache })
  }
  return { cachePath, cachedAt: new Date().toISOString() }
}

export async function loadProxyFile(cachePath: string, assetName: string): Promise<File | undefined> {
  if (!isTauri() || !isProxyCachePath(cachePath)) return undefined
  const absolute = !SAFE_CACHE_PATH.test(cachePath)
  if (!(absolute ? await exists(cachePath) : await exists(cachePath, { baseDir: BaseDirectory.AppCache }))) return undefined
  const info = absolute ? await stat(cachePath) : await stat(cachePath, { baseDir: BaseDirectory.AppCache })
  if (!info.size) return undefined
  const absolutePath = absolute ? cachePath : await join(await appCacheDir(), ...cachePath.split('/'))
  const safeName = assetName.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*]+/g, '-') || 'media'
  const audioProxy = /\.wav$/i.test(cachePath)
  const imageProxy = /\.png$/i.test(cachePath)
  const extension = audioProxy ? 'wav' : imageProxy ? 'png' : 'mp4'
  const file = new File([], `${safeName}.editweave-proxy.${extension}`, { type: audioProxy ? 'audio/wav' : imageProxy ? 'image/png' : 'video/mp4' })
  Object.defineProperty(file, '__editweaveSourcePath', { value: absolutePath, enumerable: false })
  Object.defineProperty(file, '__editweaveFileSize', { value: info.size, enumerable: false })
  Object.defineProperty(file, '__editweaveStreaming', { value: true, enumerable: false })
  Object.defineProperty(file, '__editweavePreviewUrl', { value: convertFileSrc(absolutePath), enumerable: false })
  return file
}

export function proxyPreviewUrl(file: File): string {
  const pathFile = file as File & { __editweavePreviewUrl?: string; __editweaveStreamUrl?: string }
  return pathFile.__editweavePreviewUrl ?? pathFile.__editweaveStreamUrl ?? URL.createObjectURL(file)
}

export function proxyFileSize(file: File): number {
  return (file as File & { __editweaveFileSize?: number }).__editweaveFileSize ?? file.size
}

export async function deleteProxyFile(cachePath?: string): Promise<void> {
  if (!isTauri() || !cachePath || !isProxyCachePath(cachePath)) return
  const absolute = !SAFE_CACHE_PATH.test(cachePath)
  if (absolute ? await exists(cachePath) : await exists(cachePath, { baseDir: BaseDirectory.AppCache })) {
    if (absolute) await remove(cachePath)
    else await remove(cachePath, { baseDir: BaseDirectory.AppCache })
  }
}

export async function createProxyWritableStream(cachePath: string): Promise<WritableStream<StreamTargetChunk>> {
  if (!isTauri() || !isProxyCachePath(cachePath)) throw new Error('안전한 데스크톱 프록시 캐시 경로가 아닙니다.')
  const absolute = !SAFE_CACHE_PATH.test(cachePath)
  const directory = cachePath.slice(0, Math.max(cachePath.lastIndexOf('/'), cachePath.lastIndexOf('\\')))
  if (absolute) await mkdir(directory, { recursive: true })
  else await mkdir(directory, { baseDir: BaseDirectory.AppCache, recursive: true })
  const handle = absolute
    ? await openFile(cachePath, { write: true, create: true, truncate: true })
    : await openFile(cachePath, { baseDir: BaseDirectory.AppCache, write: true, create: true, truncate: true })
  return createPositionedFileStream({
    seek: async (position) => handle.seek(position, SeekMode.Start),
    write: async (data) => handle.write(data),
    close: async () => handle.close(),
  }, { removeIncomplete: async () => deleteProxyFile(cachePath) })
}
