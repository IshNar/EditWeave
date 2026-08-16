import type { EffectMask, MaskPoint, VisualEffects } from './types'

export interface MaskBounds {
  x: number
  y: number
  width: number
  height: number
}

const rectanglePoints: MaskPoint[] = [{ x: 12, y: 12 }, { x: 88, y: 12 }, { x: 88, y: 88 }, { x: 12, y: 88 }]

export function createEffectMask(shape: EffectMask['shape'], index = 0): EffectMask {
  return {
    id: crypto.randomUUID(),
    name: `마스크 ${index + 1}`,
    shape,
    points: rectanglePoints.map((point) => ({ ...point })),
    feather: 0,
    opacity: 100,
    invert: false,
    operation: 'add',
    enabled: true,
  }
}

export function resolveEffectMasks(effects: VisualEffects): EffectMask[] {
  if (effects.masks?.length) return effects.masks.filter((mask) => mask.enabled).slice(0, 8)
  if (effects.mask === 'none') return []
  return [{
    id: 'legacy-mask',
    name: '기본 마스크',
    shape: effects.mask,
    points: (effects.maskPoints ?? rectanglePoints).map((point) => ({ ...point })),
    feather: effects.maskFeather ?? 0,
    opacity: 100,
    invert: Boolean(effects.maskInvert),
    operation: 'add',
    enabled: true,
  }]
}

export function requiresCanvasMask(effects: VisualEffects): boolean {
  const masks = resolveEffectMasks(effects)
  return Boolean(effects.masks?.length || masks.some((mask) => mask.feather > 0 || mask.invert || mask.opacity < 100 || mask.shape === 'bezier'))
}

export function applyCanvasMask(context: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number, effects: VisualEffects, bounds: MaskBounds): void {
  const masks = resolveEffectMasks(effects)
  const combined = document.createElement('canvas')
  combined.width = canvasWidth
  combined.height = canvasHeight
  const combinedContext = combined.getContext('2d')
  if (!combinedContext) return

  if (!masks.length) {
    combinedContext.fillStyle = '#fff'
    drawCropPath(combinedContext, effects, bounds)
    combinedContext.fill()
  } else {
    masks.forEach((mask, index) => {
      const layer = renderMaskLayer(canvasWidth, canvasHeight, mask, bounds)
      combinedContext.save()
      combinedContext.globalCompositeOperation = index === 0 || mask.operation === 'add' ? 'source-over' : mask.operation === 'subtract' ? 'destination-out' : 'destination-in'
      combinedContext.drawImage(layer, 0, 0)
      combinedContext.restore()
    })
    const crop = document.createElement('canvas')
    crop.width = canvasWidth
    crop.height = canvasHeight
    const cropContext = crop.getContext('2d')
    if (cropContext) {
      cropContext.fillStyle = '#fff'
      drawCropPath(cropContext, effects, bounds)
      cropContext.fill()
      combinedContext.save()
      combinedContext.globalCompositeOperation = 'destination-in'
      combinedContext.drawImage(crop, 0, 0)
      combinedContext.restore()
    }
  }

  context.save()
  context.globalCompositeOperation = 'destination-in'
  context.filter = 'none'
  context.globalAlpha = 1
  context.drawImage(combined, 0, 0)
  context.restore()
}

function renderMaskLayer(width: number, height: number, mask: EffectMask, bounds: MaskBounds): HTMLCanvasElement {
  const layer = document.createElement('canvas')
  layer.width = width
  layer.height = height
  const context = layer.getContext('2d')
  if (!context) return layer
  const feather = Math.max(0, Math.min(25, mask.feather)) / 100 * Math.min(bounds.width, bounds.height)
  context.save()
  if (mask.invert) {
    context.fillStyle = `rgba(255,255,255,${Math.max(0, Math.min(100, mask.opacity)) / 100})`
    context.fillRect(0, 0, width, height)
    context.globalCompositeOperation = 'destination-out'
  }
  context.fillStyle = `rgba(255,255,255,${Math.max(0, Math.min(100, mask.opacity)) / 100})`
  context.filter = feather > 0 ? `blur(${feather}px)` : 'none'
  drawEffectMaskPath(context, mask, bounds)
  context.fill()
  context.restore()
  return layer
}

export function drawEffectMaskPath(context: CanvasRenderingContext2D, mask: EffectMask, bounds: MaskBounds): void {
  context.beginPath()
  if ((mask.shape === 'polygon' || mask.shape === 'bezier') && mask.points.length >= 3) {
    const points = mask.points
    const first = canvasPoint(points[0], bounds)
    context.moveTo(first.x, first.y)
    for (let index = 0; index < points.length; index++) {
      const current = points[index]
      const next = points[(index + 1) % points.length]
      const target = canvasPoint(next, bounds)
      if (mask.shape === 'bezier') {
        const controlA = canvasHandle(current, current.outHandle, bounds)
        const controlB = canvasHandle(next, next.inHandle, bounds)
        context.bezierCurveTo(controlA.x, controlA.y, controlB.x, controlB.y, target.x, target.y)
      } else context.lineTo(target.x, target.y)
    }
    context.closePath()
    return
  }
  const box = maskPointBounds(mask.points, bounds)
  if (mask.shape === 'ellipse') context.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2)
  else context.roundRect(box.x, box.y, box.width, box.height, Math.min(box.width, box.height) * 0.09)
}

export function drawMaskPath(context: CanvasRenderingContext2D, effects: VisualEffects, bounds: MaskBounds): void {
  const masks = resolveEffectMasks(effects)
  if (masks.length) drawEffectMaskPath(context, masks[0], bounds)
  else drawCropPath(context, effects, bounds)
}

function drawCropPath(context: CanvasRenderingContext2D, effects: VisualEffects, bounds: MaskBounds): void {
  const top = Math.max(0, Math.min(49, effects.cropTop)) / 100
  const right = Math.max(0, Math.min(49, effects.cropRight)) / 100
  const bottom = Math.max(0, Math.min(49, effects.cropBottom)) / 100
  const left = Math.max(0, Math.min(49, effects.cropLeft)) / 100
  context.beginPath()
  context.rect(bounds.x + bounds.width * left, bounds.y + bounds.height * top, Math.max(1, bounds.width * (1 - left - right)), Math.max(1, bounds.height * (1 - top - bottom)))
}

function canvasPoint(point: MaskPoint, bounds: MaskBounds): { x: number; y: number } {
  return { x: bounds.x + bounds.width * Math.max(0, Math.min(100, point.x)) / 100, y: bounds.y + bounds.height * Math.max(0, Math.min(100, point.y)) / 100 }
}

function canvasHandle(point: MaskPoint, handle: MaskPoint['inHandle'], bounds: MaskBounds): { x: number; y: number } {
  return canvasPoint({ x: point.x + (handle?.x ?? 0), y: point.y + (handle?.y ?? 0) }, bounds)
}

function maskPointBounds(points: MaskPoint[], bounds: MaskBounds): MaskBounds {
  const source = points.length >= 2 ? points : rectanglePoints
  const xs = source.map((point) => Math.max(0, Math.min(100, point.x)))
  const ys = source.map((point) => Math.max(0, Math.min(100, point.y)))
  const left = Math.min(...xs)
  const right = Math.max(...xs)
  const top = Math.min(...ys)
  const bottom = Math.max(...ys)
  return { x: bounds.x + bounds.width * left / 100, y: bounds.y + bounds.height * top / 100, width: Math.max(1, bounds.width * (right - left) / 100), height: Math.max(1, bounds.height * (bottom - top) / 100) }
}
