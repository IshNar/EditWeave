import { exists, remove, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import { defaultAudioAdjustment, defaultColorAdjustment, defaultTransform, defaultVisualEffects } from '../editor/effects'
import { audioRoles } from '../editor/audioBuses'
import type { MediaAsset, TimelineClip, TimelineTrack } from '../editor/types'
import { exportAudioMaster, exportAudioStem, exportSequence } from '../media/export'
import { mergeRenderedSegments, validateRenderedVideoSegment } from '../media/mergeSegments'
import { prepareRenderedVideoTargetAtPath } from '../platform/projectFiles'
import { muxContinuousSurroundAudio } from '../platform/renderTranscode'
import { decodeRenderHdrSource, encodeRenderHdrSegment } from '../platform/renderSegments'
import { applyHdrOutputMetadata, collectHdrOutputMetadata } from '../platform/hdrMetadata'
import { openHdrRawSource } from '../platform/hdrRawSource'

export interface DesktopStreamConformanceConfig {
  durationSeconds: number
  audioChannels?: 1 | 6
  colorMode?: 'sdr' | 'hdr10-pq' | 'hdr-hlg'
  hdrEffect?: boolean
  outputPath: string
  reportPath: string
  segmentDirectory: string
  audioFixturePath: string
  fixtureUrl: string
  hdrFixturePath?: string
}

export interface DesktopStreamConformanceReport {
  schema: 'editweave-desktop-stream-conformance-v1'
  status: 'running' | 'passed' | 'failed'
  startedAt: string
  completedAt?: string
  durationSeconds: number
  expectedFrames: number
  completedSegments: number
  resumedSegments?: number
  totalSegments: number
  progress: number
  stage: string
  outputPath: string
  outputBytes?: number
  elapsedMilliseconds?: number
  heapStartBytes?: number
  heapPeakBytes?: number
  heapEndBytes?: number
  heapDeltaBytes?: number
  error?: string
  errorStack?: string
  hdrInputSample?: { format: string | null; primaries: string | null; transfer: string | null; matrix: string | null; fullRange: boolean | null }
  hdrRawFallbackFrames?: number
}

const FPS = 30
const SEGMENT_SECONDS = 30
const SOURCE_SECONDS = 600

export async function runDesktopStreamConformance(config: DesktopStreamConformanceConfig, onReport?: (report: DesktopStreamConformanceReport) => void): Promise<DesktopStreamConformanceReport> {
  const startedAt = new Date().toISOString()
  const totalSegments = Math.ceil(config.durationSeconds / SEGMENT_SECONDS)
  const heapStartBytes = usedJsHeapSize()
  let heapPeakBytes = heapStartBytes
  let report: DesktopStreamConformanceReport = { schema: 'editweave-desktop-stream-conformance-v1', status: 'running', startedAt, durationSeconds: config.durationSeconds, expectedFrames: config.durationSeconds * FPS, completedSegments: 0, totalSegments, progress: 0, stage: '10분 기준 미디어 로드', outputPath: config.outputPath, heapStartBytes, heapPeakBytes }
  const publish = async (next: DesktopStreamConformanceReport) => {
    report = next
    onReport?.(next)
    await writeTextFile(config.reportPath, JSON.stringify(next, null, 2))
  }
  await publish(report)
  const renderStarted = performance.now()
  const segmentPaths: string[] = []
  const surround = config.audioChannels === 6
  const hdrColorMode = config.colorMode === 'hdr10-pq' || config.colorMode === 'hdr-hlg' ? config.colorMode : undefined
  const continuousAudioPath = joinPath(config.segmentDirectory, `continuous-audio-master.${surround ? 'wav' : 'm4a'}`)
  const objectUrls: string[] = []
  const decodedHdrPaths: string[] = []
  try {
    for (let index = 0; index < totalSegments; index++) segmentPaths.push(joinPath(config.segmentDirectory, `segment-${String(index).padStart(3, '0')}.mp4`))
    let resumedSegments = 0
    while (resumedSegments < totalSegments) {
      const path = segmentPaths[resumedSegments]
      if (!await exists(path) || (await stat(path)).size < 512 || !await validateRenderedVideoSegment({ path, duration: Math.min(SEGMENT_SECONDS, config.durationSeconds - resumedSegments * SEGMENT_SECONDS) }, FPS)) break
      resumedSegments++
    }
    if (resumedSegments > 0) await publish({ ...report, completedSegments: resumedSegments, resumedSegments, progress: resumedSegments / totalSegments * 0.94, stage: `검증된 체크포인트 ${resumedSegments}/${totalSegments}에서 재개` })
    const response = await fetch(config.fixtureUrl, { cache: 'no-store' })
    if (!response.ok) throw new Error(`10분 기준 미디어 HTTP ${response.status}`)
    const reference = new File([await response.arrayBuffer()], hdrColorMode ? `render-conformance-${hdrColorMode}.mp4` : 'render-conformance-10m.mp4', { type: 'video/mp4' })
    const sourceCount = Math.ceil(config.durationSeconds / SOURCE_SECONDS)
    const assets: MediaAsset[] = []
    const videoClips: TimelineClip[] = []
    const audioClips: TimelineClip[] = []
    for (let index = 0; index < sourceCount; index++) {
      const start = index * SOURCE_SECONDS
      const duration = Math.min(SOURCE_SECONDS, config.durationSeconds - start)
      const assetId = `desktop-stream-source-${index}`
      const audioAssetId = `desktop-stream-audio-source-${index}`
      const url = URL.createObjectURL(reference)
      const audioFile = new File([], 'render-conformance-10m.wav', { type: 'audio/wav' })
      const audioUrl = URL.createObjectURL(audioFile)
      objectUrls.push(url)
      objectUrls.push(audioUrl)
      assets.push({ id: assetId, name: hdrColorMode ? `${hdrColorMode === 'hdr10-pq' ? 'PQ' : 'HLG'} Main10 기준 ${index + 1}` : `10분 기준 ${index + 1}`, kind: 'video', url, sourceFile: reference, duration: hdrColorMode ? 60 : SOURCE_SECONDS, size: reference.size, extension: 'mp4', width: 160, height: 90, frameRate: FPS, sampleRate: 48_000, channels: 1, status: 'ready', ...(hdrColorMode ? { hdrFormat: hdrColorMode === 'hdr10-pq' ? 'pq' as const : 'hlg' as const, colorPrimaries: 'bt2020', colorTransfer: hdrColorMode === 'hdr10-pq' ? 'pq' : 'hlg', colorSpace: 'bt2020-ncl', colorRange: 'limited' } : {}), ...(hdrColorMode === 'hdr10-pq' ? { hdrMasteringDisplay: { redX: 0.708, redY: 0.292, greenX: 0.17, greenY: 0.797, blueX: 0.131, blueY: 0.046, whitePointX: 0.3127, whitePointY: 0.329, minLuminance: 0.005, maxLuminance: 1000 }, maxContentLightLevel: 1000, maxFrameAverageLightLevel: 400 } : {}) })
      assets.push({ id: audioAssetId, name: `10분 PCM 기준 ${index + 1}`, kind: 'audio', url: audioUrl, sourceFile: audioFile, sourcePath: config.audioFixturePath, streamingSource: true, duration: SOURCE_SECONDS, size: 0, extension: 'wav', audioCodec: 'pcm_s16le', audioDecodable: true, sampleRate: 48_000, channels: 1, status: 'ready' })
      const colorAdjustment = defaultColorAdjustment()
      if (hdrColorMode && config.hdrEffect) colorAdjustment.exposure = 0.5
      const base: TimelineClip = { id: `desktop-stream-video-${index}`, trackId: 'desktop-stream-video', assetId, name: `장시간 영상 ${index + 1}`, kind: 'video', color: '#7a9cff', start, duration, sourceOffset: 0, transform: defaultTransform, colorAdjustment, visualEffects: defaultVisualEffects(), audioAdjustment: defaultAudioAdjustment(), audioDisabled: true }
      videoClips.push(base)
      audioClips.push({ ...structuredClone(base), id: `desktop-stream-audio-${index}`, trackId: 'desktop-stream-audio', assetId: audioAssetId, kind: 'audio', name: `장시간 PCM 오디오 ${index + 1}`, audioDisabled: false })
    }
    const tracks: TimelineTrack[] = [
      { id: 'desktop-stream-video', name: 'V1 · 30분 적합성', kind: 'video', locked: false, muted: false, visible: true, volume: 100, pan: 0, clips: videoClips },
      { id: 'desktop-stream-audio', name: 'A1 · 30분 적합성', kind: 'audio', locked: false, muted: false, volume: 100, pan: 0, clips: audioClips },
    ]
    for (let index = resumedSegments; index < totalSegments; index++) {
      const rangeStart = index * SEGMENT_SECONDS
      const rangeEnd = Math.min(config.durationSeconds, rangeStart + SEGMENT_SECONDS)
      const segmentPath = segmentPaths[index]
      const rawPath = hdrColorMode ? joinPath(config.segmentDirectory, `segment-${String(index).padStart(3, '0')}.yuv`) : undefined
      const destination = await prepareRenderedVideoTargetAtPath(rawPath ?? segmentPath)
      report = { ...report, stage: `체크포인트 ${index + 1}/${totalSegments} 렌더 · ${rangeStart}-${rangeEnd}초` }
      onReport?.(report)
      let hdrReader: Awaited<ReturnType<typeof openHdrRawSource>> | undefined
      if (hdrColorMode && config.hdrFixturePath) {
        const frames = Math.ceil((rangeEnd - rangeStart) * FPS)
        const decodedPath = await decodeRenderHdrSource({ jobId: `conformance-${hdrColorMode}`, index, slot: 0, sourcePath: config.hdrFixturePath, scratchRootOverride: null, rangeStart, width: 160, height: 90, fps: FPS, frames })
        decodedHdrPaths.push(decodedPath)
        hdrReader = await openHdrRawSource(decodedPath, { width: 160, height: 90, fps: FPS, rangeStart, frames })
      }
      try {
        await exportSequence({ projectName: 'EditWeave Tauri Stream Conformance', preset: { ratio: '16:9', width: 160, height: 90, label: 'Tauri Stream 160×90' }, height: 90, fps: FPS, codec: hdrColorMode ? 'hevc' : 'avc', colorMode: hdrColorMode ?? 'sdr', bitrateMbps: 4, hardwareAcceleration: 'prefer-software', includeAudio: false, audioSampleRate: 48_000, audioBitrateKbps: 128, audioChannels: 1, assets, tracks, rangeStart, rangeEnd, ...(rawPath ? { hdrRawOutputStream: destination.writable } : { outputStream: destination.writable }), hdrRawFrameProvider: hdrReader ? async (_asset, sourceTime) => hdrReader!.frameAt(sourceTime) : undefined, onHdrRawFallbackFrame: () => { report = { ...report, hdrRawFallbackFrames: (report.hdrRawFallbackFrames ?? 0) + 1 } }, onHdrInputSample: (sample) => { if (!report.hdrInputSample) report = { ...report, hdrInputSample: sample } }, onProgress: (progress, stage) => { report = { ...report, progress: (index + progress) / totalSegments * 0.94, stage: `체크포인트 ${index + 1}/${totalSegments} · ${stage}` }; onReport?.(report) } })
      } finally {
        await hdrReader?.close().catch(() => undefined)
      }
      if (rawPath) await encodeRenderHdrSegment({ rawPath, outputPath: segmentPath, width: 160, height: 90, fps: FPS, frames: Math.ceil((rangeEnd - rangeStart) * FPS), bitrateMbps: 4, transfer: hdrColorMode === 'hdr10-pq' ? 'pq' : 'hlg' })
      const heap = usedJsHeapSize()
      if (heap !== undefined) heapPeakBytes = Math.max(heapPeakBytes ?? heap, heap)
      await publish({ ...report, completedSegments: index + 1, progress: (index + 1) / totalSegments * 0.94, stage: `체크포인트 ${index + 1}/${totalSegments} 완료`, heapPeakBytes })
    }
    await publish({ ...report, progress: 0.94, stage: '연속 오디오 마스터 합성', heapPeakBytes })
    const audioTarget = await prepareRenderedVideoTargetAtPath(continuousAudioPath)
    const audioProgress = (progress: number, stage: string) => { report = { ...report, progress: 0.94 + progress * 0.04, stage: `연속 오디오 · ${stage}` }; onReport?.(report) }
    if (surround) await exportAudioStem({ projectName: 'EditWeave Tauri Stream Conformance', stemName: 'Continuous-5.1-Mix', roles: audioRoles, assets, tracks, sampleRate: 48_000, channels: 6, rangeStart: 0, rangeEnd: config.durationSeconds, outputStream: audioTarget.writable, onProgress: audioProgress })
    else await exportAudioMaster({ projectName: 'EditWeave Tauri Stream Conformance', assets, tracks, sampleRate: 48_000, bitrateKbps: 128, channels: 1, rangeStart: 0, rangeEnd: config.durationSeconds, outputStream: audioTarget.writable, onProgress: audioProgress })
    const audioHeap = usedJsHeapSize()
    if (audioHeap !== undefined) heapPeakBytes = Math.max(heapPeakBytes ?? audioHeap, audioHeap)
    await publish({ ...report, progress: 0.98, stage: '체크포인트·연속 오디오 무손실 결합', heapPeakBytes })
    const finalTarget = await prepareRenderedVideoTargetAtPath(config.outputPath)
    await mergeRenderedSegments(segmentPaths.map((path, index) => ({ path, duration: Math.min(SEGMENT_SECONDS, config.durationSeconds - index * SEGMENT_SECONDS) })), finalTarget.writable, (progress) => { onReport?.({ ...report, progress: 0.98 + progress * 0.01, stage: `무손실 결합 ${Math.round(progress * 100)}%` }) }, surround ? undefined : continuousAudioPath)
    if (surround) {
      await publish({ ...report, progress: 0.995, stage: '번들 코덱 엔진 AAC 5.1 결합', heapPeakBytes })
      await muxContinuousSurroundAudio(config.outputPath, continuousAudioPath, 320, 48_000)
    }
    if (hdrColorMode === 'hdr10-pq') {
      await publish({ ...report, progress: 0.998, stage: 'HDR10 ST 2086·MaxCLL·MaxFALL 적용', heapPeakBytes })
      await applyHdrOutputMetadata(config.outputPath, collectHdrOutputMetadata(assets, tracks))
    }
    const outputStat = await stat(config.outputPath)
    const heapEndBytes = usedJsHeapSize()
    if (heapEndBytes !== undefined) heapPeakBytes = Math.max(heapPeakBytes ?? heapEndBytes, heapEndBytes)
    const completed: DesktopStreamConformanceReport = { ...report, status: 'passed', completedAt: new Date().toISOString(), completedSegments: totalSegments, progress: 1, stage: '완료', outputBytes: outputStat.size, elapsedMilliseconds: performance.now() - renderStarted, heapPeakBytes, heapEndBytes, heapDeltaBytes: heapStartBytes !== undefined && heapEndBytes !== undefined ? Math.max(0, heapEndBytes - heapStartBytes) : undefined }
    await publish(completed)
    return completed
  } catch (error) {
    const failed: DesktopStreamConformanceReport = { ...report, status: 'failed', completedAt: new Date().toISOString(), stage: `실패 · ${report.stage}`, elapsedMilliseconds: performance.now() - renderStarted, heapPeakBytes, heapEndBytes: usedJsHeapSize(), error: error instanceof Error ? error.message : String(error), errorStack: error instanceof Error ? error.stack : undefined }
    await publish(failed).catch(() => undefined)
    return failed
  } finally {
    objectUrls.forEach((url) => URL.revokeObjectURL(url))
    if (report.status === 'passed') await Promise.all([...segmentPaths, ...decodedHdrPaths, continuousAudioPath].map((path) => remove(path).catch(() => undefined)))
  }
}

function joinPath(directory: string, filename: string): string {
  const separator = directory.includes('\\') ? '\\' : '/'
  return `${directory}${directory.endsWith('/') || directory.endsWith('\\') ? '' : separator}${filename}`
}

function usedJsHeapSize(): number | undefined {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory
  return Number.isFinite(memory?.usedJSHeapSize) ? memory!.usedJSHeapSize : undefined
}
