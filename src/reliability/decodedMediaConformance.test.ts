import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evaluateDecodedMediaConformance, float32PcmFromBytes, splitRgbFrames } from './decodedMediaConformance'

const width = 160
const height = 90
const fps = 30
const sampleRate = 48_000
let fixtureDirectory = ''
let referenceFrames: ReturnType<typeof splitRgbFrames> = []
let candidateFrames: ReturnType<typeof splitRgbFrames> = []
let referencePcm: Float32Array<ArrayBufferLike> = new Float32Array()
let candidatePcm: Float32Array<ArrayBufferLike> = new Float32Array()

function runFfmpeg(args: string[]): void {
  if (!ffmpegPath) throw new Error('decoded media conformance requires ffmpeg-static')
  execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' })
}

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), 'cutline-preview-output-'))
  const referencePath = join(fixtureDirectory, 'reference.mkv')
  const candidatePath = join(fixtureDirectory, 'candidate.mp4')
  const referenceRgbPath = join(fixtureDirectory, 'reference.rgb')
  const candidateRgbPath = join(fixtureDirectory, 'candidate.rgb')
  const referencePcmPath = join(fixtureDirectory, 'reference.f32')
  const candidatePcmPath = join(fixtureDirectory, 'candidate.f32')
  runFfmpeg([
    '-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=${fps}:duration=2`,
    '-f', 'lavfi', '-i', `anoisesrc=color=white:amplitude=0.15:sample_rate=${sampleRate}:duration=2:seed=42`,
    '-shortest', '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', referencePath,
  ])
  runFfmpeg(['-i', referencePath, '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', candidatePath])
  runFfmpeg(['-i', referencePath, '-map', '0:v:0', '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', referenceRgbPath])
  runFfmpeg(['-i', candidatePath, '-map', '0:v:0', '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', candidateRgbPath])
  runFfmpeg(['-i', referencePath, '-map', '0:a:0', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', referencePcmPath])
  runFfmpeg(['-i', candidatePath, '-map', '0:a:0', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', candidatePcmPath])
  referenceFrames = splitRgbFrames(await readFile(referenceRgbPath), width, height)
  candidateFrames = splitRgbFrames(await readFile(candidateRgbPath), width, height)
  referencePcm = float32PcmFromBytes(await readFile(referencePcmPath))
  candidatePcm = float32PcmFromBytes(await readFile(candidatePcmPath))
}, 30_000)

afterAll(async () => {
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true })
})

describe('decoded preview and delivery artifact conformance', () => {
  it('measures a real FFV1/PCM reference against H.264/AAC after decoding', () => {
    const result = evaluateDecodedMediaConformance({
      referenceFrames,
      candidateFrames,
      referencePcm,
      candidatePcm,
      sampleRate,
      lagSearchSamples: 512,
      thresholds: { minimumStructuralSimilarity: 0.97, minimumPsnrDb: 31, maximumMeanAbsoluteError: 6, minimumPcmCorrelation: 0.97, maximumPcmRmse: 0.03, maximumAudioLagSamples: 48 },
    })
    expect(result.issues).toEqual([])
    expect(result.passed).toBe(true)
    expect(result.video.frameCount).toBe(60)
    expect(result.audio.comparedSamples).toBeGreaterThanOrEqual(sampleRate * 1.95)
  })

  it('rejects a one-frame picture displacement', () => {
    const shifted = [...candidateFrames.slice(1), candidateFrames[candidateFrames.length - 1]]
    const result = evaluateDecodedMediaConformance({ referenceFrames, candidateFrames: shifted, referencePcm, candidatePcm, sampleRate, lagSearchSamples: 512 })
    expect(result.passed).toBe(false)
    expect(result.issues.some((issue) => issue.startsWith('영상 SSIM') || issue.startsWith('영상 PSNR') || issue.startsWith('영상 평균 절대 오차'))).toBe(true)
  })

  it('detects PCM delay beyond the delivery tolerance', () => {
    const delay = 240
    const delayed = new Float32Array(candidatePcm.length + delay)
    delayed.set(candidatePcm, delay)
    const result = evaluateDecodedMediaConformance({ referenceFrames, candidateFrames, referencePcm, candidatePcm: delayed, sampleRate, lagSearchSamples: 512 })
    expect(result.audio.lagSamples).toBe(delay)
    expect(result.issues).toContain('오디오 지연 240샘플 > ±48샘플')
    expect(result.passed).toBe(false)
  })

  it('rejects invalid raw RGB and PCM payload boundaries', () => {
    expect(() => splitRgbFrames(new Uint8Array(10), 2, 2)).toThrow('배수가 아닙니다')
    expect(() => float32PcmFromBytes(new Uint8Array(3))).toThrow('4의 배수')
  })
})
