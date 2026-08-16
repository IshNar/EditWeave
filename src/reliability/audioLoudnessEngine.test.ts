import { spawnSync } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'
import { describe, expect, it } from 'vitest'

function summaryValue(report: string, label: string, unit: string): number {
  const summary = report.slice(report.lastIndexOf('Summary:'))
  const match = new RegExp(`^\\s*${label}\\s*([-+]?\\d+(?:\\.\\d+)?)\\s*${unit}\\s*$`, 'm').exec(summary)
  if (!match) throw new Error(`FFmpeg EBU R128 Summary에서 ${label} 값을 찾지 못했습니다.`)
  return Number(match[1])
}

describe('bundled EBU R128 loudness engine', () => {
  it('measures a deterministic 48kHz reference tone in LUFS and true-peak mode', () => {
    if (!ffmpegPath) throw new Error('E8 loudness conformance requires ffmpeg-static')
    const output = spawnSync(ffmpegPath, [
      '-hide_banner', '-nostats', '-f', 'lavfi', '-i', 'sine=frequency=997:sample_rate=48000:duration=5',
      '-af', 'ebur128=peak=true', '-f', 'null', '-',
    ], { encoding: 'utf8' })
    expect(output.status).toBe(0)
    const integratedLufs = summaryValue(output.stderr, 'I:', 'LUFS')
    const truePeakDbtp = summaryValue(output.stderr, 'Peak:', 'dBFS')
    expect(integratedLufs).toBeCloseTo(-21.1, 1)
    expect(truePeakDbtp).toBeCloseTo(-18.1, 1)
    expect(output.stderr.slice(output.stderr.lastIndexOf('Summary:'))).toContain('True peak:')
  }, 15_000)
})
