import { Download, GitCompareArrows, RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SourceGraphBatchInspection } from '../editor/sourceGraph'
import type { SourceGraphDomain } from '../editor/types'

const labels: Record<SourceGraphDomain, string> = {
  video: '영상', audio: '오디오', transcript: '대본·자막', suggestions: 'AI 제안', markers: '마커', settings: '설정',
}

interface SourceGraphBatchDialogProps {
  open: boolean
  inspection: SourceGraphBatchInspection
  onClose: () => void
  onApply: (sequenceIds: string[], preserveLocalEdits: boolean, openExport: boolean) => void
}

export function SourceGraphBatchDialog({ open, inspection, onClose, onApply }: SourceGraphBatchDialogProps) {
  const actionableIds = inspection.entries.filter((entry) => !entry.missingSource).map((entry) => entry.derivedSequenceId)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [preserveLocalEdits, setPreserveLocalEdits] = useState(true)
  const [openExport, setOpenExport] = useState(false)

  useEffect(() => {
    if (!open) return
    setSelectedIds(actionableIds)
    setPreserveLocalEdits(true)
    setOpenExport(false)
  }, [open, inspection])

  if (!open) return null
  const allSelected = actionableIds.length > 0 && actionableIds.every((id) => selectedIds.includes(id))
  const toggle = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const toggleAll = () => setSelectedIds(allSelected ? [] : actionableIds)

  return <div className="modal-backdrop" role="presentation"><section className="source-graph-batch-dialog" role="dialog" aria-modal="true" aria-labelledby="source-graph-batch-title">
    <header><div><span className="eyebrow">CREATOR SOURCE GRAPH</span><h2 id="source-graph-batch-title">파생물 일괄 재검사</h2><p>원본 변경이 있는 쇼츠를 검토하고 안전하게 한 번에 동기화합니다.</p></div><button className="icon-button" onClick={onClose} aria-label="일괄 재검사 닫기"><X size={17} /></button></header>
    <div className="source-graph-batch-summary"><GitCompareArrows size={21} /><div><strong>업데이트 필요 {inspection.entries.length}개</strong><p>{Object.entries(inspection.domainCounts).filter(([, count]) => count > 0).map(([domain, count]) => `${labels[domain as SourceGraphDomain]} ${count}`).join(' · ')}</p></div>{inspection.missingSourceCount > 0 && <em>원본 누락 {inspection.missingSourceCount}</em>}</div>
    <div className="source-graph-batch-toolbar"><label><input type="checkbox" checked={allSelected} onChange={toggleAll} /> 반영 가능한 파생물 전체 선택</label><span>{selectedIds.length}/{actionableIds.length}개 선택</span></div>
    <div className="source-graph-batch-list">
      {inspection.entries.map((entry) => <label key={entry.derivedSequenceId} className={entry.missingSource ? 'missing' : ''}><input type="checkbox" disabled={entry.missingSource} checked={selectedIds.includes(entry.derivedSequenceId)} onChange={() => toggle(entry.derivedSequenceId)} /><span><strong>{entry.derivedName}</strong><small>{entry.sourceName ? `원본 · ${entry.sourceName}` : '원본 시퀀스 누락'}</small></span><div>{entry.changedDomains.map((domain) => <b key={domain}>{labels[domain]}</b>)}</div></label>)}
    </div>
    <div className="source-graph-batch-options"><label className="check-field"><input type="checkbox" checked={preserveLocalEdits} onChange={(event) => setPreserveLocalEdits(event.target.checked)} /> 파생 쇼츠의 리프레임·색보정·키프레임·믹스 보존</label><label className={`check-field ${!allSelected ? 'disabled' : ''}`}><input type="checkbox" disabled={!allSelected} checked={openExport && allSelected} onChange={(event) => setOpenExport(event.target.checked)} /> 전체 동기화 후 쇼츠 일괄 출력 창 열기</label></div>
    <footer><span>원본이 누락된 파생물은 변경하지 않습니다.</span><button className="secondary-button" onClick={onClose}>취소</button><button className="primary-button" disabled={!selectedIds.length} onClick={() => onApply(selectedIds, preserveLocalEdits, openExport && allSelected)}>{openExport && allSelected ? <Download size={13} /> : <RefreshCw size={13} />} {selectedIds.length}개 동기화</button></footer>
  </section></div>
}
