import type { AudioSampleSink, EncodedPacketSink, VideoSampleSink } from 'mediabunny'
import type { HdrMasteringDisplay, MediaKind, SourceAudioStream } from '../editor/types'
import { createMediaSource } from '../platform/mediaSource'
import { detectFaces } from './faceDetection'
import { parseMediaTimecode } from './timecode'

export interface MediaAnalysis {
  duration: number
  width?: number
  height?: number
  videoCodec?: string
  videoDecodable?: boolean
  imageDecodable?: boolean
  frameRate?: number
  variableFrameRate?: boolean
  frameRateVariation?: number
  audioCodec?: string
  audioDecodable?: boolean
  sampleRate?: number
  channels?: number
  audioStreams?: SourceAudioStream[]
  audioPeak?: number
  thumbnailUrl?: string
  waveform?: number[]
  faceTrack?: Array<{ time: number; x: number; y: number; confidence: number }>
  timecodeStart?: number
  sourceTimecode?: string
  timecodeDropFrame?: boolean
  timecodeSource?: 'container'
  reelName?: string
  colorPrimaries?: string
  colorTransfer?: string
  colorSpace?: string
  colorRange?: string
  hdrFormat?: 'pq' | 'hlg' | 'wide-gamut'
  hdrMasteringDisplay?: HdrMasteringDisplay
  maxContentLightLevel?: number
  maxFrameAverageLightLevel?: number
}

export interface MediaAnalysisOptions {
  includeWaveform?: boolean
  includeFaceTrack?: boolean
}

