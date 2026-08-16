export interface RgbFrame {
  width: number
  height: number
  data: Uint8Array
}

export interface VideoFrameComparison {
  frameCount: number
  meanAbsoluteError: number
  peakAbsoluteError: number
  psnrDb: number
  structuralSimilarity: number
}

export interface PcmComparison {
  referenceSamples: number
  candidateSamples: number
  comparedSamples: number
  lagSamples: number
  lagMilliseconds: number
  correlation: number
  rootMeanSquareError: number
  peakError: number
}

export interface DecodedMediaThresholds {
  minimumStructuralSimilarity: number
  minimumPsnrDb: number
  maximumMeanAbsoluteError: number
  minimumPcmCorrelation: number
  maximumPcmRmse: number
  maximumAudioLagSamples: number
}

export interface DecodedMediaConformanceResult {
  passed: boolean
  issues: string[]
  video: VideoFrameComparison
  audio: PcmComparison
}

export const defaultDecodedMediaThresholds: DecodedMediaThresholds = {
  minimumStructuralSimilarity: 0.95,
  minimumPsnrDb: 30,
  maximumMeanAbsoluteError: 8,
  minimumPcmCorrelation: 0.97,
  maximumPcmRmse: 0.03,
  maximumAudioLagSamples: 48,
}

export function splitRgbFrames(bytes: Uint8Array, width: number, height: number): RgbFrame[] {
  const frameSize = Math.max(1, Math.floor(width)) * Math.max(1, Math.floor(height)) * 3
  if (bytes.byteLength % frameSize !== 0) throw new Error(`RGB24 바이트 길이 ${bytes.byteLength}가 프레임 크기 ${frameSize}의 배수가 아닙니다.`)
  const frames: RgbFrame[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += frameSize) frames.push({ width, height, data: bytes.subarray(offset, offset + frameSize) })
  return frames
}

export function float32PcmFromBytes(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength % 4 !== 0) throw new Error('PCM f32le 바이트 길이는 4의 배수여야 합니다.')
  const copy = bytes.slice()
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4)
}

export function compareRgbFrameSets(reference: RgbFrame[], candidate: RgbFrame[]): VideoFrameComparison {
  if (!reference.length || !candidate.length) throw new Error('비교할 RGB 프레임이 없습니다.')
  const frameCount = Math.min(reference.length, candidate.length)
  let totalAbsolute = 0
  let totalSquared = 0
  let peakAbsoluteError = 0
  let structuralSimilarity = 0
  let componentCount = 0
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const expected = reference[frameIndex]
    const actual = candidate[frameIndex]
    if (expected.width !== actual.width || expected.height !== actual.height || expected.data.length !== actual.data.length) throw new Error(`RGB 프레임 ${frameIndex}의 크기가 다릅니다.`)
    structuralSimilarity += luminanceSsim(expected.data, actual.data)
    componentCount += expected.data.length
    for (let index = 0; index < expected.data.length; index++) {
      const difference = Math.abs(expected.data[index] - actual.data[index])
      totalAbsolute += difference
      totalSquared += difference * difference
      peakAbsoluteError = Math.max(peakAbsoluteError, difference)
    }
  }
  const mse = totalSquared / Math.max(1, componentCount)
  return {
    frameCount,
    meanAbsoluteError: totalAbsolute / Math.max(1, componentCount),
    peakAbsoluteError,
    psnrDb: mse <= 1e-12 ? Number.POSITIVE_INFINITY : 10 * Math.log10((255 * 255) / mse),
    structuralSimilarity: structuralSimilarity / frameCount,
  }
}

export function comparePcm(reference: Float32Array, candidate: Float32Array, sampleRate: number, maximumLagSamples = 2_048): PcmComparison {
  if (!reference.length || !candidate.length) throw new Error('비교할 PCM 샘플이 없습니다.')
  const lagLimit = Math.max(0, Math.min(Math.floor(maximumLagSamples), reference.length - 1, candidate.length - 1))
  const searchStride = Math.max(1, Math.floor(Math.min(reference.length, candidate.length) / 24_000))
  let bestLag = 0
  let bestCorrelation = Number.NEGATIVE_INFINITY
  for (let lag = -lagLimit; lag <= lagLimit; lag++) {
    const correlation = normalizedCorrelation(reference, candidate, lag, searchStride)
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation
      bestLag = lag
    }
  }
  const referenceStart = Math.max(0, -bestLag)
  const candidateStart = Math.max(0, bestLag)
  const comparedSamples = Math.min(reference.length - referenceStart, candidate.length - candidateStart)
  let squaredError = 0
  let peakError = 0
  for (let index = 0; index < comparedSamples; index++) {
    const error = reference[referenceStart + index] - candidate[candidateStart + index]
    squaredError += error * error
    peakError = Math.max(peakError, Math.abs(error))
  }
  return {
    referenceSamples: reference.length,
    candidateSamples: candidate.length,
    comparedSamples,
    lagSamples: bestLag,
    lagMilliseconds: bestLag / Math.max(1, sampleRate) * 1_000,
    correlation: normalizedCorrelation(reference, candidate, bestLag, 1),
    rootMeanSquareError: Math.sqrt(squaredError / Math.max(1, comparedSamples)),
    peakError,
  }
}

