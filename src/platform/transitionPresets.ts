import type { ClipTransition } from '../editor/types'

const STORAGE_KEY = 'editweave.transition-presets.v1'

export interface TransitionPreset {
  id: string
  name: string
  version: 'editweave-transition-preset-v1'
  createdAt: string
  mediaKind: 'video' | 'audio'
  favorite?: boolean
  transition: ClipTransition
}

export function readTransitionPresets(): TransitionPreset[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(isTransitionPreset).slice(-200).map(clonePreset) : []
  } catch {
    return []
  }
}

export function writeTransitionPresets(presets: TransitionPreset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets.slice(-200)))
}

export function createTransitionPreset(name: string, mediaKind: TransitionPreset['mediaKind'], transition: ClipTransition): TransitionPreset {
  return clonePreset({ id: crypto.randomUUID(), name: name.trim() || '전환 프리셋', version: 'editweave-transition-preset-v1', createdAt: new Date().toISOString(), mediaKind, favorite: false, transition })
}

export function serializeTransitionPreset(preset: TransitionPreset): string {
  return JSON.stringify({ format: 'editweave-transition-preset', version: 1, preset: clonePreset(preset) }, null, 2)
}

export function parseTransitionPreset(raw: string): TransitionPreset {
  const value: unknown = JSON.parse(raw)
  const candidate = value && typeof value === 'object' && 'preset' in value ? (value as { preset: unknown }).preset : value
  if (!isTransitionPreset(candidate)) throw new Error('지원되는 EditWeave 전환 프리셋이 아닙니다.')
  return clonePreset({ ...candidate, id: crypto.randomUUID(), createdAt: new Date().toISOString() })
}

function clonePreset(preset: TransitionPreset): TransitionPreset {
  return { ...structuredClone(preset), favorite: Boolean(preset.favorite) }
}

function isTransitionPreset(value: unknown): value is TransitionPreset {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<TransitionPreset>
  const transition = candidate.transition as Partial<ClipTransition> | undefined
  return candidate.version === 'editweave-transition-preset-v1'
    && typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.createdAt === 'string'
    && (candidate.mediaKind === 'video' || candidate.mediaKind === 'audio')
    && Boolean(transition && typeof transition.type === 'string' && typeof transition.duration === 'number' && Number.isFinite(transition.duration) && transition.duration >= 0)
}
