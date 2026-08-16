import type { CreatorLearningProfile, EditSuggestion, TranscriptSegment } from '../editor/types'
import { retentionAt } from './retention'

type SemanticProgress = (progress: number, stage: string) => void
type FeatureOutput = { data: ArrayLike<number>; dims?: number[] }
type FeatureExtractor = (input: string | string[], options: { pooling: 'mean'; normalize: true }) => Promise<FeatureOutput>

const modelName = 'Xenova/multilingual-e5-small' as const
const anchorQueries = [
  'query: 영상의 핵심 결론과 가장 중요한 정보',
  'query: 시청자가 궁금해할 놀라운 사실이나 반전',
  'query: 짧게 공유할 수 있는 구체적인 팁과 실행 방법',
]
let extractorPromise: Promise<FeatureExtractor> | undefined

export async function enrichSemanticHighlights(
  transcript: TranscriptSegment[],
  suggestions: EditSuggestion[],
  profile: CreatorLearningProfile,
  onProgress?: SemanticProgress,
): Promise<EditSuggestion[]> {
  const usable = transcript.filter((segment) => segment.text.trim().length >= 3 && segment.end > segment.start)
  if (!usable.length) return suggestions
  const extractor = await getExtractor(onProgress)
  onProgress?.(0.43, '대본 의미 벡터 생성')
  const embeddings = new Map<string, number[]>()
  const batchSize = 16
  for (let offset = 0; offset < usable.length; offset += batchSize) {
    const batch = usable.slice(offset, offset + batchSize)
    const vectors = await extractBatch(extractor, batch.map((segment) => `passage: ${segment.text.trim()}`))
    batch.forEach((segment, index) => embeddings.set(segment.id, vectors[index]))
    onProgress?.(0.45 + Math.min(1, (offset + batch.length) / usable.length) * 0.42, `대본 의미 분석 ${Math.min(offset + batch.length, usable.length)}/${usable.length}`)
  }
  const anchors = await extractBatch(extractor, anchorQueries)
  const retention = profile.audienceRetention
  const retentionValues = usable.map((segment) => retention ? retentionAt(retention.samples, (segment.start + segment.end) / 2) : undefined)
  const knownRetention = retentionValues.filter((value): value is number => value !== undefined).sort((a, b) => a - b)
  const retentionMedian = percentile(knownRetention, 0.5)
  const retentionHigh = percentile(knownRetention, 0.7)
  const retentionCentroid = retention && knownRetention.length >= 3
    ? weightedCentroid(usable.map((segment, index) => ({ vector: embeddings.get(segment.id), weight: Math.max(0, (retentionValues[index] ?? 0) - retentionMedian) })).filter((item) => item.vector && item.weight > 0) as Array<{ vector: number[]; weight: number }>)
    : undefined
  const existingHighlights = new Map(suggestions.filter((suggestion) => suggestion.type === 'highlight').map((suggestion) => [rangeKey(suggestion.start, suggestion.end), suggestion]))
  const enriched = suggestions.filter((suggestion) => suggestion.type !== 'highlight')
  for (let index = 0; index < usable.length; index++) {
    const segment = usable[index]
    const vector = embeddings.get(segment.id)
    if (!vector?.length) continue
    const existing = existingHighlights.get(rangeKey(segment.start, segment.end))
    const anchorSignal = normalizeSimilarity(Math.max(...anchors.map((anchor) => cosine(vector, anchor))), 0.7, 0.9)
    const currentRetention = retentionValues[index]
    const retentionSignal = currentRetention === undefined ? 0.5 : normalizeRetention(currentRetention, retentionMedian, retentionHigh)
    const retentionMeaningSignal = retentionCentroid ? normalizeSimilarity(cosine(vector, retentionCentroid), 0.72, 0.93) : 0.5
    const positiveSignal = profile.semanticFeedback?.positiveCentroid ? normalizeSimilarity(cosine(vector, profile.semanticFeedback.positiveCentroid), 0.7, 0.92) : 0.5
    const negativeSignal = profile.semanticFeedback?.negativeCentroid ? normalizeSimilarity(cosine(vector, profile.semanticFeedback.negativeCentroid), 0.7, 0.92) : 0
    const heuristic = existing?.score ?? 0.56
    const score = clamp(heuristic * 0.34 + anchorSignal * 0.23 + retentionSignal * 0.22 + retentionMeaningSignal * 0.11 + positiveSignal * 0.14 - negativeSignal * 0.08)
    if (!existing && score < 0.68) continue
    const reasons = ['대본 의미 유사도']
    if (currentRetention !== undefined) reasons.push(`해당 구간 유지율 ${Math.round(currentRetention * 100)}%`)
    if (retentionCentroid) reasons.push('유지율 상위 구간의 의미 패턴')
    if (profile.semanticFeedback?.positiveCount) reasons.push(`적용한 하이라이트 ${profile.semanticFeedback.positiveCount}건의 의미 학습`)
    enriched.push({
      ...(existing ?? {
        id: crypto.randomUUID(),
        type: 'highlight' as const,
        start: segment.start,
        end: segment.end,
        label: `하이라이트: “${segment.text.trim().slice(0, 24)}${segment.text.trim().length > 24 ? '…' : ''}”`,
        status: 'pending' as const,
      }),
      score,
      reason: `${existing?.reason ? `${existing.reason} ` : ''}${reasons.join(' · ')}를 반영했습니다.`,
      semanticVector: vector,
    })
  }
  onProgress?.(1, '채널 맞춤 하이라이트 완료')
  return enriched.sort((left, right) => left.start - right.start)
}

