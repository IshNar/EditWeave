import type { MediaAsset } from './types'

export interface WaveformSyncResult {
  timelineShift: number
  confidence: number
}

export function estimateWaveformSync(reference: MediaAsset, target: MediaAsset, maxShiftSeconds = 30): WaveformSyncResult | undefined {
  if (!reference.waveform?.length || !target.waveform?.length || reference.duration <= 0 || target.duration <= 0) return undefined
  const sampleRate = 20
  const referenceSamples = resample(reference.waveform, reference.duration, sampleRate)
  const targetSamples = resample(target.waveform, target.duration, sampleRate)
  const maxLag = Math.min(Math.round(maxShiftSeconds * sampleRate), Math.max(referenceSamples.length, targetSamples.length) - 1)
  let bestLag = 0
  let bestScore = -Infinity
  let secondScore = -Infinity
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let sum = 0
    let refEnergy = 0
    let targetEnergy = 0
    let count = 0
    for (let refIndex = 0; refIndex < referenceSamples.length; refIndex++) {
      const targetIndex = refIndex - lag
      if (targetIndex < 0 || targetIndex >= targetSamples.length) continue
      const a = referenceSamples[refIndex]
      const b = targetSamples[targetIndex]
      sum += a * b
      refEnergy += a * a
      targetEnergy += b * b
      count += 1
    }
    if (count < sampleRate * 2 || refEnergy <= 0 || targetEnergy <= 0) continue
    const score = sum / Math.sqrt(refEnergy * targetEnergy)
    if (score > bestScore) {
      secondScore = bestScore
      bestScore = score
      bestLag = lag
    } else if (score > secondScore) secondScore = score
  }
  if (!Number.isFinite(bestScore)) return undefined
  const distinctness = Math.max(0, bestScore - Math.max(0, secondScore))
  return { timelineShift: bestLag / sampleRate, confidence: Math.max(0, Math.min(1, bestScore * 0.75 + distinctness * 2)) }
}

export function estimateClapSync(reference: MediaAsset, target: MediaAsset): WaveformSyncResult | undefined {
  const referenceClap = strongestTransient(reference)
  const targetClap = strongestTransient(target)
  if (!referenceClap || !targetClap) return undefined
  return {
    timelineShift: referenceClap.time - targetClap.time,
    confidence: Math.min(referenceClap.confidence, targetClap.confidence),
  }
}

function strongestTransient(asset: MediaAsset): { time: number; confidence: number } | undefined {
  const waveform = asset.waveform
  if (!waveform || waveform.length < 8 || asset.duration <= 0) return undefined
  const sorted = [...waveform].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  const deviations = waveform.map((value) => Math.abs(value - median)).sort((a, b) => a - b)
  const mad = deviations[Math.floor(deviations.length / 2)] ?? 0
  let bestIndex = -1
  let bestScore = 0
  for (let index = 2; index < waveform.length - 2; index++) {
    const baseline = (waveform[index - 2] + waveform[index - 1]) / 2
    const rise = Math.max(0, waveform[index] - baseline)
    const score = rise * 0.7 + Math.max(0, waveform[index] - median) * 0.3
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  }
  if (bestIndex < 0 || bestScore <= Math.max(0.015, mad * 2.5)) return undefined
  const prominence = bestScore / Math.max(0.01, median + mad * 5)
  return {
    time: bestIndex / Math.max(1, waveform.length - 1) * asset.duration,
    confidence: Math.max(0, Math.min(1, (prominence - 0.25) / 2.5)),
  }
}

function resample(waveform: number[], duration: number, sampleRate: number): number[] {
  const length = Math.max(1, Math.ceil(duration * sampleRate))
  const mean = waveform.reduce((sum, value) => sum + value, 0) / waveform.length
  return Array.from({ length }, (_, index) => {
    const sourceIndex = Math.min(waveform.length - 1, Math.floor(index / Math.max(1, length - 1) * waveform.length))
    return (waveform[sourceIndex] ?? 0) - mean
  })
}
