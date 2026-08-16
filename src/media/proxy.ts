import type { MediaAsset } from '../editor/types'
import { invoke } from '@tauri-apps/api/core'
import { createProxyCachePath, createProxyWritableStream, loadProxyFile } from '../platform/proxyCache'
import { runningInDesktop } from '../platform/projectFiles'
import { createMediaSource } from '../platform/mediaSource'
import { parseMediaTimecode } from './timecode'
import { scratchRoot } from '../platform/scratchDisks'

export interface ProxyResult {
  file: File
  width: number
  height: number
  frameRate: number
  duration: number
  cachePath?: string
  cachedAt?: string
  proxyTimecode?: string
  proxyTimecodeVerified?: boolean
  proxyTimecodeMismatch?: boolean
}

export interface AudioCompatibilityProxyResult {
  file: File
  duration: number
  cachePath: string
  cachedAt: string
}

export interface ImageCompatibilityProxyResult {
  file: File
  duration: number
  cachePath: string
  cachedAt: string
}

export async function createImageSequenceProxy(
  asset: MediaAsset,
  options: { signal?: AbortSignal; onProgress?: (progress: number) => void; projectId?: string; maxDimension?: number; quality?: 'editing' | 'compatibility' } = {},
): Promise<ProxyResult> {
  if (asset.kind !== 'video' || !asset.imageSequencePaths?.length) throw new Error('프록시를 만들 이미지 시퀀스 원본 경로가 없습니다.')
  if (!runningInDesktop()) throw new Error('전문 이미지 시퀀스 변환은 데스크톱 앱에서 사용할 수 있습니다.')
  if (!options.projectId) throw new Error('이미지 시퀀스 프록시 캐시를 위한 프로젝트 ID가 없습니다.')
  const sourceWidth = asset.width ?? 1920
  const sourceHeight = asset.height ?? 1080
  const maxDimension = Math.max(480, Math.min(8192, options.maxDimension ?? (options.quality === 'compatibility' ? Math.max(sourceWidth, sourceHeight) : 1920)))
  const landscape = sourceWidth >= sourceHeight
  const width = Math.max(2, Math.floor((landscape ? Math.min(maxDimension, sourceWidth) : Math.round(Math.min(maxDimension, sourceHeight) * sourceWidth / sourceHeight)) / 2) * 2)
  const height = Math.max(2, Math.floor((landscape ? Math.round(Math.min(maxDimension, sourceWidth) * sourceHeight / sourceWidth) : Math.min(maxDimension, sourceHeight)) / 2) * 2)
  const frameRate = Math.max(1, Math.min(240, asset.imageSequenceFrameRate ?? asset.frameRate ?? 30))
  const proxyScratchRoot = scratchRoot('proxy')
  const cancel = () => void invoke('cancel_ffmpeg_proxy', { projectId: options.projectId, assetId: asset.id, scratchRoot: proxyScratchRoot }).catch(() => undefined)
  options.signal?.addEventListener('abort', cancel, { once: true })
  options.onProgress?.(0.03)
  let result: { cachePath: string; size: number }
  try {
    result = await invoke<{ cachePath: string; size: number }>('create_ffmpeg_image_sequence_proxy', {
      sourcePaths: asset.imageSequencePaths,
      projectId: options.projectId,
      assetId: asset.id,
      width,
      height,
      frameRate,
      compatibilityMode: options.quality === 'compatibility',
      scratchRoot: proxyScratchRoot,
    })
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('프록시 생성을 취소했습니다.', 'AbortError')
    throw error
  } finally {
    options.signal?.removeEventListener('abort', cancel)
  }
  if (options.signal?.aborted) throw new DOMException('프록시 생성을 취소했습니다.', 'AbortError')
  const file = await loadProxyFile(result.cachePath, asset.name)
  if (!file) throw new Error('이미지 시퀀스 프록시를 앱 캐시에서 읽지 못했습니다.')
  options.onProgress?.(1)
  return { file, width, height, frameRate, duration: asset.imageSequencePaths.length / frameRate, cachePath: result.cachePath, cachedAt: new Date().toISOString() }
}

