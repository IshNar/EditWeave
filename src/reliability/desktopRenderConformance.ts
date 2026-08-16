import { clipSourceTime, defaultAudioAdjustment, defaultColorAdjustment, defaultTransform, defaultVisualEffects } from '../editor/effects'
import type { MediaAsset, TimelineClip, TimelineTrack } from '../editor/types'
import { drawCaption, drawVisual, exportAudioStem, exportSequence } from '../media/export'
import { createMediaSource } from '../platform/mediaSource'
import { comparePcm, evaluateDecodedMediaConformance, type DecodedMediaConformanceResult, type PcmComparison, type RgbFrame } from './decodedMediaConformance'

export interface DesktopRenderCapabilities {
  videoEncoder: boolean
  videoDecoder: boolean
  audioEncoder: boolean
  audioDecoder: boolean
  videoFrame: boolean
  audioData: boolean
  canvas2d: boolean
}

export interface DesktopRenderConformanceReport {
  status: 'passed' | 'failed' | 'blocked'
  startedAt: string
  completedAt: string
  capabilities: DesktopRenderCapabilities
  blockers: string[]
  result?: DecodedMediaConformanceResult
  cases?: DesktopRenderCaseResult[]
  error?: string
}

export interface DesktopRenderCaseDefinition {
  id: string
  label: string
  width: number
  height: number
  fps: number
  duration: number
  decorated?: boolean
  scenario?: 'basic' | 'decorated' | 'speed-cut' | 'high-resolution' | 'ultra-high-resolution' | 'hevc-sdr' | 'hdr10-pq' | 'hdr-hlg' | 'surround-5.1' | 'surround-5.1-wav' | 'long-duration'
  comparisonFrames?: number
  bitrateMbps?: number
  codec?: 'avc' | 'hevc'
  colorMode?: 'sdr' | 'hdr10-pq' | 'hdr-hlg'
  audioChannels?: 1 | 2 | 6
  audioBitrateKbps?: number
  referenceUrl?: string
  maximumRenderMilliseconds?: number
  maximumHeapDeltaBytes?: number
  audioEdgeSeconds?: number
}

export interface DesktopRenderCaseResult extends DesktopRenderCaseDefinition {
  passed?: boolean
  blocked?: boolean
  comparisonMode?: 'rgb24' | 'hdr-artifact' | 'surround-5.1' | 'surround-5.1-wav'
  expectedOutputFrames?: number
  comparedFrames?: number
  result?: DecodedMediaConformanceResult
  artifactProfile?: DecodedVideoProfile
  audio?: PcmComparison
  audioProfile?: DecodedAudioProfile
  tailAudio?: PcmComparison
  elapsedMilliseconds?: number
  outputBytes?: number
  heapDeltaBytes?: number
  issues?: string[]
  error?: string
}

export interface DecodedVideoProfile {
  format: string
  primaries: string
  transfer: string
  matrix: string
  fullRange: boolean | null
}

export interface DecodedAudioProfile {
  channels: number
  channelRms: number[]
}

