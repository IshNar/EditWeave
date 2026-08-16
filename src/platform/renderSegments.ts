import { invoke, isTauri } from '@tauri-apps/api/core'
import { scratchRoot } from './scratchDisks'

function resolvedRoot(override?: string | null): string | undefined {
  return override === undefined ? scratchRoot('render') : override ?? undefined
}

export async function prepareRenderSegment(jobId: string, index: number, scratchRootOverride?: string | null): Promise<string> {
  if (!isTauri()) throw new Error('구간 렌더 복구는 데스크톱 앱에서만 사용할 수 있습니다.')
  return invoke<string>('prepare_render_segment', { jobId, index, scratchRoot: resolvedRoot(scratchRootOverride) })
}

export async function prepareRenderHdrRawSegment(jobId: string, index: number, scratchRootOverride?: string | null): Promise<string> {
  if (!isTauri()) throw new Error('HDR raw 체크포인트는 데스크톱 앱에서만 사용할 수 있습니다.')
  return invoke<string>('prepare_render_hdr_raw_segment', { jobId, index, scratchRoot: resolvedRoot(scratchRootOverride) })
}

export async function encodeRenderHdrSegment(options: { rawPath: string; outputPath: string; width: number; height: number; fps: number; frames: number; bitrateMbps: number; transfer: 'pq' | 'hlg' }): Promise<void> {
  if (!isTauri()) throw new Error('HEVC Main10 구간 인코딩은 데스크톱 앱에서만 사용할 수 있습니다.')
  await invoke('encode_render_hdr_segment', options)
}

export async function decodeRenderHdrSource(options: { jobId: string; index: number; slot: number; sourcePath: string; scratchRootOverride?: string | null; rangeStart: number; width: number; height: number; fps: number; frames: number }): Promise<string> {
  if (!isTauri()) throw new Error('HDR 원본 10-bit 디코딩은 데스크톱 앱에서만 사용할 수 있습니다.')
  const { scratchRootOverride, ...parameters } = options
  return invoke<string>('decode_render_hdr_source', { ...parameters, scratchRoot: resolvedRoot(scratchRootOverride) })
}

export async function prepareRenderAudioMaster(jobId: string, scratchRootOverride?: string | null, format: 'm4a' | 'wav' = 'm4a'): Promise<string> {
  if (!isTauri()) throw new Error('연속 오디오 마스터는 데스크톱 앱에서만 사용할 수 있습니다.')
  return invoke<string>('prepare_render_audio_master', { jobId, scratchRoot: resolvedRoot(scratchRootOverride), format })
}

export async function inspectRenderSegments(jobId: string, scratchRootOverride?: string | null): Promise<number[]> {
  if (!isTauri()) return []
  return invoke<number[]>('inspect_render_segments', { jobId, scratchRoot: resolvedRoot(scratchRootOverride) })
}

export async function cleanupRenderSegments(jobId: string, scratchRootOverride?: string | null): Promise<void> {
  if (!isTauri()) return
  await invoke('cleanup_render_segments', { jobId, scratchRoot: resolvedRoot(scratchRootOverride) })
}