async function getExtractor(onProgress?: SemanticProgress): Promise<FeatureExtractor> {
  if (!extractorPromise) extractorPromise = (async () => {
    onProgress?.(0.02, '다국어 의미 모델 준비')
    const { pipeline } = await import('@huggingface/transformers')
    return await pipeline('feature-extraction', modelName, {
      device: 'gpu' in navigator ? 'webgpu' : 'wasm',
      dtype: 'q8',
      progress_callback: (event) => {
        if ('progress' in event && typeof event.progress === 'number') onProgress?.(0.03 + event.progress / 100 * 0.38, '다국어 의미 모델 다운로드·캐시')
      },
    }) as unknown as FeatureExtractor
  })()
  return extractorPromise
}

async function extractBatch(extractor: FeatureExtractor, texts: string[]): Promise<number[][]> {
  if (!texts.length) return []
  const output = await extractor(texts, { pooling: 'mean', normalize: true })
  const values = Array.from(output.data, Number)
  const dimensions = output.dims?.[output.dims.length - 1] ?? values.length / texts.length
  if (!Number.isInteger(dimensions) || dimensions <= 0 || values.length < dimensions * texts.length) throw new Error('의미 임베딩 결과의 차원을 확인할 수 없습니다.')
  return texts.map((_, index) => values.slice(index * dimensions, (index + 1) * dimensions))
}

function weightedCentroid(items: Array<{ vector: number[]; weight: number }>): number[] | undefined {
  if (!items.length) return undefined
  const result = new Array(items[0].vector.length).fill(0)
  let total = 0
  items.forEach(({ vector, weight }) => {
    if (vector.length !== result.length || weight <= 0) return
    total += weight
    vector.forEach((value, index) => { result[index] += value * weight })
  })
  if (!total) return undefined
  return normalizeVector(result.map((value) => value / total))
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
  return vector.map((value) => value / magnitude)
}

function cosine(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0
  let value = 0
  for (let index = 0; index < left.length; index++) value += left[index] * right[index]
  return value
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0.5
  const position = (values.length - 1) * fraction
  const low = Math.floor(position)
  const mix = position - low
  return values[low] + ((values[Math.min(values.length - 1, low + 1)] ?? values[low]) - values[low]) * mix
}

function normalizeSimilarity(value: number, low: number, high: number): number {
  return clamp((value - low) / Math.max(0.0001, high - low))
}

function normalizeRetention(value: number, median: number, high: number): number {
  return clamp(0.5 + (value - median) / Math.max(0.08, high - median) * 0.28)
}

function rangeKey(start: number, end: number): string {
  return `${start.toFixed(3)}:${end.toFixed(3)}`
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}
