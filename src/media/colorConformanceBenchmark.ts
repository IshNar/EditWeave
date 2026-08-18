import { encodedBt2020ToYcbcr, limited10Luma, scopeLuma8, sdrCanvasToHdrSignal } from './colorConformance'

interface ExpectedPatch {
  pq: [number, number, number]
  hlg: [number, number, number]
  limitedLuma: number
  scopeLuma: number
}

export interface ColorConformanceBenchmark {
  version: 'editweave-color-hdr-v1'
  provenance: 'synthetic-reference' | 'measured-lab'
  standards: string[]
  tolerance: { signal: number; scope: number; codeValue: number }
  cases: Array<{ id: string; srgb: [number, number, number]; expected: ExpectedPatch }>
}

export interface ColorConformanceResult {
  cases: number
  passed: number
  failed: Array<{ id: string; field: string; error: number; tolerance: number }>
  maxSignalError: number
  maxScopeError: number
  maxCodeValueError: number
}

export function parseColorConformanceBenchmark(value: unknown): ColorConformanceBenchmark {
  const candidate = value as Partial<ColorConformanceBenchmark>
  if (candidate.version !== 'editweave-color-hdr-v1' || !['synthetic-reference', 'measured-lab'].includes(candidate.provenance ?? '') || !Array.isArray(candidate.standards) || !Array.isArray(candidate.cases)) {
    throw new Error('지원되는 색상·HDR 기준셋 형식이 아닙니다.')
  }
  const tolerance = candidate.tolerance
  if (!tolerance || ![tolerance.signal, tolerance.scope, tolerance.codeValue].every((item) => Number.isFinite(item) && item >= 0)) throw new Error('색상·HDR 기준셋 허용 오차가 올바르지 않습니다.')
  for (const item of candidate.cases) {
    const values = [...(item.srgb ?? []), ...(item.expected?.pq ?? []), ...(item.expected?.hlg ?? []), item.expected?.limitedLuma, item.expected?.scopeLuma]
    if (!item.id || item.srgb?.length !== 3 || item.expected?.pq?.length !== 3 || item.expected?.hlg?.length !== 3 || !values.every(Number.isFinite)) throw new Error('색상·HDR 기준 패치 값이 올바르지 않습니다.')
    if (item.srgb.some((channel) => channel < 0 || channel > 1)) throw new Error('sRGB 기준 패치는 0~1 범위여야 합니다.')
  }
  return candidate as ColorConformanceBenchmark
}

export function evaluateColorConformanceBenchmark(benchmark: ColorConformanceBenchmark): ColorConformanceResult {
  const failed: ColorConformanceResult['failed'] = []
  let maxSignalError = 0
  let maxScopeError = 0
  let maxCodeValueError = 0
  for (const item of benchmark.cases) {
    const pq = sdrCanvasToHdrSignal(item.srgb, 'pq')
    const hlg = sdrCanvasToHdrSignal(item.srgb, 'hlg')
    const limitedLuma = limited10Luma(encodedBt2020ToYcbcr(pq).y)
    const scopeLuma = scopeLuma8(item.srgb[0] * 255, item.srgb[1] * 255, item.srgb[2] * 255)
    for (const [transfer, actual, expected] of [['pq', pq, item.expected.pq], ['hlg', hlg, item.expected.hlg]] as const) {
      actual.forEach((value, channel) => {
        const error = Math.abs(value - expected[channel])
        maxSignalError = Math.max(maxSignalError, error)
        if (error > benchmark.tolerance.signal) failed.push({ id: item.id, field: `${transfer}[${channel}]`, error, tolerance: benchmark.tolerance.signal })
      })
    }
    const codeError = Math.abs(limitedLuma - item.expected.limitedLuma)
    maxCodeValueError = Math.max(maxCodeValueError, codeError)
    if (codeError > benchmark.tolerance.codeValue) failed.push({ id: item.id, field: 'limitedLuma', error: codeError, tolerance: benchmark.tolerance.codeValue })
    const scopeError = Math.abs(scopeLuma - item.expected.scopeLuma)
    maxScopeError = Math.max(maxScopeError, scopeError)
    if (scopeError > benchmark.tolerance.scope) failed.push({ id: item.id, field: 'scopeLuma', error: scopeError, tolerance: benchmark.tolerance.scope })
  }
  const failedIds = new Set(failed.map((item) => item.id))
  return { cases: benchmark.cases.length, passed: benchmark.cases.length - failedIds.size, failed, maxSignalError, maxScopeError, maxCodeValueError }
}
