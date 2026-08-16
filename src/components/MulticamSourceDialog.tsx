import { useEffect, useState } from 'react'
import { Clapperboard, X } from 'lucide-react'
import type { MediaAsset } from '../editor/types'

export interface MulticamSourceOptions {
  name: string
  syncMode: 'timecode' | 'waveform' | 'clap' | 'start'
  audioMode: 'camera-1' | 'follow-video' | 'selected-angle' | 'all'
  audioAngle?: number
  placeOnTimeline: boolean
}

interface MulticamSourceDialogProps {
  open: boolean
  assets: MediaAsset[]
  suggestedName: string
  onClose: () => void
  onCreate: (options: MulticamSourceOptions) => void
}

export function MulticamSourceDialog({ open, assets, suggestedName, onClose, onCreate }: MulticamSourceDialogProps) {
  const [name, setName] = useState(suggestedName)
  const [syncMode, setSyncMode] = useState<MulticamSourceOptions['syncMode']>('timecode')
  const [audioMode, setAudioMode] = useState<MulticamSourceOptions['audioMode']>('camera-1')
  const [audioAngle, setAudioAngle] = useState(0)
  const [placeOnTimeline, setPlaceOnTimeline] = useState(true)
  const allTimecode = assets.length > 1 && assets.every((asset) => asset.timecodeStart !== undefined)
  const allWaveform = assets.length > 1 && assets.every((asset) => asset.waveform && asset.waveform.length >= 8)
  const availableAudioAngles = assets.flatMap((asset, index) => asset.audioCodec || asset.channels ? [index] : [])
  const firstAvailableAudioAngle = availableAudioAngles[0] ?? -1
  const selectedAudioAvailable = availableAudioAngles.includes(audioAngle)
  useEffect(() => {
    if (!open) return
    setName(suggestedName)
    setSyncMode(allTimecode ? 'timecode' : allWaveform ? 'waveform' : 'start')
    setAudioAngle(Math.max(0, firstAvailableAudioAngle))
    setAudioMode(firstAvailableAudioAngle === 0 ? 'camera-1' : firstAvailableAudioAngle > 0 ? 'selected-angle' : 'all')
  }, [allTimecode, allWaveform, firstAvailableAudioAngle, open, suggestedName])
  if (!open) return null
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="automate-sequence-dialog multicam-source-dialog" role="dialog" aria-modal="true" aria-labelledby="multicam-source-title">
      <header><div><span className="eyebrow">CREATE MULTI-CAMERA SOURCE SEQUENCE</span><h2 id="multicam-source-title">멀티캠 소스 시퀀스</h2><p>{assets.length}개 카메라 원본을 각도별 영상·오디오 트랙으로 동기화합니다.</p></div><button className="icon-button" onClick={onClose} aria-label="닫기"><X size={17} /></button></header>
      <div className="automate-source-summary"><Clapperboard size={18} /><div>{assets.map((asset, index) => <span key={asset.id}>CAM {index + 1} · {asset.camera || asset.name}</span>)}</div></div>
      <div className="automate-fields">
        <label><span>시퀀스 이름</span><input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
        <label><span>동기화 기준</span><select value={syncMode} onChange={(event) => setSyncMode(event.target.value as MulticamSourceOptions['syncMode'])}><option value="timecode" disabled={!allTimecode}>소스 타임코드{allTimecode ? '' : ' · 일부 없음'}</option><option value="waveform" disabled={!allWaveform}>오디오 파형{allWaveform ? '' : ' · 분석값 없음'}</option><option value="clap" disabled={!allWaveform}>클랩 피크{allWaveform ? '' : ' · 분석값 없음'}</option><option value="start">클립 시작점</option></select></label>
        <label><span>멀티캠 오디오</span><select value={audioMode} onChange={(event) => { const mode = event.target.value as MulticamSourceOptions['audioMode']; setAudioMode(mode); if (mode === 'selected-angle' && !selectedAudioAvailable) setAudioAngle(availableAudioAngles[0] ?? 0) }}><option value="camera-1">CAM 1 오디오 고정</option><option value="follow-video">영상 각도 따라 전환</option><option value="selected-angle">지정 카메라 오디오 고정</option><option value="all">모든 카메라 오디오 믹스</option></select></label>
        {audioMode === 'selected-angle' && <label><span>고정 오디오 카메라</span><select value={audioAngle} onChange={(event) => setAudioAngle(Number(event.target.value))}>{assets.map((asset, index) => <option key={asset.id} value={index} disabled={!asset.audioCodec && !asset.channels}>CAM {index + 1} · {asset.camera || asset.name}{!asset.audioCodec && !asset.channels ? ' · 오디오 없음' : ''}</option>)}</select></label>}
        <label className="automate-check"><input type="checkbox" checked={placeOnTimeline} onChange={(event) => setPlaceOnTimeline(event.target.checked)} /><span>현재 재생 헤드에 멀티캠 클립 배치</span></label>
      </div>
      <footer><span>{syncMode === 'timecode' ? '컨테이너/수동 소스 타임코드의 절대 시간을 맞춥니다.' : syncMode === 'waveform' ? '첫 카메라 파형과 상호상관으로 정렬합니다.' : syncMode === 'clap' ? '각 소스의 가장 뚜렷한 트랜지언트를 맞춥니다.' : '모든 카메라를 00:00에서 시작합니다.'}</span><button onClick={onClose}>취소</button><button className="primary" disabled={assets.length < 2 || !name.trim() || audioMode === 'selected-angle' && !selectedAudioAvailable} onClick={() => onCreate({ name: name.trim(), syncMode, audioMode, audioAngle: audioMode === 'selected-angle' ? audioAngle : undefined, placeOnTimeline })}>멀티캠 생성</button></footer>
    </section>
  </div>
}