export const desktopRenderConformanceCases: DesktopRenderCaseDefinition[] = [
  { id: 'baseline-30-landscape', label: '기본 가로 30fps', width: 160, height: 90, fps: 30, duration: 2, scenario: 'basic' },
  { id: 'creator-29.97-landscape', label: '크리에이터 합성 29.97fps', width: 320, height: 180, fps: 29.97, duration: 2, decorated: true, scenario: 'decorated' },
  { id: 'shorts-23.976-portrait', label: '세로 쇼츠 23.976fps', width: 90, height: 160, fps: 23.976, duration: 1.5, scenario: 'basic' },
  { id: 'high-rate-59.94-landscape', label: '고프레임 가로 59.94fps', width: 320, height: 180, fps: 59.94, duration: 1.5, scenario: 'basic' },
  { id: 'speed-cut-30-landscape', label: '속도 램프·복합 컷 30fps', width: 320, height: 180, fps: 30, duration: 2, scenario: 'speed-cut' },
  { id: 'full-hd-30-landscape', label: 'Full HD 대표 프레임 30fps', width: 1920, height: 1080, fps: 30, duration: 0.5, scenario: 'high-resolution', comparisonFrames: 6, bitrateMbps: 8 },
  { id: 'uhd-4k-30-landscape', label: 'UHD 4K 대표 프레임 30fps', width: 3840, height: 2160, fps: 30, duration: 0.2, scenario: 'ultra-high-resolution', comparisonFrames: 3, bitrateMbps: 20 },
  { id: 'hevc-sdr-30-landscape', label: 'HEVC SDR 30fps', width: 320, height: 180, fps: 30, duration: 0.5, scenario: 'hevc-sdr', comparisonFrames: 15, bitrateMbps: 4, codec: 'hevc' },
  { id: 'hdr10-pq-main10', label: 'HDR10 PQ Main10', width: 320, height: 180, fps: 30, duration: 0.2, scenario: 'hdr10-pq', comparisonFrames: 3, bitrateMbps: 8, codec: 'hevc', colorMode: 'hdr10-pq' },
  { id: 'hdr-hlg-main10', label: 'HDR HLG Main10', width: 320, height: 180, fps: 30, duration: 0.2, scenario: 'hdr-hlg', comparisonFrames: 3, bitrateMbps: 8, codec: 'hevc', colorMode: 'hdr-hlg' },
  { id: 'aac-5.1-dialogue-center', label: 'AAC 5.1 대사 센터 라우팅', width: 320, height: 180, fps: 30, duration: 0.5, scenario: 'surround-5.1', comparisonFrames: 15, bitrateMbps: 4, audioChannels: 6, audioBitrateKbps: 320 },
  { id: 'wav-5.1-dialogue-center', label: '24-bit WAV 5.1 대사 센터 라우팅', width: 320, height: 180, fps: 30, duration: 0.5, scenario: 'surround-5.1-wav', comparisonFrames: 0, audioChannels: 6 },
  { id: 'long-30s-30-landscape', label: '장시간 30초 900프레임', width: 160, height: 90, fps: 30, duration: 30, scenario: 'long-duration', comparisonFrames: 12, bitrateMbps: 4, referenceUrl: '/e2e/render-conformance-long.mp4', maximumRenderMilliseconds: 120_000, maximumHeapDeltaBytes: 256 * 1024 * 1024 },
  { id: 'long-10m-30-landscape', label: '장시간 10분 18,000프레임', width: 160, height: 90, fps: 30, duration: 600, scenario: 'long-duration', comparisonFrames: 16, bitrateMbps: 4, referenceUrl: '/e2e/render-conformance-10m.mp4', maximumRenderMilliseconds: 600_000, maximumHeapDeltaBytes: 512 * 1024 * 1024, audioEdgeSeconds: 2 },
]

export function detectDesktopRenderCapabilities(scope: typeof globalThis = globalThis): DesktopRenderCapabilities {
  const canvas = scope.document?.createElement?.('canvas')
  return {
    videoEncoder: 'VideoEncoder' in scope,
    videoDecoder: 'VideoDecoder' in scope,
    audioEncoder: 'AudioEncoder' in scope,
    audioDecoder: 'AudioDecoder' in scope,
    videoFrame: 'VideoFrame' in scope,
    audioData: 'AudioData' in scope,
    canvas2d: Boolean(canvas?.getContext?.('2d')),
  }
}

export function desktopRenderCapabilityBlockers(capabilities: DesktopRenderCapabilities): string[] {
  return (Object.entries(capabilities) as Array<[keyof DesktopRenderCapabilities, boolean]>).filter(([, available]) => !available).map(([name]) => name)
}

export async function runDesktopRenderConformance(referenceUrl = '/e2e/render-conformance.mp4', cases = desktopRenderConformanceCases): Promise<DesktopRenderConformanceReport> {
  const startedAt = new Date().toISOString()
  const capabilities = detectDesktopRenderCapabilities()
  const blockers = desktopRenderCapabilityBlockers(capabilities)
  if (blockers.length) return { status: 'blocked', startedAt, completedAt: new Date().toISOString(), capabilities, blockers }
  try {
    const references = new Map<string, File>()
    const loadReference = async (url: string) => {
      const cached = references.get(url)
      if (cached) return cached
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) throw new Error(`기준 미디어를 가져오지 못했습니다: ${url} HTTP ${response.status}`)
      const file = new File([await response.arrayBuffer()], url.split('/').pop() ?? 'render-conformance.mp4', { type: 'video/mp4' })
      references.set(url, file)
      return file
    }
    const caseResults: DesktopRenderCaseResult[] = []
    for (const definition of cases) {
      try {
        const referenceFile = await loadReference(definition.referenceUrl ?? referenceUrl)
        const outcome = await renderAndCompare(referenceFile, definition)
        caseResults.push({ ...definition, expectedOutputFrames: Math.ceil(definition.duration * definition.fps), ...outcome })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        caseResults.push({ ...definition, passed: false, blocked: isDesktopRenderCapabilityBlock(message), error: message })
      }
    }
    const status = classifyDesktopRenderCases(caseResults)
    const caseBlockers = caseResults.filter((item) => item.blocked).map((item) => `${item.id}: ${item.error}`)
    return { status, startedAt, completedAt: new Date().toISOString(), capabilities, blockers: caseBlockers, result: caseResults[0]?.result, cases: caseResults }
  } catch (error) {
    return { status: 'failed', startedAt, completedAt: new Date().toISOString(), capabilities, blockers: [], error: error instanceof Error ? error.message : String(error) }
  }
}

