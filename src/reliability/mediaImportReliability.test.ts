import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analyzeMediaFile } from '../media/analyze'

let fixtureDirectory = ''
let movPath = ''
let vfrPath = ''

function runFfmpeg(args: string[]): void {
  if (!ffmpegPath) throw new Error('release reliability fixture generation requires ffmpeg-static')
  execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' })
}

async function fileFromPath(path: string, name: string, type: string): Promise<File> {
  const bytes = await readFile(path)
  return new File([new Uint8Array(bytes)], name, { type })
}

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), 'editweave-e1-media-'))
  movPath = join(fixtureDirectory, 'h264-aac.mov')
  vfrPath = join(fixtureDirectory, 'smartphone-vfr.mp4')
  runFfmpeg([
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24:duration=1.2',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=1.2',
    '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', movPath,
  ])
  runFfmpeg([
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15:duration=0.8',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=0.8',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-fps_mode', 'vfr',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', vfrPath,
  ])
}, 30_000)

afterAll(async () => {
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true })
})

describe('release reliability generated media import', () => {
  it('analyzes a real H.264/AAC MOV container without relying on its extension alone', async () => {
    const analysis = await analyzeMediaFile(await fileFromPath(movPath, 'h264-aac.mov', 'video/quicktime'), '', 'video', { includeWaveform: false, includeFaceTrack: false })
    expect(analysis).toMatchObject({ width: 320, height: 180, videoCodec: 'avc', audioCodec: 'aac', sampleRate: 48_000, channels: 1, variableFrameRate: false })
    expect(analysis.duration).toBeCloseTo(1.2, 1)
    expect(analysis.frameRate).toBeCloseTo(24, 0)
  })

  it('detects mixed packet durations in a generated smartphone-like VFR MP4', async () => {
    const analysis = await analyzeMediaFile(await fileFromPath(vfrPath, 'smartphone-vfr.mp4', 'video/mp4'), '', 'video', { includeWaveform: false, includeFaceTrack: false })
    expect(analysis).toMatchObject({ width: 320, height: 180, videoCodec: 'avc', variableFrameRate: true })
    expect(analysis.frameRateVariation).toBeGreaterThan(0.25)
  })
})
