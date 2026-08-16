import type { AspectRatio, EditSuggestion, MediaAsset, ProjectSequence, ShortsCandidate, TimelineClip, TimelineMarker, TimelineTrack, TranscriptSegment } from '../editor/types'
import { clipSourceTime, sliceClipAutomation, sliceClipSpeed } from '../editor/effects'

const SHORTS_DURATIONS = [15, 30, 60] as const

export function generateShortsCandidates(
  transcript: TranscriptSegment[],
  tracks: TimelineTrack[],
  context: { assets?: MediaAsset[]; suggestions?: EditSuggestion[]; markers?: TimelineMarker[] } = {},
): ShortsCandidate[] {
  const contentEnd = Math.max(
    0,
    ...tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)),
    ...transcript.map((segment) => segment.end),
  )
  if (contentEnd <= 0) return []

  const suggestions = context.suggestions ?? []
  const sceneBoundaries = [...new Set([
    0,
    ...tracks.flatMap((track) => track.clips.flatMap((clip) => [clip.start, clip.start + clip.duration])),
    ...(context.markers ?? []).filter((marker) => marker.kind === 'edit' || marker.kind === 'chapter').map((marker) => marker.time),
  ].filter((time) => time >= 0 && time <= contentEnd))].sort((left, right) => left - right)
  const anchors = transcript.length ? transcript : sceneBoundaries.map((time, index) => ({ id: `scene-${index}`, start: time, end: Math.min(contentEnd, time + 2), text: index ? `장면 ${index + 1}` : '첫 장면' }))
  return SHORTS_DURATIONS.map((targetDuration) => {
    const actualDuration = Math.min(targetDuration, contentEnd)
    const maximumStart = Math.max(0, contentEnd - actualDuration)
    const starts = [...new Set([
      0,
      maximumStart,
      ...anchors.flatMap((anchor) => [anchor.start - Math.min(1.2, actualDuration * 0.08), anchor.start, anchor.end - actualDuration * 0.2]),
      ...sceneBoundaries,
    ].map((time) => Number(clamp(time, 0, maximumStart).toFixed(3))))]
    const ranked = starts.map((start) => evaluateWindow(start, start + actualDuration, transcript, tracks, context.assets ?? [], suggestions, sceneBoundaries))
      .sort((left, right) => right.score - left.score || left.start - right.start)
    const best = ranked[0]
    const start = best?.start ?? 0
    const end = Math.min(contentEnd, start + actualDuration)
    const inRange = transcript.filter((segment) => segment.end > start && segment.start < end)
    const hook = best?.hook.trim() || inRange[0]?.text.trim() || '첫 장면'
    return {
      id: crypto.randomUUID(),
      targetDuration,
      start,
      end,
      title: makeTitle(hook, targetDuration),
      hook,
      score: best?.score ?? 0.5,
      reason: best?.reason,
      signals: best?.signals,
    }
  })
}

