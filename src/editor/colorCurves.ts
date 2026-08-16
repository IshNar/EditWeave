import type { ColorAdjustment } from './types'

export type ColorCurveChannel = 'masterCurve' | 'redCurve' | 'greenCurve' | 'blueCurve'
export type ColorCurvePoint = { x: number; y: number }

const identityCurve: ColorCurvePoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }]

export function normalizeColorCurve(points?: ColorCurvePoint[]): ColorCurvePoint[] {
  const normalized = (points?.length ? points : identityCurve).map((point) => ({ x: clamp(point.x), y: clamp(point.y) })).sort((a, b) => a.x - b.x)
  if (normalized[0].x > 0.001) normalized.unshift({ x: 0, y: normalized[0].y })
  if (normalized[normalized.length - 1].x < 0.999) normalized.push({ x: 1, y: normalized[normalized.length - 1].y })
  return normalized
}

export function hasCustomColorCurves(adjustment?: ColorAdjustment): boolean {
  return (['masterCurve', 'redCurve', 'greenCurve', 'blueCurve'] as ColorCurveChannel[]).some((channel) => {
    const points = normalizeColorCurve(adjustment?.[channel])
    return points.length !== 2 || Math.abs(points[0].y) > 0.001 || Math.abs(points[1].y - 1) > 0.001
  })
}

export function applyColorCurves(context: CanvasRenderingContext2D, width: number, height: number, adjustment?: ColorAdjustment): void {
  if (!hasCustomColorCurves(adjustment) || width <= 0 || height <= 0) return
  const master = buildCurveLut(adjustment?.masterCurve)
  const red = buildCurveLut(adjustment?.redCurve)
  const green = buildCurveLut(adjustment?.greenCurve)
  const blue = buildCurveLut(adjustment?.blueCurve)
  const image = context.getImageData(0, 0, width, height)
  const data = image.data
  for (let index = 0; index < data.length; index += 4) {
    data[index] = master[red[data[index]]]
    data[index + 1] = master[green[data[index + 1]]]
    data[index + 2] = master[blue[data[index + 2]]]
  }
  context.putImageData(image, 0, 0)
}

export function hasColorQualifier(adjustment?: ColorAdjustment): boolean {
  return Boolean(adjustment?.qualifierEnabled)
}

export function applyColorQualifier(context: CanvasRenderingContext2D, width: number, height: number, adjustment?: ColorAdjustment, showSelectionMask = false): void {
  if (!hasColorQualifier(adjustment) || width <= 0 || height <= 0) return
  const hueCenter = ((adjustment?.qualifierHue ?? 120) % 360 + 360) % 360
  const hueRange = Math.max(0, Math.min(180, adjustment?.qualifierHueRange ?? 30))
  const saturationMin = clamp((adjustment?.qualifierSaturationMin ?? 20) / 100)
  const saturationMax = clamp((adjustment?.qualifierSaturationMax ?? 100) / 100)
  const luminanceMin = clamp((adjustment?.qualifierLuminanceMin ?? 10) / 100)
  const luminanceMax = clamp((adjustment?.qualifierLuminanceMax ?? 95) / 100)
  const softness = clamp((adjustment?.qualifierSoftness ?? 20) / 100)
  const exposure = Math.pow(2, Math.max(-3, Math.min(3, adjustment?.qualifierExposure ?? 0)))
  const saturationScale = Math.max(0, 1 + (adjustment?.qualifierSaturation ?? 0) / 100)
  const hueShift = Math.max(-180, Math.min(180, adjustment?.qualifierHueShift ?? 0))
  const image = context.getImageData(0, 0, width, height)
  const data = image.data
  for (let index = 0; index < data.length; index += 4) {
    const original = { r: data[index] / 255, g: data[index + 1] / 255, b: data[index + 2] / 255 }
    const hsl = rgbToHsl(original.r, original.g, original.b)
    const hueDistance = Math.abs(((hsl.h - hueCenter + 540) % 360) - 180)
    const hueWeight = 1 - smoothRange(hueDistance, hueRange, Math.min(180, hueRange + softness * 90))
    const weight = hueWeight * bandWeight(hsl.s, saturationMin, saturationMax, softness * 0.35) * bandWeight(hsl.l, luminanceMin, luminanceMax, softness * 0.35)
    if (showSelectionMask && adjustment?.qualifierShowMask) {
      const mask = Math.round(weight * 255)
      data[index] = mask
      data[index + 1] = mask
      data[index + 2] = mask
      continue
    }
    if (weight <= 0.0001) continue
    const corrected = hslToRgb((hsl.h + hueShift + 360) % 360, clamp(hsl.s * saturationScale), clamp(hsl.l * exposure))
    data[index] = Math.round((original.r + (corrected.r - original.r) * weight) * 255)
    data[index + 1] = Math.round((original.g + (corrected.g - original.g) * weight) * 255)
    data[index + 2] = Math.round((original.b + (corrected.b - original.b) * weight) * 255)
  }
  context.putImageData(image, 0, 0)
}

