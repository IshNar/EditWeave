import { defaultAudioAdjustment, resolveTrackAudioMix, sliceClipAutomation, sliceClipSpeed } from './effects'
import { rippleDeleteMarkers, rippleDeleteTranscript } from './rippleDelete'
import { clampTrimDelta, clipEndTrimDeltaRange, clipSlipDeltaRange, clipStartTrimDeltaRange, intersectTrimDeltaRanges, MIN_TIMELINE_CLIP_DURATION, TIMELINE_EDGE_TOLERANCE, type ClipSourceDurationMap, type TrimDeltaRange } from './trimConstraints'
import type { EditMode, TimelineClip, TimelineMarker, TimelineTrack, TrackKind, TranscriptSegment, TrimMode } from './types'

export function insertTimelineClip(tracks: TimelineTrack[], trackId: string, clip: TimelineClip, mode: EditMode): TimelineTrack[] {
  if (mode === 'insert') return rippleInsertTimelineClip(tracks, trackId, clip)
  return tracks.map((track) => {
    if (track.locked) return track
    let clips = track.clips
    if (mode === 'overwrite' && track.id === trackId) {
      clips = removeTrackRange(clips, clip.start, clip.start + clip.duration)
    }
    if (track.id !== trackId) return clips === track.clips ? track : { ...track, clips }
    return { ...track, clips: [...clips, clip].sort((a, b) => a.start - b.start) }
  })
}

function rippleInsertTimelineClip(tracks: TimelineTrack[], trackId: string, inserted: TimelineClip): TimelineTrack[] {
  return insertTimelineGap(tracks, inserted.start, inserted.duration, [trackId]).map((track) => track.id !== trackId || track.locked
    ? track
    : { ...track, clips: [...track.clips, inserted].sort((left, right) => left.start - right.start) })
}

export function insertTimelineGap(tracks: TimelineTrack[], at: number, duration: number, forcedTrackIds: Iterable<string> = []): TimelineTrack[] {
  if (duration <= 0) return tracks
  const forced = new Set(forcedTrackIds)
  const participates = (track: TimelineTrack) => !track.locked && (track.syncLock !== false || forced.has(track.id))
  const remappedGroups = new Map<string, string>()
  const remappedLinks = new Map<string, string>()
  tracks.filter(participates).flatMap((track) => track.clips).forEach((item) => {
    if (item.start >= at || item.start + item.duration <= at) return
    if (item.groupId && !remappedGroups.has(item.groupId)) remappedGroups.set(item.groupId, crypto.randomUUID())
    if (item.linkGroupId && !remappedLinks.has(item.linkGroupId)) remappedLinks.set(item.linkGroupId, crypto.randomUUID())
  })
  const remapRelation = (current: string | undefined, map: Map<string, string>) => {
    if (!current) return undefined
    const existing = map.get(current)
    if (existing) return existing
    const next = crypto.randomUUID()
    map.set(current, next)
    return next
  }

  return tracks.map((track) => {
    if (!participates(track)) return track
    const clips = track.clips.flatMap((item) => {
      const itemEnd = item.start + item.duration
      if (item.start >= at) return [{
        ...item,
        start: item.start + duration,
        groupId: item.groupId ? remappedGroups.get(item.groupId) ?? item.groupId : undefined,
        linkGroupId: item.linkGroupId ? remappedLinks.get(item.linkGroupId) ?? item.linkGroupId : undefined,
        adrCompRanges: item.adrCompRanges?.map((range) => ({ ...range, start: range.start + duration, end: range.end + duration })),
      }]
      if (itemEnd <= at) return [item]

      const splitAt = at - item.start
      const leftAutomation = sliceClipAutomation(item, 0, splitAt)
      const rightAutomation = sliceClipAutomation(item, splitAt, item.duration)
      const leftAudio = mergeAudioAdjustment(item.audioAdjustment, leftAutomation.audioAdjustment, { fadeOut: 0 })
      const rightAudio = mergeAudioAdjustment(item.audioAdjustment, rightAutomation.audioAdjustment, { fadeIn: 0 })
      return [
        {
          ...item,
          duration: splitAt,
          ...sliceClipSpeed(item, 0, splitAt),
          ...leftAutomation,
          captionWords: sliceCaptionWords(item.captionWords, 0, splitAt),
          transitionOut: undefined,
          audioAdjustment: leftAudio,
        },
        {
          ...item,
          id: crypto.randomUUID(),
          name: `${item.name} · 이어짐`,
          start: at + duration,
          duration: item.duration - splitAt,
          groupId: remapRelation(item.groupId, remappedGroups),
          linkGroupId: remapRelation(item.linkGroupId, remappedLinks),
          ...sliceClipSpeed(item, splitAt, item.duration),
          ...rightAutomation,
          captionWords: sliceCaptionWords(item.captionWords, splitAt, item.duration),
          transitionIn: undefined,
          audioAdjustment: rightAudio,
        },
      ]
    })
    const mixKeyframes = rippleInsertTrackMix(track, at, duration)
    return { ...track, clips: clips.sort((left, right) => left.start - right.start), mixKeyframes }
  })
}

function rippleInsertTrackMix(track: TimelineTrack, at: number, duration: number): TimelineTrack['mixKeyframes'] {
  if (!track.mixKeyframes?.length) return track.mixKeyframes
  const keyframes = [...track.mixKeyframes].sort((left, right) => left.time - right.time)
  const before = keyframes.some((keyframe) => keyframe.time < at)
  const atOrAfter = keyframes.find((keyframe) => keyframe.time >= at)
  const shifted = keyframes.map((keyframe) => keyframe.time >= at ? { ...keyframe, time: keyframe.time + duration } : keyframe)
  if (!before || !atOrAfter) return shifted

  const value = resolveTrackAudioMix(track, at)
  const exact = Math.abs(atOrAfter.time - at) < 1 / 240
  const boundaries = exact
    ? [{ ...atOrAfter, id: crypto.randomUUID(), time: at }]
    : [
        { id: crypto.randomUUID(), time: at, volume: value.volume, pan: value.pan, easing: atOrAfter.easing },
        { id: crypto.randomUUID(), time: at + duration, volume: value.volume, pan: value.pan, easing: 'linear' as const },
      ]
  return [...shifted, ...boundaries].sort((left, right) => left.time - right.time)
}

function sliceCaptionWords(words: TimelineClip['captionWords'], from: number, to: number): TimelineClip['captionWords'] {
  if (!words) return undefined
  return words.flatMap((word) => {
    if (word.end <= from || word.start >= to) return []
    return [{ ...word, start: Math.max(from, word.start) - from, end: Math.min(to, word.end) - from }]
  })
}

export function extendTimelineClipAtStart(clip: TimelineClip, start: number, duration: number): TimelineClip {
  return {
    ...clip,
    start,
    duration: clip.duration + duration,
    ...sliceClipSpeed(clip, -duration, clip.duration),
    keyframes: clip.keyframes?.map((keyframe) => ({ ...keyframe, time: keyframe.time + duration })),
    visualKeyframes: clip.visualKeyframes?.map((keyframe) => ({ ...keyframe, time: keyframe.time + duration })),
    audioMixKeyframes: clip.audioMixKeyframes?.map((keyframe) => ({ ...keyframe, time: keyframe.time + duration })),
    clipMarkers: clip.clipMarkers?.map((marker) => ({ ...marker, time: marker.time + duration })),
    captionWords: clip.captionWords?.map((word) => ({ ...word, start: word.start + duration, end: word.end + duration })),
  }
}

