import { ArrowDown, ArrowUp, CheckCircle2, Clock3, Pause, Play, RotateCcw, Trash2, X, XCircle } from 'lucide-react'
import type { RenderQueueJob } from '../platform/renderQueue'

interface RenderQueueDialogProps {
  open: boolean
  jobs: RenderQueueJob[]
  currentProjectId: string
  activeJobId?: string
  paused: boolean
  queueRunning: boolean
  onClose: () => void
  onPause: () => void
  onResume: () => void
  onCancel: () => void
  onRetry: (job: RenderQueueJob) => void
  onRemove: (id: string) => void
  onClearFinished: () => void
  onStartQueue: () => void
  onStopQueue: () => void
  onMoveQueued: (id: string, direction: -1 | 1) => void
  onRefreshSnapshot: (job: RenderQueueJob) => void
}

const statusLabel: Record<RenderQueueJob['status'], string> = {
  queued: '대기', running: '렌더 중', paused: '일시정지', completed: '완료', failed: '실패', cancelled: '취소', interrupted: '중단',
}

function renderRangeLabel(job: RenderQueueJob): string {
  const label = job.settings.range === 'work-area' ? 'IN·OUT' : job.settings.range === 'selected-clips' ? '선택 클립' : job.settings.range === 'custom' ? '사용자 구간' : '전체'
  return Number.isFinite(job.settings.rangeStart) && Number.isFinite(job.settings.rangeEnd)
    ? `${label} ${job.settings.rangeStart!.toFixed(2)}–${job.settings.rangeEnd!.toFixed(2)}s`
    : label
}

