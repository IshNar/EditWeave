import type { AdrCue, AudioBusMap, ColorAdjustment, ProjectMergeSession, ProjectSequence, TimelineClip, VisualEffects } from './types'

export interface SequenceReference {
  sequenceId: string
  sequenceName: string
  count: number
}

export interface SequenceDeleteAssessment {
  sequenceId: string
  nestedReferences: SequenceReference[]
  derivedReferences: SequenceReference[]
  mergeReferenceCount: number
  adrCueCount: number
  externalAdrReferenceCount: number
  blockers: string[]
  canDelete: boolean
}

export interface DuplicateSequenceResult {
  sequence: ProjectSequence
  adrCues: AdrCue[]
}

export function renderReplacementSourceAssetIds(clip: TimelineClip): string[] {
  if (!clip.renderReplacement) return []
  if (clip.renderReplacement.originalAssetIds?.length) return [...new Set(clip.renderReplacement.originalAssetIds.filter(Boolean))]
  try {
    const parsed: unknown = JSON.parse(clip.renderReplacement.originalClipsJson)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const candidate = item as { assetId?: unknown; subclipId?: unknown }
      return [candidate.assetId, candidate.subclipId].filter((id): id is string => typeof id === 'string' && Boolean(id))
    }))]
  } catch {
    return []
  }
}

export interface AssetReferenceRemovalResult {
  sequences: ProjectSequence[]
  removedClipCount: number
  committedRenderReplacementCount: number
}

export function removeAssetReferencesFromSequences(sequences: ProjectSequence[], assetIds: ReadonlySet<string>): AssetReferenceRemovalResult {
  let removedClipCount = 0
  let committedRenderReplacementCount = 0
  const nextSequences = sequences.map((sequence) => ({
    ...sequence,
    tracks: sequence.tracks.map((track) => ({
      ...track,
      clips: track.clips.flatMap((clip) => {
        if (assetIds.has(clip.assetId ?? '') || assetIds.has(clip.subclipId ?? '')) {
          removedClipCount += 1
          return []
        }
        if (renderReplacementSourceAssetIds(clip).some((id) => assetIds.has(id))) {
          committedRenderReplacementCount += 1
          return [{ ...clip, renderReplacement: undefined }]
        }
        return [clip]
      }),
    })),
  }))
  return { sequences: nextSequences, removedClipCount, committedRenderReplacementCount }
}

