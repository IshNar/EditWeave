import { invoke } from '@tauri-apps/api/core'
import type { SequenceExportResult } from '../media/export'
import type { ExportRequest } from '../components/ExportDialog'

export function isProResCodec(codec: ExportRequest['codec']): codec is 'prores-422' | 'prores-422-hq' | 'prores-4444' {
  return codec === 'prores-422' || codec === 'prores-422-hq' || codec === 'prores-4444'
}

export function isMezzanineCodec(codec: ExportRequest['codec']): codec is 'prores-422' | 'prores-422-hq' | 'prores-4444' | 'dnxhr-hq' | 'dnxhr-hqx' {
  return isProResCodec(codec) || codec === 'dnxhr-hq' || codec === 'dnxhr-hqx'
}

export function intermediateRenderCodec(request: Pick<ExportRequest, 'codec' | 'colorMode'>): 'avc' | 'hevc' {
  return request.colorMode === 'hdr10-pq' || request.colorMode === 'hdr-hlg' || request.codec === 'hevc' ? 'hevc' : 'avc'
}

export function renderCodecLabel(codec: ExportRequest['codec']): string {
  if (codec === 'prores-4444') return 'Apple ProRes 4444 알파'
  if (codec === 'prores-422-hq') return 'Apple ProRes 422 HQ'
  if (codec === 'prores-422') return 'Apple ProRes 422'
  if (codec === 'dnxhr-hqx') return 'Avid DNxHR HQX 10-bit'
  if (codec === 'dnxhr-hq') return 'Avid DNxHR HQ'
  return codec === 'hevc' ? 'H.265/HEVC' : 'H.264'
}

export async function finalizeRequestedCodec(path: string, result: Pick<SequenceExportResult, 'requiresCodecTranscode' | 'requestedCodec'>, bitrateMbps: number): Promise<void> {
  if (!result.requiresCodecTranscode) return
  await invoke('transcode_render_codec', {
    sourcePath: path,
    codec: result.requestedCodec,
    bitrateMbps: Math.max(1, Math.min(300, Math.round(bitrateMbps))),
    audioSampleRate: null,
    timecode: null,
  })
}

export async function finalizeMasterCodec(path: string, codec: ExportRequest['codec'], bitrateMbps: number, audioSampleRate: ExportRequest['audioSampleRate'], timecode: string): Promise<void> {
  if (!isMezzanineCodec(codec)) return
  await invoke('transcode_render_codec', {
    sourcePath: path,
    codec,
    bitrateMbps: Math.max(1, Math.min(300, Math.round(bitrateMbps))),
    audioSampleRate,
    timecode,
  })
}

export async function muxContinuousSurroundAudio(videoPath: string, audioPath: string, bitrateKbps: number, sampleRate: ExportRequest['audioSampleRate']): Promise<void> {
  await invoke('mux_render_surround_audio', {
    videoPath,
    audioPath,
    bitrateKbps: Math.max(192, Math.min(640, Math.round(bitrateKbps))),
    sampleRate,
  })
}
