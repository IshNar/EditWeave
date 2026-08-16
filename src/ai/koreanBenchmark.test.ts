import { describe, expect, it } from 'vitest'
import syntheticBenchmark from '../../benchmarks/korean-rough-cut.synthetic.json'
import { evaluateKoreanRoughCutBenchmark, koreanCharacterErrorRate, koreanWordErrorRate, parseKoreanRoughCutBenchmark } from './koreanBenchmark'
import { transcriptionModelForQuality } from './transcribe'

describe('Korean rough-cut benchmark', () => {
  it('meets the synthetic cleanup quality floor without treating semantic 약간 as filler', () => {
    const result = evaluateKoreanRoughCutBenchmark(parseKoreanRoughCutBenchmark(syntheticBenchmark))
    expect(result.cases).toBe(7)
    expect(result.cleanupPrecision).toBeGreaterThanOrEqual(0.9)
    expect(result.cleanupRecall).toBeGreaterThanOrEqual(0.9)
    expect(result.cleanupMacroF1).toBeGreaterThanOrEqual(0.9)
    expect(result.metrics.filler.meanTemporalIou).toBeGreaterThanOrEqual(0.9)
  })

  it('computes normalized Korean CER and spacing-sensitive WER', () => {
    expect(koreanCharacterErrorRate('안녕하세요!', '안녕 하세요')).toBe(0)
    expect(koreanCharacterErrorRate('카메라 노출', '카메라 노츨')).toBeCloseTo(1 / 5, 8)
    expect(koreanWordErrorRate('카메라 노출을 맞춥니다', '카메라 노출 맞춥니다')).toBeCloseTo(1 / 3, 8)
  })

  it('rejects a malformed benchmark before evaluation', () => {
    expect(() => parseKoreanRoughCutBenchmark({ version: 'bad', cases: [] })).toThrow(/지원되는/)
  })

  it('offers explicit local transcription quality tiers', () => {
    expect(transcriptionModelForQuality('fast')).toContain('whisper-tiny')
    expect(transcriptionModelForQuality('balanced')).toContain('whisper-base')
    expect(transcriptionModelForQuality('accurate')).toContain('whisper-small')
  })
})
