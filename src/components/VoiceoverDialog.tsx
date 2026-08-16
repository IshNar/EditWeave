import { Check, Mic2, Pause, Play, Radio, Square, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatTimecode } from '../editor/format'
import type { AdrCue, MediaAsset } from '../editor/types'
import type { AdrTeamDefaults } from '../platform/audioTemplates'

export interface VoiceoverTakeMetadata {
  cue: string
  takeNumber: number
}

export interface VoiceoverSessionResult {
  start: number
  end: number
  selectedTakeNumber: number
  takes: Array<VoiceoverTakeMetadata & { file: File; duration: number }>
}

interface VoiceoverDialogProps {
  open: boolean
  playhead: number
  activeSequenceId: string
  cues: AdrCue[]
  assets: MediaAsset[]
  defaults: AdrTeamDefaults
  onClose: () => void
  onComplete: (session: VoiceoverSessionResult) => Promise<void>
  onSelectCueTake: (cueId: string, takeId: string) => void
  onSeekCue: (cueId: string) => void
  onDeleteCue: (cueId: string) => void
  onLoopChange: (range?: { start: number; end: number }) => void
}

interface RecordedTake extends VoiceoverTakeMetadata {
  id: string
  file: File
  url: string
  duration: number
}

type RecordingState = 'idle' | 'ready' | 'countdown' | 'recording' | 'paused' | 'processing'

