import type { EditSuggestion, EditSuggestionType, MediaAsset, TimelineClip, TranscriptSegment } from '../editor/types'
import { createRoughCutSuggestions } from './roughCut'

export interface KoreanBenchmarkExpectedSuggestion {
  type: EditSuggestionType
  start: number
  end: number
}

export interface KoreanRoughCutBenchmarkCase {
  id: string
  transcript: TranscriptSegment[]
  expected: KoreanBenchmarkExpectedSuggestion[]
  audio?: { duration: number; waveform: number[]; clipStart?: number; sourceOffset?: number; clipDuration?: number }
}

export interface KoreanRoughCutBenchmark {
  version: 'editweave-korean-rough-cut-v1'
  provenance: 'synthetic' | 'licensed-real'
  cases: KoreanRoughCutBenchmarkCase[]
}

export interface SuggestionMetric {
  expected: number
  predicted: number
  matched: number
  precision: number
  recall: number
  f1: number
  meanTemporalIou: number
}

export interface KoreanBenchmarkResult {
  cases: number
  metrics: Record<EditSuggestionType, SuggestionMetric>
  cleanupMacroF1: number
  cleanupPrecision: number
  cleanupRecall: number
}

const cleanupTypes: EditSuggestionType[] = ['filler', 'repetition', 'silence']

export function parseKoreanRoughCutBenchmark(value: unknown): KoreanRoughCutBenchmark {
  if (!value || typeof value !== 'object') throw new Error('한국어 기준셋이 객체가 아닙니다.')
  const candidate = value as Partial<KoreanRoughCutBenchmark>
  if (candidate.version !== 'editweave-korean-rough-cut-v1' || !['synthetic', 'licensed-real'].includes(candidate.provenance ?? '') || !Array.isArray(candidate.cases)) throw new Error('지원되는 한국어 기준셋 형식이 아닙니다.')
  for (const item of candidate.cases) {
    if (!item?.id || !Array.isArray(item.transcript) || !Array.isArray(item.expected)) throw new Error('한국어 기준셋 사례가 손상됐습니다.')
    if (item.transcript.some((segment) => !segment.id || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.end <= segment.start || typeof segment.text !== 'string')) throw new Error(`한국어 기준셋 “${item.id}”의 대본이 손상됐습니다.`)
    if (item.expected.some((expected) => !['silence', 'filler', 'repetition', 'highlight'].includes(expected.type) || !Number.isFinite(expected.start) || !Number.isFinite(expected.end) || expected.end <= expected.start)) throw new Error(`한국어 기준셋 “${item.id}”의 정답 범위가 손상됐습니다.`)
  }
  return candidate as KoreanRoughCutBenchmark
}

export function evaluateKoreanRoughCutBenchmark(benchmark: KoreanRoughCutBenchmark): KoreanBenchmarkResult {
  const expected = benchmark.cases.flatMap((item) => item.expected.map((suggestion) => ({ ...suggestion, caseId: item.id })))
  const predicted = benchmark.cases.flatMap((item) => predictCase(item).map((suggestion) => ({ ...suggestion, caseId: item.id })))
  const metrics = Object.fromEntries((['silence', 'filler', 'repetition', 'highlight'] satisfies EditSuggestionType[]).map((type) => [type, scoreType(type, expected, predicted)])) as Record<EditSuggestionType, SuggestionMetric>
  const cleanup = cleanupTypes.map((type) => metrics[type])
  const totalExpected = cleanup.reduce((sum, metric) => sum + metric.expected, 0)
  const totalPredicted = cleanup.reduce((sum, metric) => sum + metric.predicted, 0)
  const totalMatched = cleanup.reduce((sum, metric) => sum + metric.matched, 0)
  return {
    cases: benchmark.cases.length,
    metrics,
    cleanupMacroF1: average(cleanup.map((metric) => metric.f1)),
    cleanupPrecision: ratio(totalMatched, totalPredicted),
    cleanupRecall: ratio(totalMatched, totalExpected),
  }
}

export function koreanCharacterErrorRate(reference: string, hypothesis: string): number {
  return errorRate(normalizeKoreanCharacters(reference), normalizeKoreanCharacters(hypothesis))
}

export function koreanWordErrorRate(reference: string, hypothesis: string): number {
  return errorRate(normalizeKoreanWords(reference), normalizeKoreanWords(hypothesis))
}

function predictCase(item: KoreanRoughCutBenchmarkCase): EditSuggestion[] {
  if (!item.audio) return createRoughCutSuggestions(item.transcript, [], [])
  const asset: MediaAsset = { id: `${item.id}-asset`, name: `${item.id}.wav`, kind: 'audio', url: 'benchmark:', duration: item.audio.duration, size: 1, extension: 'wav', status: 'ready', waveform: item.audio.waveform }
  const clipDuration = item.audio.clipDuration ?? item.audio.duration
  const clip: TimelineClip = { id: `${item.id}-clip`, trackId: 'a1', assetId: asset.id, name: item.id, start: item.audio.clipStart ?? 0, duration: clipDuration, sourceOffset: item.audio.sourceOffset ?? 0, kind: 'audio', color: '#000', transform: { positionX: 0, positionY: 0, scale: 100, rotation: 0, opacity: 100 } }
  return createRoughCutSuggestions(item.transcript, [clip], [asset])
}

function scoreType(type: EditSuggestionType, expectedAll: Array<KoreanBenchmarkExpectedSuggestion & { caseId: string }>, predictedAll: Array<EditSuggestion & { caseId: string }>): SuggestionMetric {
  const expected = expectedAll.filter((item) => item.type === type)
  const predicted = predictedAll.filter((item) => item.type === type)
  const used = new Set<number>()
  const overlaps: number[] = []
  for (const target of expected) {
    let bestIndex = -1
    let bestOverlap = 0
    predicted.forEach((candidate, index) => {
      if (used.has(index) || candidate.caseId !== target.caseId) return
      const overlap = temporalIou(target, candidate)
      if (overlap > bestOverlap) { bestIndex = index; bestOverlap = overlap }
    })
    if (bestIndex >= 0 && bestOverlap >= 0.3) { used.add(bestIndex); overlaps.push(bestOverlap) }
  }
  const matched = overlaps.length
  const precision = ratio(matched, predicted.length)
  const recall = ratio(matched, expected.length)
  return { expected: expected.length, predicted: predicted.length, matched, precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : expected.length || predicted.length ? 0 : 1, meanTemporalIou: average(overlaps) }
}

function temporalIou(left: { start: number; end: number }, right: { start: number; end: number }): number {
  const intersection = Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start))
  const union = Math.max(left.end, right.end) - Math.min(left.start, right.start)
  return union > 0 ? intersection / union : 0
}

function normalizeKoreanCharacters(value: string): string[] {
  return [...value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')]
}

function normalizeKoreanWords(value: string): string[] {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/u).filter(Boolean)
}

function errorRate<T>(reference: T[], hypothesis: T[]): number {
  if (!reference.length) return hypothesis.length ? 1 : 0
  const previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index)
  for (let row = 1; row <= reference.length; row++) {
    const current = [row]
    for (let column = 1; column <= hypothesis.length; column++) current[column] = reference[row - 1] === hypothesis[column - 1] ? previous[column - 1] : Math.min(previous[column - 1], previous[column], current[column - 1]) + 1
    previous.splice(0, previous.length, ...current)
  }
  return previous[hypothesis.length] / reference.length
}

function ratio(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : numerator ? 0 : 1
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 1
}