export async function analyzeMediaFile(file: File, url: string, kind: MediaKind, options: MediaAnalysisOptions = {}): Promise<MediaAnalysis> {
  const includeWaveform = options.includeWaveform !== false
  const includeFaceTrack = options.includeFaceTrack !== false
  if (kind === 'image') {
    try {
      const bitmap = await createImageBitmap(file)
      const thumbnailUrl = createThumbnailFromBitmap(bitmap)
      const analysis = { duration: 5, width: bitmap.width, height: bitmap.height, thumbnailUrl, imageDecodable: true }
      bitmap.close()
      return analysis
    } catch (error) {
      const sourcePath = (file as File & { __editweaveSourcePath?: string }).__editweaveSourcePath
      const native = sourcePath ? await probeContainerMetadata(sourcePath).catch(() => undefined) : undefined
      if (!native?.width || !native.height) throw error
      return {
        duration: 5,
        width: native.width,
        height: native.height,
        videoCodec: native.videoCodec,
        imageDecodable: false,
        colorPrimaries: native.colorPrimaries,
        colorTransfer: native.colorTransfer,
        colorSpace: native.colorSpace,
        colorRange: native.colorRange,
        hdrFormat: native.hdrFormat,
        hdrMasteringDisplay: native.hdrMasteringDisplay,
        maxContentLightLevel: native.maxContentLightLevel,
        maxFrameAverageLightLevel: native.maxFrameAverageLightLevel,
      }
    }
  }

  void url
  const sourcePath = (file as File & { __editweaveSourcePath?: string }).__editweaveSourcePath
  const { ALL_FORMATS, AudioSampleSink, EncodedPacketSink, Input, VideoSampleSink } = await import('mediabunny')
  const input = new Input({ source: await createMediaSource(file, sourcePath), formats: ALL_FORMATS })
  try {
    const [duration, videoTrack, audioTrack, descriptiveMetadata] = await Promise.all([
      input.computeDuration().catch(() => 0),
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
      input.getMetadataTags().catch(() => undefined),
    ])

    const analysis: MediaAnalysis = { duration: Number.isFinite(duration) && duration > 0 ? duration : 10 }

    if (videoTrack) {
      const [width, height, videoCodec, videoDecodable, frameTiming] = await Promise.all([
        videoTrack.getDisplayWidth(),
        videoTrack.getDisplayHeight(),
        videoTrack.getCodec(),
        videoTrack.canDecode(),
        analyzeFrameTiming(new EncodedPacketSink(videoTrack)).catch(() => undefined),
      ])
      analysis.width = width
      analysis.height = height
      analysis.videoCodec = videoCodec ?? undefined
      analysis.videoDecodable = videoDecodable
      analysis.frameRate = frameTiming?.frameRate
      analysis.variableFrameRate = frameTiming?.variable
      analysis.frameRateVariation = frameTiming?.variation
      if (videoDecodable) {
        const visualAnalysis = await captureVideoAnalysis(new VideoSampleSink(videoTrack), analysis.duration, includeFaceTrack).catch(() => undefined)
        analysis.thumbnailUrl = visualAnalysis?.thumbnailUrl
        analysis.faceTrack = visualAnalysis?.faceTrack
      }
    }

    if (audioTrack) {
      const [audioCodec, audioDecodable, sampleRate, channels] = await Promise.all([
        audioTrack.getCodec(),
        audioTrack.canDecode(),
        audioTrack.getSampleRate(),
        audioTrack.getNumberOfChannels(),
      ])
      analysis.audioCodec = audioCodec ?? undefined
      analysis.audioDecodable = audioDecodable
      analysis.sampleRate = sampleRate
      analysis.channels = channels
      if (audioDecodable && includeWaveform) {
        const audioAnalysis = await createAudioWaveform(new AudioSampleSink(audioTrack), analysis.duration).catch(() => undefined)
        analysis.waveform = audioAnalysis?.waveform
        analysis.audioPeak = audioAnalysis?.audioPeak
      }
    }

    {
      const fallbackMetadata = extractContainerMetadataTags(descriptiveMetadata)
      const nativeMetadata = sourcePath ? await probeContainerMetadata(sourcePath).catch(() => undefined) : undefined
      const metadata: NativeContainerMetadata = {
        ...(nativeMetadata ?? {}),
        timecode: nativeMetadata?.timecode ?? fallbackMetadata.timecode,
        reelName: nativeMetadata?.reelName ?? fallbackMetadata.reelName,
      }
      const probeFps = fractionToNumber(metadata?.frameRate)
      if ((!Number.isFinite(duration) || duration <= 0) && Number.isFinite(metadata.duration) && (metadata.duration ?? 0) > 0) analysis.duration = metadata.duration!
      if (!videoTrack && (metadata.videoCodec || metadata.width || metadata.height)) {
        analysis.width = metadata.width
        analysis.height = metadata.height
        analysis.videoCodec = metadata.videoCodec
        analysis.videoDecodable = false
        analysis.frameRate = probeFps
      }
      if (!audioTrack && (metadata.audioCodec || metadata.sampleRate || metadata.channels)) {
        analysis.audioCodec = metadata.audioCodec
        analysis.audioDecodable = false
        analysis.sampleRate = metadata.sampleRate
        analysis.channels = metadata.channels
      }
      if (metadata.audioStreams?.length) analysis.audioStreams = metadata.audioStreams
      const parsedTimecode = metadata?.timecode ? parseMediaTimecode(metadata.timecode, analysis.frameRate || probeFps || 30) : undefined
      if (parsedTimecode) {
        analysis.timecodeStart = parsedTimecode.seconds
        analysis.sourceTimecode = parsedTimecode.normalized
        analysis.timecodeDropFrame = parsedTimecode.dropFrame
        analysis.timecodeSource = 'container'
      }
      if (metadata?.reelName) analysis.reelName = metadata.reelName
      analysis.colorPrimaries = metadata?.colorPrimaries
      analysis.colorTransfer = metadata?.colorTransfer
      analysis.colorSpace = metadata?.colorSpace
      analysis.colorRange = metadata?.colorRange
      analysis.hdrFormat = metadata?.hdrFormat
      analysis.hdrMasteringDisplay = metadata?.hdrMasteringDisplay
      analysis.maxContentLightLevel = metadata?.maxContentLightLevel
      analysis.maxFrameAverageLightLevel = metadata?.maxFrameAverageLightLevel
    }

    return analysis
  } catch (error) {
    if (!sourcePath) throw error
    const native = await probeContainerMetadata(sourcePath).catch(() => undefined)
    const fallback = native ? nativeFallbackAnalysis(native, kind) : undefined
    if (!fallback) throw error
    return fallback
  } finally {
    input.dispose()
  }
}

interface NativeContainerMetadata {
  duration?: number
  width?: number
  height?: number
  videoCodec?: string
  audioCodec?: string
  sampleRate?: number
  channels?: number
  audioStreams?: SourceAudioStream[]
  timecode?: string
  reelName?: string
  frameRate?: string
  colorPrimaries?: string
  colorTransfer?: string
  colorSpace?: string
  colorRange?: string
  hdrFormat?: 'pq' | 'hlg' | 'wide-gamut'
  hdrMasteringDisplay?: HdrMasteringDisplay
  maxContentLightLevel?: number
  maxFrameAverageLightLevel?: number
}