export function removeAssetClipsFromSequences(sequences: ProjectSequence[], assetId: string): ProjectSequence[] {
  return removeAssetReferencesFromSequences(sequences, new Set([assetId])).sequences
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function assertUniqueIds(items: Array<{ id: string }>, label: string): void {
  const ids = new Set<string>()
  for (const item of items) {
    if (!item.id || ids.has(item.id)) throw new Error(`${label}에 비어 있거나 중복된 ID가 있어 안전하게 복제할 수 없습니다.`)
    ids.add(item.id)
  }
}

function uniqueCopyName(sourceName: string, sequences: ProjectSequence[]): string {
  const used = new Set(sequences.map((sequence) => sequence.name.trim().toLocaleLowerCase()))
  const base = `${sourceName.trim() || '시퀀스'} 복사본`
  if (!used.has(base.toLocaleLowerCase())) return base
  let suffix = 2
  while (used.has(`${base} ${suffix}`.toLocaleLowerCase())) suffix += 1
  return `${base} ${suffix}`
}

function duplicateVisualEffects(effects: VisualEffects | undefined, maskIds: Map<string, string>): VisualEffects | undefined {
  if (!effects) return undefined
  const clone = structuredClone(effects)
  return {
    ...clone,
    masks: clone.masks?.map((mask) => ({
      ...mask,
      id: maskIds.get(mask.id) ?? newId('mask'),
    })),
  }
}

function duplicateColorAdjustment(adjustment: ColorAdjustment | undefined): ColorAdjustment | undefined {
  if (!adjustment) return undefined
  const clone = structuredClone(adjustment)
  const nodeIds = new Map((clone.colorNodes ?? []).map((node) => [node.id, newId('color-node')]))
  return {
    ...clone,
    colorNodes: clone.colorNodes?.map((node) => ({
      ...node,
      id: nodeIds.get(node.id)!,
      inputIds: node.inputIds.map((inputId) => nodeIds.get(inputId) ?? inputId),
    })),
    colorOutputNodeId: clone.colorOutputNodeId ? nodeIds.get(clone.colorOutputNodeId) ?? clone.colorOutputNodeId : undefined,
  }
}

function duplicateAudioBuses(buses: AudioBusMap | undefined): AudioBusMap | undefined {
  if (!buses) return undefined
  const clone = structuredClone(buses)
  return Object.fromEntries(Object.entries(clone).map(([role, bus]) => [role, {
    ...bus,
    inserts: bus.inserts.map((insert) => ({ ...insert, id: newId('bus-insert') })),
  }])) as AudioBusMap
}

function duplicateClip(
  clip: TimelineClip,
  sourceSequenceId: string,
  duplicateSequenceId: string,
  trackIds: Map<string, string>,
  clipIds: Map<string, string>,
  groupIds: Map<string, string>,
  linkGroupIds: Map<string, string>,
  cueIds: Map<string, string>,
  takeIds: Map<string, string>,
): TimelineClip {
  const maskIds = new Map<string, string>()
  const collectMasks = (effects: VisualEffects | undefined) => effects?.masks?.forEach((mask) => {
    if (!maskIds.has(mask.id)) maskIds.set(mask.id, newId('mask'))
  })
  collectMasks(clip.visualEffects)
  clip.visualKeyframes?.forEach((keyframe) => collectMasks(keyframe.effects))

  return {
    ...structuredClone(clip),
    id: clipIds.get(clip.id)!,
    trackId: trackIds.get(clip.trackId)!,
    trackMatte: clip.trackMatte ? { ...clip.trackMatte, sourceTrackId: trackIds.get(clip.trackMatte.sourceTrackId) ?? clip.trackMatte.sourceTrackId } : undefined,
    effectStack: clip.effectStack?.map((item) => ({ ...item, id: newId('effect-stack') })),
    groupId: clip.groupId ? groupIds.get(clip.groupId) : undefined,
    linkGroupId: clip.linkGroupId ? linkGroupIds.get(clip.linkGroupId) : undefined,
    nestedSequenceId: clip.nestedSequenceId === sourceSequenceId ? duplicateSequenceId : clip.nestedSequenceId,
    adrCueId: clip.adrCueId ? cueIds.get(clip.adrCueId) ?? clip.adrCueId : undefined,
    adrTakeId: clip.adrTakeId ? takeIds.get(clip.adrTakeId) ?? clip.adrTakeId : undefined,
    speedKeyframes: clip.speedKeyframes?.map((keyframe) => ({ ...structuredClone(keyframe), id: newId('speed-keyframe') })),
    keyframes: clip.keyframes?.map((keyframe) => ({ ...structuredClone(keyframe), id: newId('transform-keyframe') })),
    stabilization: clip.stabilization ? { ...structuredClone(clip.stabilization), originalKeyframes: clip.stabilization.originalKeyframes?.map((keyframe) => ({ ...structuredClone(keyframe), id: newId('stabilization-source-keyframe') })) } : undefined,
    visualEffects: duplicateVisualEffects(clip.visualEffects, maskIds),
    visualKeyframes: clip.visualKeyframes?.map((keyframe) => ({
      ...structuredClone(keyframe),
      id: newId('visual-keyframe'),
      effects: duplicateVisualEffects(keyframe.effects, maskIds)!,
    })),
    colorAdjustment: duplicateColorAdjustment(clip.colorAdjustment),
    audioAdjustment: clip.audioAdjustment ? {
      ...structuredClone(clip.audioAdjustment),
      auxSends: clip.audioAdjustment.auxSends?.map((send) => ({ ...send, id: newId('aux-send') })),
    } : undefined,
    audioMixKeyframes: clip.audioMixKeyframes?.map((keyframe) => ({ ...keyframe, id: newId('audio-keyframe') })),
    clipMarkers: clip.clipMarkers?.map((marker) => ({ ...structuredClone(marker), id: newId('clip-marker') })),
  }
}

export function duplicateProjectSequence(options: {
  sourceSequenceId: string
  sequences: ProjectSequence[]
  adrCues: AdrCue[]
  availableAssetIds: ReadonlySet<string>
}): DuplicateSequenceResult {
  const source = options.sequences.find((sequence) => sequence.id === options.sourceSequenceId)
  if (!source) throw new Error('복제할 시퀀스를 찾을 수 없습니다.')

  assertUniqueIds(source.tracks, `“${source.name}” 트랙`)
  const sourceClips = source.tracks.flatMap((track) => track.clips)
  assertUniqueIds(sourceClips, `“${source.name}” 클립`)
  if (source.tracks.some((track) => track.clips.some((clip) => clip.trackId !== track.id))) throw new Error(`“${source.name}”에 실제 소속 트랙과 trackId가 다른 클립이 있어 안전하게 복제할 수 없습니다.`)
  const sequenceIds = new Set(options.sequences.map((sequence) => sequence.id))
  if (source.sourceSequenceId && !sequenceIds.has(source.sourceSequenceId)) throw new Error(`“${source.name}”의 원본 시퀀스 참조가 없어 안전하게 복제할 수 없습니다.`)
  const invalidNestedClip = sourceClips.find((clip) => clip.nestedSequenceId === source.id || Boolean(clip.nestedSequenceId && !sequenceIds.has(clip.nestedSequenceId)))
  if (invalidNestedClip) throw new Error(`“${source.name}”의 중첩 클립 “${invalidNestedClip.name}” 참조가 순환하거나 누락되어 안전하게 복제할 수 없습니다.`)

  const sequenceId = newId('sequence-copy')
  const sourceCues = options.adrCues.filter((cue) => cue.sequenceId === source.id)
  assertUniqueIds(sourceCues, `“${source.name}” ADR 큐`)
  assertUniqueIds(sourceCues.flatMap((cue) => cue.takes), `“${source.name}” ADR 테이크`)
  const sourceCueIds = new Set(sourceCues.map((cue) => cue.id))
  const sourceTakeIds = new Set(sourceCues.flatMap((cue) => cue.takes.map((take) => take.id)))
  const invalidAdrClip = sourceClips.find((clip) => clip.adrCueId
    ? !sourceCueIds.has(clip.adrCueId) || Boolean(clip.adrTakeId && !sourceTakeIds.has(clip.adrTakeId))
    : Boolean(clip.adrTakeId))
  if (invalidAdrClip) throw new Error(`“${source.name}”의 ADR 클립 “${invalidAdrClip.name}” 참조가 손상되어 안전하게 복제할 수 없습니다.`)
  const missingMediaClip = sourceClips.find((clip) => clip.assetId && !options.availableAssetIds.has(clip.assetId))
  if (missingMediaClip) throw new Error(`“${source.name}”의 클립 “${missingMediaClip.name}”이 프로젝트에 없는 미디어를 참조해 복제할 수 없습니다.`)
  const cueIds = new Map(sourceCues.map((cue) => [cue.id, newId('adr-cue')]))
  const takeIds = new Map(sourceCues.flatMap((cue) => cue.takes.map((take) => [take.id, newId('adr-take')] as const)))
  const trackIds = new Map(source.tracks.map((track) => [track.id, newId('track')]))
  const clipIds = new Map(sourceClips.map((clip) => [clip.id, newId('clip')] as const))
  const groupIds = new Map<string, string>()
  const linkGroupIds = new Map<string, string>()
  sourceClips.forEach((clip) => {
    if (clip.groupId && !groupIds.has(clip.groupId)) groupIds.set(clip.groupId, newId('group'))
    if (clip.linkGroupId && !linkGroupIds.has(clip.linkGroupId)) linkGroupIds.set(clip.linkGroupId, newId('link'))
  })

  for (const cue of sourceCues) {
    const knownTakes = new Set(cue.takes.map((take) => take.id))
    if (cue.selectedTakeId && !knownTakes.has(cue.selectedTakeId)) throw new Error(`ADR 큐 “${cue.text || cue.id}”의 선택 테이크 참조가 손상되어 복제할 수 없습니다.`)
    if (cue.compSegments?.some((segment) => !knownTakes.has(segment.takeId))) throw new Error(`ADR 큐 “${cue.text || cue.id}”의 컴프 참조가 손상되어 복제할 수 없습니다.`)
    if (cue.takes.some((take) => !trackIds.has(take.trackId) || !clipIds.has(take.clipId))) throw new Error(`ADR 큐 “${cue.text || cue.id}”의 트랙 또는 클립 참조가 손상되어 복제할 수 없습니다.`)
    if (cue.takes.some((take) => !options.availableAssetIds.has(take.assetId))) throw new Error(`ADR 큐 “${cue.text || cue.id}”의 녹음 미디어 참조가 없어 복제할 수 없습니다.`)
  }

  const now = new Date().toISOString()
  const sequence: ProjectSequence = {
    ...structuredClone(source),
    id: sequenceId,
    name: uniqueCopyName(source.name, options.sequences),
    sourceSequenceId: source.sourceSequenceId === source.id ? sequenceId : source.sourceSequenceId,
    tracks: source.tracks.map((track) => ({
      ...structuredClone(track),
      id: trackIds.get(track.id)!,
      mixKeyframes: track.mixKeyframes?.map((keyframe) => ({ ...keyframe, id: newId('track-keyframe') })),
      clips: track.clips.map((clip) => duplicateClip(clip, source.id, sequenceId, trackIds, clipIds, groupIds, linkGroupIds, cueIds, takeIds)),
    })),
    transcript: source.transcript.map((segment) => ({ ...structuredClone(segment), id: newId('transcript') })),
    suggestions: source.suggestions.map((suggestion) => ({ ...structuredClone(suggestion), id: newId('suggestion') })),
    markers: source.markers?.map((marker) => ({ ...structuredClone(marker), id: newId('marker') })),
    audioBuses: duplicateAudioBuses(source.audioBuses),
    createdAt: now,
  }

  const adrCues: AdrCue[] = sourceCues.map((cue) => ({
    ...structuredClone(cue),
    id: cueIds.get(cue.id)!,
    sequenceId,
    selectedTakeId: cue.selectedTakeId ? takeIds.get(cue.selectedTakeId)! : undefined,
    takes: cue.takes.map((take) => ({
      ...structuredClone(take),
      id: takeIds.get(take.id)!,
      clipId: clipIds.get(take.clipId)!,
      trackId: trackIds.get(take.trackId)!,
      createdAt: now,
    })),
    compSegments: cue.compSegments?.map((segment) => ({ ...structuredClone(segment), id: newId('adr-comp'), takeId: takeIds.get(segment.takeId)! })),
    createdAt: now,
    updatedAt: now,
  }))

  return { sequence, adrCues }
}

export function renameProjectSequence(sequences: ProjectSequence[], sequenceId: string, requestedName: string): ProjectSequence[] {
  const target = sequences.find((sequence) => sequence.id === sequenceId)
  if (!target) throw new Error('이름을 바꿀 시퀀스를 찾을 수 없습니다.')
  const name = requestedName.trim().replace(/\s+/g, ' ')
  if (!name) throw new Error('시퀀스 이름을 입력해주세요.')
  if (name.length > 80) throw new Error('시퀀스 이름은 80자 이하여야 합니다.')
  if (sequences.some((sequence) => sequence.id !== sequenceId && sequence.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('같은 이름의 시퀀스가 이미 있습니다.')
  return sequences.map((sequence) => ({
    ...sequence,
    name: sequence.id === sequenceId ? name : sequence.name,
    tracks: sequence.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => clip.nestedSequenceId === sequenceId && clip.name === target.name ? { ...clip, name } : clip),
    })),
  }))
}

