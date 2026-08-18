export interface RenderRecoveryRecord {
  id: string
  projectId: string
  projectName: string
  sequenceId: string
  filename: string
  codec: 'avc' | 'hevc' | 'prores-422' | 'prores-422-hq' | 'prores-4444' | 'dnxhr-hq' | 'dnxhr-hqx'
  actualCodec?: 'avc' | 'hevc' | 'vp9'
  requiresCodecTranscode?: boolean
  height: number
  fps: number
  rangeStart?: number
  rangeEnd?: number
  progress: number
  stage: string
  status: 'rendering' | 'failed' | 'cancelled'
  updatedAt: string
  error?: string
  outputPath?: string
  mode?: 'single-file' | 'segmented' | 'batch'
  segmentDuration?: number
  completedSegments?: number
  totalSegments?: number
  renderFingerprint?: string
  completedOutputs?: Array<{ sequenceId: string; path: string }>
}

const KEY = 'editweave.render-recovery.v1'

export function readRenderRecovery(): RenderRecoveryRecord | undefined {
  try {
    const value = localStorage.getItem(KEY)
    return value ? JSON.parse(value) as RenderRecoveryRecord : undefined
  } catch {
    return undefined
  }
}

export function writeRenderRecovery(record: RenderRecoveryRecord): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...record, updatedAt: new Date().toISOString() }))
  } catch {
    // Rendering remains available even when local storage is unavailable.
  }
}

export function clearRenderRecovery(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing else is required when recovery metadata cannot be removed.
  }
}

export function createRenderFingerprint(payload: unknown): string {
  const text = JSON.stringify(payload)
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
