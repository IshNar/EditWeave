import { describe, expect, it } from 'vitest'
import type { TimelineClip, TimelineTrack } from './types'
import { removeTimelineRange, removeTranscriptRange } from './timelineOps'

const clip: TimelineClip = {
  id: 'clip', trackId: 'v1', name: 'source', start: 0, duration: 10, sourceOffset: 5,
  kind: 'video', color: '#000', transform: { positionX: 0, positionY: 0, scale: 100, rotation: 0, opacity: 100 },
}
const tracks: TimelineTrack[] = [{ id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false, clips: [clip] }]

describe('ripple range removal', () => {
  it('splits a clip and keeps source offsets aligned', () => {
    const result = removeTimelineRange(tracks, 3, 6)[0].clips
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ start: 0, duration: 3, sourceOffset: 5 })
    expect(result[1]).toMatchObject({ start: 3, duration: 4, sourceOffset: 11 })
  })

  it('shifts following transcript segments', () => {
    const result = removeTranscriptRange([
      { id: 'a', start: 0, end: 1, text: '앞' },
      { id: 'b', start: 4, end: 5, text: '뒤' },
    ], 1, 3)
    expect(result[1]).toMatchObject({ start: 2, end: 3 })
  })
})
