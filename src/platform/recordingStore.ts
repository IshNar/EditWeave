import { isTauri } from '@tauri-apps/api/core'
import { appDataDir, join } from '@tauri-apps/api/path'
import { BaseDirectory, mkdir, remove, writeFile } from '@tauri-apps/plugin-fs'
import { isKnownScratchPath, scratchManagedPath } from './scratchDisks'

const ROOT = 'recordings'

export async function persistVoiceoverRecording(projectId: string, file: File): Promise<File> {
  if (!isTauri()) return file
  const projectPart = safePart(projectId, 'project')
  const extension = file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || extensionForMime(file.type)
  const basename = safePart(file.name.replace(/\.[^.]+$/, ''), 'voiceover')
  const persistedName = `${basename}-${Date.now()}.${extension}`
  const relativePath = `${ROOT}/${projectPart}/${persistedName}`
  const customPath = scratchManagedPath('recording', [projectPart, persistedName])
  let absolutePath: string
  if (customPath) {
    const directory = customPath.slice(0, Math.max(customPath.lastIndexOf('/'), customPath.lastIndexOf('\\')))
    await mkdir(directory, { recursive: true })
    await writeFile(customPath, new Uint8Array(await file.arrayBuffer()))
    absolutePath = customPath
  } else {
    await mkdir(`${ROOT}/${projectPart}`, { baseDir: BaseDirectory.AppData, recursive: true })
    await writeFile(relativePath, new Uint8Array(await file.arrayBuffer()), { baseDir: BaseDirectory.AppData })
    absolutePath = await join(await appDataDir(), ...relativePath.split('/'))
  }
  const persistedFile = new File([file], persistedName, { type: file.type, lastModified: file.lastModified })
  Object.defineProperty(persistedFile, '__cutlineSourcePath', { value: absolutePath, enumerable: false })
  return persistedFile
}

export async function deleteVoiceoverRecording(sourcePath?: string): Promise<void> {
  if (!sourcePath || !isTauri()) return
  const root = await join(await appDataDir(), ROOT)
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase()
  const normalizedPath = sourcePath.replace(/\\/g, '/').toLocaleLowerCase()
  if (!normalizedPath.startsWith(`${normalizedRoot}/`) && !isKnownScratchPath('recording', sourcePath)) throw new Error('Cutline 녹음 폴더 밖의 파일은 삭제할 수 없습니다.')
  await remove(sourcePath)
}

function safePart(value: string, fallback: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || fallback
}

function extensionForMime(mime: string): string {
  if (mime.includes('mp4')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}
