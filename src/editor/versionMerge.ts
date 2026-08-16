import { getProjectSequences } from './project'
import type { AdrCue, AudioBusMap, CreatorLearningProfile, CutlineProjectDocument, EditSuggestion, PersistedMediaAsset, ProjectMergeConflictKind, ProjectMergeConflictRecord, ProjectMergeSession, ProjectSequence, SpeakerVoiceProfile, TimelineClip, TimelineMarker, TimelineTrack, TranscriptSegment } from './types'

export interface SequenceVersionDiff {
  id: string
  name: string
  status: 'added' | 'removed' | 'changed' | 'unchanged'
  currentClips: number
  snapshotClips: number
}

export interface ProjectVersionDiff {
  assetsAdded: number
  assetsRemoved: number
  sequencesAdded: number
  sequencesRemoved: number
  sequencesChanged: number
  commentsChanged: number
  mergeDecisionsChanged: number
  sequenceDiffs: SequenceVersionDiff[]
}

export interface ProjectMergeConflict {
  kind: ProjectMergeConflictKind
  sequenceId?: string
  trackId?: string
  entityId: string
  label: string
  detail: string
  markerId?: string
}

export interface ProjectMergeResult {
  project: CutlineProjectDocument
  mergedSequences: number
  autoMergedClips: number
  conflicts: ProjectMergeConflict[]
  conflictBranchIds: string[]
  mergeSessionId?: string
}

interface SequenceBranchResult {
  project: CutlineProjectDocument
  sequenceIds: Map<string, string>
  trackIds: Map<string, string>
  clipIds: Map<string, string>
}

const countClips = (sequence?: ProjectSequence) => sequence?.tracks.reduce((total, track) => total + track.clips.length, 0) ?? 0
const sequenceContent = (sequence: ProjectSequence) => JSON.stringify({
  name: sequence.name, kind: sequence.kind, sourceSequenceId: sequence.sourceSequenceId, sourceRange: sequence.sourceRange,
  aspectRatio: sequence.aspectRatio, width: sequence.width, height: sequence.height, fps: sequence.fps, timecodeStart: sequence.timecodeStart, timecodeDropFrame: sequence.timecodeDropFrame,
  tracks: sequence.tracks, transcript: sequence.transcript, suggestions: sequence.suggestions, markers: sequence.markers, audioBuses: sequence.audioBuses,
})

export function compareProjectVersions(current: CutlineProjectDocument, snapshot: CutlineProjectDocument): ProjectVersionDiff {
  const currentAssets = new Set(current.assets.map((asset) => asset.id))
  const snapshotAssets = new Set(snapshot.assets.map((asset) => asset.id))
  const currentSequences = new Map(getProjectSequences(current).map((sequence) => [sequence.id, sequence]))
  const snapshotSequences = new Map(getProjectSequences(snapshot).map((sequence) => [sequence.id, sequence]))
  const ids = new Set([...currentSequences.keys(), ...snapshotSequences.keys()])
  const sequenceDiffs = [...ids].map((id): SequenceVersionDiff => {
    const currentSequence = currentSequences.get(id)
    const snapshotSequence = snapshotSequences.get(id)
    const status = !currentSequence ? 'added' : !snapshotSequence ? 'removed' : sequenceContent(currentSequence) === sequenceContent(snapshotSequence) ? 'unchanged' : 'changed'
    return { id, name: snapshotSequence?.name ?? currentSequence?.name ?? id, status, currentClips: countClips(currentSequence), snapshotClips: countClips(snapshotSequence) }
  }).sort((left, right) => left.name.localeCompare(right.name, 'ko'))
  const comments = (document: CutlineProjectDocument) => new Map(getProjectSequences(document).flatMap((sequence) => sequence.markers ?? []).filter((marker) => marker.kind === 'comment').map((marker) => [marker.id, `${marker.time}|${marker.status}|${marker.label}|${marker.updatedAt ?? marker.createdAt ?? ''}`]))
  const currentComments = comments(current)
  const snapshotComments = comments(snapshot)
  const mergeDecisions = (document: CutlineProjectDocument) => new Map((document.mergeSessions ?? []).flatMap((session) => session.conflicts.map((conflict) => [`${session.id}:${conflict.id}`, `${conflict.status}|${conflict.resolution ?? ''}|${conflict.resolvedAt ?? ''}`])))
  const currentMergeDecisions = mergeDecisions(current)
  const snapshotMergeDecisions = mergeDecisions(snapshot)
  return {
    assetsAdded: [...snapshotAssets].filter((id) => !currentAssets.has(id)).length,
    assetsRemoved: [...currentAssets].filter((id) => !snapshotAssets.has(id)).length,
    sequencesAdded: sequenceDiffs.filter((item) => item.status === 'added').length,
    sequencesRemoved: sequenceDiffs.filter((item) => item.status === 'removed').length,
    sequencesChanged: sequenceDiffs.filter((item) => item.status === 'changed').length,
    commentsChanged: [...new Set([...currentComments.keys(), ...snapshotComments.keys()])].filter((id) => currentComments.get(id) !== snapshotComments.get(id)).length,
    mergeDecisionsChanged: [...new Set([...currentMergeDecisions.keys(), ...snapshotMergeDecisions.keys()])].filter((id) => currentMergeDecisions.get(id) !== snapshotMergeDecisions.get(id)).length,
    sequenceDiffs,
  }
}

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

type MergeDecision<T> = { value: T | undefined; source: 'same' | 'current' | 'incoming' | 'deleted' | 'conflict' }

function stableValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value)
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`).join(',')}}`
}

function sameValue(left: unknown, right: unknown): boolean {
  return stableValue(left) === stableValue(right)
}

function threeWayValue<T>(base: T | undefined, current: T | undefined, incoming: T | undefined): MergeDecision<T> {
  if (sameValue(current, incoming)) return { value: current, source: 'same' }
  if (sameValue(current, base)) return { value: incoming, source: incoming === undefined ? 'deleted' : 'incoming' }
  if (sameValue(incoming, base)) return { value: current, source: current === undefined ? 'deleted' : 'current' }
  return { value: current, source: 'conflict' }
}

function byId<T extends { id: string }>(items: T[] | undefined): Map<string, T> {
  return new Map((items ?? []).map((item) => [item.id, item]))
}

function replaceEntity<T extends { id: string }>(items: T[] | undefined, entityId: string, snapshot: T | undefined): T[] {
  const source = items ?? []
  if (!snapshot) return source.filter((item) => item.id !== entityId)
  const found = source.some((item) => item.id === entityId)
  return found ? source.map((item) => item.id === entityId ? snapshot : item) : [...source, snapshot]
}

