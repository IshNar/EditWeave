import type { EditWeaveProjectDocument, ProjectSequence } from './types'

export interface ProjectIntegrityIssue {
  id: string
  level: 'blocker' | 'warning'
  detail: string
}

type IntegritySequence = Pick<ProjectSequence, 'id' | 'name' | 'sourceSequenceId' | 'sourceRange' | 'sourceFingerprint' | 'sourceGraphSnapshot' | 'width' | 'height' | 'fps' | 'tracks' | 'transcript' | 'suggestions' | 'markers'>

/**
 * Validates the persisted graph before it is trusted by the editor. This is deliberately
 * stricter than Delivery Guard: a delivery warning may be reviewed by the user, while a
 * broken ID or non-finite time can corrupt later edits and must stop project loading.
 */
export function inspectProjectIntegrity(project: EditWeaveProjectDocument): ProjectIntegrityIssue[] {
  const issues: ProjectIntegrityIssue[] = []
  const add = (id: string, level: ProjectIntegrityIssue['level'], detail: string) => issues.push({ id, level, detail })
  const unique = <T extends { id: string }>(items: T[] | undefined, scope: string) => {
    const seen = new Set<string>()
    for (const item of items ?? []) {
      if (!item.id) add(`${scope}-empty-id`, 'blocker', `${scope}에 비어 있는 ID가 있습니다.`)
      else if (seen.has(item.id)) add(`${scope}-duplicate-${item.id}`, 'blocker', `${scope}에 중복 ID “${item.id}”가 있습니다.`)
      seen.add(item.id)
    }
  }
  const finitePositive = (value: number) => Number.isFinite(value) && value > 0
  const finiteNonNegative = (value: number) => Number.isFinite(value) && value >= 0

  if (!project.id.trim()) add('project-empty-id', 'blocker', '프로젝트 ID가 비어 있습니다.')
  for (const record of project.aiActivityLog ?? []) {
    if (record.version !== 'editweave-ai-activity-v1' || !record.id || !record.label || !record.input?.dataCategories?.length) add(`ai-activity-${record.id || 'empty'}`, 'warning', 'AI 활동 기록 일부가 손상되어 실행 근거를 완전히 표시할 수 없습니다.')
    if (record.processing?.location === 'external-user-service' && record.approval !== 'user-confirmed-external-transfer') add(`ai-external-approval-${record.id}`, 'blocker', `외부 AI 활동 “${record.label}”에 전송 승인 기록이 없습니다.`)
  }
  unique(project.assets, '미디어')
  const assetIds = new Set(project.assets.map((asset) => asset.id))
  for (const asset of project.assets) {
    if (!asset.name.trim() || !asset.extension.trim()) add(`asset-identity-${asset.id}`, 'blocker', `미디어 “${asset.id}”의 이름 또는 확장자가 비어 있습니다.`)
    if (!finitePositive(asset.duration) || !finiteNonNegative(asset.size)) add(`asset-range-${asset.id}`, 'blocker', `미디어 “${asset.name || asset.id}”의 길이 또는 크기가 올바르지 않습니다.`)
  }

  const sequences = integritySequences(project)
  unique(sequences, '시퀀스')
  const sequenceIds = new Set(sequences.map((sequence) => sequence.id))
  if (project.activeSequenceId && !sequenceIds.has(project.activeSequenceId)) add('active-sequence-missing', 'blocker', `활성 시퀀스 “${project.activeSequenceId}”를 찾을 수 없습니다.`)

  for (const sequence of sequences) {
    if (!finitePositive(sequence.width) || !finitePositive(sequence.height) || !finitePositive(sequence.fps)) add(`sequence-settings-${sequence.id}`, 'blocker', `시퀀스 “${sequence.name}”의 해상도 또는 프레임레이트가 올바르지 않습니다.`)
    if (sequence.sourceSequenceId && !sequenceIds.has(sequence.sourceSequenceId)) add(`source-sequence-${sequence.id}`, 'blocker', `파생 시퀀스 “${sequence.name}”의 원본 시퀀스를 찾을 수 없습니다.`)
    if (sequence.sourceSequenceId && (!sequence.sourceRange || !finiteNonNegative(sequence.sourceRange.start) || !Number.isFinite(sequence.sourceRange.end) || sequence.sourceRange.end <= sequence.sourceRange.start)) add(`source-range-${sequence.id}`, 'blocker', `파생 시퀀스 “${sequence.name}”의 원본 범위가 올바르지 않습니다.`)
    if (sequence.sourceSequenceId && !sequence.sourceFingerprint) add(`source-fingerprint-${sequence.id}`, 'warning', `파생 시퀀스 “${sequence.name}”에 변경 감지 fingerprint가 없습니다.`)
    if (sequence.sourceGraphSnapshot) {
      const fingerprints = sequence.sourceGraphSnapshot.fingerprints as Partial<Record<'video' | 'audio' | 'transcript' | 'suggestions' | 'markers' | 'settings', unknown>>
      const valid = sequence.sourceGraphSnapshot.version === 'editweave-source-graph-v1'
        && ['video', 'audio', 'transcript', 'suggestions', 'markers', 'settings'].every((domain) => typeof fingerprints[domain as keyof typeof fingerprints] === 'string' && Boolean(fingerprints[domain as keyof typeof fingerprints]))
      if (!valid) add(`source-graph-${sequence.id}`, 'warning', `파생 시퀀스 “${sequence.name}”의 영역별 변경 기준이 손상되어 전체 영역을 다시 검토해야 합니다.`)
    }

    unique(sequence.tracks, `시퀀스 ${sequence.id} 트랙`)
    unique(sequence.transcript, `시퀀스 ${sequence.id} 대본`)
    unique(sequence.suggestions, `시퀀스 ${sequence.id} 제안`)
    unique(sequence.markers, `시퀀스 ${sequence.id} 마커`)
    const trackIds = new Set(sequence.tracks.map((track) => track.id))
    const clips = sequence.tracks.flatMap((track) => track.clips)
    unique(clips, `시퀀스 ${sequence.id} 클립`)

    for (const track of sequence.tracks) {
      for (const clip of track.clips) {
        if (clip.trackId !== track.id || !trackIds.has(clip.trackId)) add(`clip-track-${sequence.id}-${clip.id}`, 'blocker', `클립 “${clip.name}”이 존재하지 않거나 다른 트랙을 참조합니다.`)
        if (!finiteNonNegative(clip.start) || !finitePositive(clip.duration) || !finiteNonNegative(clip.sourceOffset)) add(`clip-time-${sequence.id}-${clip.id}`, 'blocker', `클립 “${clip.name}”의 시작·길이·소스 오프셋이 올바르지 않습니다.`)
        if (clip.assetId && !assetIds.has(clip.assetId)) add(`clip-asset-${sequence.id}-${clip.id}`, 'blocker', `클립 “${clip.name}”이 프로젝트에 없는 미디어 “${clip.assetId}”를 참조합니다.`)
        if (clip.nestedSequenceId && !sequenceIds.has(clip.nestedSequenceId)) add(`clip-nested-${sequence.id}-${clip.id}`, 'blocker', `클립 “${clip.name}”이 프로젝트에 없는 중첩 시퀀스를 참조합니다.`)
        if (clip.assetId && clip.nestedSequenceId) add(`clip-dual-source-${sequence.id}-${clip.id}`, 'blocker', `클립 “${clip.name}”이 미디어와 중첩 시퀀스를 동시에 참조합니다.`)
        if (clip.kind !== track.kind) add(`clip-kind-${sequence.id}-${clip.id}`, 'warning', `클립 “${clip.name}”의 종류와 트랙 종류가 다릅니다.`)
      }
    }

    for (const segment of sequence.transcript) if (!finiteNonNegative(segment.start) || !Number.isFinite(segment.end) || segment.end <= segment.start) add(`transcript-time-${sequence.id}-${segment.id}`, 'blocker', `대본 “${segment.text.slice(0, 24)}”의 시간 범위가 올바르지 않습니다.`)
    for (const suggestion of sequence.suggestions) if (!finiteNonNegative(suggestion.start) || !Number.isFinite(suggestion.end) || suggestion.end <= suggestion.start || !Number.isFinite(suggestion.score) || suggestion.score < 0 || suggestion.score > 1) add(`suggestion-range-${sequence.id}-${suggestion.id}`, 'blocker', `AI 제안 “${suggestion.label}”의 범위 또는 점수가 올바르지 않습니다.`)
    for (const marker of sequence.markers ?? []) if (!finiteNonNegative(marker.time) || marker.duration !== undefined && !finiteNonNegative(marker.duration)) add(`marker-time-${sequence.id}-${marker.id}`, 'blocker', `마커 “${marker.label}”의 시간이 올바르지 않습니다.`)
  }

  inspectSequenceCycles(sequences, add)
  inspectAdrIntegrity(project, sequences, assetIds, add)
  return deduplicateIssues(issues)
}

