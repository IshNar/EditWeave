import { AlertTriangle, Check, Clock3, Copy, Film, GitBranch, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AdrCue, AspectRatio, ProjectSequence } from '../editor/types'
import type { SequenceDeleteAssessment } from '../editor/sequenceManagement'
import { formatTimecode } from '../editor/format'
import { formatMediaTimecode, parseMediaTimecode } from '../media/timecode'
import { normalizeSequenceTransitionDefaults } from '../editor/transitions'

interface SequenceManagerDialogProps {
  open: boolean
  sequences: ProjectSequence[]
  activeSequenceId: string
  adrCues: AdrCue[]
  deleteAssessments: SequenceDeleteAssessment[]
  onClose: () => void
  onCreate: (settings: SequenceCreateSettings) => void
  onSelect: (sequenceId: string) => void
  onRename: (sequenceId: string, name: string) => boolean
  onUpdateSettings: (sequenceId: string, patch: Pick<ProjectSequence, 'aspectRatio' | 'width' | 'height' | 'fps' | 'timecodeStart' | 'timecodeDropFrame' | 'transitionDefaults'>) => void
  onDuplicate: (sequenceId: string) => void
  onDelete: (sequenceId: string) => void
}

export interface SequenceCreateSettings {
  name: string
  width: number
  height: number
  fps: number
  aspectRatio: AspectRatio
  timecodeStart: number
  timecodeDropFrame: boolean
}

const kindLabel: Record<ProjectSequence['kind'], string> = {
  main: 'MAIN',
  shorts: 'SHORTS',
  nested: 'NESTED',
  multicam: 'MULTICAM',
}

function sequenceDuration(sequence: ProjectSequence): number {
  return sequence.tracks.reduce((maximum, track) => Math.max(maximum, ...track.clips.map((clip) => clip.start + clip.duration), 0), 0)
}

