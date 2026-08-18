import type { MediaAsset } from '../editor/types'
import { createMediaSource } from '../platform/mediaSource'

export interface SceneCutCandidate {
  sourceTime: number
  score: number
}

interface FrameSignature {
  luminance: Float32Array
  histogram: Float32Array
}

export async function detectSceneCuts(asset: MediaAsset, start: number, end: number, options: { signal?: AbortSignal; onProgress?: (progress: number) => void } = {}): Promise<SceneCutCandidate[]> {
  if (asset.kind !== 'video' || !asset.sourceFile) throw new Error('장면 감지에 사용할 영상 원본이 없습니다.')
  const { ALL_FORMATS, Input, VideoSampleSink } = await import('mediabunny')
  const filePath = (asset.sourceFile as File & { __editweaveSourcePath?: string }).__editweaveSourcePath ?? asset.sourcePath
  const input = new Input({ source: await createMediaSource(asset.sourceFile, filePath), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !await track.canDecode()) throw new Error('이 원본의 영상 프레임을 디코딩할 수 없습니다.')
    const sink = new VideoSampleSink(track)
    const rangeStart = Math.max(0, Math.min(start, end))
    const rangeEnd = Math.max(rangeStart + 0.1, Math.min(asset.duration, Math.max(start, end)))
    const duration = rangeEnd - rangeStart
    const sampleCount = Math.min(1800, Math.max(3, Math.ceil(duration / 0.35) + 1))
    const canvas = document.createElement('canvas')
    canvas.width = 96
    canvas.height = 54
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('장면 감지 프레임 캔버스를 만들지 못했습니다.')

    const scores: Array<{ time: number; score: number }> = []
    let previous: FrameSignature | undefined
    for (let index = 0; index < sampleCount; index++) {
      if (options.signal?.aborted) throw new DOMException('장면 전환 감지를 취소했습니다.', 'AbortError')
      const time = rangeStart + duration * index / (sampleCount - 1)
      const sample = await sink.getSample(time)
      if (sample) {
        try {
          context.clearRect(0, 0, canvas.width, canvas.height)
          sample.draw(context, 0, 0, canvas.width, canvas.height)
          const signature = frameSignature(context.getImageData(0, 0, canvas.width, canvas.height).data)
          if (previous) scores.push({ time, score: signatureDifference(previous, signature) })
          previous = signature
        } finally {
          sample.close()
        }
      }
      options.onProgress?.((index + 1) / sampleCount)
    }
    if (scores.length < 3) return []
    const values = scores.map((item) => item.score).sort((a, b) => a - b)
    const median = percentile(values, 0.5)
    const deviations = values.map((value) => Math.abs(value - median)).sort((a, b) => a - b)
    const threshold = Math.max(0.17, median + Math.max(0.055, percentile(deviations, 0.5) * 3.5))
    const candidates = scores.filter((item, index) => item.score >= threshold && item.score >= (scores[index - 1]?.score ?? 0) && item.score >= (scores[index + 1]?.score ?? 0))
      .map((item) => ({ sourceTime: item.time, score: Math.max(0, Math.min(1, (item.score - threshold) / Math.max(0.08, 1 - threshold) + 0.55)) }))
    return suppressNearbyCuts(candidates, 0.45)
  } finally {
    input.dispose()
  }
}

function frameSignature(data: Uint8ClampedArray): FrameSignature {
  const luminance = new Float32Array(data.length / 16)
  const histogram = new Float32Array(16)
  let outputIndex = 0
  for (let index = 0; index < data.length; index += 16) {
    const value = (data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722) / 255
    luminance[outputIndex++] = value
    histogram[Math.min(15, Math.floor(value * 16))]++
  }
  for (let index = 0; index < histogram.length; index++) histogram[index] /= luminance.length
  return { luminance, histogram }
}

function signatureDifference(previous: FrameSignature, current: FrameSignature): number {
  let pixelDifference = 0
  for (let index = 0; index < current.luminance.length; index++) pixelDifference += Math.abs(current.luminance[index] - previous.luminance[index])
  pixelDifference /= current.luminance.length
  let histogramDifference = 0
  for (let index = 0; index < current.histogram.length; index++) histogramDifference += Math.abs(current.histogram[index] - previous.histogram[index])
  return Math.min(1, pixelDifference * 0.72 + histogramDifference * 0.5)
}

function percentile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * fraction)))]
}

function suppressNearbyCuts(candidates: SceneCutCandidate[], minimumGap: number): SceneCutCandidate[] {
  const selected: SceneCutCandidate[] = []
  for (const candidate of candidates.sort((a, b) => a.sourceTime - b.sourceTime)) {
    const previous = selected[selected.length - 1]
    if (!previous || candidate.sourceTime - previous.sourceTime >= minimumGap) selected.push(candidate)
    else if (candidate.score > previous.score) selected[selected.length - 1] = candidate
  }
  return selected
}
