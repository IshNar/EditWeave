import type { AudioSample as MediabunnyAudioSample, AudioSampleSink, AudioSampleSource, Input, VideoSample as MediabunnyVideoSample, VideoSampleSink } from 'mediabunny'
import type { StreamTargetChunk } from 'mediabunny'
import { applyBrickwallLimiter, applyNoiseGate, applyStaticCompressor, audioFadeCurveGain, clipNeedsPitchStretch, clipSourceTime, defaultAudioAdjustment, defaultCaptionStyle, defaultColorAdjustment, defaultVisualEffects, gainFromDb, hasSourceMasterVisualProcessing, peakNormalizationGain, pitchPreservationSourcePadding, resolveAdrCompGain, resolveClipAudioMix, resolveClipTransform, resolveClipTransitionState, resolveTrackAudioMix, resolveVisualEffects, sourceMasterAudio, sourceMasterColor, sourceMasterVisualEffects, transitionAudioGain, transitionOpacity, visualFilter } from '../editor/effects'
import { activeVisualClipsAt, clipsWithAudioTransitionTails, constrainTransitionCarryToAsset } from '../editor/transitions'
import { applyChromaKey } from '../editor/chroma'
import { applyCanvasMask, drawMaskPath, requiresCanvasMask } from '../editor/mask'
import { applyColorCurves, applyColorQualifier, hasColorQualifier, hasCustomColorCurves } from '../editor/colorCurves'
import { applyBaseColorFilter, applyColorNodeGraph } from '../editor/colorNodes'
import { applyEmbeddedColorLut } from '../editor/lut'
import type { AudioBusInsert, AudioBusMap, AudioRole, CaptionStyle, MediaAsset, SequencePreset, TimelineClip, TimelineTrack } from '../editor/types'
import { audioRoles, isAudioBusActive, normalizeAudioBuses, resolveAudioAuxSends } from '../editor/audioBuses'
import { AUDIO_EQ_FREQUENCIES, AUDIO_EQ_Q, createBiquadState, highpassBiquad, highShelfBiquad, lowpassBiquad, lowShelfBiquad, peakingBiquad, processBiquad, stereoPanSample, type BiquadCoefficients, type BiquadState } from '../editor/audioDsp'
import { createMediaSource } from '../platform/mediaSource'
import { Hdr10FrameConverter } from './hdr10'
import { HdrLinearCompositor } from './hdrLinearCompositor'
import { decodedSpanEnd, downmixAudioBuffer, extractSurroundAudioBuffer, renderPitchPreservedTimeMap, sampleDecodedAudio, sampleDecodedSurround, type DecodedAudioSpan } from './audioPcm'
import { drawInterpretedSource, effectiveSourceHdrFormat, hasSourceInterpretation, interpretedSourceDimensions, interpretNormalizedPoint } from '../editor/sourceInterpretation'
import { drawMotionCompensatedFrame } from './frameInterpolation'
import { applyCornerPin } from '../editor/cornerPin'
import { DESKTOP_STREAM_CHUNK_BYTES, withWritableCleanup } from '../platform/positionedFileStream'

export interface SequenceExportOptions {
  projectName: string
  preset: SequencePreset
  height: number
  fps: number
  codec?: 'avc' | 'hevc'
  preserveAlpha?: boolean
  allowCodecFallback?: boolean
  colorMode?: 'sdr' | 'hdr10-pq' | 'hdr-hlg'
  bitrateMbps?: number
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software'
  includeAudio: boolean
  audioSampleRate?: 44_100 | 48_000 | 96_000
  audioBitrateKbps?: number
  audioChannels?: 1 | 2 | 6
  assets: MediaAsset[]
  tracks: TimelineTrack[]
  audioBuses?: AudioBusMap
  signal?: AbortSignal
  onProgress?: (progress: number, stage: string) => void
  onHdrInputSample?: (sample: { format: string | null; primaries: string | null; transfer: string | null; matrix: string | null; fullRange: boolean | null }) => void
  hdrRawFrameProvider?: (asset: MediaAsset, sourceTime: number) => Promise<HdrRawInputFrame | undefined>
  onHdrRawFallbackFrame?: () => void
  outputStream?: WritableStream<StreamTargetChunk>
  hdrRawOutputStream?: WritableStream<StreamTargetChunk>
  waitWhilePaused?: (signal?: AbortSignal) => Promise<void>
  rangeStart?: number
  rangeEnd?: number
}

export interface HdrRawInputFrame {
  data: Uint8Array
  layout: PlaneLayout[]
  codedWidth: number
  codedHeight: number
  displayWidth: number
  displayHeight: number
}

export interface SequenceExportResult {
  buffer?: ArrayBuffer
  width: number
  height: number
  duration: number
  mimeType: string
  actualCodec: 'avc' | 'hevc' | 'vp9'
  requestedCodec: 'avc' | 'hevc'
  requiresCodecTranscode: boolean
}

export interface AudioStemExportOptions {
  projectName: string
  stemName: string
  roles: AudioRole[]
  sampleRate?: 44_100 | 48_000 | 96_000
  channels?: 1 | 2 | 6
  assets: MediaAsset[]
  tracks: TimelineTrack[]
  audioBuses?: AudioBusMap
  rangeStart?: number
  rangeEnd?: number
  signal?: AbortSignal
  onProgress?: (progress: number, stage: string) => void
  outputStream?: WritableStream<StreamTargetChunk>
  waitWhilePaused?: (signal?: AbortSignal) => Promise<void>
}

export interface AudioStemExportResult {
  buffer?: ArrayBuffer
  duration: number
  sampleRate: 44_100 | 48_000 | 96_000
  bitDepth: 24
  mimeType: 'audio/wav'
}

export interface AudioMasterExportOptions extends Omit<AudioStemExportOptions, 'stemName' | 'roles' | 'channels'> {
  channels?: 1 | 2 | 6
  bitrateKbps?: number
}

export interface AudioMasterExportResult {
  buffer?: ArrayBuffer
  duration: number
  sampleRate: 44_100 | 48_000 | 96_000
  channels: 1 | 2 | 6
  mimeType: 'audio/mp4'
}

interface PreparedMedia {
  input?: Input
  videoSink?: VideoSampleSink
  videoSamples?: AsyncIterator<MediabunnyVideoSample | null>
  audioSink?: AudioSampleSink
  bitmap?: ImageBitmap
  imageSequenceFiles?: File[]
  imageSequenceCache?: Map<number, ImageBitmap>
}

async function nextPreparedVideoSample(source: PreparedMedia, timestamp: number): Promise<MediabunnyVideoSample | null> {
  if (!source.videoSamples) return source.videoSink?.getSample(timestamp) ?? null
  const next = await source.videoSamples.next()
  return next.done ? null : next.value
}

export async function exportSequence(options: SequenceExportOptions): Promise<SequenceExportResult> {
  return withWritableCleanup(options.outputStream, () => exportSequenceInternal(options))
}

