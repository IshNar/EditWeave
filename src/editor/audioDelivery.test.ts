import { describe, expect, it } from 'vitest'
import { defaultAudioBuses, isAudioBusActive, normalizeAudioBuses, resolveAudioAuxSends } from './audioBuses'
import { createBiquadState, highpassBiquad, processBiquad, stereoPanSample } from './audioDsp'
import { inspectDelivery } from './delivery'
import type { MediaAsset, TimelineClip, TimelineTrack } from './types'

const transform = { positionX: 0, positionY: 0, scale: 100, rotation: 0, opacity: 100 }
const picture: TimelineClip = {
  id: 'picture', trackId: 'v1', assetId: 'asset', name: 'picture', start: 1, duration: 2,
  sourceOffset: 0, kind: 'video', color: '#000', transform,
}
const videoTrack: TimelineTrack = { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false, clips: [picture] }

describe('audio DSP and bus safety', () => {
  it('uses equal-power mono panning at center and hard pans at the edges', () => {
    expect(stereoPanSample(1, 0, 0, true).left).toBeCloseTo(Math.SQRT1_2)
    expect(stereoPanSample(1, 0, 0, true).right).toBeCloseTo(Math.SQRT1_2)
    expect(stereoPanSample(1, 0, -1, true)).toEqual({ left: 1, right: 0 })
    expect(stereoPanSample(1, 0, 1, true).left).toBeCloseTo(0)
    expect(stereoPanSample(1, 0, 1, true).right).toBeCloseTo(1)
  })

  it('keeps biquad processing finite for invalid input ranges', () => {
    const coefficients = highpassBiquad(1, Number.POSITIVE_INFINITY)
    const state = createBiquadState()
    const output = [1, 0, -1, Number.NaN].map((sample) => processBiquad(sample, coefficients, state))
    expect(output.every(Number.isFinite)).toBe(true)
  })

  it('clamps inserts and aux sends and enforces solo routing', () => {
    const buses = normalizeAudioBuses({
      dialogue: { ...defaultAudioBuses().dialogue, solo: true, inserts: [{ id: '', type: 'compressor', enabled: true, thresholdDb: -100, ratio: 50, makeupDb: 50 }] },
    })
    expect(buses.dialogue.inserts[0]).toMatchObject({ thresholdDb: -60, ratio: 20, makeupDb: 24 })
    expect(isAudioBusActive(buses, 'dialogue')).toBe(true)
    expect(isAudioBusActive(buses, 'music')).toBe(false)
    expect(resolveAudioAuxSends({ auxSends: [{ id: '', bus: 'music', levelDb: 99, position: 'pre', enabled: true }] })[0])
      .toMatchObject({ bus: 'music', levelDb: 12, position: 'pre', enabled: true })
  })
})

describe('delivery guard', () => {
  it('blocks an offline source and warns about a real VFR source', () => {
    const asset: MediaAsset = {
      id: 'asset', name: 'camera.mp4', kind: 'video', url: '', duration: 2, size: 1, extension: 'mp4',
      status: 'offline', variableFrameRate: true,
    }
    const ids = inspectDelivery({ tracks: [videoTrack], assets: [asset], sequences: [], aspectRatio: '16:9' }).map((issue) => issue.id)
    expect(ids).toContain('offline-asset')
    expect(ids).not.toContain('vfr-asset')
  })

  it('passes connected picture but reports leading black and VFR risks', () => {
    const asset: MediaAsset = {
      id: 'asset', name: 'camera.mp4', kind: 'video', url: 'blob:camera', sourceFile: new File(['video'], 'camera.mp4'),
      duration: 2, size: 5, extension: 'mp4', status: 'ready', videoDecodable: true, variableFrameRate: true,
    }
    const issues = inspectDelivery({ tracks: [videoTrack], assets: [asset], sequences: [], aspectRatio: '16:9' })
    expect(issues.map((issue) => issue.id)).toEqual(expect.arrayContaining(['vfr-asset', 'picture-gaps']))
    expect(issues.some((issue) => issue.level === 'blocker')).toBe(false)
  })

  it('blocks an empty visible timeline', () => {
    const empty = { ...videoTrack, clips: [] }
    expect(inspectDelivery({ tracks: [empty], assets: [], sequences: [], aspectRatio: '16:9' }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: 'no-picture', level: 'blocker' })]))
  })
})
