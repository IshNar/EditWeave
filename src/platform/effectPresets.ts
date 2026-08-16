import type { AudioAdjustment, ColorAdjustment, TimelineClip, VisualEffects } from '../editor/types'

const STORAGE_KEY = 'cutline.effect-presets.v1'

export interface EffectPreset {
  id: string
  name: string
  version: 'cutline-effect-preset-v1'
  createdAt: string
  colorAdjustment?: ColorAdjustment
  visualEffects?: VisualEffects
  effectStack?: TimelineClip['effectStack']
  audioAdjustment?: AudioAdjustment
}

export function readEffectPresets(): EffectPreset[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(isEffectPreset).slice(-200).map(clonePreset) : []
  } catch {
    return []
  }
}

export function writeEffectPresets(presets: EffectPreset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets.slice(-200)))
}

export function createEffectPreset(name: string, clip: TimelineClip): EffectPreset {
  return clonePreset({
    id: crypto.randomUUID(),
    name: name.trim() || '효과 프리셋',
    version: 'cutline-effect-preset-v1',
    createdAt: new Date().toISOString(),
    colorAdjustment: clip.kind === 'video' ? clip.colorAdjustment : undefined,
    visualEffects: clip.kind === 'video' ? clip.visualEffects : undefined,
    effectStack: clip.kind === 'video' ? clip.effectStack : undefined,
    audioAdjustment: clip.kind === 'caption' ? undefined : clip.audioAdjustment,
  })
}

export function applyEffectPreset(preset: EffectPreset, kind: TimelineClip['kind']): Partial<TimelineClip> {
  return {
    ...(kind === 'video' ? {
      colorAdjustment: structuredClone(preset.colorAdjustment),
      visualEffects: structuredClone(preset.visualEffects),
      effectStack: structuredClone(preset.effectStack),
    } : {}),
    ...(kind !== 'caption' ? { audioAdjustment: structuredClone(preset.audioAdjustment) } : {}),
  }
}

export function serializeEffectPreset(preset: EffectPreset): string {
  return JSON.stringify({ format: 'cutline-effect-preset', version: 1, preset: clonePreset(preset) }, null, 2)
}

export function parseEffectPreset(raw: string): EffectPreset {
  const value: unknown = JSON.parse(raw)
  const candidate = value && typeof value === 'object' && 'preset' in value ? (value as { preset: unknown }).preset : value
  if (!isEffectPreset(candidate)) throw new Error('지원되는 Cutline 효과 프리셋이 아닙니다.')
  return clonePreset({ ...candidate, id: crypto.randomUUID(), createdAt: new Date().toISOString() })
}

function clonePreset(preset: EffectPreset): EffectPreset {
  return structuredClone(preset)
}

function isEffectPreset(value: unknown): value is EffectPreset {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<EffectPreset>
  return candidate.version === 'cutline-effect-preset-v1'
    && typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.createdAt === 'string'
    && (candidate.colorAdjustment === undefined || typeof candidate.colorAdjustment === 'object')
    && (candidate.visualEffects === undefined || typeof candidate.visualEffects === 'object')
    && (candidate.effectStack === undefined || Array.isArray(candidate.effectStack))
    && (candidate.audioAdjustment === undefined || typeof candidate.audioAdjustment === 'object')
}
