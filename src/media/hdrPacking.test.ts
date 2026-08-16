import { describe, expect, it } from 'vitest'
import { normalizeDecodedI420P10 } from './export'

function write16(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff
  data[offset + 1] = value >> 8
}

function read16(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8)
}

describe('I420P10 decoded sample packing', () => {
  const layout: PlaneLayout[] = [{ offset: 0, stride: 8 }, { offset: 16, stride: 4 }, { offset: 20, stride: 4 }]

  it('normalizes WebCodecs high-bit-aligned samples to yuv420p10le values', () => {
    const data = new Uint8Array(24)
    const values = [64, 940, 512, 960, 128, 700, 300, 800, 512, 700, 512, 300]
    values.forEach((value, index) => write16(data, index * 2, value << 6))
    expect(normalizeDecodedI420P10(data, layout, 4, 2)).toBe(true)
    expect(values.map((_, index) => read16(data, index * 2))).toEqual(values)
  })

  it('leaves already low-bit-aligned compositor samples unchanged', () => {
    const data = new Uint8Array(24)
    const values = [64, 940, 512, 960, 128, 700, 300, 800, 512, 700, 512, 300]
    values.forEach((value, index) => write16(data, index * 2, value))
    const before = data.slice()
    expect(normalizeDecodedI420P10(data, layout, 4, 2)).toBe(false)
    expect(data).toEqual(before)
  })
})
