import { FolderOpen, HardDrive, RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ScratchDiskKind, ScratchDiskPreferences } from '../platform/scratchDisks'
import { chooseScratchRoot, readScratchDiskUsage, resetScratchRoot, scratchKindLabel, scratchManagedDirectory, type ScratchDiskUsage } from '../platform/scratchDisks'

interface ScratchDiskDialogProps {
  open: boolean
  preferences: ScratchDiskPreferences
  onChange: (preferences: ScratchDiskPreferences) => void
  onClose: () => void
  onNotice: (message: string) => void
  onClear: (kind: 'proxy' | 'render') => Promise<void>
}

const kinds: ScratchDiskKind[] = ['proxy', 'recording', 'render']

export function ScratchDiskDialog({ open, preferences, onChange, onClose, onNotice, onClear }: ScratchDiskDialogProps) {
  const [usage, setUsage] = useState<Partial<Record<ScratchDiskKind, ScratchDiskUsage>>>({})
  const [clearing, setClearing] = useState<ScratchDiskKind | undefined>()
  useEffect(() => {
    if (!open) return
    let active = true
    void Promise.all(kinds.map(async (kind) => [kind, await readScratchDiskUsage(kind, preferences)] as const)).then((entries) => { if (active) setUsage(Object.fromEntries(entries)) }).catch(() => undefined)
    return () => { active = false }
  }, [open, preferences])
  if (!open) return null
  const select = async (kind: ScratchDiskKind) => {
    try {
      const next = await chooseScratchRoot(kind, preferences)
      if (!next) return
      onChange(next)
      onNotice(`${scratchKindLabel(kind)}의 새 저장 위치를 설정했습니다.`)
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '스크래치 디스크 경로를 설정하지 못했습니다.')
    }
  }
  const reset = (kind: ScratchDiskKind) => {
    onChange(resetScratchRoot(kind, preferences))
    onNotice(`${scratchKindLabel(kind)}을 앱 기본 저장소로 되돌렸습니다.`)
  }
  const clear = async (kind: 'proxy' | 'render') => {
    const current = usage[kind]
    if (!window.confirm(`${scratchKindLabel(kind)} ${formatUsage(current)}을 현재 저장 위치에서 정리할까요?\nADR 녹음과 디스크 원본은 건드리지 않습니다.`)) return
    setClearing(kind)
    try {
      await onClear(kind)
      setUsage((value) => ({ ...value, [kind]: { bytes: 0, files: 0 } }))
    } finally { setClearing(undefined) }
  }
  return <div className="modal-backdrop"><section className="scratch-disk-dialog" role="dialog" aria-modal="true" aria-labelledby="scratch-disk-title">
    <header><div><span className="eyebrow">SCRATCH DISKS</span><h2 id="scratch-disk-title">캐시 · 스크래치 디스크</h2></div><button className="icon-button" onClick={onClose} aria-label="닫기"><X size={17} /></button></header>
    <section className="scratch-disk-intro"><HardDrive size={21} /><div><strong>저장 영역을 디스크별로 분리</strong><small>고속 SSD의 별도 폴더를 지정하면 원본 프로젝트와 캐시·녹음·복구 구간을 분리할 수 있습니다.</small></div></section>
    <div className="scratch-disk-list">{kinds.map((kind) => {
      const root = kind === 'proxy' ? preferences.proxyRoot : kind === 'recording' ? preferences.recordingRoot : preferences.renderRoot
      const managed = scratchManagedDirectory(kind, preferences)
      return <article key={kind}><div className="scratch-disk-kind"><HardDrive size={16} /><div><strong>{scratchKindLabel(kind)}</strong><small>{kind === 'proxy' ? '편집용 저해상도 미디어' : kind === 'recording' ? 'ADR와 보이스오버 원본' : '중단된 렌더를 이어갈 구간 파일'} · {formatUsage(usage[kind])}</small></div></div><code title={managed ?? '앱 기본 저장소'}>{managed ?? '앱 기본 저장소'}</code><div><button disabled={Boolean(clearing)} onClick={() => void select(kind)}><FolderOpen size={13} /> 폴더 선택</button><button disabled={!root || Boolean(clearing)} onClick={() => reset(kind)}><RotateCcw size={12} /> 기본 위치</button>{kind !== 'recording' && <button className="danger" disabled={Boolean(clearing) || !usage[kind]?.files} onClick={() => void clear(kind)}><Trash2 size={12} /> {clearing === kind ? '정리 중…' : '정리'}</button>}</div></article>
    })}</div>
    <section className="scratch-disk-policy"><strong>경로 보호 정책</strong><p>선택한 폴더 아래의 Cutline 전용 하위 폴더만 생성·읽기·삭제 대상으로 허용합니다. 경로를 바꿔도 기존 프로젝트가 참조하는 이전 캐시는 유지됩니다.</p></section>
    <footer><button className="primary-button" onClick={onClose}>완료</button></footer>
  </section></div>
}

function formatUsage(value: ScratchDiskUsage | undefined): string {
  if (!value) return '계산 중…'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value.bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1 }
  return `${value.files.toLocaleString()}개 · ${size.toFixed(unit ? 1 : 0)} ${units[unit]}`
}
