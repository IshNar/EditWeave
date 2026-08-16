import { describe, expect, it } from 'vitest'
import { defaultAudioAdjustment, defaultCaptionStyle, defaultColorAdjustment, defaultTransform, defaultVisualEffects } from '../editor/effects'
import { flattenNestedTracks } from '../editor/nesting'
import type { MediaAsset, ProjectSequence, TimelineClip, TimelineTrack } from '../editor/types'
import { timeAtFrame } from '../editor/frameMath'
import { createOutputProgramSnapshot, createPreviewProgramSnapshot, evaluatePreviewOutputConformance } from './previewOutputConformance'

describe('preview and output timeline conformance', () => {
  it.each([23.976, 29.97, 30, 59.94])('matches cuts, transitions, speed maps, captions, and audio at %s fps', (fps) => {
    const fixture = conformanceFixture(fps)
    const frames = [0, 1, 47, 59, 60, 72, 119, 120, 150, 239, 240, 300]
    const result = evaluatePreviewOutputConformance({
      tracks: fixture.tracks,
      assets: fixture.assets,
      sampleTimes: frames.map((frame) => timeAtFrame(frame, fps)),
      fps,
      sampleRate: 48_000,
    })
    expect(result).toEqual({ samples: frames.length, mismatches: [], maxSourceFrameDelta: 0, maxAudioSampleDelta: 0 })
  })

  it('matches a flattened nested sequence with parent and child speed automation', () => {
    const fps = 29.97
    const fixture = conformanceFixture(fps)
    const child: ProjectSequence = { id: 'child', name: 'Nested', kind: 'nested', aspectRatio: '16:9', width: 1920, height: 1080, fps, tracks: fixture.tracks, transcript: [], suggestions: [], markers: [], createdAt: '2026-08-15T00:00:00.000Z' }
    const parentClip = clip('parent', 'parent-v', undefined, 2, 6, 0, { nestedSequenceId: child.id, speedKeyframes: [{ id: 'parent-speed', time: 6, rate: 1.25, easing: 'linear' }] })
    const parentTracks: TimelineTrack[] = [track('parent-v', 'video', [parentClip])]
    const flattened = flattenNestedTracks(parentTracks, [child])
    const result = evaluatePreviewOutputConformance({ tracks: flattened, assets: fixture.assets, sampleTimes: [2, 2.5, 3.9, 5.5, 7.9], fps })
    expect(result.mismatches).toEqual([])
    expect(result.maxSourceFrameDelta).toBe(0)
    expect(result.maxAudioSampleDelta).toBe(0)
  })

  it('reports a preview-only asset that cannot be rendered from a source file', () => {
    const fps = 30
    const fixture = conformanceFixture(fps)
    fixture.assets[0] = { ...fixture.assets[0], sourceFile: undefined }
    const result = evaluatePreviewOutputConformance({ tracks: fixture.tracks, assets: fixture.assets, sampleTimes: [0.5], fps })
    expect(result.mismatches).toContain('frame 15: visual layers')
    expect(result.mismatches).toContain('frame 15: audio layers')
  })

  it('uses export range frame timestamps as the preview comparison points', () => {
    const fps = 29.97
    const fixture = conformanceFixture(fps)
    const rangeStart = timeAtFrame(61, fps)
    const times = Array.from({ length: 180 }, (_, index) => rangeStart + index / fps)
    const result = evaluatePreviewOutputConformance({ tracks: fixture.tracks, assets: fixture.assets, sampleTimes: times, fps })
    expect(result.samples).toBe(180)
    expect(result.mismatches).toEqual([])
  })

  it('exposes identical resolved snapshots at a transition midpoint', () => {
    const fps = 30
    const fixture = conformanceFixture(fps)
    const timelineTime = 2
    expect(createPreviewProgramSnapshot(fixture.tracks, fixture.assets, timelineTime, fps)).toEqual(createOutputProgramSnapshot(fixture.tracks, fixture.assets, timelineTime, fps))
  })
})