function hasStringId(value: unknown): value is { id: string } {
  return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string'
}

function isMergeSessionSnapshot(value: unknown): value is ProjectMergeSession {
  if (!hasStringId(value)) return false
  const candidate = value as Partial<ProjectMergeSession>
  return typeof candidate.baseUpdatedAt === 'string'
    && typeof candidate.incomingUpdatedAt === 'string'
    && typeof candidate.incomingProjectName === 'string'
    && Array.isArray(candidate.conflicts)
}

function isPersistedMediaAssetSnapshot(value: unknown): value is PersistedMediaAsset {
  if (!hasStringId(value)) return false
  const candidate = value as Partial<PersistedMediaAsset>
  return typeof candidate.name === 'string'
    && (candidate.kind === 'video' || candidate.kind === 'audio' || candidate.kind === 'image')
    && typeof candidate.duration === 'number'
    && Number.isFinite(candidate.duration)
    && typeof candidate.size === 'number'
    && Number.isFinite(candidate.size)
    && typeof candidate.extension === 'string'
    && (candidate.status === 'ready' || candidate.status === 'offline' || candidate.status === 'error')
}

function assertUniqueIds<T extends { id: string }>(items: T[] | undefined, label: string): void {
  const seen = new Set<string>()
  for (const item of items ?? []) {
    if (!item.id || seen.has(item.id)) throw new Error(`${label}에 비어 있거나 중복된 ID가 있어 안전하게 병합할 수 없습니다.`)
    seen.add(item.id)
  }
}

function validateMergeDocument(project: CutlineProjectDocument, label: string): void {
  assertUniqueIds(project.assets, `${label} 미디어`)
  assertUniqueIds(project.adrCues, `${label} ADR 큐`)
  assertUniqueIds(project.mergeSessions, `${label} 병합 세션`)
  for (const session of project.mergeSessions ?? []) assertUniqueIds(session.conflicts, `${label} 병합 세션 충돌`)
  const sequences = getProjectSequences(project)
  assertUniqueIds(sequences, `${label} 시퀀스`)
  const sequenceIds = new Set(sequences.map((sequence) => sequence.id))
  for (const sequence of sequences) {
    assertUniqueIds(sequence.tracks, `${label} “${sequence.name}” 트랙`)
    assertUniqueIds(sequence.transcript, `${label} “${sequence.name}” 대본`)
    assertUniqueIds(sequence.suggestions, `${label} “${sequence.name}” 제안`)
    assertUniqueIds(sequence.markers, `${label} “${sequence.name}” 마커`)
    const trackIds = new Set(sequence.tracks.map((track) => track.id))
    const clips = sequence.tracks.flatMap((track) => track.clips)
    assertUniqueIds(clips, `${label} “${sequence.name}” 클립`)
    const orphan = clips.find((clip) => !trackIds.has(clip.trackId))
    if (orphan) throw new Error(`${label} “${sequence.name}”의 클립 “${orphan.name}”이 존재하지 않는 트랙을 참조합니다.`)
  }
  const allTakes = (project.adrCues ?? []).flatMap((cue) => cue.takes)
  assertUniqueIds(allTakes, `${label} ADR 테이크`)
  for (const cue of project.adrCues ?? []) {
    if (!sequenceIds.has(cue.sequenceId)) throw new Error(`${label} ADR 큐 “${cue.text || cue.id}”가 존재하지 않는 시퀀스를 참조합니다.`)
    assertUniqueIds(cue.compSegments, `${label} ADR 큐 “${cue.text || cue.id}” 컴프 구간`)
    const takeIds = new Set(cue.takes.map((take) => take.id))
    if (cue.selectedTakeId && !takeIds.has(cue.selectedTakeId)) throw new Error(`${label} ADR 큐 “${cue.text || cue.id}”의 선택 테이크 참조가 손상됐습니다.`)
    const orphanComp = cue.compSegments?.find((segment) => !takeIds.has(segment.takeId))
    if (orphanComp) throw new Error(`${label} ADR 큐 “${cue.text || cue.id}”의 컴프 구간이 존재하지 않는 테이크를 참조합니다.`)
  }
}

function mergeEntityList<T extends { id: string }>(options: {
  base: T[] | undefined
  current: T[] | undefined
  incoming: T[] | undefined
  kind: ProjectMergeConflict['kind']
  sequenceId?: string
  label: (item: T | undefined, id: string) => string
  conflicts: ProjectMergeConflict[]
}): T[] {
  const base = byId(options.base)
  const current = byId(options.current)
  const incoming = byId(options.incoming)
  const order = [...current.keys(), ...[...incoming.keys()].filter((id) => !current.has(id))]
  return order.flatMap((id) => {
    const decision = threeWayValue(base.get(id), current.get(id), incoming.get(id))
    if (decision.source === 'conflict') options.conflicts.push({
      kind: options.kind,
      sequenceId: options.sequenceId,
      entityId: id,
      label: options.label(current.get(id) ?? incoming.get(id) ?? base.get(id), id),
      detail: '공통 기준 이후 양쪽에서 서로 다르게 수정되어 현재 편집본을 유지했습니다. 상대 편집본은 충돌 분기에 보존됩니다.',
    })
    return decision.value ? [decision.value] : []
  })
}

function trackMetadata(track: TimelineTrack): Omit<TimelineTrack, 'clips'> {
  const { clips: _clips, ...metadata } = track
  return metadata
}

