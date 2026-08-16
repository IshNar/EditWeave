import { Archive, Scissors, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ProjectArchiveOptions } from '../platform/projectFiles'

interface ProjectManagerDialogProps {
  open: boolean
  running: boolean
  onClose: () => void
  onStart: (options: ProjectArchiveOptions) => void
}

const defaults: ProjectArchiveOptions = { mediaMode: 'full', handleSeconds: 2, includeUnused: true, includeProxies: true }

export function ProjectManagerDialog({ open, running, onClose, onStart }: ProjectManagerDialogProps) {
  const [options, setOptions] = useState<ProjectArchiveOptions>(defaults)
  useEffect(() => { if (open && !running) setOptions(defaults) }, [open, running])
  if (!open) return null
  const trimmed = options.mediaMode === 'used-range'
  return <div className="modal-backdrop"><section className="project-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="project-manager-title">
    <header><div><span className="eyebrow">PROJECT MANAGER</span><h2 id="project-manager-title">프로젝트 수집 · 이동</h2></div><button className="icon-button" disabled={running} onClick={onClose} aria-label="닫기"><X size={17} /></button></header>
    <div className="project-manager-modes">
      <button className={!trimmed ? 'selected' : ''} disabled={running} onClick={() => setOptions((current) => ({ ...current, mediaMode: 'full', includeProxies: true }))}><Archive size={18} /><strong>전체 원본 복사</strong><small>원본과 선택한 프록시를 손대지 않고 이동 가능한 폴더로 수집합니다.</small></button>
      <button className={trimmed ? 'selected' : ''} disabled={running} onClick={() => setOptions((current) => ({ ...current, mediaMode: 'used-range', includeUnused: false, includeProxies: false }))}><Scissors size={18} /><strong>사용 범위 + 핸들</strong><small>모든 시퀀스가 참조하는 소스 범위만 수집하고 프로젝트 인/아웃을 새 원본에 맞춥니다.</small></button>
    </div>
    {trimmed && <label className="project-manager-handle"><span>양쪽 핸들</span><input type="number" min="0" max="120" step="0.5" value={options.handleSeconds} disabled={running} onChange={(event) => setOptions((current) => ({ ...current, handleSeconds: Math.max(0, Math.min(120, Number(event.target.value) || 0)) }))} /><small>초</small></label>}
    <div className="project-manager-checks">
      <label><input type="checkbox" checked={options.includeUnused} disabled={running} onChange={(event) => setOptions((current) => ({ ...current, includeUnused: event.target.checked }))} /><span><strong>미사용 프로젝트 미디어 포함</strong><small>어떤 시퀀스와 ADR 테이크에서도 사용하지 않은 원본도 수집합니다.</small></span></label>
      <label><input type="checkbox" checked={options.includeProxies} disabled={running || trimmed} onChange={(event) => setOptions((current) => ({ ...current, includeProxies: event.target.checked }))} /><span><strong>프록시 포함</strong><small>{trimmed ? '사용 범위 수집에서는 새 소스 시간과 맞지 않는 기존 프록시를 제외합니다.' : '현재 생성된 편집 프록시를 Proxies 폴더에 함께 복사합니다.'}</small></span></label>
    </div>
    <section className="project-manager-note"><strong>원본 보호</strong><p>현재 프로젝트와 디스크 원본은 변경하지 않습니다. 수집 폴더 안에 독립 프로젝트 파일과 매니페스트를 새로 만듭니다.</p></section>
    <footer><button className="secondary-button" disabled={running} onClick={onClose}>취소</button><button className="primary-button" disabled={running} onClick={() => onStart(options)}>{running ? '프로젝트 수집 중…' : '수집 폴더 만들기'}</button></footer>
  </section></div>
}