function evaluateWindow(start: number, end: number, transcript: TranscriptSegment[], tracks: TimelineTrack[], assets: MediaAsset[], suggestions: EditSuggestion[], sceneBoundaries: number[]): { start: number; score: number; hook: string; reason: string; signals: NonNullable<ShortsCandidate['signals']> } {
  const inRange = transcript.filter((segment) => segment.end > start && segment.start < end)
  const openingEnd = start + (end - start) * 0.38
  const opening = inRange.filter((segment) => segment.start < openingEnd)
  const hookSegment = (opening.length ? opening : inRange).reduce<TranscriptSegment | undefined>((winner, segment) => !winner || scoreSegment(segment.text) > scoreSegment(winner.text) ? segment : winner, undefined)
  const transcriptSignal = hookSegment ? clamp(scoreSegment(hookSegment.text) / 8, 0, 1) : 0.15
  const overlaps = suggestions.filter((suggestion) => suggestion.end > start && suggestion.start < end)
  const highlightSignal = overlaps.filter((suggestion) => suggestion.type === 'highlight').reduce((best, suggestion) => Math.max(best, suggestion.score), 0)
  const cleanupDuration = overlaps.filter((suggestion) => suggestion.type !== 'highlight').reduce((sum, suggestion) => sum + Math.max(0, Math.min(end, suggestion.end) - Math.max(start, suggestion.start)) * suggestion.score, 0)
  const cleanupPenalty = clamp(cleanupDuration / Math.max(1, (end - start) * 0.22), 0, 1)
  const audio = audioEnergyInRange(start, end, tracks, assets)
  const face = faceCoverageInRange(start, end, tracks, assets)
  const nearestBoundary = sceneBoundaries.reduce((distance, boundary) => Math.min(distance, Math.abs(boundary - start)), Number.POSITIVE_INFINITY)
  const scene = clamp(1 - nearestBoundary / 2.5, 0, 1)
  const earlyHighlight = overlaps.some((suggestion) => suggestion.type === 'highlight' && suggestion.start < openingEnd) ? 0.06 : 0
  const score = clamp(0.18 + transcriptSignal * 0.27 + highlightSignal * 0.2 + audio * 0.14 + face * 0.13 + scene * 0.08 + earlyHighlight - cleanupPenalty * 0.24, 0.05, 0.99)
  const rankedSignals = [
    { label: '대본 훅', value: transcriptSignal }, { label: 'AI 하이라이트', value: highlightSignal }, { label: '음성 에너지', value: audio }, { label: '얼굴 안정성', value: face }, { label: '장면 시작', value: scene },
  ].filter((item) => item.value >= 0.45).sort((left, right) => right.value - left.value).slice(0, 3).map((item) => item.label)
  return {
    start,
    score,
    hook: hookSegment?.text ?? inRange[0]?.text ?? '첫 장면',
    reason: `${rankedSignals.join(' · ') || '구간 구성'} 반영${cleanupPenalty > 0.1 ? ` · 삭제 후보 겹침 ${Math.round(cleanupPenalty * 100)}% 감점` : ''}`,
    signals: { transcript: transcriptSignal, highlight: highlightSignal, audio, face, scene, cleanupPenalty },
  }
}

function audioEnergyInRange(start: number, end: number, tracks: TimelineTrack[], assets: MediaAsset[]): number {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const samples: number[] = []
  for (const clip of tracks.filter((track) => !track.muted && (track.kind === 'audio' || track.kind === 'video')).flatMap((track) => track.clips)) {
    if (clip.enabled === false || clip.audioDisabled || clip.start >= end || clip.start + clip.duration <= start) continue
    const asset = clip.assetId ? assetById.get(clip.assetId) : undefined
    if (!asset?.waveform?.length || asset.duration <= 0) continue
    const overlapStart = Math.max(start, clip.start)
    const overlapEnd = Math.min(end, clip.start + clip.duration)
    const count = Math.max(3, Math.min(24, Math.ceil(overlapEnd - overlapStart)))
    for (let index = 0; index < count; index++) {
      const timelineTime = overlapStart + (overlapEnd - overlapStart) * (index + 0.5) / count
      const sourceTime = clipSourceTime(clip, timelineTime)
      const bucket = Math.max(0, Math.min(asset.waveform.length - 1, Math.floor(sourceTime / asset.duration * asset.waveform.length)))
      samples.push(asset.waveform[bucket] ?? 0)
    }
  }
  if (!samples.length) return 0.35
  const active = samples.filter((value) => value >= 0.025)
  const average = active.length ? active.reduce((sum, value) => sum + value, 0) / active.length : 0
  const coverage = active.length / samples.length
  return clamp(average / 0.22 * 0.65 + coverage * 0.35, 0, 1)
}

function faceCoverageInRange(start: number, end: number, tracks: TimelineTrack[], assets: MediaAsset[]): number {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  let visible = 0
  let confident = 0
  for (const clip of tracks.filter((track) => track.kind === 'video' && !track.muted && track.visible !== false).flatMap((track) => track.clips)) {
    if (clip.start >= end || clip.start + clip.duration <= start) continue
    const asset = clip.assetId ? assetById.get(clip.assetId) : undefined
    if (!asset?.faceTrack?.length) continue
    const sourceA = clipSourceTime(clip, Math.max(start, clip.start))
    const sourceB = clipSourceTime(clip, Math.min(end, clip.start + clip.duration))
    const points = asset.faceTrack.filter((point) => point.time >= Math.min(sourceA, sourceB) && point.time <= Math.max(sourceA, sourceB))
    visible += Math.max(1, Math.ceil(Math.min(end, clip.start + clip.duration) - Math.max(start, clip.start)))
    confident += points.filter((point) => point.confidence >= 0.45).reduce((sum, point) => sum + point.confidence, 0)
  }
  if (!visible) return 0.25
  return clamp(confident / visible, 0, 1)
}