export function isDesktopRenderCapabilityBlock(message: string): boolean {
  return message.includes('HEVC Main10 10-bit 출력을 지원하지 않습니다') || message.includes('WebGPU') || message.includes('5.1 AAC') && message.includes('지원하지 않습니다')
}

export function classifyDesktopRenderCases(cases: DesktopRenderCaseResult[]): DesktopRenderConformanceReport['status'] {
  if (!cases.length) return 'failed'
  if (cases.some((item) => !item.passed && !item.blocked)) return 'failed'
  if (cases.some((item) => item.blocked)) return 'blocked'
  return cases.every((item) => item.passed) ? 'passed' : 'failed'
}

async function renderAndCompare(referenceFile: File, definition: DesktopRenderCaseDefinition): Promise<Pick<DesktopRenderCaseResult, 'passed' | 'comparisonMode' | 'comparedFrames' | 'result' | 'artifactProfile' | 'audio' | 'audioProfile' | 'tailAudio' | 'elapsedMilliseconds' | 'outputBytes' | 'heapDeltaBytes' | 'issues'>> {
  const { fps, duration, width, height } = definition
  const sampleRate = 48_000
  const asset: MediaAsset = { id: 'e2e-source', name: referenceFile.name, kind: 'video', url: URL.createObjectURL(referenceFile), sourceFile: referenceFile, duration, size: referenceFile.size, extension: 'mp4', width: 160, height: 90, frameRate: 30, sampleRate, channels: 1, status: 'ready' }
  const clip: TimelineClip = {
    id: 'e2e-clip', trackId: 'e2e-video', assetId: asset.id, name: 'E2E 기준 클립', kind: 'video', color: '#7a9cff', start: 0, duration, sourceOffset: 0,
    transform: defaultTransform, colorAdjustment: definition.decorated ? { ...defaultColorAdjustment(), exposure: 0.12, saturation: 8 } : defaultColorAdjustment(), visualEffects: defaultVisualEffects(), audioAdjustment: defaultAudioAdjustment(), audioDisabled: true,
    transitionIn: definition.decorated ? { type: 'crossfade', duration: 0.25, alignment: 'start-at-cut', easing: 'ease-in-out', audioCurve: 'equal-power' } : undefined,
    keyframes: definition.decorated ? [
      { id: 'e2e-transform-start', time: 0, easing: 'linear', transform: { ...defaultTransform, positionX: -8, scale: 96 } },
      { id: 'e2e-transform-end', time: duration, easing: 'ease-in-out', transform: { ...defaultTransform, positionX: 8, scale: 104 } },
    ] : undefined,
  }
  const speedCut = definition.scenario === 'speed-cut'
  const cut = duration / 2
  const firstClip: TimelineClip = speedCut ? { ...structuredClone(clip), id: 'e2e-speed-first', duration: cut, speedKeyframes: [{ id: 'speed-start', time: 0, rate: 1, easing: 'linear' }, { id: 'speed-end', time: cut, rate: 1.4, easing: 'ease-in-out' }] } : clip
  const secondClip: TimelineClip | undefined = speedCut ? { ...structuredClone(clip), id: 'e2e-speed-second', start: cut, duration: duration - cut, sourceOffset: 1.2, playbackRate: 0.75, keyframes: [{ id: 'cut-transform-start', time: 0, easing: 'linear', transform: { ...defaultTransform, scale: 102 } }, { id: 'cut-transform-end', time: duration - cut, easing: 'linear', transform: { ...defaultTransform, positionX: 12, scale: 98 } }] } : undefined
  const programClips = secondClip ? [firstClip, secondClip] : [firstClip]
  const audioClip: TimelineClip = { ...structuredClone(clip), id: 'e2e-audio', trackId: 'e2e-audio-track', name: 'E2E 기준 오디오', kind: 'audio', audioDisabled: false, transitionIn: undefined, keyframes: undefined, colorAdjustment: defaultColorAdjustment() }
  const overlay: TimelineClip | undefined = definition.decorated ? { ...structuredClone(clip), id: 'e2e-overlay', trackId: 'e2e-overlay-track', name: 'E2E 오버레이', audioDisabled: true, color: '#ffb866', transform: { ...defaultTransform, positionX: width * 0.22, positionY: -height * 0.18, scale: 32, opacity: 58 }, keyframes: undefined, colorAdjustment: { ...defaultColorAdjustment(), exposure: -0.08, saturation: -12 } } : undefined
  const caption: TimelineClip | undefined = definition.decorated ? { id: 'e2e-caption', trackId: 'e2e-caption-track', name: 'CUTLINE E2E · 미리보기와 출력 일치', kind: 'caption', color: '#ffd45c', start: 0.25, duration: Math.max(0.5, duration - 0.5), sourceOffset: 0, transform: defaultTransform, captionStyle: { preset: 'default', fontSize: 34, textColor: '#ffffff', backgroundColor: 'rgba(5,5,8,.74)', position: 'bottom', highlightColor: '#ffd45c', fontFamily: 'sans', fontWeight: 800, strokeColor: '#000000', strokeWidth: 0, textAlign: 'center', positionX: 50, positionY: 82, lineHeight: 120, letterSpacing: 0, maxWidth: 84, backgroundEnabled: true, backgroundPaddingX: 18, backgroundPaddingY: 10, backgroundRadius: 10, shadowColor: 'rgba(0,0,0,.65)', shadowBlur: 3, shadowX: 0, shadowY: 1, rotation: 0, safeArea: 'title', uppercase: false, animation: 'none', animationOut: 'none', animationDuration: 0.2 } } : undefined
  const tracks: TimelineTrack[] = [
    { id: 'e2e-video', name: 'V1 · E2E', kind: 'video', locked: false, muted: false, visible: true, volume: 100, pan: 0, clips: programClips },
    ...(overlay ? [{ id: 'e2e-overlay-track', name: 'V2 · Overlay', kind: 'video' as const, locked: false, muted: false, visible: true, volume: 100, pan: 0, compositePriority: 100, clips: [overlay] }] : []),
    { id: 'e2e-audio-track', name: 'A1 · E2E', kind: 'audio', locked: false, muted: false, volume: 100, pan: 0, clips: [audioClip] },
    ...(caption ? [{ id: 'e2e-caption-track', name: 'T1 · Caption', kind: 'caption' as const, locked: false, muted: false, visible: true, volume: 100, pan: 0, clips: [caption] }] : []),
  ]
  try {
    if (definition.scenario === 'surround-5.1-wav') {
      const referenceAudio = await decodeAudioChannels(referenceFile, duration, sampleRate)
      const rendered = await exportAudioStem({ projectName: `Cutline Desktop Render Conformance · ${definition.id}`, stemName: 'Full Mix 5.1', roles: ['dialogue', 'music', 'effects', 'ambient'], sampleRate, channels: 6, assets: [asset], tracks, rangeStart: 0, rangeEnd: duration })
      if (!rendered.buffer) throw new Error('5.1 WAV 출력 버퍼가 생성되지 않았습니다.')
      const candidateAudio = await decodeAudioChannels(new File([rendered.buffer], 'cutline-5.1-conformance.wav', { type: rendered.mimeType }), duration, sampleRate)
      const audioProfile = { channels: candidateAudio.length, channelRms: candidateAudio.map(rootMeanSquare) }
      const centerPcm = candidateAudio[2]
      const referencePcm = referenceAudio[0]
      const audio = centerPcm && referencePcm ? comparePcm(referencePcm, centerPcm, sampleRate, 512) : undefined
      const issues = surround51Issues(audioProfile, audio)
      return { passed: issues.length === 0, comparisonMode: 'surround-5.1-wav', comparedFrames: 0, audio, audioProfile, issues }
    }
    const activeProgramClip = (timelineTime: number) => programClips.find((candidate) => timelineTime >= candidate.start && timelineTime < candidate.start + candidate.duration) ?? programClips[programClips.length - 1]
    const reference = await decodeMedia(referenceFile, duration, fps, sampleRate, width, height, (context, frame, timelineTime) => {
      context.fillStyle = '#08080b'
      context.fillRect(0, 0, width, height)
      drawVisual(context, frame, frame.displayWidth, frame.displayHeight, asset, activeProgramClip(timelineTime), timelineTime, width, height)
      if (overlay) drawVisual(context, frame, frame.displayWidth, frame.displayHeight, asset, overlay, timelineTime, width, height)
      if (caption && timelineTime >= caption.start && timelineTime < caption.start + caption.duration) drawCaption(context, caption, timelineTime, width, height)
    }, (timelineTime) => clipSourceTime(activeProgramClip(timelineTime), timelineTime), definition.comparisonFrames, definition.audioEdgeSeconds)
    const ratio = width < height ? '9:16' as const : '16:9' as const
    const heapBefore = usedJsHeapSize()
    const renderStarted = performance.now()
    const rendered = await exportSequence({ projectName: `Cutline Desktop Render Conformance · ${definition.id}`, preset: { ratio, width, height, label: `E2E ${width}×${height}` }, height: Math.min(width, height), fps, codec: definition.codec ?? 'avc', colorMode: definition.colorMode ?? 'sdr', bitrateMbps: definition.bitrateMbps ?? 4, hardwareAcceleration: 'no-preference', includeAudio: true, audioSampleRate: sampleRate, audioBitrateKbps: definition.audioBitrateKbps ?? 128, audioChannels: definition.audioChannels ?? 1, assets: [asset], tracks })
    const elapsedMilliseconds = performance.now() - renderStarted
    if (rendered.actualCodec !== (definition.codec ?? 'avc')) throw new Error(`요청 코덱 ${(definition.codec ?? 'avc').toUpperCase()} 대신 ${rendered.actualCodec.toUpperCase()}가 생성됐습니다.`)
    if (!rendered.buffer) throw new Error('E2E 출력 버퍼가 생성되지 않았습니다.')
    const candidateFile = new File([rendered.buffer], 'cutline-render-conformance.mp4', { type: rendered.mimeType })
    const candidate = await decodeMedia(candidateFile, duration, fps, sampleRate, width, height, undefined, undefined, definition.comparisonFrames, definition.audioEdgeSeconds)
    const heapAfter = usedJsHeapSize()
    const outputBytes = rendered.buffer.byteLength
    const heapDeltaBytes = heapBefore !== undefined && heapAfter !== undefined ? Math.max(0, heapAfter - heapBefore) : undefined
    if (definition.colorMode && definition.colorMode !== 'sdr') {
      const expectedTransfer = definition.colorMode === 'hdr10-pq' ? 'pq' : 'hlg'
      const artifactProfile = candidate.videoProfile
      const audio = comparePcm(reference.pcm, candidate.pcm, sampleRate, 512)
      const issues: string[] = []
      if (!artifactProfile) issues.push('HDR 출력의 디코딩 영상 프로필을 읽지 못했습니다.')
      if (artifactProfile?.format !== 'I420P10') issues.push(`HDR 픽셀 형식 ${artifactProfile?.format ?? '없음'} != I420P10`)
      if (artifactProfile?.primaries !== 'bt2020') issues.push(`HDR primaries ${artifactProfile?.primaries ?? '없음'} != bt2020`)
      if (artifactProfile?.transfer !== expectedTransfer) issues.push(`HDR transfer ${artifactProfile?.transfer ?? '없음'} != ${expectedTransfer}`)
      if (artifactProfile?.matrix !== 'bt2020-ncl') issues.push(`HDR matrix ${artifactProfile?.matrix ?? '없음'} != bt2020-ncl`)
      if (artifactProfile?.fullRange !== false) issues.push(`HDR range ${String(artifactProfile?.fullRange)} != limited`)
      if (candidate.frames.length !== Math.ceil(duration * fps) && candidate.frames.length !== definition.comparisonFrames) issues.push(`HDR 대표 프레임 수 ${candidate.frames.length}가 계약과 다릅니다.`)
      if (audio.correlation < 0.96) issues.push(`PCM 상관 ${audio.correlation.toFixed(4)} < 0.96`)
      if (audio.rootMeanSquareError > 0.04) issues.push(`PCM RMSE ${audio.rootMeanSquareError.toFixed(5)} > 0.04`)
      if (Math.abs(audio.lagSamples) > 48) issues.push(`오디오 지연 ${audio.lagSamples}샘플 > ±48샘플`)
      return { passed: issues.length === 0, comparisonMode: 'hdr-artifact', comparedFrames: candidate.frames.length, artifactProfile, audio, issues }
    }
    if (definition.audioChannels === 6) {
      const channelPcm = candidate.channelPcm
      const audioProfile = channelPcm ? { channels: channelPcm.length, channelRms: channelPcm.map(rootMeanSquare) } : undefined
      const centerPcm = channelPcm?.[2]
      const audio = centerPcm ? comparePcm(reference.pcm, centerPcm, sampleRate, 512) : undefined
      const issues = surround51Issues(audioProfile, audio)
      const videoResult = evaluateDecodedMediaConformance({ referenceFrames: reference.frames, candidateFrames: candidate.frames, referencePcm: reference.pcm, candidatePcm: centerPcm ?? candidate.pcm, sampleRate, lagSearchSamples: 512, thresholds: desktopRenderThresholds(definition) })
      issues.push(...videoResult.issues.filter((issue) => !issue.startsWith('PCM ') && !issue.startsWith('오디오 ')))
      return { passed: issues.length === 0, comparisonMode: 'surround-5.1', comparedFrames: videoResult.video.frameCount, result: { ...videoResult, passed: issues.length === 0, issues, audio: audio ?? videoResult.audio }, audio, audioProfile, issues }
    }
    const result = evaluateDecodedMediaConformance({
      referenceFrames: reference.frames,
      candidateFrames: candidate.frames,
      referencePcm: reference.pcm,
      candidatePcm: candidate.pcm,
      sampleRate,
      lagSearchSamples: 512,
      thresholds: desktopRenderThresholds(definition),
    })
    if (definition.scenario === 'long-duration') {
      const tailSamples = Math.min(reference.pcm.length, candidate.pcm.length, sampleRate * 2)
      const tailAudio = comparePcm(reference.pcm.subarray(reference.pcm.length - tailSamples), candidate.pcm.subarray(candidate.pcm.length - tailSamples), sampleRate, 512)
      const issues = [...result.issues]
      if (elapsedMilliseconds > (definition.maximumRenderMilliseconds ?? 120_000)) issues.push(`${duration}초 렌더 시간 ${Math.round(elapsedMilliseconds)}ms가 한도보다 깁니다.`)
      if (outputBytes < 1024) issues.push(`${duration}초 출력 파일이 너무 작습니다: ${outputBytes} bytes`)
      if (heapDeltaBytes !== undefined && heapDeltaBytes > (definition.maximumHeapDeltaBytes ?? 256 * 1024 * 1024)) issues.push(`${duration}초 렌더 힙 증가 ${heapDeltaBytes} bytes가 한도를 넘습니다.`)
      if (tailAudio.correlation < 0.96) issues.push(`마지막 2초 PCM 상관 ${tailAudio.correlation.toFixed(4)} < 0.96`)
      if (tailAudio.rootMeanSquareError > 0.04) issues.push(`마지막 2초 PCM RMSE ${tailAudio.rootMeanSquareError.toFixed(5)} > 0.04`)
      if (Math.abs(tailAudio.lagSamples) > 48) issues.push(`마지막 2초 오디오 지연 ${tailAudio.lagSamples}샘플 > ±48샘플`)
      return { passed: issues.length === 0, comparisonMode: 'rgb24', comparedFrames: result.video.frameCount, result: { ...result, passed: issues.length === 0, issues }, tailAudio, elapsedMilliseconds, outputBytes, heapDeltaBytes, issues }
    }
    return { passed: result.passed, comparisonMode: 'rgb24', comparedFrames: result.video.frameCount, result, elapsedMilliseconds, outputBytes, heapDeltaBytes, issues: result.issues }
  } finally {
    URL.revokeObjectURL(asset.url)
  }
}