export function evaluateDecodedMediaConformance(options: {
  referenceFrames: RgbFrame[]
  candidateFrames: RgbFrame[]
  referencePcm: Float32Array
  candidatePcm: Float32Array
  sampleRate: number
  thresholds?: Partial<DecodedMediaThresholds>
  lagSearchSamples?: number
}): DecodedMediaConformanceResult {
  const thresholds = { ...defaultDecodedMediaThresholds, ...options.thresholds }
  const video = compareRgbFrameSets(options.referenceFrames, options.candidateFrames)
  const audio = comparePcm(options.referencePcm, options.candidatePcm, options.sampleRate, options.lagSearchSamples)
  const issues: string[] = []
  if (options.referenceFrames.length !== options.candidateFrames.length) issues.push(`영상 프레임 수 불일치: ${options.referenceFrames.length} / ${options.candidateFrames.length}`)
  if (video.structuralSimilarity < thresholds.minimumStructuralSimilarity) issues.push(`영상 SSIM ${video.structuralSimilarity.toFixed(4)} < ${thresholds.minimumStructuralSimilarity}`)
  if (video.psnrDb < thresholds.minimumPsnrDb) issues.push(`영상 PSNR ${video.psnrDb.toFixed(2)}dB < ${thresholds.minimumPsnrDb}dB`)
  if (video.meanAbsoluteError > thresholds.maximumMeanAbsoluteError) issues.push(`영상 평균 절대 오차 ${video.meanAbsoluteError.toFixed(3)} > ${thresholds.maximumMeanAbsoluteError}`)
  if (audio.correlation < thresholds.minimumPcmCorrelation) issues.push(`PCM 상관 ${audio.correlation.toFixed(4)} < ${thresholds.minimumPcmCorrelation}`)
  if (audio.rootMeanSquareError > thresholds.maximumPcmRmse) issues.push(`PCM RMSE ${audio.rootMeanSquareError.toFixed(5)} > ${thresholds.maximumPcmRmse}`)
  if (Math.abs(audio.lagSamples) > thresholds.maximumAudioLagSamples) issues.push(`오디오 지연 ${audio.lagSamples}샘플 > ±${thresholds.maximumAudioLagSamples}샘플`)
  return { passed: issues.length === 0, issues, video, audio }
}

function luminanceSsim(reference: Uint8Array, candidate: Uint8Array): number {
  const pixels = reference.length / 3
  let referenceMean = 0
  let candidateMean = 0
  for (let index = 0; index < reference.length; index += 3) {
    referenceMean += luma(reference[index], reference[index + 1], reference[index + 2])
    candidateMean += luma(candidate[index], candidate[index + 1], candidate[index + 2])
  }
  referenceMean /= pixels
  candidateMean /= pixels
  let referenceVariance = 0
  let candidateVariance = 0
  let covariance = 0
  for (let index = 0; index < reference.length; index += 3) {
    const referenceDelta = luma(reference[index], reference[index + 1], reference[index + 2]) - referenceMean
    const candidateDelta = luma(candidate[index], candidate[index + 1], candidate[index + 2]) - candidateMean
    referenceVariance += referenceDelta * referenceDelta
    candidateVariance += candidateDelta * candidateDelta
    covariance += referenceDelta * candidateDelta
  }
  const divisor = Math.max(1, pixels - 1)
  referenceVariance /= divisor
  candidateVariance /= divisor
  covariance /= divisor
  const c1 = (0.01 * 255) ** 2
  const c2 = (0.03 * 255) ** 2
  return ((2 * referenceMean * candidateMean + c1) * (2 * covariance + c2)) / ((referenceMean ** 2 + candidateMean ** 2 + c1) * (referenceVariance + candidateVariance + c2))
}

function luma(red: number, green: number, blue: number): number {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function normalizedCorrelation(reference: Float32Array, candidate: Float32Array, lag: number, stride: number): number {
  const referenceStart = Math.max(0, -lag)
  const candidateStart = Math.max(0, lag)
  const length = Math.min(reference.length - referenceStart, candidate.length - candidateStart)
  let dot = 0
  let referenceEnergy = 0
  let candidateEnergy = 0
  for (let index = 0; index < length; index += stride) {
    const expected = reference[referenceStart + index]
    const actual = candidate[candidateStart + index]
    dot += expected * actual
    referenceEnergy += expected * expected
    candidateEnergy += actual * actual
  }
  return dot / Math.sqrt(Math.max(1e-20, referenceEnergy * candidateEnergy))
}