export function inspectSequenceDeletion(options: {
  sequences: ProjectSequence[]
  adrCues: AdrCue[]
  mergeSessions: ProjectMergeSession[]
  targetSequenceId: string
  runtimeBlockers?: string[]
}): SequenceDeleteAssessment {
  const target = options.sequences.find((sequence) => sequence.id === options.targetSequenceId)
  const nestedReferences = options.sequences.flatMap((sequence) => {
    if (sequence.id === options.targetSequenceId) return []
    const count = sequence.tracks.flatMap((track) => track.clips).filter((clip) => clip.nestedSequenceId === options.targetSequenceId).length
    return count ? [{ sequenceId: sequence.id, sequenceName: sequence.name, count }] : []
  })
  const derivedReferences = options.sequences.flatMap((sequence) => sequence.id !== options.targetSequenceId && sequence.sourceSequenceId === options.targetSequenceId
    ? [{ sequenceId: sequence.id, sequenceName: sequence.name, count: 1 }]
    : [])
  const mergeReferenceCount = options.mergeSessions.reduce((count, session) => count + session.conflicts.filter((conflict) => (
    conflict.sequenceId === options.targetSequenceId
    || conflict.branchSequenceId === options.targetSequenceId
    || conflict.kind === 'sequence' && (conflict.entityId === options.targetSequenceId || conflict.branchEntityId === options.targetSequenceId)
  )).length, 0)
  const adrCueCount = options.adrCues.filter((cue) => cue.sequenceId === options.targetSequenceId).length
  const targetCues = options.adrCues.filter((cue) => cue.sequenceId === options.targetSequenceId)
  const targetCueIds = new Set(targetCues.map((cue) => cue.id))
  const targetTakeIds = new Set(targetCues.flatMap((cue) => cue.takes.map((take) => take.id)))
  const externalAdrReferenceCount = options.sequences
    .filter((sequence) => sequence.id !== options.targetSequenceId)
    .flatMap((sequence) => sequence.tracks)
    .flatMap((track) => track.clips)
    .filter((clip) => Boolean(clip.adrCueId && targetCueIds.has(clip.adrCueId)) || Boolean(clip.adrTakeId && targetTakeIds.has(clip.adrTakeId)))
    .length
  const blockers = [...(options.runtimeBlockers ?? [])]
  if (!target) blockers.push('시퀀스를 찾을 수 없습니다.')
  if (options.sequences.length <= 1) blockers.push('프로젝트의 마지막 시퀀스는 삭제할 수 없습니다.')
  if (nestedReferences.length) blockers.push(`다른 시퀀스의 중첩 클립 ${nestedReferences.reduce((sum, item) => sum + item.count, 0)}개가 참조 중입니다.`)
  if (derivedReferences.length) blockers.push(`쇼츠·중첩 등 파생 시퀀스 ${derivedReferences.length}개가 원본으로 사용 중입니다.`)
  if (mergeReferenceCount) blockers.push(`공동 작업 병합 감사 기록 ${mergeReferenceCount}개가 참조 중입니다.`)
  if (externalAdrReferenceCount) blockers.push(`다른 시퀀스의 ADR 클립 ${externalAdrReferenceCount}개가 큐·테이크를 참조 중입니다.`)
  return { sequenceId: options.targetSequenceId, nestedReferences, derivedReferences, mergeReferenceCount, adrCueCount, externalAdrReferenceCount, blockers, canDelete: blockers.length === 0 }
}
