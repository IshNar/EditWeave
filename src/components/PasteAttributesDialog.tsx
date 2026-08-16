import { useEffect, useState } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'

export interface PasteAttributeOptions {
  motion: boolean
  colorEffects: boolean
  speed: boolean
  audio: boolean
  transitions: boolean
  captions: boolean
}

interface PasteAttributesDialogProps {
  open: boolean
  sourceName: string
  targetCount: number
  sourceKind: 'video' | 'audio' | 'caption'
  onClose: () => void
  onApply: (options: PasteAttributeOptions) => void
}

const initialOptions: PasteAttributeOptions = {
  motion: true,
  colorEffects: true,
  speed: true,
  audio: true,
  transitions: true,
  captions: true,
}

export function PasteAttributesDialog({ open, sourceName, targetCount, sourceKind, onClose, onApply }: PasteAttributesDialogProps) {
  const [options, setOptions] = useState(initialOptions)
  useEffect(() => { if (open) setOptions(initialOptions) }, [open, sourceName])
  if (!open) return null
  const entries: Array<{ key: keyof PasteAttributeOptions; label: string; detail: string; available: boolean }> = [
    { key: 'motion', label: '모션 · 불투명도', detail: '위치, 크기, 회전, 불투명도와 모션 키프레임', available: sourceKind === 'video' },
    { key: 'colorEffects', label: '색보정 · 비디오 효과', detail: '색상 노드, 마스크, 효과 스택과 효과 키프레임', available: sourceKind === 'video' },
    { key: 'speed', label: '속도', detail: '재생 속도, 속도 램프, 역재생과 프레임 보간', available: sourceKind !== 'caption' },
    { key: 'audio', label: '오디오', detail: '게인, EQ, 다이내믹, 라우팅과 믹스 키프레임', available: sourceKind !== 'caption' },
    { key: 'transitions', label: '트랜지션', detail: '클립 시작·끝 트랜지션 설정', available: sourceKind !== 'caption' },
    { key: 'captions', label: '자막 스타일', detail: '글꼴, 배치, 배경, 애니메이션과 템플릿', available: sourceKind === 'caption' },
  ]
  const selectedCount = entries.filter((entry) => entry.available && options[entry.key]).length
  const setAll = (enabled: boolean) => setOptions(Object.fromEntries(Object.keys(initialOptions).map((key) => [key, enabled])) as unknown as PasteAttributeOptions)
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="paste-attributes-dialog" role="dialog" aria-modal="true" aria-labelledby="paste-attributes-title">
      <header><div><span className="eyebrow">PASTE ATTRIBUTES</span><h2 id="paste-attributes-title">속성 붙여넣기</h2><p>“{sourceName}”의 선택한 속성을 {targetCount}개 대상 클립에 적용합니다.</p></div><button className="icon-button" onClick={onClose} aria-label="닫기"><X size={17} /></button></header>
      <div className="paste-attributes-actions"><button onClick={() => setAll(true)}>전체 선택</button><button onClick={() => setAll(false)}>전체 해제</button></div>
      <div className="paste-attributes-list">{entries.map((entry) => <label key={entry.key} className={!entry.available ? 'disabled' : ''}><input type="checkbox" disabled={!entry.available} checked={entry.available && options[entry.key]} onChange={(event) => setOptions((current) => ({ ...current, [entry.key]: event.target.checked }))} /><SlidersHorizontal size={15} /><span><strong>{entry.label}</strong><small>{entry.available ? entry.detail : '복사한 클립 종류에는 적용되지 않습니다.'}</small></span></label>)}</div>
      <footer><span>잠긴 트랙과 호환되지 않는 클립은 변경하지 않습니다.</span><button onClick={onClose}>취소</button><button className="primary" disabled={!selectedCount || !targetCount} onClick={() => onApply(options)}>선택 속성 적용</button></footer>
    </section>
  </div>
}