export function assertProjectIntegrity(project: EditWeaveProjectDocument): void {
  const blockers = inspectProjectIntegrity(project).filter((issue) => issue.level === 'blocker')
  if (blockers.length) throw new Error(`프로젝트 무결성 검사 실패: ${blockers.slice(0, 3).map((issue) => issue.detail).join(' / ')}${blockers.length > 3 ? ` 외 ${blockers.length - 3}건` : ''}`)
}

function integritySequences(project: EditWeaveProjectDocument): IntegritySequence[] {
  if (project.sequences?.length) return project.sequences
  return [{
    id: project.sequence.id,
    name: project.sequence.name,
    width: project.sequence.width,
    height: project.sequence.height,
    fps: project.sequence.fps,
    tracks: project.tracks,
    transcript: project.transcript ?? [],
    suggestions: project.suggestions ?? [],
    markers: project.markers ?? [],
  }]
}

function inspectSequenceCycles(sequences: IntegritySequence[], add: (id: string, level: ProjectIntegrityIssue['level'], detail: string) => void): void {
  const graph = new Map(sequences.map((sequence) => [sequence.id, sequence.tracks.flatMap((track) => track.clips.flatMap((clip) => clip.nestedSequenceId ? [clip.nestedSequenceId] : []))]))
  const visited = new Set<string>()
  const active = new Set<string>()
  const visit = (id: string, path: string[]) => {
    if (active.has(id)) {
      const cycle = [...path.slice(path.indexOf(id)), id]
      add(`nested-cycle-${cycle.join('-')}`, 'blocker', `중첩 시퀀스 순환 참조가 있습니다: ${cycle.join(' → ')}`)
      return
    }
    if (visited.has(id)) return
    active.add(id)
    for (const child of graph.get(id) ?? []) if (graph.has(child)) visit(child, [...path, child])
    active.delete(id)
    visited.add(id)
  }
  for (const id of graph.keys()) visit(id, [id])
}