export function VoiceoverDialog({ open, playhead, activeSequenceId, cues, assets, defaults, onClose, onComplete, onSelectCueTake, onSeekCue, onDeleteCue, onLoopChange }: VoiceoverDialogProps) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [state, setState] = useState<RecordingState>('idle')
  const [meter, setMeter] = useState(0)
  const [countdown, setCountdown] = useState(0)
  const [duration, setDuration] = useState(0)
  const [cue, setCue] = useState('')
  const [cueDuration, setCueDuration] = useState(5)
  const [looping, setLooping] = useState(false)
  const [takes, setTakes] = useState<RecordedTake[]>([])
  const [selectedTakeId, setSelectedTakeId] = useState<string>()
  const [error, setError] = useState<string>()
  const streamRef = useRef<MediaStream | undefined>(undefined)
  const audioContextRef = useRef<AudioContext | undefined>(undefined)
  const recorderRef = useRef<MediaRecorder | undefined>(undefined)
  const chunksRef = useRef<Blob[]>([])
  const discardRef = useRef(false)
  const meterFrameRef = useRef<number | undefined>(undefined)
  const timerRef = useRef<number | undefined>(undefined)
  const countdownRef = useRef<number | undefined>(undefined)
  const durationRef = useRef(0)
  const takeNumberRef = useRef(0)
  const takeUrlsRef = useRef<string[]>([])

  const stopTimer = () => {
    if (timerRef.current !== undefined) window.clearInterval(timerRef.current)
    timerRef.current = undefined
  }

  const startTimer = () => {
    stopTimer()
    timerRef.current = window.setInterval(() => {
      durationRef.current += 0.25
      setDuration(durationRef.current)
    }, 250)
  }

  const stopInput = () => {
    if (meterFrameRef.current !== undefined) cancelAnimationFrame(meterFrameRef.current)
    meterFrameRef.current = undefined
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = undefined
    if (audioContextRef.current) void audioContextRef.current.close()
    audioContextRef.current = undefined
    setMeter(0)
  }

  const releaseTakeUrls = () => {
    takeUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    takeUrlsRef.current = []
  }

  const refreshDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput')
    setDevices(inputs)
    setDeviceId((current) => current || inputs.find((device) => device.label === defaults.preferredDeviceLabel)?.deviceId || inputs[0]?.deviceId || '')
  }

  useEffect(() => {
    if (!open) return
    setState('idle')
    setError(undefined)
    setCountdown(0)
    setDuration(0)
    setCue('')
    setCueDuration(defaults.cueDuration)
    setLooping(false)
    setTakes([])
    setSelectedTakeId(undefined)
    durationRef.current = 0
    takeNumberRef.current = 0
    releaseTakeUrls()
    return () => {
      stopTimer()
      if (countdownRef.current !== undefined) window.clearInterval(countdownRef.current)
      countdownRef.current = undefined
      discardRef.current = true
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      recorderRef.current = undefined
      stopInput()
      releaseTakeUrls()
      onLoopChange(undefined)
    }
  }, [open])

  const connectInput = async (): Promise<MediaStream | undefined> => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('이 환경에서 마이크 입력을 지원하지 않습니다.')
      stopInput()
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false })
      streamRef.current = stream
      await refreshDevices()
      const context = new AudioContext()
      audioContextRef.current = context
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
      const samples = new Uint8Array(analyser.fftSize)
      const draw = () => {
        if (!streamRef.current) return
        analyser.getByteTimeDomainData(samples)
        let sum = 0
        for (const value of samples) sum += ((value - 128) / 128) ** 2
        setMeter(Math.min(1, Math.sqrt(sum / samples.length) * 3.2))
        meterFrameRef.current = requestAnimationFrame(draw)
      }
      draw()
      setState('ready')
      setError(undefined)
      return stream
    } catch (reason) {
      setState('idle')
      setError(reason instanceof Error ? reason.message : '마이크를 연결하지 못했습니다.')
      return undefined
    }
  }

  const beginRecorder = (stream: MediaStream) => {
    if (typeof MediaRecorder === 'undefined') {
      setState('ready')
      setError('이 WebView는 마이크 녹음 인코더를 지원하지 않습니다.')
      return
    }
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find((candidate) => MediaRecorder.isTypeSupported(candidate))
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 192_000 }) : new MediaRecorder(stream)
    const cueAtRecord = cue.trim()
    chunksRef.current = []
    discardRef.current = false
    recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data) }
    recorder.onerror = () => { stopTimer(); setState('ready'); setError('마이크 녹음 중 오류가 발생했습니다.') }
    recorder.onstop = () => {
      recorderRef.current = undefined
      stopTimer()
      if (discardRef.current) return
      const type = recorder.mimeType || mimeType || 'audio/webm'
      const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
      const takeNumber = takeNumberRef.current + 1
      takeNumberRef.current = takeNumber
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const file = new File(chunksRef.current, `voiceover-take-${takeNumber}-${stamp}.${extension}`, { type })
      const url = URL.createObjectURL(file)
      const take: RecordedTake = { id: crypto.randomUUID(), file, url, duration: Math.max(0.05, durationRef.current), cue: cueAtRecord, takeNumber }
      takeUrlsRef.current.push(url)
      setTakes((current) => [...current, take])
      setSelectedTakeId(take.id)
      durationRef.current = 0
      setDuration(0)
      setState('ready')
    }
    recorderRef.current = recorder
    recorder.start(250)
    durationRef.current = 0
    setDuration(0)
    setState('recording')
    startTimer()
  }

  const startCountdown = async () => {
    document.querySelectorAll<HTMLAudioElement>('.voiceover-take audio').forEach((player) => player.pause())
    const stream = streamRef.current ?? await connectInput()
    if (!stream) return
    setState('countdown')
    if (defaults.countdownSeconds === 0) {
      beginRecorder(stream)
      return
    }
    setCountdown(defaults.countdownSeconds)
    let remaining = defaults.countdownSeconds
    countdownRef.current = window.setInterval(() => {
      remaining -= 1
      setCountdown(remaining)
      if (remaining <= 0) {
        if (countdownRef.current !== undefined) window.clearInterval(countdownRef.current)
        countdownRef.current = undefined
        beginRecorder(stream)
      }
    }, 1000)
  }

  const togglePause = () => {
    const recorder = recorderRef.current
    if (!recorder) return
    if (recorder.state === 'recording') {
      recorder.pause()
      stopTimer()
      setState('paused')
    } else if (recorder.state === 'paused') {
      recorder.resume()
      startTimer()
      setState('recording')
    }
  }

  const finishRecording = () => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    recorder.stop()
  }

  const removeTake = (id: string) => {
    const target = takes.find((take) => take.id === id)
    if (target) {
      URL.revokeObjectURL(target.url)
      takeUrlsRef.current = takeUrlsRef.current.filter((url) => url !== target.url)
    }
    const remaining = takes.filter((take) => take.id !== id)
    setTakes(remaining)
    if (selectedTakeId === id) setSelectedTakeId(remaining[remaining.length - 1]?.id)
  }

  const commitSelectedTake = async () => {
    const selected = takes.find((take) => take.id === selectedTakeId)
    if (!selected) return
    setState('processing')
    setError(undefined)
    try {
      await onComplete({ start: playhead, end: playhead + cueDuration, selectedTakeNumber: selected.takeNumber, takes: takes.map((take) => ({ file: take.file, cue: take.cue, takeNumber: take.takeNumber, duration: take.duration })) })
      stopInput()
      onLoopChange(undefined)
      onClose()
    } catch (reason) {
      setState('ready')
      setError(reason instanceof Error ? reason.message : '선택한 테이크를 프로젝트에 추가하지 못했습니다.')
    }
  }

  const cancel = () => {
    discardRef.current = true
    stopTimer()
    if (countdownRef.current !== undefined) window.clearInterval(countdownRef.current)
    countdownRef.current = undefined
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    stopInput()
    releaseTakeUrls()
    onLoopChange(undefined)
    onClose()
  }

  if (!open) return null
  const recording = state === 'recording' || state === 'paused'
  const sequenceCues = cues.filter((item) => item.sequenceId === activeSequenceId)
  return <div className="modal-backdrop"><section className="voiceover-dialog" role="dialog" aria-modal="true" aria-labelledby="voiceover-title"><header><div><span className="eyebrow">LOCAL ADR · VOICEOVER</span><h2 id="voiceover-title">ADR 세션</h2></div><button className="icon-button" disabled={state === 'processing'} onClick={cancel} aria-label="보이스오버 닫기"><X size={17} /></button></header>{sequenceCues.length > 0 && <div className="adr-cue-queue"><div className="property-heading"><strong>대본 큐 · {sequenceCues.length}</strong><small>테이크를 눌러 채택</small></div>{sequenceCues.map((item) => <article key={item.id}><button className="adr-cue-seek" onClick={() => onSeekCue(item.id)}><span>{formatTimecode(item.start, true)}–{formatTimecode(item.end, true)}</span><strong>{item.text || '대사 없음'}</strong></button><div>{item.takes.map((take) => { const asset = assets.find((candidate) => candidate.id === take.assetId); return <button key={take.id} className={item.selectedTakeId === take.id ? 'selected' : ''} onClick={() => onSelectCueTake(item.id, take.id)}>T{take.takeNumber}{asset?.url && <audio controls preload="metadata" src={asset.url} onClick={(event) => event.stopPropagation()} />}</button> })}<button className="danger" onClick={() => onDeleteCue(item.id)}><Trash2 size={11} /></button></div></article>)}</div>}<div className="voiceover-target"><Radio size={16} /><div><strong>{formatTimecode(playhead, true)}에서 시작</strong><span>여러 테이크를 녹음하면 타임라인의 별도 ADR 레인에 모두 보존됩니다.</span></div></div><div className="adr-range-row"><label className="text-field voiceover-cue"><span>ADR 대사 큐</span><textarea value={cue} disabled={recording || state === 'countdown' || state === 'processing'} placeholder="읽을 대사나 연출 메모" onChange={(event) => setCue(event.target.value)} /></label><label className="number-field"><span>큐 길이</span><div><input type="number" min="0.5" max="120" step="0.5" value={cueDuration} disabled={recording || state === 'countdown' || state === 'processing'} onChange={(event) => { const next = Math.max(0.5, Math.min(120, Number(event.target.value))); setCueDuration(next); if (looping) onLoopChange({ start: playhead, end: playhead + next }) }} /><small>s</small></div></label></div><button className={`adr-loop-button ${looping ? 'active' : ''}`} disabled={recording || state === 'countdown' || state === 'processing'} onClick={() => { const next = !looping; setLooping(next); onLoopChange(next ? { start: playhead, end: playhead + cueDuration } : undefined) }}>{looping ? '구간 반복 해제' : '큐 구간 반복 재생'}</button><label className="export-field"><span>마이크 장치</span><select value={deviceId} disabled={recording || state === 'countdown' || state === 'processing'} onChange={(event) => setDeviceId(event.target.value)}>{devices.length ? devices.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `마이크 ${index + 1}`}</option>) : <option value="">기본 마이크</option>}</select></label><small className="voiceover-privacy-note">카메라는 사용하지 않습니다. 마이크 연결을 누를 때만 오디오 입력 권한과 장치 목록에 접근합니다.</small><div className="voiceover-meter" aria-label="마이크 입력 레벨"><i style={{ width: `${meter * 100}%` }} /><span>-∞</span><span>-12</span><span>0 dB</span></div><div className={`voiceover-clock ${recording ? 'recording' : ''}`}><Mic2 size={20} /><strong>{state === 'countdown' ? countdown : formatTimecode(duration, true)}</strong><span>{state === 'idle' ? '입력을 연결해 레벨을 확인하세요.' : state === 'ready' ? takes.length ? '다음 테이크 녹음 또는 전체 레인 배치' : '녹음 준비됨' : state === 'countdown' ? '카운트다운' : state === 'paused' ? '일시정지' : state === 'processing' ? '전체 테이크 저장·배치 중' : '녹음 중'}</span></div>{takes.length > 0 && <div className="voiceover-takes"><strong>현재 세션 테이크</strong>{takes.map((take) => <div className={`voiceover-take ${selectedTakeId === take.id ? 'selected' : ''}`} key={take.id}><label><input type="radio" name="voiceover-take" checked={selectedTakeId === take.id} disabled={state === 'processing'} onChange={() => setSelectedTakeId(take.id)} /><span>Take {take.takeNumber}<small>{formatTimecode(take.duration, true)}{take.cue ? ` · ${take.cue}` : ''}</small></span></label><audio controls preload="metadata" src={take.url} /><button className="icon-button" disabled={state === 'processing'} onClick={() => removeTake(take.id)} aria-label={`Take ${take.takeNumber} 삭제`}><Trash2 size={13} /></button></div>)}</div>}{error && <p className="export-error">{error}</p>}<footer>{state === 'idle' && <button className="secondary-button" onClick={() => void connectInput()}>마이크 연결</button>}{state === 'ready' && <button className="secondary-button" onClick={() => void startCountdown()}><Mic2 size={13} /> {takes.length ? '다음 테이크' : defaults.countdownSeconds === 0 ? '바로 녹음' : `${defaults.countdownSeconds}초 후 녹음`}</button>}{recording && <><button className="secondary-button" onClick={togglePause}>{state === 'paused' ? <Play size={13} /> : <Pause size={13} />} {state === 'paused' ? '계속' : '일시정지'}</button><button className="primary-button" onClick={finishRecording}><Square size={12} /> 테이크 완료</button></>}{state === 'ready' && selectedTakeId && <button className="primary-button" onClick={() => void commitSelectedTake()}><Check size={13} /> 전체 레인 저장·선택 채택</button>}{state !== 'processing' && <button className="secondary-button" onClick={cancel}>취소</button>}</footer></section></div>
}
