export interface EmbeddedColorLut {
  name: string
  dimension: 1 | 3
  size: number
  domainMin: [number, number, number]
  domainMax: [number, number, number]
  data: string
}

const decodedLutCache = new Map<string, Float32Array>()

export function parseCubeLut(contents: string, filename = 'Imported LUT'): EmbeddedColorLut {
  const lines = contents.split(/\r?\n/)
  let title = filename.replace(/\.cube$/i, '') || 'Imported LUT'
  let dimension: 1 | 3 | undefined
  let size = 0
  let domainMin: [number, number, number] = [0, 0, 0]
  let domainMax: [number, number, number] = [1, 1, 1]
  const values: number[] = []
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const titleMatch = line.match(/^TITLE\s+"?(.+?)"?$/i)
    if (titleMatch) { title = titleMatch[1]; continue }
    const size3d = line.match(/^LUT_3D_SIZE\s+(\d+)$/i)
    if (size3d) { dimension = 3; size = Number(size3d[1]); continue }
    const size1d = line.match(/^LUT_1D_SIZE\s+(\d+)$/i)
    if (size1d) { dimension = 1; size = Number(size1d[1]); continue }
    const domainMinimum = line.match(/^DOMAIN_MIN\s+([-+\deE.]+)\s+([-+\deE.]+)\s+([-+\deE.]+)$/i)
    if (domainMinimum) { domainMin = [Number(domainMinimum[1]), Number(domainMinimum[2]), Number(domainMinimum[3])]; continue }
    const domainMaximum = line.match(/^DOMAIN_MAX\s+([-+\deE.]+)\s+([-+\deE.]+)\s+([-+\deE.]+)$/i)
    if (domainMaximum) { domainMax = [Number(domainMaximum[1]), Number(domainMaximum[2]), Number(domainMaximum[3])]; continue }
    const samples = line.split(/\s+/).map(Number)
    if (samples.length >= 3 && samples.slice(0, 3).every(Number.isFinite)) values.push(samples[0], samples[1], samples[2])
  }
  if (!dimension || !Number.isInteger(size) || size < 2 || size > 65) throw new Error('지원되는 .cube LUT 크기는 2–65입니다.')
  const expected = dimension === 3 ? size ** 3 * 3 : size * 3
  if (values.length !== expected) throw new Error(`LUT 샘플 수가 올바르지 않습니다. ${expected / 3}개가 필요하지만 ${values.length / 3}개입니다.`)
  if (domainMin.some((value, index) => !Number.isFinite(value) || value >= domainMax[index])) throw new Error('LUT DOMAIN_MIN/MAX 범위가 올바르지 않습니다.')
  const floats = new Float32Array(values)
  const bytes = new Uint8Array(floats.buffer)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return { name: title.slice(0, 160), dimension, size, domainMin, domainMax, data: btoa(binary) }
}

export function applyEmbeddedColorLut(context: CanvasRenderingContext2D, width: number, height: number, lut: EmbeddedColorLut | undefined, intensity = 100): void {
  const mix = Math.max(0, Math.min(1, intensity / 100))
  if (!lut || mix <= 0 || width <= 0 || height <= 0) return
  const table = decodeLut(lut)
  const image = context.getImageData(0, 0, width, height)
  const pixels = image.data
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const input: [number, number, number] = [pixels[offset] / 255, pixels[offset + 1] / 255, pixels[offset + 2] / 255]
    const mapped = lut.dimension === 1 ? sample1d(table, lut, input) : sample3d(table, lut, input)
    pixels[offset] = Math.round((input[0] * (1 - mix) + mapped[0] * mix) * 255)
    pixels[offset + 1] = Math.round((input[1] * (1 - mix) + mapped[1] * mix) * 255)
    pixels[offset + 2] = Math.round((input[2] * (1 - mix) + mapped[2] * mix) * 255)
  }
  context.putImageData(image, 0, 0)
}

function decodeLut(lut: EmbeddedColorLut): Float32Array {
  const cached = decodedLutCache.get(lut.data)
  if (cached) return cached
  const binary = atob(lut.data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  const decoded = new Float32Array(bytes.buffer)
  decodedLutCache.set(lut.data, decoded)
  if (decodedLutCache.size > 24) decodedLutCache.delete(decodedLutCache.keys().next().value!)
  return decoded
}

function normalize(value: number, minimum: number, maximum: number): number {
  return Math.max(0, Math.min(1, (value - minimum) / Math.max(1e-9, maximum - minimum)))
}

function sample1d(table: Float32Array, lut: EmbeddedColorLut, input: [number, number, number]): [number, number, number] {
  return input.map((value, channel) => {
    const position = normalize(value, lut.domainMin[channel], lut.domainMax[channel]) * (lut.size - 1)
    const low = Math.floor(position)
    const high = Math.min(lut.size - 1, low + 1)
    const fraction = position - low
    return Math.max(0, Math.min(1, table[low * 3 + channel] * (1 - fraction) + table[high * 3 + channel] * fraction))
  }) as [number, number, number]
}

function sample3d(table: Float32Array, lut: EmbeddedColorLut, input: [number, number, number]): [number, number, number] {
  const positions = input.map((value, channel) => normalize(value, lut.domainMin[channel], lut.domainMax[channel]) * (lut.size - 1))
  const low = positions.map(Math.floor)
  const high = low.map((value) => Math.min(lut.size - 1, value + 1))
  const fraction = positions.map((value, channel) => value - low[channel])
  const sample = (red: number, green: number, blue: number, channel: number) => table[((blue * lut.size + green) * lut.size + red) * 3 + channel]
  return [0, 1, 2].map((channel) => {
    const c000 = sample(low[0], low[1], low[2], channel); const c100 = sample(high[0], low[1], low[2], channel)
    const c010 = sample(low[0], high[1], low[2], channel); const c110 = sample(high[0], high[1], low[2], channel)
    const c001 = sample(low[0], low[1], high[2], channel); const c101 = sample(high[0], low[1], high[2], channel)
    const c011 = sample(low[0], high[1], high[2], channel); const c111 = sample(high[0], high[1], high[2], channel)
    const x00 = c000 * (1 - fraction[0]) + c100 * fraction[0]; const x10 = c010 * (1 - fraction[0]) + c110 * fraction[0]
    const x01 = c001 * (1 - fraction[0]) + c101 * fraction[0]; const x11 = c011 * (1 - fraction[0]) + c111 * fraction[0]
    const y0 = x00 * (1 - fraction[1]) + x10 * fraction[1]; const y1 = x01 * (1 - fraction[1]) + x11 * fraction[1]
    return Math.max(0, Math.min(1, y0 * (1 - fraction[2]) + y1 * fraction[2]))
  }) as [number, number, number]
}