export function colorCurveTableValues(adjustment: ColorAdjustment | undefined, channel: 'redCurve' | 'greenCurve' | 'blueCurve'): string {
  const master = buildCurveLut(adjustment?.masterCurve)
  const channelLut = buildCurveLut(adjustment?.[channel])
  return Array.from({ length: 33 }, (_, index) => {
    const value = Math.round(index / 32 * 255)
    return (master[channelLut[value]] / 255).toFixed(4)
  }).join(' ')
}

export function composeColorCurve(first?: ColorCurvePoint[], second?: ColorCurvePoint[]): ColorCurvePoint[] {
  const firstCurve = normalizeColorCurve(first)
  const secondCurve = normalizeColorCurve(second)
  const output = Array.from({ length: 17 }, (_, index) => {
    const x = index / 16
    return { x, y: evaluateColorCurve(secondCurve, evaluateColorCurve(firstCurve, x)) }
  })
  return output.every((point) => Math.abs(point.x - point.y) < 0.0001) ? identityCurve.map((point) => ({ ...point })) : output
}

function evaluateColorCurve(curve: ColorCurvePoint[], input: number): number {
  const value = clamp(input)
  let index = 0
  while (index + 1 < curve.length - 1 && value > curve[index + 1].x) index++
  const from = curve[index]
  const to = curve[Math.min(curve.length - 1, index + 1)]
  return clamp(from.y + (to.y - from.y) * ((value - from.x) / Math.max(0.000001, to.x - from.x)))
}

function buildCurveLut(points?: ColorCurvePoint[]): Uint8Array {
  const curve = normalizeColorCurve(points)
  const output = new Uint8Array(256)
  let segment = 0
  for (let value = 0; value < 256; value++) {
    const input = value / 255
    while (segment + 1 < curve.length - 1 && input > curve[segment + 1].x) segment++
    const from = curve[segment]
    const to = curve[Math.min(curve.length - 1, segment + 1)]
    const progress = (input - from.x) / Math.max(0.000001, to.x - from.x)
    output[value] = Math.round(clamp(from.y + (to.y - from.y) * progress) * 255)
  }
  return output
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function smoothRange(value: number, from: number, to: number): number {
  if (value <= from) return 0
  if (value >= to || to <= from) return 1
  const progress = (value - from) / (to - from)
  return progress * progress * (3 - 2 * progress)
}

function bandWeight(value: number, minimum: number, maximum: number, softness: number): number {
  const low = Math.min(minimum, maximum)
  const high = Math.max(minimum, maximum)
  if (value >= low && value <= high) return 1
  if (value < low) return 1 - smoothRange(low - value, 0, softness)
  return 1 - smoothRange(value - high, 0, softness)
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const maximum = Math.max(r, g, b)
  const minimum = Math.min(r, g, b)
  const delta = maximum - minimum
  const l = (maximum + minimum) / 2
  if (delta <= 0.000001) return { h: 0, s: 0, l }
  const s = delta / (1 - Math.abs(2 * l - 1))
  let h = maximum === r ? ((g - b) / delta) % 6 : maximum === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  h = (h * 60 + 360) % 360
  return { h, s: clamp(s), l: clamp(l) }
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const sector = h / 60
  const secondary = chroma * (1 - Math.abs((sector % 2) - 1))
  const [r1, g1, b1] = sector < 1 ? [chroma, secondary, 0] : sector < 2 ? [secondary, chroma, 0] : sector < 3 ? [0, chroma, secondary] : sector < 4 ? [0, secondary, chroma] : sector < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary]
  const match = l - chroma / 2
  return { r: clamp(r1 + match), g: clamp(g1 + match), b: clamp(b1 + match) }
}