function mergeSequenceTracks(baseSequence: ProjectSequence, currentSequence: ProjectSequence, incomingSequence: ProjectSequence, conflicts: ProjectMergeConflict[]): { tracks: TimelineTrack[]; autoMergedClips: number } {
  const baseTracks = byId(baseSequence.tracks)
  const currentTracks = byId(currentSequence.tracks)
  const incomingTracks = byId(incomingSequence.tracks)
  const trackOrder = [...currentTracks.keys(), ...[...incomingTracks.keys()].filter((id) => !currentTracks.has(id))]
  const mergedTrackMetadata = new Map<string, Omit<TimelineTrack, 'clips'>>()

  for (const trackId of trackOrder) {
    const base = baseTracks.get(trackId)
    const current = currentTracks.get(trackId)
    const incoming = incomingTracks.get(trackId)
    const decision = threeWayValue(base && trackMetadata(base), current && trackMetadata(current), incoming && trackMetadata(incoming))
    if (decision.source === 'conflict') conflicts.push({
      kind: 'track', sequenceId: currentSequence.id, trackId, entityId: trackId,
      label: current?.name ?? incoming?.name ?? base?.name ?? trackId,
      detail: '트랙 이름·잠금·음량·가시성 설정이 양쪽에서 달라 현재 설정을 유지했습니다. 상대 설정은 충돌 분기에 보존됩니다.',
    })
    if (decision.value) mergedTrackMetadata.set(trackId, decision.value)
  }

  const flatten = (sequence: ProjectSequence) => byId(sequence.tracks.flatMap((track) => track.clips))
  const baseClips = flatten(baseSequence)
  const currentClips = flatten(currentSequence)
  const incomingClips = flatten(incomingSequence)
  const clipOrder = [...currentClips.keys(), ...[...incomingClips.keys()].filter((id) => !currentClips.has(id))]
  const mergedClips: TimelineClip[] = []
  let autoMergedClips = 0
  for (const clipId of clipOrder) {
    const decision = threeWayValue(baseClips.get(clipId), currentClips.get(clipId), incomingClips.get(clipId))
    if (decision.source === 'incoming') autoMergedClips++
    if (decision.source === 'conflict') conflicts.push({
      kind: 'clip', sequenceId: currentSequence.id,
      trackId: currentClips.get(clipId)?.trackId ?? incomingClips.get(clipId)?.trackId,
      entityId: clipId,
      label: currentClips.get(clipId)?.name ?? incomingClips.get(clipId)?.name ?? baseClips.get(clipId)?.name ?? clipId,
      detail: '같은 클립이 양쪽에서 이동·트림·효과 또는 속도 설정이 다르게 변경되어 현재 클립을 유지했습니다. 상대 클립은 충돌 분기에 보존됩니다.',
    })
    if (decision.value) mergedClips.push(decision.value)
  }

  for (const clip of mergedClips) {
    if (mergedTrackMetadata.has(clip.trackId)) continue
    const sourceTrack = currentTracks.get(clip.trackId) ?? incomingTracks.get(clip.trackId) ?? baseTracks.get(clip.trackId)
    if (sourceTrack) mergedTrackMetadata.set(sourceTrack.id, trackMetadata(sourceTrack))
    else conflicts.push({ kind: 'clip', sequenceId: currentSequence.id, trackId: clip.trackId, entityId: clip.id, label: clip.name, detail: '클립의 대상 트랙을 찾지 못해 충돌 분기에서 확인해야 합니다.' })
  }

  const finalTrackOrder = [...trackOrder, ...mergedTrackMetadata.keys()].filter((id, index, items) => mergedTrackMetadata.has(id) && items.indexOf(id) === index)
  return {
    tracks: finalTrackOrder.map((trackId) => ({
      ...mergedTrackMetadata.get(trackId)!,
      clips: mergedClips.filter((clip) => clip.trackId === trackId).sort((left, right) => left.start - right.start || left.id.localeCompare(right.id)),
    })),
    autoMergedClips,
  }
}

function sequenceMetadata(sequence: ProjectSequence): Omit<ProjectSequence, 'tracks' | 'transcript' | 'suggestions' | 'markers' | 'audioBuses'> {
  const { tracks: _tracks, transcript: _transcript, suggestions: _suggestions, markers: _markers, audioBuses: _audioBuses, ...metadata } = sequence
  return metadata
}

function conflictSnapshot(project: CutlineProjectDocument, kind: ProjectMergeConflictKind, sequenceId: string | undefined, entityId: string): unknown {
  const sequence = sequenceId ? getProjectSequences(project).find((candidate) => candidate.id === sequenceId) : undefined
  if (kind === 'sequence') return sequence ? sequenceMetadata(sequence) : undefined
  if (kind === 'track') {
    const track = sequence?.tracks.find((candidate) => candidate.id === entityId)
    return track ? trackMetadata(track) : undefined
  }
  if (kind === 'clip') return sequence?.tracks.flatMap((track) => track.clips).find((clip) => clip.id === entityId)
  if (kind === 'transcript') return sequence?.transcript.find((item) => item.id === entityId)
  if (kind === 'suggestion') return sequence?.suggestions.find((item) => item.id === entityId)
  if (kind === 'marker') return sequence?.markers?.find((item) => item.id === entityId)
  if (kind === 'audio-bus') return sequence?.audioBuses
  if (kind === 'asset') return project.assets.find((item) => item.id === entityId)
  if (kind === 'adr-cue') return project.adrCues?.find((item) => item.id === entityId)
  if (kind === 'dictionary') {
    if (entityId === 'creator-learning-profile') return project.creatorLearningProfile
    if (entityId === 'speaker-voice-profiles') return project.speakerVoiceProfiles
    const priorSession = project.mergeSessions?.find((item) => item.id === entityId)
    return priorSession ?? project.correctionDictionary?.[entityId]
  }
  return undefined
}

function mergeChangedSequence(base: ProjectSequence, current: ProjectSequence, incoming: ProjectSequence, conflicts: ProjectMergeConflict[]): { sequence: ProjectSequence; autoMergedClips: number } {
  const metadata = threeWayValue(sequenceMetadata(base), sequenceMetadata(current), sequenceMetadata(incoming))
  if (metadata.source === 'conflict') conflicts.push({
    kind: 'sequence', sequenceId: current.id, entityId: current.id, label: current.name,
    detail: '시퀀스 이름·규격·원본 연결 정보가 양쪽에서 달라 현재 설정을 유지했습니다. 상대 설정은 충돌 분기에 보존됩니다.',
  })
  const mergedTracks = mergeSequenceTracks(base, current, incoming, conflicts)
  const transcript = mergeEntityList<TranscriptSegment>({ base: base.transcript, current: current.transcript, incoming: incoming.transcript, kind: 'transcript', sequenceId: current.id, label: (item, id) => item?.text ?? id, conflicts })
  const suggestions = mergeEntityList<EditSuggestion>({ base: base.suggestions, current: current.suggestions, incoming: incoming.suggestions, kind: 'suggestion', sequenceId: current.id, label: (item, id) => item?.label ?? id, conflicts })
  const markers = mergeEntityList<TimelineMarker>({ base: base.markers, current: current.markers, incoming: incoming.markers, kind: 'marker', sequenceId: current.id, label: (item, id) => item?.label ?? id, conflicts })
  const audioBuses = threeWayValue(base.audioBuses, current.audioBuses, incoming.audioBuses)
  if (audioBuses.source === 'conflict') conflicts.push({ kind: 'audio-bus', sequenceId: current.id, entityId: current.id, label: current.name, detail: '오디오 버스 설정이 양쪽에서 달라 현재 설정을 유지했습니다. 상대 설정은 충돌 분기에 보존됩니다.' })
  return {
    sequence: {
      ...(metadata.value ?? sequenceMetadata(current)),
      tracks: mergedTracks.tracks,
      transcript,
      suggestions,
      markers,
      audioBuses: audioBuses.value,
    },
    autoMergedClips: mergedTracks.autoMergedClips,
  }
}