export function extendTimelineClipAtEnd(clip: TimelineClip, duration: number): TimelineClip {
  const nextDuration = clip.duration + duration
  return { ...clip, duration: nextDuration, ...sliceClipSpeed(clip, 0, nextDuration) }
}

export function moveClipGroup(tracks: TimelineTrack[], clipId: string, nextStart: number, includeLinked = true): TimelineTrack[] {
  const source = tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId)
  if (!source) return tracks
  const delta = Math.max(0, nextStart) - source.start
  return tracks.map((track) => track.locked ? track : ({
    ...track,
    clips: track.clips.map((clip) => {
      const belongs = clip.id === clipId || Boolean(source.groupId && clip.groupId === source.groupId) || Boolean(includeLinked && source.linkGroupId && clip.linkGroupId === source.linkGroupId)
      return belongs ? { ...clip, start: Math.max(0, clip.start + delta) } : clip
    }),
  }))
}

export function overwriteMovedTimelineClips(tracks: TimelineTrack[], movedClips: TimelineClip[]): TimelineTrack[] {
  if (!movedClips.length) return tracks
  const movingIds = new Set(movedClips.map((clip) => clip.id))
  return tracks.map((track) => {
    const arrivals = movedClips.filter((clip) => clip.trackId === track.id)
    let clips = track.clips.filter((clip) => !movingIds.has(clip.id))
    for (const arrival of arrivals) clips = removeTrackRange(clips, arrival.start, arrival.start + arrival.duration)
    return { ...track, clips: [...clips, ...arrivals].sort((left, right) => left.start - right.start) }
  })
}

export function snapTimelineTime(tracks: TimelineTrack[], proposedTime: number, playhead: number, extraTargets: number[] = [], excludedClipIds: ReadonlySet<string> = new Set(), threshold = 0.18): number {
  const targets = [
    0,
    playhead,
    ...extraTargets,
    ...tracks.flatMap((track) => track.clips.flatMap((clip) => excludedClipIds.has(clip.id) ? [] : [clip.start, clip.start + clip.duration])),
  ]
  let result = Math.max(0, proposedTime)
  let bestDistance = threshold
  for (const target of targets) {
    const distance = Math.abs(result - target)
    if (distance < bestDistance) {
      result = Math.max(0, target)
      bestDistance = distance
    }
  }
  return result
}

export function snapClipStart(tracks: TimelineTrack[], clipId: string, proposedStart: number, playhead: number, extraTargets: number[] = [], threshold = 0.18): number {
  const source = tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId)
  if (!source) return Math.max(0, proposedStart)
  const targets = [0, playhead, ...extraTargets, ...tracks.flatMap((track) => track.clips.flatMap((clip) => clip.id === clipId ? [] : [clip.start, clip.start + clip.duration]))]
  let result = Math.max(0, proposedStart)
  let bestDistance = threshold
  for (const target of targets) {
    const startDistance = Math.abs(result - target)
    if (startDistance < bestDistance) {
      result = target
      bestDistance = startDistance
    }
    const endDistance = Math.abs(result + source.duration - target)
    if (endDistance < bestDistance) {
      result = Math.max(0, target - source.duration)
      bestDistance = endDistance
    }
  }
  return result
}

interface ClipTrackReference {
  clip: TimelineClip
  track: TimelineTrack
}

interface TrimPair {
  target: ClipTrackReference
  neighbor: TimelineClip
}

export interface TimelineTrimResult {
  tracks: TimelineTrack[]
  changed: boolean
  appliedBoundary?: number
  reason?: string
}

function timelineClipBoundary(clip: TimelineClip, edge: 'start' | 'end'): number {
  return edge === 'start' ? clip.start : clip.start + clip.duration
}

function isAdrManagedClip(clip: TimelineClip): boolean {
  return Boolean(clip.adrCueId || clip.adrTakeId || clip.adrCompRanges?.length)
}

function transitionDurationLimit(clipDuration: number, edge: 'in' | 'out', transition: TimelineClip['transitionIn']): number {
  if (!transition) return clipDuration
  const alignment = transition.alignment ?? (edge === 'in' ? 'start-at-cut' : 'end-at-cut')
  return alignment === 'center-on-cut' ? clipDuration * 2 : clipDuration
}

function clampOuterEdgeDurations(clip: TimelineClip): TimelineClip {
  const transitionIn = clip.transitionIn ? { ...clip.transitionIn, duration: Math.min(transitionDurationLimit(clip.duration, 'in', clip.transitionIn), clip.transitionIn.duration) } : undefined
  const transitionOut = clip.transitionOut ? { ...clip.transitionOut, duration: Math.min(transitionDurationLimit(clip.duration, 'out', clip.transitionOut), clip.transitionOut.duration) } : undefined
  const audioAdjustment = clip.audioAdjustment ? {
    ...clip.audioAdjustment,
    fadeIn: Math.min(clip.duration, clip.audioAdjustment.fadeIn),
    fadeOut: Math.min(clip.duration, clip.audioAdjustment.fadeOut),
  } : undefined
  return { ...clip, transitionIn, transitionOut, audioAdjustment }
}

function resizeClipStart(clip: TimelineClip, delta: number): TimelineClip {
  if (delta < 0) return clampOuterEdgeDurations(extendTimelineClipAtStart(clip, clip.start + delta, -delta))
  const duration = clip.duration - delta
  return clampOuterEdgeDurations({
    ...clip,
    start: clip.start + delta,
    duration,
    ...sliceClipSpeed(clip, delta, clip.duration),
    ...sliceClipAutomation(clip, delta, clip.duration),
    captionWords: sliceCaptionWords(clip.captionWords, delta, clip.duration),
  })
}

function resizeClipEnd(clip: TimelineClip, delta: number): TimelineClip {
  if (delta > 0) return clampOuterEdgeDurations(extendTimelineClipAtEnd(clip, delta))
  const duration = clip.duration + delta
  return clampOuterEdgeDurations({
    ...clip,
    duration,
    ...sliceClipSpeed(clip, 0, duration),
    ...sliceClipAutomation(clip, 0, duration),
    captionWords: sliceCaptionWords(clip.captionWords, 0, duration),
  })
}

function allClipTrackReferences(tracks: TimelineTrack[]): ClipTrackReference[] {
  return tracks.flatMap((track) => track.clips.map((clip) => ({ clip, track })))
}

function linkedTargets(
  tracks: TimelineTrack[],
  source: TimelineClip,
  edge?: 'start' | 'end',
  includeLinked = true,
): ClipTrackReference[] {
  const references = allClipTrackReferences(tracks)
  if (!includeLinked || !source.linkGroupId) return references.filter(({ clip }) => clip.id === source.id)
  const boundary = edge ? timelineClipBoundary(source, edge) : undefined
  return references.filter(({ clip }) => clip.id === source.id || (
    clip.linkGroupId === source.linkGroupId
    && (boundary === undefined || Math.abs(timelineClipBoundary(clip, edge!) - boundary) <= TIMELINE_EDGE_TOLERANCE)
  ))
}

