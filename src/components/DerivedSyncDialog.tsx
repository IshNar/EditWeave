import { GitCompareArrows, RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SourceGraphDomain } from '../editor/types'

const domainCopy: Record<SourceGraphDomain, { label: string; description: string }> = {
  video: { label: '영상 컷·효과', description: '클립 배치, 길이, 소스 구간과 원본 영상 효과' },
  audio: { label: '오디오·믹스', description: '오디오 트랙, 내장 음성, 버스와 레벨 설정' },
  transcript: { label: '대본·자막', description: '인식 대본, 단어 타이밍과 자막 트랙' },
  suggestions: { label: 'AI 편집 제안', description: '침묵·필러·반복·하이라이트 제안' },
  markers: { label: '마커', description: '챕터, 편집 지점과 검토 코멘트' },
  settings: { label: '시퀀스 설정', description: '프레임레이트, 타임코드와 전환 기본값' },
}

interface DerivedSyncDialogProps {
  open: boolean
  sourceName: string
  derivedName: string
  changedDomains: SourceGraphDomain[]
  legacySnapshot?: boolean
  onClose: () => void
  onApply: (domains: SourceGraphDomain[], preserveLocalEdits: boolean) => void
}

export function DerivedSyncDialog({ open, sourceName, derivedName, changedDomains, legacySnapshot, onClose, onApply }: DerivedSyncDialogProps) {
  const [selected, setSelected] = useState<SourceGraphDomain[]>([])
  const [preserveLocalEdits, setPreserveLocalEdits] = useState(true)

  useEffect(() => {
    if (!open) return
    setSelected(changedDomains)
    setPreserveLocalEdits(true)
  }, [changedDomains, open])

  if (!open) return null
  const toggle = (domain: SourceGraphDomain) => setSelected((current) => current.includes(domain) ? current.filter((item) => item !== domain) : [...current, domain])

  return <div className="modal-backdrop" role="presentation"><section className="derived-sync-dialog" role="dialog" aria-modal="true" aria-labelledby="derived-sync-title">
    <header><div><span className="eyebrow">CREATOR SOURCE GRAPH</span><h2 id="derived-sync-title">원본 변경 선택 반영</h2><p>“{sourceName}” → “{derivedName}”</p></div><button className="icon-button" onClick={onClose} aria-label="원본 변경 반영 닫기"><X size={17} /></button></header>
    <div className="derived-sync-summary"><GitCompareArrows size={20} /><div><strong>{changedDomains.length}개 영역의 변경을 감지했습니다.</strong><p>{legacySnapshot ? '기존 파생물이라 최초 동기화에서는 모든 영역을 검토합니다.' : '반영할 영역만 선택하면 나머지 변경은 나중에 이어서 반영할 수 있습니다.'}</p></div></div>
    <div className="derived-sync-domains">
      {changedDomains.map((domain) => <label key={domain} className="derived-sync-domain"><input type="checkbox" checked={selected.includes(domain)} onChange={() => toggle(domain)} /><span><strong>{domainCopy[domain].label}</strong><small>{domainCopy[domain].description}</small></span></label>)}
    </div>
    {(changedDomains.includes('video') || changedDomains.includes('audio')) && <label className="check-field derived-sync-preserve"><input type="checkbox" checked={preserveLocalEdits} onChange={(event) => setPreserveLocalEdits(event.target.checked)} /> 파생 쇼츠에서 직접 조정한 위치·색보정·키프레임·믹스 값 보존</label>}
    <footer><span>선택하지 않은 영역은 최신화 알림이 유지됩니다.</span><button className="secondary-button" onClick={onClose}>취소</button><button className="primary-button" disabled={!selected.length} onClick={() => onApply(selected, preserveLocalEdits)}><RefreshCw size={13} /> 선택 영역 반영</button></footer>
  </section></div>
}