function conformanceFixture(fps: number): { assets: MediaAsset[]; tracks: TimelineTrack[] } {
  const assets = [asset('camera-a', 'Camera A', fps), asset('camera-b', 'Camera B', fps), asset('music', 'Music', fps, 'audio')]
  const first = clip('clip-a', 'v1', 'camera-a', 0, 2, 0.25, {
    transitionOut: { type: 'crossfade', duration: 0.5, alignment: 'center-on-cut', easing: 'linear', audioCurve: 'equal-power' },
    speedKeyframes: [{ id: 'speed-a', time: 2, rate: 1.5, easing: 'linear' }],
    keyframes: [{ id: 'move-a', time: 0, easing: 'linear', transform: { ...defaultTransform, positionX: -120 } }, { id: 'move-b', time: 2, easing: 'linear', transform: { ...defaultTransform, positionX: 120 } }],
    audioMixKeyframes: [{ id: 'mix-a', time: 0, gainDb: -3, pan: -20, easing: 'linear' }, { id: 'mix-b', time: 2, gainDb: 1, pan: 20, easing: 'linear' }],
  })
  const second = clip('clip-b', 'v1', 'camera-b', 2, 6, 1, { transitionIn: { type: 'crossfade', duration: 0.5, alignment: 'center-on-cut', easing: 'linear', audioCurve: 'equal-power' }, reverse: true })
  const music = clip('music-clip', 'a1', 'music', 0, 10, 0, { audioAdjustment: { ...defaultAudioAdjustment(), gainDb: -9, pan: 10 }, audioMixKeyframes: [{ id: 'music-a', time: 0, gainDb: -12, pan: 0, easing: 'linear' }, { id: 'music-b', time: 10, gainDb: -6, pan: 15, easing: 'linear' }] })
  const adjustment = clip('grade', 'v2', undefined, 1, 5, 0, { adjustmentLayer: true, colorAdjustment: { ...defaultColorAdjustment(), exposure: 0.4 }, visualEffects: { ...defaultVisualEffects(), blur: 2 } })
  const caption = clip('미리보기와 출력 일치', 'c1', undefined, 1.5, 2.5, 0, { captionStyle: defaultCaptionStyle(), captionWords: [{ text: '미리보기와', start: 0, end: 1 }, { text: '출력', start: 1, end: 1.5 }, { text: '일치', start: 1.5, end: 2.5 }] })
  return {
    assets,
    tracks: [track('v1', 'video', [first, second]), track('v2', 'video', [adjustment], { compositePriority: 100 }), track('a1', 'audio', [music], { volume: 86, pan: -5, mixKeyframes: [{ id: 'track-a', time: 0, volume: 80, pan: -10, easing: 'linear' }, { id: 'track-b', time: 10, volume: 95, pan: 10, easing: 'linear' }] }), track('c1', 'caption', [caption])],
  }
}

function asset(id: string, name: string, fps: number, kind: MediaAsset['kind'] = 'video'): MediaAsset {
  return { id, name, kind, url: `memory:${id}`, sourceFile: { name: `${id}.mov` } as File, duration: 20, size: 1_000, extension: kind === 'audio' ? 'wav' : 'mov', frameRate: fps, sampleRate: 48_000, channels: 2, status: 'ready' }
}

function track(id: string, kind: TimelineTrack['kind'], clips: TimelineClip[], patch: Partial<TimelineTrack> = {}): TimelineTrack {
  return { id, name: id, kind, locked: false, muted: false, volume: 100, pan: 0, clips, ...patch }
}

function clip(id: string, trackId: string, assetId: string | undefined, start: number, duration: number, sourceOffset: number, patch: Partial<TimelineClip> = {}): TimelineClip {
  return { id, trackId, assetId, name: id, kind: trackId.startsWith('a') ? 'audio' : trackId.startsWith('c') ? 'caption' : 'video', color: '#7a9cff', start, duration, sourceOffset, transform: defaultTransform, colorAdjustment: defaultColorAdjustment(), visualEffects: defaultVisualEffects(), audioAdjustment: defaultAudioAdjustment(), ...patch } as TimelineClip
}