function protectedTargetReason(targets: ClipTrackReference[], includeNeighbors: TimelineClip[] = []): string | undefined {
  if (targets.some(({ track }) => track.locked)) return '링크된 클립이 있는 트랙 잠금을 모두 해제한 뒤 트림해주세요.'
  if (targets.some(({ clip }) => isAdrManagedClip(clip)) || includeNeighbors.some(isAdrManagedClip)) {
    return 'ADR 테이크 또는 컴프 경계는 ADR 세션에서 조정해주세요.'
  }
  const targetTrackIds = targets.map(({ track }) => track.id)
  if (new Set(targetTrackIds).size !== targetTrackIds.length) return '같은 트랙에 중복 연결된 클립이 있어 링크를 정리한 뒤 트림해야 합니다.'
  return undefined
}

function previousAdjacentClip(track: TimelineTrack, clip: TimelineClip): TimelineClip | undefined {
  return track.clips
    .filter((candidate) => candidate.id !== clip.id && candidate.start + candidate.duration <= clip.start + TIMELINE_EDGE_TOLERANCE)
    .sort((left, right) => right.start + right.duration - (left.start + left.duration))[0]
}

function nextAdjacentClip(track: TimelineTrack, clip: TimelineClip): TimelineClip | undefined {
  return track.clips
    .filter((candidate) => candidate.id !== clip.id && candidate.start >= clip.start + clip.duration - TIMELINE_EDGE_TOLERANCE)
    .sort((left, right) => left.start - right.start)[0]
}

function exactTrimPair(target: ClipTrackReference, edge: 'start' | 'end'): TrimPair | undefined {
  const neighbor = edge === 'start'
    ? previousAdjacentClip(target.track, target.clip)
    : nextAdjacentClip(target.track, target.clip)
  if (!neighbor) return undefined
  const neighborBoundary = edge === 'start' ? neighbor.start + neighbor.duration : neighbor.start
  return Math.abs(neighborBoundary - timelineClipBoundary(target.clip, edge)) <= TIMELINE_EDGE_TOLERANCE
    ? { target, neighbor }
    : undefined
}

function validateLinkedNeighbors(tracks: TimelineTrack[], pairs: TrimPair[], neighborEdge: 'start' | 'end'): string | undefined {
  const pairNeighborIds = new Set(pairs.map((pair) => pair.neighbor.id))
  const references = allClipTrackReferences(tracks)
  for (const pair of pairs) {
    if (!pair.neighbor.linkGroupId) continue
    const boundary = timelineClipBoundary(pair.neighbor, neighborEdge)
    const missing = references.some(({ clip }) => clip.linkGroupId === pair.neighbor.linkGroupId
      && Math.abs(timelineClipBoundary(clip, neighborEdge) - boundary) <= TIMELINE_EDGE_TOLERANCE
      && !pairNeighborIds.has(clip.id))
    if (missing) return '인접한 링크 클립 쌍을 일부만 변경할 수 없습니다. 링크 또는 인접 편집점을 정리해주세요.'
  }
  return undefined
}

function applyClipMutations(tracks: TimelineTrack[], mutations: Map<string, TimelineClip>): TimelineTrack[] {
  if (!mutations.size) return tracks
  return tracks.map((track) => {
    const changed = track.clips.some((clip) => mutations.has(clip.id))
    return changed ? { ...track, clips: track.clips.map((clip) => mutations.get(clip.id) ?? clip).sort((left, right) => left.start - right.start) } : track
  })
}

function normalTrimResult(
  tracks: TimelineTrack[],
  source: TimelineClip,
  edge: 'start' | 'end',
  timelineTime: number,
  sourceDurations?: ClipSourceDurationMap,
  includeLinked = true,
): TimelineTrimResult {
  const targets = linkedTargets(tracks, source, edge, includeLinked)
  const protectedReason = protectedTargetReason(targets)
  if (protectedReason) return { tracks, changed: false, reason: protectedReason }
  const requestedDelta = timelineTime - timelineClipBoundary(source, edge)
  const ranges = targets.map(({ clip, track }): TrimDeltaRange => {
    const range = edge === 'start' ? clipStartTrimDeltaRange(clip, sourceDurations) : clipEndTrimDeltaRange(clip, sourceDurations)
    if (edge === 'start') {
      const previous = previousAdjacentClip(track, clip)
      const collisionMinimum = previous && previous.start + previous.duration <= clip.start + TIMELINE_EDGE_TOLERANCE
        ? previous.start + previous.duration - clip.start
        : range.minimum
      return { ...range, minimum: Math.max(range.minimum, collisionMinimum) }
    }
    const next = nextAdjacentClip(track, clip)
    const collisionMaximum = next && next.start >= clip.start + clip.duration - TIMELINE_EDGE_TOLERANCE
      ? next.start - clip.start - clip.duration
      : range.maximum
    return { ...range, maximum: Math.min(range.maximum, collisionMaximum) }
  })
  const range = intersectTrimDeltaRanges(ranges)
  if (!range) return { tracks, changed: false, reason: '링크된 클립들의 원본 핸들 범위가 서로 맞지 않습니다.' }
  const delta = clampTrimDelta(requestedDelta, range)
  if (Math.abs(delta) <= 1 / 240) return { tracks, changed: false, reason: '원본 미디어 핸들 또는 인접 클립 경계에 도달했습니다.' }
  const mutations = new Map<string, TimelineClip>(targets.map(({ clip }) => [clip.id, edge === 'start' ? resizeClipStart(clip, delta) : resizeClipEnd(clip, delta)]))
  return { tracks: applyClipMutations(tracks, mutations), changed: true, appliedBoundary: timelineClipBoundary(source, edge) + delta }
}

function slipTrimResult(
  tracks: TimelineTrack[],
  source: TimelineClip,
  edge: 'start' | 'end',
  timelineTime: number,
  sourceDurations?: ClipSourceDurationMap,
  includeLinked = true,
): TimelineTrimResult {
  const targets = linkedTargets(tracks, source, undefined, includeLinked)
  const protectedReason = protectedTargetReason(targets)
  if (protectedReason) return { tracks, changed: false, reason: protectedReason }
  const constraints = targets.map(({ clip }) => ({ clip, range: clipSlipDeltaRange(clip, edge, sourceDurations) }))
  if (constraints.some(({ range }) => range.factor === 0)) {
    return { tracks, changed: false, reason: '정지 이미지·정지 프레임·생성 레이어에는 이동할 소스 시간이 없습니다.' }
  }
  const range = intersectTrimDeltaRanges(constraints.map((constraint) => constraint.range))
  if (!range) return { tracks, changed: false, reason: '링크된 클립들의 슬립 가능한 원본 범위가 서로 맞지 않습니다.' }
  const requestedDelta = timelineTime - timelineClipBoundary(source, edge)
  const delta = clampTrimDelta(requestedDelta, range)
  if (Math.abs(delta) <= 1 / 240) return { tracks, changed: false, reason: '원본 미디어의 시작 또는 끝 핸들에 도달했습니다.' }
  const mutations = new Map<string, TimelineClip>(constraints.map(({ clip, range: constraint }) => [
    clip.id,
    { ...clip, sourceOffset: Math.max(0, clip.sourceOffset + delta * constraint.factor) },
  ]))
  return { tracks: applyClipMutations(tracks, mutations), changed: true, appliedBoundary: timelineClipBoundary(source, edge) + delta }
}