export async function createImageCompatibilityProxy(
  asset: MediaAsset,
  options: { signal?: AbortSignal; onProgress?: (progress: number) => void; projectId?: string } = {},
): Promise<ImageCompatibilityProxyResult> {
  if (asset.kind !== 'image' || !asset.sourceFile || !asset.sourcePath) throw new Error('호환 프록시를 만들 실제 이미지 원본 경로가 없습니다.')
  if (!runningInDesktop()) throw new Error('전문 이미지 호환 변환은 데스크톱 앱에서 사용할 수 있습니다.')
  if (!options.projectId) throw new Error('이미지 프록시 캐시를 위한 프로젝트 ID가 없습니다.')
  const proxyScratchRoot = scratchRoot('proxy')
  const cancel = () => void invoke('cancel_ffmpeg_proxy', { projectId: options.projectId, assetId: asset.id, scratchRoot: proxyScratchRoot }).catch(() => undefined)
  options.signal?.addEventListener('abort', cancel, { once: true })
  options.onProgress?.(0.05)
  let result: { cachePath: string; size: number }
  try {
    result = await invoke<{ cachePath: string; size: number }>('create_ffmpeg_image_proxy', { sourcePath: asset.sourcePath, projectId: options.projectId, assetId: asset.id, scratchRoot: proxyScratchRoot })
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('프록시 생성을 취소했습니다.', 'AbortError')
    throw error
  } finally {
    options.signal?.removeEventListener('abort', cancel)
  }
  if (options.signal?.aborted) throw new DOMException('프록시 생성을 취소했습니다.', 'AbortError')
  const file = await loadProxyFile(result.cachePath, asset.name)
  if (!file) throw new Error('이미지 호환 프록시를 앱 캐시에서 읽지 못했습니다.')
  options.onProgress?.(1)
  return { file, duration: asset.duration, cachePath: result.cachePath, cachedAt: new Date().toISOString() }
}

export async function createAudioCompatibilityProxy(
  asset: MediaAsset,
  options: { signal?: AbortSignal; onProgress?: (progress: number) => void; projectId?: string } = {},
): Promise<AudioCompatibilityProxyResult> {
  if (asset.kind !== 'audio' || !asset.sourceFile || !asset.sourcePath) throw new Error('호환 프록시를 만들 실제 오디오 원본 경로가 없습니다.')
  if (!runningInDesktop()) throw new Error('전문 오디오 호환 변환은 데스크톱 앱에서 사용할 수 있습니다.')
  if (!options.projectId) throw new Error('오디오 프록시 캐시를 위한 프로젝트 ID가 없습니다.')
  const proxyScratchRoot = scratchRoot('proxy')
  const cancel = () => void invoke('cancel_ffmpeg_proxy', { projectId: options.projectId, assetId: asset.id, scratchRoot: proxyScratchRoot }).catch(() => undefined)
  options.signal?.addEventListener('abort', cancel, { once: true })
  options.onProgress?.(0.03)
  let result: { cachePath: string; size: number }
  try {
    result = await invoke<{ cachePath: string; size: number }>('create_ffmpeg_audio_proxy', {
      sourcePath: asset.sourcePath,
      projectId: options.projectId,
      assetId: asset.id,
      audioStreamIndex: asset.sourceAudioStreamIndex ?? 0,
      scratchRoot: proxyScratchRoot,
    })
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('프록시 생성을 취소했습니다.', 'AbortError')
    throw error
  } finally {
    options.signal?.removeEventListener('abort', cancel)
  }
  if (options.signal?.aborted) throw new DOMException('프록시 생성을 취소했습니다.', 'AbortError')
  const file = await loadProxyFile(result.cachePath, asset.name)
  if (!file) throw new Error('오디오 호환 프록시를 앱 캐시에서 읽지 못했습니다.')
  options.onProgress?.(1)
  return { file, duration: asset.duration, cachePath: result.cachePath, cachedAt: new Date().toISOString() }
}