async function exportSequenceInternal(options: SequenceExportOptions): Promise<SequenceExportResult> {
  const renderFps = Math.max(1, Math.min(240, Number(options.fps) || 30))
  const keyFrameEvery = Math.max(1, Math.round(renderFps * 2))
  const audioSampleRate = options.audioSampleRate === 44_100 || options.audioSampleRate === 96_000 ? options.audioSampleRate : 48_000
  const audioBitrate = Math.max(96_000, Math.min(320_000, Math.round((options.audioBitrateKbps ?? 192) * 1_000)))
  const audioChannels = options.audioChannels === 1 ? 1 : options.audioChannels === 6 ? 6 : 2
  const {
    ALL_FORMATS,
    AudioSample,
    AudioSampleSink,
    AudioSampleSource,
    BufferTarget,
    CanvasSource,
    Input,
    Mp4OutputFormat,
    WebMOutputFormat,
    Output,
    StreamTarget,
    VideoSampleSink,
    VideoSample,
    VideoSampleSource,
    canEncodeAudio,
    canEncodeVideo,
  } = await import('mediabunny')

  const matteSourceTrackIds = new Set(options.tracks.flatMap((track) => track.clips.flatMap((clip) => clip.trackMatte ? [clip.trackMatte.sourceTrackId] : [])))
  const videoTracks = options.tracks.filter((track) => track.kind === 'video' && !track.muted && (track.visible !== false || matteSourceTrackIds.has(track.id))).sort((left, right) => (left.compositePriority ?? options.tracks.indexOf(left) * 100) - (right.compositePriority ?? options.tracks.indexOf(right) * 100))
  const captionTracks = options.tracks.filter((track) => track.kind === 'caption' && !track.muted && track.visible !== false)
  const hasSoloAudio = options.tracks.some((track) => (track.kind === 'video' || track.kind === 'audio') && track.solo)
  const audioCandidateTracks = options.tracks.filter((track) => (track.kind === 'video' || track.kind === 'audio') && !track.muted && (!hasSoloAudio || track.solo)).map((track) => ({ ...track, clips: clipsWithAudioTransitionTails(track.clips, renderFps) }))
  const videoClips = videoTracks.flatMap((track) => track.clips).filter((clip) => clip.enabled !== false && clip.assetId && findReadyAsset(options.assets, clip.assetId))
  if (!videoClips.length) throw new Error('출력할 실제 영상 또는 이미지 클립이 없습니다.')

  const timelineDuration = Math.max(...options.tracks.filter((track) => !track.muted).flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)), ...videoClips.map((clip) => clip.start + clip.duration))
  const rangeStart = Math.max(0, Math.min(timelineDuration, options.rangeStart ?? 0))
  const rangeEnd = Math.max(rangeStart + 1 / renderFps, Math.min(timelineDuration, options.rangeEnd ?? timelineDuration))
  const duration = rangeEnd - rangeStart
  const dimensions = exportDimensions(options.preset, options.height)
  const requestedCodec = options.codec ?? 'avc'
  const preserveAlpha = Boolean(options.preserveAlpha)
  let codec: 'avc' | 'hevc' | 'vp9' = preserveAlpha ? 'vp9' : requestedCodec
  const colorMode = options.colorMode ?? 'sdr'
  const rawHdrFallback = colorMode !== 'sdr' && Boolean(options.hdrRawOutputStream)
  if (preserveAlpha && colorMode !== 'sdr') throw new Error('알파 마스터는 SDR ProRes 4444 출력에서 지원됩니다.')
  if (colorMode !== 'sdr' && requestedCodec !== 'hevc') throw new Error('10-bit HDR 출력은 H.265/HEVC 코덱이 필요합니다.')
  if (rawHdrFallback && options.includeAudio) throw new Error('HDR raw 체크포인트는 영상 전용이며 오디오는 연속 마스터로 별도 생성해야 합니다.')
  const hdrCodecString = colorMode === 'sdr' ? undefined : 'hvc1.2.4.L153.B0'
  const bitrate = Math.round((options.bitrateMbps ?? (options.height === 2160 ? 35 : options.height === 1080 ? 8 : 4)) * 1_000_000)
  let canEncode = await canEncodeVideo(codec, { width: dimensions.width, height: dimensions.height, bitrate, fullCodecString: hdrCodecString, alpha: preserveAlpha ? 'keep' : 'discard' })
  if (!canEncode && colorMode === 'sdr' && options.allowCodecFallback && !preserveAlpha) {
    const fallbackCodec = codec === 'hevc' ? 'avc' : 'hevc'
    if (await canEncodeVideo(fallbackCodec, { width: dimensions.width, height: dimensions.height, bitrate })) {
      codec = fallbackCodec
      canEncode = true
    }
  }
  if (!canEncode && !rawHdrFallback) throw new Error(preserveAlpha ? '이 환경의 VP9 알파 인코더를 사용할 수 없어 ProRes 4444 중간 렌더를 만들 수 없습니다.' : colorMode === 'sdr' ? `이 환경의 영상 인코더가 ${codec === 'hevc' ? 'H.265/HEVC' : 'H.264'} 출력을 지원하지 않습니다.` : '이 환경의 영상 인코더가 HEVC Main10 10-bit 출력을 지원하지 않습니다.')

  const prepared = new Map<string, PreparedMedia>()
  const referencedAssets = options.assets.filter((asset) => asset.sourceFile && audioCandidateTracks.some((track) => track.clips.some((clip) => clip.assetId === asset.id)))

  options.onProgress?.(0.01, '미디어 디코더 준비')
  for (const asset of referencedAssets) {
    throwIfAborted(options.signal)
    if (asset.imageSequenceFiles?.length && !(asset.videoDecodable === false && asset.proxyFile)) {
      prepared.set(asset.id, { imageSequenceFiles: asset.imageSequenceFiles, imageSequenceCache: new Map() })
      continue
    }
    if (asset.kind === 'image') {
      const imageFile = asset.imageDecodable === false && asset.proxyFile ? asset.proxyFile : asset.sourceFile!
      prepared.set(asset.id, { bitmap: await createImageBitmap(imageFile) })
      continue
    }
    const decodeFromProxy = Boolean(asset.proxyFile && (asset.videoDecodable === false || Boolean(asset.audioCodec && asset.audioDecodable === false)))
    const decodeFile = decodeFromProxy ? asset.proxyFile! : asset.sourceFile!
    const input = new Input({ source: await createMediaSource(decodeFile, decodeFromProxy ? undefined : asset.sourcePath), formats: ALL_FORMATS })
    const [sourceVideoTrack, sourceAudioTrack] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ])
    prepared.set(asset.id, {
      input,
      videoSink: sourceVideoTrack && await sourceVideoTrack.canDecode() ? new VideoSampleSink(sourceVideoTrack) : undefined,
      audioSink: sourceAudioTrack && await sourceAudioTrack.canDecode() ? new AudioSampleSink(sourceAudioTrack) : undefined,
    })
  }

  const canvas = document.createElement('canvas')
  canvas.width = dimensions.width
  canvas.height = dimensions.height
  const context = canvas.getContext('2d', { alpha: preserveAlpha })
  if (!context) throw new Error('영상 합성 캔버스를 만들 수 없습니다.')
  const adjustmentCanvas = document.createElement('canvas')
  adjustmentCanvas.width = dimensions.width
  adjustmentCanvas.height = dimensions.height
  const adjustmentContext = adjustmentCanvas.getContext('2d', { alpha: preserveAlpha })
  if (!adjustmentContext) throw new Error('조정 레이어 합성 캔버스를 만들 수 없습니다.')
  const layerCanvas = document.createElement('canvas')
  layerCanvas.width = dimensions.width
  layerCanvas.height = dimensions.height
  const layerContext = layerCanvas.getContext('2d', { alpha: true })
  if (!layerContext) throw new Error('HDR 레이어 합성 캔버스를 만들 수 없습니다.')
  const hdrMaskCanvas = document.createElement('canvas')
  hdrMaskCanvas.width = dimensions.width
  hdrMaskCanvas.height = dimensions.height
  const hdrMaskContext = hdrMaskCanvas.getContext('2d', { alpha: true })
  if (!hdrMaskContext) throw new Error('HDR 마스크 캔버스를 만들 수 없습니다.')
  const matteCanvas = document.createElement('canvas')
  matteCanvas.width = dimensions.width
  matteCanvas.height = dimensions.height
  const matteContext = matteCanvas.getContext('2d', { alpha: true, willReadFrequently: true })
  if (!matteContext) throw new Error('트랙 매트 합성 캔버스를 만들 수 없습니다.')

  const target = rawHdrFallback ? undefined : options.outputStream ? new StreamTarget(options.outputStream, { chunked: true, chunkSize: DESKTOP_STREAM_CHUNK_BYTES }) : new BufferTarget()
  const format = preserveAlpha ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: options.outputStream ? false : 'in-memory' })
  const output = target ? new Output({ format, target }) : undefined
  const rawHdrWriter = rawHdrFallback ? options.hdrRawOutputStream!.getWriter() : undefined
  const canvasSource = colorMode === 'sdr' ? new CanvasSource(canvas, {
    codec,
    bitrate,
    keyFrameInterval: 2,
    hardwareAcceleration: options.hardwareAcceleration ?? 'prefer-hardware',
    alpha: preserveAlpha ? 'keep' : 'discard',
  }) : undefined
  const hdrVideoSource = colorMode !== 'sdr' && !rawHdrFallback ? new VideoSampleSource({
    codec: 'hevc',
    bitrate,
    fullCodecString: hdrCodecString,
    keyFrameInterval: 2,
    hardwareAcceleration: options.hardwareAcceleration ?? 'prefer-hardware',
    transform: { width: dimensions.width, height: dimensions.height, fit: 'contain', alpha: 'discard' },
  }) : undefined
  if (canvasSource) output!.addVideoTrack(canvasSource, { name: 'Cutline Program' })
  if (hdrVideoSource) output!.addVideoTrack(hdrVideoSource, { name: colorMode === 'hdr10-pq' ? 'Cutline HDR10 Program' : 'Cutline HLG Program' })
  const hdrConverter = colorMode !== 'sdr' ? new Hdr10FrameConverter(dimensions.width, dimensions.height, colorMode === 'hdr10-pq' ? 'pq' : 'hlg') : undefined
  const hdrLinearCompositor = colorMode !== 'sdr' ? new HdrLinearCompositor(dimensions.width, dimensions.height, colorMode === 'hdr10-pq' ? 'pq' : 'hlg') : undefined

  const audioClips = selectAudioClips(options.assets, audioCandidateTracks, prepared)
  const wantsAudio = options.includeAudio && audioClips.length > 0
  const intermediateAudioCodec = preserveAlpha ? 'opus' : 'aac'
  const audioSupported = wantsAudio && await canEncodeAudio(intermediateAudioCodec, { sampleRate: audioSampleRate, numberOfChannels: audioChannels, bitrate: audioBitrate })
  if (wantsAudio && !audioSupported) throw new Error(`${audioSampleRate / 1_000}kHz ${audioChannels === 1 ? '모노' : audioChannels === 6 ? '5.1' : '스테레오'} ${preserveAlpha ? 'Opus' : 'AAC'} ${audioBitrate / 1_000}kbps 인코딩을 이 환경에서 지원하지 않습니다.`)
  const audioSource = audioSupported ? new AudioSampleSource({
    codec: intermediateAudioCodec,
    bitrate: audioBitrate,
    transform: { sampleRate: audioSampleRate, numberOfChannels: audioChannels },
  }) : undefined
  if (audioSource) output!.addAudioTrack(audioSource, { name: 'Cutline Mix' })

  // Keep one decoder pipeline open per source for the whole render. Calling
  // VideoSampleSink.getSample() for every frame recreates a decoder and seeks
  // from a keyframe each time, which makes even short exports unnecessarily slow.
  const videoTimestampPlans = new Map<string, number[]>()
  const queueVideoSamples = (clip: TimelineClip, timestamp: number) => {
    if (!clip.assetId) return
    const source = prepared.get(clip.assetId)
    const asset = findReadyAsset(options.assets, clip.assetId)
    if (!source?.videoSink || !asset) return
    const timestamps = videoTimestampPlans.get(clip.assetId) ?? []
    const sourceTime = clipSourceTime(clip, timestamp)
    if (clip.frameInterpolation === 'blend' || clip.frameInterpolation === 'optical-flow') {
      const frameRate = Math.max(1, asset.frameRate || 30)
      const exactFrame = Math.max(0, sourceTime) * frameRate
      const lowerFrame = Math.floor(exactFrame)
      const upperFrame = Math.ceil(exactFrame)
      timestamps.push(lowerFrame / frameRate)
      if (upperFrame !== lowerFrame) timestamps.push(upperFrame / frameRate)
    } else timestamps.push(sourceTime)
    videoTimestampPlans.set(clip.assetId, timestamps)
  }
  const totalFrames = Math.ceil(duration * renderFps)
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    const timestamp = rangeStart + frameIndex / renderFps
    const hiddenMatteTrackIds = new Set(videoTracks.flatMap((track) => track.clips.filter((candidate) => candidate.enabled !== false && candidate.trackMatte && !candidate.trackMatte.showSource && timestamp >= candidate.start && timestamp < candidate.start + candidate.duration).map((candidate) => candidate.trackMatte!.sourceTrackId)))
    for (const track of videoTracks) {
      const activeClips = activeVisualClipsAt(track.clips.filter((candidate) => !candidate.adjustmentLayer), timestamp, renderFps)
      for (const candidateClip of activeClips) {
        let clip = candidateClip
        if (hiddenMatteTrackIds.has(track.id) && !clip.trackMatte) continue
        if (!clip.assetId) continue
        const asset = findReadyAsset(options.assets, clip.assetId)
        if (asset) clip = constrainTransitionCarryToAsset(clip, asset, renderFps, timestamp)
        queueVideoSamples(clip, timestamp)
        if (clip.trackMatte) {
          const matteTrack = videoTracks.find((candidate) => candidate.id === clip.trackMatte!.sourceTrackId)
          const matteClip = matteTrack?.clips.filter((candidate) => candidate.enabled !== false && candidate.assetId && timestamp >= candidate.start && timestamp < candidate.start + candidate.duration).sort((left, right) => (right.compositePriority ?? 0) - (left.compositePriority ?? 0))[0]
          if (matteClip) queueVideoSamples(matteClip, timestamp)
        }
      }
    }
  }
  videoTimestampPlans.forEach((timestamps, assetId) => {
    const source = prepared.get(assetId)
    if (source?.videoSink) source.videoSamples = source.videoSink.samplesAtTimestamps(timestamps)[Symbol.asyncIterator]()
  })

  output?.setMetadataTags({ title: options.projectName, comment: 'Created with Cutline' })
  await output?.start()

  try {
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      throwIfAborted(options.signal)
      await options.waitWhilePaused?.(options.signal)
      const outputTimestamp = frameIndex / renderFps
      const timestamp = rangeStart + outputTimestamp
      const hiddenMatteTrackIds = new Set(videoTracks.flatMap((track) => track.clips.filter((candidate) => candidate.enabled !== false && candidate.trackMatte && !candidate.trackMatte.showSource && timestamp >= candidate.start && timestamp < candidate.start + candidate.duration).map((candidate) => candidate.trackMatte!.sourceTrackId)))
      const activePictureClips = videoTracks.flatMap((track) => hiddenMatteTrackIds.has(track.id) ? [] : activeVisualClipsAt(track.clips.filter((candidate) => !candidate.adjustmentLayer), timestamp, renderFps))
      const activeAdjustments = videoTracks.flatMap((track) => track.clips).filter((clip) => clip.enabled !== false && clip.adjustmentLayer && timestamp >= clip.start && timestamp < clip.start + clip.duration)
      const activeCaption = captionTracks.some((track) => track.clips.some((clip) => clip.enabled !== false && timestamp >= clip.start && timestamp < clip.start + clip.duration))
      const nativeHdrClip = colorMode !== 'sdr' && activePictureClips.length === 1 && !activeAdjustments.length && !activeCaption
        ? activePictureClips.find((clip) => {
          const asset = clip.assetId ? findReadyAsset(options.assets, clip.assetId) : undefined
          return asset && canUseRawHdrTransform(clip, asset, timestamp, colorMode)
        })
        : undefined
      const useLinearHdr = colorMode !== 'sdr' && activeAdjustments.every((adjustment) => canUseLinearHdrAdjustment(adjustment, timestamp))
      let nativeHdrSample: Awaited<ReturnType<VideoSampleSink['getSample']>> | undefined
      let nativeHdrFallbackFrame: HdrRawInputFrame | undefined
      drawBackground(context, dimensions.width, dimensions.height, preserveAlpha)
      if (useLinearHdr) await hdrLinearCompositor!.begin()

      for (const track of videoTracks) {
        const activeClips = activeVisualClipsAt(track.clips.filter((candidate) => !candidate.adjustmentLayer), timestamp, renderFps)
        for (const candidateClip of activeClips) {
          let clip = candidateClip
          if (hiddenMatteTrackIds.has(track.id) && !clip.trackMatte) continue
          if (!clip.assetId) continue
          const asset = findReadyAsset(options.assets, clip.assetId)
          const source = prepared.get(clip.assetId)
          if (asset && source) {
            clip = constrainTransitionCarryToAsset(clip, asset, renderFps, timestamp)
            if (clip.trackMatte) {
              const matteTrack = videoTracks.find((candidate) => candidate.id === clip.trackMatte!.sourceTrackId)
              const matteClip = matteTrack?.clips.filter((candidate) => candidate.enabled !== false && candidate.assetId && timestamp >= candidate.start && timestamp < candidate.start + candidate.duration).sort((left, right) => (right.compositePriority ?? 0) - (left.compositePriority ?? 0))[0]
              const matteAsset = matteClip?.assetId ? findReadyAsset(options.assets, matteClip.assetId) : undefined
              const matteSource = matteClip?.assetId ? prepared.get(matteClip.assetId) : undefined
              clearLayerCanvas(layerContext, dimensions.width, dimensions.height)
              clearLayerCanvas(matteContext, dimensions.width, dimensions.height)
              const rendered = await drawPreparedVisualLayer(layerContext, source, asset, clip, timestamp, dimensions.width, dimensions.height)
              if (matteClip && matteAsset && matteSource) await drawPreparedVisualLayer(matteContext, matteSource, matteAsset, matteClip, timestamp, dimensions.width, dimensions.height)
              if (rendered) {
                applyTrackMatteCanvas(layerContext, matteContext, matteCanvas, clip.trackMatte.mode)
                const blendMode = resolveVisualEffects(clip, timestamp).blendMode
                if (useLinearHdr) await hdrLinearCompositor!.addCanvas(layerCanvas, blendMode)
                else {
                  context.save()
                  context.globalCompositeOperation = !blendMode || blendMode === 'normal' ? 'source-over' : blendMode
                  context.drawImage(layerCanvas, 0, 0)
                  context.restore()
                }
              }
              continue
            }
            if (source.videoSink && (clip.frameInterpolation === 'blend' || clip.frameInterpolation === 'optical-flow')) {
              clearLayerCanvas(layerContext, dimensions.width, dimensions.height)
              const rendered = await drawPreparedVisualLayer(layerContext, source, asset, clip, timestamp, dimensions.width, dimensions.height)
              if (rendered) {
                const blendMode = resolveVisualEffects(clip, timestamp).blendMode
                if (useLinearHdr) await hdrLinearCompositor!.addCanvas(layerCanvas, blendMode)
                else {
                  context.save()
                  context.globalCompositeOperation = !blendMode || blendMode === 'normal' ? 'source-over' : blendMode
                  context.drawImage(layerCanvas, 0, 0)
                  context.restore()
                }
              }
              continue
            }
            if (source.bitmap) {
              if (useLinearHdr) {
                clearLayerCanvas(layerContext, dimensions.width, dimensions.height)
                drawVisual(layerContext, source.bitmap, source.bitmap.width, source.bitmap.height, asset, clip, timestamp, dimensions.width, dimensions.height, 1, 'source-over')
                await hdrLinearCompositor!.addCanvas(layerCanvas, resolveVisualEffects(clip, timestamp).blendMode)
              } else {
                drawVisual(context, source.bitmap, source.bitmap.width, source.bitmap.height, asset, clip, timestamp, dimensions.width, dimensions.height)
              }
            } else if (source.videoSink) {
              const sample = await nextPreparedVideoSample(source, clipSourceTime(clip, timestamp))
              if (sample) {
                options.onHdrInputSample?.({ format: sample.format, primaries: sample.colorSpace.primaries, transfer: sample.colorSpace.transfer, matrix: sample.colorSpace.matrix, fullRange: sample.colorSpace.fullRange })
                const expectedTransfer = colorMode === 'hdr10-pq' ? 'pq' : 'hlg'
                const metadataMatchesHdr = String(sample.colorSpace.primaries) === 'bt2020' && String(sample.colorSpace.transfer) === expectedTransfer && String(sample.colorSpace.matrix) === 'bt2020-ncl'
                const explicitHdrInterpretation = asset.sourceColorSpaceOverride === `rec2020-${expectedTransfer}`
                const fallbackFrame = sample.format === null ? await options.hdrRawFrameProvider?.(asset, clipSourceTime(clip, timestamp)) : undefined
                if (fallbackFrame) options.onHdrRawFallbackFrame?.()
                const rawHdr = useLinearHdr && canUseRawHdrTransform(clip, asset, timestamp, colorMode) && (sample.format === 'I420P10' || Boolean(fallbackFrame)) && (metadataMatchesHdr || explicitHdrInterpretation) && sample.colorSpace.fullRange === false && sample.rotation === 0
                if (useLinearHdr && sample.format === null && (metadataMatchesHdr || explicitHdrInterpretation) && !rawHdr) {
                  sample.close()
                  if (!fallbackFrame) throw new Error(`“${asset.name}”의 10-bit HDR 프레임을 브라우저 디코더가 노출하지 않았고 원본 파일 디코드 경로를 사용할 수 없습니다. 원본 파일을 다시 연결해주세요.`)
                  throw new Error(`“${asset.name}”에는 현재 raw HDR 경로가 지원하지 않는 원본 해석·효과 스택·프레임 보간이 적용되어 있습니다. 해당 처리를 제거하거나 중간 HDR 파일로 렌더한 뒤 다시 시도해주세요.`)
                }
                const directHdr = rawHdr && !fallbackFrame && metadataMatchesHdr && clip.id === nativeHdrClip?.id && canUseNativeHdrSample(clip, asset, timestamp, colorMode) && sample.displayWidth === dimensions.width && sample.displayHeight === dimensions.height
                const directFallback = rawHdr && Boolean(fallbackFrame) && metadataMatchesHdr && clip.id === nativeHdrClip?.id && canUseNativeHdrSample(clip, asset, timestamp, colorMode) && fallbackFrame!.displayWidth === dimensions.width && fallbackFrame!.displayHeight === dimensions.height
                if (directFallback) {
                  nativeHdrFallbackFrame = fallbackFrame
                  sample.close()
                } else if (directHdr) {
                  nativeHdrSample = sample
                } else {
                  try {
                    if (rawHdr) {
                      const data = fallbackFrame?.data ?? new Uint8Array(sample.allocationSize())
                      const layout = fallbackFrame?.layout ?? await sample.copyTo(data)
                      const codedWidth = fallbackFrame?.codedWidth ?? sample.codedWidth
                      const codedHeight = fallbackFrame?.codedHeight ?? sample.codedHeight
                      if (!fallbackFrame) normalizeDecodedI420P10(data, layout, codedWidth, codedHeight)
                      const transform = resolveClipTransform(clip, timestamp)
                      const effects = resolveVisualEffects(clip, timestamp)
                      const displayWidth = fallbackFrame?.displayWidth ?? sample.displayWidth
                      const displayHeight = fallbackFrame?.displayHeight ?? sample.displayHeight
                      const mask = hasActiveHdrMask(effects) ? renderHdrMask(hdrMaskCanvas, hdrMaskContext, displayWidth, displayHeight, transform, effects, dimensions.width, dimensions.height) : undefined
                      const face = effects.faceMosaic ? nearestFace(asset.faceTrack, clipSourceTime(clip, timestamp)) : undefined
                      const rawFrame = { data, layout, codedWidth, codedHeight, visibleRect: { x: 0, y: 0, width: codedWidth, height: codedHeight }, displayWidth, displayHeight }
                      if (fallbackFrame && clip.id === nativeHdrClip?.id && hasNeutralHdrEffects(effects)) {
                        await hdrLinearCompositor!.addRawBase(rawFrame, transform)
                        await hdrLinearCompositor!.addAdjustment({ ...defaultColorAdjustment(), ...clip.colorAdjustment })
                      } else await hdrLinearCompositor!.addRaw(rawFrame, transform, { ...defaultColorAdjustment(), ...clip.colorAdjustment }, effects, mask, face)
                    } else if (useLinearHdr) {
                      clearLayerCanvas(layerContext, dimensions.width, dimensions.height)
                      drawVisual(layerContext, sample, sample.displayWidth, sample.displayHeight, asset, clip, timestamp, dimensions.width, dimensions.height, 1, 'source-over')
                      await hdrLinearCompositor!.addCanvas(layerCanvas, resolveVisualEffects(clip, timestamp).blendMode)
                    } else {
                      drawVisual(context, sample, sample.displayWidth, sample.displayHeight, asset, clip, timestamp, dimensions.width, dimensions.height)
                    }
                  } finally {
                    sample.close()
                  }
                }
              }
            }
          }
        }
      }

      for (const adjustment of activeAdjustments) {
        if (useLinearHdr) await hdrLinearCompositor!.addAdjustment({ ...defaultColorAdjustment(), ...adjustment.colorAdjustment }, 1, resolveVisualEffects(adjustment, timestamp).blur)
        else applyAdjustmentLayer(context, adjustmentContext, adjustmentCanvas, adjustment, timestamp, dimensions.width, dimensions.height, preserveAlpha)
      }

      for (const captionTrack of captionTracks) {
        const captions = activeVisualClipsAt(captionTrack.clips, timestamp, renderFps)
        for (const caption of captions) {
          if (useLinearHdr) {
            clearLayerCanvas(layerContext, dimensions.width, dimensions.height)
            drawCaption(layerContext, caption, timestamp, dimensions.width, dimensions.height)
            await hdrLinearCompositor!.addCanvas(layerCanvas)
          } else {
            drawCaption(context, caption, timestamp, dimensions.width, dimensions.height)
          }
        }
      }

      if (canvasSource) await canvasSource.add(outputTimestamp, 1 / renderFps, { keyFrame: frameIndex % keyFrameEvery === 0 })
      else if ((hdrVideoSource || rawHdrWriter) && hdrConverter) {
        try {
          let sample: MediabunnyVideoSample
          if (nativeHdrFallbackFrame) {
            sample = new VideoSample(new Uint8Array(nativeHdrFallbackFrame.data), { format: 'I420P10', codedWidth: nativeHdrFallbackFrame.codedWidth, codedHeight: nativeHdrFallbackFrame.codedHeight, displayWidth: nativeHdrFallbackFrame.displayWidth, displayHeight: nativeHdrFallbackFrame.displayHeight, timestamp: outputTimestamp, duration: 1 / renderFps, layout: nativeHdrFallbackFrame.layout, colorSpace: { primaries: 'bt2020', transfer: colorMode === 'hdr10-pq' ? 'pq' : 'hlg', matrix: 'bt2020-ncl', fullRange: false } as unknown as VideoColorSpaceInit, encodeOptions: { keyFrame: frameIndex % keyFrameEvery === 0 } })
          } else if (nativeHdrSample) {
            const copyOptions = nativeHdrSample.format === null ? { format: 'I420P10' } as unknown as VideoFrameCopyToOptions : {}
            const data = new Uint8Array(nativeHdrSample.allocationSize(copyOptions))
            const layout = await nativeHdrSample.copyTo(data, copyOptions)
            normalizeDecodedI420P10(data, layout, nativeHdrSample.codedWidth, nativeHdrSample.codedHeight)
            sample = new VideoSample(data, { format: 'I420P10', codedWidth: nativeHdrSample.codedWidth, codedHeight: nativeHdrSample.codedHeight, visibleRect: nativeHdrSample.visibleRect, displayWidth: nativeHdrSample.displayWidth, displayHeight: nativeHdrSample.displayHeight, rotation: nativeHdrSample.rotation, timestamp: outputTimestamp, duration: 1 / renderFps, layout, colorSpace: nativeHdrSample.colorSpace.toJSON(), encodeOptions: { keyFrame: frameIndex % keyFrameEvery === 0 } })
          } else if (useLinearHdr) {
            const frame = await hdrLinearCompositor!.finish()
            sample = new VideoSample(frame.data, { format: 'I420P10', codedWidth: dimensions.width, codedHeight: dimensions.height, timestamp: outputTimestamp, duration: 1 / renderFps, layout: frame.layout, colorSpace: frame.colorSpace, encodeOptions: { keyFrame: frameIndex % keyFrameEvery === 0 } })
          } else {
            const frame = await hdrConverter.convert(canvas)
            sample = new VideoSample(frame.data, { format: 'I420P10', codedWidth: dimensions.width, codedHeight: dimensions.height, timestamp: outputTimestamp, duration: 1 / renderFps, layout: frame.layout, colorSpace: frame.colorSpace, encodeOptions: { keyFrame: frameIndex % keyFrameEvery === 0 } })
          }
          try {
            if (rawHdrWriter) {
              const copied = new Uint8Array(sample.allocationSize())
              const layout = await sample.copyTo(copied)
              const packed = packI420P10(copied, layout, dimensions.width, dimensions.height)
              await rawHdrWriter.write({ type: 'write', position: frameIndex * packed.byteLength, data: packed })
            } else await hdrVideoSource!.add(sample, { keyFrame: frameIndex % keyFrameEvery === 0 })
          } finally { sample.close() }
        } finally {
          nativeHdrSample?.close()
        }
      }
      if (frameIndex % 5 === 0) options.onProgress?.(0.05 + (frameIndex / totalFrames) * 0.78, '영상 프레임 합성')
    }

    if (audioSource) {
      await appendAudio(audioClips, prepared, audioSource, AudioSample, rangeStart, rangeEnd, normalizeAudioBuses(options.audioBuses), options.signal, (progress) => options.onProgress?.(0.83 + progress * 0.13, `${audioSampleRate / 1_000}kHz 오디오 버스 · 덕킹 · 합성`), options.waitWhilePaused, audioClips, audioSampleRate, audioChannels)
    }

    options.onProgress?.(0.97, preserveAlpha ? '알파 중간 렌더 마무리' : 'MP4 마무리')
    if (rawHdrWriter) await rawHdrWriter.close()
    else await output!.finalize()
    const buffer = target instanceof BufferTarget ? target.buffer ?? undefined : undefined
    if (!rawHdrFallback && !buffer && !options.outputStream) throw new Error('출력 버퍼를 만들지 못했습니다.')
    options.onProgress?.(1, '완료')
    return {
      buffer,
      width: dimensions.width,
      height: dimensions.height,
      duration,
      mimeType: rawHdrFallback ? 'application/octet-stream' : preserveAlpha ? 'video/webm' : 'video/mp4',
      actualCodec: codec,
      requestedCodec,
      requiresCodecTranscode: preserveAlpha ? false : codec !== requestedCodec,
    }
  } catch (error) {
    await rawHdrWriter?.abort(error).catch(() => undefined)
    if (output?.state === 'started') await output.cancel().catch(() => undefined)
    throw error
  } finally {
    prepared.forEach((source) => {
      source.bitmap?.close()
      source.imageSequenceCache?.forEach((bitmap) => bitmap.close())
      source.input?.dispose()
    })
    hdrConverter?.destroy()
    hdrLinearCompositor?.destroy()
  }
}