function rollTrimResult(
  tracks: TimelineTrack[],
  source: TimelineClip,
  edge: 'start' | 'end',
  timelineTime: number,
  sourceDurations?: ClipSourceDurationMap,
  includeLinked = true,
): TimelineTrimResult {
  const targets = linkedTargets(tracks, source, edge, includeLinked)
  const pairs = targets.map((target) => exactTrimPair(target, edge))
  if (pairs.some((pair) => !pair)) return { tracks, changed: false, reason: '롤 트림에는 각 링크 트랙의 맞닿은 인접 클립이 필요합니다.' }
  const exactPairs = pairs as TrimPair[]
  const protectedReason = protectedTargetReason(targets, exactPairs.map((pair) => pair.neighbor))
  if (protectedReason) return { tracks, changed: false, reason: protectedReason }
  const linkedNeighborReason = includeLinked ? validateLinkedNeighbors(tracks, exactPairs, edge === 'start' ? 'end' : 'start') : undefined
  if (linkedNeighborReason) return { tracks, changed: false, reason: linkedNeighborReason }
  const ranges = exactPairs.flatMap(({ target, neighbor }) => edge === 'start'
    ? [clipStartTrimDeltaRange(target.clip, sourceDurations), clipEndTrimDeltaRange(neighbor, sourceDurations)]
    : [clipEndTrimDeltaRange(target.clip, sourceDurations), clipStartTrimDeltaRange(neighbor, sourceDurations)])
  const range = intersectTrimDeltaRanges(ranges)
  if (!range) return { tracks, changed: false, reason: '양쪽 클립의 원본 핸들이 이 롤 편집점을 허용하지 않습니다.' }
  const requestedDelta = timelineTime - timelineClipBoundary(source, edge)
  const delta = clampTrimDelta(requestedDelta, range)
  if (Math.abs(delta) <= 1 / 240) return { tracks, changed: false, reason: '양쪽 클립의 원본 핸들 또는 최소 길이에 도달했습니다.' }
  const mutations = new Map<string, TimelineClip>()
  exactPairs.forEach(({ target, neighbor }) => {
    mutations.set(target.clip.id, edge === 'start' ? resizeClipStart(target.clip, delta) : resizeClipEnd(target.clip, delta))
    mutations.set(neighbor.id, edge === 'start' ? resizeClipEnd(neighbor, delta) : resizeClipStart(neighbor, delta))
  })
  return { tracks: applyClipMutations(tracks, mutations), changed: true, appliedBoundary: timelineClipBoundary(source, edge) + delta }
}

function slideTrimResult(
  tracks: TimelineTrack[],
  source: TimelineClip,
  edge: 'start' | 'end',
  timelineTime: number,
  sourceDurations?: ClipSourceDurationMap,
  includeLinked = true,
): TimelineTrimResult {
  const targets = linkedTargets(tracks, source, undefined, includeLinked)
  const protectedReason = protectedTargetReason(targets)
  if (protectedReason) return { tracks, changed: false, reason: protectedReason }
  const pairs = targets.map((target) => {
    const previous = previousAdjacentClip(target.track, target.clip)
    const next = nextAdjacentClip(target.track, target.clip)
    if (!previous || !next) return undefined
    if (Math.abs(previous.start + previous.duration - target.clip.start) > TIMELINE_EDGE_TOLERANCE) return undefined
    if (Math.abs(target.clip.start + target.clip.duration - next.start) > TIMELINE_EDGE_TOLERANCE) return undefined
    return { target, previous, next }
  })
  if (pairs.some((pair) => !pair)) return { tracks, changed: false, reason: '슬라이드에는 각 링크 트랙에서 앞뒤로 맞닿은 클립이 모두 필요합니다.' }
  const exactPairs = pairs as Array<{ target: ClipTrackReference; previous: TimelineClip; next: TimelineClip }>
  const neighbors = exactPairs.flatMap((pair) => [pair.previous, pair.next])
  const neighborProtectedReason = protectedTargetReason(targets, neighbors)
  if (neighborProtectedReason) return { tracks, changed: false, reason: neighborProtectedReason }
  const previousLinkReason = includeLinked ? validateLinkedNeighbors(tracks, exactPairs.map((pair) => ({ target: pair.target, neighbor: pair.previous })), 'end') : undefined
  if (previousLinkReason) return { tracks, changed: false, reason: previousLinkReason }
  const nextLinkReason = includeLinked ? validateLinkedNeighbors(tracks, exactPairs.map((pair) => ({ target: pair.target, neighbor: pair.next })), 'start') : undefined
  if (nextLinkReason) return { tracks, changed: false, reason: nextLinkReason }
  const mutationRoles = exactPairs.flatMap((pair) => [pair.target.clip.id, pair.previous.id, pair.next.id])
  if (new Set(mutationRoles).size !== mutationRoles.length) return { tracks, changed: false, reason: '겹쳐 연결된 슬라이드 대상이 있어 링크 관계를 먼저 정리해야 합니다.' }
  const ranges = exactPairs.flatMap(({ target, previous, next }): TrimDeltaRange[] => [
    { minimum: -target.clip.start, maximum: Number.POSITIVE_INFINITY },
    clipEndTrimDeltaRange(previous, sourceDurations),
    clipStartTrimDeltaRange(next, sourceDurations),
  ])
  const range = intersectTrimDeltaRanges(ranges)
  if (!range) return { tracks, changed: false, reason: '앞뒤 클립의 원본 핸들이 슬라이드를 허용하지 않습니다.' }
  const requestedDelta = timelineTime - timelineClipBoundary(source, edge)
  const delta = clampTrimDelta(requestedDelta, range)
  if (Math.abs(delta) <= 1 / 240) return { tracks, changed: false, reason: '앞뒤 클립의 원본 핸들 또는 최소 길이에 도달했습니다.' }
  const mutations = new Map<string, TimelineClip>()
  exactPairs.forEach(({ target, previous, next }) => {
    mutations.set(target.clip.id, { ...target.clip, start: target.clip.start + delta })
    mutations.set(previous.id, resizeClipEnd(previous, delta))
    mutations.set(next.id, resizeClipStart(next, delta))
  })
  return { tracks: applyClipMutations(tracks, mutations), changed: true, appliedBoundary: timelineClipBoundary(source, edge) + delta }
}

function scaleLocalTime(time: number, ratio: number, duration: number): number {
  return Math.max(0, Math.min(duration, time * ratio))
}