function synchronizeActiveSequence(project: CutlineProjectDocument, activeSequenceId: string): CutlineProjectDocument {
  const sequences = getProjectSequences(project)
  const active = sequences.find((sequence) => sequence.id === activeSequenceId) ?? sequences[0]
  if (!active) throw new Error('병합 결과에 활성 시퀀스가 없습니다.')
  return {
    ...project,
    activeSequenceId: active.id,
    sequences,
    tracks: active.tracks,
    transcript: active.transcript,
    suggestions: active.suggestions,
    markers: active.markers ?? [],
    audioBuses: active.audioBuses,
    sequence: { id: active.id, name: active.name, aspectRatio: active.aspectRatio, width: active.width, height: active.height, fps: active.fps, timecodeStart: active.timecodeStart, timecodeDropFrame: active.timecodeDropFrame },
  }
}

function addConflictReviewMarkers(project: CutlineProjectDocument, incoming: CutlineProjectDocument, conflicts: ProjectMergeConflict[]): CutlineProjectDocument {
  const incomingSequences = new Map(getProjectSequences(incoming).map((sequence) => [sequence.id, sequence]))
  const marked = getProjectSequences(project).map((sequence) => {
    const clipConflicts = conflicts.filter((conflict) => conflict.kind === 'clip' && conflict.sequenceId === sequence.id)
    if (!clipConflicts.length) return sequence
    const currentClips = byId(sequence.tracks.flatMap((track) => track.clips))
    const incomingClips = byId(incomingSequences.get(sequence.id)?.tracks.flatMap((track) => track.clips))
    const createdAt = new Date().toISOString()
    const markers = clipConflicts.map((conflict): TimelineMarker => {
      const markerId = newId('merge-conflict')
      conflict.markerId = markerId
      return {
        id: markerId,
        time: currentClips.get(conflict.entityId)?.start ?? incomingClips.get(conflict.entityId)?.start ?? 0,
        label: `공동 작업 충돌 · ${conflict.label} · 상대 분기 확인`,
        color: '#ff9366',
        kind: 'comment',
        status: 'open',
        author: 'Cutline 병합',
        createdAt,
        updatedAt: createdAt,
      }
    })
    return { ...sequence, markers: [...(sequence.markers ?? []), ...markers].sort((left, right) => left.time - right.time) }
  })
  return { ...project, sequences: marked }
}

/**
 * Merges two descendants of the same saved project. Non-overlapping entity edits are
 * applied automatically. Ambiguous edits never overwrite current work; the full
 * incoming sequence is copied to a new-ID conflict branch for manual comparison.
 */
