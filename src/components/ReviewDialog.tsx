import { CheckCircle2, Copy, Download, FileUp, Link2, MessageSquarePlus, PackageOpen, Radio, Square, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { TimelineMarker } from '../editor/types'
import { formatMediaTimecode } from '../media/timecode'
import type { LanReviewSession } from '../platform/lanReview'

interface ReviewDialogProps {
  open: boolean
  markers: TimelineMarker[]
  playhead: number
  fps: number
  timecodeStart: number
  timecodeDropFrame: boolean
  onClose: () => void
  onAdd: (label: string, author: string) => void
  onUpdate: (id: string, patch: Partial<TimelineMarker>) => void
  onRemove: (id: string) => void
  onSeek: (time: number) => void
  onExport: () => void
  onExportPackage: () => void
  onImportPackage: (file: File) => void
  lanSession?: LanReviewSession
  lanBusy?: boolean
  lanError?: string
  onStartLan: () => void
  onStopLan: () => void
  onCopyLan: () => void
}

export function ReviewDialog({ open, markers, playhead, fps, timecodeStart, timecodeDropFrame, onClose, onAdd, onUpdate, onRemove, onSeek, onExport, onExportPackage, onImportPackage, lanSession, lanBusy, lanError, onStartLan, onStopLan, onCopyLan }: ReviewDialogProps) {
  const [label, setLabel] = useState('')
  const [author, setAuthor] = useState('편집자')
  const importRef = useRef<HTMLInputElement>(null)
  if (!open) return null
  const reviewMarkers = markers.filter((marker) => marker.kind === 'comment')
  const sequenceTimecode = (time: number) => formatMediaTimecode(timecodeStart + time, fps, timecodeDropFrame)
  return <div className="modal-backdrop"><section className="review-dialog" role="dialog" aria-modal="true" aria-labelledby="review-title"><header><div><span className="eyebrow">TIMECODE REVIEW</span><h2 id="review-title">검토 코멘트</h2></div><button className="icon-button" onClick={onClose} aria-label="검토 닫기"><X size={17} /></button></header><section className="lan-review-bar">{lanSession ? <><span className="lan-live"><Radio size={13} /> LAN LIVE</span><code>{lanSession.url}</code><button onClick={onCopyLan}><Copy size={13} /> 링크 복사</button><button onClick={onStopLan}><Square size={12} /> 종료</button></> : <><div><strong><Link2 size={14} /> 업로드 없는 검토 링크</strong><small>완성 MP4를 이 컴퓨터에서 같은 네트워크의 브라우저로 직접 스트리밍합니다.</small></div><button onClick={onStartLan} disabled={lanBusy}>{lanBusy ? '링크 여는 중…' : 'LAN 검토 시작'}</button></>}{lanError && <p>{lanError}</p>}</section><form className="review-compose" onSubmit={(event) => { event.preventDefault(); if (!label.trim()) return; onAdd(label.trim(), author.trim() || '편집자'); setLabel('') }}><span>{sequenceTimecode(playhead)}</span><input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="작성자" aria-label="코멘트 작성자" /><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="이 시점에 남길 검토 의견" autoFocus /><button disabled={!label.trim()}><MessageSquarePlus size={13} /> 추가</button></form><input ref={importRef} hidden type="file" accept=".json,.editweave-review.json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImportPackage(file); event.target.value = '' }} /><div className="review-list">{reviewMarkers.map((marker) => <article className={marker.status === 'resolved' ? 'resolved' : ''} key={marker.id}><button className="review-time" onClick={() => onSeek(marker.time)}>{sequenceTimecode(marker.time)}</button><div><input value={marker.label} onChange={(event) => onUpdate(marker.id, { label: event.target.value })} /><small>{marker.author ?? '편집자'} · {marker.createdAt ? new Date(marker.createdAt).toLocaleString('ko-KR') : '이전 프로젝트'}</small></div><button className="review-resolve" onClick={() => onUpdate(marker.id, { status: marker.status === 'resolved' ? 'open' : 'resolved' })}><CheckCircle2 size={14} /> {marker.status === 'resolved' ? '다시 열기' : '해결'}</button><button className="review-remove" onClick={() => onRemove(marker.id)}>삭제</button></article>)}{!reviewMarkers.length && <p>아직 검토 코멘트가 없습니다. 재생 헤드 위치에 첫 의견을 남겨보세요.</p>}</div><footer><span>검토 패키지는 ID 기준으로 변경·추가 코멘트를 병합합니다.</span><button className="secondary-button" onClick={() => importRef.current?.click()}><FileUp size={13} /> 패키지 병합</button><button className="secondary-button" onClick={onExportPackage} disabled={!reviewMarkers.length}><PackageOpen size={13} /> 패키지 내보내기</button><button className="secondary-button" onClick={onExport} disabled={!reviewMarkers.length}><Download size={13} /> CSV</button></footer></section></div>
}