export async function exportAudioStem(options: AudioStemExportOptions): Promise<AudioStemExportResult> {
  return withWritableCleanup(options.outputStream, () => exportAudioStemInternal(options))
}

export async function exportAudioMaster(options: AudioMasterExportOptions): Promise<AudioMasterExportResult> {
  return withWritableCleanup(options.outputStream, () => exportAudioMasterInternal(options))
}

async function exportAudioMasterInternal(options: AudioMasterExportOptions): Promise<AudioMasterExportResult> {
  const { ALL_FORMATS, AudioSample, AudioSampleSink, AudioSampleSource, BufferTarget, Input, Mp4OutputFormat, Output, StreamTarget, canEncodeAudio } = await import('mediabunny')
  const hasSoloAudio = options.tracks.some((track) => (track.kind === 'video' || track.kind === 'audio') && track.solo)
  const audioTracks = options.tracks.filter((track) => (track.kind === 'video' || track.kind === 'audio') && !track.muted && (!hasSoloAudio || track.solo)).map((track) => ({ ...track, clips: clipsWithAudioTransitionTails(track.clips, 30) }))
  const prepared = new Map<string, PreparedMedia>()
  const referencedAssets = options.assets.filter((asset) => asset.sourceFile && audioTracks.some((track) => track.clips.some((clip) => clip.assetId === asset.id && clip.enabled !== false && !clip.audioDisabled)))
  options.onProgress?.(0.01, '연속 오디오 마스터 디코더 준비')
  for (const asset of referencedAssets) {
    throwIfAborted(options.signal)
    if (asset.kind === 'image') continue
    const decodeFromProxy = Boolean(asset.proxyFile && (asset.videoDecodable === false || Boolean(asset.audioCodec && asset.audioDecodable === false)))
    const decodeFile = decodeFromProxy ? asset.proxyFile! : asset.sourceFile!
    const input = new Input({ source: await createMediaSource(decodeFile, decodeFromProxy ? undefined : asset.sourcePath), formats: ALL_FORMATS })
    const sourceAudioTrack = await input.getPrimaryAudioTrack()
    prepared.set(asset.id, { input, audioSink: sourceAudioTrack && await sourceAudioTrack.canDecode() ? new AudioSampleSink(sourceAudioTrack) : undefined })
  }
  const audioPlans = selectAudioClips(options.assets, audioTracks, prepared)
  const sampleRate = options.sampleRate === 44_100 || options.sampleRate === 96_000 ? options.sampleRate : 48_000
  const channels = options.channels === 1 ? 1 : options.channels === 6 ? 6 : 2
  const bitrate = Math.max(96_000, Math.min(320_000, Math.round((options.bitrateKbps ?? 192) * 1_000)))
  const timelineEnd = Math.max(1 / sampleRate, ...options.tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)))
  const rangeStart = Math.max(0, Math.min(timelineEnd, options.rangeStart ?? 0))
  const rangeEnd = Math.max(rangeStart + 1 / sampleRate, Math.min(timelineEnd, options.rangeEnd ?? timelineEnd))
  if (!audioPlans.length) throw new Error('연속 오디오 마스터에 포함할 활성 오디오가 없습니다.')
  if (!await canEncodeAudio('aac', { sampleRate, numberOfChannels: channels, bitrate })) throw new Error(`${sampleRate / 1_000}kHz ${channels === 1 ? '모노' : channels === 6 ? '5.1' : '스테레오'} AAC ${bitrate / 1_000}kbps 인코딩을 이 환경에서 지원하지 않습니다.`)
  const target = options.outputStream ? new StreamTarget(options.outputStream, { chunked: true, chunkSize: DESKTOP_STREAM_CHUNK_BYTES }) : new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: options.outputStream ? false : 'in-memory' }), target })
  const audioSource = new AudioSampleSource({ codec: 'aac', bitrate, transform: { sampleRate, numberOfChannels: channels } })
  output.addAudioTrack(audioSource, { name: 'Cutline Continuous Mix' })
  output.setMetadataTags({ title: `${options.projectName} · Continuous Mix`, comment: 'Single-pass audio master created with Cutline' })
  await output.start()
  try {
    await appendAudio(audioPlans, prepared, audioSource, AudioSample, rangeStart, rangeEnd, normalizeAudioBuses(options.audioBuses), options.signal, (progress) => options.onProgress?.(0.03 + progress * 0.94, `${sampleRate / 1_000}kHz 연속 오디오 합성`), options.waitWhilePaused, audioPlans, sampleRate, channels)
    options.onProgress?.(0.98, '연속 AAC 마스터 마무리')
    await output.finalize()
    const buffer = target instanceof BufferTarget ? target.buffer ?? undefined : undefined
    if (!buffer && !options.outputStream) throw new Error('연속 오디오 마스터 버퍼를 만들지 못했습니다.')
    options.onProgress?.(1, '연속 오디오 마스터 완료')
    return { buffer, duration: rangeEnd - rangeStart, sampleRate, channels, mimeType: 'audio/mp4' }
  } catch (error) {
    if (output.state === 'started') await output.cancel().catch(() => undefined)
    throw error
  } finally {
    prepared.forEach((source) => source.input?.dispose())
  }
}

async function exportAudioStemInternal(options: AudioStemExportOptions): Promise<AudioStemExportResult> {
  const { ALL_FORMATS, AudioSample, AudioSampleSink, AudioSampleSource, BufferTarget, Input, Output, StreamTarget, WavOutputFormat } = await import('mediabunny')
  const hasSoloAudio = options.tracks.some((track) => (track.kind === 'video' || track.kind === 'audio') && track.solo)
  const audioTracks = options.tracks.filter((track) => (track.kind === 'video' || track.kind === 'audio') && !track.muted && (!hasSoloAudio || track.solo)).map((track) => ({ ...track, clips: clipsWithAudioTransitionTails(track.clips, 30) }))
  const prepared = new Map<string, PreparedMedia>()
  const referencedAssets = options.assets.filter((asset) => asset.sourceFile && audioTracks.some((track) => track.clips.some((clip) => clip.assetId === asset.id && clip.enabled !== false && !clip.audioDisabled)))
  options.onProgress?.(0.01, `${options.stemName} 디코더 준비`)
  for (const asset of referencedAssets) {
    throwIfAborted(options.signal)
    if (asset.kind === 'image') continue
    const decodeFromProxy = Boolean(asset.proxyFile && (asset.videoDecodable === false || Boolean(asset.audioCodec && asset.audioDecodable === false)))
    const decodeFile = decodeFromProxy ? asset.proxyFile! : asset.sourceFile!
    const input = new Input({ source: await createMediaSource(decodeFile, decodeFromProxy ? undefined : asset.sourcePath), formats: ALL_FORMATS })
    const sourceAudioTrack = await input.getPrimaryAudioTrack()
    prepared.set(asset.id, { input, audioSink: sourceAudioTrack && await sourceAudioTrack.canDecode() ? new AudioSampleSink(sourceAudioTrack) : undefined })
  }
  const allPlans = selectAudioClips(options.assets, audioTracks, prepared)
  const selectedRoles = new Set(options.roles)
  const stemPlans = allPlans.filter(({ clip, track }) => selectedRoles.has(track.audioRole ?? ({ ...defaultAudioAdjustment(), ...clip.audioAdjustment }).role))
  const sampleRate = options.sampleRate === 44_100 || options.sampleRate === 96_000 ? options.sampleRate : 48_000
  const timelineEnd = Math.max(1 / sampleRate, ...options.tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)))
  const rangeStart = Math.max(0, Math.min(timelineEnd, options.rangeStart ?? 0))
  const rangeEnd = Math.max(rangeStart + 1 / sampleRate, Math.min(timelineEnd, options.rangeEnd ?? timelineEnd))
  const target = options.outputStream ? new StreamTarget(options.outputStream, { chunked: true, chunkSize: DESKTOP_STREAM_CHUNK_BYTES }) : new BufferTarget()
  const output = new Output({ format: new WavOutputFormat({ large: rangeEnd - rangeStart > 10_000, metadataFormat: 'info' }), target })
  const outputChannels = options.channels === 1 ? 1 : options.channels === 6 ? 6 : 2
  const audioSource = new AudioSampleSource({ codec: 'pcm-s24', transform: { sampleRate, numberOfChannels: outputChannels } })
  output.addAudioTrack(audioSource, { name: `${options.stemName} Stem` })
  output.setMetadataTags({ title: `${options.projectName} · ${options.stemName}`, comment: `${sampleRate / 1_000}kHz 24-bit audio deliverable created with Cutline` })
  await output.start()
  try {
    const stemBuses = normalizeAudioBuses(options.audioBuses)
    audioRoles.forEach((role) => { stemBuses[role] = { ...stemBuses[role], solo: false } })
    await appendAudio(stemPlans, prepared, audioSource, AudioSample, rangeStart, rangeEnd, stemBuses, options.signal, (progress) => options.onProgress?.(0.03 + progress * 0.94, `${options.stemName} ${sampleRate / 1_000}kHz 24-bit WAV 합성`), options.waitWhilePaused, allPlans, sampleRate, outputChannels)
    options.onProgress?.(0.98, `${options.stemName} WAV 마무리`)
    await output.finalize()
    const buffer = target instanceof BufferTarget ? target.buffer ?? undefined : undefined
    if (!buffer && !options.outputStream) throw new Error(`${options.stemName} WAV 버퍼를 만들지 못했습니다.`)
    options.onProgress?.(1, `${options.stemName} 완료`)
    return { buffer, duration: rangeEnd - rangeStart, sampleRate, bitDepth: 24, mimeType: 'audio/wav' }
  } catch (error) {
    if (output.state === 'started') await output.cancel().catch(() => undefined)
    throw error
  } finally {
    prepared.forEach((source) => source.input?.dispose())
  }
}

