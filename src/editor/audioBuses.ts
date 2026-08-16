import type { AudioAdjustment, AudioAuxSend, AudioBusInsert, AudioBusInsertType, AudioBusMap, AudioBusSettings, AudioRole } from './types'

export const audioRoles: AudioRole[] = ['dialogue', 'music', 'effects', 'ambient']

export const audioRoleLabels: Record<AudioRole, string> = {
  dialogue: '대화',
  music: '음악',
  effects: '효과음',
  ambient: '환경음',
}

export const audioBusInsertLabels: Record<AudioBusInsertType, string> = {
  highpass: '하이패스',
  equalizer: '3밴드 EQ',
  'de-esser': '디에서',
  'hum-removal': '험 제거',
  compressor: '컴프레서',
  delay: '딜레이',
  limiter: '리미터',
}

export function defaultAudioBuses(): AudioBusMap {
  return {
    dialogue: { gainDb: 0, muted: false, solo: false, limiterDb: -1, inserts: [] },
    music: { gainDb: 0, muted: false, solo: false, limiterDb: -1, inserts: [] },
    effects: { gainDb: 0, muted: false, solo: false, limiterDb: -1, inserts: [] },
    ambient: { gainDb: 0, muted: false, solo: false, limiterDb: -1, inserts: [] },
  }
}

export function normalizeAudioBuses(value?: Partial<AudioBusMap>): AudioBusMap {
  const defaults = defaultAudioBuses()
  return Object.fromEntries(audioRoles.map((role) => {
    const incoming = value?.[role]
    return [role, { ...defaults[role], ...incoming, inserts: normalizeAudioBusInserts(incoming?.inserts) }]
  })) as AudioBusMap
}

export function isAudioBusActive(buses: AudioBusMap, role: AudioRole): boolean {
  const hasSolo = audioRoles.some((candidate) => buses[candidate].solo)
  return !buses[role].muted && (!hasSolo || buses[role].solo)
}

export function updateAudioBus(buses: AudioBusMap, role: AudioRole, patch: Partial<AudioBusSettings>): AudioBusMap {
  return { ...buses, [role]: { ...buses[role], ...patch, inserts: patch.inserts ? normalizeAudioBusInserts(patch.inserts) : buses[role].inserts } }
}

export function createAudioBusInsert(type: AudioBusInsertType): AudioBusInsert {
  const common = { id: crypto.randomUUID(), type, enabled: true }
  if (type === 'highpass') return { ...common, frequencyHz: 80 }
  if (type === 'equalizer') return { ...common, lowDb: 0, midDb: 0, highDb: 0 }
  if (type === 'de-esser') return { ...common, amount: 45 }
  if (type === 'hum-removal') return { ...common, amount: 70, humFrequencyHz: 60 }
  if (type === 'compressor') return { ...common, thresholdDb: -18, ratio: 3, makeupDb: 0 }
  if (type === 'delay') return { ...common, delayMs: 240, feedback: 28, mix: 18 }
  return { ...common, ceilingDb: -1 }
}

export function normalizeAudioBusInserts(inserts?: AudioBusInsert[]): AudioBusInsert[] {
  if (!Array.isArray(inserts)) return []
  return inserts.slice(0, 6).filter((insert) => ['highpass', 'equalizer', 'de-esser', 'hum-removal', 'compressor', 'delay', 'limiter'].includes(insert.type)).map((insert, index) => ({
    ...insert,
    id: insert.id || `bus-insert-${index + 1}`,
    enabled: insert.enabled !== false,
    frequencyHz: Math.max(20, Math.min(1_200, insert.frequencyHz ?? 80)),
    lowDb: Math.max(-18, Math.min(18, insert.lowDb ?? 0)),
    midDb: Math.max(-18, Math.min(18, insert.midDb ?? 0)),
    highDb: Math.max(-18, Math.min(18, insert.highDb ?? 0)),
    thresholdDb: Math.max(-60, Math.min(0, insert.thresholdDb ?? -18)),
    ratio: Math.max(1, Math.min(20, insert.ratio ?? 3)),
    makeupDb: Math.max(-12, Math.min(24, insert.makeupDb ?? 0)),
    ceilingDb: Math.max(-12, Math.min(0, insert.ceilingDb ?? -1)),
    amount: Math.max(0, Math.min(100, insert.amount ?? (insert.type === 'hum-removal' ? 70 : 45))),
    humFrequencyHz: insert.humFrequencyHz === 50 ? 50 : 60,
    delayMs: Math.max(10, Math.min(2_000, insert.delayMs ?? 240)),
    feedback: Math.max(0, Math.min(85, insert.feedback ?? 28)),
    mix: Math.max(0, Math.min(100, insert.mix ?? 18)),
  }))
}

export function resolveAudioAuxSends(adjustment?: Partial<AudioAdjustment>): AudioAuxSend[] {
  if (adjustment?.auxSends?.length) {
    return adjustment.auxSends.slice(0, 4).map((send, index) => ({
      id: send.id || `aux-${index + 1}`,
      bus: audioRoles.includes(send.bus) ? send.bus : 'effects',
      levelDb: Math.max(-60, Math.min(12, send.levelDb)),
      position: send.position === 'pre' ? 'pre' : 'post',
      enabled: send.enabled !== false,
    }))
  }
  if (adjustment?.sendBus) return [{ id: 'legacy-send', bus: adjustment.sendBus, levelDb: adjustment.sendLevelDb ?? -60, position: 'post', enabled: true }]
  return []
}