function rateStretchClip(clip: TimelineClip, edge: 'start' | 'end', duration: number): TimelineClip {
  const nextDuration = Math.max(MIN_TIMELINE_CLIP_DURATION, duration)
  const timeRatio = nextDuration / Math.max(MIN_TIMELINE_CLIP_DURATION, clip.duration)
  const rateRatio = clip.duration / nextDuration
  const scaleKeyframes = <T extends { time: number }>(keyframes: T[] | undefined): T[] | undefined => keyframes?.map((keyframe) => ({ ...keyframe, time: scaleLocalTime(keyframe.time, timeRatio, nextDuration) }))
  const audioAdjustment = clip.audioAdjustment ? {
    ...clip.audioAdjustment,
    fadeIn: Math.min(nextDuration, clip.audioAdjustment.fadeIn * timeRatio),
    fadeOut: Math.min(nextDuration, clip.audioAdjustment.fadeOut * timeRatio),
  } : undefined
  return clampOuterEdgeDurations({
    ...clip,
    start: edge === 'start' ? clip.start + clip.duration - nextDuration : clip.start,
    duration: nextDuration,
    playbackRate: Math.max(0.05, Math.min(16, (clip.playbackRate ?? 1) * rateRatio)),
    speedKeyframes: clip.speedKeyframes?.map((keyframe) => ({ ...keyframe, time: scaleLocalTime(keyframe.time, timeRatio, nextDuration), rate: Math.max(0.05, Math.min(16, keyframe.rate * rateRatio)) })),
    keyframes: scaleKeyframes(clip.keyframes),
    visualKeyframes: scaleKeyframes(clip.visualKeyframes),
    audioMixKeyframes: scaleKeyframes(clip.audioMixKeyframes),
    clipMarkers: clip.clipMarkers?.map((marker) => {
      const time = scaleLocalTime(marker.time, timeRatio, nextDuration)
      return { ...marker, time, duration: marker.duration === undefined ? undefined : Math.min(Math.max(0, nextDuration - time), marker.duration * timeRatio) }
    }),
    transitionIn: clip.transitionIn ? { ...clip.transitionIn, duration: clip.transitionIn.duration * timeRatio } : undefined,
    transitionOut: clip.transitionOut ? { ...clip.transitionOut, duration: clip.transitionOut.duration * timeRatio } : undefined,
    audioAdjustment,
  })
}

function rateStretchResult(
  tracks: TimelineTrack[],
  source: TimelineClip,
  edge: 'start' | 'end',
  timelineTime: number,
  sourceDurations?: ClipSourceDurationMap,
  includeLinked = true,
): TimelineTrimResult {
  const targets = linkedTargets(tracks, source, edge, includeLinked)
  const protectedReason = protectedTargetReason(targets)
  if (protectedReason) return { tracks, changed: false, reason: protectedReason }
  if (targets.some(({ clip }) => clip.freezeFrame || sourceDurations?.get(clip.id) === Number.POSITIVE_INFINITY)) {
    return { tracks, changed: false, reason: '속도 늘이기는 시간 기반 영상·오디오·중첩 시퀀스에만 사용할 수 있습니다.' }
  }
  const boundaryRanges = targets.map(({ clip, track }): TrimDeltaRange => {
    const rates = [clip.playbackRate ?? 1, ...(clip.speedKeyframes ?? []).map((keyframe) => keyframe.rate)].map((rate) => Math.max(0.05, Math.min(16, rate)))
    const minimumDuration = Math.max(MIN_TIMELINE_CLIP_DURATION, clip.duration * Math.max(...rates) / 16)
    const maximumDuration = clip.duration * Math.min(...rates) / 0.05
    if (edge === 'end') {
      const next = nextAdjacentClip(track, clip)
      return {
        minimum: clip.start + minimumDuration,
        maximum: Math.min(clip.start + maximumDuration, next ? next.start : Number.POSITIVE_INFINITY),
      }
    }
    const previous = previousAdjacentClip(track, clip)
    const end = clip.start + clip.duration
    return {
      minimum: Math.max(0, end - maximumDuration, previous ? previous.start + previous.duration : 0),
      maximum: end - minimumDuration,
    }
  })
  const boundaryRange = intersectTrimDeltaRanges(boundaryRanges)
  if (!boundaryRange) return { tracks, changed: false, reason: '링크 클립의 속도 한계 또는 인접 클립 경계가 서로 맞지 않습니다.' }
  const boundary = clampTrimDelta(timelineTime, boundaryRange)
  const currentBoundary = timelineClipBoundary(source, edge)
  if (Math.abs(boundary - currentBoundary) <= 1 / 240) return { tracks, changed: false, reason: '재생 속도 한계 또는 인접 클립 경계에 도달했습니다.' }
  const mutations = new Map<string, TimelineClip>(targets.map(({ clip }) => {
    const fixed = edge === 'start' ? clip.start + clip.duration : clip.start
    const duration = edge === 'start' ? fixed - boundary : boundary - fixed
    return [clip.id, rateStretchClip(clip, edge, duration)]
  }))
  return { tracks: applyClipMutations(tracks, mutations), changed: true, appliedBoundary: boundary }
}

function rippleTrimResult(
  tracks: TimelineTrack[],
  source: TimelineClip,
  edge: 'start' | 'end',
  timelineTime: number,
  sourceDurations?: ClipSourceDurationMap,
  includeLinked = true,
): TimelineTrimResult {
  const oldBoundary = timelineClipBoundary(source, edge)
  const requestedDelta = timelineTime - oldBoundary
  if (Math.abs(requestedDelta) <= 1 / 240) return { tracks, changed: false }
  const contraction = (edge === 'start' && requestedDelta > 0) || (edge === 'end' && requestedDelta < 0)
  if (contraction) {
    const range = edge === 'start'
      ? clipStartTrimDeltaRange(source, sourceDurations)
      : clipEndTrimDeltaRange(source, sourceDurations)
    const delta = clampTrimDelta(requestedDelta, range)
    if (Math.abs(delta) <= 1 / 240) return { tracks, changed: false, reason: '클립의 최소 길이에 도달했습니다.' }
    const nextBoundary = oldBoundary + delta
    const nextTracks = removeTimelineRange(tracks, edge === 'start' ? oldBoundary : nextBoundary, edge === 'start' ? nextBoundary : oldBoundary, [source.trackId])
    return { tracks: nextTracks, changed: nextTracks !== tracks, appliedBoundary: nextBoundary }
  }

  const targets = linkedTargets(tracks, source, edge, includeLinked)
  const protectedReason = protectedTargetReason(targets)
  if (protectedReason) return { tracks, changed: false, reason: protectedReason }
  const ranges = targets.map(({ clip }) => edge === 'start'
    ? clipStartTrimDeltaRange(clip, sourceDurations)
    : clipEndTrimDeltaRange(clip, sourceDurations))
  const range = intersectTrimDeltaRanges(ranges)
  if (!range) return { tracks, changed: false, reason: '링크된 클립들의 원본 핸들 범위가 서로 맞지 않습니다.' }
  const delta = clampTrimDelta(requestedDelta, range)
  if (Math.abs(delta) <= 1 / 240) return { tracks, changed: false, reason: '원본 미디어 핸들 끝에 도달했습니다.' }
  const originals = new Map<string, TimelineClip>(targets.map(({ clip }) => [clip.id, clip]))
  const insertedDuration = Math.abs(delta)
  const gapped = insertTimelineGap(tracks, oldBoundary, insertedDuration, targets.map(({ track }) => track.id))
  const nextTracks = gapped.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => {
      const original = originals.get(clip.id)
      if (!original) return clip
      return edge === 'start'
        ? extendTimelineClipAtStart({ ...original, groupId: clip.groupId, linkGroupId: clip.linkGroupId }, original.start, insertedDuration)
        : extendTimelineClipAtEnd(clip, insertedDuration)
    }).sort((left, right) => left.start - right.start),
  }))
  return { tracks: nextTracks, changed: true, appliedBoundary: oldBoundary + delta }
}

