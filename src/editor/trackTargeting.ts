import type { TimelineTrack, TrackKind } from './types'

const trackKinds: TrackKind[] = ['video', 'audio', 'caption']

export function normalizeSourceTargets(tracks: TimelineTrack[]): TimelineTrack[] {
  const normalized = tracks.map((track) => ({ ...track, editTarget: track.editTarget ?? true }))
  for (const kind of trackKinds) {
    const candidates = normalized.filter((track) => track.kind === kind)
    if (!candidates.length) continue
    const explicit = candidates.filter((track) => track.sourceTarget === true)
    if (explicit.length) {
      const winner = explicit[0].id
      candidates.forEach((track) => { track.sourceTarget = track.id === winner })
      continue
    }
    if (candidates.some((track) => typeof track.sourceTarget === 'boolean')) {
      candidates.forEach((track) => { track.sourceTarget = false })
      continue
    }
    const winner = candidates.find((track) => !track.locked) ?? candidates[0]
    candidates.forEach((track) => { track.sourceTarget = track.id === winner.id })
  }
  return normalized
}

export function resolveSourceTargetTrack(tracks: TimelineTrack[], kind: TrackKind): TimelineTrack | undefined {
  const candidates = tracks.filter((track) => track.kind === kind)
  const explicit = candidates.find((track) => track.sourceTarget === true)
  if (explicit) return explicit
  if (candidates.some((track) => typeof track.sourceTarget === 'boolean')) return undefined
  return candidates.find((track) => !track.locked) ?? candidates[0]
}

export function toggleSourceTarget(tracks: TimelineTrack[], trackId: string): TimelineTrack[] {
  const target = tracks.find((track) => track.id === trackId)
  if (!target) return tracks
  const enable = target.sourceTarget !== true
  return tracks.map((track) => track.kind !== target.kind ? track : { ...track, sourceTarget: enable && track.id === trackId })
}

export function assignSourceTarget(tracks: TimelineTrack[], trackId: string): TimelineTrack[] {
  const target = tracks.find((track) => track.id === trackId)
  if (!target) return tracks
  return tracks.map((track) => track.kind !== target.kind ? track : { ...track, sourceTarget: track.id === trackId })
}

export function repairSourceTargetAfterRemoval(tracks: TimelineTrack[], removed: TimelineTrack): TimelineTrack[] {
  if (removed.sourceTarget !== true || tracks.some((track) => track.kind === removed.kind && track.sourceTarget === true)) return tracks
  const replacement = tracks.find((track) => track.kind === removed.kind && !track.locked) ?? tracks.find((track) => track.kind === removed.kind)
  return replacement ? assignSourceTarget(tracks, replacement.id) : tracks
}