function packI420P10(data: Uint8Array, layout: PlaneLayout[], width: number, height: number): Uint8Array<ArrayBuffer> {
  if (layout.length < 3) throw new Error('I420P10 프레임의 Y/U/V plane 구성이 올바르지 않습니다.')
  const lumaBytes = width * height * 2
  const chromaPlaneBytes = width * height / 2
  const packed = new Uint8Array(lumaBytes + chromaPlaneBytes * 2)
  const planes = [
    { source: layout[0], rows: height, rowBytes: width * 2, targetOffset: 0 },
    { source: layout[1], rows: height / 2, rowBytes: width, targetOffset: lumaBytes },
    { source: layout[2], rows: height / 2, rowBytes: width, targetOffset: lumaBytes + chromaPlaneBytes },
  ]
  for (const plane of planes) {
    if (plane.source.stride < plane.rowBytes) throw new Error('I420P10 plane stride가 행 크기보다 작습니다.')
    for (let row = 0; row < plane.rows; row++) {
      const sourceStart = plane.source.offset + row * plane.source.stride
      packed.set(data.subarray(sourceStart, sourceStart + plane.rowBytes), plane.targetOffset + row * plane.rowBytes)
    }
  }
  return packed
}

export function normalizeDecodedI420P10(data: Uint8Array, layout: PlaneLayout[], codedWidth: number, codedHeight: number): boolean {
  if (layout.length < 3) throw new Error('I420P10 디코딩 프레임의 Y/U/V plane 구성이 올바르지 않습니다.')
  const planes = [
    { source: layout[0], rows: codedHeight, samples: codedWidth },
    { source: layout[1], rows: Math.ceil(codedHeight / 2), samples: Math.ceil(codedWidth / 2) },
    { source: layout[2], rows: Math.ceil(codedHeight / 2), samples: Math.ceil(codedWidth / 2) },
  ]
  const sampleValue = (offset: number) => data[offset] | (data[offset + 1] << 8)
  let highBitAligned = false
  for (const plane of planes) {
    if (plane.source.stride < plane.samples * 2) throw new Error('I420P10 디코딩 plane stride가 행 크기보다 작습니다.')
    for (let row = 0; row < plane.rows && !highBitAligned; row++) {
      const rowOffset = plane.source.offset + row * plane.source.stride
      for (let column = 0; column < plane.samples; column++) {
        if (sampleValue(rowOffset + column * 2) > 1023) { highBitAligned = true; break }
      }
    }
    if (highBitAligned) break
  }
  if (!highBitAligned) return false
  for (const plane of planes) {
    for (let row = 0; row < plane.rows; row++) {
      const rowOffset = plane.source.offset + row * plane.source.stride
      for (let column = 0; column < plane.samples; column++) {
        const offset = rowOffset + column * 2
        const normalized = sampleValue(offset) >> 6
        data[offset] = normalized & 0xff
        data[offset + 1] = normalized >> 8
      }
    }
  }
  return true
}

function clearLayerCanvas(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalAlpha = 1
  context.globalCompositeOperation = 'copy'
  context.filter = 'none'
  context.clearRect(0, 0, width, height)
  context.restore()
}

export function applyTrackMatteCanvas(
  targetContext: CanvasRenderingContext2D,
  matteContext: CanvasRenderingContext2D,
  matteCanvas: HTMLCanvasElement,
  mode: NonNullable<TimelineClip['trackMatte']>['mode'],
): void {
  if (mode === 'luma' || mode === 'luma-inverted') {
    const image = matteContext.getImageData(0, 0, matteCanvas.width, matteCanvas.height)
    for (let offset = 0; offset < image.data.length; offset += 4) {
      const luma = (image.data[offset] * 0.2126 + image.data[offset + 1] * 0.7152 + image.data[offset + 2] * 0.0722) * image.data[offset + 3] / 255
      image.data[offset] = 255
      image.data[offset + 1] = 255
      image.data[offset + 2] = 255
      image.data[offset + 3] = mode === 'luma-inverted' ? 255 - luma : luma
    }
    matteContext.putImageData(image, 0, 0)
  }
  targetContext.save()
  targetContext.setTransform(1, 0, 0, 1, 0, 0)
  targetContext.globalAlpha = 1
  targetContext.filter = 'none'
  targetContext.globalCompositeOperation = mode === 'alpha-inverted' ? 'destination-out' : 'destination-in'
  targetContext.drawImage(matteCanvas, 0, 0)
  targetContext.restore()
}

export function applyAdjustmentLayer(
  context: CanvasRenderingContext2D,
  adjustmentContext: CanvasRenderingContext2D,
  adjustmentCanvas: HTMLCanvasElement,
  clip: TimelineClip,
  timelineTime: number,
  width: number,
  height: number,
  preserveAlpha = false,
): void {
  adjustmentContext.save()
  adjustmentContext.setTransform(1, 0, 0, 1, 0, 0)
  adjustmentContext.globalAlpha = 1
  adjustmentContext.filter = 'none'
  if (preserveAlpha) adjustmentContext.clearRect(0, 0, width, height)
  else {
    adjustmentContext.fillStyle = '#08080b'
    adjustmentContext.fillRect(0, 0, width, height)
  }
  adjustmentContext.filter = visualFilter(clip.colorAdjustment, resolveVisualEffects(clip, timelineTime))
  adjustmentContext.drawImage(context.canvas, 0, 0, width, height)
  applyEmbeddedColorLut(adjustmentContext, width, height, clip.colorAdjustment?.customLut, clip.colorAdjustment?.lutIntensity)
  applyColorCurves(adjustmentContext, width, height, clip.colorAdjustment)
  applyColorQualifier(adjustmentContext, width, height, clip.colorAdjustment)
  applyColorNodeGraph(adjustmentContext, width, height, clip.colorAdjustment)
  adjustmentContext.translate(width / 2, height / 2)
  drawVignette(adjustmentContext, width, height, clip.colorAdjustment?.vignette ?? 0)
  adjustmentContext.restore()
  context.save()
  context.globalAlpha = 1
  context.filter = 'none'
  context.globalCompositeOperation = preserveAlpha ? 'copy' : 'source-over'
  context.drawImage(adjustmentCanvas, 0, 0, width, height)
  context.restore()
}

function findReadyAsset(assets: MediaAsset[], id: string): MediaAsset | undefined {
  return assets.find((asset) => asset.id === id && asset.status === 'ready' && asset.sourceFile)
}

async function drawPreparedVisualLayer(
  context: CanvasRenderingContext2D,
  source: PreparedMedia,
  asset: MediaAsset,
  clip: TimelineClip,
  timelineTime: number,
  width: number,
  height: number,
): Promise<boolean> {
  if (source.imageSequenceFiles?.length) {
    const sourceTime = clipSourceTime(clip, timelineTime)
    const frameRate = Math.max(1, asset.imageSequenceFrameRate ?? asset.frameRate ?? 30)
    const frameIndex = Math.max(0, Math.min(source.imageSequenceFiles.length - 1, Math.floor(Math.max(0, sourceTime) * frameRate + 1e-6)))
    let bitmap = source.imageSequenceCache?.get(frameIndex)
    if (!bitmap) {
      bitmap = await createImageBitmap(source.imageSequenceFiles[frameIndex])
      source.imageSequenceCache?.set(frameIndex, bitmap)
      if ((source.imageSequenceCache?.size ?? 0) > 12) {
        const staleIndex = source.imageSequenceCache!.keys().next().value as number | undefined
        if (staleIndex !== undefined && staleIndex !== frameIndex) {
          source.imageSequenceCache!.get(staleIndex)?.close()
          source.imageSequenceCache!.delete(staleIndex)
        }
      }
    }
    drawVisual(context, bitmap, bitmap.width, bitmap.height, asset, clip, timelineTime, width, height, 1, 'source-over')
    return true
  }
  if (source.bitmap) {
    drawVisual(context, source.bitmap, source.bitmap.width, source.bitmap.height, asset, clip, timelineTime, width, height, 1, 'source-over')
    return true
  }
  if (!source.videoSink) return false
  const sourceTime = clipSourceTime(clip, timelineTime)
  if (clip.frameInterpolation !== 'blend' && clip.frameInterpolation !== 'optical-flow') {
    const sample = await nextPreparedVideoSample(source, sourceTime)
    if (!sample) return false
    try {
      drawVisual(context, sample, sample.displayWidth, sample.displayHeight, asset, clip, timelineTime, width, height, 1, 'source-over')
      return true
    } finally {
      sample.close()
    }
  }
  const frameRate = Math.max(1, asset.frameRate || 30)
  const exactFrame = Math.max(0, sourceTime) * frameRate
  const lowerFrame = Math.floor(exactFrame)
  const upperFrame = Math.ceil(exactFrame)
  const fraction = exactFrame - lowerFrame
  const lower = await nextPreparedVideoSample(source, lowerFrame / frameRate)
  const upper = upperFrame === lowerFrame ? undefined : await nextPreparedVideoSample(source, upperFrame / frameRate)
  const primary = lower ?? upper
  if (!primary) return false
  try {
    if (!upper || !lower || fraction <= 0.0001) {
      drawVisual(context, primary, primary.displayWidth, primary.displayHeight, asset, clip, timelineTime, width, height, 1, 'source-over')
      return true
    }
    const blendCanvas = frameBlendCanvasFor(context, lower.displayWidth, lower.displayHeight)
    const lowerFrameSource = lower.toVideoFrame()
    const upperFrameSource = upper.toVideoFrame()
    try {
      if (clip.frameInterpolation === 'optical-flow') {
        drawMotionCompensatedFrame(blendCanvas, lowerFrameSource, upperFrameSource, lower.displayWidth, lower.displayHeight, fraction)
        drawVisual(context, blendCanvas, blendCanvas.width, blendCanvas.height, asset, clip, timelineTime, width, height, 1, 'source-over')
        return true
      }
      const blendContext = blendCanvas.getContext('2d', { alpha: true })
      if (!blendContext) return false
      blendContext.save()
      blendContext.setTransform(1, 0, 0, 1, 0, 0)
      blendContext.globalCompositeOperation = 'copy'
      blendContext.globalAlpha = 1
      blendContext.drawImage(lowerFrameSource, 0, 0, blendCanvas.width, blendCanvas.height)
      blendContext.globalCompositeOperation = 'source-over'
      blendContext.globalAlpha = fraction
      blendContext.drawImage(upperFrameSource, 0, 0, blendCanvas.width, blendCanvas.height)
      blendContext.restore()
      drawVisual(context, blendCanvas, blendCanvas.width, blendCanvas.height, asset, clip, timelineTime, width, height, 1, 'source-over')
      return true
    } finally {
      lowerFrameSource.close()
      upperFrameSource.close()
    }
  } finally {
    lower?.close()
    upper?.close()
  }
}

const frameBlendCanvases = new WeakMap<CanvasRenderingContext2D, HTMLCanvasElement>()
const motionBlurCanvases = new WeakMap<CanvasRenderingContext2D, HTMLCanvasElement>()

function frameBlendCanvasFor(context: CanvasRenderingContext2D, width: number, height: number): HTMLCanvasElement {
  let canvas = frameBlendCanvases.get(context)
  if (!canvas) {
    canvas = document.createElement('canvas')
    frameBlendCanvases.set(context, canvas)
  }
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  return canvas
}

function motionBlurCanvasFor(context: CanvasRenderingContext2D, width: number, height: number): HTMLCanvasElement {
  let canvas = motionBlurCanvases.get(context)
  if (!canvas) {
    canvas = document.createElement('canvas')
    motionBlurCanvases.set(context, canvas)
  }
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  return canvas
}

function canUseNativeHdrSample(clip: TimelineClip, asset: MediaAsset, timelineTime: number, colorMode: 'sdr' | 'hdr10-pq' | 'hdr-hlg'): boolean {
  if (!canUseRawHdrTransform(clip, asset, timelineTime, colorMode)) return false
  if (!hasNeutralHdrGrade({ ...defaultColorAdjustment(), ...clip.colorAdjustment })) return false
  if (!hasNeutralHdrEffects(resolveVisualEffects(clip, timelineTime))) return false
  const transform = resolveClipTransform(clip, timelineTime)
  return Math.abs(transform.positionX) <= 0.001 && Math.abs(transform.positionY) <= 0.001 && Math.abs(transform.scale - 100) <= 0.001 && Math.abs((transform.scaleX ?? 100) - 100) <= 0.001 && Math.abs((transform.scaleY ?? 100) - 100) <= 0.001 && Math.abs((transform.anchorX ?? 50) - 50) <= 0.001 && Math.abs((transform.anchorY ?? 50) - 50) <= 0.001 && Math.abs(transform.skewX ?? 0) <= 0.001 && Math.abs(transform.skewY ?? 0) <= 0.001 && Math.abs(transform.rotation) <= 0.001 && Math.abs(transform.opacity - 100) <= 0.001
}

function canUseRawHdrTransform(clip: TimelineClip, asset: MediaAsset, _timelineTime: number, colorMode: 'sdr' | 'hdr10-pq' | 'hdr-hlg'): boolean {
  if (hasSourceMasterVisualProcessing(asset)) return false
  if (hasSourceInterpretation(asset)) return false
  // The single-pass raw HDR shader has a fixed operation order. An explicit user
  // stack must use the ordered layer compositor so disabled/reordered effects are
  // never silently rendered in the fixed shader order.
  if (clip.effectStack !== undefined) return false
  if (clip.frameInterpolation === 'blend' || clip.frameInterpolation === 'optical-flow') return false
  if (clip.motionBlur?.enabled && clip.motionBlur.shutterAngle > 0) return false
  if (resolveVisualEffects(clip, _timelineTime).cornerPinEnabled) return false
  const sourceHdrFormat = effectiveSourceHdrFormat(asset)
  if ((colorMode === 'hdr10-pq' && sourceHdrFormat !== 'pq') || (colorMode === 'hdr-hlg' && sourceHdrFormat !== 'hlg')) return false
  const supportedTransition = (type?: NonNullable<TimelineClip['transitionIn']>['type']) => !type || type === 'none' || type === 'crossfade' || type === 'dip-black'
  if (!supportedTransition(clip.transitionIn?.type) || !supportedTransition(clip.transitionOut?.type)) return false
  return true
}

function hasNeutralHdrGrade(color: ReturnType<typeof defaultColorAdjustment>): boolean {
  return !color.exposure && !color.contrast && !color.saturation && !color.temperature && !color.tint && !color.highlights && !color.shadows && !color.hue && !color.vibrance && !color.fade && !color.vignette && !color.lift && !color.gamma && !color.gain && !color.curveShadows && !color.curveMidtones && !color.curveHighlights && !color.qualifierEnabled && !color.colorNodes?.length && !color.customLut && color.lut === 'none' && identityCurve(color.masterCurve) && identityCurve(color.redCurve) && identityCurve(color.greenCurve) && identityCurve(color.blueCurve)
}

function hasNeutralHdrEffects(effects: ReturnType<typeof defaultVisualEffects>): boolean {
  return !effects.cropTop && !effects.cropRight && !effects.cropBottom && !effects.cropLeft && !effects.blur && !effects.shadowOpacity && effects.mask === 'none' && !effects.faceMosaic && !effects.chromaKeyEnabled && !effects.cornerPinEnabled && (!effects.blendMode || effects.blendMode === 'normal') && !effects.masks?.some((mask) => mask.enabled)
}

function canUseLinearHdrAdjustment(clip: TimelineClip, _timelineTime: number): boolean {
  return !clip.colorAdjustment?.customLut
}

function hasActiveHdrMask(effects: ReturnType<typeof defaultVisualEffects>): boolean {
  return effects.mask !== 'none' || Boolean(effects.masks?.some((mask) => mask.enabled))
}

function safeSkewTangents(transform: { skewX?: number; skewY?: number }): { x: number; y: number } {
  let x = Math.tan(Math.max(-85, Math.min(85, transform.skewX ?? 0)) * Math.PI / 180)
  let y = Math.tan(Math.max(-85, Math.min(85, transform.skewY ?? 0)) * Math.PI / 180)
  const determinant = 1 - x * y
  if (Math.abs(determinant) < 0.001) {
    if (Math.abs(x) > 0.001) y = (1 - (Math.sign(determinant) || 1) * 0.001) / x
    else x = (1 - (Math.sign(determinant) || 1) * 0.001) / Math.max(0.001, y)
  }
  return { x, y }
}

