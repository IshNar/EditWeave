import { describe, expect, it } from 'vitest'
import { clipSourceTime } from '../editor/effects'
import { frameAlignmentError, frameIndexAtTime, snapTimeToFrame, timeAtFrame } from '../editor/frameMath'
import { appendHistorySnapshot, redoHistorySnapshot, undoHistorySnapshot } from '../editor/history'
import { nestedOutputTime } from '../editor/nesting'
import { removeTimelineRange, splitTimelineClipsAt, trimTimelineClipAdvancedResult } from '../editor/timelineOps'
import type { TimelineClip, TimelineTrack } from '../editor/types'

const transform = { positionX: 0, positionY: 0, scale: 100, rotation: 0, opacity: 100 }

function clip(id: string, trackId: string, start: number, duration: number, sourceOffset = 0, overrides: Partial<TimelineClip> = {}): TimelineClip {
  return { id, trackId, assetId: `asset-${id}`, name: id, start, duration, sourceOffset, kind: 'video', color: '#000', transform, ...overrides }
}

function track(id: string, clips: TimelineClip[]): TimelineTrack {
  return { id, name: id, kind: 'video', muted: false, locked: false, syncLock: true, clips }
}

function expectFrame(time: number, expected: number, fps: number): void {
  expect(frameIndexAtTime(time, fps)).toBe(expected)
  expect(frameAlignmentError(time, fps)).toBeLessThan(1e-7)
}

describe('frame grid contract', () => {
  it.each([23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120])('round-trips long-form frame positions at %s fps', (fps) => {
    for (const frame of [0, 1, 10, 1_001, 100_000, Math.round(fps * 60 * 60 * 6)]) {
      expect(frameIndexAtTime(timeAtFrame(frame, fps), fps)).toBe(frame)
    }
    expect(frameAlignmentError(snapTimeToFrame(12.3456789, fps), fps)).toBeLessThan(1e-7)
  })
})

