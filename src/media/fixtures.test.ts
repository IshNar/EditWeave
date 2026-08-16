import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'

const fixtures = [
  { name: 'flower.mp4', duration: 5.056, videoCodec: 'avc', audioCodec: 'aac', width: 960, height: 540, sampleRate: 48000, channels: 2 },
  { name: 't-rex-roar.mp3', duration: 2.1159, videoCodec: undefined, audioCodec: 'mp3', width: undefined, height: undefined, sampleRate: 44100, channels: 2 },
]

describe('bundled media compatibility fixtures', () => {
  it.each(fixtures)('reads $name with stable stream metadata', async (fixture) => {
    const bytes = await readFile(new URL(`../../test-assets/${fixture.name}`, import.meta.url))
    const input = new Input({ source: new BlobSource(new Blob([new Uint8Array(bytes)])), formats: ALL_FORMATS })
    const [duration, video, audio] = await Promise.all([input.computeDuration(), input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()])
    expect(duration).toBeCloseTo(fixture.duration, 2)
    expect(video ? await video.getCodec() : undefined).toBe(fixture.videoCodec)
    expect(video ? await video.getDisplayWidth() : undefined).toBe(fixture.width)
    expect(video ? await video.getDisplayHeight() : undefined).toBe(fixture.height)
    expect(audio ? await audio.getCodec() : undefined).toBe(fixture.audioCodec)
    expect(audio ? await audio.getSampleRate() : undefined).toBe(fixture.sampleRate)
    expect(audio ? await audio.getNumberOfChannels() : undefined).toBe(fixture.channels)
  })
})