function renderHdrMask(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, sourceWidth: number, sourceHeight: number, transform: ReturnType<typeof resolveClipTransform>, effects: ReturnType<typeof defaultVisualEffects>, outputWidth: number, outputHeight: number): HTMLCanvasElement {
  const fit = Math.min(outputWidth / sourceWidth, outputHeight / sourceHeight)
  const drawWidth = Math.max(1, Math.round(sourceWidth * fit))
  const drawHeight = Math.max(1, Math.round(sourceHeight * fit))
  const local = document.createElement('canvas')
  local.width = drawWidth
  local.height = drawHeight
  const localContext = local.getContext('2d', { alpha: true })
  if (!localContext) throw new Error('HDR 로컬 마스크 캔버스를 만들 수 없습니다.')
  localContext.fillStyle = '#fff'
  localContext.fillRect(0, 0, drawWidth, drawHeight)
  applyCanvasMask(localContext, drawWidth, drawHeight, effects, { x: 0, y: 0, width: drawWidth, height: drawHeight })
  clearLayerCanvas(context, outputWidth, outputHeight)
  context.save()
  context.translate(outputWidth / 2 + transform.positionX, outputHeight / 2 + transform.positionY)
  context.rotate(transform.rotation * Math.PI / 180)
  const skew = safeSkewTangents(transform)
  context.transform(1, skew.y, skew.x, 1, 0, 0)
  context.scale(transform.scale / 100 * (transform.scaleX ?? 100) / 100, transform.scale / 100 * (transform.scaleY ?? 100) / 100)
  context.drawImage(local, -drawWidth * (transform.anchorX ?? 50) / 100, -drawHeight * (transform.anchorY ?? 50) / 100, drawWidth, drawHeight)
  context.restore()
  return canvas
}

function identityCurve(points?: Array<{ x: number; y: number }>): boolean {
  if (!points?.length) return true
  return points.length === 2 && Math.abs(points[0].x) < 0.0001 && Math.abs(points[0].y) < 0.0001 && Math.abs(points[1].x - 1) < 0.0001 && Math.abs(points[1].y - 1) < 0.0001
}

function exportDimensions(preset: SequencePreset, targetHeight: number): { width: number; height: number } {
  const even = (value: number) => Math.max(16, Math.round(value / 2) * 2)
  const reference = Math.max(16, Math.min(8_192, Number(targetHeight) || 1080))
  let width = preset.width <= preset.height ? reference : reference * preset.width / Math.max(1, preset.height)
  let height = preset.width <= preset.height ? reference * preset.height / Math.max(1, preset.width) : reference
  const fit = Math.min(1, 8_192 / Math.max(width, height))
  width = even(width * fit)
  height = even(height * fit)
  return { width, height }
}

function drawBackground(context: CanvasRenderingContext2D, width: number, height: number, preserveAlpha = false): void {
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalAlpha = 1
  context.globalCompositeOperation = 'copy'
  if (preserveAlpha) context.clearRect(0, 0, width, height)
  else {
    context.fillStyle = '#08080b'
    context.fillRect(0, 0, width, height)
  }
  context.restore()
}

export interface DrawableVideoSample {
  draw(context: CanvasRenderingContext2D, dx: number, dy: number, width: number, height: number): void
}

export function drawVisual(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource | DrawableVideoSample,
  sourceWidth: number,
  sourceHeight: number,
  asset: MediaAsset,
  clip: TimelineClip,
  timelineTime: number,
  canvasWidth: number,
  canvasHeight: number,
  spatialScale = 1,
  blendModeOverride?: GlobalCompositeOperation,
): void {
  const transform = resolveClipTransform(clip, timelineTime)
  const effects = resolveVisualEffects(clip, timelineTime)
  const masterEffects = sourceMasterVisualEffects(asset)
  const masterColor = sourceMasterColor(asset)
  const transition = resolveClipTransitionState(clip, timelineTime)
  const interpreted = hasSourceInterpretation(asset) ? createInterpretedSource(source, sourceWidth, sourceHeight, asset, Math.max(canvasWidth, canvasHeight)) : undefined
  const interpretedSource = interpreted?.canvas ?? source
  const interpretedWidth = interpreted?.width ?? sourceWidth
  const interpretedHeight = interpreted?.height ?? sourceHeight
  const baseMasterProcessed = hasSourceMasterVisualProcessing(asset) && masterEffects
    ? createProcessedSource(interpretedSource, interpretedWidth, interpretedHeight, masterEffects, masterColor, Math.max(canvasWidth, canvasHeight), true)
    : undefined
  const masterProcessed = baseMasterProcessed && masterEffects && clip.effectStack !== undefined
    ? createFilteredSource(baseMasterProcessed.canvas, baseMasterProcessed.width, baseMasterProcessed.height, visualFilter(undefined, masterEffects)) ?? baseMasterProcessed
    : baseMasterProcessed
  const clipSource = masterProcessed?.canvas ?? interpretedSource
  const clipSourceWidth = masterProcessed?.width ?? interpretedWidth
  const clipSourceHeight = masterProcessed?.height ?? interpretedHeight
  const stackProcessed = clip.effectStack !== undefined ? createEffectStackProcessedSource(clipSource, clipSourceWidth, clipSourceHeight, asset, clip, timelineTime, effects, Math.max(canvasWidth, canvasHeight)) : undefined
  const clipPixelProcessed = effects.chromaKeyEnabled || effects.cornerPinEnabled || hasCustomColorCurves(clip.colorAdjustment) || hasColorQualifier(clip.colorAdjustment) || Boolean(clip.colorAdjustment?.colorNodes?.length) || Boolean(clip.colorAdjustment?.customLut)
  const processed = stackProcessed ?? (clipPixelProcessed ? createProcessedSource(clipSource, clipSourceWidth, clipSourceHeight, effects, clip.colorAdjustment, Math.max(canvasWidth, canvasHeight)) : masterProcessed)
  const drawable = processed?.canvas ?? interpreted?.canvas ?? source
  const drawableWidth = processed?.width ?? interpretedWidth
  const drawableHeight = processed?.height ?? interpretedHeight
  const fitScale = Math.min(canvasWidth / drawableWidth, canvasHeight / drawableHeight)
  const drawWidth = drawableWidth * fitScale
  const drawHeight = drawableHeight * fitScale
  if ((transition.type === 'dip-white' || transition.type === 'dip-black') && transition.progress < 1) {
    context.save()
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.globalAlpha = 1 - transition.progress
    context.globalCompositeOperation = 'source-over'
    context.fillStyle = transition.type === 'dip-white' ? '#fff' : '#000'
    context.fillRect(0, 0, canvasWidth, canvasHeight)
    context.restore()
  }
  const masterFilter = masterEffects && clip.effectStack === undefined ? visualFilter(undefined, masterEffects) : ''
  const clipFilter = clip.effectStack !== undefined ? 'none' : visualFilter(clipPixelProcessed ? undefined : clip.colorAdjustment, effects)
  const baseFilter = [masterFilter, clipFilter].filter((filter) => filter && filter !== 'none').join(' ') || 'none'
  const outputComposite = blendModeOverride ?? (effects.blendMode === 'normal' || !effects.blendMode ? 'source-over' : effects.blendMode)
  const drawPass = (target: CanvasRenderingContext2D, sampledTransform: typeof transform, sampledTransition: typeof transition, composite: GlobalCompositeOperation, weight: number, sampleTime: number) => {
    target.save()
    target.globalAlpha = sampledTransform.opacity / 100 * weight
    target.globalCompositeOperation = composite
    target.filter = sampledTransition.blur > 0 ? `${baseFilter === 'none' ? '' : baseFilter} blur(${sampledTransition.blur}px)`.trim() : baseFilter
    if (sampledTransition.type.startsWith('wipe-')) {
      const revealWidth = canvasWidth * sampledTransition.progress
      const revealHeight = canvasHeight * sampledTransition.progress
      target.beginPath()
      if (sampledTransition.type === 'wipe-left') target.rect(canvasWidth - revealWidth, 0, revealWidth, canvasHeight)
      else if (sampledTransition.type === 'wipe-right') target.rect(0, 0, revealWidth, canvasHeight)
      else if (sampledTransition.type === 'wipe-up') target.rect(0, canvasHeight - revealHeight, canvasWidth, revealHeight)
      else target.rect(0, 0, canvasWidth, revealHeight)
      target.clip()
    }
    target.translate(canvasWidth / 2 + sampledTransform.positionX * spatialScale + sampledTransition.translateX * canvasWidth, canvasHeight / 2 + sampledTransform.positionY * spatialScale + sampledTransition.translateY * canvasHeight)
    target.rotate(sampledTransform.rotation * Math.PI / 180)
    const skew = safeSkewTangents(sampledTransform)
    target.transform(1, skew.y, skew.x, 1, 0, 0)
    target.scale(sampledTransform.scale / 100 * (sampledTransform.scaleX ?? 100) / 100 * sampledTransition.scale, sampledTransform.scale / 100 * (sampledTransform.scaleY ?? 100) / 100 * sampledTransition.scale)
    const drawX = -drawWidth * (sampledTransform.anchorX ?? 50) / 100
    const drawY = -drawHeight * (sampledTransform.anchorY ?? 50) / 100
    if (clip.effectStack !== undefined) {
      if ('draw' in drawable) drawable.draw(target, drawX, drawY, drawWidth, drawHeight)
      else target.drawImage(drawable, drawX, drawY, drawWidth, drawHeight)
    } else if (requiresCanvasMask(effects)) {
      drawSoftMaskedVisual(target, drawable, drawableWidth, drawableHeight, asset, clip, sampleTime, effects, drawX, drawY, drawWidth, drawHeight)
    } else {
      drawMaskPath(target, effects, { x: drawX, y: drawY, width: drawWidth, height: drawHeight })
      target.clip()
      if ('draw' in drawable) drawable.draw(target, drawX, drawY, drawWidth, drawHeight)
      else target.drawImage(drawable, drawX, drawY, drawWidth, drawHeight)
      const face = effects.faceMosaic ? nearestFace(asset.faceTrack, clipSourceTime(clip, sampleTime)) : undefined
      const interpretedFace = face ? interpretNormalizedPoint(asset, face.x, face.y) : undefined
      target.save()
      target.translate(drawX + drawWidth / 2, drawY + drawHeight / 2)
      if (interpretedFace) drawFaceMosaic(target, drawable, drawableWidth, drawableHeight, drawWidth, drawHeight, interpretedFace.x, interpretedFace.y, effects.mosaicSize)
      drawVignette(target, drawWidth, drawHeight, clip.colorAdjustment?.vignette ?? 0)
      target.restore()
    }
    target.restore()
  }
  const movingTransition = Math.abs(transition.translateX) > 0.0001 || Math.abs(transition.translateY) > 0.0001 || Math.abs(transition.scale - 1) > 0.0001
  const blurEnabled = Boolean(clip.motionBlur?.enabled && clip.motionBlur.shutterAngle > 0 && ((clip.keyframes?.length ?? 0) > 0 || movingTransition))
  if (!blurEnabled) {
    drawPass(context, transform, transition, outputComposite, 1, timelineTime)
    return
  }
  const sampleCount = Math.max(2, Math.min(16, Math.round(clip.motionBlur?.samples ?? 8)))
  const frameDuration = 1 / Math.max(1, asset.frameRate ?? 30)
  const exposure = frameDuration * Math.max(0, Math.min(720, clip.motionBlur?.shutterAngle ?? 180)) / 360
  const blurCanvas = motionBlurCanvasFor(context, canvasWidth, canvasHeight)
  const blurContext = blurCanvas.getContext('2d', { alpha: true })
  if (!blurContext) {
    drawPass(context, transform, transition, outputComposite, 1, timelineTime)
    return
  }
  clearLayerCanvas(blurContext, canvasWidth, canvasHeight)
  for (let index = 0; index < sampleCount; index++) {
    const offset = sampleCount === 1 ? 0 : (index / (sampleCount - 1) - 0.5) * exposure
    const sampleTime = Math.max(clip.start, Math.min(clip.start + clip.duration, timelineTime + offset))
    drawPass(blurContext, resolveClipTransform(clip, sampleTime), resolveClipTransitionState(clip, sampleTime), 'lighter', 1 / sampleCount, sampleTime)
  }
  context.save()
  context.globalAlpha = 1
  context.globalCompositeOperation = outputComposite
  context.filter = 'none'
  context.drawImage(blurCanvas, 0, 0, canvasWidth, canvasHeight)
  context.restore()
}

function drawSoftMaskedVisual(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource | DrawableVideoSample,
  sourceWidth: number,
  sourceHeight: number,
  asset: MediaAsset,
  clip: TimelineClip,
  timelineTime: number,
  effects: ReturnType<typeof resolveVisualEffects>,
  drawX: number,
  drawY: number,
  drawWidth: number,
  drawHeight: number,
): void {
  const width = Math.max(2, Math.ceil(drawWidth))
  const height = Math.max(2, Math.ceil(drawHeight))
  const layer = document.createElement('canvas')
  layer.width = width
  layer.height = height
  const layerContext = layer.getContext('2d')
  if (!layerContext) return
  if ('draw' in source) source.draw(layerContext, 0, 0, width, height)
  else layerContext.drawImage(source, 0, 0, width, height)
  const face = effects.faceMosaic ? nearestFace(asset.faceTrack, clipSourceTime(clip, timelineTime)) : undefined
  const interpretedFace = face ? interpretNormalizedPoint(asset, face.x, face.y) : undefined
  layerContext.save()
  layerContext.translate(width / 2, height / 2)
  if (interpretedFace) drawFaceMosaic(layerContext, source, sourceWidth, sourceHeight, width, height, interpretedFace.x, interpretedFace.y, effects.mosaicSize)
  drawVignette(layerContext, width, height, clip.colorAdjustment?.vignette ?? 0)
  layerContext.restore()
  applyCanvasMask(layerContext, width, height, effects, { x: 0, y: 0, width, height })
  context.drawImage(layer, drawX, drawY, drawWidth, drawHeight)
}

function drawVignette(context: CanvasRenderingContext2D, width: number, height: number, amount: number): void {
  const strength = Math.max(0, Math.min(100, amount)) / 100
  if (!strength) return
  const radius = Math.hypot(width, height) / 2
  const gradient = context.createRadialGradient(0, 0, radius * 0.28, 0, 0, radius)
  gradient.addColorStop(0, 'rgba(0,0,0,0)')
  gradient.addColorStop(0.62, `rgba(0,0,0,${strength * 0.12})`)
  gradient.addColorStop(1, `rgba(0,0,0,${strength * 0.88})`)
  context.save()
  context.fillStyle = gradient
  context.fillRect(-width / 2, -height / 2, width, height)
  context.restore()
}

