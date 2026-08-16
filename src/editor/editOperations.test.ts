import { describe, expect, it } from 'vitest'
import { rippleDeleteMarkers, rippleDeleteSuggestions, rippleDeleteTranscript } from './rippleDelete'
import { rippleInsertMarkers, rippleInsertSuggestions, rippleInsertTranscript } from './rippleInsert'
import { clipEndTrimDeltaRange, clipSlipDeltaRange, clipSourceTrimHandles, clipStartTrimDeltaRange, createClipSourceDurationMap } from './trimConstraints'
import { normalizeSourceTargets, repairSourceTargetAfterRemoval, resolveSourceTargetTrack, toggleSourceTarget } from './trackTargeting'
import type { EditSuggestion, MediaAsset, ProjectSequence, TimelineClip, TimelineMarker, TimelineTrack, TranscriptSegment } from './types'

const transform = { positionX: 0, positionY: 0, scale: 100, rotation: 0, opacity: 100 }

function clip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-1', trackId: 'v1', assetId: 'asset-1', name: 'source', start: 2, duration: 4,
    sourceOffset: 2, kind: 'video', color: '#000', transform, ...overrides,
  }
}

function track(id: string, kind: TimelineTrack['kind'], overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return { id, name: id, kind, muted: false, locked: false, clips: [], ...overrides }
}

describe('source track targeting', () => {
  it('keeps exactly one target per kind and preserves an explicit disabled kind', () => {
    const normalized = normalizeSourceTargets([
      track('v1', 'video', { sourceTarget: true }),
      track('v2', 'video', { sourceTarget: true }),
      track('a1', 'audio', { sourceTarget: false }),
      track('a2', 'audio'),
    ])

    expect(normalized.filter((item) => item.kind === 'video').map((item) => item.sourceTarget)).toEqual([true, false])
    expect(resolveSourceTargetTrack(normalized, 'audio')).toBeUndefined()
  })

  it('moves the target on toggle and repairs it after target removal', () => {
    const initial = [track('v1', 'video', { sourceTarget: true }), track('v2', 'video')]
    const moved = toggleSourceTarget(initial, 'v2')
    expect(resolveSourceTargetTrack(moved, 'video')?.id).toBe('v2')

    const remaining = repairSourceTargetAfterRemoval([track('v1', 'video')], moved[1])
    expect(remaining[0].sourceTarget).toBe(true)
  })
})

describe('ripple metadata synchronization', () => {
  const markers: TimelineMarker[] = [
    { id: 'chapter', time: 1, label: 'A', color: '#fff', kind: 'chapter' },
    { id: 'comment', time: 4, label: 'B', color: '#fff', kind: 'comment', updatedAt: 'old' },
  ]
  const transcript: TranscriptSegment[] = [{
    id: 'line', start: 1, end: 5, text: 'hello world!', words: [
      { start: 1, end: 2, text: 'hello' },
      { start: 3, end: 4, text: 'world' },
      { start: 4, end: 5, text: '!' },
    ],
  }]
  const suggestions: EditSuggestion[] = [{
    id: 'suggestion', type: 'silence', start: 3, end: 5, label: 'gap', reason: 'quiet', score: 1, status: 'pending',
  }]

  it('inserts time into markers, transcript words, and suggestions', () => {
    expect(rippleInsertMarkers(markers, 3, 2, 'new')).toMatchObject([
      { time: 1 }, { time: 6, updatedAt: 'new' },
    ])
    expect(rippleInsertTranscript(transcript, 3, 2)[0]).toMatchObject({
      start: 1, end: 7, words: [{ start: 1, end: 2 }, { start: 5, end: 6 }, { start: 6, end: 7 }],
    })
    expect(rippleInsertSuggestions(suggestions, 4, 1)[0]).toMatchObject({ start: 3, end: 6 })
  })

  it('deletes time and rebuilds transcript text without broken punctuation', () => {
    expect(rippleDeleteMarkers(markers, 2, 4, 'new')).toEqual([
      markers[0],
      { ...markers[1], time: 2, updatedAt: 'new' },
    ])
    expect(rippleDeleteTranscript(transcript, 2, 4)[0]).toMatchObject({
      start: 1, end: 3, text: 'hello!', words: [{ text: 'hello' }, { start: 2, end: 3, text: '!' }],
    })
    expect(rippleDeleteSuggestions(suggestions, 2, 4)[0]).toMatchObject({ start: 2, end: 3, status: 'dismissed' })
  })
})

describe('source-bound trim constraints', () => {
  const sourceClip = clip()
  const sourceDurations = new Map([[sourceClip.id, 10]])

  it('limits outward trims and slips to real source handles', () => {
    expect(clipSourceTrimHandles(sourceClip, sourceDurations)).toMatchObject({ beforeSource: 2, afterSource: 4, startOutward: 2, endOutward: 4 })
    expect(clipStartTrimDeltaRange(sourceClip, sourceDurations)).toEqual({ minimum: -2, maximum: 3.95 })
    expect(clipEndTrimDeltaRange(sourceClip, sourceDurations)).toEqual({ minimum: -3.95, maximum: 4 })
    expect(clipSlipDeltaRange(sourceClip, 'start', sourceDurations)).toEqual({ minimum: -2, maximum: 4, factor: 1 })
  })

  it('swaps source handles and slip direction for reverse playback', () => {
    const reversed = clip({ reverse: true })
    expect(clipSourceTrimHandles(reversed, sourceDurations)).toMatchObject({ startOutward: 4, endOutward: 2 })
    expect(clipSlipDeltaRange(reversed, 'end', sourceDurations)).toEqual({ minimum: -4, maximum: 2, factor: -1 })
  })

  it('derives finite nested duration and unlimited image duration', () => {
    const imageClip = clip({ id: 'image', assetId: 'image-asset' })
    const nestedClip = clip({ id: 'nested', assetId: undefined, nestedSequenceId: 'nested-sequence' })
    const assets: MediaAsset[] = [{
      id: 'image-asset', name: 'still.png', kind: 'image', url: 'blob:image', duration: 5, size: 1,
      extension: 'png', status: 'ready',
    }]
    const sequences: ProjectSequence[] = [{
      id: 'nested-sequence', name: 'Nested', kind: 'nested', aspectRatio: '16:9', width: 1920, height: 1080,
      fps: 30, tracks: [track('nested-v1', 'video', { clips: [clip({ trackId: 'nested-v1', start: 1, duration: 5 })] })],
      transcript: [], suggestions: [], createdAt: '2026-08-09T00:00:00.000Z',
    }]

    const durations = createClipSourceDurationMap([track('v1', 'video', { clips: [imageClip, nestedClip] })], assets, sequences)
    expect(durations.get('image')).toBe(Number.POSITIVE_INFINITY)
    expect(durations.get('nested')).toBe(6)
  })
})
