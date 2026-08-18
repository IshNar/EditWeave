import { describe, expect, it } from 'vitest'
import benchmarkFixture from '../../benchmarks/color-hdr-conformance.synthetic.json'
import {
  HLG_SDR_WHITE_SCENE,
  encodedBt2020ToYcbcr,
  hlgDecodeScene,
  hlgEncodeScene,
  limited10Chroma,
  limited10Luma,
  measureNeutralPatch,
  pqDecodeNits,
  pqEncodeNits,
  rec709LinearToRec2020,
  scopeChroma8,
  scopeLuma8,
  sdrCanvasToHdrSignal,
  srgbToLinear,
} from './colorConformance'
import { evaluateColorConformanceBenchmark, parseColorConformanceBenchmark } from './colorConformanceBenchmark'

describe('color and HDR numerical conformance', () => {
  it('passes the versioned SDR, PQ, HLG, scope, and 10-bit patch benchmark', () => {
    const result = evaluateColorConformanceBenchmark(parseColorConformanceBenchmark(benchmarkFixture))
    expect(result).toMatchObject({ cases: 6, passed: 6, failed: [], maxCodeValueError: 0 })
    expect(result.maxSignalError).toBeLessThanOrEqual(0.000001)
    expect(result.maxScopeError).toBeLessThanOrEqual(0.001)
  })

  it('rejects malformed or out-of-gamut benchmark patches', () => {
    expect(() => parseColorConformanceBenchmark({ version: 'old', cases: [] })).toThrow(/형식/)
    expect(() => parseColorConformanceBenchmark({
      version: 'editweave-color-hdr-v1', provenance: 'synthetic-reference', standards: [],
      tolerance: { signal: 0.1, scope: 0.1, codeValue: 0 },
      cases: [{ id: 'bad', srgb: [2, 0, 0], expected: { pq: [0, 0, 0], hlg: [0, 0, 0], limitedLuma: 0, scopeLuma: 0 } }],
    })).toThrow(/0~1/)
  })

  it('matches sRGB and ST 2084 reference anchors within numerical tolerance', () => {
    expect(srgbToLinear(0.04045)).toBeCloseTo(0.0031308, 7)
    expect(srgbToLinear(0.5)).toBeCloseTo(0.21404114, 7)
    expect(pqEncodeNits(100)).toBeCloseTo(0.50807842, 7)
    expect(pqEncodeNits(203)).toBeCloseTo(0.58068888, 7)
    expect(pqEncodeNits(1000)).toBeCloseTo(0.7518271, 7)
    expect(pqDecodeNits(pqEncodeNits(4000))).toBeCloseTo(4000, 3)
  })

  it('maps HLG reference anchors and SDR diffuse white consistently', () => {
    expect(hlgEncodeScene(1 / 12)).toBeCloseTo(0.5, 7)
    expect(hlgEncodeScene(1)).toBeCloseTo(1, 6)
    expect(hlgDecodeScene(0.75)).toBeCloseTo(0.26496256, 6)
    expect(HLG_SDR_WHITE_SCENE).toBeCloseTo(0.26496256, 6)
    expect(sdrCanvasToHdrSignal([1, 1, 1], 'hlg')).toEqual(expect.arrayContaining([expect.closeTo(0.75, 5)]))
  })

  it('preserves neutral white across the Rec.709 to Rec.2020 matrix', () => {
    const white = rec709LinearToRec2020([1, 1, 1])
    expect(white[0]).toBeCloseTo(1, 5)
    expect(white[1]).toBeCloseTo(1, 5)
    expect(white[2]).toBeCloseTo(1, 5)
    const neutral = encodedBt2020ToYcbcr(white)
    expect(neutral.y).toBeCloseTo(1, 5)
    expect(neutral.cb).toBeCloseTo(0, 5)
    expect(neutral.cr).toBeCloseTo(0, 5)
  })

  it('uses legal 10-bit limited-range code values', () => {
    expect([limited10Luma(0), limited10Luma(1)]).toEqual([64, 940])
    expect([limited10Chroma(-0.5), limited10Chroma(0), limited10Chroma(0.5)]).toEqual([64, 512, 960])
  })

  it('shares Rec.709 scope luma and chroma reference calculations', () => {
    expect(scopeLuma8(255, 255, 255)).toBeCloseTo(255, 8)
    expect(scopeLuma8(255, 0, 0)).toBeCloseTo(54.213, 3)
    expect(scopeChroma8(128, 128, 128)).toMatchObject({ cb: expect.closeTo(0, 8), cr: expect.closeTo(0, 8) })
    const patches = [measureNeutralPatch('black', 0), measureNeutralPatch('gray', 0.5), measureNeutralPatch('white', 1)]
    expect(patches[0].scopeLuma).toBeCloseTo(0, 8)
    expect(patches[1].scopeLuma).toBeCloseTo(127.5, 8)
    expect(patches[2].scopeLuma).toBeCloseTo(255, 8)
    expect(patches[2]).toMatchObject({ pqSignal: expect.closeTo(0.58068888, 6), hlgSignal: expect.closeTo(0.75, 5) })
  })
})
