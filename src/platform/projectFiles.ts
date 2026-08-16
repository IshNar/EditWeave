import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core'
import { appCacheDir, join as joinPath } from '@tauri-apps/api/path'
import { open, save } from '@tauri-apps/plugin-dialog'
import { copyFile, exists, mkdir, open as openFsFile, readDir, readFile, readTextFile, remove, SeekMode, stat, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import type { StreamTargetChunk } from 'mediabunny'
import { getProjectSequences, parseProjectDocument, PROJECT_EXTENSION } from '../editor/project'
import { clipSourceTime } from '../editor/effects'
import type { CutlineProjectDocument, MediaAsset, PersistedMediaAsset, ProjectSequence, TimelineClip, TimelineTrack } from '../editor/types'
import { MEDIA_EXTENSIONS, mediaFileExtensionPattern, mediaMimeType, shouldStreamDesktopMedia } from '../media/extensions'
import { createPositionedFileStream } from './positionedFileStream'

function downloadBrowserBlob(blob: Blob, filename: string): string {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.hidden = true
  document.body.appendChild(anchor)
  anchor.click()
  window.setTimeout(() => {
    anchor.remove()
    URL.revokeObjectURL(url)
  }, 0)
  return filename
}

export async function saveProjectFile(project: CutlineProjectDocument): Promise<string | undefined> {
  const contents = JSON.stringify(project, null, 2)
  const safeName = project.name.replace(/[<>:"/\\|?*]+/g, '-').trim() || 'cutline-project'

  if (isTauri()) {
    const path = await save({
      title: 'Cutline 프로젝트 저장',
      defaultPath: `${safeName}.${PROJECT_EXTENSION}`,
      filters: [{ name: 'Cutline Project', extensions: ['json'] }],
    })
    if (!path) return undefined
    await writeTextFile(path, contents)
    return path
  }

  return downloadBrowserBlob(new Blob([contents], { type: 'application/json' }), `${safeName}.${PROJECT_EXTENSION}`)
}

export async function selectProjectSavePath(projectName: string): Promise<string | undefined> {
  if (!isTauri()) return undefined
  const safeName = projectName.replace(/[<>:"/\\|?*]+/g, '-').trim() || 'cutline-project'
  const path = await save({ title: 'Cutline 프로젝트 저장', defaultPath: `${safeName}.${PROJECT_EXTENSION}`, filters: [{ name: 'Cutline Project', extensions: ['json'] }] })
  return path || undefined
}

export async function writeProjectFileAtPath(path: string, project: CutlineProjectDocument): Promise<void> {
  if (!isTauri()) throw new Error('프로젝트 경로 저장은 데스크톱 앱에서만 사용할 수 있습니다.')
  await writeTextFile(path, JSON.stringify(project, null, 2))
}

export async function openProjectFileNative(): Promise<{ project: CutlineProjectDocument; path: string } | undefined> {
  if (!isTauri()) return undefined
  const path = await open({
    title: 'Cutline 프로젝트 열기',
    multiple: false,
    directory: false,
    filters: [{ name: 'Cutline Project', extensions: ['json'] }],
  })
  if (!path || Array.isArray(path)) return undefined
  return { project: resolveProjectMediaPaths(parseProjectDocument(await readTextFile(path)), path), path }
}

export async function openExchangeFileNative(): Promise<{ contents: string; name: string } | undefined> {
  if (!isTauri()) return undefined
  const path = await open({
    title: 'OTIO, Premiere Pro XML, FCPXML 또는 CMX 3600 EDL 시퀀스 가져오기',
    multiple: false,
    directory: false,
    filters: [
      { name: '편집 교환 파일', extensions: ['otio', 'xml', 'fcpxml', 'edl'] },
      { name: 'OpenTimelineIO', extensions: ['otio'] },
      { name: 'Premiere Pro XML', extensions: ['xml'] },
      { name: 'Final Cut Pro XML', extensions: ['fcpxml'] },
      { name: 'CMX 3600 EDL', extensions: ['edl'] },
    ],
  })
  if (!path || Array.isArray(path)) return undefined
  return { contents: await readTextFile(path), name: path.split(/[\\/]/).pop() ?? 'import.fcpxml' }
}

export async function openProjectFileAtPath(path: string): Promise<CutlineProjectDocument> {
  if (!isTauri()) throw new Error('최근 프로젝트는 데스크톱 앱에서만 열 수 있습니다.')
  return resolveProjectMediaPaths(parseProjectDocument(await readTextFile(path)), path)
}

function resolveProjectMediaPaths(project: CutlineProjectDocument, projectPath: string): CutlineProjectDocument {
  const normalized = projectPath.replace(/\\/g, '/')
  const base = normalized.slice(0, Math.max(0, normalized.lastIndexOf('/')))
  const resolve = (path: string | undefined) => {
    if (!path || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\')) return path
    return `${base}/${path.replace(/^\.\//, '')}`.replace(/\//g, projectPath.includes('\\') ? '\\' : '/')
  }
  return { ...project, assets: project.assets.map((asset) => ({ ...asset, sourcePath: resolve(asset.sourcePath), imageSequencePaths: asset.imageSequencePaths?.map((path) => resolve(path) ?? path), proxyCachePath: resolve(asset.proxyCachePath), proxySourcePath: resolve(asset.proxySourcePath) })) }
}

export interface ProjectArchiveResult {
  directory: string
  projectPath: string
  mediaCount: number
  proxyCount: number
  trimmedMedia: number
  excludedUnusedMedia: number
  failures: string[]
}

export interface ProjectArchiveOptions {
  mediaMode: 'full' | 'used-range'
  handleSeconds: number
  includeUnused: boolean
  includeProxies: boolean
}

export interface DeliveryPackageResult {
  directory: string
  copiedFiles: number
  documentFiles: number
  failures: string[]
}

export async function createDeliveryPackage(projectName: string, sources: Array<{ path: string; label?: string }>, documents: Array<{ filename: string; contents: string }>): Promise<DeliveryPackageResult | undefined> {
  if (!isTauri()) throw new Error('납품 패키지는 데스크톱 앱에서 사용할 수 있습니다.')
  const destination = await open({ title: '납품 패키지를 저장할 폴더', multiple: false, directory: true })
  if (typeof destination !== 'string') return undefined
  const separator = destination.includes('\\') ? '\\' : '/'
  const join = (...parts: string[]) => parts.filter(Boolean).join(separator)
  const safeProject = projectName.replace(/[<>:"/\\|?*]+/g, '-').trim() || 'Cutline-Delivery'
  let directory = join(destination, `${safeProject}-Delivery`)
  let suffix = 2
  while (await exists(directory)) directory = join(destination, `${safeProject}-Delivery-${suffix++}`)
  const mastersDirectory = join(directory, 'Masters')
  const stemsDirectory = join(directory, 'Audio-Stems')
  const metadataDirectory = join(directory, 'Metadata')
  await mkdir(directory, { recursive: true })
  await mkdir(metadataDirectory, { recursive: true })
  const failures: string[] = []
  const copied: Array<{ source: string; target: string; label?: string }> = []
  const usedNames = new Set<string>()
  for (const source of sources) {
    const originalName = source.path.split(/[\\/]/).pop() || source.label || 'delivery-file'
    const stem = originalName.replace(/\.[^.]+$/, '')
    const extension = originalName.match(/\.[^.]+$/)?.[0] ?? ''
    let filename = originalName.replace(/[<>:"/\\|?*]+/g, '-')
    let fileSuffix = 2
    while (usedNames.has(filename.toLocaleLowerCase())) filename = `${stem}-${fileSuffix++}${extension}`
    usedNames.add(filename.toLocaleLowerCase())
    const isStem = /\.wav$/i.test(filename) || Boolean(source.label?.toLocaleLowerCase().includes('stem'))
    const targetDirectory = isStem ? stemsDirectory : mastersDirectory
    try {
      if (!(await exists(targetDirectory))) await mkdir(targetDirectory, { recursive: true })
      const target = join(targetDirectory, filename)
      await copyFile(source.path, target)
      copied.push({ source: source.path, target: `${isStem ? 'Audio-Stems' : 'Masters'}/${filename}`, label: source.label })
    } catch (error) {
      failures.push(`${source.label ?? originalName}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  let documentFiles = 0
  for (const document of documents) {
    const filename = document.filename.replace(/[<>:"/\\|?*]+/g, '-').trim() || `document-${documentFiles + 1}.txt`
    try {
      await writeTextFile(join(metadataDirectory, filename), document.contents)
      documentFiles += 1
    } catch (error) {
      failures.push(`${filename}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const manifest = {
    schema: 'cutline-delivery-package-v1', projectName, createdAt: new Date().toISOString(),
    masters: copied.filter((item) => item.target.startsWith('Masters/')),
    audioStems: copied.filter((item) => item.target.startsWith('Audio-Stems/') && !item.label?.toLocaleLowerCase().includes('mixdown')),
    audioMixdowns: copied.filter((item) => item.target.startsWith('Audio-Stems/') && item.label?.toLocaleLowerCase().includes('mixdown')),
    metadata: documents.map((document) => `Metadata/${document.filename}`), failures,
  }
  await writeTextFile(join(directory, 'Delivery-Manifest.json'), JSON.stringify(manifest, null, 2))
  return { directory, copiedFiles: copied.length, documentFiles, failures }
}

export async function createProjectArchive(project: CutlineProjectDocument, requestedOptions?: Partial<ProjectArchiveOptions>): Promise<ProjectArchiveResult | undefined> {
  if (!isTauri()) throw new Error('프로젝트 아카이브는 데스크톱 앱에서 사용할 수 있습니다.')
  const options: ProjectArchiveOptions = { mediaMode: 'full', handleSeconds: 2, includeUnused: true, includeProxies: true, ...requestedOptions }
  options.handleSeconds = Math.max(0, Math.min(120, options.handleSeconds))
  const destination = await open({ title: '프로젝트 아카이브를 저장할 폴더', multiple: false, directory: true })
  if (typeof destination !== 'string') return undefined
  const separator = destination.includes('\\') ? '\\' : '/'
  const join = (...parts: string[]) => parts.filter(Boolean).join(separator)
  const safeProject = project.name.replace(/[<>:"/\\|?*]+/g, '-').trim() || 'Cutline-Project'
  let archiveDirectory = join(destination, `${safeProject}-Archive`)
  let suffix = 2
  while (await exists(archiveDirectory)) archiveDirectory = join(destination, `${safeProject}-Archive-${suffix++}`)
  const mediaDirectory = join(archiveDirectory, 'Media')
  const proxyDirectory = join(archiveDirectory, 'Proxies')
  await mkdir(mediaDirectory, { recursive: true })
  const sourceMap = new Map<string, string>()
  const imageSequenceMap = new Map<string, string[]>()
  const proxyMap = new Map<string, string>()
  const failures: string[] = []
  let mediaCount = 0
  let proxyCount = 0
  const rootByAssetId = new Map(project.assets.map((asset) => [asset.id, asset.parentAssetId ?? asset.id]))
  const usedAssetIds = new Set<string>([
    ...getProjectSequences(project).flatMap((sequence) => sequence.tracks.flatMap((track) => track.clips.flatMap((clip) => [clip.assetId, clip.subclipId].filter((id): id is string => Boolean(id)).map((id) => rootByAssetId.get(id) ?? id)))),
    ...(project.adrCues ?? []).flatMap((cue) => cue.takes.map((take) => rootByAssetId.get(take.assetId) ?? take.assetId)),
  ])
  const rootAssets = project.assets.filter((asset) => !asset.parentAssetId && (options.includeUnused || usedAssetIds.has(asset.id)))
  const includedRootIds = new Set(rootAssets.map((asset) => asset.id))
  const includedAssets = project.assets.filter((asset) => includedRootIds.has(asset.parentAssetId ?? asset.id))
  const sourceSpans = archiveSourceSpans(project, rootByAssetId, options.handleSeconds)
  const trimStarts = new Map<string, number>()
  for (const asset of rootAssets) {
    if (asset.imageSequencePaths?.length) {
      const sequenceDirectoryName = `${asset.id.slice(0, 8)}-Image-Sequence`
      const sequenceDirectory = join(mediaDirectory, sequenceDirectoryName)
      await mkdir(sequenceDirectory, { recursive: true })
      const archivedFrames: string[] = []
      for (const [index, sourcePath] of asset.imageSequencePaths.entries()) {
        const originalName = sourcePath.split(/[\\/]/).pop() ?? `frame-${String(index).padStart(6, '0')}.${asset.extension}`
        const filename = originalName.replace(/[<>:"/\\|?*]+/g, '-')
        const relativePath = `Media/${sequenceDirectoryName}/${filename}`
        try {
          await copyFile(sourcePath, join(sequenceDirectory, filename))
          sourceMap.set(sourcePath, relativePath)
          archivedFrames.push(relativePath)
          mediaCount++
        } catch (error) {
          failures.push(`${asset.name} · ${originalName}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (archivedFrames.length) {
        imageSequenceMap.set(asset.id, archivedFrames)
        if (asset.sourcePath && archivedFrames[0]) sourceMap.set(asset.sourcePath, archivedFrames[0])
      }
    }
    if (asset.sourcePath && !sourceMap.has(asset.sourcePath)) {
      const originalName = asset.sourcePath.split(/[\\/]/).pop() ?? asset.name
      const filename = `${asset.id.slice(0, 8)}-${originalName.replace(/[<>:"/\\|?*]+/g, '-')}`
      const target = join(mediaDirectory, filename)
      try {
        const span = sourceSpans.get(asset.sourcePath)
        const shouldTrim = options.mediaMode === 'used-range' && asset.kind !== 'image' && span && span.duration < Math.max(0, asset.duration - 1 / 240)
        if (shouldTrim) {
          await invoke('trim_archive_media', { sourcePath: asset.sourcePath, targetPath: target, start: span.start, duration: span.duration })
          trimStarts.set(asset.sourcePath, span.start)
        } else await copyFile(asset.sourcePath, target)
        sourceMap.set(asset.sourcePath, `Media/${filename}`)
        mediaCount++
      } catch (error) {
        failures.push(`${asset.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const proxyPath = asset.proxyCachePath ?? asset.proxySourcePath
    if (options.includeProxies && options.mediaMode === 'full' && proxyPath && !proxyMap.has(proxyPath)) {
      if (!(await exists(proxyDirectory))) await mkdir(proxyDirectory, { recursive: true })
      const originalName = proxyPath.split(/[\\/]/).pop() ?? `${asset.name}.mp4`
      const filename = `${asset.id.slice(0, 8)}-${originalName.replace(/[<>:"/\\|?*]+/g, '-')}`
      const target = join(proxyDirectory, filename)
      try {
        const sourceProxyPath = /^[A-Za-z]:[\\/]/.test(proxyPath) || proxyPath.startsWith('/') || proxyPath.startsWith('\\\\')
          ? proxyPath
          : await joinPath(await appCacheDir(), ...proxyPath.split('/'))
        await copyFile(sourceProxyPath, target)
        proxyMap.set(proxyPath, `Proxies/${filename}`)
        proxyCount++
      } catch (error) {
        failures.push(`${asset.name} 프록시: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  const rewrittenSequences = getProjectSequences(project).map((sequence) => rewriteArchivedSequence(sequence, includedAssets, trimStarts))
  const archivedActiveSequence = rewrittenSequences.find((sequence) => sequence.id === project.activeSequenceId) ?? rewrittenSequences[0]
  const archivedProject: CutlineProjectDocument = {
    ...project,
    assets: includedAssets.map((asset) => {
      const root = project.assets.find((candidate) => candidate.id === (asset.parentAssetId ?? asset.id))
      const trimStart = root?.sourcePath ? trimStarts.get(root.sourcePath) ?? 0 : 0
      const originalProxyPath = asset.proxyCachePath ?? asset.proxySourcePath
      const archivedProxyPath = options.includeProxies && options.mediaMode === 'full' && originalProxyPath ? proxyMap.get(originalProxyPath) : undefined
      return {
      ...asset,
      sourcePath: asset.sourcePath ? sourceMap.get(asset.sourcePath) ?? asset.sourcePath : undefined,
      imageSequencePaths: root?.imageSequencePaths?.length ? imageSequenceMap.get(root.id) ?? root.imageSequencePaths.map((path) => sourceMap.get(path) ?? path) : asset.imageSequencePaths,
      proxyCachePath: undefined,
      proxySourcePath: archivedProxyPath,
      proxySourceName: archivedProxyPath?.split('/').pop(),
      proxyOrigin: archivedProxyPath ? 'attached' : undefined,
      proxyPurpose: archivedProxyPath ? 'external' : undefined,
      duration: !asset.parentAssetId && root?.sourcePath && trimStarts.has(root.sourcePath) ? sourceSpans.get(root.sourcePath)?.duration ?? asset.duration : asset.duration,
      timecodeStart: asset.timecodeStart === undefined ? undefined : Math.max(0, asset.timecodeStart + trimStart),
      sourceTimecode: trimStart ? undefined : asset.sourceTimecode,
      subclipIn: asset.subclipIn === undefined ? undefined : Math.max(0, asset.subclipIn - trimStart),
      subclipOut: asset.subclipOut === undefined ? undefined : Math.max(1 / 240, asset.subclipOut - trimStart),
    }}),
    sequences: rewrittenSequences,
    activeSequenceId: archivedActiveSequence?.id,
    tracks: archivedActiveSequence?.tracks ?? project.tracks,
    transcript: archivedActiveSequence?.transcript ?? project.transcript,
    suggestions: archivedActiveSequence?.suggestions ?? project.suggestions,
    markers: archivedActiveSequence?.markers ?? project.markers,
    audioBuses: archivedActiveSequence?.audioBuses ?? project.audioBuses,
    updatedAt: new Date().toISOString(),
  }
  const projectPath = join(archiveDirectory, `${safeProject}.cutline.json`)
  await writeTextFile(projectPath, JSON.stringify(archivedProject, null, 2))
  const excludedUnusedMedia = project.assets.filter((asset) => !asset.parentAssetId).length - rootAssets.length
  const trimmedMedia = trimStarts.size
  await writeTextFile(join(archiveDirectory, 'Archive-Manifest.json'), JSON.stringify({ schema: 'cutline-project-archive-v2', projectId: project.id, projectName: project.name, createdAt: new Date().toISOString(), options, mediaCount, proxyCount, excludedUnusedMedia, trimmedMedia, failures }, null, 2))
  return { directory: archiveDirectory, projectPath, mediaCount, proxyCount, trimmedMedia, excludedUnusedMedia, failures }
}

function archiveSourceSpans(project: CutlineProjectDocument, rootByAssetId: Map<string, string>, handleSeconds: number): Map<string, { start: number; duration: number }> {
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const bounds = new Map<string, { start: number; end: number; asset: PersistedMediaAsset }>()
  for (const sequence of getProjectSequences(project)) {
    for (const clip of sequence.tracks.flatMap((track) => track.clips)) {
      if (!clip.assetId) continue
      const root = assets.get(rootByAssetId.get(clip.assetId) ?? clip.assetId)
      if (!root?.sourcePath) continue
      const times = [clipSourceTime(clip, clip.start), clipSourceTime(clip, clip.start + clip.duration), ...(clip.speedKeyframes ?? []).map((keyframe) => clipSourceTime(clip, clip.start + keyframe.time))]
      const start = Math.max(0, Math.min(...times) - handleSeconds)
      const end = Math.min(root.duration, Math.max(...times) + handleSeconds)
      const current = bounds.get(root.sourcePath)
      if (current) { current.start = Math.min(current.start, start); current.end = Math.max(current.end, end) }
      else bounds.set(root.sourcePath, { start, end, asset: root })
    }
  }
  return new Map([...bounds].map(([path, span]) => [path, { start: span.start, duration: Math.max(1 / 240, span.end - span.start) }]))
}

function rewriteArchivedSequence(sequence: ProjectSequence, assets: PersistedMediaAsset[], trimStarts: Map<string, number>): ProjectSequence {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const tracks: TimelineTrack[] = sequence.tracks.map((track) => ({ ...track, clips: track.clips.map((clip): TimelineClip => {
    const asset = clip.assetId ? assetById.get(clip.assetId) : undefined
    const root = asset?.parentAssetId ? assetById.get(asset.parentAssetId) : asset
    const trimStart = root?.sourcePath ? trimStarts.get(root.sourcePath) ?? 0 : 0
    if (!trimStart) return clip
    return { ...clip, sourceOffset: Math.max(0, clip.sourceOffset - trimStart), freezeFrameSourceTime: clip.freezeFrameSourceTime === undefined ? undefined : Math.max(0, clip.freezeFrameSourceTime - trimStart) }
  }) }))
  return { ...sequence, tracks }
}

export async function openProjectFromBrowserFile(file: File): Promise<CutlineProjectDocument> {
  return parseProjectDocument(await file.text())
}

export function runningInDesktop(): boolean {
  return isTauri()
}

export interface MediaFileReadFailure {
  path: string
  name: string
  message: string
}

export interface MediaFileReadResult {
  files: File[]
  failures: MediaFileReadFailure[]
  bins?: string[]
}

function appendNativePath(parent: string, child: string): string {
  const separator = parent.includes('\\') ? '\\' : '/'
  return `${parent.replace(/[\\/]$/, '')}${separator}${child}`
}

export async function openMediaFolderNative(): Promise<MediaFileReadResult | undefined> {
  if (!isTauri()) return undefined
  const selected = await open({ title: '미디어 폴더 가져오기', multiple: false, directory: true })
  if (typeof selected !== 'string') return { files: [], failures: [], bins: [] }
  return readMediaEntriesFromPaths([selected])
}

export async function readMediaEntriesFromPaths(entries: string[]): Promise<MediaFileReadResult> {
  if (!isTauri()) return { files: [], failures: [], bins: [] }
  const paths: string[] = []
  const bins = new Set<string>()
  const folderByPath: Record<string, string> = {}
  const failures: MediaFileReadFailure[] = []

  const visit = async (directory: string, rootName: string, relativeParts: string[]): Promise<void> => {
    try {
      const children = await readDir(directory)
      for (const entry of children) {
        const path = appendNativePath(directory, entry.name)
        if (entry.isDirectory && !entry.isSymlink) {
          const childParts = [...relativeParts, entry.name]
          bins.add([rootName, ...childParts].join('/'))
          await visit(path, rootName, childParts)
        } else if (entry.isFile && mediaFileExtensionPattern.test(entry.name)) {
          paths.push(path)
          folderByPath[path.replace(/\\/g, '/').toLocaleLowerCase()] = [rootName, ...relativeParts].join('/')
        }
      }
    } catch (error) {
      failures.push({ path: directory, name: directory.split(/[\\/]/).pop() ?? directory, message: describeMediaReadFailure(error) })
    }
  }

  for (const entry of entries) {
    try {
      const info = await stat(entry)
      if (info.isDirectory) {
        const rootName = entry.replace(/[\\/]$/, '').split(/[\\/]/).pop()?.trim() || '가져온 미디어'
        bins.add(rootName)
        await visit(entry, rootName, [])
      } else if (info.isFile && mediaFileExtensionPattern.test(entry)) paths.push(entry)
    } catch (error) {
      failures.push({ path: entry, name: entry.split(/[\\/]/).pop() ?? entry, message: describeMediaReadFailure(error) })
    }
  }
  const result = await readMediaFilesFromPaths(paths, folderByPath)
  return { files: result.files, failures: [...failures, ...result.failures], bins: [...bins] }
}

export function describeMediaReadFailure(reason: unknown): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message
  if (typeof reason === 'string' && reason.trim()) return reason
  if (reason && typeof reason === 'object' && 'message' in reason) {
    const message = (reason as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return '선택한 미디어 파일을 읽지 못했습니다.'
}

export async function openMediaFilesNative(): Promise<MediaFileReadResult | undefined> {
  if (!isTauri()) return undefined
  const selected = await open({ title: '미디어 가져오기', multiple: true, directory: false, filters: [{ name: 'Media', extensions: [...MEDIA_EXTENSIONS] }] })
  if (!selected) return { files: [], failures: [] }
  const paths = Array.isArray(selected) ? selected : [selected]
  return readMediaFilesFromPaths(paths)
}

export interface MediaRelinkCandidate {
  path: string
  name: string
  size: number
  modifiedAt?: number
  quickSignature?: string
}

function littleEndianU64(value: number): Uint8Array {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, BigInt(Math.max(0, Math.floor(value))), true)
  return bytes
}

export async function mediaFileQuickSignature(file: File): Promise<string | undefined> {
  const path = (file as File & { __cutlineSourcePath?: string }).__cutlineSourcePath
  if (isTauri() && path) return invoke<string>('media_file_signature', { path }).catch(() => undefined)
  const size = file.size
  const chunkSize = 1024 * 1024
  const sections: Array<{ label: string; offset: number }> = [{ label: 'first', offset: 0 }]
  if (size > chunkSize * 2) sections.push({ label: 'middle', offset: Math.floor(size / 2) })
  if (size > chunkSize) sections.push({ label: 'last', offset: Math.max(0, size - chunkSize) })
  try {
    const parts: Uint8Array[] = [new TextEncoder().encode('cutline-media-signature-v1\0'), littleEndianU64(size)]
    for (const section of sections) {
      parts.push(new TextEncoder().encode(section.label), littleEndianU64(section.offset), new Uint8Array(await file.slice(section.offset, Math.min(size, section.offset + chunkSize)).arrayBuffer()))
    }
    const length = parts.reduce((sum, part) => sum + part.byteLength, 0)
    const payload = new Uint8Array(length)
    let cursor = 0
    parts.forEach((part) => { payload.set(part, cursor); cursor += part.byteLength })
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', payload))
    return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('')
  } catch {
    return undefined
  }
}

export async function selectMediaRelinkDirectory(): Promise<string | undefined> {
  if (!isTauri()) return undefined
  const path = await open({ title: '오프라인 미디어 재연결 폴더', multiple: false, directory: true })
  return typeof path === 'string' ? path : undefined
}

export async function findMediaRelinkCandidates(directory: string, names: string[]): Promise<MediaRelinkCandidate[]> {
  if (!isTauri() || !names.length) return []
  return invoke<MediaRelinkCandidate[]>('find_media_relink_candidates', { directory, names: [...new Set(names)].slice(0, 500) })
}

export async function revealMediaInFileManager(path: string): Promise<void> {
  if (!isTauri()) throw new Error('파일 위치 열기는 데스크톱 앱에서 사용할 수 있습니다.')
  await invoke('reveal_media_in_file_manager', { path })
}

export async function readMediaFilesFromPaths(paths: string[], importFolderByPath: Record<string, string> = {}): Promise<MediaFileReadResult> {
  if (!isTauri()) return { files: [], failures: [] }
  const results: PromiseSettledResult<File>[] = new Array(paths.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(8, paths.length) }, async () => {
    while (cursor < paths.length) {
      const index = cursor++
      const path = paths[index]
      try {
      const [authorizedPath] = await invoke<string[]>('authorize_media_paths', { paths: [path] })
      const name = authorizedPath.split(/[\\/]/).pop() ?? 'media'
      const info = await stat(authorizedPath)
      const streamFromPath = shouldStreamDesktopMedia(name)
      const bytes = streamFromPath ? new Uint8Array() : await readFile(authorizedPath)
      const file = new File([bytes], name, { type: mediaMimeType(name), lastModified: info.mtime?.getTime() ?? Date.now() })
      Object.defineProperty(file, '__cutlineSourcePath', { value: authorizedPath, enumerable: false })
      Object.defineProperty(file, '__cutlineFileSize', { value: info.size, enumerable: false })
      Object.defineProperty(file, '__cutlineStreaming', { value: streamFromPath, enumerable: false })
      Object.defineProperty(file, '__cutlineStreamUrl', { value: streamFromPath ? convertFileSrc(authorizedPath) : undefined, enumerable: false })
      Object.defineProperty(file, '__cutlineImportFolder', { value: importFolderByPath[path.replace(/\\/g, '/').toLocaleLowerCase()], enumerable: false })
        results[index] = { status: 'fulfilled', value: file }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  })
  await Promise.all(workers)
  const files = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  const failures = results.flatMap((result, index): MediaFileReadFailure[] => {
    if (result.status === 'fulfilled') return []
    const path = paths[index]
    return [{ path, name: path.split(/[\\/]/).pop() ?? 'media', message: describeMediaReadFailure(result.reason) }]
  })
  return { files, failures }
}

export type RenderContainer = 'mp4' | 'mov'

export async function saveRenderedVideo(buffer: ArrayBuffer, filename: string, container: RenderContainer = 'mp4'): Promise<string | undefined> {
  const safeName = filename.replace(/[<>:"/\\|?*]+/g, '-').replace(/\.(mp4|mov)$/i, '').trim() || 'cutline-export'
  if (isTauri()) {
    const path = await save({
      title: container === 'mov' ? 'MOV 마스터 저장' : 'MP4 영상 저장',
      defaultPath: `${safeName}.${container}`,
      filters: [{ name: container === 'mov' ? 'QuickTime Movie' : 'MP4 Video', extensions: [container] }],
    })
    if (!path) return undefined
    await writeFile(path, new Uint8Array(buffer))
    return path
  }

  const url = URL.createObjectURL(new Blob([buffer], { type: 'video/mp4' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safeName}.mp4`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return anchor.download
}

export async function saveFrameImage(buffer: ArrayBuffer, filename: string, format: 'png' | 'jpeg'): Promise<string | undefined> {
  const extension = format === 'jpeg' ? 'jpg' : 'png'
  const safeName = filename.replace(/[<>:"/\\|?*]+/g, '-').replace(/\.(png|jpe?g)$/i, '').trim() || 'cutline-frame'
  if (isTauri()) {
    const path = await save({ title: '현재 프레임 저장', defaultPath: `${safeName}.${extension}`, filters: [{ name: format === 'jpeg' ? 'JPEG Image' : 'PNG Image', extensions: [extension] }] })
    if (!path) return undefined
    await writeFile(path, new Uint8Array(buffer))
    return path
  }
  const url = URL.createObjectURL(new Blob([buffer], { type: format === 'jpeg' ? 'image/jpeg' : 'image/png' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safeName}.${extension}`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return anchor.download
}

export async function prepareRenderedVideoTarget(filename: string): Promise<{ path: string; writable: WritableStream<StreamTargetChunk> } | undefined> {
  if (!isTauri()) return undefined
  const path = await selectRenderedVideoPath(filename)
  return path ? createRenderedVideoTarget(path) : undefined
}

export async function selectRenderedVideoPath(filename: string, container: RenderContainer = 'mp4'): Promise<string | undefined> {
  if (!isTauri()) return undefined
  const safeName = filename.replace(/[<>:"/\\|?*]+/g, '-').replace(/\.(mp4|mov)$/i, '').trim() || 'cutline-export'
  const path = await save({
    title: container === 'mov' ? 'MOV 마스터 저장' : 'MP4 영상 저장',
    defaultPath: `${safeName}.${container}`,
    filters: [{ name: container === 'mov' ? 'QuickTime Movie' : 'MP4 Video', extensions: [container] }],
  })
  return path || undefined
}

export async function selectAudioWavPath(filename: string): Promise<string | undefined> {
  if (!isTauri()) return undefined
  const safeName = filename.replace(/[<>:"/\\|?*]+/g, '-').replace(/\.wav$/i, '').trim() || 'cutline-audio-master'
  const path = await save({ title: 'Full Mix WAV 저장', defaultPath: `${safeName}-Full-Mix.wav`, filters: [{ name: 'Wave Audio', extensions: ['wav'] }] })
  return path || undefined
}

export async function selectRenderedVideoDirectory(): Promise<string | undefined> {
  if (!isTauri()) return undefined
  const path = await open({ title: '일괄 출력 폴더 선택', multiple: false, directory: true })
  return typeof path === 'string' ? path : undefined
}

export async function selectReviewVideoPath(): Promise<string | undefined> {
  if (!isTauri()) return undefined
  const path = await open({ title: 'LAN 검토용 MP4 선택', multiple: false, directory: false, filters: [{ name: 'MP4 Video', extensions: ['mp4'] }] })
  return typeof path === 'string' ? path : undefined
}

export async function prepareRenderedVideoTargetInDirectory(directory: string, filename: string, container: RenderContainer = 'mp4'): Promise<{ path: string; writable: WritableStream<StreamTargetChunk> }> {
  const path = await reserveRenderedVideoPathInDirectory(directory, filename, container)
  return createRenderedVideoTarget(path)
}

export async function reserveRenderedVideoPathInDirectory(directory: string, filename: string, container: RenderContainer = 'mp4'): Promise<string> {
  const safeName = filename.replace(/[<>:"/\\|?*]+/g, '-').replace(/\.(mp4|mov)$/i, '').trim() || 'cutline-export'
  const separator = directory.endsWith('/') || directory.endsWith('\\') ? '' : directory.includes('\\') ? '\\' : '/'
  let path = `${directory}${separator}${safeName}.${container}`
  let suffix = 2
  while (await exists(path)) path = `${directory}${separator}${safeName}-${suffix++}.${container}`
  return path
}

export async function reserveAudioWavPathInDirectory(directory: string, filename: string): Promise<string> {
  const safeName = filename.replace(/[<>:"/\\|?*]+/g, '-').replace(/\.wav$/i, '').trim() || 'cutline-audio-master'
  const separator = directory.endsWith('/') || directory.endsWith('\\') ? '' : directory.includes('\\') ? '\\' : '/'
  let path = `${directory}${separator}${safeName}-Full-Mix.wav`
  let suffix = 2
  while (await exists(path)) path = `${directory}${separator}${safeName}-Full-Mix-${suffix++}.wav`
  return path
}

export async function renderedVideoExists(path: string): Promise<boolean> {
  return isTauri() && await exists(path)
}

export async function prepareRenderedVideoTargetAtPath(path: string): Promise<{ path: string; writable: WritableStream<StreamTargetChunk> }> {
  return createRenderedVideoTarget(path)
}

export async function prepareAudioStemTarget(videoPath: string, stemName: string): Promise<{ path: string; writable: WritableStream<StreamTargetChunk> }> {
  const normalized = videoPath.replace(/\\/g, '/')
  const separatorIndex = normalized.lastIndexOf('/')
  const directory = separatorIndex >= 0 ? videoPath.slice(0, separatorIndex) : ''
  const separator = videoPath.includes('\\') ? '\\' : '/'
  const rawBaseName = normalized.slice(separatorIndex + 1).replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*]+/g, '-').trim() || 'cutline-export'
  const baseName = /\.wav$/i.test(normalized) ? rawBaseName.replace(/-Full-Mix(?:-\d+)?$/i, '') || 'cutline-export' : rawBaseName
  const safeStem = stemName.replace(/[<>:"/\\|?*]+/g, '-').trim() || 'stem'
  let path = `${directory}${directory ? separator : ''}${baseName}-${safeStem}.wav`
  let suffix = 2
  while (await exists(path)) path = `${directory}${directory ? separator : ''}${baseName}-${safeStem}-${suffix++}.wav`
  return createRenderedVideoTarget(path)
}

export async function saveAudioStem(buffer: ArrayBuffer, filename: string, stemName: string): Promise<string | undefined> {
  const safeName = filename.replace(/[<>:"/\\|?*]+/g, '-').replace(/\.(mp4|wav)$/i, '').trim() || 'cutline-export'
  const safeStem = stemName.replace(/[<>:"/\\|?*]+/g, '-').trim() || 'stem'
  const downloadName = `${safeName}-${safeStem}.wav`
  return downloadBrowserBlob(new Blob([buffer], { type: 'audio/wav' }), downloadName)
}

async function createRenderedVideoTarget(path: string): Promise<{ path: string; writable: WritableStream<StreamTargetChunk> }> {
  const handle = await openFsFile(path, { write: true, create: true, truncate: true })
  return {
    path,
    writable: createPositionedFileStream({
      seek: async (position) => handle.seek(position, SeekMode.Start),
      write: async (data) => handle.write(data),
      close: async () => handle.close(),
    }, { removeIncomplete: async () => remove(path) }),
  }
}

export async function saveSubtitleFile(contents: string, filename: string, format: 'srt' | 'vtt' | 'ttml' = 'srt'): Promise<string | undefined> {
  const safeName = filename.replace(/[<>:"/\\|?*]+/g, '-').replace(/\.(srt|vtt|ttml)$/i, '').trim() || 'cutline-subtitles'
  if (isTauri()) {
    const path = await save({
      title: `${format.toUpperCase()} 자막 저장`,
      defaultPath: `${safeName}.${format}`,
      filters: [{ name: format === 'vtt' ? 'WebVTT Subtitle' : format === 'ttml' ? 'TTML / DFXP Subtitle' : 'SubRip Subtitle', extensions: [format] }],
    })
    if (!path) return undefined
    await writeTextFile(path, contents)
    return path
  }
  return downloadBrowserBlob(new Blob([contents], { type: format === 'vtt' ? 'text/vtt;charset=utf-8' : format === 'ttml' ? 'application/ttml+xml;charset=utf-8' : 'application/x-subrip;charset=utf-8' }), `${safeName}.${format}`)
}

export async function saveExchangeFile(contents: string, filename: string, format: 'otio' | 'premiere-xml' | 'fcpxml' | 'edl'): Promise<string | undefined> {
  const extension = format === 'premiere-xml' ? 'xml' : format
  const safeName = filename.replace(/[<>:"/\\|?*]+/g, '-').replace(/\.(xml|fcpxml|edl)$/i, '').trim() || 'cutline-timeline'
  if (isTauri()) {
    const path = await save({
      title: format === 'otio' ? 'OpenTimelineIO 타임라인 저장' : format === 'premiere-xml' ? 'Premiere Pro XML 타임라인 저장' : format === 'fcpxml' ? 'FCPXML 타임라인 저장' : 'EDL 타임라인 저장',
      defaultPath: `${safeName}.${extension}`,
      filters: [{ name: format === 'otio' ? 'OpenTimelineIO' : format === 'premiere-xml' ? 'Premiere Pro XML' : format === 'fcpxml' ? 'Final Cut Pro XML' : 'CMX 3600 EDL', extensions: [extension] }],
    })
    if (!path) return undefined
    await writeTextFile(path, contents)
    return path
  }
  return downloadBrowserBlob(new Blob([contents], { type: format === 'edl' ? 'text/plain;charset=utf-8' : 'application/xml;charset=utf-8' }), `${safeName}.${extension}`)
}

export async function saveMarkerDeliveryFile(contents: string, filename: string, format: 'chapters' | 'markers'): Promise<string | undefined> {
  const extension = format === 'chapters' ? 'txt' : 'csv'
  const suffix = format === 'chapters' ? 'chapters' : 'markers'
  const safeName = filename.replace(/[<>:"/\\|?*]+/g, '-').replace(/\.(txt|csv)$/i, '').trim() || 'cutline-timeline'
  const downloadName = `${safeName}-${suffix}.${extension}`
  if (isTauri()) {
    const path = await save({ title: format === 'chapters' ? '챕터 목록 저장' : '마커 보고서 저장', defaultPath: downloadName, filters: [{ name: format === 'chapters' ? 'Chapter Text' : 'Marker CSV', extensions: [extension] }] })
    if (!path) return undefined
    await writeTextFile(path, format === 'markers' ? `\uFEFF${contents}` : contents)
    return path
  }
  const payload = format === 'markers' ? `\uFEFF${contents}` : contents
  return downloadBrowserBlob(new Blob([payload], { type: format === 'markers' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8' }), downloadName)
}

export async function saveReviewFile(contents: string, filename: string): Promise<string | undefined> {
  const safeName = filename.replace(/[<>:"/\\|?*]+/g, '-').replace(/\.csv$/i, '').trim() || 'cutline-review'
  if (isTauri()) {
    const path = await save({ title: '검토 코멘트 CSV 저장', defaultPath: `${safeName}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] })
    if (!path) return undefined
    await writeTextFile(path, `\uFEFF${contents}`)
    return path
  }
  return downloadBrowserBlob(new Blob([`\uFEFF${contents}`], { type: 'text/csv;charset=utf-8' }), `${safeName}.csv`)
}

export async function saveMediaMetadataFile(contents: string, filename: string): Promise<string | undefined> {
  const safeName = filename.replace(/[<>:"/\\|?*]+/g, '-').replace(/\.csv$/i, '').trim() || 'cutline-media-metadata'
  const downloadName = `${safeName}.csv`
  const payload = contents.startsWith('\uFEFF') ? contents : `\uFEFF${contents}`
  if (isTauri()) {
    const path = await save({ title: '미디어 메타데이터 CSV 저장', defaultPath: downloadName, filters: [{ name: 'Media Metadata CSV', extensions: ['csv'] }] })
    if (!path) return undefined
    await writeTextFile(path, payload)
    return path
  }
  return downloadBrowserBlob(new Blob([payload], { type: 'text/csv;charset=utf-8' }), downloadName)
}

export async function saveReviewPackageFile(contents: string, filename: string): Promise<string | undefined> {
  const safeName = filename.replace(/[<>:"/\\|?*]+/g, '-').replace(/\.cutline-review\.json$/i, '').trim() || 'cutline-review'
  if (isTauri()) {
    const path = await save({ title: 'Cutline 검토 패키지 저장', defaultPath: `${safeName}.cutline-review.json`, filters: [{ name: 'Cutline Review', extensions: ['json'] }] })
    if (!path) return undefined
    await writeTextFile(path, contents)
    return path
  }
  return downloadBrowserBlob(new Blob([contents], { type: 'application/json;charset=utf-8' }), `${safeName}.cutline-review.json`)
}
