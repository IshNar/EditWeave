import { ChevronDown, ChevronUp, Download, Plus, Save, SlidersHorizontal, Trash2, Upload, Volume2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { estimateAudioLoudness } from '../editor/delivery'
import { audioBusInsertLabels, audioRoleLabels, audioRoles, createAudioBusInsert } from '../editor/audioBuses'
import { resolveTrackAudioMix } from '../editor/effects'
import type { AudioBusInsert, AudioBusInsertType, AudioBusMap, AudioBusSettings, AudioRole, MediaAsset, TimelineTrack, TrackMixKeyframe } from '../editor/types'
import { createAudioTeamTemplate, instantiateAdrTeamDefaults, instantiateAudioTeamTemplate, parseAudioTeamTemplate, readAudioTeamTemplates, serializeAudioTeamTemplate, writeAudioTeamTemplates, type AdrTeamDefaults } from '../platform/audioTemplates'
import { CREATOR_PACK_CHANGED_EVENT } from '../platform/creatorPacks'

interface AudioMixerDialogProps {
  open: boolean
  tracks: TimelineTrack[]
  assets: MediaAsset[]
  audioBuses: AudioBusMap
  adrDefaults: AdrTeamDefaults
  playhead: number
  isPlaying: boolean
  onClose: () => void
  onUpdateTrack: (id: string, patch: Partial<TimelineTrack>) => void
  onUpdateTrackTransient: (id: string, patch: Partial<TimelineTrack>) => void
  onUpdateBus: (role: AudioRole, patch: Partial<AudioBusSettings>) => void
  onApplyTemplate: (buses: AudioBusMap, adr: AdrTeamDefaults) => void
  onUpdateAdrDefaults: (defaults: AdrTeamDefaults) => void
}

const insertTypes: AudioBusInsertType[] = ['highpass', 'equalizer', 'de-esser', 'hum-removal', 'compressor', 'delay', 'limiter']

type TrackAutomationMode = NonNullable<TimelineTrack['mixAutomationMode']>

function trackAutomationMode(track: TimelineTrack): TrackAutomationMode {
  return track.mixAutomationMode ?? (track.mixKeyframes?.length ? 'read' : 'off')
}

function upsertTrackMixPoint(track: TimelineTrack, time: number, value: { volume: number; pan: number }, easing: TrackMixKeyframe['easing'] = 'linear'): TrackMixKeyframe[] {
  const safeTime = Math.max(0, time)
  const tolerance = 1 / 60
  const existing = track.mixKeyframes ?? []
  const matching = existing.find((keyframe) => Math.abs(keyframe.time - safeTime) <= tolerance)
  const point: TrackMixKeyframe = { id: matching?.id ?? crypto.randomUUID(), time: safeTime, volume: Math.max(0, Math.min(200, value.volume)), pan: Math.max(-100, Math.min(100, value.pan)), easing }
  return (matching ? existing.map((keyframe) => keyframe.id === matching.id ? point : keyframe) : [...existing, point]).sort((left, right) => left.time - right.time)
}

export function AudioMixerDialog({ open, tracks, assets, audioBuses, adrDefaults, playhead, isPlaying, onClose, onUpdateTrack, onUpdateTrackTransient, onUpdateBus, onApplyTemplate, onUpdateAdrDefaults }: AudioMixerDialogProps) {
  const [templates, setTemplates] = useState(readAudioTeamTemplates)
  useEffect(() => {
    const refresh = () => setTemplates(readAudioTeamTemplates())
    window.addEventListener(CREATOR_PACK_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(CREATOR_PACK_CHANGED_EVENT, refresh)
  }, [])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [templateName, setTemplateName] = useState('유튜브 채널 믹스')
  const [templateError, setTemplateError] = useState('')
  const [liveAutomation, setLiveAutomation] = useState<Record<string, { volume: number; pan: number }>>({})
  const templateInputRef = useRef<HTMLInputElement>(null)
  const touchReturnRef = useRef(new Map<string, { volume: number; pan: number }>())
  const latchedTracksRef = useRef(new Set<string>())
  const lastAutomationBucketRef = useRef(new Map<string, number>())
  const automationDraftRef = useRef(new Map<string, TrackMixKeyframe[]>())
  const automationCaptureStartedRef = useRef(new Set<string>())
  const previousPlayingRef = useRef(isPlaying)
  const writeAutomation = (track: TimelineTrack, value: { volume: number; pan: number }, time = playhead, easing: TrackMixKeyframe['easing'] = 'linear') => {
    const source = automationDraftRef.current.get(track.id) ?? track.mixKeyframes
    const mixKeyframes = upsertTrackMixPoint({ ...track, mixKeyframes: source }, time, value, easing)
    automationDraftRef.current.set(track.id, mixKeyframes)
    if (automationCaptureStartedRef.current.has(track.id)) onUpdateTrackTransient(track.id, { mixKeyframes })
    else {
      automationCaptureStartedRef.current.add(track.id)
      onUpdateTrack(track.id, { mixKeyframes })
    }
  }
  useEffect(() => {
    if (!open || !isPlaying) return
    const bucket = Math.floor(playhead * 10)
    tracks.filter((track) => track.kind === 'audio' || track.kind === 'video').forEach((track) => {
      const mode = trackAutomationMode(track)
      if (mode !== 'write' && !(mode === 'latch' && latchedTracksRef.current.has(track.id))) return
      if (lastAutomationBucketRef.current.get(track.id) === bucket) return
      lastAutomationBucketRef.current.set(track.id, bucket)
      const value = liveAutomation[track.id] ?? resolveTrackAudioMix(track, playhead)
      writeAutomation(track, value, bucket / 10)
    })
  }, [isPlaying, liveAutomation, open, playhead, tracks])
  useEffect(() => {
    if (previousPlayingRef.current && !isPlaying) {
      latchedTracksRef.current.clear()
      lastAutomationBucketRef.current.clear()
      automationCaptureStartedRef.current.clear()
      tracks.forEach((track) => {
        if (trackAutomationMode(track) === 'write') onUpdateTrackTransient(track.id, { mixAutomationMode: 'touch' })
      })
      setLiveAutomation({})
    }
    previousPlayingRef.current = isPlaying
  }, [isPlaying, tracks])
  const updateTrackFader = (track: TimelineTrack, field: 'volume' | 'pan', value: number) => {
    const mode = trackAutomationMode(track)
    if (mode === 'read') return
    if (mode === 'off') {
      onUpdateTrack(track.id, { [field]: value })
      return
    }
    const current = liveAutomation[track.id] ?? resolveTrackAudioMix(track, playhead)
    const next = { ...current, [field]: value }
    setLiveAutomation((values) => ({ ...values, [track.id]: next }))
    if (mode === 'latch') latchedTracksRef.current.add(track.id)
    writeAutomation(track, next)
  }
  const beginAutomationGesture = (track: TimelineTrack) => {
    automationCaptureStartedRef.current.delete(track.id)
    if (trackAutomationMode(track) === 'touch' && !touchReturnRef.current.has(track.id)) touchReturnRef.current.set(track.id, resolveTrackAudioMix(track, playhead))
  }
  const finishTouch = (track: TimelineTrack) => {
    const original = touchReturnRef.current.get(track.id)
    touchReturnRef.current.delete(track.id)
    if (!original || trackAutomationMode(track) !== 'touch') return
    if (isPlaying) writeAutomation(track, original, playhead + 0.12, 'ease-out')
    setLiveAutomation((values) => { const next = { ...values }; delete next[track.id]; return next })
  }
  const finishAutomationGesture = (track: TimelineTrack) => {
    finishTouch(track)
    if (!isPlaying || trackAutomationMode(track) === 'touch') automationCaptureStartedRef.current.delete(track.id)
  }
  const changeAutomationMode = (track: TimelineTrack, mixAutomationMode: TrackAutomationMode) => {
    latchedTracksRef.current.delete(track.id)
    lastAutomationBucketRef.current.delete(track.id)
    automationCaptureStartedRef.current.delete(track.id)
    automationDraftRef.current.set(track.id, [...(track.mixKeyframes ?? [])])
    setLiveAutomation((values) => {
      const next = { ...values }
      if (mixAutomationMode === 'write') next[track.id] = resolveTrackAudioMix(track, playhead)
      else delete next[track.id]
      return next
    })
    onUpdateTrack(track.id, { mixAutomationMode })
  }
  if (!open) return null
  const audioTracks = tracks.filter((track) => track.kind === 'audio' || track.kind === 'video')
  const loudness = estimateAudioLoudness(tracks, assets, audioBuses)
  const normalize = () => {
    if (loudness.lufs === undefined) return
    const multiplier = Math.pow(10, (-14 - loudness.lufs) / 20)
    audioTracks.forEach((track) => onUpdateTrack(track.id, {
      volume: Math.max(0, Math.min(200, (track.volume ?? 100) * multiplier)),
      mixKeyframes: track.mixKeyframes?.map((keyframe) => ({ ...keyframe, volume: Math.max(0, Math.min(200, keyframe.volume * multiplier)) })),
    }))
  }
  const updateInsert = (role: AudioRole, id: string, patch: Partial<AudioBusInsert>) => onUpdateBus(role, { inserts: audioBuses[role].inserts.map((insert) => insert.id === id ? { ...insert, ...patch } : insert) })
  const moveInsert = (role: AudioRole, id: string, direction: -1 | 1) => {
    const inserts = [...audioBuses[role].inserts]
    const index = inserts.findIndex((insert) => insert.id === id)
    const next = index + direction
    if (index < 0 || next < 0 || next >= inserts.length) return
    ;[inserts[index], inserts[next]] = [inserts[next], inserts[index]]
    onUpdateBus(role, { inserts })
  }
  const saveTemplate = () => {
    const current = templates.find((template) => template.id === selectedTemplateId)
    const template = { ...createAudioTeamTemplate(templateName, audioBuses, adrDefaults, current?.id), createdAt: current?.createdAt ?? new Date().toISOString() }
    const next = current ? templates.map((item) => item.id === current.id ? template : item) : [...templates, template]
    setTemplates(next)
    setSelectedTemplateId(template.id)
    setTemplateName(template.name)
    setTemplateError('')
    writeAudioTeamTemplates(next)
  }
  const removeTemplate = () => {
    if (!selectedTemplateId) return
    const next = templates.filter((template) => template.id !== selectedTemplateId)
    setTemplates(next)
    setSelectedTemplateId('')
    writeAudioTeamTemplates(next)
  }
  const exportTemplate = () => {
    const template = templates.find((item) => item.id === selectedTemplateId)
    if (!template) return
    const url = URL.createObjectURL(new Blob([serializeAudioTeamTemplate(template)], { type: 'application/json;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${template.name.replace(/[<>:"/\\|?*]+/g, '-')}.editweave-audio.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return <div className="modal-backdrop">
    <section className="audio-mixer-dialog" role="dialog" aria-modal="true" aria-labelledby="mixer-title">
      <header><div><span className="eyebrow">TRACK · BUS MIXER</span><h2 id="mixer-title">오디오 믹서</h2></div><button className="icon-button" onClick={onClose} aria-label="오디오 믹서 닫기"><X size={17} /></button></header>
      <div className="loudness-summary"><SlidersHorizontal size={18} /><div><strong>{loudness.lufs === undefined ? '측정할 파형 없음' : `${loudness.lufs.toFixed(1)} LUFS 예상`}</strong><span>{loudness.truePeakDb === undefined ? '미디어 분석 후 표시됩니다.' : `True Peak ${loudness.truePeakDb.toFixed(1)} dBTP 예상 · YouTube 기준 -14 LUFS / -1 dBTP`}</span></div><button onClick={normalize} disabled={loudness.lufs === undefined}>-14 LUFS 맞춤</button></div>
      <div className="audio-template-toolbar"><input ref={templateInputRef} hidden type="file" accept=".json,.editweave-audio.json,application/json" onChange={(event) => { const file = event.target.files?.[0]; setTemplateError(''); if (file) void file.text().then(parseAudioTeamTemplate).then((template) => { const next = [...templates.filter((item) => item.id !== template.id), template]; setTemplates(next); setSelectedTemplateId(template.id); setTemplateName(template.name); writeAudioTeamTemplates(next) }).catch((error: unknown) => setTemplateError(error instanceof Error ? error.message : '오디오 템플릿을 가져오지 못했습니다.')); event.target.value = '' }} /><label><span>팀 오디오 템플릿</span><select value={selectedTemplateId} onChange={(event) => { const id = event.target.value; setSelectedTemplateId(id); setTemplateError(''); const template = templates.find((item) => item.id === id); if (template) setTemplateName(template.name) }}><option value="">새 템플릿</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label><input value={templateName} maxLength={100} onChange={(event) => setTemplateName(event.target.value)} aria-label="오디오 템플릿 이름" /><button onClick={saveTemplate}><Save size={12} /> 저장</button><button disabled={!selectedTemplateId} onClick={() => { const template = templates.find((item) => item.id === selectedTemplateId); if (template) { onApplyTemplate(instantiateAudioTeamTemplate(template), instantiateAdrTeamDefaults(template)); setTemplateError('') } }}>적용</button><button disabled={!selectedTemplateId} onClick={exportTemplate}><Download size={12} /> 공유</button><button onClick={() => templateInputRef.current?.click()}><Upload size={12} /> 가져오기</button><button className="danger" disabled={!selectedTemplateId} onClick={removeTemplate}><Trash2 size={12} /></button></div>
      {templateError && <p className="audio-template-error" role="alert">{templateError}</p>}
      <div className="adr-template-defaults"><strong>ADR 기본값</strong><label><span>큐 길이</span><input type="number" min="0.5" max="120" step="0.5" value={adrDefaults.cueDuration} onChange={(event) => onUpdateAdrDefaults({ ...adrDefaults, cueDuration: Math.max(0.5, Math.min(120, Number(event.target.value) || 5)) })} /></label><label><span>카운트다운</span><select value={adrDefaults.countdownSeconds} onChange={(event) => onUpdateAdrDefaults({ ...adrDefaults, countdownSeconds: Number(event.target.value) as AdrTeamDefaults['countdownSeconds'] })}><option value="0">없음</option><option value="1">1초</option><option value="2">2초</option><option value="3">3초</option><option value="5">5초</option></select></label><label><span>선호 마이크 이름</span><input value={adrDefaults.preferredDeviceLabel} maxLength={200} placeholder="비우면 기본 장치" onChange={(event) => onUpdateAdrDefaults({ ...adrDefaults, preferredDeviceLabel: event.target.value })} /></label></div>
      <h3 className="mixer-section-title">트랙</h3>
      <div className="mixer-strips">{audioTracks.map((track) => {
        const level = estimateAudioLoudness([track], assets, audioBuses)
        const meter = level.truePeakDb === undefined ? 0 : Math.max(0, Math.min(1, Math.pow(10, level.truePeakDb / 20)))
        const automationMode = trackAutomationMode(track)
        const automated = automationMode !== 'off' && Boolean(track.mixKeyframes?.length)
        const resolvedMix = liveAutomation[track.id] ?? resolveTrackAudioMix(track, playhead)
        const faderMix = automationMode === 'off' ? { volume: track.volume ?? 100, pan: track.pan ?? 0 } : resolvedMix
        const faderLocked = track.locked || automationMode === 'read'
        return <article className="mixer-strip" key={track.id}>
          <header><Volume2 size={14} /><strong>{track.name}</strong><small>{automationMode === 'off' ? track.kind.toUpperCase() : automationMode.toUpperCase()}</small></header>
          <div className="mixer-meter"><i style={{ height: `${Math.max(2, meter * 100)}%` }} /></div>
          <label><span>음량</span><input type="range" min="0" max="200" step="1" value={faderMix.volume} disabled={faderLocked} onFocus={() => beginAutomationGesture(track)} onBlur={() => finishAutomationGesture(track)} onPointerDown={() => beginAutomationGesture(track)} onPointerUp={() => finishAutomationGesture(track)} onPointerCancel={() => finishAutomationGesture(track)} onChange={(event) => updateTrackFader(track, 'volume', Number(event.target.value))} /><b>{Math.round(faderMix.volume)}%</b></label>
          <label><span>팬</span><input type="range" min="-100" max="100" step="1" value={faderMix.pan} disabled={faderLocked} onFocus={() => beginAutomationGesture(track)} onBlur={() => finishAutomationGesture(track)} onPointerDown={() => beginAutomationGesture(track)} onPointerUp={() => finishAutomationGesture(track)} onPointerCancel={() => finishAutomationGesture(track)} onChange={(event) => updateTrackFader(track, 'pan', Number(event.target.value))} /><b>{Math.round(faderMix.pan)}</b></label>
          <div className="mixer-automation"><select aria-label={`${track.name} 자동화 모드`} value={automationMode} disabled={track.locked} onChange={(event) => changeAutomationMode(track, event.target.value as TrackAutomationMode)}><option value="off">OFF</option><option value="read">READ</option><option value="write">WRITE</option><option value="touch">TOUCH</option><option value="latch">LATCH</option></select><button disabled={track.locked || !automated} onClick={() => { latchedTracksRef.current.delete(track.id); automationDraftRef.current.delete(track.id); automationCaptureStartedRef.current.delete(track.id); setLiveAutomation((values) => { const next = { ...values }; delete next[track.id]; return next }); onUpdateTrack(track.id, { mixKeyframes: undefined, mixAutomationMode: 'off' }) }}>CLR</button></div>
          <footer><button className={track.muted ? 'active' : ''} disabled={track.locked} onClick={() => onUpdateTrack(track.id, { muted: !track.muted })}>M</button><button className={track.solo ? 'active' : ''} disabled={track.locked} onClick={() => onUpdateTrack(track.id, { solo: !track.solo })}>S</button></footer>
        </article>
      })}</div>
      <h3 className="mixer-section-title">역할 버스 · 순차 삽입 체인</h3>
      <div className="bus-racks">{audioRoles.map((role) => {
        const bus = audioBuses[role]
        return <article className="bus-rack" key={role}>
          <header><div><SlidersHorizontal size={14} /><strong>{audioRoleLabels[role]} 버스</strong><small>{bus.inserts.filter((insert) => insert.enabled).length} ACTIVE</small></div><div><button className={bus.muted ? 'active' : ''} onClick={() => onUpdateBus(role, { muted: !bus.muted })}>M</button><button className={bus.solo ? 'active' : ''} onClick={() => onUpdateBus(role, { solo: !bus.solo })}>S</button></div></header>
          <div className="bus-faders"><label><span>버스 게인</span><input type="range" min="-24" max="12" step="0.5" value={bus.gainDb} onChange={(event) => onUpdateBus(role, { gainDb: Number(event.target.value) })} /><b>{bus.gainDb.toFixed(1)} dB</b></label><label><span>출력 안전 리미터</span><input type="range" min="-12" max="0" step="0.5" value={bus.limiterDb} onChange={(event) => onUpdateBus(role, { limiterDb: Number(event.target.value) })} /><b>{bus.limiterDb.toFixed(1)} dB</b></label></div>
          <div className="bus-insert-chain">{bus.inserts.length === 0 && <p>삽입 효과 없음 · 신호는 버스 게인으로 바로 전달됩니다.</p>}{bus.inserts.map((insert, index) => <div className={`bus-insert ${insert.enabled ? '' : 'disabled'}`} key={insert.id}>
            <header><button className={insert.enabled ? 'active' : ''} onClick={() => updateInsert(role, insert.id, { enabled: !insert.enabled })}>{index + 1}</button><strong>{audioBusInsertLabels[insert.type]}</strong><span /><button disabled={index === 0} onClick={() => moveInsert(role, insert.id, -1)} aria-label="삽입 효과 위로"><ChevronUp size={12} /></button><button disabled={index === bus.inserts.length - 1} onClick={() => moveInsert(role, insert.id, 1)} aria-label="삽입 효과 아래로"><ChevronDown size={12} /></button><button onClick={() => onUpdateBus(role, { inserts: bus.inserts.filter((item) => item.id !== insert.id) })} aria-label="삽입 효과 삭제"><Trash2 size={12} /></button></header>
            <InsertControls insert={insert} onChange={(patch) => updateInsert(role, insert.id, patch)} />
          </div>)}</div>
          <div className="bus-insert-add"><Plus size={12} />{insertTypes.map((type) => <button key={type} disabled={bus.inserts.length >= 6} onClick={() => onUpdateBus(role, { inserts: [...bus.inserts, createAudioBusInsert(type)] })}>{audioBusInsertLabels[type]}</button>)}</div>
        </article>
      })}</div>
      <p className="mixer-note">효과는 위에서 아래 순서로 처리됩니다. 클립 Aux 센드는 지정한 역할 버스의 체인으로 들어가며, 출력 안전 리미터는 삽입 체인 뒤에 항상 적용됩니다.</p>
    </section>
  </div>
}

function InsertControls({ insert, onChange }: { insert: AudioBusInsert; onChange: (patch: Partial<AudioBusInsert>) => void }) {
  if (insert.type === 'highpass') return <label><span>컷오프</span><input type="range" min="20" max="1200" step="10" value={insert.frequencyHz ?? 80} onChange={(event) => onChange({ frequencyHz: Number(event.target.value) })} /><b>{Math.round(insert.frequencyHz ?? 80)} Hz</b></label>
  if (insert.type === 'equalizer') return <div className="insert-three-controls">{(['lowDb', 'midDb', 'highDb'] as const).map((field, index) => <label key={field}><span>{['LOW', 'MID', 'HIGH'][index]}</span><input type="range" min="-18" max="18" step="0.5" value={insert[field] ?? 0} onChange={(event) => onChange({ [field]: Number(event.target.value) })} /><b>{(insert[field] ?? 0).toFixed(1)}</b></label>)}</div>
  if (insert.type === 'de-esser') return <label><span>치찰음 억제</span><input type="range" min="0" max="100" step="1" value={insert.amount ?? 45} onChange={(event) => onChange({ amount: Number(event.target.value) })} /><b>{Math.round(insert.amount ?? 45)}%</b></label>
  if (insert.type === 'hum-removal') return <div className="insert-three-controls"><label><span>전원 주파수</span><select value={insert.humFrequencyHz ?? 60} onChange={(event) => onChange({ humFrequencyHz: Number(event.target.value) as 50 | 60 })}><option value="50">50 Hz</option><option value="60">60 Hz</option></select><b>{insert.humFrequencyHz ?? 60} Hz</b></label><label><span>억제 강도</span><input type="range" min="0" max="100" step="1" value={insert.amount ?? 70} onChange={(event) => onChange({ amount: Number(event.target.value) })} /><b>{Math.round(insert.amount ?? 70)}%</b></label></div>
  if (insert.type === 'compressor') return <div className="insert-three-controls"><label><span>THRESH</span><input type="range" min="-60" max="0" step="1" value={insert.thresholdDb ?? -18} onChange={(event) => onChange({ thresholdDb: Number(event.target.value) })} /><b>{insert.thresholdDb ?? -18} dB</b></label><label><span>RATIO</span><input type="range" min="1" max="20" step="0.5" value={insert.ratio ?? 3} onChange={(event) => onChange({ ratio: Number(event.target.value) })} /><b>{(insert.ratio ?? 3).toFixed(1)}:1</b></label><label><span>MAKEUP</span><input type="range" min="-12" max="24" step="0.5" value={insert.makeupDb ?? 0} onChange={(event) => onChange({ makeupDb: Number(event.target.value) })} /><b>{(insert.makeupDb ?? 0).toFixed(1)} dB</b></label></div>
  if (insert.type === 'delay') return <div className="insert-three-controls"><label><span>TIME</span><input type="range" min="10" max="2000" step="10" value={insert.delayMs ?? 240} onChange={(event) => onChange({ delayMs: Number(event.target.value) })} /><b>{Math.round(insert.delayMs ?? 240)} ms</b></label><label><span>FEEDBACK</span><input type="range" min="0" max="85" step="1" value={insert.feedback ?? 28} onChange={(event) => onChange({ feedback: Number(event.target.value) })} /><b>{Math.round(insert.feedback ?? 28)}%</b></label><label><span>MIX</span><input type="range" min="0" max="100" step="1" value={insert.mix ?? 18} onChange={(event) => onChange({ mix: Number(event.target.value) })} /><b>{Math.round(insert.mix ?? 18)}%</b></label></div>
  return <label><span>CEILING</span><input type="range" min="-12" max="0" step="0.5" value={insert.ceilingDb ?? -1} onChange={(event) => onChange({ ceilingDb: Number(event.target.value) })} /><b>{(insert.ceilingDb ?? -1).toFixed(1)} dB</b></label>
}
