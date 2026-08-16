import { CheckCircle2, Film, Pause, Play, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { DeliveryIssue } from '../editor/delivery'
import type { AudioRole, SequencePreset } from '../editor/types'
import { audioRoleLabels, audioRoles } from '../editor/audioBuses'
import { builtInExportPresets, readUserExportPresets, writeUserExportPresets, type SavedExportPreset } from '../platform/exportPresets'
import { CREATOR_PACK_CHANGED_EVENT } from '../platform/creatorPacks'
import { audioDeliveryProfiles, normalizeAudioDeliveryProfileId, type AudioDeliveryProfileId } from '../platform/audioDeliveryConformance'

export interface ExportRequest {
  filename: string
  height: number
  codec: 'avc' | 'hevc' | 'prores-422' | 'prores-422-hq' | 'prores-4444' | 'dnxhr-hq' | 'dnxhr-hqx'
  colorMode?: 'sdr' | 'hdr10-pq' | 'hdr-hlg'
  fps: number
  bitrateMbps: number
  hardwareAcceleration: 'no-preference' | 'prefer-hardware' | 'prefer-software'
  includeAudio: boolean
  audioSampleRate: 44_100 | 48_000 | 96_000
  audioBitrateKbps: 128 | 192 | 256 | 320
  audioChannels: 1 | 2 | 6
  audioDeliveryProfile?: AudioDeliveryProfileId
  audioMixdownWav?: boolean
  audioStems?: AudioRole[]
  range?: 'sequence' | 'work-area' | 'selected-clips' | 'custom'
  rangeStart?: number
  rangeEnd?: number
}

interface ExportDialogProps {
  open: boolean
  preset: SequencePreset
  projectName: string
  duration: number
  sequenceFps: number
  workArea?: { start: number; end: number }
  selectedRange?: { start: number; end: number }
  canExport: boolean
  canExportAudio: boolean
  isExporting: boolean
  progress: number
  stage: string
  error?: string
  onClose: () => void
  onStart: (request: ExportRequest) => void
  onAudioStart: (request: ExportRequest) => void
  onAudioQueue: (request: ExportRequest) => void
  onQueue: (request: ExportRequest) => void
  batchCount?: number
  onBatchStart?: (request: ExportRequest) => void
  onBatchQueue?: (request: ExportRequest) => void
  onExportExchange?: (format: 'otio' | 'premiere-xml' | 'fcpxml' | 'edl' | 'chapters' | 'markers') => void
  onCreateDeliveryPackage?: () => void
  onCancel: () => void
  paused: boolean
  onPause: () => void
  onResume: () => void
  deliveryIssues: DeliveryIssue[]
}

export function ExportDialog({
  open,
  preset,
  projectName,
  duration,
  sequenceFps,
  workArea,
  selectedRange,
  canExport,
  canExportAudio,
  isExporting,
  progress,
  stage,
  error,
  onClose,
  onStart,
  onAudioStart,
  onAudioQueue,
  onQueue,
  batchCount = 0,
  onBatchStart,
  onBatchQueue,
  onExportExchange,
  onCreateDeliveryPackage,
  onCancel,
  paused,
  onPause,
  onResume,
  deliveryIssues,
}: ExportDialogProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const [userPresets, setUserPresets] = useState<SavedExportPreset[]>(() => readUserExportPresets())
  const [rangeMode, setRangeMode] = useState<NonNullable<ExportRequest['range']>>('sequence')
  const [customRangeStart, setCustomRangeStart] = useState(0)
  const [customRangeEnd, setCustomRangeEnd] = useState(duration)
  const [selectedCodec, setSelectedCodec] = useState<ExportRequest['codec']>('avc')
  const [selectedAudioSampleRate, setSelectedAudioSampleRate] = useState<ExportRequest['audioSampleRate']>(48_000)
  const [selectedAudioProfile, setSelectedAudioProfile] = useState<AudioDeliveryProfileId>('web-video')
  useEffect(() => {
    const refresh = () => setUserPresets(readUserExportPresets())
    window.addEventListener(CREATOR_PACK_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(CREATOR_PACK_CHANGED_EVENT, refresh)
  }, [])
  useEffect(() => {
    if (!workArea && rangeMode === 'work-area') setRangeMode('sequence')
    if (!selectedRange && rangeMode === 'selected-clips') setRangeMode('sequence')
  }, [rangeMode, selectedRange, workArea])
  useEffect(() => {
    setCustomRangeStart((value) => Math.max(0, Math.min(value, Math.max(0, duration - 1 / Math.max(1, sequenceFps)))))
    setCustomRangeEnd((value) => Math.max(1 / Math.max(1, sequenceFps), Math.min(duration, value || duration)))
  }, [duration, sequenceFps])
  const [selectedPresetId, setSelectedPresetId] = useState('match-sequence')
  if (!open) return null
  const presets = [...builtInExportPresets, ...userPresets]
  const exportFps = (value: FormDataEntryValue | null) => Math.max(1, Math.min(240, Number(value) || sequenceFps || 30))
  const exportCodec = (data: FormData): ExportRequest['codec'] => {
    if (data.get('colorMode') === 'hdr10-pq' || data.get('colorMode') === 'hdr-hlg') return 'hevc'
    const value = String(data.get('codec'))
    return value === 'hevc' || value === 'prores-422' || value === 'prores-422-hq' || value === 'prores-4444' || value === 'dnxhr-hq' || value === 'dnxhr-hqx' ? value : 'avc'
  }
  const exportHeight = (data: FormData) => {
    const mode = String(data.get('height') ?? 'match')
    const sequenceReference = Math.min(preset.width, preset.height)
    if (mode === 'match') return Math.max(16, Math.min(8_192, Math.round(sequenceReference)))
    if (mode === 'custom') return Math.max(16, Math.min(8_192, Math.round(Number(data.get('customHeight')) || sequenceReference)))
    return Math.max(16, Math.min(8_192, Math.round(Number(mode) || sequenceReference)))
  }
  const requestedRange = rangeMode === 'work-area' ? workArea
    : rangeMode === 'selected-clips' ? selectedRange
      : rangeMode === 'custom' ? { start: Math.min(customRangeStart, customRangeEnd), end: Math.max(customRangeStart, customRangeEnd) }
        : undefined
  const effectiveDuration = requestedRange ? Math.max(1 / Math.max(1, sequenceFps), requestedRange.end - requestedRange.start) : duration
  const rangeLabel = rangeMode === 'work-area' ? '시퀀스 IN·OUT' : rangeMode === 'selected-clips' ? '선택 클립' : rangeMode === 'custom' ? '사용자 지정' : '전체 시퀀스'
  const applyPreset = (presetId: string) => {
    const form = formRef.current
    if (presetId === 'match-sequence') {
      const fps = form?.elements.namedItem('fps') as HTMLInputElement | null
      if (fps) fps.value = String(sequenceFps)
      setSelectedPresetId(presetId)
      return
    }
    const preset = presets.find((item) => item.id === presetId)
    if (!form || !preset) return
    const height = form.querySelector<HTMLInputElement>(`input[name="height"][value="${preset.settings.height}"]`)
    const customHeight = form.elements.namedItem('customHeight') as HTMLInputElement | null
    if (height) height.checked = true
    else {
      const custom = form.querySelector<HTMLInputElement>('input[name="height"][value="custom"]')
      if (custom) custom.checked = true
      if (customHeight) customHeight.value = String(preset.settings.height)
    }
    const setValue = (name: string, value: string | number) => { const field = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null; if (field) field.value = String(value) }
    setValue('codec', preset.settings.codec)
    setSelectedCodec(preset.settings.codec)
    setValue('colorMode', preset.settings.colorMode ?? 'sdr')
    setValue('fps', preset.settings.fps)
    setValue('bitrate', preset.settings.bitrateMbps)
    setValue('hardware', preset.settings.hardwareAcceleration)
    setValue('audioSampleRate', preset.settings.audioSampleRate ?? 48_000)
    setSelectedAudioSampleRate(preset.settings.audioSampleRate === 44_100 || preset.settings.audioSampleRate === 96_000 ? preset.settings.audioSampleRate : 48_000)
    setValue('audioBitrate', preset.settings.audioBitrateKbps ?? 192)
    setValue('audioChannels', preset.settings.audioChannels ?? 2)
    const deliveryProfile = normalizeAudioDeliveryProfileId(preset.settings.audioDeliveryProfile)
    setValue('audioDeliveryProfile', deliveryProfile)
    setSelectedAudioProfile(deliveryProfile)
    const audio = form.elements.namedItem('audio') as HTMLInputElement | null
    if (audio) audio.checked = preset.settings.includeAudio
    const mixWav = form.elements.namedItem('mixWav') as HTMLInputElement | null
    if (mixWav) mixWav.checked = Boolean(preset.settings.audioMixdownWav)
    form.querySelectorAll<HTMLInputElement>('input[name="stem"]').forEach((input) => { input.checked = Boolean(preset.settings.audioStems?.includes(input.value as AudioRole)) })
    setSelectedPresetId(presetId)
  }
  const currentSettings = (): Omit<ExportRequest, 'filename' | 'range'> | undefined => {
    const form = formRef.current
    if (!form) return undefined
    const data = new FormData(form)
    return {
      height: exportHeight(data),
      codec: exportCodec(data),
      colorMode: data.get('colorMode') === 'hdr10-pq' ? 'hdr10-pq' : data.get('colorMode') === 'hdr-hlg' ? 'hdr-hlg' : 'sdr',
      fps: exportFps(data.get('fps')),
      bitrateMbps: Math.max(1, Number(data.get('bitrate')) || 8),
      hardwareAcceleration: String(data.get('hardware')) as ExportRequest['hardwareAcceleration'],
      includeAudio: data.get('audio') === 'on',
      audioSampleRate: Number(data.get('audioSampleRate')) === 44_100 ? 44_100 : Number(data.get('audioSampleRate')) === 96_000 ? 96_000 : 48_000,
      audioBitrateKbps: Number(data.get('audioBitrate')) === 128 ? 128 : Number(data.get('audioBitrate')) === 256 ? 256 : Number(data.get('audioBitrate')) === 320 ? 320 : 192,
      audioChannels: Number(data.get('audioChannels')) === 1 ? 1 : Number(data.get('audioChannels')) === 6 ? 6 : 2,
      audioDeliveryProfile: normalizeAudioDeliveryProfileId(data.get('audioDeliveryProfile')),
      audioMixdownWav: data.get('mixWav') === 'on',
      audioStems: data.getAll('stem').filter((role): role is AudioRole => audioRoles.includes(role as AudioRole)),
    }
  }
  const savePreset = () => {
    const settings = currentSettings()
    const name = window.prompt('현재 출력 설정의 프리셋 이름을 입력하세요.')?.trim()
    if (!settings || !name) return
    const preset = { id: crypto.randomUUID(), name, settings }
    const next = [...userPresets, preset]
    setUserPresets(next)
    writeUserExportPresets(next)
    setSelectedPresetId(preset.id)
  }
  const removePreset = () => {
    const next = userPresets.filter((preset) => preset.id !== selectedPresetId)
    setUserPresets(next)
    writeUserExportPresets(next)
    setSelectedPresetId('match-sequence')
    requestAnimationFrame(() => applyPreset('match-sequence'))
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <header>
          <div><span className="eyebrow">LOCAL RENDER</span><h2 id="export-title">영상 내보내기</h2></div>
          <button className="icon-button" onClick={onClose} aria-label={isExporting ? '내보내기를 백그라운드로 보내기' : '내보내기 닫기'}><X size={17} /></button>
        </header>

        <div className="export-summary">
          <span className={`export-ratio ratio-${preset.ratio.replace(':', '-')}`}><Film size={22} /></span>
          <div><strong>{projectName}</strong><p>{preset.ratio} · {Math.floor(effectiveDuration / 60)}분 {Math.round(effectiveDuration % 60)}초 · {rangeLabel} · {selectedCodec.startsWith('prores') || selectedCodec.startsWith('dnxhr') ? 'MOV 마스터' : 'MP4'}</p></div>
        </div>

        <form ref={formRef} onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          const request: ExportRequest = {
            filename: String(data.get('filename') || projectName),
            height: exportHeight(data),
            codec: exportCodec(data),
            colorMode: data.get('colorMode') === 'hdr10-pq' ? 'hdr10-pq' : data.get('colorMode') === 'hdr-hlg' ? 'hdr-hlg' : 'sdr',
            fps: exportFps(data.get('fps')),
            bitrateMbps: Math.max(1, Number(data.get('bitrate')) || 8),
            hardwareAcceleration: String(data.get('hardware')) as ExportRequest['hardwareAcceleration'],
            includeAudio: data.get('audio') === 'on',
            audioSampleRate: Number(data.get('audioSampleRate')) === 44_100 ? 44_100 : Number(data.get('audioSampleRate')) === 96_000 ? 96_000 : 48_000,
            audioBitrateKbps: Number(data.get('audioBitrate')) === 128 ? 128 : Number(data.get('audioBitrate')) === 256 ? 256 : Number(data.get('audioBitrate')) === 320 ? 320 : 192,
            audioChannels: Number(data.get('audioChannels')) === 1 ? 1 : Number(data.get('audioChannels')) === 6 ? 6 : 2,
            audioDeliveryProfile: normalizeAudioDeliveryProfileId(data.get('audioDeliveryProfile')),
            audioMixdownWav: data.get('mixWav') === 'on',
            audioStems: data.getAll('stem').filter((role): role is AudioRole => audioRoles.includes(role as AudioRole)),
            range: rangeMode,
            rangeStart: requestedRange?.start,
            rangeEnd: requestedRange?.end,
          }
          const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
          const batchRequest = request.range === 'selected-clips' ? { ...request, range: 'sequence' as const, rangeStart: undefined, rangeEnd: undefined } : request
          if (submitter?.value === 'audio-only') onAudioStart({ ...request, audioMixdownWav: true })
          else if (submitter?.value === 'audio-queue') onAudioQueue({ ...request, audioMixdownWav: true })
          else if (submitter?.value === 'batch') onBatchStart?.(batchRequest)
          else if (submitter?.value === 'batch-queue') onBatchQueue?.(batchRequest)
          else if (submitter?.value === 'single-queue') onQueue(request)
          else onStart(request)
        }}>
          <label className="export-field">
            <span>파일 이름</span>
            <input name="filename" defaultValue={projectName} disabled={isExporting} />
          </label>
          <label className="export-field"><span>출력 범위</span><select name="range" value={rangeMode} disabled={isExporting} onChange={(event) => setRangeMode(event.target.value as typeof rangeMode)}><option value="sequence">전체 시퀀스</option><option value="work-area" disabled={!workArea}>시퀀스 IN·OUT{workArea ? ` · ${workArea.start.toFixed(2)}–${workArea.end.toFixed(2)}s` : ' · 지정 안 됨'}</option><option value="selected-clips" disabled={!selectedRange}>선택 클립 범위{selectedRange ? ` · ${selectedRange.start.toFixed(2)}–${selectedRange.end.toFixed(2)}s` : ' · 선택 없음'}</option><option value="custom">사용자 지정 구간</option></select></label>
          {rangeMode === 'custom' && <div className="export-custom-range"><label className="export-field"><span>시작</span><input type="number" min="0" max={Math.max(0, duration - 1 / Math.max(1, sequenceFps))} step={1 / Math.max(1, sequenceFps)} value={customRangeStart} disabled={isExporting} onChange={(event) => setCustomRangeStart(Math.max(0, Math.min(duration, Number(event.target.value) || 0)))} /><small>초</small></label><label className="export-field"><span>끝</span><input type="number" min={1 / Math.max(1, sequenceFps)} max={duration} step={1 / Math.max(1, sequenceFps)} value={customRangeEnd} disabled={isExporting} onChange={(event) => setCustomRangeEnd(Math.max(1 / Math.max(1, sequenceFps), Math.min(duration, Number(event.target.value) || duration)))} /><small>초</small></label></div>}
            <div className="export-preset-row"><label className="export-field"><span>출력 프리셋</span><select value={selectedPresetId} disabled={isExporting} onChange={(event) => applyPreset(event.target.value)}><option value="match-sequence">현재 설정 · 시퀀스 FPS 유지</option>{builtInExportPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}{userPresets.length > 0 && <optgroup label="내 프리셋">{userPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</optgroup>}</select></label><button type="button" className="secondary-button" disabled={isExporting} onClick={savePreset}>현재 설정 저장</button>{userPresets.some((preset) => preset.id === selectedPresetId) && <button type="button" className="secondary-button danger" disabled={isExporting} onClick={removePreset}>삭제</button>}</div>
          <fieldset className="quality-options" disabled={isExporting}>
            <legend>출력 품질</legend>
            <label><input type="radio" name="height" value="match" defaultChecked /><span><strong>시퀀스 일치</strong><small>{preset.width} × {preset.height}</small></span></label>
            <label><input type="radio" name="height" value="720" /><span><strong>빠른 출력</strong><small>{preset.width < preset.height ? `720 × ${Math.round(720 * preset.height / preset.width)}` : preset.width === preset.height ? '720 × 720' : `${Math.round(720 * preset.width / preset.height)} × 720`}</small></span></label>
            <label><input type="radio" name="height" value="1080" /><span><strong>1080 납품</strong><small>{preset.width < preset.height ? `1080 × ${Math.round(1080 * preset.height / preset.width)}` : preset.width === preset.height ? '1080 × 1080' : `${Math.round(1080 * preset.width / preset.height)} × 1080`}</small></span></label>
            <label><input type="radio" name="height" value="2160" /><span><strong>4K 마스터</strong><small>{preset.width < preset.height ? `2160 × ${Math.round(2160 * preset.height / preset.width)}` : preset.width === preset.height ? '2160 × 2160' : `${Math.round(2160 * preset.width / preset.height)} × 2160`}</small></span></label>
            <label><input type="radio" name="height" value="custom" /><span><strong>사용자 지정 기준 변</strong><small><input type="number" name="customHeight" min="16" max="8192" step="2" defaultValue={Math.min(preset.width, preset.height)} onFocus={(event) => { const radio = event.currentTarget.closest('label')?.querySelector<HTMLInputElement>('input[type="radio"]'); if (radio) radio.checked = true }} /> px · 짧은 변 · 종횡비 유지</small></span></label>
          </fieldset>
          <div className="export-options-grid">
            <label className="export-field"><span>비디오 코덱</span><select name="codec" value={selectedCodec} disabled={isExporting} onChange={(event) => { const codec = event.target.value as ExportRequest['codec']; setSelectedCodec(codec); if (codec === 'prores-4444' || codec.startsWith('dnxhr')) { const colorMode = formRef.current?.elements.namedItem('colorMode') as HTMLSelectElement | null; if (colorMode) colorMode.value = 'sdr' } }}><option value="avc">H.264 · 호환성 MP4</option><option value="hevc">H.265/HEVC · 고효율 MP4</option><option value="prores-422">Apple ProRes 422 · 10-bit MOV</option><option value="prores-422-hq">Apple ProRes 422 HQ · 10-bit MOV</option><option value="prores-4444">Apple ProRes 4444 · 10-bit 알파 MOV</option><option value="dnxhr-hq">Avid DNxHR HQ · 8-bit MOV</option><option value="dnxhr-hqx">Avid DNxHR HQX · 10-bit MOV</option></select></label>
            <label className="export-field"><span>색상·비트 심도</span><select name="colorMode" defaultValue="sdr" disabled={isExporting} onChange={(event) => { if (event.target.value !== 'sdr') { const codec = formRef.current?.elements.namedItem('codec') as HTMLSelectElement | null; if (codec) codec.value = 'hevc'; setSelectedCodec('hevc') } }}><option value="sdr">SDR Rec.709 · 8/10-bit</option><option value="hdr10-pq">HDR10 PQ · 10-bit</option><option value="hdr-hlg">HDR HLG · 10-bit</option></select></label>
            <label className="export-field"><span>프레임레이트</span><input name="fps" type="number" min="1" max="240" step="0.001" defaultValue={sequenceFps} list="export-fps-options" disabled={isExporting} /><datalist id="export-fps-options"><option value="23.976" /><option value="24" /><option value="25" /><option value="29.97" /><option value="30" /><option value="47.952" /><option value="48" /><option value="50" /><option value="59.94" /><option value="60" /><option value="120" /></datalist><small>1–240 fps · 시퀀스 {sequenceFps.toFixed(3).replace(/\.0+$/, '')}</small></label>
            <label className="export-field"><span>비트레이트</span><input type="number" name="bitrate" min="1" max="300" defaultValue="16" disabled={isExporting} /><small>Mbps</small></label>
            <label className="export-field"><span>인코더</span><select name="hardware" defaultValue="prefer-hardware" disabled={isExporting}><option value="prefer-hardware">하드웨어 우선</option><option value="no-preference">자동</option><option value="prefer-software">소프트웨어 우선</option></select></label>
            <label className="export-field"><span>오디오 샘플레이트</span><select name="audioSampleRate" value={selectedAudioSampleRate} disabled={isExporting} onChange={(event) => setSelectedAudioSampleRate(Number(event.target.value) === 44_100 ? 44_100 : Number(event.target.value) === 96_000 ? 96_000 : 48_000)}><option value="44100">44.1 kHz</option><option value="48000">48 kHz · 영상 표준</option><option value="96000">96 kHz</option></select></label>
            <label className="export-field"><span>AAC 오디오 비트레이트</span><select name="audioBitrate" defaultValue="192" disabled={isExporting}><option value="128">128 kbps</option><option value="192">192 kbps</option><option value="256">256 kbps</option><option value="320">320 kbps</option></select></label>
            <label className="export-field"><span>오디오 채널</span><select name="audioChannels" defaultValue="2" disabled={isExporting}><option value="2">스테레오</option><option value="1">모노 다운믹스</option><option value="6">5.1 · L R C LFE Ls Rs</option></select></label>
            <label className="export-field"><span>오디오 납품 기준</span><select name="audioDeliveryProfile" value={selectedAudioProfile} disabled={isExporting} onChange={(event) => setSelectedAudioProfile(normalizeAudioDeliveryProfileId(event.target.value))}><option value="web-video">Web 영상 · -14±2 LUFS</option><option value="broadcast-ebu-r128">방송 EBU R128 · -23±0.5 LUFS</option><option value="podcast-stereo">팟캐스트 스테레오 · -16±1 LUFS</option></select></label>
          </div>
          <p className="hdr-export-note">선택한 오디오 기준: {audioDeliveryProfiles[selectedAudioProfile].targetLufs}±{audioDeliveryProfiles[selectedAudioProfile].toleranceLu} LUFS · True Peak ≤ {audioDeliveryProfiles[selectedAudioProfile].maxTruePeakDbtp} dBTP. 출력 후 완성 파일을 다시 측정해 작업 큐에 합격 여부를 보존합니다.</p>
          <p className="hdr-export-note">HDR 모드는 HEVC Main10과 WebGPU가 필요합니다. 현재 합성 화면을 선형 BT.2020으로 변환해 PQ/HLG 10-bit로 인코딩하며, HDR 원본의 네이티브 휘도 보존 여부는 Delivery Guard에서 별도 확인하세요.</p>
          <label className="check-field"><input type="checkbox" name="audio" defaultChecked disabled={isExporting} /> 원본 오디오 포함</label>
          <fieldset className="audio-stem-options" disabled={isExporting}>
            <legend>{selectedAudioSampleRate / 1_000}kHz · 24-bit WAV 납품</legend>
            <label><input type="checkbox" name="mixWav" /><span><strong>Full Mix</strong><small>최종 버스 합산·마스터 처리 전체 믹스</small></span></label>
            {audioRoles.map((role) => <label key={role}><input type="checkbox" name="stem" value={role} /><span><strong>{audioRoleLabels[role]}</strong><small>{role === 'dialogue' ? '대사·ADR·보이스오버' : role === 'music' ? '음악·덕킹 자동화 유지' : role === 'effects' ? '효과음·폴리' : '환경음·룸톤'}</small></span></label>)}
          </fieldset>
          {!isExporting && <section className="delivery-guard"><div><strong>Delivery Guard</strong><small>예상 용량 약 {Math.max(1, Math.round(duration * 16_000_000 / 8 / 1024 / 1024))} MB · 기본 16 Mbps 기준</small></div>{deliveryIssues.map((issue) => <article className={issue.level} key={issue.id}><span>{issue.level === 'blocker' ? '차단' : issue.level === 'warning' ? '확인' : '통과'}</span><p><strong>{issue.title}</strong><small>{issue.detail}</small></p></article>)}</section>}
          {!isExporting && <div className="exchange-actions"><span>후반 작업·납품 메타데이터</span><button type="button" onClick={onCreateDeliveryPackage}>납품 패키지</button><button type="button" onClick={() => onExportExchange?.('otio')}>OTIO</button><button type="button" onClick={() => onExportExchange?.('premiere-xml')}>Premiere XML</button><button type="button" onClick={() => onExportExchange?.('fcpxml')}>FCPXML</button><button type="button" onClick={() => onExportExchange?.('edl')}>EDL</button><button type="button" onClick={() => onExportExchange?.('chapters')}>챕터 TXT</button><button type="button" onClick={() => onExportExchange?.('markers')}>마커 CSV</button></div>}

          {!canExport && !canExportAudio && <p className="export-warning">출력 가능한 영상 또는 오디오 미디어를 타임라인에 추가해야 합니다.</p>}
          {error && <p className="export-error">{error}</p>}
          {isExporting && (
            <div className="export-progress">
              <div><span>{stage}</span><strong>{Math.round(progress * 100)}%</strong></div>
              <progress max="1" value={progress} />
              <small>영상은 이 컴퓨터에서만 처리됩니다.</small>
            </div>
          )}

          <footer>
            {isExporting ? (
              <><button type="button" className="secondary-button" onClick={paused ? onResume : onPause}>{paused ? <Play size={13} /> : <Pause size={13} />} {paused ? '재개' : '일시정지'}</button><button type="button" className="secondary-button" onClick={onClose}>백그라운드로</button><button type="button" className="secondary-button" onClick={onCancel}>취소</button></>
            ) : (
              <>
                <button type="button" className="secondary-button" onClick={onClose}>닫기</button>
                <button type="submit" name="mode" value="audio-only" className="secondary-button" disabled={!canExportAudio}><CheckCircle2 size={15} /> 선택 WAV만 출력</button>
                <button type="submit" name="mode" value="audio-queue" className="secondary-button" disabled={!canExportAudio}>선택 WAV 큐에 추가</button>
                <button type="submit" name="mode" value="single-queue" className="secondary-button" disabled={!canExport}>현재 작업 큐에 추가</button>
                {batchCount > 1 && <button type="submit" name="mode" value="batch-queue" className="secondary-button">쇼츠 일괄 큐에 추가</button>}
                {batchCount > 1 && <button type="submit" name="mode" value="batch" className="secondary-button"><CheckCircle2 size={15} /> 쇼츠 {batchCount}개 일괄 출력</button>}
                <button type="submit" name="mode" value="single" className="primary-button" disabled={!canExport}><CheckCircle2 size={15} /> 현재 {selectedCodec.startsWith('prores') || selectedCodec.startsWith('dnxhr') ? 'MOV 마스터' : 'MP4'} 내보내기</button>
              </>
            )}
          </footer>
        </form>
      </section>
    </div>
  )
}