export function SequenceManagerDialog({ open, sequences, activeSequenceId, adrCues, deleteAssessments, onClose, onCreate, onSelect, onRename, onUpdateSettings, onDuplicate, onDelete }: SequenceManagerDialogProps) {
  const [renamingId, setRenamingId] = useState<string>()
  const [draftName, setDraftName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createName, setCreateName] = useState('새 시퀀스')
  const [createWidth, setCreateWidth] = useState(1920)
  const [createHeight, setCreateHeight] = useState(1080)
  const [createFps, setCreateFps] = useState(30)
  const [createRatio, setCreateRatio] = useState<AspectRatio>('16:9')
  const [createTimecode, setCreateTimecode] = useState('01:00:00:00')
  const [createDropFrame, setCreateDropFrame] = useState(false)
  const [settingsId, setSettingsId] = useState<string>()
  const [settingsTimecode, setSettingsTimecode] = useState('00:00:00:00')
  const [settingsDropFrame, setSettingsDropFrame] = useState(false)
  const [settingsWidth, setSettingsWidth] = useState(1920)
  const [settingsHeight, setSettingsHeight] = useState(1080)
  const [settingsFps, setSettingsFps] = useState(30)
  const [settingsRatio, setSettingsRatio] = useState<AspectRatio>('16:9')
  const [settingsVideoTransitionType, setSettingsVideoTransitionType] = useState<NonNullable<ProjectSequence['transitionDefaults']>['video']['type']>('crossfade')
  const [settingsVideoTransitionDuration, setSettingsVideoTransitionDuration] = useState(.5)
  const [settingsVideoTransitionAlignment, setSettingsVideoTransitionAlignment] = useState<NonNullable<ProjectSequence['transitionDefaults']>['video']['alignment']>('center-on-cut')
  const [settingsVideoTransitionEasing, setSettingsVideoTransitionEasing] = useState<NonNullable<ProjectSequence['transitionDefaults']>['video']['easing']>('ease-in-out')
  const [settingsAudioTransitionDuration, setSettingsAudioTransitionDuration] = useState(.5)
  const [settingsAudioTransitionCurve, setSettingsAudioTransitionCurve] = useState<NonNullable<ProjectSequence['transitionDefaults']>['audio']['audioCurve']>('equal-power')

  useEffect(() => {
    if (!open) {
      setRenamingId(undefined)
      setDraftName('')
      setCreating(false)
      setSettingsId(undefined)
    }
  }, [open])

  if (!open) return null
  const assessments = new Map(deleteAssessments.map((assessment) => [assessment.sequenceId, assessment]))
  const startRename = (sequence: ProjectSequence) => {
    setRenamingId(sequence.id)
    setDraftName(sequence.name)
  }
  const startSettings = (sequence: ProjectSequence) => {
    setSettingsId(sequence.id)
    setSettingsDropFrame(Boolean(sequence.timecodeDropFrame))
    setSettingsTimecode(formatMediaTimecode(sequence.timecodeStart ?? 0, sequence.fps, Boolean(sequence.timecodeDropFrame)))
    setSettingsWidth(sequence.width)
    setSettingsHeight(sequence.height)
    setSettingsFps(sequence.fps)
    setSettingsRatio(sequence.aspectRatio)
    const transitions = normalizeSequenceTransitionDefaults(sequence.transitionDefaults)
    setSettingsVideoTransitionType(transitions.video.type)
    setSettingsVideoTransitionDuration(transitions.video.duration)
    setSettingsVideoTransitionAlignment(transitions.video.alignment ?? 'center-on-cut')
    setSettingsVideoTransitionEasing(transitions.video.easing ?? 'ease-in-out')
    setSettingsAudioTransitionDuration(transitions.audio.duration)
    setSettingsAudioTransitionCurve(transitions.audio.audioCurve ?? 'equal-power')
  }
  const finishRename = (sequenceId: string) => {
    if (onRename(sequenceId, draftName)) {
      setRenamingId(undefined)
      setDraftName('')
    }
  }
  const applyCreatePreset = (value: string) => {
    const presets: Record<string, [number, number, AspectRatio]> = {
      'fhd': [1920, 1080, '16:9'],
      'uhd': [3840, 2160, '16:9'],
      'vertical-fhd': [1080, 1920, '9:16'],
      'vertical-uhd': [2160, 3840, '9:16'],
      'square': [1080, 1080, '1:1'],
      'social': [1080, 1350, '4:5'],
    }
    const preset = presets[value]
    if (!preset) return
    setCreateWidth(preset[0])
    setCreateHeight(preset[1])
    setCreateRatio(preset[2])
  }

  return <div className="modal-backdrop"><section className="sequence-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="sequence-manager-title">
    <header><div><span className="eyebrow">SEQUENCE LIBRARY</span><h2 id="sequence-manager-title">시퀀스 관리</h2><p>롱폼·쇼츠·중첩·멀티캠 타임라인을 한곳에서 관리합니다.</p></div><button className="icon-button" onClick={onClose} aria-label="시퀀스 관리 닫기"><X size={17} /></button></header>
    <div className="sequence-manager-summary"><Film size={18} /><div><strong>{sequences.length}개 시퀀스</strong><span>복제본은 클립·트랙·ADR 내부 ID를 새로 발급하고 미디어 원본만 공유합니다.</span></div><button onClick={() => setCreating((value) => !value)}><Plus size={13} /> 새 시퀀스</button></div>
    {creating && <form className="sequence-create-form" onSubmit={(event) => {
      event.preventDefault()
      const parsedTimecode = parseMediaTimecode(createTimecode, createFps)
      if (!parsedTimecode) return
      onCreate({ name: createName.trim() || '새 시퀀스', width: Math.max(320, Math.min(8192, Math.round(createWidth))), height: Math.max(320, Math.min(8192, Math.round(createHeight))), fps: Math.max(1, Math.min(240, createFps)), aspectRatio: createRatio, timecodeStart: parsedTimecode.seconds, timecodeDropFrame: createDropFrame && [29.97, 59.94].some((value) => Math.abs(value - createFps) < .02) })
      setCreating(false)
    }}>
      <label><span>프리셋</span><select defaultValue="fhd" onChange={(event) => applyCreatePreset(event.target.value)}><option value="fhd">FHD 16:9</option><option value="uhd">4K UHD 16:9</option><option value="vertical-fhd">세로 FHD 9:16</option><option value="vertical-uhd">세로 4K 9:16</option><option value="square">정사각형 1:1</option><option value="social">소셜 4:5</option><option value="custom">사용자 지정</option></select></label>
      <label className="sequence-name-field"><span>이름</span><input maxLength={80} value={createName} onChange={(event) => setCreateName(event.target.value)} /></label>
      <label><span>너비</span><input type="number" min="320" max="8192" value={createWidth} onChange={(event) => setCreateWidth(Number(event.target.value))} /></label>
      <label><span>높이</span><input type="number" min="320" max="8192" value={createHeight} onChange={(event) => setCreateHeight(Number(event.target.value))} /></label>
      <label><span>FPS</span><input type="number" min="1" max="240" step="0.001" list="sequence-fps-values" value={createFps} onChange={(event) => { const fps = Number(event.target.value); setCreateFps(fps); if (![29.97, 59.94].some((value) => Math.abs(value - fps) < .02)) { setCreateDropFrame(false); setCreateTimecode((value) => value.replace(/;(\d{2})$/, ':$1')) } }} /><datalist id="sequence-fps-values">{[23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120].map((fps) => <option key={fps} value={fps} />)}</datalist></label>
      <label><span>화면비</span><select value={createRatio} onChange={(event) => setCreateRatio(event.target.value as AspectRatio)}><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="4:5">4:5</option><option value="1:1">1:1</option></select></label>
      <label><span>시작 타임코드</span><input value={createTimecode} pattern="[0-9]{1,2}:[0-9]{2}:[0-9]{2}[:;][0-9]{2}" onChange={(event) => setCreateTimecode(event.target.value)} /></label>
      <label><span>드롭프레임</span><input type="checkbox" checked={createDropFrame} disabled={!([29.97, 59.94].some((value) => Math.abs(value - createFps) < .02))} onChange={(event) => { setCreateDropFrame(event.target.checked); setCreateTimecode((value) => value.replace(/[:;](\d{2})$/, `${event.target.checked ? ';' : ':'}$1`)) }} /></label>
      <button type="submit"><Plus size={12} /> 만들기</button><button type="button" onClick={() => setCreating(false)}>취소</button>
    </form>}
    <div className="sequence-manager-list">
      {sequences.map((sequence) => {
        const assessment = assessments.get(sequence.id)
        const cueCount = adrCues.filter((cue) => cue.sequenceId === sequence.id).length
        const isActive = sequence.id === activeSequenceId
        const isRenaming = renamingId === sequence.id
        return <article key={sequence.id} className={isActive ? 'active' : ''}>
          <div className="sequence-manager-main">
            <button className="sequence-open-button" onClick={() => onSelect(sequence.id)} disabled={isActive} aria-label={`${sequence.name} 열기`}>
              <span className={`sequence-kind kind-${sequence.kind}`}>{kindLabel[sequence.kind]}</span>
              <span><strong>{sequence.name}</strong><small>{sequence.width}×{sequence.height} · {sequence.fps}fps · 길이 {formatTimecode(sequenceDuration(sequence), true, sequence.fps)} · 시작 {formatMediaTimecode(sequence.timecodeStart ?? 0, sequence.fps, Boolean(sequence.timecodeDropFrame))}{sequence.timecodeDropFrame ? ' DF' : ' NDF'} · 트랙 {sequence.tracks.length} · ADR {cueCount}</small></span>
              {isActive && <b>현재 열림</b>}
            </button>
            {isRenaming ? <form className="sequence-rename-form" onSubmit={(event) => { event.preventDefault(); finishRename(sequence.id) }}>
              <input autoFocus maxLength={80} value={draftName} onChange={(event) => setDraftName(event.target.value)} aria-label="새 시퀀스 이름" />
              <button type="submit" aria-label="이름 저장"><Check size={13} /></button>
              <button type="button" onClick={() => setRenamingId(undefined)} aria-label="이름 변경 취소"><X size={13} /></button>
            </form> : <div className="sequence-manager-actions">
              <button onClick={() => startRename(sequence)}><Pencil size={12} /> 이름 변경</button>
              <button onClick={() => startSettings(sequence)}><Clock3 size={12} /> 시퀀스 설정</button>
              <button onClick={() => onDuplicate(sequence.id)}><Copy size={12} /> 복제</button>
              <button className="danger" disabled={!assessment?.canDelete} title={assessment?.blockers.join('\n')} onClick={() => onDelete(sequence.id)}><Trash2 size={12} /> 삭제</button>
            </div>}
          </div>
          {settingsId === sequence.id && <form className="sequence-timecode-form sequence-settings-form" onSubmit={(event) => { event.preventDefault(); const fps = Math.max(1, Math.min(240, settingsFps)); const parsed = parseMediaTimecode(settingsTimecode, fps); if (!parsed) return; onUpdateSettings(sequence.id, { aspectRatio: settingsRatio, width: Math.max(320, Math.min(8192, Math.round(settingsWidth))), height: Math.max(320, Math.min(8192, Math.round(settingsHeight))), fps, timecodeStart: parsed.seconds, timecodeDropFrame: settingsDropFrame && [29.97, 59.94].some((value) => Math.abs(value - fps) < .02), transitionDefaults: { video: { type: settingsVideoTransitionType, duration: Math.max(1 / 240, Math.min(60, settingsVideoTransitionDuration)), alignment: settingsVideoTransitionAlignment, easing: settingsVideoTransitionEasing, audioCurve: 'equal-power' }, audio: { type: 'crossfade', duration: Math.max(1 / 240, Math.min(60, settingsAudioTransitionDuration)), alignment: 'center-on-cut', easing: 'linear', audioCurve: settingsAudioTransitionCurve } } }); setSettingsId(undefined) }}>
            <label><span>너비</span><input type="number" min="320" max="8192" value={settingsWidth} onChange={(event) => setSettingsWidth(Number(event.target.value))} /></label>
            <label><span>높이</span><input type="number" min="320" max="8192" value={settingsHeight} onChange={(event) => setSettingsHeight(Number(event.target.value))} /></label>
            <label><span>화면비</span><select value={settingsRatio} onChange={(event) => setSettingsRatio(event.target.value as AspectRatio)}><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="4:5">4:5</option><option value="1:1">1:1</option></select></label>
            <label><span>FPS</span><input type="number" min="1" max="240" step="0.001" list="sequence-fps-values" value={settingsFps} onChange={(event) => { const fps = Number(event.target.value); setSettingsFps(fps); if (![29.97, 59.94].some((value) => Math.abs(value - fps) < .02)) { setSettingsDropFrame(false); setSettingsTimecode((value) => value.replace(/;(\d{2})$/, ':$1')) } }} /></label>
            <label><span>시퀀스 시작 TC</span><input autoFocus value={settingsTimecode} onChange={(event) => setSettingsTimecode(event.target.value)} /></label>
            <label className="sequence-drop-frame"><input type="checkbox" checked={settingsDropFrame} disabled={!([29.97, 59.94].some((value) => Math.abs(value - settingsFps) < .02))} onChange={(event) => { setSettingsDropFrame(event.target.checked); setSettingsTimecode((value) => value.replace(/[:;](\d{2})$/, `${event.target.checked ? ';' : ':'}$1`)) }} /> 드롭프레임</label>
            <span className="sequence-settings-subheading">기본 영상 전환</span>
            <label><span>종류</span><select value={settingsVideoTransitionType} onChange={(event) => setSettingsVideoTransitionType(event.target.value as typeof settingsVideoTransitionType)}><option value="crossfade">교차 디졸브</option><option value="dip-black">검정 디졸브</option><option value="dip-white">흰색 디졸브</option><option value="blur-dissolve">블러 디졸브</option><option value="wipe-left">왼쪽 와이프</option><option value="wipe-right">오른쪽 와이프</option><option value="wipe-up">위쪽 와이프</option><option value="wipe-down">아래쪽 와이프</option><option value="slide-left">왼쪽 슬라이드</option><option value="slide-right">오른쪽 슬라이드</option><option value="zoom">줌</option></select></label>
            <label><span>길이</span><input type="number" min={1 / 240} max="60" step="0.05" value={settingsVideoTransitionDuration} onChange={(event) => setSettingsVideoTransitionDuration(Number(event.target.value))} /></label>
            <label><span>컷 정렬</span><select value={settingsVideoTransitionAlignment} onChange={(event) => setSettingsVideoTransitionAlignment(event.target.value as typeof settingsVideoTransitionAlignment)}><option value="start-at-cut">컷에서 시작</option><option value="center-on-cut">컷 중앙</option><option value="end-at-cut">컷에서 종료</option></select></label>
            <label><span>보간</span><select value={settingsVideoTransitionEasing} onChange={(event) => setSettingsVideoTransitionEasing(event.target.value as typeof settingsVideoTransitionEasing)}><option value="linear">선형</option><option value="ease-in">가속</option><option value="ease-out">감속</option><option value="ease-in-out">부드럽게</option></select></label>
            <span className="sequence-settings-subheading">기본 오디오 전환</span>
            <label><span>길이</span><input type="number" min={1 / 240} max="60" step="0.05" value={settingsAudioTransitionDuration} onChange={(event) => setSettingsAudioTransitionDuration(Number(event.target.value))} /></label>
            <label><span>곡선</span><select value={settingsAudioTransitionCurve} onChange={(event) => setSettingsAudioTransitionCurve(event.target.value as typeof settingsAudioTransitionCurve)}><option value="equal-power">Equal Power</option><option value="linear">선형</option><option value="logarithmic">로그</option></select></label>
            <span className="sequence-settings-note">규격 변경은 클립의 초 단위 편집 위치를 유지합니다. 기본 전환은 Ctrl/Cmd+D와 Ctrl/Cmd+Shift+D에 사용됩니다.</span><button type="submit"><Check size={12} /> 적용</button><button type="button" onClick={() => setSettingsId(undefined)}>취소</button>
          </form>}
          {assessment && (assessment.nestedReferences.length || assessment.derivedReferences.length || assessment.mergeReferenceCount || assessment.blockers.length) ? <div className={`sequence-reference-note ${assessment.canDelete ? '' : 'blocked'}`}>
            {assessment.canDelete ? <GitBranch size={13} /> : <AlertTriangle size={13} />}
            <span>{assessment.blockers.length
              ? assessment.blockers.join(' ')
              : `참조: 중첩 ${assessment.nestedReferences.length} · 파생 ${assessment.derivedReferences.length} · 병합 ${assessment.mergeReferenceCount}`}</span>
          </div> : null}
        </article>
      })}
    </div>
    <footer><span>시퀀스를 삭제해도 프로젝트 미디어와 디스크 원본은 삭제되지 않습니다.</span><button className="primary-button" onClick={onClose}>완료</button></footer>
  </section></div>
}
