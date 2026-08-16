export type HdrTransfer = 'pq' | 'hlg'
export type Rgb = readonly [number, number, number]

export const SDR_REFERENCE_WHITE_NITS = 203
export const HLG_REFERENCE_WHITE_SIGNAL = 0.75

const PQ_M1 = 0.1593017578125
const PQ_M2 = 78.84375
const PQ_C1 = 0.8359375
const PQ_C2 = 18.8515625
const PQ_C3 = 18.6875
const HLG_A = 0.17883277
const HLG_B = 0.28466892
const HLG_C = 0.55991073

export function srgbToLinear(value: number): number {
  const bounded = clamp(value, 0, 1)
  return bounded <= 0.04045 ? bounded / 12.92 : ((bounded + 0.055) / 1.055) ** 2.4
}

export function pqEncodeNits(nits: number): number {
  const level = (clamp(nits, 0, 10_000) / 10_000) ** PQ_M1
  return ((PQ_C1 + PQ_C2 * level) / (1 + PQ_C3 * level)) ** PQ_M2
}

export function pqDecodeNits(signal: number): number {
  const power = clamp(signal, 0, 1) ** (1 / PQ_M2)
  return 10_000 * (Math.max((power - PQ_C1) / Math.max(PQ_C2 - PQ_C3 * power, 0.000001), 0) ** (1 / PQ_M1))
}

export function hlgEncodeScene(sceneLinear: number): number {
  const value = Math.max(0, sceneLinear)
  return value <= 1 / 12 ? Math.sqrt(3 * value) : HLG_A * Math.log(12 * value - HLG_B) + HLG_C
}

export function hlgDecodeScene(signal: number): number {
  const value = clamp(signal, 0, 1)
  return value <= 0.5 ? value * value / 3 : (Math.exp((value - HLG_C) / HLG_A) + HLG_B) / 12
}

export const HLG_SDR_WHITE_SCENE = hlgDecodeScene(HLG_REFERENCE_WHITE_SIGNAL)

export function rec709LinearToRec2020([red, green, blue]: Rgb): [number, number, number] {
  return [
    red * 0.627404 + green * 0.329282 + blue * 0.0433136,
    red * 0.069097 + green * 0.91954 + blue * 0.0113612,
    red * 0.0163916 + green * 0.0880132 + blue * 0.895595,
  ]
}

export function sdrCanvasToHdrSignal(rgb: Rgb, transfer: HdrTransfer): [number, number, number] {
  const linear2020 = rec709LinearToRec2020(rgb.map(srgbToLinear) as unknown as Rgb).map((value) => Math.max(0, value)) as [number, number, number]
  return linear2020.map((value) => transfer === 'pq' ? pqEncodeNits(value * SDR_REFERENCE_WHITE_NITS) : hlgEncodeScene(value * HLG_SDR_WHITE_SCENE)) as [number, number, number]
}

export function encodedBt2020ToYcbcr([red, green, blue]: Rgb): { y: number; cb: number; cr: number } {
  const y = red * 0.2627 + green * 0.678 + blue * 0.0593
  return { y, cb: (blue - y) / 1.8814, cr: (red - y) / 1.4746 }
}

export function limited10Luma(value: number): number {
  return Math.round(clamp(64 + 876 * value, 64, 940))
}

export function limited10Chroma(value: number): number {
  return Math.round(clamp(512 + 896 * value, 64, 960))
}

export function scopeLuma8(red: number, green: number, blue: number): number {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

export function scopeChroma8(red: number, green: number, blue: number): { cb: number; cr: number } {
  return { cb: -0.114572 * red - 0.385428 * green + 0.5 * blue, cr: 0.5 * red - 0.454153 * green - 0.045847 * blue }
}

export interface ColorPatchMeasurement {
  id: string
  pqSignal: number
  hlgSignal: number
  limitedLuma: number
  scopeLuma: number
}

export function measureNeutralPatch(id: string, srgb: number): ColorPatchMeasurement {
  const pqSignal = sdrCanvasToHdrSignal([srgb, srgb, srgb], 'pq')[0]
  const hlgSignal = sdrCanvasToHdrSignal([srgb, srgb, srgb], 'hlg')[0]
  return { id, pqSignal, hlgSignal, limitedLuma: limited10Luma(pqSignal), scopeLuma: scopeLuma8(srgb * 255, srgb * 255, srgb * 255) }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
