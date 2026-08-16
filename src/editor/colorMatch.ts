import { createColorNode } from './colorNodes'
import type { ColorAdjustment, ColorNode } from './types'

export interface FrameColorStatistics {
  red: number
  green: number
  blue: number
  luminance: number
  lowLuminance: number
  highLuminance: number
  saturation: number
  samples: number
}

export function analyzeFrameColor(image: ImageData): FrameColorStatistics {
  const pixels = image.width * image.height
  const stride = Math.max(1, Math.ceil(Math.sqrt(pixels / 60_000)))
  const luminances: number[] = []
  let red = 0
  let green = 0
  let blue = 0
  let saturation = 0
  let samples = 0
  for (let y = 0; y < image.height; y += stride) {
    for (let x = 0; x < image.width; x += stride) {
      const offset = (y * image.width + x) * 4
      if (image.data[offset + 3] < 128) continue
      const r = image.data[offset] / 255
      const g = image.data[offset + 1] / 255
      const b = image.data[offset + 2] / 255
      const luma = r * 0.2126 + g * 0.7152 + b * 0.0722
      if (luma < 0.012 || luma > 0.988) continue
      red += r
      green += g
      blue += b
      saturation += Math.max(r, g, b) - Math.min(r, g, b)
      luminances.push(luma)
      samples += 1
    }
  }
  if (samples < 32) throw new Error('색상을 분석할 유효 픽셀이 부족합니다.')
  luminances.sort((left, right) => left - right)
  const percentile = (value: number) => luminances[Math.max(0, Math.min(luminances.length - 1, Math.round((luminances.length - 1) * value)))]
  return { red: red / samples, green: green / samples, blue: blue / samples, luminance: percentile(0.5), lowLuminance: percentile(0.1), highLuminance: percentile(0.9), saturation: saturation / samples, samples }
}

function gainCurve(gain: number): Array<{ x: number; y: number }> {
  const safeGain = Math.max(0.55, Math.min(1.8, gain))
  return [
    { x: 0, y: 0 },
    { x: 0.18, y: Math.max(0, Math.min(1, 0.18 * safeGain)) },
    { x: 0.5, y: Math.max(0, Math.min(1, 0.5 * safeGain)) },
    { x: 0.82, y: Math.max(0, Math.min(1, 1 - (1 - 0.82) / safeGain)) },
    { x: 1, y: 1 },
  ]
}

function channelGains(source: FrameColorStatistics, target: FrameColorStatistics): { red: number; green: number; blue: number } {
  const raw = { red: target.red / Math.max(0.01, source.red), green: target.green / Math.max(0.01, source.green), blue: target.blue / Math.max(0.01, source.blue) }
  const geometricMean = Math.cbrt(Math.max(0.001, raw.red * raw.green * raw.blue))
  return { red: raw.red / geometricMean, green: raw.green / geometricMean, blue: raw.blue / geometricMean }
}

function balanceNode(inputId: string, source: FrameColorStatistics, target: FrameColorStatistics, name: string): ColorNode {
  const gains = channelGains(source, target)
  const node = createColorNode('curves', inputId)
  return { ...node, name, adjustment: { masterCurve: [{ x: 0, y: 0 }, { x: 1, y: 1 }], redCurve: gainCurve(gains.red), greenCurve: gainCurve(gains.green), blueCurve: gainCurve(gains.blue) } }
}

export function createAutoWhiteBalanceNodes(source: FrameColorStatistics, inputId = 'source'): ColorNode[] {
  const neutral = (source.red + source.green + source.blue) / 3
  return [balanceNode(inputId, source, { ...source, red: neutral, green: neutral, blue: neutral }, 'Auto White Balance · Generated')]
}

export function createReferenceMatchNodes(source: FrameColorStatistics, target: FrameColorStatistics, inputId = 'source'): ColorNode[] {
  const sourceRange = Math.max(0.02, source.highLuminance - source.lowLuminance)
  const targetRange = Math.max(0.02, target.highLuminance - target.lowLuminance)
  const primary = createColorNode('primary', inputId)
  primary.name = 'Shot Match Primary · Generated'
  primary.adjustment = {
    exposure: Math.max(-3, Math.min(3, Math.log2(Math.max(0.02, target.luminance) / Math.max(0.02, source.luminance)))),
    contrast: Math.max(-60, Math.min(60, (targetRange / sourceRange - 1) * 80)),
    saturation: Math.max(-70, Math.min(120, (target.saturation / Math.max(0.015, source.saturation) - 1) * 100)),
    temperature: 0, tint: 0, highlights: 0, shadows: 0, lut: 'none', lutIntensity: 0,
  }
  return [primary, balanceNode(primary.id, source, target, 'Shot Match Balance · Generated')]
}

export function appendGeneratedColorNodes(color: ColorAdjustment, generated: ColorNode[]): ColorAdjustment {
  const retained = (color.colorNodes ?? []).filter((node) => !node.name.endsWith('· Generated'))
  const available = retained.slice(0, Math.max(0, 16 - generated.length))
  const inputId = available.some((node) => node.id === color.colorOutputNodeId) ? color.colorOutputNodeId! : available.at(-1)?.id ?? 'source'
  const remapped = generated.map((node, index) => ({ ...node, inputIds: [index === 0 ? inputId : generated[index - 1].id] }))
  const nodes = [...available, ...remapped]
  return { ...color, colorNodes: nodes, colorOutputNodeId: nodes.at(-1)?.id }
}