export function createDerivedShortsSequence(options: {
  sourceSequenceId: string
  candidate: ShortsCandidate
  tracks: TimelineTrack[]
  transcript: TranscriptSegment[]
  suggestions: EditSuggestion[]
  markers?: TimelineMarker[]
  assets: MediaAsset[]
  aspectRatio?: Exclude<AspectRatio, '16:9'>
  sourceFingerprint?: string
  sourceGraphSnapshot?: ProjectSequence['sourceGraphSnapshot']
  sourceFps?: number
  sourceTimecodeStart?: number
  sourceTimecodeDropFrame?: boolean
}): ProjectSequence {
  const { candidate } = options
  const aspectRatio = options.aspectRatio ?? '9:16'
  const dimensions = aspectRatio === '1:1' ? { width: 1080, height: 1080 } : aspectRatio === '4:5' ? { width: 1080, height: 1350 } : { width: 1080, height: 1920 }
  const tracks = options.tracks.map((track) => ({
    ...track,
    clips: track.clips.flatMap((clip) => trimClip(clip, candidate.start, candidate.end, options.assets, dimensions.width, dimensions.height)),
  }))
  const transcript = options.transcript
    .filter((segment) => segment.end > candidate.start && segment.start < candidate.end)
    .map((segment) => ({
      ...segment,
      id: crypto.randomUUID(),
      start: Math.max(0, segment.start - candidate.start),
      end: Math.min(candidate.end, segment.end) - candidate.start,
      words: segment.words?.filter((word) => word.end > candidate.start && word.start < candidate.end).map((word) => ({ ...word, start: Math.max(0, word.start - candidate.start), end: Math.min(candidate.end, word.end) - candidate.start })),
    }))
  const suggestions = options.suggestions
    .filter((suggestion) => suggestion.end > candidate.start && suggestion.start < candidate.end)
    .map((suggestion) => ({
      ...suggestion,
      id: crypto.randomUUID(),
      start: Math.max(0, suggestion.start - candidate.start),
      end: Math.min(candidate.end, suggestion.end) - candidate.start,
    }))
  const markers = options.markers
    ?.filter((marker) => marker.time < candidate.end && marker.time + (marker.duration ?? 0) >= candidate.start)
    .map((marker) => ({
      ...marker,
      id: crypto.randomUUID(),
      time: Math.max(0, marker.time - candidate.start),
      duration: marker.duration === undefined ? undefined : Math.min(candidate.end, marker.time + marker.duration) - Math.max(candidate.start, marker.time),
    }))

  return {
    id: crypto.randomUUID(),
    name: `${aspectRatio} · ${candidate.targetDuration}초 · ${candidate.title}`,
    kind: 'shorts',
    sourceSequenceId: options.sourceSequenceId,
    sourceRange: { start: candidate.start, end: candidate.end },
    sourceFingerprint: options.sourceFingerprint,
    sourceGraphSnapshot: options.sourceGraphSnapshot,
    aspectRatio,
    width: dimensions.width,
    height: dimensions.height,
    fps: options.sourceFps ?? 30,
    timecodeStart: (options.sourceTimecodeStart ?? 0) + candidate.start,
    timecodeDropFrame: options.sourceTimecodeDropFrame,
    tracks,
    transcript,
    suggestions,
    markers,
    createdAt: new Date().toISOString(),
  }
}