export function mergeProjectVersions(base: CutlineProjectDocument, current: CutlineProjectDocument, incoming: CutlineProjectDocument): ProjectMergeResult {
  validateMergeDocument(base, '공통 기준')
  validateMergeDocument(current, '현재 프로젝트')
  validateMergeDocument(incoming, '상대 프로젝트')
  if (base.id !== current.id || incoming.id !== current.id) throw new Error('공통 기준·현재 작업·상대 작업의 프로젝트 ID가 같아야 병합할 수 있습니다.')
  const conflicts: ProjectMergeConflict[] = []
  const baseSequences = new Map(getProjectSequences(base).map((sequence) => [sequence.id, sequence]))
  const currentSequences = new Map(getProjectSequences(current).map((sequence) => [sequence.id, sequence]))
  const incomingSequences = new Map(getProjectSequences(incoming).map((sequence) => [sequence.id, sequence]))
  const sequenceOrder = [...currentSequences.keys(), ...[...incomingSequences.keys()].filter((id) => !currentSequences.has(id))]
  const mergedSequences: ProjectSequence[] = []
  let autoMergedClips = 0
  let changedSequences = 0

  for (const sequenceId of sequenceOrder) {
    const baseSequence = baseSequences.get(sequenceId)
    const currentSequence = currentSequences.get(sequenceId)
    const incomingSequence = incomingSequences.get(sequenceId)
    const whole = threeWayValue(baseSequence, currentSequence, incomingSequence)
    if (whole.source !== 'conflict') {
      if (whole.value) mergedSequences.push(whole.value)
      if (whole.source === 'incoming') {
        changedSequences++
        autoMergedClips += countClips(whole.value)
      }
      continue
    }
    if (!baseSequence || !currentSequence || !incomingSequence) {
      conflicts.push({ kind: 'sequence', sequenceId, entityId: sequenceId, label: currentSequence?.name ?? incomingSequence?.name ?? sequenceId, detail: '시퀀스 추가·삭제가 양쪽에서 다른 변경과 겹쳐 현재 상태를 유지했습니다. 상대 상태는 충돌 분기에 보존됩니다.' })
      if (currentSequence) mergedSequences.push(currentSequence)
      continue
    }
    const conflictCount = conflicts.length
    const merged = mergeChangedSequence(baseSequence, currentSequence, incomingSequence, conflicts)
    mergedSequences.push(merged.sequence)
    autoMergedClips += merged.autoMergedClips
    if (!sameValue(currentSequence, merged.sequence)) changedSequences++
    if (conflicts.length === conflictCount && sameValue(currentSequence, merged.sequence)) {
      conflicts.push({ kind: 'sequence', sequenceId, entityId: sequenceId, label: currentSequence.name, detail: '시퀀스 변경을 자동 분해하지 못해 현재 상태를 유지했습니다. 상대 상태는 충돌 분기에 보존됩니다.' })
    }
  }

  const assets = mergeEntityList<PersistedMediaAsset>({ base: base.assets, current: current.assets, incoming: incoming.assets, kind: 'asset', label: (item, id) => item?.name ?? id, conflicts })
  const adrCues = mergeEntityList<AdrCue>({ base: base.adrCues, current: current.adrCues, incoming: incoming.adrCues, kind: 'adr-cue', label: (item, id) => item?.text ?? id, conflicts })
  const priorMergeSessions = mergeEntityList<ProjectMergeSession>({ base: base.mergeSessions, current: current.mergeSessions, incoming: incoming.mergeSessions, kind: 'dictionary', label: (item, id) => item?.incomingProjectName ?? id, conflicts })
  const dictionaryKeys = new Set([...Object.keys(base.correctionDictionary ?? {}), ...Object.keys(current.correctionDictionary ?? {}), ...Object.keys(incoming.correctionDictionary ?? {})])
  const correctionDictionary: Record<string, string> = {}
  for (const key of dictionaryKeys) {
    const decision = threeWayValue(base.correctionDictionary?.[key], current.correctionDictionary?.[key], incoming.correctionDictionary?.[key])
    if (decision.source === 'conflict') conflicts.push({ kind: 'dictionary', entityId: key, label: key, detail: '사용자 교정 사전 값이 양쪽에서 달라 현재 값을 유지했습니다.' })
    if (decision.value !== undefined) correctionDictionary[key] = decision.value
  }
  const learning = threeWayValue(base.creatorLearningProfile, current.creatorLearningProfile, incoming.creatorLearningProfile)
  if (learning.source === 'conflict') conflicts.push({ kind: 'dictionary', entityId: 'creator-learning-profile', label: '크리에이터 학습 프로필', detail: '채널 맞춤 학습값이 양쪽에서 달라 현재 값을 유지했습니다.' })
  const speakerProfiles = threeWayValue(base.speakerVoiceProfiles, current.speakerVoiceProfiles, incoming.speakerVoiceProfiles)
  if (speakerProfiles.source === 'conflict') conflicts.push({ kind: 'dictionary', entityId: 'speaker-voice-profiles', label: '화자 음성 프로필', detail: '장기 화자 재식별 프로필이 양쪽에서 달라 현재 값을 유지했습니다.' })
  const requestedActiveId = current.activeSequenceId ?? getProjectSequences(current)[0]?.id ?? mergedSequences[0]?.id
  if (!requestedActiveId) throw new Error('병합할 시퀀스가 없습니다.')
  let project = synchronizeActiveSequence({
    ...current,
    updatedAt: new Date().toISOString(),
    assets,
    sequences: mergedSequences,
    adrCues,
    correctionDictionary,
    creatorLearningProfile: learning.value,
    speakerVoiceProfiles: speakerProfiles.value,
    mergeSessions: priorMergeSessions,
  }, requestedActiveId)
  project = synchronizeActiveSequence(addConflictReviewMarkers(project, incoming, conflicts), project.activeSequenceId!)

  const conflictSequenceIds = [...new Set(conflicts.map((conflict) => conflict.sequenceId).filter((id): id is string => typeof id === 'string' && incomingSequences.has(id)))]
  const conflictBranchIds: string[] = []
  const branchResults = new Map<string, SequenceBranchResult>()
  const activeId = project.activeSequenceId!
  for (const sequenceId of conflictSequenceIds) {
    const branched = branchSequenceFromVersionDetailed(project, incoming, sequenceId)
    const branchId = branched.project.activeSequenceId!
    conflictBranchIds.push(branchId)
    branchResults.set(sequenceId, branched)
    project = synchronizeActiveSequence({
      ...branched.project,
      sequences: getProjectSequences(branched.project).map((sequence) => sequence.id === branchId ? { ...sequence, name: `${incomingSequences.get(sequenceId)?.name ?? sequence.name} · 병합 충돌 (상대)` } : sequence),
    }, activeId)
  }
  let mergeSessionId: string | undefined
  if (conflicts.length) {
    const createdAt = new Date().toISOString()
    mergeSessionId = newId('merge-session')
    const records: ProjectMergeConflictRecord[] = conflicts.map((conflict) => {
      const branch = conflict.sequenceId ? branchResults.get(conflict.sequenceId) : undefined
      const incomingSequence = conflict.sequenceId ? incomingSequences.get(conflict.sequenceId) : undefined
      const currentSequence = conflict.sequenceId ? currentSequences.get(conflict.sequenceId) : undefined
      const incomingClip = conflict.kind === 'clip' ? incomingSequence?.tracks.flatMap((track) => track.clips).find((clip) => clip.id === conflict.entityId) : undefined
      const currentTrack = conflict.kind === 'clip' ? currentSequence?.tracks.find((track) => track.clips.some((clip) => clip.id === conflict.entityId)) : undefined
      const currentClip = currentTrack?.clips.find((clip) => clip.id === conflict.entityId)
      const currentSnapshot = conflictSnapshot(current, conflict.kind, conflict.sequenceId, conflict.entityId)
      const incomingSnapshot = conflictSnapshot(incoming, conflict.kind, conflict.sequenceId, conflict.entityId)
      const branchEntityId = conflict.kind === 'clip' && conflict.sequenceId ? branch?.clipIds.get(`${conflict.sequenceId}:${conflict.entityId}`)
        : conflict.kind === 'track' && conflict.sequenceId ? branch?.trackIds.get(`${conflict.sequenceId}:${conflict.entityId}`)
          : conflict.kind === 'sequence' && conflict.sequenceId ? branch?.sequenceIds.get(conflict.sequenceId)
            : branch ? conflict.entityId : undefined
      return {
        ...conflict,
        id: newId('merge-decision'),
        branchSequenceId: conflict.sequenceId ? branch?.sequenceIds.get(conflict.sequenceId) : undefined,
        branchEntityId,
        incomingTrackId: incomingClip?.trackId,
        incomingDeleted: incomingSnapshot === undefined,
        currentTrackId: currentClip?.trackId,
        currentTrackSnapshot: currentTrack ? trackMetadata(currentTrack) : undefined,
        currentClipSnapshot: currentClip,
        currentDeleted: currentSnapshot === undefined,
        currentSnapshot,
        incomingSnapshot,
        canApplyIncoming: !(conflict.kind === 'sequence' && (currentSnapshot === undefined || incomingSnapshot === undefined)),
        status: 'open',
        createdAt,
      }
    })
    const session: ProjectMergeSession = { id: mergeSessionId, baseUpdatedAt: base.updatedAt, incomingUpdatedAt: incoming.updatedAt, incomingProjectName: incoming.name, createdAt, status: 'open', conflicts: records }
    project = { ...project, mergeSessions: [...priorMergeSessions, session].slice(-20) }
  }
  return { project, mergedSequences: changedSequences, autoMergedClips, conflicts, conflictBranchIds, mergeSessionId }
}

