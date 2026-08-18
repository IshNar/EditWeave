import type { SpeedKeyframe, TimelineClip } from '../editor/types'

const STORAGE_KEY = 'editweave.speed-templates.v1'

export interface SpeedTemplate {
  id: string
  name: string
  version: 'editweave-speed-template-v1'
  createdAt: string
  sourceDuration: number
  playbackRate: number
  reverse: boolean
  keyframes: SpeedKeyframe[]
}

export function readSpeedTemplates(): SpeedTemplate[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(isSpeedTemplate).map(normalizeTemplate).slice(-100) : []
  } catch {
    return []
  }
}

export function writeSpeedTemplates(templates: SpeedTemplate[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates.slice(-100).map(normalizeTemplate)))
}

export function createSpeedTemplate(name: string, clip: TimelineClip): SpeedTemplate {
  return normalizeTemplate({
    id: crypto.randomUUID(),
    name: name.trim() || '속도 템플릿',
    version: 'editweave-speed-template-v1',
    createdAt: new Date().toISOString(),
    sourceDuration: Math.max(0.05, clip.duration),
    playbackRate: clip.playbackRate ?? 1,
    reverse: Boolean(clip.reverse),
    keyframes: clip.speedKeyframes ?? [],
  })
}

export function applySpeedTemplate(template: SpeedTemplate, targetDuration: number): Pick<TimelineClip, 'playbackRate' | 'reverse' | 'speedKeyframes'> {
  const duration = Math.max(0.05, targetDuration)
  const scale = duration / Math.max(0.05, template.sourceDuration)
  return {
    playbackRate: template.playbackRate,
    reverse: template.reverse,
    speedKeyframes: template.keyframes.map((keyframe) => ({ ...keyframe, id: crypto.randomUUID(), time: Math.max(0, Math.min(duration, keyframe.time * scale)), curve: keyframe.curve ? { ...keyframe.curve } : undefined })),
  }
}

export function serializeSpeedTemplate(template: SpeedTemplate): string {
  return JSON.stringify(normalizeTemplate(template), null, 2)
}

export function parseSpeedTemplate(raw: string): SpeedTemplate {
  const value: unknown = JSON.parse(raw)
  if (!isSpeedTemplate(value)) throw new Error('지원되는 EditWeave 속도 템플릿이 아닙니다.')
  return normalizeTemplate({ ...value, id: crypto.randomUUID(), createdAt: new Date().toISOString() })
}

function normalizeTemplate(template: SpeedTemplate): SpeedTemplate {
  return {
    ...template,
    name: template.name.slice(0, 100),
    sourceDuration: Math.max(0.05, template.sourceDuration),
    playbackRate: Math.max(0.05, Math.min(16, template.playbackRate)),
    keyframes: template.keyframes.slice(0, 120).map((keyframe) => ({
      ...keyframe,
      time: Math.max(0, Math.min(template.sourceDuration, keyframe.time)),
      rate: Math.max(0.05, Math.min(16, keyframe.rate)),
      curve: keyframe.curve ? {
        x1: clampUnit(keyframe.curve.x1), y1: clampUnit(keyframe.curve.y1),
        x2: clampUnit(keyframe.curve.x2), y2: clampUnit(keyframe.curve.y2),
      } : undefined,
    })).sort((a, b) => a.time - b.time),
  }
}

function isSpeedTemplate(value: unknown): value is SpeedTemplate {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SpeedTemplate>
  return candidate.version === 'editweave-speed-template-v1'
    && typeof candidate.id === 'string' && typeof candidate.name === 'string' && typeof candidate.createdAt === 'string'
    && typeof candidate.sourceDuration === 'number' && Number.isFinite(candidate.sourceDuration)
    && typeof candidate.playbackRate === 'number' && Number.isFinite(candidate.playbackRate)
    && typeof candidate.reverse === 'boolean' && Array.isArray(candidate.keyframes)
    && candidate.keyframes.every((keyframe) => {
      if (!keyframe || typeof keyframe.id !== 'string' || typeof keyframe.time !== 'number' || typeof keyframe.rate !== 'number') return false
      if (!['linear', 'ease-in', 'ease-out', 'ease-in-out', 'bezier'].includes(keyframe.easing)) return false
      return !keyframe.curve || [keyframe.curve.x1, keyframe.curve.y1, keyframe.curve.x2, keyframe.curve.y2].every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    })
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5))
}
