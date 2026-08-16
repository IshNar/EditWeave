import type { EditSuggestion, MediaAsset, ShortsCandidate, TimelineMarker, TimelineTrack, TranscriptSegment } from '../editor/types'
import { generateShortsCandidates } from './generate'

export interface MultimodalShortsBenchmarkCase {
  id: string
  duration: number
  transcript: TranscriptSegment[]
  suggestions: EditSuggestion[]
  markers: TimelineMarker[]
  waveform: number[]
  faceTrack: NonNullable<MediaAsset['faceTrack']>
  expectedHookRange: { start: number; end: number }
  excludedHookRange?: { start: number; end: number }
}

export interface MultimodalShortsBenchmark {
  version: 'cutline-shorts-multimodal-v1'
  provenance: 'synthetic' | 'licensed-real'
  cases: MultimodalShortsBenchmarkCase[]
}

export interface MultimodalShortsBenchmarkResult {
  cases: number
  candidates: number
  hookHitRate: number
  excludedHookAvoidance: number
  multimodalEvidenceRate: number
  meanScore: number
}

export function parseMultimodalShortsBenchmark(value: unknown): MultimodalShortsBenchmark {
  if (!value || typeof value !== 'object') throw new Error('쇼츠 기준셋이 객체가 아닙니다.')
  const candidate = value as Partial<MultimodalShortsBenchmark>
  if (candidate.version !== 'cutline-shorts-multimodal-v1' || !['synthetic', 'licensed-real'].includes(candidate.provenance ?? '') || !Array.isArray(candidate.cases)) throw new Error('지원되는 멀티모달 쇼츠 기준셋 형식이 아닙니다.')
  for (const item of candidate.cases) {
    if (!item?.id || !Number.isFinite(item.duration) || item.duration <= 0 || !Array.isArray(item.transcript) || !Array.isArray(item.suggestions) || !Array.isArray(item.markers) || !Array.isArray(item.waveform) || !Array.isArray(item.faceTrack)) throw new Error('멀티모달 쇼츠 기준셋 사례가 손상됐습니다.')
    if (!validRange(item.expectedHookRange) || item.excludedHookRange && !validRange(item.excludedHookRange)) throw new Error(`멀티모달 쇼츠 기준셋 “${item.id}”의 정답 범위가 손상됐습니다.`)
  }
  return candidate as MultimodalShortsBenchmark
}

export function evaluateMultimodalShortsBenchmark(benchmark: MultimodalShortsBenchmark): MultimodalShortsBenchmarkResult {
  const evaluated = benchmark.cases.flatMap((item) => {
    const asset: MediaAsset = { id: `${item.id}-asset`, name: `${item.id}.mp4`, kind: 'video', url: 'benchmark:', duration: item.duration, size: 1, extension: 'mp4', width: 1920, height: 1080, status: 'ready', waveform: item.waveform, faceTrack: item.faceTrack }
    const track: TimelineTrack = { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false, clips: [{ id: `${item.id}-clip`, trackId: 'v1', assetId: asset.id, name: item.id, start: 0, duration: item.duration, sourceOffset: 0, kind: 'video', color: '#000', transform: { positionX: 0, positionY: 0, scale: 100, rotation: 0, opacity: 100 } }] }
    return generateShortsCandidates(item.transcript, [track], { assets: [asset], suggestions: item.suggestions, markers: item.markers }).map((candidate) => ({ item, candidate, hookStart: hookStart(item.transcript, candidate) }))
  })
  const hookHits = evaluated.filter(({ item, hookStart }) => hookStart >= item.expectedHookRange.start && hookStart < item.expectedHookRange.end).length
  const exclusions = evaluated.filter(({ item }) => item.excludedHookRange)
  const avoided = exclusions.filter(({ item, hookStart }) => !item.excludedHookRange || hookStart < item.excludedHookRange.start || hookStart >= item.excludedHookRange.end).length
  const evidenced = evaluated.filter(({ candidate }) => multimodalEvidenceCount(candidate) >= 2).length
  return {
    cases: benchmark.cases.length,
    candidates: evaluated.length,
    hookHitRate: ratio(hookHits, evaluated.length),
    excludedHookAvoidance: ratio(avoided, exclusions.length),
    multimodalEvidenceRate: ratio(evidenced, evaluated.length),
    meanScore: evaluated.length ? evaluated.reduce((sum, { candidate }) => sum + candidate.score, 0) / evaluated.length : 0,
  }
}

function hookStart(transcript: TranscriptSegment[], candidate: ShortsCandidate): number {
  return transcript.find((segment) => segment.text.trim() === candidate.hook.trim())?.start ?? -1
}

function multimodalEvidenceCount(candidate: ShortsCandidate): number {
  const signals = candidate.signals
  if (!signals) return 0
  return [signals.highlight, signals.audio, signals.face, signals.scene].filter((value) => value >= 0.45).length
}

function validRange(value: unknown): value is { start: number; end: number } {
  return Boolean(value && typeof value === 'object' && Number.isFinite((value as { start?: number }).start) && Number.isFinite((value as { end?: number }).end) && (value as { end: number }).end > (value as { start: number }).start)
}

function ratio(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : numerator ? 0 : 1
}
