import { Check, FileUp, GitCompareArrows, GitFork, History, MapPin, RotateCcw, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { compareProjectVersions } from '../editor/versionMerge'
import type { EditWeaveProjectDocument, ProjectMergeConflictRecord, ProjectMergeSession } from '../editor/types'

const mergeConflictNames: Record<ProjectMergeConflictRecord['kind'], string> = {
  sequence: '시퀀스 설정',
  track: '트랙 설정',
  clip: '클립',
  transcript: '대본',
  suggestion: '편집 제안',
  marker: '마커',
  'audio-bus': '오디오 버스',
  asset: '미디어',
  'adr-cue': 'ADR 큐',
  dictionary: '학습·사전 값',
}

function incomingDecisionLabel(conflict: ProjectMergeConflictRecord): string {
  return conflict.incomingDeleted ? `상대 ${mergeConflictNames[conflict.kind]} 삭제` : `상대 ${mergeConflictNames[conflict.kind]} 적용`
}

interface ProjectHistoryDialogProps {
  open: boolean
  snapshots: EditWeaveProjectDocument[]
  currentProject: EditWeaveProjectDocument
  onClose: () => void
  onRestore: (snapshot: EditWeaveProjectDocument) => void
  onBranch: (snapshot: EditWeaveProjectDocument, sequenceId: string) => void
  onMerge: (base: EditWeaveProjectDocument, incoming: File) => void
  mergeSessions: ProjectMergeSession[]
  onResolveConflict: (sessionId: string, conflictId: string, resolution: 'current' | 'incoming') => void
  onLocateConflict: (sessionId: string, conflictId: string, side: 'current' | 'branch') => void
}

export function ProjectHistoryDialog({ open, snapshots, currentProject, onClose, onRestore, onBranch, onMerge, mergeSessions, onResolveConflict, onLocateConflict }: ProjectHistoryDialogProps) {
  const [selected, setSelected] = useState<EditWeaveProjectDocument | undefined>()
  const mergeInputRef = useRef<HTMLInputElement>(null)
  const diff = useMemo(() => selected ? compareProjectVersions(currentProject, selected) : undefined, [currentProject, selected])
  const openSessions = mergeSessions.filter((session) => session.status === 'open' && session.conflicts.some((conflict) => conflict.status === 'open'))
  const resolvedSessions = mergeSessions.filter((session) => session.status === 'resolved')
  if (!open) return null
  return <div className="modal-backdrop" role="presentation"><section className="history-dialog" role="dialog" aria-modal="true" aria-labelledby="history-title">
    <header><div><span className="eyebrow">AUTOSAVE CHECKPOINTS</span><h2 id="history-title">프로젝트 버전 기록</h2></div><button className="icon-button" onClick={onClose} aria-label="닫기"><X size={17} /></button></header>
    <p>최근 자동 저장 5개가 이 기기에 보관됩니다. 복원 전 현재 상태도 다음 자동 저장에서 다시 기록됩니다.</p>
    {openSessions.length > 0 && <section className="merge-session-list"><header><div><strong>해결되지 않은 공동 작업 충돌</strong><small>{openSessions.reduce((total, session) => total + session.conflicts.filter((conflict) => conflict.status === 'open').length, 0)}개 · 결정은 프로젝트에 저장됩니다.</small></div></header>{[...openSessions].reverse().map((session) => <div className="merge-session" key={session.id}><div className="merge-session-meta"><strong>{session.incomingProjectName}</strong><small>병합 {new Date(session.createdAt).toLocaleString('ko-KR')} · 기준 {new Date(session.baseUpdatedAt).toLocaleString('ko-KR')}</small></div>{session.conflicts.filter((conflict) => conflict.status === 'open').map((conflict) => <article key={conflict.id}><div><span>{mergeConflictNames[conflict.kind]}</span><strong>{conflict.label}</strong><small>{conflict.detail}</small></div><nav>{conflict.sequenceId && <button onClick={() => onLocateConflict(session.id, conflict.id, 'current')}><MapPin size={12} /> 현재 위치</button>}{conflict.branchSequenceId && <button onClick={() => onLocateConflict(session.id, conflict.id, 'branch')}><GitFork size={12} /> 상대 분기</button>}{conflict.canApplyIncoming && <button className="incoming" onClick={() => onResolveConflict(session.id, conflict.id, 'incoming')}>{incomingDecisionLabel(conflict)}</button>}<button onClick={() => onResolveConflict(session.id, conflict.id, 'current')}><Check size={12} /> 현재 유지</button></nav></article>)}</div>)}</section>}
    {resolvedSessions.length > 0 && <details className="merge-session-archive"><summary>해결된 공동 작업 병합 {resolvedSessions.length}건</summary>{[...resolvedSessions].reverse().slice(0, 10).map((session) => <article key={session.id}><div><strong>{session.incomingProjectName}</strong><small>{new Date(session.createdAt).toLocaleString('ko-KR')} · 충돌 {session.conflicts.length}개 · 현재 유지 {session.conflicts.filter((conflict) => conflict.resolution === 'current').length} · 상대 적용 {session.conflicts.filter((conflict) => conflict.resolution === 'incoming').length}</small></div>{session.conflicts.map((conflict) => <div className="merge-resolution-history" key={conflict.id}><span>{mergeConflictNames[conflict.kind]} · {conflict.label} · {conflict.resolution === 'incoming' ? conflict.incomingDeleted ? '상대 삭제' : '상대 적용' : '현재 유지'}</span><nav><button className={conflict.resolution === 'current' ? 'selected' : ''} onClick={() => onResolveConflict(session.id, conflict.id, 'current')}>현재</button>{conflict.canApplyIncoming && <button className={conflict.resolution === 'incoming' ? 'selected' : ''} onClick={() => onResolveConflict(session.id, conflict.id, 'incoming')}>{conflict.incomingDeleted ? '상대 삭제' : '상대'}</button>}</nav></div>)}</article>)}</details>}
    <div className="history-list">{[...snapshots].reverse().map((snapshot, index) => <article className={selected === snapshot ? 'selected' : ''} key={`${snapshot.updatedAt}-${index}`}><History size={16} /><div><strong>{snapshot.name}</strong><small>{new Date(snapshot.updatedAt).toLocaleString('ko-KR')} · {snapshot.sequences?.length ?? 1}개 시퀀스</small></div><button onClick={() => setSelected(snapshot)}><GitCompareArrows size={13} /> 비교</button><button onClick={() => onRestore(snapshot)}><RotateCcw size={13} /> 전체 복원</button></article>)}</div>
    {selected && diff && <section className="version-diff"><header><div><strong>현재 작업과 비교</strong><small>{new Date(selected.updatedAt).toLocaleString('ko-KR')} 체크포인트</small></div><button onClick={() => setSelected(undefined)} aria-label="비교 닫기"><X size={13} /></button></header><div className="version-stats"><span>미디어 +{diff.assetsAdded} / -{diff.assetsRemoved}</span><span>시퀀스 +{diff.sequencesAdded} / -{diff.sequencesRemoved}</span><span>변경 {diff.sequencesChanged}</span><span>코멘트 차이 {diff.commentsChanged}</span><span>병합 결정 차이 {diff.mergeDecisionsChanged}</span></div><div className="version-merge"><input ref={mergeInputRef} hidden type="file" accept=".json,.editweave.json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) onMerge(selected, file); event.target.value = '' }} /><div><strong>공동 작업 3-way 병합</strong><small>이 체크포인트를 두 편집자의 공통 기준으로 사용합니다. 서로 다른 클립 변경은 자동 결합하고 같은 클립 충돌은 상대 시퀀스 분기로 보존합니다.</small></div><button onClick={() => mergeInputRef.current?.click()}><FileUp size={13} /> 상대 프로젝트 병합</button></div><div className="version-sequences">{diff.sequenceDiffs.filter((item) => item.status !== 'removed').map((item) => <article key={item.id}><div><strong>{item.name}</strong><small>{item.status === 'added' ? '이 버전에만 있음' : item.status === 'changed' ? '현재와 다름' : '동일'} · 클립 {item.currentClips} → {item.snapshotClips}</small></div><button onClick={() => onBranch(selected, item.id)}><GitFork size={13} /> 새 분기로 가져오기</button></article>)}</div><p>새 분기와 충돌 분기는 현재 작업을 덮어쓰지 않고 중첩 시퀀스·ADR 연결·누락 미디어를 새 ID로 함께 복사합니다.</p></section>}
    {!snapshots.length && <p className="history-empty">아직 복원 가능한 자동 저장 기록이 없습니다.</p>}
  </section></div>
}
