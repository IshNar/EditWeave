import { describe, expect, it } from 'vitest'
import benchmarkFixture from '../../benchmarks/shorts-multimodal.synthetic.json'
import { evaluateMultimodalShortsBenchmark, parseMultimodalShortsBenchmark } from './multimodalBenchmark'

describe('multimodal shorts benchmark', () => {
  it('selects the evidenced hook instead of a lexical decoy for every delivery length', () => {
    const result = evaluateMultimodalShortsBenchmark(parseMultimodalShortsBenchmark(benchmarkFixture))
    expect(result.cases).toBe(1)
    expect(result.candidates).toBe(3)
    expect(result.hookHitRate).toBe(1)
    expect(result.excludedHookAvoidance).toBe(1)
    expect(result.multimodalEvidenceRate).toBe(1)
    expect(result.meanScore).toBeGreaterThan(0.7)
  })

  it('rejects malformed benchmark ranges', () => {
    expect(() => parseMultimodalShortsBenchmark({ version: 'editweave-shorts-multimodal-v1', provenance: 'synthetic', cases: [{ id: 'bad', duration: 10, transcript: [], suggestions: [], markers: [], waveform: [], faceTrack: [], expectedHookRange: { start: 2, end: 1 } }] })).toThrow(/정답 범위/)
  })
})
