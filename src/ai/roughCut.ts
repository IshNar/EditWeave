import type { CreatorLearningProfile, EditSuggestion, EditSuggestionType, MediaAsset, TimelineClip, TranscriptSegment } from '../editor/types'
import { clipSourceTime } from '../editor/effects'

const fillerPattern = /(^|\s)(으?음+|어+|아+|그니까|그러니까|뭐랄까|저기|있잖아)(?=\s|[,.!?…]|$)/iu
const fillerTokens = /^(으?음+|어+|아+|그니까|그러니까|뭐랄까|저기|있잖아)$/u

export function createRoughCutSuggestions(
  transcript: TranscriptSegment[],
  audioClips: TimelineClip[],
  assets: MediaAsset[],
  profile = defaultCreatorLearningProfile(),
): EditSuggestion[] {
  const suggestions: EditSuggestion[] = []

  for (const segment of transcript) {
    for (const range of fillerRanges(segment)) {
      suggestions.push({
        id: crypto.randomUUID(),
        type: 'filler',
        start: range.start,
        end: range.end,
        label: `군더더기: “${range.text}”`,
        reason: range.precise ? '단어 타임코드에서 독립적인 한국어 머뭇거림 표현을 찾았습니다.' : '단어 타임코드가 없어 문장 범위를 검토 대상으로 표시했습니다.',
        score: range.precise ? 0.92 : 0.8,
        status: 'pending',
      })
    }
  }

  transcript.forEach((segment, index) => {
    const text = segment.text.trim()
    let score = 0.5
    const reasons: string[] = []
    if (/[?？]$/.test(text) || /왜|어떻게|비결|방법|what|why|how/i.test(text)) { score += 0.16; reasons.push('질문·호기심 구조') }
    if (/\d|첫째|둘째|셋째|가지|단계|%/.test(text)) { score += 0.1; reasons.push('구체적 수치·목록') }
    if (/핵심|중요|결론|놀라|반전|절대|사실|비밀|추천|주의|must|secret|best/i.test(text)) { score += 0.13; reasons.push('강한 핵심어') }
    if (/[!！]|“|”|"/.test(text)) { score += 0.07; reasons.push('강조 표현') }
    if (text.length >= 12 && text.length <= 90) score += 0.06
    if (index < 3) score += 0.04
    if (score >= 0.7) suggestions.push({
      id: crypto.randomUUID(),
      type: 'highlight',
      start: segment.start,
      end: segment.end,
      label: `하이라이트: “${text.slice(0, 24)}${text.length > 24 ? '…' : ''}”`,
      reason: `${reasons.join(' · ') || '짧고 독립적인 문장'}를 포함해 챕터·쇼츠 후보로 검토할 만합니다.`,
      score: Math.min(0.96, score),
      status: 'pending',
    })
  })

  for (let index = 1; index < transcript.length; index++) {
    const previous = normalizeText(transcript[index - 1].text)
    const current = normalizeText(transcript[index].text)
    const repetitionScore = similarity(previous, current, transcript[index - 1].text, transcript[index].text)
    if (previous.length >= 6 && current.length >= 6 && repetitionScore >= 0.72) {
      suggestions.push({
        id: crypto.randomUUID(),
        type: 'repetition',
        start: transcript[index].start,
        end: transcript[index].end,
        label: '반복 문장 후보',
        reason: `바로 앞 문장과 문자·핵심어 구성이 유사합니다 (${Math.round(repetitionScore * 100)}%).`,
        score: Math.min(0.94, 0.7 + repetitionScore * 0.12),
        status: 'pending',
      })
    }
  }

  for (const clip of audioClips) {
    if (!clip.assetId) continue
    const asset = assets.find((item) => item.id === clip.assetId)
    if (!asset?.waveform?.length || asset.duration <= 0) continue
    const secondsPerBucket = asset.duration / asset.waveform.length
    let runStart: number | undefined
    for (let index = 0; index <= asset.waveform.length; index++) {
      const quiet = index < asset.waveform.length && asset.waveform[index] < 0.025
      if (quiet && runStart === undefined) runStart = index
      if ((!quiet || index === asset.waveform.length) && runStart !== undefined) {
        const sourceStart = runStart * secondsPerBucket
        const sourceEnd = index * secondsPerBucket
        const clipSourceA = clipSourceTime(clip, clip.start)
        const clipSourceB = clipSourceTime(clip, clip.start + clip.duration)
        const clipMinimum = Math.min(clipSourceA, clipSourceB)
        const clipMaximum = Math.max(clipSourceA, clipSourceB)
        const overlapSourceStart = Math.max(sourceStart, clipMinimum)
        const overlapSourceEnd = Math.min(sourceEnd, clipMaximum)
        if (overlapSourceEnd <= overlapSourceStart) {
          runStart = undefined
          continue
        }
        const timelineA = timelineTimeForSource(clip, overlapSourceStart)
        const timelineB = timelineTimeForSource(clip, overlapSourceEnd)
        const start = Math.min(timelineA, timelineB)
        const end = Math.max(timelineA, timelineB)
        if (end - start >= 0.55 && end > clip.start && start < clip.start + clip.duration) {
          suggestions.push({
            id: crypto.randomUUID(),
            type: 'silence',
            start: Math.max(clip.start, start),
            end: Math.min(clip.start + clip.duration, end),
            label: `${(end - start).toFixed(1)}초 무음`,
            reason: '음성 파형이 기준값 아래로 유지됩니다.',
            score: 0.9,
            status: 'pending',
          })
        }
        runStart = undefined
      }
    }
  }

  return suggestions.map((suggestion) => personalizeSuggestion(suggestion, profile)).filter((suggestion) => suggestion.score >= personalizedThreshold(suggestion.type, profile)).sort((a, b) => a.start - b.start)
}

export function defaultCreatorLearningProfile(): CreatorLearningProfile {
  const empty = () => ({ applied: 0, dismissed: 0, appliedDuration: 0, dismissedDuration: 0 })
  return { version: 'creator-feedback-v1', suggestionStats: { silence: empty(), filler: empty(), repetition: empty(), highlight: empty() } }
}

export function resetCreatorFeedback(profile: CreatorLearningProfile): CreatorLearningProfile {
  const normalized = normalizeCreatorLearningProfile(profile)
  return {
    ...defaultCreatorLearningProfile(),
    audienceRetention: normalized.audienceRetention,
    updatedAt: new Date().toISOString(),
  }
}

export function recordSuggestionFeedback(profile: CreatorLearningProfile, suggestion: EditSuggestion, outcome: 'applied' | 'dismissed'): CreatorLearningProfile {
  const normalized = normalizeCreatorLearningProfile(profile)
  const stat = normalized.suggestionStats[suggestion.type]
  const duration = Math.max(0, suggestion.end - suggestion.start)
  const semanticFeedback = suggestion.type === 'highlight' && suggestion.semanticVector?.length && suggestion.semanticVector.length <= 1024 && suggestion.semanticVector.every(Number.isFinite)
    ? updateSemanticFeedback(normalized, suggestion.semanticVector, outcome)
    : normalized.semanticFeedback
  return {
    ...normalized,
    suggestionStats: {
      ...normalized.suggestionStats,
      [suggestion.type]: {
        ...stat,
        [outcome]: stat[outcome] + 1,
        ...(outcome === 'applied' ? { appliedDuration: stat.appliedDuration + duration } : { dismissedDuration: stat.dismissedDuration + duration }),
      },
    },
    semanticFeedback,
    updatedAt: new Date().toISOString(),
  }
}

export function normalizeCreatorLearningProfile(profile?: CreatorLearningProfile): CreatorLearningProfile {
  const fallback = defaultCreatorLearningProfile()
  if (!profile || profile.version !== 'creator-feedback-v1') return fallback
  return {
    ...fallback,
    ...profile,
    suggestionStats: Object.fromEntries((Object.keys(fallback.suggestionStats) as EditSuggestionType[]).map((type) => [type, { ...fallback.suggestionStats[type], ...profile.suggestionStats?.[type] }])) as CreatorLearningProfile['suggestionStats'],
    audienceRetention: normalizeAudienceRetention(profile.audienceRetention),
    semanticFeedback: normalizeSemanticFeedback(profile.semanticFeedback),
  }
}

function normalizeAudienceRetention(value: CreatorLearningProfile['audienceRetention']): CreatorLearningProfile['audienceRetention'] {
  if (!value || !Number.isFinite(value.duration) || value.duration <= 0 || !Array.isArray(value.samples)) return undefined
  const samples = value.samples.filter((sample) => Number.isFinite(sample?.time) && Number.isFinite(sample?.retention) && sample.time >= 0 && sample.time <= value.duration + 1 && sample.retention >= 0 && sample.retention <= 3)
    .sort((left, right) => left.time - right.time)
  if (samples.length < 3) return undefined
  return { sourceName: String(value.sourceName || 'retention.csv'), importedAt: String(value.importedAt || new Date().toISOString()), duration: value.duration, samples }
}

function updateSemanticFeedback(profile: CreatorLearningProfile, vector: number[], outcome: 'applied' | 'dismissed'): NonNullable<CreatorLearningProfile['semanticFeedback']> {
  const current = normalizeSemanticFeedback(profile.semanticFeedback)
  const positive = outcome === 'applied'
  const centroid = positive ? current?.positiveCentroid : current?.negativeCentroid
  const count = positive ? current?.positiveCount ?? 0 : current?.negativeCount ?? 0
  const nextCentroid = normalizeVector(centroid?.length === vector.length
    ? vector.map((value, index) => (centroid[index] * count + value) / (count + 1))
    : vector.slice())
  return {
    model: 'Xenova/multilingual-e5-small',
    dimensions: vector.length,
    positiveCentroid: positive ? nextCentroid : current?.positiveCentroid,
    positiveCount: positive ? count + 1 : current?.positiveCount ?? 0,
    negativeCentroid: positive ? current?.negativeCentroid : nextCentroid,
    negativeCount: positive ? current?.negativeCount ?? 0 : count + 1,
  }
}

function normalizeSemanticFeedback(value: CreatorLearningProfile['semanticFeedback']): CreatorLearningProfile['semanticFeedback'] {
  if (!value || value.model !== 'Xenova/multilingual-e5-small' || !Number.isInteger(value.dimensions) || value.dimensions <= 0) return undefined
  const valid = (vector?: number[]) => vector?.length === value.dimensions && vector.every(Number.isFinite) ? normalizeVector(vector) : undefined
  const positiveCentroid = valid(value.positiveCentroid)
  const negativeCentroid = valid(value.negativeCentroid)
  return {
    model: value.model,
    dimensions: value.dimensions,
    positiveCentroid,
    positiveCount: positiveCentroid ? Math.max(0, Math.floor(value.positiveCount || 0)) : 0,
    negativeCentroid,
    negativeCount: negativeCentroid ? Math.max(0, Math.floor(value.negativeCount || 0)) : 0,
  }
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
  return vector.map((value) => value / magnitude)
}

function personalizeSuggestion(suggestion: EditSuggestion, profile: CreatorLearningProfile): EditSuggestion {
  const stat = normalizeCreatorLearningProfile(profile).suggestionStats[suggestion.type]
  const feedbackCount = stat.applied + stat.dismissed
  if (!feedbackCount) return suggestion
  const acceptance = (stat.applied + 2) / (feedbackCount + 4)
  const score = Math.max(0, Math.min(1, suggestion.score * (0.72 + acceptance * 0.56)))
  const averageApplied = stat.applied ? stat.appliedDuration / stat.applied : undefined
  const durationNote = averageApplied ? ` · 평균 적용 ${averageApplied.toFixed(1)}초` : ''
  return { ...suggestion, score, reason: `${suggestion.reason} 채널 피드백 ${feedbackCount}건 반영${durationNote}.` }
}

function personalizedThreshold(type: EditSuggestionType, profile: CreatorLearningProfile): number {
  const stat = normalizeCreatorLearningProfile(profile).suggestionStats[type]
  const count = stat.applied + stat.dismissed
  if (count < 3) return 0.68
  const acceptance = (stat.applied + 2) / (count + 4)
  return Math.max(0.58, Math.min(0.86, 0.78 - (acceptance - 0.5) * 0.32))
}

function timelineTimeForSource(clip: TimelineClip, sourceTime: number): number {
  let low = clip.start
  let high = clip.start + clip.duration
  for (let iteration = 0; iteration < 24; iteration++) {
    const middle = (low + high) / 2
    const current = clipSourceTime(clip, middle)
    if ((!clip.reverse && current < sourceTime) || (clip.reverse && current > sourceTime)) low = middle
    else high = middle
  }
  return (low + high) / 2
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

function similarity(a: string, b: string, rawA: string, rawB: string): number {
  const first = new Set(bigrams(a))
  const second = new Set(bigrams(b))
  if (!first.size || !second.size) return tokenSimilarity(rawA, rawB)
  let overlap = 0
  first.forEach((item) => { if (second.has(item)) overlap++ })
  return Math.max((2 * overlap) / (first.size + second.size), tokenSimilarity(rawA, rawB))
}

function bigrams(value: string): string[] {
  return Array.from({ length: Math.max(0, value.length - 1) }, (_, index) => value.slice(index, index + 2))
}

function fillerRanges(segment: TranscriptSegment): Array<{ start: number; end: number; text: string; precise: boolean }> {
  if (!segment.words?.length) {
    const match = segment.text.match(fillerPattern)
    return match ? [{ start: segment.start, end: segment.end, text: match[2], precise: false }] : []
  }
  const fillers = segment.words.flatMap((word, index) => {
    const token = word.text.normalize('NFKC').replace(/^[\s,.!?…~]+|[\s,.!?…~]+$/gu, '')
    if (!fillerTokens.test(token)) return []
    // “아” can be a meaningful exclamation inside a sentence. Restrict the
    // shortest ambiguous tokens to an utterance onset or a surrounding pause.
    const previous = segment.words?.[index - 1]
    const next = segment.words?.[index + 1]
    const isolated = index === 0 || (previous && word.start - previous.end >= 0.18) || (next && next.start - word.end >= 0.18)
    return token.length === 1 && !isolated ? [] : [{ start: word.start, end: word.end, text: token, precise: true }]
  })
  const merged: typeof fillers = []
  for (const filler of fillers) {
    const previous = merged[merged.length - 1]
    if (previous && filler.start - previous.end <= 0.18) {
      previous.end = Math.max(previous.end, filler.end)
      previous.text = `${previous.text} ${filler.text}`
    } else merged.push({ ...filler })
  }
  return merged
}

function tokenSimilarity(left: string, right: string): number {
  const tokens = (value: string) => value.toLowerCase().normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/u)
    .map((token) => token.replace(/(입니다|합니다|해요|이에요|예요|은|는|이|가|을|를|에|도|만|와|과)$/u, ''))
    .filter((token) => token.length >= 2 && !fillerTokens.test(token))
  const first = new Set(tokens(left))
  const second = new Set(tokens(right))
  if (!first.size || !second.size) return 0
  let overlap = 0
  first.forEach((token) => { if (second.has(token)) overlap++ })
  return (2 * overlap) / (first.size + second.size)
}
