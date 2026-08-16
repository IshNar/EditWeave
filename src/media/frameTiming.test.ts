import { describe, expect, it } from 'vitest'
import { summarizeFrameTiming } from './analyze'

function packetsFromDurations(durations: number[]): Array<{ timestamp: number; duration: number }> {
  let timestamp = 0
  return durations.map((duration) => {
    const packet = { timestamp, duration }
    timestamp += duration
    return packet
  })
}

describe('video frame timing analysis', () => {
  it('recognizes constant 29.97 fps timing', () => {
    const result = summarizeFrameTiming(packetsFromDurations(Array.from({ length: 120 }, () => 1001 / 30000)))
    expect(result.frameRate).toBeCloseTo(29.97, 1)
    expect(result.variable).toBe(false)
    expect(result.variation).toBe(0)
  })

  it('flags smartphone-like mixed frame durations as VFR', () => {
    const durations = Array.from({ length: 120 }, (_, index) => index % 5 === 0 ? 1 / 15 : 1 / 30)
    const result = summarizeFrameTiming(packetsFromDurations(durations))
    expect(result.variable).toBe(true)
    expect(result.variation).toBeGreaterThan(0.2)
  })
})
