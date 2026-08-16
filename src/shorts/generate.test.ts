import { describe, expect, it } from 'vitest'
import type { MediaAsset, TimelineTrack, TranscriptSegment } from '../editor/types'
import { createDerivedShortsSequence, generateShortsCandidates } from './generate'

const transform = { positionX: 30, positionY: 10, scale: 100, rotation: 0, opacity: 100 }
const tracks: TimelineTrack[] = [{
  id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false,
  clips: [{ id: 'c1', trackId: 'v1', assetId: 'asset', name: 'wide', start: 5, duration: 20, sourceOffset: 2, kind: 'video', color: '#555', transform }],
}]
const transcript: TranscriptSegment[] = [{ id: 't1', start: 7, end: 9, text: '가장 중요한 결과를 바로 공개합니다!' }]
const assets: MediaAsset[] = [{
  id: 'asset', name: 'wide.mp4', kind: 'video', url: 'blob:test', duration: 30, size: 1, extension: 'mp4', width: 1920, height: 1080, status: 'ready',
}]

describe('shorts derivation', () => {
  it('creates 15/30/60 second candidate choices', () => {
    expect(generateShortsCandidates(transcript, tracks).map((item) => item.targetDuration)).toEqual([15, 30, 60])
  })

  it('trims to source range and applies vertical cover reframing', () => {
    const candidate = { ...generateShortsCandidates(transcript, tracks)[0], start: 6, end: 16 }
    const sequence = createDerivedShortsSequence({ sourceSequenceId: 'main', candidate, tracks, transcript, suggestions: [], assets })
    const derived = sequence.tracks[0].clips[0]
    expect(sequence.aspectRatio).toBe('9:16')
    expect(derived).toMatchObject({ start: 0, duration: 10, sourceOffset: 3 })
    expect(derived.transform.scale).toBeGreaterThanOrEqual(300)
    expect(derived.transform.positionX).toBe(0)
    expect(derived).toMatchObject({ sourceClipId: 'c1', sourceTrackId: 'v1' })
  })

  it('carries range markers into derived timeline coordinates', () => {
    const candidate = { ...generateShortsCandidates(transcript, tracks)[0], start: 6, end: 16 }
    const sequence = createDerivedShortsSequence({
      sourceSequenceId: 'main', candidate, tracks, transcript, suggestions: [], assets,
      markers: [
        { id: 'before', time: 2, label: '이전', color: '#fff', kind: 'edit' },
        { id: 'inside', time: 9, duration: 2, label: '핵심', color: '#fff', kind: 'chapter' },
      ],
    })
    expect(sequence.markers).toHaveLength(1)
    expect(sequence.markers?.[0]).toMatchObject({ time: 3, duration: 2, label: '핵심' })
  })

  it('uses only the selected source range for face reframing', () => {
    const rangedAsset: MediaAsset = { ...assets[0], faceTrack: [
      { time: 2, x: 0.1, y: 0.5, confidence: 0.95 },
      { time: 12, x: 0.82, y: 0.5, confidence: 0.95 },
      { time: 14, x: 0.8, y: 0.5, confidence: 0.9 },
    ] }
    const candidate = { ...generateShortsCandidates(transcript, tracks)[0], start: 14, end: 20 }
    const sequence = createDerivedShortsSequence({ sourceSequenceId: 'main', candidate, tracks, transcript, suggestions: [], assets: [rangedAsset] })
    expect(sequence.tracks[0].clips[0].transform.positionX).toBeLessThan(-250)
  })
})
