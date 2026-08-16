import { describe, expect, it } from 'vitest'
import { parseSubtitleFile, transcriptToSrt } from './subtitles'

describe('subtitle conversion', () => {
  it('parses Korean SRT and exports stable timestamps without mutating input order', () => {
    const segments = parseSubtitleFile('2\n00:00:02,500 --> 00:00:03,250\n두 번째\n\n1\n00:00:00,000 --> 00:00:01,125\n첫 번째')
    expect(segments.map((segment) => segment.text)).toEqual(['첫 번째', '두 번째'])
    const original = [...segments]
    const srt = transcriptToSrt(segments)
    expect(srt).toContain('00:00:00,000 --> 00:00:01,125')
    expect(segments).toEqual(original)
  })

  it('accepts WebVTT cues and strips inline tags', () => {
    const segments = parseSubtitleFile('WEBVTT\n\n00:00.000 --> 00:01.200\n<b>안녕하세요</b>')
    expect(segments[0]).toMatchObject({ start: 0, end: 1.2, text: '안녕하세요' })
  })
})
