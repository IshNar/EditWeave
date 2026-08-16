import type { ClipTransform, TimelineClip, TransformKeyframe, VisualEffectKeyframe, VisualEffects } from '../editor/types'

const STORAGE_KEY = 'cutline.motion-templates.v1'

export interface MotionTemplate {
  id: string
  name: string
  createdAt: string
  sourceDuration: number
  transform: ClipTransform
  keyframes: TransformKeyframe[]
  motionPathAutoOrient?: boolean
  motionPathOrientationOffset?: number
  motionBlur?: TimelineClip['motionBlur']
  visualEffects?: VisualEffects
  visualKeyframes?: VisualEffectKeyframe[]
}

export function readMotionTemplates(): MotionTemplate[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.filter(isMotionTemplate).slice(-100)
  } catch {
    return []
  }
}

export function writeMotionTemplates(templates: MotionTemplate[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates.slice(-100)))
}

export function createMotionTemplate(name: string, source: Omit<MotionTemplate, 'id' | 'name' | 'createdAt'>): MotionTemplate {
  return {
    ...source,
    id: crypto.randomUUID(),
    name: name.trim() || '이름 없는 모션',
    createdAt: new Date().toISOString(),
    keyframes: source.keyframes.map((keyframe) => ({ ...keyframe, id: crypto.randomUUID(), spatialIn: keyframe.spatialIn ? { ...keyframe.spatialIn } : undefined, spatialOut: keyframe.spatialOut ? { ...keyframe.spatialOut } : undefined, transform: { ...keyframe.transform } })),
    motionPathAutoOrient: source.motionPathAutoOrient,
    motionPathOrientationOffset: source.motionPathOrientationOffset,
    motionBlur: source.motionBlur ? { ...source.motionBlur } : undefined,
    visualEffects: cloneVisualEffects(source.visualEffects),
    visualKeyframes: source.visualKeyframes?.map((keyframe) => ({ ...keyframe, id: crypto.randomUUID(), effects: cloneVisualEffects(keyframe.effects)! })),
  }
}

export function parseMotionTemplate(raw: string): MotionTemplate {
  const value: unknown = JSON.parse(raw)
  const candidate = value && typeof value === 'object' && 'template' in value ? (value as { template: unknown }).template : value
  if (!isMotionTemplate(candidate)) throw new Error('Cutline 모션 템플릿 형식이 아닙니다.')
  return { ...candidate, id: crypto.randomUUID(), name: candidate.name.trim() || '가져온 모션', createdAt: new Date().toISOString() }
}

export function serializeMotionTemplate(template: MotionTemplate): string {
  return JSON.stringify({ format: 'cutline-motion-template', version: 1, template }, null, 2)
}

export function applyMotionTemplate(template: MotionTemplate, targetDuration: number): Pick<MotionTemplate, 'transform' | 'keyframes' | 'motionPathAutoOrient' | 'motionPathOrientationOffset' | 'motionBlur' | 'visualEffects' | 'visualKeyframes'> {
  const scale = Math.max(0.001, targetDuration) / Math.max(0.001, template.sourceDuration)
  return {
    transform: { ...template.transform },
    keyframes: template.keyframes.map((keyframe) => ({ ...keyframe, id: crypto.randomUUID(), time: Math.max(0, Math.min(targetDuration, keyframe.time * scale)), spatialIn: keyframe.spatialIn ? { ...keyframe.spatialIn } : undefined, spatialOut: keyframe.spatialOut ? { ...keyframe.spatialOut } : undefined, transform: { ...keyframe.transform } })),
    motionPathAutoOrient: template.motionPathAutoOrient,
    motionPathOrientationOffset: template.motionPathOrientationOffset,
    motionBlur: template.motionBlur ? { ...template.motionBlur } : undefined,
    visualEffects: cloneVisualEffects(template.visualEffects),
    visualKeyframes: template.visualKeyframes?.map((keyframe) => ({ ...keyframe, id: crypto.randomUUID(), time: Math.max(0, Math.min(targetDuration, keyframe.time * scale)), effects: cloneVisualEffects(keyframe.effects)! })),
  }
}

function cloneVisualEffects(effects?: VisualEffects): VisualEffects | undefined {
  return effects ? { ...effects, maskPoints: effects.maskPoints?.map((point) => ({ ...point })), cornerPinPoints: effects.cornerPinPoints?.map((point) => ({ ...point })), masks: effects.masks?.map((mask) => ({ ...mask, points: mask.points.map((point) => ({ ...point, inHandle: point.inHandle ? { ...point.inHandle } : undefined, outHandle: point.outHandle ? { ...point.outHandle } : undefined })) })) } : undefined
}

function isMotionTemplate(value: unknown): value is MotionTemplate {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MotionTemplate>
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.createdAt === 'string'
    && typeof candidate.sourceDuration === 'number' && Number.isFinite(candidate.sourceDuration) && candidate.sourceDuration > 0
    && isTransform(candidate.transform)
    && Array.isArray(candidate.keyframes)
    && candidate.keyframes.every((keyframe) => Boolean(keyframe) && typeof keyframe.id === 'string' && typeof keyframe.time === 'number' && isTransform(keyframe.transform) && isSpatialHandle(keyframe.spatialIn) && isSpatialHandle(keyframe.spatialOut))
    && (candidate.motionPathAutoOrient === undefined || typeof candidate.motionPathAutoOrient === 'boolean')
    && (candidate.motionPathOrientationOffset === undefined || typeof candidate.motionPathOrientationOffset === 'number' && Number.isFinite(candidate.motionPathOrientationOffset))
    && (!candidate.motionBlur || (typeof candidate.motionBlur.enabled === 'boolean' && typeof candidate.motionBlur.shutterAngle === 'number' && Number.isFinite(candidate.motionBlur.shutterAngle) && typeof candidate.motionBlur.samples === 'number' && Number.isFinite(candidate.motionBlur.samples)))
}

function isSpatialHandle(value: TransformKeyframe['spatialIn'] | undefined): boolean {
  return value === undefined || (typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y))
}

function isTransform(value: unknown): value is ClipTransform {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ClipTransform>
  return [candidate.positionX, candidate.positionY, candidate.scale, candidate.rotation, candidate.opacity].every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    && [candidate.scaleX, candidate.scaleY, candidate.anchorX, candidate.anchorY, candidate.skewX, candidate.skewY].every((entry) => entry === undefined || (typeof entry === 'number' && Number.isFinite(entry)))
}
