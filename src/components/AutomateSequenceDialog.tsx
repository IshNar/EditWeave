import { useEffect, useState } from 'react'
import { ListVideo, X } from 'lucide-react'

export interface AutomateSequenceOptions {
  placement: 'sequential' | 'markers'
  editMode: 'insert' | 'overwrite'
  stillDuration: number
  transition: 'none' | 'crossfade'
  transitionDuration: number
  includeEmbeddedAudio: boolean
}

interface AutomateSequenceDialogProps {
  open: boolean
  assetNames: string[]
  markerCount: number
  onClose: () => void
  onApply: (options: AutomateSequenceOptions) => void
}

export function AutomateSequenceDialog({ open, assetNames, markerCount, onClose, onApply }: AutomateSequenceDialogProps) {
  const [placement, setPlacement] = useState<AutomateSequenceOptions['placement']>('sequential')
  const [editMode, setEditMode] = useState<AutomateSequenceOptions['editMode']>('insert')
  const [stillDuration, setStillDuration] = useState(5)
  const [transition, setTransition] = useState<AutomateSequenceOptions['transition']>('none')
  const [transitionDuration, setTransitionDuration] = useState(0.5)
  const [includeEmbeddedAudio, setIncludeEmbeddedAudio] = useState(true)
  useEffect(() => { if (placement === 'markers') setEditMode('overwrite') }, [placement])
  if (!open) return null
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="automate-sequence-dialog" role="dialog" aria-modal="true" aria-labelledby="automate-sequence-title">
      <header><div><span className="eyebrow">AUTOMATE TO SEQUENCE</span><h2 id="automate-sequence-title">시퀀스 자동 배치</h2><p>현재 미디어 정렬 순서대로 {assetNames.length}개 소스를 배치합니다.</p></div><button className="icon-button" onClick={onClose} aria-label="닫기"><X size={17} /></button></header>
      <div className="automate-source-summary"><ListVideo size={18} /><div>{assetNames.slice(0, 4).map((name, index) => <span key={`${name}-${index}`}>{name}</span>)}{assetNames.length > 4 && <small>외 {assetNames.length - 4}개</small>}</div></div>
      <div className="automate-fields">
        <label><span>배치 기준</span><select value={placement} onChange={(event) => setPlacement(event.target.value as AutomateSequenceOptions['placement'])}><option value="sequential">재생 헤드부터 연속</option><option value="markers" disabled={!markerCount}>시퀀스 마커 ({markerCount}개)</option></select></label>
        <label><span>편집 방식</span><select value={editMode} disabled={placement === 'markers'} onChange={(event) => setEditMode(event.target.value as AutomateSequenceOptions['editMode'])}><option value="insert">삽입 · 뒤 타임라인 밀기</option><option value="overwrite">덮어쓰기</option></select></label>
        <label><span>스틸 이미지 길이</span><input type="number" min="0.1" max="3600" step="0.1" value={stillDuration} onChange={(event) => setStillDuration(Math.max(0.1, Math.min(3600, Number(event.target.value) || 5)))} /></label>
        <label><span>기본 전환</span><select value={transition} onChange={(event) => setTransition(event.target.value as AutomateSequenceOptions['transition'])}><option value="none">없음</option><option value="crossfade">교차 디졸브·페이드</option></select></label>
        <label><span>전환 길이</span><input type="number" min="0.03" max="10" step="0.05" disabled={transition === 'none'} value={transitionDuration} onChange={(event) => setTransitionDuration(Math.max(0.03, Math.min(10, Number(event.target.value) || 0.5)))} /></label>
        <label className="automate-check"><input type="checkbox" checked={includeEmbeddedAudio} onChange={(event) => setIncludeEmbeddedAudio(event.target.checked)} /><span>영상 내장 오디오를 A 소스 대상 트랙에 연결</span></label>
      </div>
      <footer><span>{placement === 'markers' ? '각 클립은 다음 마커 이전까지로 제한되며 기존 구간을 덮어씁니다.' : '소스 대상 트랙과 동기화 잠금 상태를 따릅니다.'}</span><button onClick={onClose}>취소</button><button className="primary" onClick={() => onApply({ placement, editMode, stillDuration, transition, transitionDuration, includeEmbeddedAudio })}>자동 배치</button></footer>
    </section>
  </div>
}