function nativeFallbackAnalysis(metadata: NativeContainerMetadata, kind: MediaKind): MediaAnalysis | undefined {
  const hasVideo = Boolean(metadata.videoCodec || metadata.width || metadata.height)
  const hasAudio = Boolean(metadata.audioCodec || metadata.sampleRate || metadata.channels)
  if (kind === 'video' && !hasVideo || kind === 'audio' && !hasAudio) return undefined
  return {
    duration: Number.isFinite(metadata.duration) && (metadata.duration ?? 0) > 0 ? metadata.duration! : 10,
    width: metadata.width,
    height: metadata.height,
    videoCodec: metadata.videoCodec,
    videoDecodable: hasVideo ? false : undefined,
    frameRate: fractionToNumber(metadata.frameRate),
    audioCodec: metadata.audioCodec,
    audioDecodable: hasAudio ? false : undefined,
    sampleRate: metadata.sampleRate,
    channels: metadata.channels,
    audioStreams: metadata.audioStreams,
    timecodeStart: metadata.timecode ? parseMediaTimecode(metadata.timecode, fractionToNumber(metadata.frameRate) || 30)?.seconds : undefined,
    sourceTimecode: metadata.timecode,
    timecodeDropFrame: metadata.timecode?.includes(';'),
    timecodeSource: metadata.timecode ? 'container' : undefined,
    reelName: metadata.reelName,
    colorPrimaries: metadata.colorPrimaries,
    colorTransfer: metadata.colorTransfer,
    colorSpace: metadata.colorSpace,
    colorRange: metadata.colorRange,
    hdrFormat: metadata.hdrFormat,
    hdrMasteringDisplay: metadata.hdrMasteringDisplay,
    maxContentLightLevel: metadata.maxContentLightLevel,
    maxFrameAverageLightLevel: metadata.maxFrameAverageLightLevel,
  }
}

interface DescriptiveMetadataTags {
  comment?: string
  description?: string
  raw?: Record<string, string | Uint8Array | Record<string, string> | null | unknown>
}

export function extractContainerMetadataTags(metadata?: DescriptiveMetadataTags): Pick<NativeContainerMetadata, 'timecode' | 'reelName'> {
  if (!metadata) return {}
  const entries: Array<{ key: string; value: string }> = []
  const push = (key: string, value: unknown) => {
    if (typeof value === 'string') entries.push({ key: key.toLocaleLowerCase('en-US'), value: value.trim() })
    else if (value instanceof Uint8Array) {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(value).replace(/[\u0000-\u001f]+/g, ' ').trim()
      if (text) entries.push({ key: key.toLocaleLowerCase('en-US'), value: text })
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.entries(value as Record<string, unknown>).forEach(([childKey, childValue]) => push(`${key}.${childKey}`, childValue))
    }
  }
  if (metadata.comment) push('comment', metadata.comment)
  if (metadata.description) push('description', metadata.description)
  Object.entries(metadata.raw ?? {}).forEach(([key, value]) => push(key, value))
  const timecodeKeys = ['timecode', 'time_code', 'start_tc', 'start timecode', 'com.apple.quicktime.timecode']
  const reelKeys = ['reel', 'reel_name', 'reelname', 'tape', 'tape_name', 'com.apple.quicktime.reel']
  const timecodePattern = /(?:^|\s)(\d{1,2}:\d{2}:\d{2}[:;]\d{2})(?:\s|$)/
  const preferredTimecode = entries.find((entry) => timecodeKeys.some((key) => entry.key.includes(key)))
  const timecode = preferredTimecode?.value.match(timecodePattern)?.[1]
    ?? entries.map((entry) => entry.value.match(timecodePattern)?.[1]).find(Boolean)
  const reel = entries.find((entry) => reelKeys.some((key) => entry.key.includes(key)))?.value
  return {
    timecode,
    reelName: reel?.replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 200) || undefined,
  }
}

async function probeContainerMetadata(sourcePath: string): Promise<NativeContainerMetadata | undefined> {
  const { isTauri, invoke } = await import('@tauri-apps/api/core')
  if (!isTauri()) return undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      invoke<NativeContainerMetadata>('probe_media_metadata', { sourcePath }),
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), 6_000) }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function fractionToNumber(value?: string): number | undefined {
  if (!value) return undefined
  const [numeratorText, denominatorText] = value.split('/')
  const numerator = Number(numeratorText)
  const denominator = denominatorText === undefined ? 1 : Number(denominatorText)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return undefined
  return numerator / denominator
}

async function analyzeFrameTiming(sink: EncodedPacketSink, limit = 240): Promise<{ frameRate: number; variable: boolean; variation: number }> {
  const packets: Array<{ timestamp: number; duration: number }> = []
  for await (const packet of sink.packets(undefined, undefined, { metadataOnly: true })) {
    if (packet.duration > 0 && Number.isFinite(packet.duration)) packets.push({ timestamp: packet.timestamp, duration: packet.duration })
    if (packets.length >= limit) break
  }
  return summarizeFrameTiming(packets)
}