function inspectAdrIntegrity(
  project: EditWeaveProjectDocument,
  sequences: IntegritySequence[],
  assetIds: Set<string>,
  add: (id: string, level: ProjectIntegrityIssue['level'], detail: string) => void,
): void {
  const sequenceById = new Map(sequences.map((sequence) => [sequence.id, sequence]))
  const seenCueIds = new Set<string>()
  const seenTakeIds = new Set<string>()
  for (const cue of project.adrCues ?? []) {
    if (!cue.id || seenCueIds.has(cue.id)) add(`adr-cue-${cue.id || 'empty'}`, 'blocker', 'ADR 큐에 비어 있거나 중복된 ID가 있습니다.')
    seenCueIds.add(cue.id)
    const sequence = sequenceById.get(cue.sequenceId)
    if (!sequence) { add(`adr-sequence-${cue.id}`, 'blocker', `ADR 큐 “${cue.text || cue.id}”의 시퀀스를 찾을 수 없습니다.`); continue }
    const tracks = new Map(sequence.tracks.map((track) => [track.id, track]))
    const cueTakeIds = new Set(cue.takes.map((take) => take.id))
    for (const take of cue.takes) {
      if (!take.id || seenTakeIds.has(take.id)) add(`adr-take-${take.id || 'empty'}`, 'blocker', 'ADR 테이크에 비어 있거나 중복된 ID가 있습니다.')
      seenTakeIds.add(take.id)
      if (!assetIds.has(take.assetId)) add(`adr-asset-${take.id}`, 'blocker', `ADR Take ${take.takeNumber}의 미디어를 찾을 수 없습니다.`)
      const track = tracks.get(take.trackId)
      if (!track?.clips.some((clip) => clip.id === take.clipId && clip.assetId === take.assetId)) add(`adr-clip-${take.id}`, 'blocker', `ADR Take ${take.takeNumber}의 타임라인 클립을 찾을 수 없습니다.`)
    }
    if (cue.selectedTakeId && !cueTakeIds.has(cue.selectedTakeId)) add(`adr-selected-${cue.id}`, 'blocker', `ADR 큐 “${cue.text || cue.id}”의 선택 테이크를 찾을 수 없습니다.`)
    for (const segment of cue.compSegments ?? []) if (!cueTakeIds.has(segment.takeId) || !finiteRange(segment.start, segment.end)) add(`adr-comp-${cue.id}-${segment.id}`, 'blocker', `ADR 큐 “${cue.text || cue.id}”의 컴프 구간이 손상됐습니다.`)
  }
}

function finiteRange(start: number, end: number): boolean {
  return Number.isFinite(start) && start >= 0 && Number.isFinite(end) && end > start
}

function deduplicateIssues(issues: ProjectIntegrityIssue[]): ProjectIntegrityIssue[] {
  const byId = new Map<string, ProjectIntegrityIssue>()
  for (const issue of issues) if (!byId.has(issue.id)) byId.set(issue.id, issue)
  return [...byId.values()]
}
