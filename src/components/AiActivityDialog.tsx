import { BrainCircuit, CheckCircle2, CircleAlert, Clock3, Cpu, Network, RotateCcw, X, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AiActivityRecord } from '../editor/types'

interface AiActivityDialogProps {
  open: boolean
  records: AiActivityRecord[]
  onClose: () => void
}

const statusCopy: Record<AiActivityRecord['status'], string> = { running: '실행 중', completed: '완료', failed: '실패', cancelled: '취소' }

export function AiActivityDialog({ open, records, onClose }: AiActivityDialogProps) {
  const [filter, setFilter] = useState<'all' | 'local' | 'external'>('all')
  const visible = useMemo(() => [...records].reverse().filter((record) => filter === 'all' || (filter === 'local' ? record.processing.location === 'local-device' : record.processing.location === 'external-user-service')), [filter, records])
  if (!open) return null

  return <div className="modal-backdrop" role="presentation"><section className="ai-activity-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-activity-title">
    <header><div><span className="eyebrow">EXPLAINABLE LOCAL AI</span><h2 id="ai-activity-title">AI 활동 기록</h2><p>입력 범위, 처리 위치, 실행 이유, 변경 결과와 복구 방법을 프로젝트에 함께 저장합니다.</p></div><button className="icon-button" onClick={onClose} aria-label="AI 활동 기록 닫기"><X size={17} /></button></header>
    <div className="ai-activity-summary"><BrainCircuit size={22} /><div><strong>기록 {records.length}건</strong><p>로컬 {records.filter((record) => record.processing.location === 'local-device').length} · 외부 승인 {records.filter((record) => record.processing.location === 'external-user-service').length} · 실패/취소 {records.filter((record) => record.status === 'failed' || record.status === 'cancelled').length}</p></div><nav><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>전체</button><button className={filter === 'local' ? 'active' : ''} onClick={() => setFilter('local')}>로컬</button><button className={filter === 'external' ? 'active' : ''} onClick={() => setFilter('external')}>외부</button></nav></div>
    <div className="ai-activity-list">
      {visible.map((record) => <article key={record.id} className={`ai-activity-card ${record.status}`}><div className="ai-activity-card-title"><span>{record.processing.location === 'local-device' ? <Cpu size={14} /> : <Network size={14} />}</span><div><strong>{record.label}</strong><small>{new Date(record.createdAt).toLocaleString('ko-KR')} · {record.processing.processor}</small></div><em>{record.status === 'completed' ? <CheckCircle2 size={12} /> : record.status === 'running' ? <Clock3 size={12} /> : record.status === 'cancelled' ? <XCircle size={12} /> : <CircleAlert size={12} />}{statusCopy[record.status]}</em></div><dl><div><dt>입력</dt><dd>{record.input.summary}<small>{record.input.dataCategories.join(' · ')}</small></dd></div><div><dt>이유</dt><dd>{record.reason}</dd></div><div><dt>결과</dt><dd>{record.changes?.summary ?? (record.status === 'running' ? '처리 중이며 아직 프로젝트 변경 없음' : record.error ?? '프로젝트 변경 없음')}</dd></div><div><dt>복구</dt><dd className={record.undo.available ? 'undoable' : ''}><RotateCcw size={11} /> {record.undo.description}</dd></div></dl>{record.error && <p className="ai-activity-error">{record.error}</p>}</article>)}
      {!visible.length && <div className="ai-activity-empty"><BrainCircuit size={24} /><strong>표시할 AI 활동이 없습니다.</strong><p>전사, 초벌 분석, AI 제안 적용과 쇼츠 생성 기록이 여기에 나타납니다.</p></div>}
    </div>
    <footer>최대 250개의 구조화된 기록을 프로젝트 파일과 자동 저장에 보관합니다.</footer>
  </section></div>
}