export function trimTimelineClipAdvancedResult(
  tracks: TimelineTrack[],
  clipId: string,
  edge: 'start' | 'end',
  timelineTime: number,
  mode: TrimMode,
  sourceDurations?: ClipSourceDurationMap,
  includeLinked = true,
): TimelineTrimResult {
  const sourceTrack = tracks.find((track) => track.clips.some((clip) => clip.id === clipId))
  const source = sourceTrack?.clips.find((clip) => clip.id === clipId)
  if (!source) return { tracks, changed: false, reason: '트림할 클립을 찾지 못했습니다.' }
  if (sourceTrack?.locked) return { tracks, changed: false, reason: '잠긴 트랙의 클립은 트림할 수 없습니다.' }
  if (isAdrManagedClip(source)) return { tracks, changed: false, reason: 'ADR 테이크 또는 컴프 경계는 ADR 세션에서 조정해주세요.' }
  if (mode === 'normal') return normalTrimResult(tracks, source, edge, timelineTime, sourceDurations, includeLinked)
  if (mode === 'slip') return slipTrimResult(tracks, source, edge, timelineTime, sourceDurations, includeLinked)
  if (mode === 'slide') return slideTrimResult(tracks, source, edge, timelineTime, sourceDurations, includeLinked)
  if (mode === 'rate-stretch') return rateStretchResult(tracks, source, edge, timelineTime, sourceDurations, includeLinked)
  if (mode === 'ripple') return rippleTrimResult(tracks, source, edge, timelineTime, sourceDurations, includeLinked)
  return rollTrimResult(tracks, source, edge, timelineTime, sourceDurations, includeLinked)
}

export function trimTimelineClip(tracks: TimelineTrack[], clipId: string, edge: 'start' | 'end', timelineTime: number, sourceDurations?: ClipSourceDurationMap): TimelineTrack[] {
  return trimTimelineClipAdvancedResult(tracks, clipId, edge, timelineTime, 'normal', sourceDurations).tracks
}

export function trimTimelineClipAdvanced(tracks: TimelineTrack[], clipId: string, edge: 'start' | 'end', timelineTime: number, mode: TrimMode, sourceDurations?: ClipSourceDurationMap): TimelineTrack[] {
  return trimTimelineClipAdvancedResult(tracks, clipId, edge, timelineTime, mode, sourceDurations).tracks
}

export function setClipGroup(tracks: TimelineTrack[], clipIds: string[], groupId?: string): TimelineTrack[] {
  const selected = new Set(clipIds)
  return tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => selected.has(clip.id) ? { ...clip, groupId } : clip),
  }))
}

export function linkClipsAtTime(tracks: TimelineTrack[], time: number): TimelineTrack[] {
  const active = tracks.filter((track) => !track.locked).flatMap((track) => track.clips)
    .filter((clip) => time >= clip.start && time < clip.start + clip.duration)
  if (active.length < 2) return tracks
  const linkGroupId = active.find((clip) => clip.linkGroupId)?.linkGroupId ?? crypto.randomUUID()
  const ids = new Set(active.map((clip) => clip.id))
  return tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => ids.has(clip.id) ? { ...clip, linkGroupId } : clip) }))
}

export function unlinkClip(tracks: TimelineTrack[], clipId: string): TimelineTrack[] {
  const target = tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId)
  if (!target?.linkGroupId) return tracks
  return tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => clip.linkGroupId === target.linkGroupId ? { ...clip, linkGroupId: undefined } : clip),
  }))
}

export function addTimelineTrack(tracks: TimelineTrack[], kind: TrackKind): TimelineTrack[] {
  const index = tracks.filter((track) => track.kind === kind).length + 1
  const prefix = kind === 'video' ? 'V' : kind === 'audio' ? 'A' : 'T'
  const label = kind === 'video' ? '영상' : kind === 'audio' ? '오디오' : '자막'
  const track: TimelineTrack = {
    id: `${kind}-${crypto.randomUUID()}`,
    name: `${prefix}${index} · ${label}`,
    kind,
    editTarget: true,
    muted: false,
    locked: false,
    syncLock: true,
    volume: 100,
    pan: 0,
    visible: true,
    solo: false,
    clips: [],
  }
  const insertionIndex = kind === 'video'
    ? tracks.findIndex((item) => item.kind !== 'video')
    : kind === 'audio'
      ? tracks.findIndex((item) => item.kind === 'caption')
      : -1
  if (insertionIndex < 0) return [...tracks, track]
  return [...tracks.slice(0, insertionIndex), track, ...tracks.slice(insertionIndex)]
}

export function removeTimelineTrack(tracks: TimelineTrack[], trackId: string): TimelineTrack[] {
  const target = tracks.find((track) => track.id === trackId)
  if (!target || tracks.filter((track) => track.kind === target.kind).length <= 1) return tracks
  return tracks.filter((track) => track.id !== trackId).map((track) => ({
    ...track,
    clips: track.clips.map((clip) => clip.trackMatte?.sourceTrackId === trackId ? { ...clip, trackMatte: undefined } : clip),
  }))
}

export function upsertMarker(markers: TimelineMarker[], time: number, label?: string): TimelineMarker[] {
  const existing = markers.find((marker) => Math.abs(marker.time - time) < 1 / 30)
  if (existing) return markers.map((marker) => marker.id === existing.id ? { ...marker, label: label ?? marker.label } : marker)
  return [...markers, {
    id: crypto.randomUUID(),
    time: Math.max(0, time),
    label: label?.trim() || `마커 ${markers.length + 1}`,
    color: '#f0b35c',
    kind: 'edit' as const,
  }].sort((a, b) => a.time - b.time)
}

export function removeTimelineRange(tracks: TimelineTrack[], start: number, end: number, forcedTrackIds: Iterable<string> = []): TimelineTrack[] {
  const rangeStart = Math.max(0, Math.min(start, end))
  const rangeEnd = Math.max(rangeStart, Math.max(start, end))
  const removedDuration = rangeEnd - rangeStart
  if (removedDuration <= 0) return tracks
  const forced = new Set(forcedTrackIds)
  const participates = (track: TimelineTrack) => !track.locked && (track.syncLock !== false || forced.has(track.id))

  const remappedGroups = new Map<string, string>()
  const remappedLinks = new Map<string, string>()
  tracks.filter(participates).flatMap((track) => track.clips).forEach((clip) => {
    if (clip.start >= rangeStart || clip.start + clip.duration <= rangeEnd) return
    if (clip.groupId && !remappedGroups.has(clip.groupId)) remappedGroups.set(clip.groupId, crypto.randomUUID())
    if (clip.linkGroupId && !remappedLinks.has(clip.linkGroupId)) remappedLinks.set(clip.linkGroupId, crypto.randomUUID())
  })

  return tracks.map((track) => !participates(track) ? track : ({
    ...track,
    clips: track.clips.flatMap((clip) => removeRangeFromClip(clip, rangeStart, rangeEnd, removedDuration, remappedGroups, remappedLinks))
      .sort((left, right) => left.start - right.start),
    mixKeyframes: rippleDeleteTrackMix(track, rangeStart, rangeEnd),
  }))
}