function usedJsHeapSize(): number | undefined {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory
  return Number.isFinite(memory?.usedJSHeapSize) ? memory!.usedJSHeapSize : undefined
}

export function desktopRenderThresholds(definition: DesktopRenderCaseDefinition) {
  // H.264 4:2:0 색차 서브샘플링은 자막/오버레이 경계와 초소형 세로 프레임에
  // 일반 영상보다 큰 RGB 픽셀 오차를 만든다. 프로필별 기준선은 실제 RGB24로
  // 비교하되 오디오는 모든 프로필에 동일한 엄격한 계약을 적용한다.
  const video = definition.scenario === 'high-resolution' || definition.scenario === 'ultra-high-resolution'
    ? { minimumStructuralSimilarity: 0.99, minimumPsnrDb: 35, maximumMeanAbsoluteError: 3 }
    : definition.decorated
    ? { minimumStructuralSimilarity: 0.96, minimumPsnrDb: 22.8, maximumMeanAbsoluteError: 6.5 }
    : definition.width < definition.height
      ? { minimumStructuralSimilarity: 0.969, minimumPsnrDb: 21.8, maximumMeanAbsoluteError: 6.1 }
      : definition.fps >= 50
        ? { minimumStructuralSimilarity: 0.99, minimumPsnrDb: 27.8, maximumMeanAbsoluteError: 3 }
        : { minimumStructuralSimilarity: 0.94, minimumPsnrDb: 28, maximumMeanAbsoluteError: 9 }
  return { ...video, minimumPcmCorrelation: 0.96, maximumPcmRmse: 0.04, maximumAudioLagSamples: 48 }
}