describe.each([23.976, 24, 25, 29.97, 30, 50, 59.94, 60])('frame-accurate edit operations at %s fps', (fps) => {
  const f = (frame: number) => timeAtFrame(frame, fps)

  it('splits variable-speed linked clips without a source discontinuity', () => {
    const video = clip('video', 'v1', f(10), f(240), f(30), { linkGroupId: 'av', speedKeyframes: [{ id: 'speed', time: f(240), rate: 1.5, easing: 'linear' }] })
    const audio = { ...clip('audio', 'a1', f(10), f(240), f(30), { kind: 'audio', linkGroupId: 'av' }), kind: 'audio' as const }
    const boundary = f(137)
    const result = splitTimelineClipsAt([track('v1', [video]), { ...track('a1', [audio]), kind: 'audio' }], boundary, ['video', 'audio'])
    expect(result.rightClipIds).toHaveLength(2)
    for (const lane of result.tracks) {
      const [left, right] = lane.clips
      expectFrame(left.start, 10, fps)
      expectFrame(left.duration, 127, fps)
      expectFrame(right.start, 137, fps)
      expectFrame(right.duration, 113, fps)
      expect(clipSourceTime(left, left.start + left.duration)).toBeCloseTo(clipSourceTime(right, right.start), 8)
    }
  })

  it('keeps roll, slip, slide, and rate-stretch boundaries on the requested frame', () => {
    const base = [
      clip('previous', 'v1', f(0), f(100), f(50)),
      clip('target', 'v1', f(100), f(100), f(200)),
      clip('next', 'v1', f(200), f(100), f(400)),
    ]
    const sourceDurations = new Map(base.map((item) => [item.id, f(1_000)]))

    const rolled = trimTimelineClipAdvancedResult([track('v1', base)], 'target', 'start', f(107), 'roll', sourceDurations)
    expect(rolled.changed).toBe(true)
    const [rollPrevious, rollTarget] = rolled.tracks[0].clips
    expectFrame(rollPrevious.start + rollPrevious.duration, 107, fps)
    expectFrame(rollTarget.start, 107, fps)

    const slipped = trimTimelineClipAdvancedResult([track('v1', base)], 'target', 'start', f(105), 'slip', sourceDurations)
    const slipTarget = slipped.tracks[0].clips.find((item) => item.id === 'target')!
    expectFrame(slipTarget.start, 100, fps)
    expectFrame(slipTarget.duration, 100, fps)
    expectFrame(slipTarget.sourceOffset, 205, fps)

    const slid = trimTimelineClipAdvancedResult([track('v1', base)], 'target', 'start', f(105), 'slide', sourceDurations)
    const [slidePrevious, slideTarget, slideNext] = slid.tracks[0].clips
    expectFrame(slidePrevious.start + slidePrevious.duration, 105, fps)
    expectFrame(slideTarget.start, 105, fps)
    expectFrame(slideTarget.start + slideTarget.duration, 205, fps)
    expectFrame(slideNext.start, 205, fps)
    expectFrame(slideNext.start + slideNext.duration, 300, fps)

    const stretched = trimTimelineClipAdvancedResult([track('v1', [base[1]])], 'target', 'end', f(212), 'rate-stretch', sourceDurations)
    const stretchTarget = stretched.tracks[0].clips[0]
    expectFrame(stretchTarget.start + stretchTarget.duration, 212, fps)
    expect(clipSourceTime(stretchTarget, stretchTarget.start + stretchTarget.duration) - clipSourceTime(stretchTarget, stretchTarget.start)).toBeCloseTo(f(100), 8)
  })

  it('preserves the frame grid through a compound ripple deletion', () => {
    const tracks = [track('v1', [clip('long', 'v1', f(0), f(300), f(20)), clip('tail', 'v1', f(320), f(40), f(500))])]
    const result = removeTimelineRange(tracks, f(90), f(135))[0].clips
    expect(result).toHaveLength(3)
    expectFrame(result[0].duration, 90, fps)
    expectFrame(result[1].start, 90, fps)
    expectFrame(result[1].duration, 165, fps)
    expectFrame(result[2].start, 275, fps)
    expectFrame(result[1].sourceOffset, 155, fps)
  })

  it('inverts nested variable-speed time within the same output frame', () => {
    const parent = clip('nested', 'v1', f(50), f(240), f(20), {
      assetId: undefined,
      nestedSequenceId: 'inside',
      speedKeyframes: [
        { id: 's1', time: f(80), rate: 0.75, easing: 'ease-in-out' },
        { id: 's2', time: f(160), rate: 1.5, easing: 'bezier', curve: { x1: 0.3, y1: 0.1, x2: 0.7, y2: 0.9 } },
        { id: 's3', time: f(240), rate: 1, easing: 'linear' },
      ],
    })
    for (const frame of [50, 51, 97, 137, 211, 289, 290]) {
      const output = f(frame)
      const restored = nestedOutputTime(parent, clipSourceTime(parent, output))
      expect(frameIndexAtTime(restored, fps)).toBe(frame)
    }
  })
})

describe('atomic undo and redo', () => {
  it('restores an exact compound edit snapshot and clears redo after a new commit', () => {
    const initial = { tracks: ['a'], transcript: ['one'], markerFrame: 10 }
    const edited = { tracks: ['a', 'b'], transcript: ['two'], markerFrame: 25 }
    const newer = { tracks: ['c'], transcript: ['three'], markerFrame: 40 }
    const past = appendHistorySnapshot([], initial)
    const undone = undoHistorySnapshot(past, edited, [])!
    expect(undone.value).toBe(initial)
    expect(undone.future).toEqual([edited])
    const redone = redoHistorySnapshot(undone.past, undone.value, undone.future)!
    expect(redone.value).toBe(edited)
    expect(redone.past).toEqual([initial])
    expect(appendHistorySnapshot(redone.past, redone.value)).toEqual([initial, edited])
    expect(newer).not.toEqual(redone.value)
  })
})