export function resolveProjectMergeConflict(project: CutlineProjectDocument, sessionId: string, conflictId: string, resolution: 'current' | 'incoming'): CutlineProjectDocument {
  const session = project.mergeSessions?.find((candidate) => candidate.id === sessionId)
  const conflict = session?.conflicts.find((candidate) => candidate.id === conflictId)
  if (!session || !conflict) throw new Error('해결할 공동 작업 충돌을 찾을 수 없습니다.')
  if (resolution === 'incoming' && !conflict.canApplyIncoming) throw new Error('이 충돌은 의존 항목을 자동 교체할 수 없어 상대 분기를 확인한 뒤 현재 상태로 완료해야 합니다.')

  let sequences = getProjectSequences(project)
  let assets = project.assets
  let adrCues = project.adrCues ?? []
  let correctionDictionary = { ...(project.correctionDictionary ?? {}) }
  let creatorLearningProfile = project.creatorLearningProfile
  let speakerVoiceProfiles = project.speakerVoiceProfiles
  let priorMergeSessions = project.mergeSessions ?? []
  const selectedSnapshot = resolution === 'incoming' ? conflict.incomingSnapshot : conflict.currentSnapshot
  const target = conflict.sequenceId ? sequences.find((sequence) => sequence.id === conflict.sequenceId) : undefined
  let resolvedTarget = target

  if (conflict.kind === 'clip') {
    if (!target) throw new Error('충돌이 발생한 현재 시퀀스를 찾을 수 없습니다.')
    let tracks = target.tracks.map((track) => ({ ...track, clips: track.clips.filter((clip) => clip.id !== conflict.entityId) }))
    if (resolution === 'current' && !conflict.currentDeleted) {
      if (!conflict.currentClipSnapshot || !conflict.currentTrackId) throw new Error('병합 세션에서 현재 클립의 보존 사본을 찾을 수 없습니다.')
      if (!tracks.some((track) => track.id === conflict.currentTrackId)) {
        if (!conflict.currentTrackSnapshot) throw new Error('병합 세션에서 현재 트랙의 보존 사본을 찾을 수 없습니다.')
        tracks.push({ ...conflict.currentTrackSnapshot, id: conflict.currentTrackId, clips: [] })
      }
      const restored: TimelineClip = { ...conflict.currentClipSnapshot, id: conflict.entityId, trackId: conflict.currentTrackId }
      tracks = tracks.map((track) => track.id === conflict.currentTrackId ? { ...track, clips: [...track.clips, restored].sort((left, right) => left.start - right.start || left.id.localeCompare(right.id)) } : track)
    } else if (resolution === 'incoming' && !conflict.incomingDeleted) {
      const branch = sequences.find((sequence) => sequence.id === conflict.branchSequenceId)
      const branchTrack = branch?.tracks.find((track) => track.clips.some((clip) => clip.id === conflict.branchEntityId))
      const branchClip = branchTrack?.clips.find((clip) => clip.id === conflict.branchEntityId)
      if (!branch || !branchTrack || !branchClip || !conflict.incomingTrackId) throw new Error('상대 충돌 분기에서 적용할 클립 또는 트랙을 찾을 수 없습니다.')
      const existingTargetTrack = tracks.find((track) => track.id === conflict.incomingTrackId)
      const appliedTrackId = existingTargetTrack && existingTargetTrack.kind !== branchTrack.kind ? `merge-track-${sessionId}-${conflict.incomingTrackId}` : conflict.incomingTrackId
      if (!tracks.some((track) => track.id === appliedTrackId)) {
        const { clips: _clips, ...metadata } = branchTrack
        tracks.push({ ...metadata, id: appliedTrackId, name: `${branchTrack.name} · 병합`, clips: [] })
      }
      const applied: TimelineClip = { ...branchClip, id: conflict.entityId, trackId: appliedTrackId }
      tracks = tracks.map((track) => track.id === appliedTrackId ? { ...track, clips: [...track.clips, applied].sort((left, right) => left.start - right.start || left.id.localeCompare(right.id)) } : track)
    }
    resolvedTarget = { ...target, tracks }
  } else if (conflict.kind === 'sequence') {
    if (!target) {
      if (!(resolution === 'current' && conflict.currentDeleted)) throw new Error('충돌이 발생한 현재 시퀀스를 찾을 수 없습니다.')
    } else {
      if (!selectedSnapshot || !hasStringId(selectedSnapshot)) throw new Error('병합 세션에서 적용할 시퀀스 설정 사본을 찾을 수 없습니다.')
      const metadata = selectedSnapshot as Omit<ProjectSequence, 'tracks' | 'transcript' | 'suggestions' | 'markers' | 'audioBuses'>
      resolvedTarget = {
        ...target,
        ...metadata,
        id: conflict.entityId,
        tracks: target.tracks,
        transcript: target.transcript,
        suggestions: target.suggestions,
        markers: target.markers,
        audioBuses: target.audioBuses,
      }
    }
  } else if (conflict.kind === 'track') {
    if (!target) throw new Error('충돌이 발생한 현재 시퀀스를 찾을 수 없습니다.')
    const existing = target.tracks.find((track) => track.id === conflict.entityId)
    const metadata = selectedSnapshot === undefined ? undefined : hasStringId(selectedSnapshot) ? selectedSnapshot as Omit<TimelineTrack, 'clips'> : undefined
    if (selectedSnapshot !== undefined && !metadata) throw new Error('병합 세션에서 적용할 트랙 설정 사본을 찾을 수 없습니다.')
    const replacement = metadata ? { ...metadata, id: conflict.entityId, clips: existing?.clips ?? [] } : undefined
    const tracks = replaceEntity(target.tracks, conflict.entityId, replacement)
    resolvedTarget = { ...target, tracks }
  } else if (conflict.kind === 'transcript') {
    if (!target) throw new Error('충돌이 발생한 현재 시퀀스를 찾을 수 없습니다.')
    const snapshot = selectedSnapshot === undefined ? undefined : hasStringId(selectedSnapshot) ? selectedSnapshot as TranscriptSegment : undefined
    if (selectedSnapshot !== undefined && !snapshot) throw new Error('병합 세션에서 적용할 대본 사본을 찾을 수 없습니다.')
    resolvedTarget = { ...target, transcript: replaceEntity(target.transcript, conflict.entityId, snapshot).sort((left, right) => left.start - right.start || left.id.localeCompare(right.id)) }
  } else if (conflict.kind === 'suggestion') {
    if (!target) throw new Error('충돌이 발생한 현재 시퀀스를 찾을 수 없습니다.')
    const snapshot = selectedSnapshot === undefined ? undefined : hasStringId(selectedSnapshot) ? selectedSnapshot as EditSuggestion : undefined
    if (selectedSnapshot !== undefined && !snapshot) throw new Error('병합 세션에서 적용할 편집 제안 사본을 찾을 수 없습니다.')
    resolvedTarget = { ...target, suggestions: replaceEntity(target.suggestions, conflict.entityId, snapshot).sort((left, right) => left.start - right.start || left.id.localeCompare(right.id)) }
  } else if (conflict.kind === 'marker') {
    if (!target) throw new Error('충돌이 발생한 현재 시퀀스를 찾을 수 없습니다.')
    const snapshot = selectedSnapshot === undefined ? undefined : hasStringId(selectedSnapshot) ? selectedSnapshot as TimelineMarker : undefined
    if (selectedSnapshot !== undefined && !snapshot) throw new Error('병합 세션에서 적용할 마커 사본을 찾을 수 없습니다.')
    resolvedTarget = { ...target, markers: replaceEntity(target.markers, conflict.entityId, snapshot).sort((left, right) => left.time - right.time || left.id.localeCompare(right.id)) }
  } else if (conflict.kind === 'audio-bus') {
    if (!target) throw new Error('충돌이 발생한 현재 시퀀스를 찾을 수 없습니다.')
    if (selectedSnapshot !== undefined && (typeof selectedSnapshot !== 'object' || selectedSnapshot === null)) throw new Error('병합 세션에서 적용할 오디오 버스 사본을 찾을 수 없습니다.')
    resolvedTarget = { ...target, audioBuses: selectedSnapshot as AudioBusMap | undefined }
  } else if (conflict.kind === 'adr-cue') {
    const snapshot = selectedSnapshot === undefined ? undefined : hasStringId(selectedSnapshot) ? selectedSnapshot as AdrCue : undefined
    if (selectedSnapshot !== undefined && !snapshot) throw new Error('병합 세션에서 적용할 ADR 큐 사본을 찾을 수 없습니다.')
    if (snapshot) {
      const cueSequence = sequences.find((sequence) => sequence.id === snapshot.sequenceId)
      if (!cueSequence) throw new Error('상대 ADR 큐가 존재하지 않는 시퀀스를 참조해 자동 적용할 수 없습니다.')
      const assetIds = new Set(project.assets.map((asset) => asset.id))
      const trackIds = new Set(cueSequence.tracks.map((track) => track.id))
      const clipIds = new Set(cueSequence.tracks.flatMap((track) => track.clips).map((clip) => clip.id))
      if (snapshot.takes.some((take) => !assetIds.has(take.assetId) || !trackIds.has(take.trackId) || !clipIds.has(take.clipId))) throw new Error('상대 ADR 큐의 미디어·트랙·클립 참조가 현재 프로젝트와 맞지 않아 자동 적용할 수 없습니다.')
    }
    adrCues = replaceEntity(adrCues, conflict.entityId, snapshot)
  } else if (conflict.kind === 'dictionary') {
    if (conflict.entityId === 'creator-learning-profile') {
      if (selectedSnapshot !== undefined && (typeof selectedSnapshot !== 'object' || selectedSnapshot === null)) throw new Error('병합 세션에서 적용할 학습 프로필 사본을 찾을 수 없습니다.')
      creatorLearningProfile = selectedSnapshot as CreatorLearningProfile | undefined
    } else if (conflict.entityId === 'speaker-voice-profiles') {
      if (selectedSnapshot !== undefined && !Array.isArray(selectedSnapshot)) throw new Error('병합 세션에서 적용할 화자 음성 프로필 사본을 찾을 수 없습니다.')
      speakerVoiceProfiles = selectedSnapshot as SpeakerVoiceProfile[] | undefined
    } else if (isMergeSessionSnapshot(conflict.currentSnapshot) || isMergeSessionSnapshot(conflict.incomingSnapshot)) {
      const snapshot = selectedSnapshot === undefined ? undefined : isMergeSessionSnapshot(selectedSnapshot) ? selectedSnapshot : undefined
      if (selectedSnapshot !== undefined && !snapshot) throw new Error('병합 세션에서 적용할 이전 병합 기록 사본을 찾을 수 없습니다.')
      priorMergeSessions = replaceEntity(priorMergeSessions, conflict.entityId, snapshot)
    } else {
      if (selectedSnapshot !== undefined && typeof selectedSnapshot !== 'string') throw new Error('병합 세션에서 적용할 교정 사전 값을 찾을 수 없습니다.')
      if (selectedSnapshot === undefined) delete correctionDictionary[conflict.entityId]
      else correctionDictionary[conflict.entityId] = selectedSnapshot
    }
  } else if (conflict.kind === 'asset') {
    const snapshot = selectedSnapshot === undefined ? undefined : isPersistedMediaAssetSnapshot(selectedSnapshot) ? selectedSnapshot : undefined
    if (selectedSnapshot !== undefined && !snapshot) throw new Error('병합 세션에서 적용할 미디어 사본을 찾을 수 없습니다.')
    if (!snapshot) {
      const clipReferences = sequences.flatMap((sequence) => sequence.tracks.flatMap((track) => track.clips)).filter((clip) => clip.assetId === conflict.entityId)
      const adrReferences = adrCues.flatMap((cue) => cue.takes).filter((take) => take.assetId === conflict.entityId)
      if (clipReferences.length || adrReferences.length) throw new Error(`이 미디어는 클립 ${clipReferences.length}개와 ADR 테이크 ${adrReferences.length}개에서 사용 중이므로 먼저 해당 편집 충돌을 해결해야 삭제할 수 있습니다.`)
    }
    assets = replaceEntity(assets, conflict.entityId, snapshot)
  }

  const resolvedAt = new Date().toISOString()
  if (resolvedTarget && conflict.markerId) resolvedTarget = { ...resolvedTarget, markers: (resolvedTarget.markers ?? []).map((marker) => marker.id === conflict.markerId ? { ...marker, status: 'resolved', updatedAt: resolvedAt } : marker) }
  if (resolvedTarget) sequences = sequences.map((sequence) => sequence.id === resolvedTarget!.id ? resolvedTarget! : sequence)
  const mergeSessions = priorMergeSessions.map((candidate) => {
    if (candidate.id !== sessionId) return candidate
    const conflicts = candidate.conflicts.map((item) => item.id === conflictId ? { ...item, status: 'resolved' as const, resolution, resolvedAt } : item)
    return { ...candidate, status: conflicts.every((item) => item.status === 'resolved') ? 'resolved' as const : 'open' as const, conflicts }
  })
  const openBranchIds = new Set(mergeSessions.flatMap((candidate) => candidate.conflicts.filter((item) => item.status === 'open').flatMap((item) => item.branchSequenceId ? [item.branchSequenceId] : [])))
  sequences = sequences.map((sequence) => !openBranchIds.has(sequence.id) && sequence.name.includes('병합 충돌 (상대)') ? { ...sequence, name: sequence.name.replace('병합 충돌 (상대)', '병합 기록 (해결됨)') } : sequence)
  return synchronizeActiveSequence({ ...project, updatedAt: resolvedAt, assets, sequences, adrCues, correctionDictionary, creatorLearningProfile, speakerVoiceProfiles, mergeSessions }, project.activeSequenceId ?? conflict.sequenceId ?? sequences[0]?.id ?? '')
}