async function decodeMedia(file: File, duration: number, fps: number, sampleRate: number, width: number, height: number, draw?: (context: CanvasRenderingContext2D, frame: VideoFrame, timelineTime: number) => void, sourceTimeAt?: (timelineTime: number) => number, comparisonFrameLimit?: number, audioEdgeSeconds?: number): Promise<{ frames: RgbFrame[]; pcm: Float32Array; channelPcm?: Float32Array[]; videoProfile?: DecodedVideoProfile }> {
  const { ALL_FORMATS, AudioSampleSink, Input, VideoSampleSink } = await import('mediabunny')
  const input = new Input({ source: await createMediaSource(file), formats: ALL_FORMATS })
  try {
    const [videoTrack, audioTrack] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()])
    if (!videoTrack || !audioTrack) throw new Error('E2E 미디어에 영상과 오디오 트랙이 모두 필요합니다.')
    if (!await videoTrack.canDecode() || !await audioTrack.canDecode()) throw new Error('E2E 미디어를 WebCodecs로 디코딩할 수 없습니다.')
    const videoSink = new VideoSampleSink(videoTrack)
    const totalFrames = Math.ceil(duration * fps)
    const requestedFrames = Math.max(1, Math.min(totalFrames, comparisonFrameLimit ?? totalFrames))
    const frameIndices = requestedFrames === totalFrames ? Array.from({ length: totalFrames }, (_, index) => index) : Array.from({ length: requestedFrames }, (_, index) => Math.round(index * (totalFrames - 1) / Math.max(1, requestedFrames - 1)))
    const timelineTimestamps = frameIndices.map((index) => index / fps)
    const sourceTimestamps = timelineTimestamps.map((timelineTime) => sourceTimeAt?.(timelineTime) ?? timelineTime)
    const frames: RgbFrame[] = []
    let videoProfile: DecodedVideoProfile | undefined
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('E2E RGB 캡처 캔버스를 만들 수 없습니다.')
    let index = 0
    for await (const sample of videoSink.samplesAtTimestamps(sourceTimestamps)) {
      if (!sample) continue
      try {
        if (!videoProfile) videoProfile = { format: String(sample.format), primaries: String(sample.colorSpace.primaries), transfer: String(sample.colorSpace.transfer), matrix: String(sample.colorSpace.matrix), fullRange: sample.colorSpace.fullRange }
        const frame = sample.toVideoFrame()
        try {
          context.clearRect(0, 0, width, height)
          if (draw) draw(context, frame, timelineTimestamps[index] ?? sample.timestamp)
          else context.drawImage(frame, 0, 0, width, height)
          frames.push({ width, height, data: rgbaToRgb(context.getImageData(0, 0, width, height).data) })
        } finally {
          frame.close()
        }
      } finally {
        sample.close()
        index++
      }
    }
    const totalAudioSamples = Math.round(duration * sampleRate)
    const edgeSamples = audioEdgeSeconds ? Math.min(Math.floor(totalAudioSamples / 2), Math.round(audioEdgeSeconds * sampleRate)) : 0
    const pcm = new Float32Array(edgeSamples ? edgeSamples * 2 : totalAudioSamples)
    let channelPcm: Float32Array[] | undefined
    const audioSink = new AudioSampleSink(audioTrack)
    for await (const sample of audioSink.samples(0, duration)) {
      try {
        const buffer = sample.toAudioBuffer()
        channelPcm ??= Array.from({ length: buffer.numberOfChannels }, () => new Float32Array(pcm.length))
        const offset = Math.max(0, Math.round(sample.timestamp * sampleRate))
        for (let frameIndex = 0; frameIndex < buffer.length; frameIndex++) {
          const absoluteSample = offset + frameIndex
          if (absoluteSample >= totalAudioSamples) break
          const targetSample = edgeSamples
            ? absoluteSample < edgeSamples
              ? absoluteSample
              : absoluteSample >= totalAudioSamples - edgeSamples
                ? edgeSamples + absoluteSample - (totalAudioSamples - edgeSamples)
                : -1
            : absoluteSample
          if (targetSample < 0) continue
          let value = 0
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const channelValue = buffer.getChannelData(channel)[frameIndex]
            value += channelValue
            channelPcm[channel][targetSample] = channelValue
          }
          pcm[targetSample] = value / Math.max(1, buffer.numberOfChannels)
        }
      } finally {
        sample.close()
      }
    }
    if (frames.length !== timelineTimestamps.length) throw new Error(`E2E 영상 프레임 수가 ${frames.length}/${timelineTimestamps.length}입니다.`)
    return { frames, pcm, channelPcm, videoProfile }
  } finally {
    input.dispose()
  }
}