function createInterpretedSource(source: CanvasImageSource | DrawableVideoSample, sourceWidth: number, sourceHeight: number, asset: MediaAsset, maximumDimension: number): { canvas: HTMLCanvasElement; width: number; height: number } | undefined {
  const dimensions = interpretedSourceDimensions(sourceWidth, sourceHeight, asset)
  const scale = Math.min(1, maximumDimension / Math.max(dimensions.width, dimensions.height))
  const width = Math.max(2, Math.round(dimensions.width * scale))
  const height = Math.max(2, Math.round(dimensions.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return undefined
  drawInterpretedSource(context, source, sourceWidth, sourceHeight, asset, width / 2, height / 2, width, height)
  return { canvas, width, height }
}

function createFilteredSource(source: CanvasImageSource, width: number, height: number, filter: string): { canvas: HTMLCanvasElement; width: number; height: number } | undefined {
  if (!filter || filter === 'none') return { canvas: source as HTMLCanvasElement, width, height }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) return undefined
  context.filter = filter
  context.drawImage(source, 0, 0, width, height)
  return { canvas, width, height }
}

function createProcessedSource(source: CanvasImageSource | DrawableVideoSample, sourceWidth: number, sourceHeight: number, effects: ReturnType<typeof defaultVisualEffects>, color: TimelineClip['colorAdjustment'], maximumDimension: number, applySourceMask = false): { canvas: HTMLCanvasElement; width: number; height: number } | undefined {
  const scale = Math.min(1, maximumDimension / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(2, Math.round(sourceWidth * scale))
  const height = Math.max(2, Math.round(sourceHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return undefined
  if ('draw' in source) source.draw(context, 0, 0, width, height)
  else context.drawImage(source, 0, 0, width, height)
  applyChromaKey(context, width, height, {
    enabled: effects.chromaKeyEnabled,
    color: effects.chromaKeyColor,
    tolerance: effects.chromaKeyTolerance,
    softness: effects.chromaKeySoftness,
    spill: effects.chromaSpill,
  })
  applyBaseColorFilter(context, width, height, color)
  applyColorCurves(context, width, height, color)
  applyColorQualifier(context, width, height, color)
  applyColorNodeGraph(context, width, height, color)
  if (applySourceMask) applyCanvasMask(context, width, height, effects, { x: 0, y: 0, width, height })
  applyCornerPin(context, { x: 0, y: 0, width, height }, effects)
  return { canvas, width, height }
}

function createEffectStackProcessedSource(
  source: CanvasImageSource | DrawableVideoSample,
  sourceWidth: number,
  sourceHeight: number,
  asset: MediaAsset,
  clip: TimelineClip,
  timelineTime: number,
  effects: ReturnType<typeof defaultVisualEffects>,
  maximumDimension: number,
): { canvas: HTMLCanvasElement; width: number; height: number } | undefined {
  const scale = Math.min(1, maximumDimension / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(2, Math.round(sourceWidth * scale))
  const height = Math.max(2, Math.round(sourceHeight * scale))
  let canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  let context = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
  if (!context) return undefined
  if ('draw' in source) source.draw(context, 0, 0, width, height)
  else context.drawImage(source, 0, 0, width, height)
  const replaceWithFilteredCopy = (filter: string) => {
    const next = document.createElement('canvas')
    next.width = width
    next.height = height
    const nextContext = next.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!nextContext) return
    nextContext.filter = filter
    nextContext.drawImage(canvas, 0, 0)
    canvas = next
    context = nextContext
  }
  for (const item of clip.effectStack ?? []) {
    if (!item.enabled) continue
    if (item.kind === 'chroma-key') {
      applyChromaKey(context, width, height, { enabled: effects.chromaKeyEnabled, color: effects.chromaKeyColor, tolerance: effects.chromaKeyTolerance, softness: effects.chromaKeySoftness, spill: effects.chromaSpill })
    } else if (item.kind === 'color-grade') {
      applyBaseColorFilter(context, width, height, clip.colorAdjustment)
      applyColorCurves(context, width, height, clip.colorAdjustment)
      applyColorQualifier(context, width, height, clip.colorAdjustment)
      applyColorNodeGraph(context, width, height, clip.colorAdjustment)
    } else if (item.kind === 'blur-shadow') {
      replaceWithFilteredCopy(visualFilter(undefined, { ...defaultVisualEffects(), blur: effects.blur, shadowOpacity: effects.shadowOpacity, shadowBlur: effects.shadowBlur, shadowX: effects.shadowX, shadowY: effects.shadowY }))
    } else if (item.kind === 'crop-mask') {
      applyCanvasMask(context, width, height, effects, { x: 0, y: 0, width, height })
    } else if (item.kind === 'corner-pin') {
      applyCornerPin(context, { x: 0, y: 0, width, height }, effects)
    } else if (item.kind === 'face-mosaic') {
      const face = effects.faceMosaic ? nearestFace(asset.faceTrack, clipSourceTime(clip, timelineTime)) : undefined
      if (face) {
        const snapshot = document.createElement('canvas')
        snapshot.width = width
        snapshot.height = height
        snapshot.getContext('2d')?.drawImage(canvas, 0, 0)
        context.save()
        context.translate(width / 2, height / 2)
        drawFaceMosaic(context, snapshot, width, height, width, height, face.x, face.y, effects.mosaicSize)
        context.restore()
      }
    } else if (item.kind === 'vignette') {
      context.save()
      context.translate(width / 2, height / 2)
      drawVignette(context, width, height, clip.colorAdjustment?.vignette ?? 0)
      context.restore()
    }
  }
  return { canvas, width, height }
}

function drawFaceMosaic(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource | DrawableVideoSample,
  sourceWidth: number,
  sourceHeight: number,
  drawWidth: number,
  drawHeight: number,
  faceX: number,
  faceY: number,
  sizePercent: number,
): void {
  const fraction = Math.max(0.05, Math.min(0.45, sizePercent / 100))
  const sourceSize = Math.max(2, Math.min(sourceWidth, sourceHeight) * fraction)
  const sourceX = Math.max(0, Math.min(sourceWidth - sourceSize, faceX * sourceWidth - sourceSize / 2))
  const sourceY = Math.max(0, Math.min(sourceHeight - sourceSize, faceY * sourceHeight - sourceSize / 2))
  const mosaic = document.createElement('canvas')
  mosaic.width = 16
  mosaic.height = 16
  const mosaicContext = mosaic.getContext('2d')
  if (!mosaicContext) return
  if ('draw' in source) {
    source.draw(mosaicContext, -sourceX / sourceSize * 16, -sourceY / sourceSize * 16, sourceWidth / sourceSize * 16, sourceHeight / sourceSize * 16)
  } else {
    mosaicContext.drawImage(source, sourceX, sourceY, sourceSize, sourceSize, 0, 0, 16, 16)
  }
  const destinationSize = Math.min(drawWidth, drawHeight) * fraction
  const destinationX = -drawWidth / 2 + faceX * drawWidth - destinationSize / 2
  const destinationY = -drawHeight / 2 + faceY * drawHeight - destinationSize / 2
  context.save()
  context.filter = 'none'
  context.imageSmoothingEnabled = false
  context.drawImage(mosaic, destinationX, destinationY, destinationSize, destinationSize)
  context.restore()
}

function nearestFace(points: MediaAsset['faceTrack'], time: number): NonNullable<MediaAsset['faceTrack']>[number] | undefined {
  if (!points?.length) return undefined
  return points.reduce((nearest, point) => Math.abs(point.time - time) < Math.abs(nearest.time - time) ? point : nearest, points[0])
}

export function drawCaption(context: CanvasRenderingContext2D, clip: TimelineClip, timelineTime: number, width: number, height: number): void {
  const style = { ...defaultCaptionStyle(), ...clip.captionStyle }
  const fontSize = Math.max(18, Math.round(height * 0.045 * style.fontSize / 100))
  const maxTextWidth = width * Math.max(10, Math.min(100, style.maxWidth ?? 80)) / 100
  const letterSpacing = fontSize * (style.letterSpacing ?? 0) / 100
  const text = style.uppercase ? clip.name.toLocaleUpperCase('ko-KR') : clip.name
  context.save()
  const weight = style.preset === 'bold' ? 950 : style.preset === 'minimal' ? 600 : style.fontWeight ?? 800
  const family = style.fontFamily === 'serif' ? 'Georgia, serif' : style.fontFamily === 'mono' ? 'Consolas, monospace' : 'Inter, "Noto Sans KR", sans-serif'
  context.font = `${weight} ${fontSize}px ${family}`
  context.textAlign = style.textAlign ?? 'center'
  context.textBaseline = 'middle'
  const lines = wrapCaption(context, text, maxTextWidth, letterSpacing)
  const lineHeight = fontSize * (style.lineHeight ?? 125) / 100
  const paddingX = fontSize * (style.backgroundPaddingX ?? 70) / 100
  const paddingY = fontSize * (style.backgroundPaddingY ?? 35) / 100
  const boxHeight = lines.length * lineHeight + paddingY * 2
  const boxWidth = Math.min(maxTextWidth + paddingX * 2, Math.max(...lines.map((line) => measureSpacedText(context, line.text, letterSpacing))) + paddingX * 2)
  const safeInset = style.safeArea === 'title' ? 0.1 : style.safeArea === 'action' ? 0.05 : 0
  const centerX = Math.max(width * safeInset + boxWidth / 2, Math.min(width * (1 - safeInset) - boxWidth / 2, width * (style.positionX ?? 50) / 100))
  const centerY = Math.max(height * safeInset + boxHeight / 2, Math.min(height * (1 - safeInset) - boxHeight / 2, height * (style.positionY ?? (style.position === 'top' ? 16 : style.position === 'middle' ? 50 : 84)) / 100))
  context.restore()
  const drawPass = (target: CanvasRenderingContext2D, sampleTime: number, composite: GlobalCompositeOperation, weightMultiplier: number) => {
    const transform = resolveClipTransform(clip, sampleTime)
    const transition = resolveClipTransitionState(clip, sampleTime)
    const animationDuration = Math.max(0.05, style.animationDuration ?? 0.35)
    const progress = Math.max(0, Math.min(1, (sampleTime - clip.start) / animationDuration))
    const eased = 1 - (1 - progress) ** 3
    const exitProgress = Math.max(0, Math.min(1, (clip.start + clip.duration - sampleTime) / animationDuration))
    const exitEased = 1 - (1 - exitProgress) ** 3
    const opacity = Math.min(style.animation === 'none' ? 1 : eased, style.animationOut === 'fade' ? exitEased : 1) * transitionOpacity(clip, sampleTime)
    const animationScale = (style.animation === 'pop' ? 0.72 + eased * 0.28 : 1) * (style.animationOut === 'pop' ? 0.72 + exitEased * 0.28 : 1)
    const translateY = (style.animation === 'slide-up' ? (1 - eased) * height * 0.035 : 0) + (style.animationOut === 'slide-down' ? (1 - exitEased) * height * 0.035 : 0)
    target.save()
    target.globalCompositeOperation = composite
    target.globalAlpha = opacity * transform.opacity / 100 * weightMultiplier
    if (transition.type === 'wipe-left') { target.beginPath(); target.rect(0, 0, width * transition.progress, height); target.clip() }
    if (transition.type === 'wipe-right') { target.beginPath(); target.rect(width * (1 - transition.progress), 0, width * transition.progress, height); target.clip() }
    if (transition.type === 'wipe-up') { target.beginPath(); target.rect(0, 0, width, height * transition.progress); target.clip() }
    if (transition.type === 'wipe-down') { target.beginPath(); target.rect(0, height * (1 - transition.progress), width, height * transition.progress); target.clip() }
    if (transition.blur > 0) target.filter = `blur(${transition.blur}px)`
    target.font = `${weight} ${fontSize}px ${family}`
    target.textAlign = style.textAlign ?? 'center'
    target.textBaseline = 'middle'
    target.translate(centerX + transform.positionX + transition.translateX * width, centerY + transform.positionY + translateY + transition.translateY * height)
    target.rotate(((style.rotation ?? 0) + transform.rotation) * Math.PI / 180)
    const skew = safeSkewTangents(transform)
    target.transform(1, skew.y, skew.x, 1, 0, 0)
    target.scale(transition.scale * animationScale * transform.scale / 100 * (transform.scaleX ?? 100) / 100, transition.scale * animationScale * transform.scale / 100 * (transform.scaleY ?? 100) / 100)
    target.translate(-boxWidth * ((transform.anchorX ?? 50) - 50) / 100, -boxHeight * ((transform.anchorY ?? 50) - 50) / 100)
    if (style.backgroundEnabled && style.preset !== 'minimal') {
      target.fillStyle = style.backgroundColor
      roundedRect(target, -boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, fontSize * (style.backgroundRadius ?? 35) / 100)
      target.fill()
    }
    drawTitleTemplateDecoration(target, style, boxWidth, boxHeight, fontSize)
    target.fillStyle = style.textColor
    target.shadowColor = style.shadowColor ?? 'rgba(0,0,0,.65)'
    target.shadowBlur = Math.max(0, style.shadowBlur ?? 6)
    target.shadowOffsetX = style.shadowX ?? 0
    target.shadowOffsetY = style.shadowY ?? 2
    target.strokeStyle = style.strokeColor ?? '#000000'
    target.lineWidth = Math.max(0, style.strokeWidth ?? 0) * 2
    target.lineJoin = 'round'
    const textX = target.textAlign === 'left' ? -boxWidth / 2 + fontSize * 0.7 : target.textAlign === 'right' ? boxWidth / 2 - fontSize * 0.7 : 0
    const highlightRange = style.preset === 'karaoke' ? captionHighlightRange(clip, text, sampleTime) : undefined
    lines.forEach((line, index) => {
      const textY = (index - (lines.length - 1) / 2) * lineHeight
      drawSpacedText(target, line.text, textX, textY, letterSpacing, target.lineWidth > 0, highlightRange ? { start: highlightRange.start - line.start, end: highlightRange.end - line.start, color: style.highlightColor } : undefined)
    })
    target.restore()
  }
  const blurEnabled = Boolean(clip.motionBlur?.enabled && clip.motionBlur.shutterAngle > 0 && ((clip.keyframes?.length ?? 0) > 0 || style.animation !== 'none' || style.animationOut !== 'none'))
  if (!blurEnabled) {
    drawPass(context, timelineTime, 'source-over', 1)
    return
  }
  const sampleCount = Math.max(2, Math.min(16, Math.round(clip.motionBlur?.samples ?? 8)))
  const exposure = 1 / 30 * Math.max(0, Math.min(720, clip.motionBlur?.shutterAngle ?? 180)) / 360
  const blurCanvas = motionBlurCanvasFor(context, width, height)
  const blurContext = blurCanvas.getContext('2d', { alpha: true })
  if (!blurContext) {
    drawPass(context, timelineTime, 'source-over', 1)
    return
  }
  clearLayerCanvas(blurContext, width, height)
  for (let index = 0; index < sampleCount; index++) {
    const offset = (index / (sampleCount - 1) - 0.5) * exposure
    drawPass(blurContext, Math.max(clip.start, Math.min(clip.start + clip.duration, timelineTime + offset)), 'lighter', 1 / sampleCount)
  }
  context.save()
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
  context.filter = 'none'
  context.drawImage(blurCanvas, 0, 0, width, height)
  context.restore()
}

function drawTitleTemplateDecoration(context: CanvasRenderingContext2D, style: CaptionStyle, boxWidth: number, boxHeight: number, fontSize: number): void {
  if (!style.template) return
  context.save()
  context.shadowColor = 'transparent'
  context.shadowBlur = 0
  if (style.template === 'lower-third') {
    context.fillStyle = style.backgroundColor
    roundedRect(context, -boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, Math.min(fontSize * 0.18, boxHeight * 0.18))
    context.fill()
    context.fillStyle = style.highlightColor
    context.fillRect(-boxWidth / 2, -boxHeight / 2, Math.max(5, fontSize * 0.12), boxHeight)
  } else if (style.template === 'headline') {
    context.fillStyle = style.highlightColor
    const lineWidth = Math.min(boxWidth * 0.42, fontSize * 4.5)
    context.fillRect(-lineWidth / 2, boxHeight / 2 - Math.max(3, fontSize * 0.07), lineWidth, Math.max(3, fontSize * 0.07))
  } else if (style.template === 'quote') {
    context.globalAlpha *= 0.22
    context.fillStyle = style.highlightColor
    context.font = `900 ${fontSize * 2.8}px Georgia, serif`
    context.textAlign = 'left'
    context.textBaseline = 'top'
    context.fillText('“', -boxWidth / 2, -boxHeight / 2 - fontSize * 0.42)
  } else if (style.template === 'subscribe') {
    const size = Math.min(fontSize * 0.52, boxHeight * 0.3)
    const x = -boxWidth / 2 + fontSize * 0.55
    context.fillStyle = style.textColor
    context.beginPath()
    context.moveTo(x - size * 0.35, -size * 0.55)
    context.lineTo(x + size * 0.55, 0)
    context.lineTo(x - size * 0.35, size * 0.55)
    context.closePath()
    context.fill()
  } else if (style.template === 'callout') {
    const pointer = Math.min(fontSize * 0.42, boxHeight * 0.28)
    context.fillStyle = style.backgroundColor
    context.beginPath()
    context.moveTo(boxWidth * 0.18, boxHeight / 2 - 1)
    context.lineTo(boxWidth * 0.18 + pointer, boxHeight / 2 - 1)
    context.lineTo(boxWidth * 0.18 + pointer * 0.15, boxHeight / 2 + pointer)
    context.closePath()
    context.fill()
  }
  context.restore()
}

function wrapCaption(context: CanvasRenderingContext2D, text: string, maxWidth: number, letterSpacing = 0): Array<{ text: string; start: number }> {
  const lines: Array<{ text: string; start: number }> = []
  let current = ''
  let currentStart = 0
  let sourceOffset = 0
  for (const character of Array.from(text)) {
    const index = sourceOffset
    sourceOffset += character.length
    const candidate = current + character
    if (current && measureSpacedText(context, candidate, letterSpacing) > maxWidth) {
      const trimmed = current.trim()
      if (trimmed) lines.push({ text: trimmed, start: currentStart + current.indexOf(trimmed) })
      current = character
      currentStart = index
    } else current = candidate
  }
  const trimmed = current.trim()
  if (trimmed) lines.push({ text: trimmed, start: currentStart + current.indexOf(trimmed) })
  return lines.length ? lines.slice(0, 3) : [{ text: '', start: 0 }]
}

function captionHighlightRange(clip: TimelineClip, text: string, timelineTime: number): { start: number; end: number } | undefined {
  const words = clip.captionWords ?? []
  const localTime = Math.max(0, timelineTime - clip.start)
  const absoluteWordTimes = words.some((word) => word.end > clip.duration + 0.5)
  const relativeWordTime = (value: number) => absoluteWordTimes ? value - clip.start : value
  const activeIndex = words.findIndex((word) => localTime >= relativeWordTime(word.start) && localTime <= relativeWordTime(word.end))
  if (activeIndex < 0) {
    const progress = Math.max(0, Math.min(1, localTime / Math.max(0.001, clip.duration)))
    return words.length ? undefined : { start: 0, end: Math.round(text.length * progress) }
  }
  const searchable = text.toLocaleLowerCase()
  let cursor = 0
  for (let index = 0; index <= activeIndex; index++) {
    const word = words[index].text.trim()
    if (!word) continue
    const found = searchable.indexOf(word.toLocaleLowerCase(), cursor)
    if (found < 0) continue
    if (index === activeIndex) return { start: found, end: found + word.length }
    cursor = found + word.length
  }
  return undefined
}

function measureSpacedText(context: CanvasRenderingContext2D, text: string, letterSpacing: number): number {
  const characters = Array.from(text)
  return characters.reduce((width, character) => width + context.measureText(character).width, 0) + Math.max(0, characters.length - 1) * letterSpacing
}

function drawSpacedText(context: CanvasRenderingContext2D, text: string, x: number, y: number, letterSpacing: number, stroke: boolean, highlight?: { start: number; end: number; color: string }): void {
  if (Math.abs(letterSpacing) < 0.01 && !highlight) {
    if (stroke) context.strokeText(text, x, y)
    context.fillText(text, x, y)
    return
  }
  const characters = Array.from(text)
  const width = measureSpacedText(context, text, letterSpacing)
  let cursor = context.textAlign === 'center' ? x - width / 2 : context.textAlign === 'right' ? x - width : x
  const previousAlign = context.textAlign
  const previousFill = context.fillStyle
  context.textAlign = 'left'
  let textOffset = 0
  characters.forEach((character) => {
    context.fillStyle = highlight && textOffset >= highlight.start && textOffset < highlight.end ? highlight.color : previousFill
    if (stroke) context.strokeText(character, cursor, y)
    context.fillText(character, cursor, y)
    cursor += context.measureText(character).width + letterSpacing
    textOffset += character.length
  })
  context.fillStyle = previousFill
  context.textAlign = previousAlign
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.roundRect(x, y, width, height, r)
}

interface AudioClipPlan {
  clip: TimelineClip
  track: TimelineTrack
  asset: MediaAsset
  audioPeak?: number
}

function selectAudioClips(assets: MediaAsset[], tracks: TimelineTrack[], prepared: Map<string, PreparedMedia>): AudioClipPlan[] {
  return tracks.flatMap((track) => track.clips
    .filter((clip) => clip.enabled !== false && clip.assetId && !clip.audioDisabled && !clip.freezeFrame && findReadyAsset(assets, clip.assetId) && prepared.get(clip.assetId)?.audioSink)
    .map((clip) => {
      const asset = findReadyAsset(assets, clip.assetId!)!
      return { clip, track, asset, audioPeak: asset.audioPeak }
    }))
    .sort((a, b) => a.clip.start - b.clip.start)
}

async function appendAudio(
  plans: AudioClipPlan[],
  prepared: Map<string, PreparedMedia>,
  outputSource: AudioSampleSource,
  audioSampleFactory: { fromAudioBuffer(buffer: AudioBuffer, timestamp: number): MediabunnyAudioSample[] },
  timelineStart: number,
  timelineEnd: number,
  audioBuses: AudioBusMap,
  signal: AbortSignal | undefined,
  onProgress: (progress: number) => void,
  waitWhilePaused?: (signal?: AbortSignal) => Promise<void>,
  sidechainPlans: AudioClipPlan[] = plans,
  sampleRate = 48_000,
  outputChannels: 1 | 2 | 6 = 2,
): Promise<void> {
  const chunkDuration = plans.some(({ clip }) => Boolean(clip.speedKeyframes?.length) || (clip.playbackRate ?? 1) > 4) ? 2 : 10
  const dialogueRanges = isAudioBusActive(audioBuses, 'dialogue')
    ? sidechainPlans.filter(({ clip, track }) => (track.audioRole ?? ({ ...defaultAudioAdjustment(), ...clip.audioAdjustment }).role) === 'dialogue')
      .map(({ clip }) => ({ start: clip.start, end: clip.start + clip.duration }))
    : []
  const busInsertProcessors = Object.fromEntries(audioRoles.map((role) => [role, {
    left: createBusInsertProcessors(audioBuses[role].inserts, sampleRate),
    right: createBusInsertProcessors(audioBuses[role].inserts, sampleRate),
    surround: Array.from({ length: 6 }, () => createBusInsertProcessors(audioBuses[role].inserts, sampleRate)),
  }])) as Record<(typeof audioRoles)[number], { left: BusInsertProcessor[]; right: BusInsertProcessor[]; surround: BusInsertProcessor[][] }>
  const clipFilterChains = new Map<string, { left: AudioFilterChain; right: AudioFilterChain; surround?: AudioFilterChain[] }>()
  const masterFilterChains = new Map<string, { left: AudioFilterChain; right: AudioFilterChain }>()
  const clipLfeFilters = new Map<string, BiquadProcessor>()

  const duration = timelineEnd - timelineStart
  for (let chunkStart = timelineStart; chunkStart < timelineEnd; chunkStart += chunkDuration) {
    throwIfAborted(signal)
    await waitWhilePaused?.(signal)
    const chunkEnd = Math.min(timelineEnd, chunkStart + chunkDuration)
    const frameCount = Math.max(1, Math.ceil((chunkEnd - chunkStart) * sampleRate))
    const mix = new AudioBuffer({ length: frameCount, numberOfChannels: outputChannels, sampleRate })
    const output = Array.from({ length: outputChannels }, (_, channel) => mix.getChannelData(channel))
    const left = output[0]
    const right = outputChannels === 1 ? output[0] : output[1]
    const busMix = Object.fromEntries(audioRoles.map((role) => [role, { left: new Float32Array(frameCount), right: new Float32Array(frameCount), surround: Array.from({ length: 6 }, () => new Float32Array(frameCount)), lfe: new Float32Array(frameCount) }])) as Record<(typeof audioRoles)[number], { left: Float32Array; right: Float32Array; surround: Float32Array[]; lfe: Float32Array }>
    const activePlans = plans.filter(({ clip }) => clip.start < chunkEnd && clip.start + clip.duration > chunkStart)

    for (const { clip, track, asset, audioPeak } of activePlans) {
      if (!clip.assetId) continue
      const sink = prepared.get(clip.assetId)?.audioSink
      if (!sink) continue
      const overlapStart = Math.max(chunkStart, clip.start)
      const overlapEnd = Math.min(chunkEnd, clip.start + clip.duration)
      const adjustment = { ...defaultAudioAdjustment(), ...clip.audioAdjustment, ...(track.audioRole ? { role: track.audioRole } : {}) }
      const masterAdjustment = sourceMasterAudio(asset)
      const usePitchStretch = adjustment.preservePitch && clipNeedsPitchStretch(clip)
      const trackOutput = track.audioOutputChannel ?? 'auto'
      const preserveSourceSurround = outputChannels === 6 && trackOutput === 'auto' && adjustment.surroundPan === undefined && !usePitchStretch && !masterAdjustment && (asset.sourceAudioLayout === 'quad' || asset.sourceAudioLayout === '5.0' || asset.sourceAudioLayout === '5.1' || asset.sourceAudioLayout === '7.1' || (asset.sourceAudioLayout === 'auto' || !asset.sourceAudioLayout) && (asset.channels ?? 0) >= 4)
      const sourceA = clipSourceTime(clip, overlapStart)
      const sourceB = clipSourceTime(clip, overlapEnd)
      const sourcePadding = usePitchStretch ? pitchPreservationSourcePadding(clip) : 0
      const sourceStart = Math.max(0, Math.min(sourceA, sourceB) - sourcePadding)
      const sourceEnd = Math.max(sourceStart, Math.max(sourceA, sourceB) + sourcePadding)
      const auxSends = resolveAudioAuxSends(adjustment).filter((send) => send.enabled && send.bus !== adjustment.role)
      const normalizedGain = adjustment.normalize ? peakNormalizationGain(audioPeak) : 1
      let filterChains = clipFilterChains.get(clip.id)
      if (!filterChains) {
        filterChains = { left: createAudioFilterChain(adjustment, sampleRate), right: createAudioFilterChain(adjustment, sampleRate), surround: preserveSourceSurround ? Array.from({ length: 6 }, () => createAudioFilterChain(adjustment, sampleRate)) : undefined }
        clipFilterChains.set(clip.id, filterChains)
      }
      const { left: leftFilter, right: rightFilter } = filterChains
      const decoded: DecodedAudioSpan[] = []
      for await (const sample of sink.samples(sourceStart, sourceEnd + 1 / sampleRate)) {
        throwIfAborted(signal)
        if (sample.timestamp >= sourceEnd || sample.timestamp + sample.duration <= sourceStart) {
          sample.close()
          continue
        }
        const buffer = sample.toAudioBuffer()
        const downmix = masterAdjustment ?? adjustment
        const downmixed = downmixAudioBuffer(buffer, { centerDb: downmix.downmixCenterDb, surroundDb: downmix.downmixSurroundDb, lfeDb: downmix.downmixLfeDb, layout: asset.sourceAudioLayout })
        decoded.push({ start: sample.timestamp, sampleRate: buffer.sampleRate, ...downmixed, surround: preserveSourceSurround ? extractSurroundAudioBuffer(buffer, asset.sourceAudioLayout) : undefined })
        sample.close()
      }
      if (!decoded.length) continue
      decoded.sort((a, b) => a.start - b.start)
      let spanIndex = clip.reverse ? decoded.length - 1 : 0
      const destinationStart = Math.max(0, Math.floor((overlapStart - chunkStart) * sampleRate))
      const destinationEnd = Math.min(frameCount, Math.ceil((overlapEnd - chunkStart) * sampleRate))
      const pitchMapped = usePitchStretch ? renderPitchPreservedTimeMap({
        spans: decoded,
        timelineStart: chunkStart + destinationStart / sampleRate,
        frameCount: destinationEnd - destinationStart,
        sampleRate,
        clipStart: clip.start,
        clipEnd: clip.start + clip.duration,
        reverse: Boolean(clip.reverse),
        mono: decoded.every((span) => span.mono),
        sourceTimeAt: (timelineTime) => clipSourceTime(clip, timelineTime),
      }) : undefined
      for (let destination = destinationStart; destination < destinationEnd; destination++) {
        const timelineTime = chunkStart + destination / sampleRate
        const compGain = resolveAdrCompGain(clip, timelineTime)
        if (compGain <= 0) continue
        let sourceValues: { left: number; right: number; mono: boolean } | undefined
        let sourceSurround: number[] | undefined
        if (pitchMapped) {
          const frame = destination - destinationStart
          sourceValues = { left: pitchMapped.left[frame], right: pitchMapped.right[frame], mono: pitchMapped.mono }
        } else {
          const sourceTimestamp = clipSourceTime(clip, timelineTime)
          while (spanIndex + 1 < decoded.length && sourceTimestamp >= decodedSpanEnd(decoded[spanIndex])) spanIndex++
          while (spanIndex > 0 && sourceTimestamp < decoded[spanIndex].start) spanIndex--
          sourceValues = sampleDecodedAudio(decoded[spanIndex], sourceTimestamp)
          sourceSurround = sampleDecodedSurround(decoded[spanIndex], sourceTimestamp)
        }
        if (!sourceValues) continue
        if (masterAdjustment) {
          let masterChains = masterFilterChains.get(clip.id)
          if (!masterChains) {
            masterChains = { left: createAudioFilterChain(masterAdjustment, sampleRate), right: createAudioFilterChain(masterAdjustment, sampleRate) }
            masterFilterChains.set(clip.id, masterChains)
          }
          const masterMapped = applyStereoField(mapAudioChannels(sourceValues.left, sourceValues.right, masterAdjustment.channelMode ?? 'stereo', sourceValues.mono), masterAdjustment)
          let masterLeft = applyNoiseGate(masterMapped.left, masterAdjustment.noiseReduction)
          let masterRight = applyNoiseGate(masterMapped.right, masterAdjustment.noiseReduction)
          masterLeft = applyDynamics(applyAudioFilters(masterLeft, masterChains.left), masterAdjustment)
          masterRight = applyDynamics(applyAudioFilters(masterRight, masterChains.right), masterAdjustment)
          const masterPanned = stereoPanSample(masterLeft, masterRight, Math.max(-1, Math.min(1, masterAdjustment.pan / 100)), masterMapped.mono)
          const masterGain = gainFromDb(masterAdjustment.gainDb) * (masterAdjustment.normalize ? peakNormalizationGain(audioPeak) : 1)
          sourceValues = { left: masterPanned.left * masterGain, right: masterPanned.right * masterGain, mono: masterMapped.mono && Math.abs(masterAdjustment.pan) < 0.001 }
        }
        const audioMix = resolveClipAudioMix(clip, timelineTime)
        const trackMix = resolveTrackAudioMix(track, timelineTime)
        const baseGain = gainFromDb(audioMix.gainDb) * normalizedGain * (trackMix.volume / 100)
        const pan = Math.max(-1, Math.min(1, (audioMix.pan + trackMix.pan) / 100))
        const duck = adjustment.role === 'music' && adjustment.ducking ? duckingGainAt(timelineTime, dialogueRanges, adjustment.duckingAmountDb ?? -11, adjustment.duckingAttackMs ?? 180, adjustment.duckingReleaseMs ?? 650) : 1
        const clipTime = Math.max(0, timelineTime - clip.start)
        const remaining = Math.max(0, clip.duration - clipTime)
        const fade = Math.min(1, adjustment.fadeIn > 0 ? audioFadeCurveGain(clipTime / adjustment.fadeIn, adjustment.fadeInCurve) : 1, adjustment.fadeOut > 0 ? audioFadeCurveGain(remaining / adjustment.fadeOut, adjustment.fadeOutCurve) : 1) * transitionAudioGain(clip, timelineTime)
        const mappedChannels = applyStereoField(mapAudioChannels(sourceValues.left, sourceValues.right, adjustment.channelMode ?? 'stereo', sourceValues.mono), adjustment)
        let leftValue = applyNoiseGate(mappedChannels.left, adjustment.noiseReduction)
        let rightValue = applyNoiseGate(mappedChannels.right, adjustment.noiseReduction)
        leftValue = applyAudioFilters(leftValue, leftFilter)
        rightValue = applyAudioFilters(rightValue, rightFilter)
        const dynamicsLeft = applyDynamics(leftValue, adjustment)
        const dynamicsRight = applyDynamics(rightValue, adjustment)
        const panned = stereoPanSample(dynamicsLeft, dynamicsRight, pan, mappedChannels.mono)
        const preFaderLeft = dynamicsLeft * normalizedGain * fade * compGain
        const preFaderRight = dynamicsRight * normalizedGain * fade * compGain
        const processedLeft = panned.left * baseGain * duck * fade * compGain
        const processedRight = panned.right * baseGain * duck * fade * compGain
        const processedSurround = sourceSurround && filterChains.surround ? sourceSurround.map((value, channel) => applyDynamics(applyAudioFilters(applyNoiseGate(value, adjustment.noiseReduction), filterChains!.surround![channel]), adjustment) * baseGain * duck * fade * compGain) : undefined
        if (outputChannels === 6 && processedSurround) {
          for (let channel = 0; channel < 6; channel++) {
            if (channel === 3) busMix[adjustment.role].lfe[destination] += processedSurround[channel] ?? 0
            else busMix[adjustment.role].surround[channel][destination] += processedSurround[channel] ?? 0
          }
        } else if (outputChannels === 6 && trackOutput !== 'auto') {
          if (trackOutput === 'surround-pan') {
            addSurroundPanned(busMix[adjustment.role].surround, destination, processedLeft, processedRight, track.surroundPan ?? 0, track.surroundSpread ?? 60)
          } else if (trackOutput === 'lfe') {
            const filterKey = `direct:${clip.id}`
            let lfeFilter = clipLfeFilters.get(filterKey)
            if (!lfeFilter) {
              lfeFilter = processor(lowpassBiquad(sampleRate, track.lfeLowpassHz ?? adjustment.lfeLowpassHz ?? 120))
              clipLfeFilters.set(filterKey, lfeFilter)
            }
            busMix[adjustment.role].lfe[destination] += processBiquad((processedLeft + processedRight) * 0.5, lfeFilter.coefficients, lfeFilter.state)
          } else {
            const outputIndex = trackOutput === 'left' ? 0 : trackOutput === 'right' ? 1 : trackOutput === 'center' ? 2 : trackOutput === 'left-surround' ? 4 : 5
            busMix[adjustment.role].surround[outputIndex][destination] += (processedLeft + processedRight) * 0.5
          }
        } else if (outputChannels === 6 && adjustment.surroundPan !== undefined) {
          addSurroundPanned(busMix[adjustment.role].surround, destination, processedLeft, processedRight, adjustment.surroundPan, adjustment.surroundSpread ?? 60)
        } else {
          busMix[adjustment.role].left[destination] += processedLeft
          busMix[adjustment.role].right[destination] += processedRight
        }
        const lfeSendDb = track.lfeSendDb ?? adjustment.lfeSendDb ?? -60
        if (outputChannels === 6 && trackOutput !== 'lfe' && lfeSendDb > -60) {
          const filterKey = `send:${clip.id}`
          let lfeFilter = clipLfeFilters.get(filterKey)
          if (!lfeFilter) {
            lfeFilter = processor(lowpassBiquad(sampleRate, track.lfeLowpassHz ?? adjustment.lfeLowpassHz ?? 120))
            clipLfeFilters.set(filterKey, lfeFilter)
          }
          const lowFrequencyMono = processBiquad((processedLeft + processedRight) * 0.5, lfeFilter.coefficients, lfeFilter.state)
          busMix[adjustment.role].lfe[destination] += lowFrequencyMono * gainFromDb(lfeSendDb)
        }
        for (const send of auxSends) {
          const sendGain = gainFromDb(send.levelDb)
          const sendLeft = send.position === 'pre' ? preFaderLeft : processedLeft
          const sendRight = send.position === 'pre' ? preFaderRight : processedRight
          busMix[send.bus].left[destination] += sendLeft * sendGain
          busMix[send.bus].right[destination] += sendRight * sendGain
        }
      }
    }

    for (const role of audioRoles) {
      if (!isAudioBusActive(audioBuses, role)) continue
      const settings = audioBuses[role]
      const busGain = gainFromDb(settings.gainDb)
      const bus = busMix[role]
      for (let index = 0; index < frameCount; index++) {
        const processedLeft = applyBusInsertChain(bus.left[index], busInsertProcessors[role].left) * busGain
        const processedRight = applyBusInsertChain(bus.right[index], busInsertProcessors[role].right) * busGain
        const limitedLeft = applyBrickwallLimiter(processedLeft, settings.limiterDb)
        const limitedRight = applyBrickwallLimiter(processedRight, settings.limiterDb)
        const limitedLfe = applyBrickwallLimiter(bus.lfe[index] * busGain, settings.limiterDb)
        if (outputChannels === 1) {
          left[index] += (limitedLeft + limitedRight) * 0.5
        } else if (outputChannels === 6) {
          output[3][index] += limitedLfe
          if (role === 'dialogue') output[2][index] += (limitedLeft + limitedRight) * 0.5
          else if (role === 'music') { output[0][index] += limitedLeft; output[1][index] += limitedRight }
          else if (role === 'effects') {
            output[0][index] += limitedLeft * Math.SQRT1_2; output[1][index] += limitedRight * Math.SQRT1_2
            output[4][index] += limitedLeft * 0.5; output[5][index] += limitedRight * 0.5
          } else {
            output[0][index] += limitedLeft * 0.25; output[1][index] += limitedRight * 0.25
            output[4][index] += limitedLeft * Math.SQRT1_2; output[5][index] += limitedRight * Math.SQRT1_2
          }
          for (let channel = 0; channel < 6; channel++) {
            if (channel === 3) continue
            const direct = applyBrickwallLimiter(applyBusInsertChain(bus.surround[channel][index], busInsertProcessors[role].surround[channel]) * busGain, settings.limiterDb)
            output[channel][index] += direct
          }
        } else {
          left[index] += limitedLeft
          right[index] += limitedRight
        }
      }
    }
    output.forEach((channel) => { for (let index = 0; index < frameCount; index++) channel[index] = Math.tanh(channel[index]) })
    for (const sample of audioSampleFactory.fromAudioBuffer(mix, chunkStart - timelineStart)) {
      await outputSource.add(sample)
      sample.close()
    }
    onProgress((chunkEnd - timelineStart) / duration)
  }
}

function duckingGainAt(time: number, dialogueRanges: Array<{ start: number; end: number }>, amountDb: number, attackMs: number, releaseMs: number): number {
  const attenuationDb = Math.max(-60, Math.min(-0.1, amountDb))
  const attack = Math.max(0.001, attackMs / 1000)
  const release = Math.max(0.001, releaseMs / 1000)
  let gain = 1
  for (const range of dialogueRanges) {
    let envelopeDb = 0
    if (time >= range.start && time < range.start + attack) envelopeDb = attenuationDb * ((time - range.start) / attack)
    else if (time >= range.start + attack && time < range.end) envelopeDb = attenuationDb
    else if (time >= range.end && time < range.end + release) envelopeDb = attenuationDb * (1 - (time - range.end) / release)
    else continue
    gain = Math.min(gain, gainFromDb(envelopeDb))
  }
  return gain
}

function addSurroundPanned(channels: Float32Array[], frame: number, left: number, right: number, centerDegrees: number, spreadDegrees: number): void {
  const spread = Math.max(0, Math.min(180, spreadDegrees))
  addSurroundSignal(channels, frame, left * Math.SQRT1_2, centerDegrees - spread / 2)
  addSurroundSignal(channels, frame, right * Math.SQRT1_2, centerDegrees + spread / 2)
}

function addSurroundSignal(channels: Float32Array[], frame: number, value: number, angleDegrees: number): void {
  const speakers = [
    { angle: -150, channel: 4 },
    { angle: -30, channel: 0 },
    { angle: 0, channel: 2 },
    { angle: 30, channel: 1 },
    { angle: 150, channel: 5 },
    { angle: 210, channel: 4 },
  ]
  let angle = Math.max(-180, Math.min(180, angleDegrees))
  if (angle < -150) angle += 360
  const upperIndex = Math.max(1, speakers.findIndex((speaker) => speaker.angle >= angle))
  const lower = speakers[upperIndex - 1]
  const upper = speakers[upperIndex]
  const progress = Math.max(0, Math.min(1, (angle - lower.angle) / Math.max(0.0001, upper.angle - lower.angle)))
  channels[lower.channel][frame] += value * Math.cos(progress * Math.PI / 2)
  channels[upper.channel][frame] += value * Math.sin(progress * Math.PI / 2)
}

function mapAudioChannels(left: number, right: number, mode: NonNullable<ReturnType<typeof defaultAudioAdjustment>['channelMode']>, sourceMono: boolean): { left: number; right: number; mono: boolean } {
  if (mode === 'mono-left') return { left, right: left, mono: true }
  if (mode === 'mono-right') return { left: right, right, mono: true }
  if (mode === 'swap') return { left: right, right: left, mono: sourceMono }
  if (mode === 'mid') {
    const mid = (left + right) * 0.5
    return { left: mid, right: mid, mono: true }
  }
  if (mode === 'side') {
    const side = (left - right) * 0.5
    return { left: side, right: side, mono: true }
  }
  return { left, right, mono: sourceMono }
}

function applyStereoField(values: { left: number; right: number; mono: boolean }, adjustment: ReturnType<typeof defaultAudioAdjustment>): { left: number; right: number; mono: boolean } {
  const width = Math.max(0, Math.min(2, (adjustment.stereoWidth ?? 100) / 100))
  const mid = (values.left + values.right) * 0.5
  const side = (values.left - values.right) * 0.5 * width
  const left = (mid + side) * (adjustment.phaseInvertLeft ? -1 : 1)
  const right = (mid - side) * (adjustment.phaseInvertRight ? -1 : 1)
  return { left, right, mono: values.mono && Boolean(adjustment.phaseInvertLeft) === Boolean(adjustment.phaseInvertRight) }
}

interface BiquadProcessor {
  coefficients: BiquadCoefficients
  state: BiquadState
}

interface AudioFilterChain {
  highpass: BiquadProcessor
  low: BiquadProcessor
  mid: BiquadProcessor
  high: BiquadProcessor
  voice: BiquadProcessor
  deEsser: BiquadProcessor
  humFundamental: BiquadProcessor
  humHarmonic: BiquadProcessor
}

interface BusInsertProcessor {
  insert: AudioBusInsert
  highpass?: BiquadProcessor
  low?: BiquadProcessor
  mid?: BiquadProcessor
  high?: BiquadProcessor
  deEsser?: BiquadProcessor
  humFundamental?: BiquadProcessor
  humHarmonic?: BiquadProcessor
  delayLine?: Float32Array
  delayIndex?: number
}

function processor(coefficients: BiquadCoefficients): BiquadProcessor {
  return { coefficients, state: createBiquadState() }
}

function createAudioFilterChain(adjustment: ReturnType<typeof defaultAudioAdjustment>, sampleRate: number): AudioFilterChain {
  const humFrequency = adjustment.humRemoval === '50hz' ? 50 : adjustment.humRemoval === '60hz' ? 60 : 50
  const humEnabled = adjustment.humRemoval === '50hz' || adjustment.humRemoval === '60hz'
  return {
    highpass: processor(highpassBiquad(sampleRate, Math.max(20, adjustment.highpassHz ?? 20), AUDIO_EQ_Q.highpass)),
    low: processor(lowShelfBiquad(sampleRate, AUDIO_EQ_FREQUENCIES.low, adjustment.eqLowDb ?? 0)),
    mid: processor(peakingBiquad(sampleRate, AUDIO_EQ_FREQUENCIES.mid, AUDIO_EQ_Q.mid, adjustment.eqMidDb ?? 0)),
    high: processor(highShelfBiquad(sampleRate, AUDIO_EQ_FREQUENCIES.high, adjustment.eqHighDb ?? 0)),
    voice: processor(peakingBiquad(sampleRate, AUDIO_EQ_FREQUENCIES.voice, AUDIO_EQ_Q.voice, adjustment.voiceEnhance ? 4.5 : 0)),
    deEsser: processor(peakingBiquad(sampleRate, 6_500, 1.7, -Math.max(0, Math.min(100, adjustment.deEsser ?? 0)) * 0.12)),
    humFundamental: processor(peakingBiquad(sampleRate, humFrequency, 18, humEnabled ? -30 : 0)),
    humHarmonic: processor(peakingBiquad(sampleRate, humFrequency * 2, 16, humEnabled ? -18 : 0)),
  }
}

function createBusInsertProcessors(inserts: AudioBusInsert[], sampleRate: number): BusInsertProcessor[] {
  return inserts.filter((insert) => insert.enabled).map((insert) => {
    if (insert.type === 'highpass') return { insert, highpass: processor(highpassBiquad(sampleRate, insert.frequencyHz ?? 80, AUDIO_EQ_Q.highpass)) }
    if (insert.type === 'equalizer') return {
      insert,
      low: processor(lowShelfBiquad(sampleRate, AUDIO_EQ_FREQUENCIES.low, insert.lowDb ?? 0)),
      mid: processor(peakingBiquad(sampleRate, AUDIO_EQ_FREQUENCIES.mid, AUDIO_EQ_Q.mid, insert.midDb ?? 0)),
      high: processor(highShelfBiquad(sampleRate, AUDIO_EQ_FREQUENCIES.high, insert.highDb ?? 0)),
    }
    if (insert.type === 'de-esser') return { insert, deEsser: processor(peakingBiquad(sampleRate, 6_500, 1.7, -Math.max(0, Math.min(100, insert.amount ?? 45)) * 0.12)) }
    if (insert.type === 'hum-removal') {
      const amount = Math.max(0, Math.min(100, insert.amount ?? 70)) / 100
      const frequency = insert.humFrequencyHz === 50 ? 50 : 60
      return { insert, humFundamental: processor(peakingBiquad(sampleRate, frequency, 18, -30 * amount)), humHarmonic: processor(peakingBiquad(sampleRate, frequency * 2, 16, -18 * amount)) }
    }
    if (insert.type === 'delay') return { insert, delayLine: new Float32Array(Math.max(1, Math.round(sampleRate * Math.max(0.01, Math.min(2, (insert.delayMs ?? 240) / 1_000))))), delayIndex: 0 }
    return { insert }
  })
}

function applyBusInsertChain(value: number, processors: BusInsertProcessor[]): number {
  let output = value
  for (const current of processors) {
    const { insert } = current
    if (insert.type === 'highpass') {
      if (current.highpass) output = processBiquad(output, current.highpass.coefficients, current.highpass.state)
    } else if (insert.type === 'equalizer') {
      if (current.low) output = processBiquad(output, current.low.coefficients, current.low.state)
      if (current.mid) output = processBiquad(output, current.mid.coefficients, current.mid.state)
      if (current.high) output = processBiquad(output, current.high.coefficients, current.high.state)
    } else if (insert.type === 'de-esser') {
      if (current.deEsser) output = processBiquad(output, current.deEsser.coefficients, current.deEsser.state)
    } else if (insert.type === 'hum-removal') {
      if (current.humFundamental) output = processBiquad(output, current.humFundamental.coefficients, current.humFundamental.state)
      if (current.humHarmonic) output = processBiquad(output, current.humHarmonic.coefficients, current.humHarmonic.state)
    } else if (insert.type === 'compressor') {
      output = applyStaticCompressor(output, insert.thresholdDb ?? -18, insert.ratio ?? 3, insert.makeupDb ?? 0)
    } else if (insert.type === 'delay' && current.delayLine?.length) {
      const index = current.delayIndex ?? 0
      const delayed = current.delayLine[index]
      const feedback = Math.max(0, Math.min(0.85, (insert.feedback ?? 28) / 100))
      const mix = Math.max(0, Math.min(1, (insert.mix ?? 18) / 100))
      current.delayLine[index] = Math.max(-4, Math.min(4, output + delayed * feedback))
      current.delayIndex = (index + 1) % current.delayLine.length
      output = output * Math.cos(mix * Math.PI / 2) + delayed * Math.sin(mix * Math.PI / 2)
    } else if (insert.type === 'limiter') {
      output = applyBrickwallLimiter(output, insert.ceilingDb ?? -1)
    }
  }
  return output
}

function applyAudioFilters(value: number, chain: AudioFilterChain): number {
  let output = processBiquad(value, chain.highpass.coefficients, chain.highpass.state)
  output = processBiquad(output, chain.low.coefficients, chain.low.state)
  output = processBiquad(output, chain.mid.coefficients, chain.mid.state)
  output = processBiquad(output, chain.high.coefficients, chain.high.state)
  output = processBiquad(output, chain.voice.coefficients, chain.voice.state)
  output = processBiquad(output, chain.deEsser.coefficients, chain.deEsser.state)
  output = processBiquad(output, chain.humFundamental.coefficients, chain.humFundamental.state)
  return processBiquad(output, chain.humHarmonic.coefficients, chain.humHarmonic.state)
}

function applyDynamics(value: number, adjustment: ReturnType<typeof defaultAudioAdjustment>): number {
  const compressed = applyStaticCompressor(value, adjustment.compressorThresholdDb ?? -12, adjustment.compressorRatio ?? 1)
  return applyBrickwallLimiter(compressed, adjustment.limiterDb ?? -1)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('내보내기를 취소했습니다.', 'AbortError')
}
