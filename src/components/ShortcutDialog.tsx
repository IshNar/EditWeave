import { Keyboard, RotateCcw, X } from 'lucide-react'
import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { defaultShortcuts, shortcutFromEvent, shortcutLabels, type EditorCommand, type ShortcutMap } from '../platform/shortcuts'

interface ShortcutDialogProps {
  open: boolean
  shortcuts: ShortcutMap
  onChange: (shortcuts: ShortcutMap) => void
  onClose: () => void
}

export function ShortcutDialog({ open, shortcuts, onChange, onClose }: ShortcutDialogProps) {
  const [recording, setRecording] = useState<EditorCommand | undefined>()
  if (!open) return null
  const assign = (command: EditorCommand, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      setRecording(undefined)
      return
    }
    const binding = shortcutFromEvent(event)
    if (!binding || binding.endsWith('Mod') || binding.endsWith('Alt') || binding.endsWith('Shift')) return
    const duplicate = shortcutLabels.find((item) => item.command !== command && shortcuts[item.command] === binding)?.command
    onChange({ ...shortcuts, ...(duplicate ? { [duplicate]: '' } : {}), [command]: binding })
    setRecording(undefined)
  }
  const groups = [...new Set(shortcutLabels.map((item) => item.group))]
  return <div className="modal-backdrop" role="presentation"><section className="shortcut-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcut-title"><header><div><span className="eyebrow">KEYBOARD WORKFLOW</span><h2 id="shortcut-title">키보드 단축키</h2></div><button className="icon-button" onClick={onClose} aria-label="단축키 닫기"><X size={17} /></button></header><div className="shortcut-groups">{groups.map((group) => <section key={group}><h3>{group}</h3>{shortcutLabels.filter((item) => item.group === group).map((item) => <label key={item.command}><span>{item.label}</span><button className={recording === item.command ? 'recording' : ''} onClick={() => setRecording(item.command)} onKeyDown={(event) => recording === item.command && assign(item.command, event)} autoFocus={recording === item.command}>{recording === item.command ? '키를 누르세요…' : shortcuts[item.command] || '지정 안 함'}</button></label>)}</section>)}</div><footer><button className="secondary-button" onClick={() => onChange({ ...defaultShortcuts })}><RotateCcw size={12} /> 기본값</button><span><Keyboard size={12} /> 중복 키를 지정하면 이전 명령은 해제됩니다.</span><button className="secondary-button" onClick={onClose}>닫기</button></footer></section></div>
}