export function liftTimelineRange(tracks: TimelineTrack[], start: number, end: number, targetTrackIds: Iterable<string>): TimelineTrack[] {
  const rangeStart = Math.max(0, Math.min(start, end))
  const rangeEnd = Math.max(rangeStart, Math.max(start, end))
  if (rangeEnd <= rangeStart) return tracks
  const targets = new Set(targetTrackIds)
  if (!targets.size) return tracks

  return tracks.map((track) => track.locked || !targets.has(track.id) ? track : ({
    ...track,
    clips: removeTrackRange(track.clips, rangeStart, rangeEnd),
  }))
}

export function splitTimelineClipsAt(tracks: TimelineTrack[], time: number, targetClipIds: Iterable<string>): { tracks: TimelineTrack[]; rightClipIds: string[] } {
  const targets = new Set(targetClipIds)
  if (!targets.size) return { tracks, rightClipIds: [] }
  const rightClipIds: string[] = []
  const remappedGroups = new Map<string, string>()
  const remappedLinks = new Map<string, string>()
  const remap = (value: string | undefined, replacements: Map<string, string>) => {
    if (!value) return undefined
    let replacement = replacements.get(value)
    if (!replacement) {
      replacement = crypto.randomUUID()
      replacements.set(value, replacement)
    }
    return replacement
  }

  const nextTracks = tracks.map((track) => track.locked ? track : ({
    ...track,
    clips: track.clips.flatMap((clip) => {
      const localTime = time - clip.start
      if (!targets.has(clip.id) || localTime <= 0.05 || localTime >= clip.duration - 0.05) return [clip]
      const rightId = crypto.randomUUID()
      rightClipIds.push(rightId)
      const leftAutomation = sliceClipAutomation(clip, 0, localTime)
      const rightAutomation = sliceClipAutomation(clip, localTime, clip.duration)
      return [
        {
          ...clip,
          duration: localTime,
          ...sliceClipSpeed(clip, 0, localTime),
          ...leftAutomation,
          captionWords: sliceCaptionWords(clip.captionWords, 0, localTime),
          transitionOut: undefined,
          audioAdjustment: resetCutFade(clip.audioAdjustment, leftAutomation.audioAdjustment, 'out'),
          adrCompRanges: sliceAbsoluteRanges(clip.adrCompRanges, clip.start, time),
        },
        {
          ...clip,
          id: rightId,
          name: `${clip.name} · B`,
          start: time,
          duration: clip.duration - localTime,
          groupId: remap(clip.groupId, remappedGroups),
          linkGroupId: remap(clip.linkGroupId, remappedLinks),
          ...sliceClipSpeed(clip, localTime, clip.duration),
          ...rightAutomation,
          captionWords: sliceCaptionWords(clip.captionWords, localTime, clip.duration),
          transitionIn: undefined,
          audioAdjustment: resetCutFade(clip.audioAdjustment, rightAutomation.audioAdjustment, 'in'),
          adrCompRanges: sliceAbsoluteRanges(clip.adrCompRanges, time, clip.start + clip.duration),
        },
      ]
    }),
  }))
  return { tracks: nextTracks, rightClipIds }
}

export function removeMarkerRange(markers: TimelineMarker[], start: number, end: number): TimelineMarker[] {
  return rippleDeleteMarkers(markers, start, end)
}

export function removeTranscriptRange(segments: TranscriptSegment[], start: number, end: number): TranscriptSegment[] {
  return rippleDeleteTranscript(segments, start, end)
}

function removeRangeFromClip(clip: TimelineClip, start: number, end: number, removedDuration: number, remappedGroups: Map<string, string>, remappedLinks: Map<string, string>): TimelineClip[] {
  const clipEnd = clip.start + clip.duration
  if (clipEnd <= start) return [clip]
  const rightGroupId = clip.groupId ? remappedGroups.get(clip.groupId) ?? clip.groupId : undefined
  const rightLinkGroupId = clip.linkGroupId ? remappedLinks.get(clip.linkGroupId) ?? clip.linkGroupId : undefined
  const shiftedCompRanges = deleteAbsoluteRanges(clip.adrCompRanges, start, end, removedDuration)
  if (clip.start >= end) return [{ ...clip, start: clip.start - removedDuration, groupId: rightGroupId, linkGroupId: rightLinkGroupId, adrCompRanges: shiftedCompRanges }]

  if (clip.start < start && clipEnd > end) {
    const leftDuration = start - clip.start
    const rightDuration = clipEnd - end
    const leftAutomation = sliceClipAutomation(clip, 0, leftDuration)
    const rightAutomation = sliceClipAutomation(clip, end - clip.start, clip.duration)
    return [
      {
        ...clip,
        duration: leftDuration,
        ...sliceClipSpeed(clip, 0, leftDuration),
        ...leftAutomation,
        captionWords: sliceCaptionWords(clip.captionWords, 0, leftDuration),
        transitionOut: undefined,
        audioAdjustment: resetCutFade(clip.audioAdjustment, leftAutomation.audioAdjustment, 'out'),
        adrCompRanges: sliceAbsoluteRanges(shiftedCompRanges, clip.start, start),
      },
      {
        ...clip,
        id: crypto.randomUUID(),
        name: `${clip.name} · 이어짐`,
        start,
        duration: rightDuration,
        groupId: rightGroupId,
        linkGroupId: rightLinkGroupId,
        ...sliceClipSpeed(clip, end - clip.start, clip.duration),
        ...rightAutomation,
        captionWords: sliceCaptionWords(clip.captionWords, end - clip.start, clip.duration),
        transitionIn: undefined,
        audioAdjustment: resetCutFade(clip.audioAdjustment, rightAutomation.audioAdjustment, 'in'),
        adrCompRanges: sliceAbsoluteRanges(shiftedCompRanges, start, start + rightDuration),
      },
    ]
  }

  if (clip.start < start && clipEnd > start) {
    const duration = start - clip.start
    if (duration <= 0.05) return []
    const automation = sliceClipAutomation(clip, 0, duration)
    return [{
      ...clip,
      duration,
      ...sliceClipSpeed(clip, 0, duration),
      ...automation,
      captionWords: sliceCaptionWords(clip.captionWords, 0, duration),
      transitionOut: undefined,
      audioAdjustment: resetCutFade(clip.audioAdjustment, automation.audioAdjustment, 'out'),
      adrCompRanges: sliceAbsoluteRanges(shiftedCompRanges, clip.start, start),
    }]
  }

  if (clip.start < end && clipEnd > end) {
    const duration = clipEnd - end
    if (duration <= 0.05) return []
    const automation = sliceClipAutomation(clip, end - clip.start, clip.duration)
    return [{
      ...clip,
      start,
      duration,
      groupId: rightGroupId,
      linkGroupId: rightLinkGroupId,
      ...sliceClipSpeed(clip, end - clip.start, clip.duration),
      ...automation,
      captionWords: sliceCaptionWords(clip.captionWords, end - clip.start, clip.duration),
      transitionIn: undefined,
      audioAdjustment: resetCutFade(clip.audioAdjustment, automation.audioAdjustment, 'in'),
      adrCompRanges: sliceAbsoluteRanges(shiftedCompRanges, start, start + duration),
    }]
  }

  return []
}

