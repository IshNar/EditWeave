import { CopyPlus, CornerUpLeft, Plus, RefreshCw, X } from 'lucide-react'
import type { ProjectSequence } from '../editor/types'

interface SequenceTabsProps {
  sequences: ProjectSequence[]
  activeSequenceId: string
  staleSequenceIds: ReadonlySet<string>
  onSelect: (id: string) => void
  onDuplicate: (id: string) => void
  onClose: (id: string) => void
  onReturnToSource: () => void
  onManage: () => void
}

const kindLabel: Record<ProjectSequence['kind'], string> = { main: 'SEQ', shorts: 'SHORT', nested: 'NEST', multicam: 'MC' }

export function SequenceTabs({ sequences, activeSequenceId, staleSequenceIds, onSelect, onDuplicate, onClose, onReturnToSource, onManage }: SequenceTabsProps) {
  const activeSequence = sequences.find((sequence) => sequence.id === activeSequenceId)
  const sourceSequence = activeSequence?.sourceSequenceId ? sequences.find((sequence) => sequence.id === activeSequence.sourceSequenceId) : undefined
  return <nav className="sequence-tabs" aria-label="열린 시퀀스">
    {sourceSequence && <button className="sequence-parent-return" onClick={onReturnToSource} title={`${sourceSequence.name}의 중첩 클립 위치로 돌아가기`}><CornerUpLeft size={12} /><span>{sourceSequence.name}</span></button>}
    <div className="sequence-tab-scroll">{sequences.map((sequence) => {
      const active = sequence.id === activeSequenceId
      return <div key={sequence.id} className={`sequence-tab ${active ? 'active' : ''} kind-${sequence.kind}`}>
        <button className="sequence-tab-open" onClick={() => onSelect(sequence.id)} title={`${sequence.name} · ${sequence.width}×${sequence.height} · ${sequence.fps}fps`}><small>{kindLabel[sequence.kind]}</small><span>{sequence.name}</span>{staleSequenceIds.has(sequence.id) && <RefreshCw size={10} aria-label="원본 변경 있음" />}</button>
        {active && <button className="sequence-tab-action" onClick={() => onDuplicate(sequence.id)} title="활성 시퀀스 복제"><CopyPlus size={11} /></button>}
        <button className="sequence-tab-action close" disabled={sequences.length <= 1} onClick={() => onClose(sequence.id)} title="시퀀스 닫기·삭제"><X size={11} /></button>
      </div>
    })}</div>
    <button className="sequence-tab-add" onClick={onManage} title="시퀀스 만들기·관리"><Plus size={13} /></button>
  </nav>
}