function surround51Issues(audioProfile: DecodedAudioProfile | undefined, audio: PcmComparison | undefined): string[] {
  const issues: string[] = []
  if (!audioProfile || audioProfile.channels !== 6) issues.push(`5.1 출력 채널 수 ${audioProfile?.channels ?? 0} != 6`)
  if (!audio) issues.push('5.1 센터 채널 PCM을 읽지 못했습니다.')
  if ((audioProfile?.channelRms[2] ?? 0) < 0.01) issues.push('5.1 대사 센터 채널에 유효 신호가 없습니다.')
  for (const channel of [0, 1, 3, 4, 5]) if ((audioProfile?.channelRms[channel] ?? 0) > 0.001) issues.push(`5.1 채널 ${channel}에 예상치 않은 신호가 있습니다: RMS ${(audioProfile?.channelRms[channel] ?? 0).toFixed(6)}`)
  if (audio && audio.correlation < 0.96) issues.push(`센터 PCM 상관 ${audio.correlation.toFixed(4)} < 0.96`)
  if (audio && audio.rootMeanSquareError > 0.04) issues.push(`센터 PCM RMSE ${audio.rootMeanSquareError.toFixed(5)} > 0.04`)
  if (audio && Math.abs(audio.lagSamples) > 48) issues.push(`센터 오디오 지연 ${audio.lagSamples}샘플 > ±48샘플`)
  return issues
}

