import type { AdrCue, EditSuggestion, TimelineMarker, TimelineTrack, TranscriptSegment } from './types'

interface TimedRange {
  start: number
  end: number
}

function insertIntoRange<T extends TimedRange>(range: T, at: number, duration: number): T {
  if (range.start >= at) return { ...range, start: range.start + duration, end: range.end + duration }
  if (range.end > at) return { ...range, end: range.end + duration }
  return range
}

export function rippleInsertMarkers(markers: TimelineMarker[], at: number, duration: number, updatedAt = new Date().toISOString()): TimelineMarker[] {
  if (duration <= 0) return markers
  return markers.map((marker) => {
    if ((marker.duration ?? 0) > 0) {
      const shifted = insertIntoRange({ start: marker.time, end: marker.time + marker.duration! }, at, duration)
      return { ...marker, time: shifted.start, duration: shifted.end - shifted.start, updatedAt: marker.kind === 'comment' ? updatedAt : marker.updatedAt }
    }
    return marker.time >= at ? { ...marker, time: marker.time + duration, updatedAt: marker.kind === 'comment' ? updatedAt : marker.updatedAt } : marker
  })
}

export function rippleInsertTranscript(segments: TranscriptSegment[], at: number, duration: number): TranscriptSegment[] {
  if (duration <= 0) return segments
  return segments.map((segment) => {
    const shifted = insertIntoRange(segment, at, duration)
    const words = segment.words?.map((word) => insertIntoRange(word, at, duration))
    return shifted === segment && words === segment.words ? segment : { ...shifted, words }
  }).sort((left, right) => left.start - right.start || left.end - right.end)
}

export function rippleInsertSuggestions(suggestions: EditSuggestion[], at: number, duration: number): EditSuggestion[] {
  if (duration <= 0) return suggestions
  return suggestions.map((suggestion) => insertIntoRange(suggestion, at, duration))
    .sort((left, right) => left.start - right.start || left.end - right.end)
}

export function inspectAdrRippleInsert(tracks: TimelineTrack[], cues: AdrCue[], sequenceId: string, at: number): string[] {
  const blockers = new Set<string>()
  const tracksById = new Map(tracks.map((track) => [track.id, track]))
  const activeCues = cues.filter((cue) => cue.sequenceId === sequenceId)
  const activeCueIds = new Set(activeCues.map((cue) => cue.id))

  for (const cue of activeCues) {
    const label = cue.text.trim() || '이름 없는 ADR 큐'
    if (cue.start < at && cue.end > at) {
      blockers.add(`“${label}” ADR 큐 내부에는 삽입할 수 없습니다. 큐 경계 밖으로 재생 헤드를 옮겨주세요.`)
      continue
    }
    for (const take of cue.takes) {
      const track = tracksById.get(take.trackId)
      const clip = track?.clips.find((candidate) => candidate.id === take.clipId)
      if (!track) {
        blockers.add(`“${label}” ADR 테이크 트랙을 찾을 수 없어 삽입을 중단했습니다.`)
        continue
      }
      if (!clip || clip.adrCueId !== cue.id || clip.adrTakeId !== take.id) {
        blockers.add(`“${label}” ADR 테이크 클립 참조가 손상되어 삽입을 중단했습니다.`)
        continue
      }
      const cueMoves = cue.start >= at
      const clipMoves = clip.start >= at
      if (cueMoves !== clipMoves) blockers.add(`“${label}” ADR 큐와 테이크 클립의 시간이 일치하지 않아 삽입을 중단했습니다.`)
      else if (cueMoves && track.locked) blockers.add(`“${label}” ADR 테이크 트랙 잠금을 해제한 뒤 삽입해주세요.`)
    }
  }

  for (const track of tracks) {
    for (const clip of track.clips) {
      if (!clip.adrCueId) continue
      if (!activeCueIds.has(clip.adrCueId)) {
        blockers.add(`“${track.name}”의 ADR 테이크 클립이 활성 시퀀스 큐를 찾지 못해 삽입을 중단했습니다.`)
        continue
      }
      const clipEnd = clip.start + clip.duration
      if (clip.start < at && clipEnd > at) {
        blockers.add(`ADR 테이크 클립 내부에는 삽입할 수 없습니다. ADR 큐 경계 밖으로 재생 헤드를 옮겨주세요.`)
      } else if (clip.start >= at && track.locked) {
        blockers.add(`이후 ADR 테이크가 있는 “${track.name}” 트랙 잠금을 해제한 뒤 삽입해주세요.`)
      }
    }
  }

  return [...blockers]
}

export function rippleInsertAdrCues(cues: AdrCue[], sequenceId: string, at: number, duration: number, updatedAt = new Date().toISOString()): AdrCue[] {
  if (duration <= 0) return cues
  return cues.map((cue) => {
    if (cue.sequenceId !== sequenceId || cue.start < at) return cue
    return {
      ...cue,
      start: cue.start + duration,
      end: cue.end + duration,
      compSegments: cue.compSegments?.map((segment) => ({ ...segment, start: segment.start + duration, end: segment.end + duration })),
      updatedAt,
    }
  })
}
