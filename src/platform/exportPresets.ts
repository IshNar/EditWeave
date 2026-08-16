import type { ExportRequest } from '../components/ExportDialog'

export interface SavedExportPreset {
  id: string
  name: string
  settings: Omit<ExportRequest, 'filename'>
  builtIn?: boolean
}

const storageKey = 'cutline.export-presets.v1'

export const builtInExportPresets: SavedExportPreset[] = [
  { id: 'youtube-1080', name: 'YouTube 1080p', builtIn: true, settings: { height: 1080, codec: 'avc', colorMode: 'sdr', fps: 30, bitrateMbps: 16, hardwareAcceleration: 'prefer-hardware', includeAudio: true, audioSampleRate: 48_000, audioBitrateKbps: 192, audioChannels: 2 } },
  { id: 'shorts-1080', name: 'YouTube Shorts 1080p', builtIn: true, settings: { height: 1080, codec: 'avc', colorMode: 'sdr', fps: 30, bitrateMbps: 14, hardwareAcceleration: 'prefer-hardware', includeAudio: true, audioSampleRate: 48_000, audioBitrateKbps: 192, audioChannels: 2 } },
  { id: 'youtube-4k', name: 'YouTube 4K', builtIn: true, settings: { height: 2160, codec: 'avc', colorMode: 'sdr', fps: 30, bitrateMbps: 48, hardwareAcceleration: 'prefer-hardware', includeAudio: true, audioSampleRate: 48_000, audioBitrateKbps: 256, audioChannels: 2 } },
  { id: 'archive-hevc', name: 'HEVC 4K 마스터', builtIn: true, settings: { height: 2160, codec: 'hevc', colorMode: 'sdr', fps: 30, bitrateMbps: 64, hardwareAcceleration: 'prefer-hardware', includeAudio: true, audioSampleRate: 48_000, audioBitrateKbps: 320, audioChannels: 2 } },
  { id: 'prores-422-master', name: 'ProRes 422 4K 마스터', builtIn: true, settings: { height: 2160, codec: 'prores-422', colorMode: 'sdr', fps: 30, bitrateMbps: 120, hardwareAcceleration: 'prefer-hardware', includeAudio: true, audioSampleRate: 48_000, audioBitrateKbps: 320, audioChannels: 2, audioMixdownWav: true } },
  { id: 'prores-422-hq-master', name: 'ProRes 422 HQ 4K 마스터', builtIn: true, settings: { height: 2160, codec: 'prores-422-hq', colorMode: 'sdr', fps: 30, bitrateMbps: 180, hardwareAcceleration: 'prefer-hardware', includeAudio: true, audioSampleRate: 48_000, audioBitrateKbps: 320, audioChannels: 2, audioMixdownWav: true } },
  { id: 'prores-4444-alpha-master', name: 'ProRes 4444 알파 4K 마스터', builtIn: true, settings: { height: 2160, codec: 'prores-4444', colorMode: 'sdr', fps: 30, bitrateMbps: 240, hardwareAcceleration: 'prefer-software', includeAudio: true, audioSampleRate: 48_000, audioBitrateKbps: 320, audioChannels: 2, audioMixdownWav: true } },
  { id: 'dnxhr-hq-master', name: 'DNxHR HQ 4K 마스터', builtIn: true, settings: { height: 2160, codec: 'dnxhr-hq', colorMode: 'sdr', fps: 30, bitrateMbps: 220, hardwareAcceleration: 'prefer-software', includeAudio: true, audioSampleRate: 48_000, audioBitrateKbps: 320, audioChannels: 2, audioMixdownWav: true } },
  { id: 'dnxhr-hqx-master', name: 'DNxHR HQX 10-bit 4K 마스터', builtIn: true, settings: { height: 2160, codec: 'dnxhr-hqx', colorMode: 'sdr', fps: 30, bitrateMbps: 300, hardwareAcceleration: 'prefer-software', includeAudio: true, audioSampleRate: 48_000, audioBitrateKbps: 320, audioChannels: 2, audioMixdownWav: true } },
  { id: 'broadcast-51-master', name: 'Broadcast 5.1 ProRes HQ', builtIn: true, settings: { height: 1080, codec: 'prores-422-hq', colorMode: 'sdr', fps: 29.97, bitrateMbps: 180, hardwareAcceleration: 'prefer-software', includeAudio: true, audioSampleRate: 48_000, audioBitrateKbps: 320, audioChannels: 6, audioDeliveryProfile: 'broadcast-ebu-r128', audioMixdownWav: true, audioStems: ['dialogue', 'music', 'effects', 'ambient'] } },
  { id: 'youtube-hdr10', name: 'YouTube HDR10 4K', builtIn: true, settings: { height: 2160, codec: 'hevc', colorMode: 'hdr10-pq', fps: 30, bitrateMbps: 80, hardwareAcceleration: 'prefer-hardware', includeAudio: true, audioSampleRate: 48_000, audioBitrateKbps: 256, audioChannels: 2 } },
  { id: 'broadcast-hlg', name: 'HLG 4K 마스터', builtIn: true, settings: { height: 2160, codec: 'hevc', colorMode: 'hdr-hlg', fps: 30, bitrateMbps: 80, hardwareAcceleration: 'prefer-hardware', includeAudio: true, audioSampleRate: 48_000, audioBitrateKbps: 320, audioChannels: 2 } },
]

