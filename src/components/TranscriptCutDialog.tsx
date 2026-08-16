import { Scissors, X } from 'lucide-react'
import { useState } from 'react'
import { formatTimecode } from '../editor/format'
import type { TranscriptSegment } from '../editor/types'

interface TranscriptCutDialogProps {
  segment?: TranscriptSegment
  affectedClips: number
  onClose: () => void
  onConfirm: (addAudioFades: boolean) => void
}

export function TranscriptCutDialog({ segment, affectedClips, onClose, onConfirm }: TranscriptCutDialogProps) {
  const [addAudioFades, setAddAudioFades] = useState(true)
  if (!segment) return null
  return <div className="modal-backdrop" role="presentation"><section className="transcript-cut-dialog" role="dialog" aria-modal="true" aria-labelledby="transcript-cut-title"><header><div><span className="eyebrow">TRANSCRIPT EDIT CONTRACT</span><h2 id="transcript-cut-title">대본 구간 제거 검토</h2></div><button className="icon-button" onClick={onClose} aria-label="닫기"><X size={17} /></button></header><div className="transcript-cut-summary"><Scissors size={18} /><div><strong>{formatTimecode(segment.start, true)} – {formatTimecode(segment.end, true)}</strong><p>총 {(segment.end - segment.start).toFixed(2)}초 · 영향받는 타임라인 클립 {affectedClips}개</p></div></div><blockquote>{segment.text}</blockquote><ul><li>잠금 해제된 모든 트랙에서 같은 시간 범위를 제거합니다.</li><li>뒤쪽 클립·대본·마커를 앞으로 당깁니다.</li><li>한 번의 실행 취소로 전체 변경을 되돌릴 수 있습니다.</li></ul><label className="check-field"><input type="checkbox" checked={addAudioFades} onChange={(event) => setAddAudioFades(event.target.checked)} /> 연결부 오디오에 80ms 페이드를 추가해 클릭음을 줄임</label><footer><button className="secondary-button" onClick={onClose}>유지</button><button className="primary-button" onClick={() => onConfirm(addAudioFades)}><Scissors size={13} /> 검토한 구간 제거</button></footer></section></div>
}
