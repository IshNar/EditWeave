import { applyColorCurves, applyColorQualifier } from './colorCurves'
import { colorFilter, defaultColorAdjustment } from './effects'
import type { ColorAdjustment, ColorNode, ColorNodeType } from './types'
import { applyEmbeddedColorLut } from './lut'

export const colorNodeLabels: Record<ColorNodeType, string> = {
  primary: 'Primary',
  curves: 'Curves',
  qualifier: 'Qualifier',
  look: 'Look / LUT',
  'tone-map': 'HDR Tone Map',
}

export function createColorNode(type: ColorNodeType, inputId = 'source', index = 0): ColorNode {
  const adjustment: ColorNode['adjustment'] = type === 'tone-map'
    ? { toneMapMethod: 'hable', sourcePeakNits: 1_000, targetPeakNits: 100 }
    : type === 'qualifier'
      ? { qualifierEnabled: true, qualifierHue: 120, qualifierHueRange: 30, qualifierSaturationMin: 20, qualifierSaturationMax: 100, qualifierLuminanceMin: 10, qualifierLuminanceMax: 95, qualifierSoftness: 20, qualifierExposure: 0, qualifierSaturation: 0, qualifierHueShift: 0 }
      : type === 'curves'
        ? { masterCurve: [{ x: 0, y: 0 }, { x: 1, y: 1 }], redCurve: [{ x: 0, y: 0 }, { x: 1, y: 1 }], greenCurve: [{ x: 0, y: 0 }, { x: 1, y: 1 }], blueCurve: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }
        : type === 'look'
          ? { lut: 'cinematic', lutIntensity: 50, saturation: 0, contrast: 0 }
          : { exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0, lift: 0, gamma: 0, gain: 0 }
  return { id: crypto.randomUUID(), name: `${colorNodeLabels[type]} ${index + 1}`, type, enabled: true, mix: 100, inputIds: [inputId], blendMode: 'normal', adjustment }
}

export function applyColorNodeGraph(context: CanvasRenderingContext2D, width: number, height: number, color?: ColorAdjustment): void {
  const nodes = color?.colorNodes?.slice(0, 16) ?? []
  if (!nodes.length || width <= 0 || height <= 0) return
  const source = cloneCanvas(context.canvas, width, height)
  const outputs = new Map<string, HTMLCanvasElement>([['source', source]])
  let previousId = 'source'
  for (const node of nodes) {
    const available = node.inputIds.map((id) => outputs.get(id)).filter((canvas): canvas is HTMLCanvasElement => Boolean(canvas))
    const inputs = available.length ? available : [outputs.get(previousId) ?? source]
    const input = combineInputs(inputs, width, height, node.blendMode)
    const output = node.enabled ? processNode(input, node, width, height) : input
    outputs.set(node.id, mixCanvases(input, output, Math.max(0, Math.min(100, node.mix)) / 100, width, height))
    previousId = node.id
  }
  const selected = outputs.get(color?.colorOutputNodeId ?? '') ?? outputs.get(previousId) ?? source
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalCompositeOperation = 'copy'
  context.globalAlpha = 1
  context.filter = 'none'
  context.drawImage(selected, 0, 0, width, height)
  context.restore()
}

export function applyBaseColorFilter(context: CanvasRenderingContext2D, width: number, height: number, color?: ColorAdjustment): void {
  if (!color) return
  const source = cloneCanvas(context.canvas, width, height)
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalCompositeOperation = 'copy'
  context.globalAlpha = 1
  context.filter = colorFilter(color)
  context.drawImage(source, 0, 0, width, height)
  context.restore()
  applyEmbeddedColorLut(context, width, height, color.customLut, color.lutIntensity)
}

function processNode(input: HTMLCanvasElement, node: ColorNode, width: number, height: number): HTMLCanvasElement {
  const output = cloneCanvas(input, width, height)
  const context = output.getContext('2d', { willReadFrequently: true })
  if (!context) return output
  const adjustment = { ...defaultColorAdjustment(), ...node.adjustment, colorNodes: undefined, colorOutputNodeId: undefined }
  if (node.type === 'primary' || node.type === 'look') {
    context.save()
    context.globalCompositeOperation = 'copy'
    context.filter = colorFilter(adjustment)
    context.drawImage(input, 0, 0, width, height)
    context.restore()
    applyEmbeddedColorLut(context, width, height, adjustment.customLut, adjustment.lutIntensity)
  } else if (node.type === 'curves') applyColorCurves(context, width, height, adjustment)
  else if (node.type === 'qualifier') applyColorQualifier(context, width, height, adjustment)
  else applyToneMap(context, width, height, node.adjustment.toneMapMethod ?? 'hable', node.adjustment.sourcePeakNits ?? 1_000, node.adjustment.targetPeakNits ?? 100)
  return output
}

function applyToneMap(context: CanvasRenderingContext2D, width: number, height: number, method: 'hable' | 'reinhard' | 'mobius', sourcePeak: number, targetPeak: number): void {
  const image = context.getImageData(0, 0, width, height)
  const scale = Math.max(1, sourcePeak) / Math.max(1, targetPeak)
  const hable = (value: number) => { const a = 0.15; const b = 0.5; const c = 0.1; const d = 0.2; const e = 0.02; const f = 0.3; return ((value * (a * value + c * b) + d * e) / (value * (a * value + b) + d * f)) - e / f }
  for (let index = 0; index < image.data.length; index += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const encoded = image.data[index + channel] / 255
      const linear = encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4
      const value = linear * scale
      const mapped = method === 'reinhard' ? value / (1 + value) : method === 'mobius' ? value <= 0.3 ? value : (value + 0.18) / (value + 0.78) : hable(value) / Math.max(0.001, hable(scale))
      const display = mapped <= 0.0031308 ? mapped * 12.92 : 1.055 * Math.max(0, mapped) ** (1 / 2.4) - 0.055
      image.data[index + channel] = Math.max(0, Math.min(255, Math.round(display * 255)))
    }
  }
  context.putImageData(image, 0, 0)
}

function combineInputs(inputs: HTMLCanvasElement[], width: number, height: number, mode: ColorNode['blendMode']): HTMLCanvasElement {
  const output = document.createElement('canvas')
  output.width = width; output.height = height
  const context = output.getContext('2d')
  if (!context) return output
  inputs.forEach((input, index) => {
    context.globalAlpha = index === 0 ? 1 : 1 / (index + 1)
    context.globalCompositeOperation = index === 0 || mode === 'normal' ? 'source-over' : mode === 'add' ? 'lighter' : mode
    context.drawImage(input, 0, 0, width, height)
  })
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
  return output
}

function mixCanvases(input: HTMLCanvasElement, output: HTMLCanvasElement, mix: number, width: number, height: number): HTMLCanvasElement {
  if (mix >= 0.999) return output
  if (mix <= 0.001) return input
  const mixed = document.createElement('canvas')
  mixed.width = width; mixed.height = height
  const context = mixed.getContext('2d')
  if (!context) return output
  context.drawImage(input, 0, 0, width, height)
  context.globalAlpha = mix
  context.drawImage(output, 0, 0, width, height)
  return mixed
}

function cloneCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  canvas.getContext('2d')?.drawImage(source, 0, 0, width, height)
  return canvas
}
