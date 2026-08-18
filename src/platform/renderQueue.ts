import { normalizeLoudnessMeasurement, type LoudnessMeasurement } from './loudness'
import type { AudioDeliveryProfileId } from './audioDeliveryConformance'
import type { AudioRole, ProjectSequence } from '../editor/types'

export type RenderQueueStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface RenderQueueSettings {
  filename: string
  range?: 'sequence' | 'work-area' | 'selected-clips' | 'custom'
  rangeStart?: number
  rangeEnd?: number
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
}

export interface RenderQueueJob {
  id: string
  projectId: string
  projectName: string
  sequenceId: string
  sequenceName: string
  sequenceIds?: string[]
  sequenceSnapshots?: ProjectSequence[]
  kind: 'single' | 'audio-only' | 'shorts-batch'
  settings: RenderQueueSettings
  progress: number
  stage: string
  status: RenderQueueStatus
  createdAt: string
  updatedAt: string
  outputPath?: string
  loudness?: LoudnessMeasurement
  loudnessReports?: Array<LoudnessMeasurement & { outputPath: string }>
  loudnessError?: string
  stemOutputs?: Array<{ role: AudioRole | 'mix'; path: string }>
  renderScratchRoot?: string | null
  error?: string
}

const KEY = 'editweave.render-queue.v1'

export function readRenderQueue(): RenderQueueJob[] {
  try {
    const raw = localStorage.getItem(KEY)
    const value: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(value)) return []
    return value.flatMap((candidate) => isRenderQueueJob(candidate) ? [{
      ...candidate,
      loudness: normalizeLoudnessMeasurement(candidate.loudness, candidate.settings.audioDeliveryProfile),
      loudnessReports: candidate.loudnessReports?.flatMap((report) => {
        const normalized = normalizeLoudnessMeasurement(report, candidate.settings.audioDeliveryProfile)
        return normalized ? [{ ...normalized, outputPath: report.outputPath }] : []
      }),
      status: candidate.status === 'running' || candidate.status === 'paused' ? 'interrupted' as const : candidate.status,
      stage: candidate.status === 'running' || candidate.status === 'paused' ? '앱 종료로 중단됨 · 재시도 가능' : candidate.stage,
    }] : []).slice(-30)
  } catch {
    return []
  }
}

export function writeRenderQueue(jobs: RenderQueueJob[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(jobs.slice(-30)))
  } catch {
    // Rendering remains available when local storage is unavailable.
  }
}

function isRenderQueueJob(value: unknown): value is RenderQueueJob {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RenderQueueJob>
  return typeof candidate.id === 'string'
    && typeof candidate.projectId === 'string'
    && typeof candidate.sequenceId === 'string'
    && typeof candidate.settings === 'object'
    && typeof candidate.status === 'string'
}

export interface PauseGate {
  pause: () => void
  resume: () => void
  wait: (signal?: AbortSignal) => Promise<void>
  isPaused: () => boolean
}

export function createPauseGate(): PauseGate {
  let paused = false
  let waiters: Array<() => void> = []
  return {
    pause() {
      paused = true
    },
    resume() {
      paused = false
      const current = waiters
      waiters = []
      current.forEach((resolve) => resolve())
    },
    async wait(signal) {
      if (!paused) return
      await new Promise<void>((resolve, reject) => {
        const resume = () => {
          signal?.removeEventListener('abort', abort)
          resolve()
        }
        const abort = () => {
          waiters = waiters.filter((waiter) => waiter !== resume)
          reject(new DOMException('렌더를 취소했습니다.', 'AbortError'))
        }
        waiters.push(resume)
        signal?.addEventListener('abort', abort, { once: true })
      })
    },
    isPaused: () => paused,
  }
}