export function RenderQueueDialog({ open, jobs, currentProjectId, activeJobId, paused, queueRunning, onClose, onPause, onResume, onCancel, onRetry, onRemove, onClearFinished, onStartQueue, onStopQueue, onMoveQueued, onRefreshSnapshot }: RenderQueueDialogProps) {
  if (!open) return null
  const queuedJobs = jobs.filter((job) => job.status === 'queued' && job.projectId === currentProjectId)
  const orderedJobs = [...jobs.filter((job) => job.id === activeJobId), ...queuedJobs, ...jobs.filter((job) => job.id !== activeJobId && !queuedJobs.some((queued) => queued.id === job.id)).reverse()]
  return <div className="modal-backdrop" role="presentation">
    <section className="render-queue-dialog" role="dialog" aria-modal="true" aria-labelledby="render-queue-title">
      <header><div><span className="eyebrow">PERSISTENT RENDER QUEUE</span><h2 id="render-queue-title">렌더 작업</h2></div><button className="icon-button" onClick={onClose} aria-label="렌더 작업 닫기"><X size={17} /></button></header>
      <div className="render-job-list">
        {orderedJobs.map((job) => {
          const active = job.id === activeJobId
          const queueIndex = queuedJobs.findIndex((queued) => queued.id === job.id)
          return <article className={`render-job ${job.status}`} key={job.id}>
            <div className="render-job-heading"><span>{job.status === 'completed' ? <CheckCircle2 size={13} /> : job.status === 'failed' || job.status === 'interrupted' ? <XCircle size={13} /> : <Clock3 size={13} />}</span><div><strong>{job.settings.filename}</strong><small>{job.projectId === currentProjectId ? '' : `${job.projectName} · `}{job.sequenceName} · {renderRangeLabel(job)} · {job.sequenceSnapshots?.length ? `큐 스냅샷 ${job.sequenceSnapshots.length}개` : '현재 시퀀스 참조'} · {job.kind === 'audio-only' ? `${(job.settings.audioSampleRate ?? 48_000) / 1_000}kHz 24-bit ${job.settings.audioChannels === 6 ? '5.1' : job.settings.audioChannels === 1 ? 'mono' : 'stereo'} WAV 납품` : `${job.settings.codec === 'prores-4444' ? 'ProRes 4444 Alpha' : job.settings.codec === 'prores-422-hq' ? 'ProRes 422 HQ' : job.settings.codec === 'prores-422' ? 'ProRes 422' : job.settings.codec === 'dnxhr-hqx' ? 'DNxHR HQX' : job.settings.codec === 'dnxhr-hq' ? 'DNxHR HQ' : job.settings.codec === 'hevc' ? 'H.265' : 'H.264'} · ${job.settings.colorMode === 'hdr10-pq' ? 'HDR10 10-bit' : job.settings.colorMode === 'hdr-hlg' ? 'HLG 10-bit' : job.settings.codec === 'prores-4444' ? 'SDR 10-bit + Alpha' : job.settings.codec.startsWith('prores') || job.settings.codec === 'dnxhr-hqx' ? 'SDR 10-bit' : 'SDR'} · 기준 변 ${job.settings.height}px · ${job.settings.fps}fps${job.settings.includeAudio ? ` · ${(job.settings.audioSampleRate ?? 48_000) / 1_000}kHz ${job.settings.audioChannels === 6 ? '5.1' : job.settings.audioChannels === 1 ? 'mono' : 'stereo'} ${(job.settings.audioBitrateKbps ?? 192)}kbps` : ''}`}{job.settings.audioMixdownWav || job.settings.audioStems?.length ? ` · WAV ${Number(Boolean(job.settings.audioMixdownWav)) + (job.settings.audioStems?.length ?? 0)}개` : ''}</small></div><em>{statusLabel[job.status]}</em></div>
            <div className="render-job-progress"><progress max="1" value={job.progress} /><span>{Math.round(job.progress * 100)}%</span></div>
            <p>{job.error || job.outputPath || job.stage}</p>
            {job.loudness && <div className="render-loudness"><strong>{job.loudness.conformance.status === 'pass' ? '적합' : '확인 필요'} · 실측 {job.loudness.integratedLufs.toFixed(1)} LUFS</strong><span>LRA {job.loudness.loudnessRangeLu.toFixed(1)} LU</span><span>True Peak {job.loudness.truePeakDbtp.toFixed(1)} dBTP</span>{job.loudness.conformance.issues.map((issue) => <span key={issue.id}>{issue.title}</span>)}</div>}
            {job.loudnessReports?.length ? <div className="render-loudness batch"><strong>쇼츠 {job.loudnessReports.filter((report) => report.conformance.status === 'pass').length}/{job.loudnessReports.length}개 적합</strong><span>LUFS {Math.min(...job.loudnessReports.map((report) => report.integratedLufs)).toFixed(1)}~{Math.max(...job.loudnessReports.map((report) => report.integratedLufs)).toFixed(1)}</span><span>최대 TP {Math.max(...job.loudnessReports.map((report) => report.truePeakDbtp)).toFixed(1)} dBTP</span></div> : null}
            {job.loudnessError && <small className="render-measure-error">러드니스 실측 일부 실패 · {job.loudnessError}</small>}
            {job.stemOutputs?.length ? <div className="render-stem-outputs">{job.stemOutputs.map((stem) => <span key={`${stem.role}-${stem.path}`} title={stem.path}>{stem.role.toUpperCase()} · {stem.path}</span>)}</div> : null}
            <footer>{active ? <><button onClick={paused ? onResume : onPause}>{paused ? <Play size={11} /> : <Pause size={11} />} {paused ? '재개' : '일시정지'}</button><button className="danger" onClick={onCancel}><X size={11} /> 취소</button></> : <>{queueIndex >= 0 && <span className="render-queue-order"><b>순서 {queueIndex + 1}</b><button disabled={queueIndex === 0} onClick={() => onMoveQueued(job.id, -1)} title="먼저 렌더"><ArrowUp size={11} /></button><button disabled={queueIndex === queuedJobs.length - 1} onClick={() => onMoveQueued(job.id, 1)} title="나중에 렌더"><ArrowDown size={11} /></button></span>}{job.status === 'queued' && job.projectId === currentProjectId && <button onClick={() => onRefreshSnapshot(job)}><RotateCcw size={11} /> 현재 편집 반영</button>}{(['failed', 'cancelled', 'interrupted'] as const).includes(job.status as 'failed' | 'cancelled' | 'interrupted') && <button onClick={() => onRetry(job)}><RotateCcw size={11} /> 재시도</button>}<button onClick={() => onRemove(job.id)}><Trash2 size={11} /> 제거</button></>}</footer>
          </article>
        })}
        {!jobs.length && <div className="render-queue-empty"><Clock3 size={21} /><strong>렌더 작업이 없습니다</strong><p>내보내기를 시작하면 진행 상태와 결과가 여기에 보존됩니다.</p></div>}
      </div>
      <footer><button className="secondary-button" onClick={onClearFinished}>완료·취소 작업 정리</button>{queueRunning ? <button className="secondary-button danger" onClick={onStopQueue}>순차 실행 중지</button> : <button className="primary-button" disabled={!jobs.some((job) => job.status === 'queued' && job.projectId === currentProjectId)} onClick={onStartQueue}>현재 프로젝트 큐 실행</button>}<button className="secondary-button" onClick={onClose}>닫기</button></footer>
    </section>
  </div>
}
