import { normalizeAudioBuses } from '../editor/audioBuses'
import type { AudioBusMap } from '../editor/types'

export interface AdrTeamDefaults {
  cueDuration: number
  countdownSeconds: 0 | 1 | 2 | 3 | 5
  preferredDeviceLabel: string
}

export interface AudioTeamTemplate {
  id: string
  name: string
  version: 'cutline-audio-template-v1'
  createdAt: string
  updatedAt: string
  audioBuses: AudioBusMap
  adr: AdrTeamDefaults
}

const STORAGE_KEY = 'cutline.audio-team-templates.v1'
export const defaultAdrTeamDefaults: AdrTeamDefaults = { cueDuration: 5, countdownSeconds: 3, preferredDeviceLabel: '' }

export function readAudioTeamTemplates(): AudioTeamTemplate[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as AudioTeamTemplate[]
    return Array.isArray(parsed) ? parsed.filter((item) => item?.version === 'cutline-audio-template-v1' && item.id && item.name).map(normalizeTemplate).slice(0, 50) : []
  } catch {
    return []
  }
}

export function writeAudioTeamTemplates(templates: AudioTeamTemplate[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates.slice(0, 50).map(normalizeTemplate)))
  } catch {
    // The current mixer remains usable when persistent storage is unavailable.
  }
}

export function createAudioTeamTemplate(name: string, audioBuses: AudioBusMap, adr: AdrTeamDefaults = defaultAdrTeamDefaults, existingId?: string): AudioTeamTemplate {
  const now = new Date().toISOString()
  return normalizeTemplate({ id: existingId ?? crypto.randomUUID(), name: name.trim() || '오디오 템플릿', version: 'cutline-audio-template-v1', createdAt: now, updatedAt: now, audioBuses, adr })
}

export function serializeAudioTeamTemplate(template: AudioTeamTemplate): string {
  return JSON.stringify(normalizeTemplate(template), null, 2)
}

export function parseAudioTeamTemplate(raw: string): AudioTeamTemplate {
  const value = JSON.parse(raw) as Partial<AudioTeamTemplate>
  if (value.version !== 'cutline-audio-template-v1' || !value.id || !value.name || !value.audioBuses) throw new Error('지원되는 Cutline 오디오 템플릿이 아닙니다.')
  return normalizeTemplate(value as AudioTeamTemplate)
}

export function instantiateAudioTeamTemplate(template: AudioTeamTemplate): AudioBusMap {
  const buses = normalizeAudioBuses(template.audioBuses)
  return Object.fromEntries(Object.entries(buses).map(([role, bus]) => [role, { ...bus, inserts: bus.inserts.map((insert) => ({ ...insert, id: crypto.randomUUID() })) }])) as AudioBusMap
}

export function instantiateAdrTeamDefaults(template: AudioTeamTemplate): AdrTeamDefaults {
  return normalizeAdrDefaults(template.adr)
}

function normalizeTemplate(template: AudioTeamTemplate): AudioTeamTemplate {
  return { ...template, name: template.name.slice(0, 100), audioBuses: normalizeAudioBuses(template.audioBuses), adr: normalizeAdrDefaults(template.adr) }
}

function normalizeAdrDefaults(value?: Partial<AdrTeamDefaults>): AdrTeamDefaults {
  const countdown = Number(value?.countdownSeconds)
  return {
    cueDuration: Math.max(0.5, Math.min(120, Number(value?.cueDuration) || defaultAdrTeamDefaults.cueDuration)),
    countdownSeconds: ([0, 1, 2, 3, 5] as const).includes(countdown as AdrTeamDefaults['countdownSeconds']) ? countdown as AdrTeamDefaults['countdownSeconds'] : defaultAdrTeamDefaults.countdownSeconds,
    preferredDeviceLabel: String(value?.preferredDeviceLabel ?? '').slice(0, 200),
  }
}