async function decodeAudioChannels(file: File, duration: number, sampleRate: number): Promise<Float32Array[]> {
  const { ALL_FORMATS, AudioSampleSink, Input } = await import('mediabunny')
  const input = new Input({ source: await createMediaSource(file), formats: ALL_FORMATS })
  try {
    const audioTrack = await input.getPrimaryAudioTrack()
    if (!audioTrack || !await audioTrack.canDecode()) throw new Error('5.1 E2E 오디오를 디코딩할 수 없습니다.')
    const sink = new AudioSampleSink(audioTrack)
    const length = Math.round(duration * sampleRate)
    let channels: Float32Array[] | undefined
    for await (const sample of sink.samples(0, duration)) {
      try {
        const buffer = sample.toAudioBuffer()
        channels ??= Array.from({ length: buffer.numberOfChannels }, () => new Float32Array(length))
        const offset = Math.max(0, Math.round(sample.timestamp * sampleRate))
        const count = Math.min(buffer.length, length - offset)
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) channels[channel].set(buffer.getChannelData(channel).subarray(0, count), offset)
      } finally {
        sample.close()
      }
    }
    if (!channels?.length) throw new Error('5.1 E2E PCM 샘플이 없습니다.')
    return channels
  } finally {
    input.dispose()
  }
}

function rootMeanSquare(values: Float32Array): number {
  let squared = 0
  for (const value of values) squared += value * value
  return Math.sqrt(squared / Math.max(1, values.length))
}

function rgbaToRgb(rgba: Uint8ClampedArray): Uint8Array {
  const rgb = new Uint8Array(rgba.length / 4 * 3)
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 3) {
    rgb[target] = rgba[source]
    rgb[target + 1] = rgba[source + 1]
    rgb[target + 2] = rgba[source + 2]
  }
  return rgb
}