function branchSequenceFromVersionDetailed(current: CutlineProjectDocument, snapshot: CutlineProjectDocument, rootSequenceId: string): SequenceBranchResult {
  const currentSequences = getProjectSequences(current)
  const snapshotSequences = getProjectSequences(snapshot)
  const snapshotById = new Map(snapshotSequences.map((sequence) => [sequence.id, sequence]))
  if (!snapshotById.has(rootSequenceId)) throw new Error('선택한 버전에서 시퀀스를 찾을 수 없습니다.')
  const dependencyIds: string[] = []
  const collect = (sequenceId: string) => {
    if (dependencyIds.includes(sequenceId)) return
    const sequence = snapshotById.get(sequenceId)
    if (!sequence) return
    dependencyIds.push(sequenceId)
    if (sequence.sourceSequenceId) collect(sequence.sourceSequenceId)
    sequence.tracks.flatMap((track) => track.clips).forEach((clip) => { if (clip.nestedSequenceId) collect(clip.nestedSequenceId) })
  }
  collect(rootSequenceId)
  const sequenceIds = new Map(dependencyIds.map((id) => [id, newId('sequence-version')]))
  const cueIds = new Map((snapshot.adrCues ?? []).filter((cue) => sequenceIds.has(cue.sequenceId)).map((cue) => [cue.id, newId('adr-cue')]))
  const takeIds = new Map((snapshot.adrCues ?? []).flatMap((cue) => cue.takes).map((take) => [take.id, newId('adr-take')]))
  const trackIds = new Map<string, string>()
  const clipIds = new Map<string, string>()
  const groupIds = new Map<string, string>()
  const linkGroupIds = new Map<string, string>()
  dependencyIds.forEach((sequenceId) => snapshotById.get(sequenceId)?.tracks.forEach((track) => {
    trackIds.set(`${sequenceId}:${track.id}`, newId('track'))
    track.clips.forEach((clip) => {
      clipIds.set(`${sequenceId}:${clip.id}`, newId('clip'))
      if (clip.groupId && !groupIds.has(`${sequenceId}:${clip.groupId}`)) groupIds.set(`${sequenceId}:${clip.groupId}`, newId('group'))
      if (clip.linkGroupId && !linkGroupIds.has(`${sequenceId}:${clip.linkGroupId}`)) linkGroupIds.set(`${sequenceId}:${clip.linkGroupId}`, newId('link'))
    })
  }))
  const rewriteClip = (sequenceId: string, clip: TimelineClip): TimelineClip => ({
    ...clip,
    id: clipIds.get(`${sequenceId}:${clip.id}`) ?? newId('clip'),
    trackId: trackIds.get(`${sequenceId}:${clip.trackId}`) ?? clip.trackId,
    groupId: clip.groupId ? groupIds.get(`${sequenceId}:${clip.groupId}`) : undefined,
    linkGroupId: clip.linkGroupId ? linkGroupIds.get(`${sequenceId}:${clip.linkGroupId}`) : undefined,
    nestedSequenceId: clip.nestedSequenceId ? sequenceIds.get(clip.nestedSequenceId) ?? clip.nestedSequenceId : undefined,
    adrCueId: clip.adrCueId ? cueIds.get(clip.adrCueId) : undefined,
    adrTakeId: clip.adrTakeId ? takeIds.get(clip.adrTakeId) : undefined,
  })
  const rewriteTrack = (sequenceId: string, track: TimelineTrack): TimelineTrack => ({
    ...track,
    id: trackIds.get(`${sequenceId}:${track.id}`) ?? newId('track'),
    clips: track.clips.map((clip) => rewriteClip(sequenceId, clip)),
  })
  const versionLabel = new Date(snapshot.updatedAt).toLocaleString('ko-KR')
  const imported = dependencyIds.map((sequenceId): ProjectSequence => {
    const sequence = snapshotById.get(sequenceId)!
    return {
      ...sequence,
      id: sequenceIds.get(sequenceId)!,
      name: sequenceId === rootSequenceId ? `${sequence.name} · 버전 ${versionLabel}` : `${sequence.name} · 연결 버전`,
      sourceSequenceId: sequence.sourceSequenceId ? sequenceIds.get(sequence.sourceSequenceId) ?? sequence.sourceSequenceId : undefined,
      tracks: sequence.tracks.map((track) => rewriteTrack(sequenceId, track)),
      createdAt: new Date().toISOString(),
    }
  })
  const importedCues: AdrCue[] = (snapshot.adrCues ?? []).filter((cue) => sequenceIds.has(cue.sequenceId)).map((cue) => ({
    ...cue,
    id: cueIds.get(cue.id)!,
    sequenceId: sequenceIds.get(cue.sequenceId)!,
    selectedTakeId: cue.selectedTakeId ? takeIds.get(cue.selectedTakeId) : undefined,
    takes: cue.takes.map((take) => ({
      ...take,
      id: takeIds.get(take.id)!,
      clipId: clipIds.get(`${cue.sequenceId}:${take.clipId}`) ?? take.clipId,
      trackId: trackIds.get(`${cue.sequenceId}:${take.trackId}`) ?? take.trackId,
    })),
    compSegments: cue.compSegments?.map((segment) => ({ ...segment, id: newId('adr-comp'), takeId: takeIds.get(segment.takeId) ?? segment.takeId })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }))
  const target = imported.find((sequence) => sequence.id === sequenceIds.get(rootSequenceId))!
  const assetMap = new Map(current.assets.map((asset) => [asset.id, asset]))
  snapshot.assets.forEach((asset) => { if (!assetMap.has(asset.id)) assetMap.set(asset.id, asset) })
  const project: CutlineProjectDocument = {
    ...current,
    updatedAt: new Date().toISOString(),
    assets: [...assetMap.values()],
    tracks: target.tracks,
    transcript: target.transcript,
    suggestions: target.suggestions,
    markers: target.markers,
    audioBuses: target.audioBuses,
    activeSequenceId: target.id,
    sequences: [...currentSequences, ...imported],
    adrCues: [...(current.adrCues ?? []), ...importedCues],
    correctionDictionary: { ...(snapshot.correctionDictionary ?? {}), ...(current.correctionDictionary ?? {}) },
    sequence: { id: target.id, name: target.name, aspectRatio: target.aspectRatio, width: target.width, height: target.height, fps: target.fps, timecodeStart: target.timecodeStart, timecodeDropFrame: target.timecodeDropFrame },
  }
  return { project, sequenceIds, trackIds, clipIds }
}

export function branchSequenceFromVersion(current: CutlineProjectDocument, snapshot: CutlineProjectDocument, rootSequenceId: string): CutlineProjectDocument {
  return branchSequenceFromVersionDetailed(current, snapshot, rootSequenceId).project
}
