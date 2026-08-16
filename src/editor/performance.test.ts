import { describe, expect, it } from 'vitest'
import { assessTimelinePerformance } from './performance'
import { removeTimelineRange } from './timelineOps'
import type { TimelineClip, TimelineTrack, TrackKind } from './types'

const transform = { positionX: 0, positionY: 0, scale: 100, rotation: 0, opacity: 100 }

function buildLongProject(minutes: number): TimelineTrack[] {
  const seconds = minutes * 60
  const makeClips = (trackId: string, kind: TrackKind, duration = 1): TimelineClip[] => Array.from({ length: Math.ceil(seconds / duration) }, (_, index) => ({
    id: `${trackId}-${index}`,
    trackId,
    assetId: kind === 'caption' ? undefined : 'asset',
    name: `${kind}-${index}`,
    start: index * duration,
    duration,
    sourceOffset: index * duration,
    kind,
    color: '#777',
    transform,
  }))
  return [
    { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false, clips: makeClips('v1', 'video', 2) },
    { id: 'a1', name: 'A1', kind: 'audio', muted: false, locked: false, clips: makeClips('a1', 'audio', 2) },
    { id: 't1', name: 'T1', kind: 'caption', muted: false, locked: false, clips: makeClips('t1', 'caption', 1) },
  ]
}

describe('long timeline performance baseline', () => {
  it.each([10, 30, 60])('%d minute project ripples and serializes within the Beta budget', (minutes) => {
    const tracks = buildLongProject(minutes)
    const started = performance.now()
    const edited = removeTimelineRange(tracks, minutes * 30, minutes * 30 + 1.25)
    const serialized = JSON.stringify(edited)
    const elapsed = performance.now() - started
    console.info(`TIMELINE_BENCHMARK ${minutes}m clips=${tracks.flatMap((track) => track.clips).length} elapsed=${elapsed.toFixed(2)}ms bytes=${serialized.length}`)
    expect(elapsed).toBeLessThan(1000)
    expect(serialized.length).toBeGreaterThan(1000)
  })

  it('classifies a 60-minute dense timeline as heavy', () => {
    expect(assessTimelinePerformance(buildLongProject(60))).toMatchObject({ level: 'heavy', duration: 3600, clipCount: 7200 })
  })
})
