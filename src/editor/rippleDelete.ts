import type { AdrCue, EditSuggestion, TimelineMarker, TimelineTrack, TranscriptSegment } from './types'

const epsilon = 1 / 240

interface TimedRange {
  start: number
  end: number
}

export interface RippleDeleteRange {
  start: number
  end: number
  duration: number
}

export function normalizeRippleDeleteRange(start: number, end: number): RippleDeleteRange {
  const rangeStart = Math.max(0, Math.min(start, end))
  const rangeEnd = Math.max(rangeStart, Math.max(start, end))
  return { start: rangeStart, end: rangeEnd, duration: rangeEnd - rangeStart }
}

function deleteFromTimedRange<T extends TimedRange>(item: T, range: RippleDeleteRange): T | undefined {
  if (item.end <= range.start) return item
  if (item.start >= range.end) return { ...item, start: item.start - range.duration, end: item.end - range.duration }
  if (item.start < range.start && item.end > range.end) return { ...item, end: item.end - range.duration }
  if (item.start < range.start && item.end > range.start) return { ...item, end: range.start }
  if (item.start < range.end && item.end > range.end) return { ...item, start: range.start, end: item.end - range.duration }
  return undefined
}

export function rippleDeleteMarkers(markers: TimelineMarker[], start: number, end: number, updatedAt = new Date().toISOString()): TimelineMarker[] {
  const range = normalizeRippleDeleteRange(start, end)
  if (range.duration <= 0) return markers
  return markers.flatMap((marker) => {
    if ((marker.duration ?? 0) > 0) {
      const shifted = deleteFromTimedRange({ start: marker.time, end: marker.time + marker.duration! }, range)
      if (!shifted || shifted.end - shifted.start <= epsilon) return []
      return [{ ...marker, time: shifted.start, duration: shifted.end - shifted.start, updatedAt: marker.kind === 'comment' ? updatedAt : marker.updatedAt }]
    }
    if (marker.time >= range.start && marker.time < range.end) return []
    if (marker.time < range.end) return [marker]
    return [{ ...marker, time: marker.time - range.duration, updatedAt: marker.kind === 'comment' ? updatedAt : marker.updatedAt }]
  })
}

export function rippleDeleteTranscript(segments: TranscriptSegment[], start: number, end: number): TranscriptSegment[] {
  const range = normalizeRippleDeleteRange(start, end)
  if (range.duration <= 0) return segments
  return segments.flatMap((segment) => {
    const shifted = deleteFromTimedRange(segment, range)
    if (!shifted) return []
    if (!segment.words?.length) return [shifted]
    const words = segment.words.flatMap((word) => {
      const next = deleteFromTimedRange(word, range)
      return next && next.end - next.start > epsilon ? [next] : []
    })
    if (!words.length) return []
    const removedWords = words.length !== segment.words.length
    return [{ ...shifted, words, text: removedWords ? joinTranscriptWords(words.map((word) => word.text)) : shifted.text }]
  }).filter((segment) => segment.end - segment.start > epsilon)
    .sort((left, right) => left.start - right.start || left.end - right.end)
}

function joinTranscriptWords(words: string[]): string {
  return words.join(' ').replace(/\s+([,.!?;:…])/g, '$1').trim()
}

export function rippleDeleteSuggestions(suggestions: EditSuggestion[], start: number, end: number, appliedSuggestionId?: string): EditSuggestion[] {
  const range = normalizeRippleDeleteRange(start, end)
  if (range.duration <= 0) return suggestions
  return suggestions.map((suggestion) => {
    if (suggestion.id === appliedSuggestionId) return { ...suggestion, start: range.start, end: range.start, status: 'applied' as const }
    const shifted = deleteFromTimedRange(suggestion, range)
    if (!shifted) return { ...suggestion, start: range.start, end: range.start, status: 'dismissed' as const }
    const overlapped = suggestion.start < range.end && suggestion.end > range.start
    return overlapped ? { ...shifted, status: 'dismissed' as const } : shifted
  }).sort((left, right) => left.start - right.start || left.end - right.end)
}

export function inspectAdrRippleDelete(tracks: TimelineTrack[], cues: AdrCue[], sequenceId: string, start: number, end: number): string[] {
  const range = normalizeRippleDeleteRange(start, end)
  if (range.duration <= 0) return []
  const blockers = new Set<string>()
  const tracksById = new Map(tracks.map((track) => [track.id, track]))
  const activeCues = cues.filter((cue) => cue.sequenceId === sequenceId)
  const activeCueIds = new Set(activeCues.map((cue) => cue.id))

  for (const cue of activeCues) {
    const label = cue.text.trim() || '이름 없는 ADR 큐'
    if (cue.start < range.end && cue.end > range.start) {
      blockers.add(`삭제 범위가 “${label}” ADR 큐와 겹칩니다. ADR 세션에서 큐를 정리하거나 범위를 큐 밖으로 조정해주세요.`)
      continue
    }
    for (const take of cue.takes) {
      const track = tracksById.get(take.trackId)
      const clip = track?.clips.find((candidate) => candidate.id === take.clipId)
      if (!track) {
        blockers.add(`“${label}” ADR 테이크 트랙을 찾을 수 없어 리플 삭제를 중단했습니다.`)
        continue
      }
      if (!clip || clip.adrCueId !== cue.id || clip.adrTakeId !== take.id) {
        blockers.add(`“${label}” ADR 테이크 클립 참조가 손상되어 리플 삭제를 중단했습니다.`)
        continue
      }
      const cueMoves = cue.start >= range.end
      const clipMoves = clip.start >= range.end
      if (cueMoves !== clipMoves) blockers.add(`“${label}” ADR 큐와 테이크 클립의 시간이 일치하지 않아 리플 삭제를 중단했습니다.`)
      else if (cueMoves && track.locked) blockers.add(`“${label}” ADR 테이크 트랙 잠금을 해제한 뒤 리플 삭제해주세요.`)
    }
  }

  for (const track of tracks) {
    for (const clip of track.clips) {
      if (!clip.adrCueId) continue
      if (!activeCueIds.has(clip.adrCueId)) {
        blockers.add(`“${track.name}”의 ADR 테이크 클립이 활성 시퀀스 큐를 찾지 못해 리플 삭제를 중단했습니다.`)
        continue
      }
      const clipEnd = clip.start + clip.duration
      if (clip.start < range.end && clipEnd > range.start) {
        blockers.add('삭제 범위가 ADR 테이크 클립과 겹칩니다. ADR 세션에서 큐를 정리하거나 범위를 조정해주세요.')
      } else if (clip.start >= range.end && track.locked) {
        blockers.add(`이후 ADR 테이크가 있는 “${track.name}” 트랙 잠금을 해제한 뒤 리플 삭제해주세요.`)
      }
    }
  }

  return [...blockers]
}

export function rippleDeleteAdrCues(cues: AdrCue[], sequenceId: string, start: number, end: number, updatedAt = new Date().toISOString()): AdrCue[] {
  const range = normalizeRippleDeleteRange(start, end)
  if (range.duration <= 0) return cues
  return cues.map((cue) => {
    if (cue.sequenceId !== sequenceId || cue.start < range.end) return cue
    return {
      ...cue,
      start: cue.start - range.duration,
      end: cue.end - range.duration,
      compSegments: cue.compSegments?.map((segment) => ({ ...segment, start: segment.start - range.duration, end: segment.end - range.duration })),
      updatedAt,
    }
  })
}
