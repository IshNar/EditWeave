import { CheckSquare2, Flag, Scissors, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatTimecode } from '../editor/format'

export interface SceneReviewPoint {
  id: string
  timelineTime: number
  sourceTime: number
  score: number
}

interface SceneDetectionDialogProps {
  open: boolean
  clipName: string
  points: SceneReviewPoint[]
  onClose: () => void
  onAddMarkers: (points: SceneReviewPoint[]) => void
  onSplit: (points: SceneReviewPoint[]) => void
}

export function SceneDetectionDialog({ open, clipName, points, onClose, onAddMarkers, onSplit }: SceneDetectionDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  useEffect(() => setSelected(new Set(points.map((point) => point.id))), [points])
  if (!open) return null
  const chosen = points.filter((point) => selected.has(point.id))
  const toggleAll = () => setSelected(selected.size === points.length ? new Set() : new Set(points.map((point) => point.id)))
  return <div className="modal-backdrop" role="presentation">
    <section className="scene-detection-dialog" role="dialog" aria-modal="true" aria-labelledby="scene-detection-title">
      <header><div><span className="eyebrow">NON-DESTRUCTIVE SCENE DETECTION</span><h2 id="scene-detection-title">장면 전환 검토</h2><p>{clipName}에서 감지한 후보를 먼저 검토합니다.</p></div><button className="icon-button" onClick={onClose} aria-label="장면 전환 검토 닫기"><X size={17} /></button></header>
      <div className="scene-review-tools"><button onClick={toggleAll}>{selected.size === points.length ? <CheckSquare2 size={12} /> : <Square size={12} />} 전체 선택</button><span>{chosen.length}/{points.length}개 선택</span></div>
      <div className="scene-review-list">
        {points.map((point, index) => <label key={point.id}><input type="checkbox" checked={selected.has(point.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(point.id); else next.delete(point.id); return next })} /><strong>장면 {index + 1}</strong><span>{formatTimecode(point.timelineTime, true)}</span><small>감지 신뢰도 {Math.round(point.score * 100)}%</small></label>)}
        {!points.length && <div className="scene-review-empty">뚜렷한 장면 전환을 찾지 못했습니다.</div>}
      </div>
      <footer><p>마커는 원본 클립을 바꾸지 않습니다. 분할은 실행 취소할 수 있습니다.</p><div><button className="secondary-button" onClick={onClose}>취소</button><button className="secondary-button" disabled={!chosen.length} onClick={() => onAddMarkers(chosen)}><Flag size={12} /> 마커 추가</button><button className="primary-button" disabled={!chosen.length} onClick={() => onSplit(chosen)}><Scissors size={12} /> 선택 지점 분할</button></div></footer>
    </section>
  </div>
}
