import { Check, Scissors, Smartphone, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatTimecode } from '../editor/format'
import type { AspectRatio, ShortsCandidate } from '../editor/types'

interface ShortsDialogProps {
  open: boolean
  candidates: ShortsCandidate[]
  onClose: () => void
  onCreate: (candidates: ShortsCandidate[], aspectRatio: Exclude<AspectRatio, '16:9'>) => void
}

export function ShortsDialog({ open, candidates, onClose, onCreate }: ShortsDialogProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [aspectRatio, setAspectRatio] = useState<Exclude<AspectRatio, '16:9'>>('9:16')

  useEffect(() => {
    if (!open) return
    const recommended = candidates.find((candidate) => candidate.targetDuration === 30) ?? candidates[0]
    setSelectedIds(recommended ? [recommended.id] : [])
    setAspectRatio('9:16')
  }, [candidates, open])

  if (!open) return null

  const selected = candidates.filter((candidate) => selectedIds.includes(candidate.id))
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="shorts-dialog" role="dialog" aria-modal="true" aria-labelledby="shorts-title">
        <header>
          <div><span className="eyebrow">LONG-FORM → SHORTS</span><h2 id="shorts-title">쇼츠 버전 만들기</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="쇼츠 만들기 닫기"><X size={17} /></button>
        </header>

        <div className="shorts-intro">
          <span><Smartphone size={23} /></span>
          <div><strong>원본을 보존한 파생 시퀀스</strong><p>선택 구간만 복제하고 선택한 플랫폼 화면비로 자동 리프레임합니다.</p></div>
        </div>

        <label className="shorts-ratio"><span>파생 화면비</span><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as Exclude<AspectRatio, '16:9'>)}><option value="9:16">9:16 · YouTube Shorts / Reels</option><option value="4:5">4:5 · 피드 세로형</option><option value="1:1">1:1 · 정사각형</option></select></label>

        <div className="candidate-list" aria-label="쇼츠 길이 후보">
          {candidates.map((candidate) => {
            const checked = selectedIds.includes(candidate.id)
            return (
              <label className={`candidate-option ${checked ? 'selected' : ''}`} key={candidate.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => setSelectedIds((current) => checked ? current.filter((id) => id !== candidate.id) : [...current, candidate.id])}
                />
                <span className="candidate-duration">{candidate.targetDuration}<small>SEC</small></span>
                <span className="candidate-copy"><strong>{candidate.title}</strong><small>{formatTimecode(candidate.start)}–{formatTimecode(candidate.end)} · 추천도 {Math.round(candidate.score * 100)}%</small><em>“{candidate.hook}”</em>{candidate.reason && <small>{candidate.reason}</small>}</span>
                <span className="candidate-check">{checked && <Check size={13} />}</span>
              </label>
            )
          })}
        </div>

        {!candidates.length && <p className="shorts-empty"><Sparkles size={17} /> 타임라인이나 대본이 있어야 후보를 만들 수 있습니다.</p>}

        <footer>
          <span><Scissors size={13} /> 생성 후 인스펙터에서 클립별 구도를 수정할 수 있습니다.</span>
          <div>
            <button className="secondary-button" onClick={onClose}>닫기</button>
            <button className="primary-button" disabled={!selected.length} onClick={() => onCreate(selected, aspectRatio)}><Smartphone size={15} /> {selected.length || ''}개 버전 생성</button>
          </div>
        </footer>
      </section>
    </div>
  )
}