export async function createEditingProxy(
  asset: MediaAsset,
  options: { signal?: AbortSignal; onProgress?: (progress: number) => void; projectId?: string; maxDimension?: number; quality?: 'editing' | 'compatibility' } = {},
): Promise<ProxyResult> {
  if (asset.kind !== 'video' || !asset.sourceFile) throw new Error('프록시를 만들 실제 영상 원본이 없습니다.')
  if (asset.size > 1_500_000_000 && !runningInDesktop()) throw new Error('1.5GB 초과 원본의 스트리밍 프록시는 데스크톱 앱에서 사용할 수 있습니다.')

  // Never transcode large desktop sources inside the WebView renderer.
  const useFfmpeg = runningInDesktop() && Boolean(asset.sourcePath)
  if (useFfmpeg) {
    if (!options.projectId) throw new Error('FFmpeg 프록시 캐시를 위한 프로젝트 ID가 없습니다.')
    let sourceWidth = asset.width
    let sourceHeight = asset.height
    if (options.quality === 'compatibility' && (!sourceWidth || !sourceHeight) && asset.sourcePath) {
      const metadata = await invoke<{ width?: number; height?: number }>('probe_media_metadata', { sourcePath: asset.sourcePath }).catch(() => undefined)
      sourceWidth = metadata?.width ?? sourceWidth
      sourceHeight = metadata?.height ?? sourceHeight
    }
    sourceWidth ??= 1920
    sourceHeight ??= 1080
    const maxDimension = Math.max(480, Math.min(8192, options.maxDimension ?? (options.quality === 'compatibility' ? Math.max(sourceWidth, sourceHeight) : 960)))
    const landscape = sourceWidth >= sourceHeight
    const width = Math.max(2, Math.floor((landscape ? Math.min(maxDimension, sourceWidth) : Math.round(Math.min(maxDimension, sourceHeight) * sourceWidth / sourceHeight)) / 2) * 2)
    const height = Math.max(2, Math.floor((landscape ? Math.round(Math.min(maxDimension, sourceWidth) * sourceHeight / sourceWidth) : Math.min(maxDimension, sourceHeight)) / 2) * 2)
    const frameRate = Math.max(1, Math.min(240, asset.frameRate ?? 30))
    options.onProgress?.(0.03)
    const proxyScratchRoot = scratchRoot('proxy')
    const cancel = () => void invoke('cancel_ffmpeg_proxy', { projectId: options.projectId, assetId: asset.id, scratchRoot: proxyScratchRoot }).catch(() => undefined)
    options.signal?.addEventListener('abort', cancel, { once: true })
    let result: { cachePath: string; size: number; proxyTimecode?: string }
    try {
      result = await invoke<{ cachePath: string; size: number; proxyTimecode?: string }>('create_ffmpeg_proxy', { sourcePath: asset.sourcePath, projectId: options.projectId, assetId: asset.id, width, height, frameRate, audioStreamIndex: asset.sourceAudioStreamIndex ?? 0, compatibilityMode: options.quality === 'compatibility', scratchRoot: proxyScratchRoot })
    } catch (error) {
      if (options.signal?.aborted) throw new DOMException('프록시 생성을 취소했습니다.', 'AbortError')
      throw error
    } finally {
      options.signal?.removeEventListener('abort', cancel)
    }
    if (options.signal?.aborted) throw new DOMException('프록시 생성을 취소했습니다.', 'AbortError')
    const file = await loadProxyFile(result.cachePath, asset.name)
    if (!file) throw new Error('FFmpeg 프록시 파일을 앱 캐시에서 읽지 못했습니다.')
    options.onProgress?.(1)
    const parsedProxyTimecode = result.proxyTimecode ? parseMediaTimecode(result.proxyTimecode, asset.frameRate || 30) : undefined
    const proxyTimecodeVerified = asset.timecodeStart !== undefined && parsedProxyTimecode !== undefined
    const proxyTimecodeMismatch = proxyTimecodeVerified ? Math.abs(parsedProxyTimecode.seconds - asset.timecodeStart!) > 0.5 / Math.max(1, asset.frameRate || 30) : undefined
    return { file, width, height, frameRate, duration: asset.duration, cachePath: result.cachePath, cachedAt: new Date().toISOString(), proxyTimecode: parsedProxyTimecode?.normalized, proxyTimecodeVerified, proxyTimecodeMismatch }
  }

  const {
    ALL_FORMATS,
    BufferTarget,
    Conversion,
    ConversionCanceledError,
    Input,
    Mp4OutputFormat,
    Output,
    QUALITY_LOW,
    StreamTarget,
  } = await import('mediabunny')

  const input = new Input({ source: await createMediaSource(asset.sourceFile, asset.sourcePath), formats: ALL_FORMATS })
  let inputDisposed = false
  const disposeInput = () => {
    if (inputDisposed) return
    input.dispose()
    inputDisposed = true
  }
  try {
  const videoTrack = await input.getPrimaryVideoTrack()
  if (!videoTrack) throw new Error('프록시로 변환할 영상 트랙이 없습니다.')
  const [sourceWidth, sourceHeight, duration] = await Promise.all([
    videoTrack.getDisplayWidth(),
    videoTrack.getDisplayHeight(),
    input.computeDuration(),
  ])
  const landscape = sourceWidth >= sourceHeight
  const maxDimension = Math.max(480, Math.min(8192, options.maxDimension ?? (options.quality === 'compatibility' ? Math.max(sourceWidth, sourceHeight) : 960)))
  const width = Math.max(2, Math.floor((landscape ? Math.min(maxDimension, sourceWidth) : Math.round(Math.min(maxDimension, sourceHeight) * sourceWidth / sourceHeight)) / 2) * 2)
  const height = Math.max(2, Math.floor((landscape ? Math.round(Math.min(maxDimension, sourceWidth) * sourceHeight / sourceWidth) : Math.min(maxDimension, sourceHeight)) / 2) * 2)
  const frameRate = Math.max(1, Math.min(240, asset.frameRate ?? 30))
  const cachePath = runningInDesktop() && options.projectId ? createProxyCachePath(options.projectId, asset.id) : undefined
  const target = cachePath ? new StreamTarget(await createProxyWritableStream(cachePath), { chunked: true, chunkSize: 8 * 1024 * 1024 }) : new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: cachePath ? 'fragmented' : 'in-memory' }), target })
  const conversion = await Conversion.init({
    input,
    output,
    tracks: 'primary',
    video: {
      ...(landscape ? { width } : { height }),
      fit: 'contain',
      frameRate,
      codec: 'avc',
      quality: options.quality === 'compatibility' ? 0.8 : QUALITY_LOW,
      keyFrameInterval: 1,
      forceTranscode: true,
      hardwareAcceleration: 'prefer-hardware',
    },
    audio: {
      codec: 'aac',
      numberOfChannels: 2,
      sampleRate: 48_000,
      bitrate: 128_000,
      forceTranscode: true,
    },
    showWarnings: false,
  })
  if (!conversion.isValid) {
    const reasons = [...new Set(conversion.discardedTracks.map((item) => item.reason))].join(', ')
    disposeInput()
    throw new Error(`프록시 변환 구성을 만들 수 없습니다${reasons ? `: ${reasons}` : '.'}`)
  }
  conversion.onProgress = (progress) => options.onProgress?.(progress)
  const handleAbort = () => void conversion.cancel()
  options.signal?.addEventListener('abort', handleAbort, { once: true })
  try {
    if (options.signal?.aborted) throw new DOMException('프록시 생성을 취소했습니다.', 'AbortError')
    await conversion.execute()
  } catch (error) {
    if (error instanceof ConversionCanceledError || options.signal?.aborted) throw new DOMException('프록시 생성을 취소했습니다.', 'AbortError')
    throw error
  } finally {
    options.signal?.removeEventListener('abort', handleAbort)
    disposeInput()
  }
  const safeName = asset.name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*]+/g, '-') || 'media'
  const file = cachePath ? await loadProxyFile(cachePath, asset.name) : target instanceof BufferTarget && target.buffer ? new File([target.buffer], `${safeName}.cutline-proxy.mp4`, { type: 'video/mp4' }) : undefined
  if (!file) throw new Error('프록시 출력 파일을 만들지 못했습니다.')
  return {
    file,
    width,
    height,
    frameRate,
    duration,
    cachePath,
    cachedAt: cachePath ? new Date().toISOString() : undefined,
  }
  } catch (error) {
    disposeInput()
    throw error
  }
}