function rippleDeleteTrackMix(track: TimelineTrack, start: number, end: number): TimelineTrack['mixKeyframes'] {
  if (!track.mixKeyframes?.length) return track.mixKeyframes
  const duration = end - start
  if (duration <= 0 || !track.mixKeyframes.some((keyframe) => keyframe.time >= start)) return track.mixKeyframes
  const leftTime = Math.max(0, start - 1 / 240)
  const leftValue = resolveTrackAudioMix(track, leftTime)
  const rightValue = resolveTrackAudioMix(track, end)
  const nextAtStart = [...track.mixKeyframes].sort((left, right) => left.time - right.time).find((keyframe) => keyframe.time >= start)
  const retained = track.mixKeyframes.flatMap((keyframe) => {
    if (keyframe.time < start) return Math.abs(keyframe.time - leftTime) < 1 / 240 ? [] : [keyframe]
    if (keyframe.time < end) return []
    const shifted = { ...keyframe, time: keyframe.time - duration }
    return Math.abs(shifted.time - start) < 1 / 240 ? [] : [shifted]
  })
  const boundaries: NonNullable<TimelineTrack['mixKeyframes']> = [
    ...(leftTime < start - 1 / 1000 ? [{ id: crypto.randomUUID(), time: leftTime, volume: leftValue.volume, pan: leftValue.pan, easing: nextAtStart?.easing ?? 'linear' }] : []),
    { id: crypto.randomUUID(), time: start, volume: rightValue.volume, pan: rightValue.pan, easing: 'linear' as const },
  ]
  return [...retained, ...boundaries].sort((left, right) => left.time - right.time)
}

function resetCutFade(base: TimelineClip['audioAdjustment'], sampled: TimelineClip['audioAdjustment'], edge: 'in' | 'out'): TimelineClip['audioAdjustment'] {
  return mergeAudioAdjustment(base, sampled, edge === 'in' ? { fadeIn: 0 } : { fadeOut: 0 })
}

function mergeAudioAdjustment(base: TimelineClip['audioAdjustment'], sampled: TimelineClip['audioAdjustment'], patch: Partial<NonNullable<TimelineClip['audioAdjustment']>>): TimelineClip['audioAdjustment'] {
  if (!base && !sampled) return undefined
  return { ...defaultAudioAdjustment(), ...base, ...sampled, ...patch }
}

function deleteAbsoluteRanges(ranges: TimelineClip['adrCompRanges'], start: number, end: number, duration: number): TimelineClip['adrCompRanges'] {
  return ranges?.flatMap((range) => {
    if (range.end <= start) return [range]
    if (range.start >= end) return [{ ...range, start: range.start - duration, end: range.end - duration }]
    if (range.start < start && range.end > end) return [{ ...range, end: range.end - duration }]
    if (range.start < start && range.end > start) return [{ ...range, end: start }]
    if (range.start < end && range.end > end) return [{ ...range, start, end: range.end - duration }]
    return []
  })
}

function sliceAbsoluteRanges(ranges: TimelineClip['adrCompRanges'], start: number, end: number): TimelineClip['adrCompRanges'] {
  return ranges?.flatMap((range) => {
    const rangeStart = Math.max(start, range.start)
    const rangeEnd = Math.min(end, range.end)
    return rangeEnd > rangeStart ? [{ ...range, start: rangeStart, end: rangeEnd }] : []
  })
}

function removeTrackRange(clips: TimelineClip[], start: number, end: number): TimelineClip[] {
  const remappedGroups = new Map<string, string>()
  const remappedLinks = new Map<string, string>()
  clips.forEach((clip) => {
    if (clip.start >= start || clip.start + clip.duration <= end) return
    if (clip.groupId && !remappedGroups.has(clip.groupId)) remappedGroups.set(clip.groupId, crypto.randomUUID())
    if (clip.linkGroupId && !remappedLinks.has(clip.linkGroupId)) remappedLinks.set(clip.linkGroupId, crypto.randomUUID())
  })
  return clips.flatMap((clip) => {
    const clipEnd = clip.start + clip.duration
    const rightGroupId = clip.groupId ? remappedGroups.get(clip.groupId) ?? clip.groupId : undefined
    const rightLinkGroupId = clip.linkGroupId ? remappedLinks.get(clip.linkGroupId) ?? clip.linkGroupId : undefined
    if (clipEnd <= start) return [clip]
    if (clip.start >= end) return [{ ...clip, groupId: rightGroupId, linkGroupId: rightLinkGroupId }]
    if (clip.start < start && clipEnd > end) {
      const leftDuration = start - clip.start
      const rightOffset = end - clip.start
      const leftAutomation = sliceClipAutomation(clip, 0, leftDuration)
      const rightAutomation = sliceClipAutomation(clip, rightOffset, clip.duration)
      return [
        {
          ...clip,
          duration: leftDuration,
          ...sliceClipSpeed(clip, 0, leftDuration),
          ...leftAutomation,
          captionWords: sliceCaptionWords(clip.captionWords, 0, leftDuration),
          transitionOut: undefined,
          audioAdjustment: resetCutFade(clip.audioAdjustment, leftAutomation.audioAdjustment, 'out'),
          adrCompRanges: sliceAbsoluteRanges(clip.adrCompRanges, clip.start, start),
        },
        {
          ...clip,
          id: crypto.randomUUID(),
          name: `${clip.name} · 이어짐`,
          start: end,
          duration: clipEnd - end,
          groupId: rightGroupId,
          linkGroupId: rightLinkGroupId,
          ...sliceClipSpeed(clip, rightOffset, clip.duration),
          ...rightAutomation,
          captionWords: sliceCaptionWords(clip.captionWords, rightOffset, clip.duration),
          transitionIn: undefined,
          audioAdjustment: resetCutFade(clip.audioAdjustment, rightAutomation.audioAdjustment, 'in'),
          adrCompRanges: sliceAbsoluteRanges(clip.adrCompRanges, end, clipEnd),
        },
      ]
    }
    if (clip.start < start) {
      const duration = start - clip.start
      const automation = sliceClipAutomation(clip, 0, duration)
      return [{ ...clip, duration, ...sliceClipSpeed(clip, 0, duration), ...automation, captionWords: sliceCaptionWords(clip.captionWords, 0, duration), transitionOut: undefined, audioAdjustment: resetCutFade(clip.audioAdjustment, automation.audioAdjustment, 'out'), adrCompRanges: sliceAbsoluteRanges(clip.adrCompRanges, clip.start, start) }]
    }
    if (clipEnd > end) {
      const duration = clipEnd - end
      const offset = end - clip.start
      const automation = sliceClipAutomation(clip, offset, clip.duration)
      return [{ ...clip, start: end, duration, groupId: rightGroupId, linkGroupId: rightLinkGroupId, ...sliceClipSpeed(clip, offset, clip.duration), ...automation, captionWords: sliceCaptionWords(clip.captionWords, offset, clip.duration), transitionIn: undefined, audioAdjustment: resetCutFade(clip.audioAdjustment, automation.audioAdjustment, 'in'), adrCompRanges: sliceAbsoluteRanges(clip.adrCompRanges, end, clipEnd) }]
    }
    return []
  }).sort((left, right) => left.start - right.start)
}