function trimClip(clip: TimelineClip, rangeStart: number, rangeEnd: number, assets: MediaAsset[], targetWidth: number, targetHeight: number): TimelineClip[] {
  const clipEnd = clip.start + clip.duration
  const overlapStart = Math.max(clip.start, rangeStart)
  const overlapEnd = Math.min(clipEnd, rangeEnd)
  if (overlapEnd <= overlapStart) return []

  const asset = assets.find((item) => item.id === clip.assetId)
  const sourceA = clipSourceTime(clip, overlapStart)
  const sourceB = clipSourceTime(clip, overlapEnd)
  const transform = clip.kind === 'video' && asset?.width && asset.height
    ? { ...clip.transform, positionX: facePositionX(asset, Math.min(sourceA, sourceB), Math.max(sourceA, sourceB), targetWidth), positionY: 0, scale: Math.max(clip.transform.scale, calculateCoverScale(asset.width, asset.height, targetWidth, targetHeight)) }
    : { ...clip.transform }

  return [{
    ...clip,
    id: crypto.randomUUID(),
    sourceClipId: clip.sourceClipId ?? clip.id,
    sourceTrackId: clip.sourceTrackId ?? clip.trackId,
    start: overlapStart - rangeStart,
    duration: overlapEnd - overlapStart,
    ...sliceClipSpeed(clip, overlapStart - clip.start, overlapEnd - clip.start),
    ...sliceClipAutomation(clip, overlapStart - clip.start, overlapEnd - clip.start),
    adrCompRanges: clip.adrCompRanges?.flatMap((range) => {
      const start = Math.max(range.start, overlapStart)
      const end = Math.min(range.end, overlapEnd)
      return end > start ? [{ start: start - rangeStart, end: end - rangeStart }] : []
    }),
    transform,
    keyframes: clip.kind === 'video' ? createFaceKeyframes(asset, clip, overlapStart, overlapEnd, transform, targetWidth, targetHeight) : clip.keyframes,
  }]
}

function facePositionX(asset: MediaAsset | undefined, start: number, end: number, targetWidth: number): number {
  const points = asset?.faceTrack?.filter((point) => point.time >= start && point.time <= end && point.confidence >= 0.45) ?? []
  if (!points.length) return 0
  const weight = points.reduce((sum, point) => sum + point.confidence, 0) || points.length
  const x = points.reduce((sum, point) => sum + point.x * point.confidence, 0) / weight
  return Math.round((0.5 - x) * targetWidth)
}

function createFaceKeyframes(asset: MediaAsset | undefined, clip: TimelineClip, overlapStart: number, overlapEnd: number, transform: TimelineClip['transform'], targetWidth: number, targetHeight: number): TimelineClip['keyframes'] {
  const sourceStart = clipSourceTime(clip, overlapStart)
  const sourceEnd = clipSourceTime(clip, overlapEnd)
  const minimum = Math.min(sourceStart, sourceEnd)
  const maximum = Math.max(sourceStart, sourceEnd)
  const points = asset?.faceTrack?.filter((point) => point.time >= minimum && point.time <= maximum && point.confidence >= 0.45) ?? []
  if (!points.length) return clip.keyframes
  let smoothX = points[0].x
  let smoothY = points[0].y
  return points.map((point) => {
    const alpha = 0.2 + point.confidence * 0.25
    smoothX += (point.x - smoothX) * alpha
    smoothY += (point.y - smoothY) * alpha
    return { id: crypto.randomUUID(), time: Math.max(0, timelineTimeForSource(clip, point.time, overlapStart, overlapEnd) - overlapStart), easing: 'ease-in-out' as const, transform: { ...transform, positionX: Math.round((0.5 - smoothX) * targetWidth), positionY: Math.round((0.5 - smoothY) * targetHeight) } }
  }).sort((a, b) => a.time - b.time)
}

function timelineTimeForSource(clip: TimelineClip, sourceTime: number, start: number, end: number): number {
  let low = start
  let high = end
  const ascending = !clip.reverse
  for (let iteration = 0; iteration < 24; iteration++) {
    const middle = (low + high) / 2
    const current = clipSourceTime(clip, middle)
    if ((ascending && current < sourceTime) || (!ascending && current > sourceTime)) low = middle
    else high = middle
  }
  return (low + high) / 2
}

function calculateCoverScale(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): number {
  const contain = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const cover = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
  return Math.round(cover / contain * 100)
}

function scoreSegment(text: string): number {
  let score = Math.min(6, text.replace(/\s/g, '').length / 9)
  if (/[!?？]/.test(text)) score += 2
  if (/(핵심|비밀|결과|방법|이유|바로|먼저|중요)/.test(text)) score += 1.5
  if (/^(음|어|그냥|약간)/.test(text.trim())) score -= 2
  return score
}

function makeTitle(hook: string, duration: number): string {
  const cleaned = hook.replace(/^(음|어|그럼)[,\s]*/u, '').replace(/[.!?。！？]+$/u, '').trim()
  const short = cleaned.length > 24 ? `${cleaned.slice(0, 24)}…` : cleaned
  return short || `${duration}초 하이라이트`
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}