export function readUserExportPresets(): SavedExportPreset[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(parsed) ? parsed.flatMap((preset) => { try { return [normalizeUserExportPreset(preset)] } catch { return [] } }).slice(-100) : []
  } catch {
    return []
  }
}

export function writeUserExportPresets(presets: SavedExportPreset[]): void {
  localStorage.setItem(storageKey, JSON.stringify(presets.filter((preset) => !preset.builtIn).map((preset) => normalizeUserExportPreset(preset)).slice(-100)))
}

export function normalizeUserExportPreset(value: unknown, renewIdentity = false): SavedExportPreset {
  if (!value || typeof value !== 'object') throw new Error('출력 프리셋이 객체가 아닙니다.')
  const preset = value as Partial<SavedExportPreset>
  const settings = preset.settings as Partial<SavedExportPreset['settings']> | undefined
  const fps = Number(settings?.fps)
  const height = Number(settings?.height)
  if (!settings || !Number.isFinite(height) || height < 16 || height > 8_192 || !['avc', 'hevc', 'prores-422', 'prores-422-hq', 'prores-4444', 'dnxhr-hq', 'dnxhr-hqx'].includes(String(settings.codec)) || !Number.isFinite(fps) || fps < 1 || fps > 240) throw new Error('지원되는 Cutline 출력 프리셋이 아닙니다.')
  const colorMode = ['sdr', 'hdr10-pq', 'hdr-hlg'].includes(String(settings.colorMode)) ? settings.colorMode : 'sdr'
  const codec = colorMode === 'sdr' ? settings.codec! : 'hevc'
  const acceleration = ['no-preference', 'prefer-hardware', 'prefer-software'].includes(String(settings.hardwareAcceleration)) ? settings.hardwareAcceleration : 'prefer-hardware'
  return {
    id: renewIdentity ? crypto.randomUUID() : String(preset.id || crypto.randomUUID()).slice(0, 160),
    name: String(preset.name || '출력 프리셋').trim().slice(0, 100) || '출력 프리셋',
    settings: {
      height: Math.round(height),
      codec: codec as SavedExportPreset['settings']['codec'],
      colorMode,
      fps,
      bitrateMbps: Math.max(1, Math.min(300, Number(settings.bitrateMbps) || 16)),
      hardwareAcceleration: acceleration as NonNullable<SavedExportPreset['settings']['hardwareAcceleration']>,
      includeAudio: settings.includeAudio !== false,
      audioSampleRate: Number(settings.audioSampleRate) === 44_100 ? 44_100 : Number(settings.audioSampleRate) === 96_000 ? 96_000 : 48_000,
      audioBitrateKbps: Number(settings.audioBitrateKbps) === 128 ? 128 : Number(settings.audioBitrateKbps) === 256 ? 256 : Number(settings.audioBitrateKbps) === 320 ? 320 : 192,
      audioChannels: Number(settings.audioChannels) === 1 ? 1 : Number(settings.audioChannels) === 6 ? 6 : 2,
      audioDeliveryProfile: settings.audioDeliveryProfile === 'broadcast-ebu-r128' || settings.audioDeliveryProfile === 'podcast-stereo' ? settings.audioDeliveryProfile : 'web-video',
      audioMixdownWav: Boolean(settings.audioMixdownWav),
      audioStems: Array.isArray(settings.audioStems) ? settings.audioStems.filter((role): role is NonNullable<SavedExportPreset['settings']['audioStems']>[number] => ['dialogue', 'music', 'effects', 'ambient'].includes(String(role))) : undefined,
    },
  }
}
