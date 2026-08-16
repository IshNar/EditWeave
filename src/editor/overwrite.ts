import type { AdrCue, TimelineTrack } from './types'

export function inspectAdrOverwrite(tracks: TimelineTrack[], cues: AdrCue[], sequenceId: string, trackId: string, start: number, end: number): string[] {
  const rangeStart = Math.max(0, Math.min(start, end))
  const rangeEnd = Math.max(rangeStart, Math.max(start, end))
  if (rangeEnd <= rangeStart) return []
  const target = tracks.find((track) => track.id === trackId)
  if (!target) return ['덮어쓰기 대상 트랙을 찾을 수 없습니다.']
  const blockers = new Set<string>()
  const activeCues = cues.filter((cue) => cue.sequenceId === sequenceId)
  const cueById = new Map(activeCues.map((cue) => [cue.id, cue]))

  for (const clip of target.clips) {
    if (!clip.adrCueId || clip.start >= rangeEnd || clip.start + clip.duration <= rangeStart) continue
    const cue = cueById.get(clip.adrCueId)
    if (!cue) blockers.add(`“${target.name}”의 ADR 테이크 클립이 활성 시퀀스 큐를 찾지 못해 덮어쓰기를 중단했습니다.`)
    else blockers.add(`덮어쓰기 범위가 “${cue.text.trim() || '이름 없는 ADR 큐'}” 테이크와 겹칩니다. 다른 트랙을 대상으로 지정하거나 ADR 세션에서 큐를 정리해주세요.`)
  }

  for (const cue of activeCues) {
    if (cue.start >= rangeEnd || cue.end <= rangeStart || !cue.takes.some((take) => take.trackId === trackId)) continue
    const label = cue.text.trim() || '이름 없는 ADR 큐'
    for (const take of cue.takes.filter((candidate) => candidate.trackId === trackId)) {
      const clip = target.clips.find((candidate) => candidate.id === take.clipId)
      if (!clip || clip.adrCueId !== cue.id || clip.adrTakeId !== take.id) blockers.add(`“${label}” ADR 테이크 클립 참조가 손상되어 덮어쓰기를 중단했습니다.`)
    }
    blockers.add(`덮어쓰기 범위가 “${label}” ADR 큐와 겹칩니다. ADR 세션에서 큐를 정리하거나 다른 트랙을 대상으로 지정해주세요.`)
  }

  return [...blockers]
}
