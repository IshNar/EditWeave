import { invoke, isTauri } from '@tauri-apps/api/core'

export async function applyBroadcastWavMetadata(path: string, sampleRate: 44_100 | 48_000 | 96_000, startSeconds: number, description: string): Promise<void> {
  if (!isTauri()) return
  const timeReference = Math.max(0, Math.round(startSeconds * sampleRate))
  await invoke('apply_broadcast_wav_metadata', { outputPath: path, sampleRate, timeReference, description: description.slice(0, 256) })
}