export function summarizeFrameTiming(packets: Array<{ timestamp: number; duration: number }>): { frameRate: number; variable: boolean; variation: number } {
  const durations = packets.map((packet) => packet.duration).filter((duration) => duration > 0 && Number.isFinite(duration))
  const firstTimestamp = Math.min(...packets.map((packet) => packet.timestamp))
  const lastEnd = Math.max(...packets.map((packet) => packet.timestamp + packet.duration))
  if (durations.length < 2 || !Number.isFinite(firstTimestamp) || lastEnd <= firstTimestamp) {
    return { frameRate: 0, variable: false, variation: 0 }
  }
  const mean = durations.reduce((sum, value) => sum + value, 0) / durations.length
  const variance = durations.reduce((sum, value) => sum + (value - mean) ** 2, 0) / durations.length
  const variation = mean > 0 ? Math.sqrt(variance) / mean : 0
  const frameRate = durations.length / (lastEnd - firstTimestamp)
  return {
    frameRate: Math.round(frameRate * 100) / 100,
    variable: variation > 0.08,
    variation: Math.round(variation * 1000) / 1000,
  }
}

function createThumbnailFromBitmap(bitmap: ImageBitmap): string {
  const canvas = document.createElement('canvas')
  const maxWidth = 320
  const scale = Math.min(1, maxWidth / bitmap.width)
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.76)
}

async function captureVideoAnalysis(sink: VideoSampleSink, duration: number, includeFaceTrack: boolean): Promise<{ thumbnailUrl: string; faceTrack?: Array<{ time: number; x: number; y: number; confidence: number }> }> {
  const canvas = document.createElement('canvas')
  const sampleRatios = includeFaceTrack ? [0.08, 0.28, 0.5, 0.72, 0.92] : [0.08]
  const sampleTimes = sampleRatios.map((ratio) => Math.min(Math.max(0, duration * ratio), Math.max(0, duration - 0.05)))
  const faceTrack: Array<{ time: number; x: number; y: number; confidence: number }> = []
  let thumbnailUrl = ''
  for (const [index, time] of sampleTimes.entries()) {
    const sample = await sink.getSample(time)
    if (!sample) continue
    const maxWidth = 320
    const scale = Math.min(1, maxWidth / sample.displayWidth)
    canvas.width = Math.max(1, Math.round(sample.displayWidth * scale))
    canvas.height = Math.max(1, Math.round(sample.displayHeight * scale))
    const context = canvas.getContext('2d')
    sample.draw(context!, 0, 0, canvas.width, canvas.height)
    sample.close()
    if (index === 0) thumbnailUrl = canvas.toDataURL('image/jpeg', 0.76)
    if (includeFaceTrack) {
      const face = await detectPrimaryFace(canvas).catch(() => undefined)
      if (face) faceTrack.push({ time, ...face })
    }
  }
  return { thumbnailUrl, faceTrack: faceTrack.length ? faceTrack : undefined }
}

async function detectPrimaryFace(canvas: HTMLCanvasElement): Promise<{ x: number; y: number; confidence: number } | undefined> {
  const faces = await detectFaces(canvas)
  const primary = faces.sort((a, b) => b.width * b.height - a.width * a.height)[0]
  if (!primary) return undefined
  return {
    x: (primary.x + primary.width / 2) / canvas.width,
    y: (primary.y + primary.height / 2) / canvas.height,
    confidence: primary.confidence,
  }
}

async function createAudioWaveform(sink: AudioSampleSink, duration: number, buckets = 160): Promise<{ waveform: number[]; audioPeak: number }> {
  const peaks = new Float32Array(buckets)
  let audioPeak = 0
  let decodedSamples = 0
  for await (const sample of sink.samples(0, duration)) {
    try {
      const buffer = sample.toAudioBuffer()
      for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex++) {
        const channel = buffer.getChannelData(channelIndex)
        const step = Math.max(1, Math.floor(channel.length / 1024))
        for (let index = 0; index < channel.length; index += step) {
          const level = Math.abs(channel[index])
          audioPeak = Math.max(audioPeak, level)
          const time = sample.timestamp + index / buffer.sampleRate
          const bucket = Math.max(0, Math.min(buckets - 1, Math.floor(time / Math.max(0.001, duration) * buckets)))
          peaks[bucket] = Math.max(peaks[bucket], level)
        }
      }
    } finally {
      sample.close()
    }
    decodedSamples += 1
    if (decodedSamples % 12 === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  }
  return {
    waveform: Array.from(peaks, (peak) => Math.round(peak * 1000) / 1000),
    audioPeak: Math.round(audioPeak * 1_000_000) / 1_000_000,
  }
}
