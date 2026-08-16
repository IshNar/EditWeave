export interface DecodedAudioSpan {
  start: number
  sampleRate: number
  left: Float32Array<ArrayBuffer>
  right: Float32Array<ArrayBuffer>
  mono: boolean
  surround?: Float32Array<ArrayBuffer>[]
}

export interface SurroundDownmixOptions {
  centerDb?: number
  surroundDb?: number
  lfeDb?: number
  layout?: AudioChannelLayout
}

export function downmixAudioBuffer(buffer: AudioBuffer, options: SurroundDownmixOptions = {}): Pick<DecodedAudioSpan, 'left' | 'right' | 'mono'> {
  const channels = buffer.numberOfChannels
  const sourceLeft = buffer.getChannelData(0)
  const layout = options.layout ?? 'auto'
  if (channels === 1 || layout === 'mono') {
    const mono = new Float32Array(sourceLeft)
    return { left: mono, right: mono, mono: true }
  }
  if (channels === 2 || layout === 'stereo' || layout === 'dual-mono') return { left: new Float32Array(sourceLeft), right: new Float32Array(buffer.getChannelData(1)), mono: false }
  const sourceRight = buffer.getChannelData(1)
  const resolvedLayout = layout === 'auto' ? channels === 4 ? 'quad' : channels === 5 ? '5.0' : channels >= 8 ? '7.1' : '5.1' : layout
  const center = channels > 2 && (resolvedLayout === '5.0' || resolvedLayout === '5.1' || resolvedLayout === '7.1') ? buffer.getChannelData(2) : undefined
  const lfe = channels > 3 && (resolvedLayout === '5.1' || resolvedLayout === '7.1') ? buffer.getChannelData(3) : undefined
  const surroundLeftIndex = resolvedLayout === 'quad' ? 2 : resolvedLayout === '5.0' ? 3 : resolvedLayout === '5.1' || resolvedLayout === '7.1' ? 4 : -1
  const surroundRightIndex = resolvedLayout === 'quad' ? 3 : resolvedLayout === '5.0' ? 4 : resolvedLayout === '5.1' || resolvedLayout === '7.1' ? 5 : -1
  const surroundLeft = surroundLeftIndex >= 0 && surroundLeftIndex < channels ? buffer.getChannelData(surroundLeftIndex) : undefined
  const surroundRight = surroundRightIndex >= 0 && surroundRightIndex < channels ? buffer.getChannelData(surroundRightIndex) : undefined
  const sideLeft = resolvedLayout === '7.1' && channels > 6 ? buffer.getChannelData(6) : undefined
  const sideRight = resolvedLayout === '7.1' && channels > 7 ? buffer.getChannelData(7) : undefined
  const left = new Float32Array(sourceLeft.length)
  const right = new Float32Array(sourceLeft.length)
  const centerScale = 10 ** (Math.max(-60, Math.min(6, options.centerDb ?? -3)) / 20)
  const surroundScale = 10 ** (Math.max(-60, Math.min(6, options.surroundDb ?? -3)) / 20)
  const lfeScale = 10 ** (Math.max(-60, Math.min(0, options.lfeDb ?? -60)) / 20)
  for (let index = 0; index < sourceLeft.length; index++) {
    const centerValue = (center?.[index] ?? 0) * centerScale
    const lfeValue = (lfe?.[index] ?? 0) * lfeScale
    const surroundPairScale = resolvedLayout === '7.1' ? surroundScale * Math.SQRT1_2 : surroundScale
    left[index] = sourceLeft[index] + centerValue + lfeValue + ((surroundLeft?.[index] ?? 0) + (sideLeft?.[index] ?? 0)) * surroundPairScale
    right[index] = sourceRight[index] + centerValue + lfeValue + ((surroundRight?.[index] ?? 0) + (sideRight?.[index] ?? 0)) * surroundPairScale
  }
  return { left, right, mono: false }
}

export function extractSurroundAudioBuffer(buffer: AudioBuffer, layout: AudioChannelLayout = 'auto'): Float32Array<ArrayBuffer>[] | undefined {
  const count = buffer.numberOfChannels
  const resolved = layout === 'auto' ? count >= 8 ? '7.1' : count >= 6 ? '5.1' : count === 5 ? '5.0' : count === 4 ? 'quad' : count === 2 ? 'stereo' : 'mono' : layout
  if (resolved !== 'quad' && resolved !== '5.0' && resolved !== '5.1' && resolved !== '7.1') return undefined
  const length = buffer.length
  const output = Array.from({ length: 6 }, () => new Float32Array(length))
  const copy = (target: number, source: number, gain = 1) => {
    if (source < 0 || source >= count) return
    const input = buffer.getChannelData(source)
    for (let index = 0; index < length; index++) output[target][index] += input[index] * gain
  }
  copy(0, 0)
  copy(1, 1)
  if (resolved === 'quad') {
    copy(4, 2)
    copy(5, 3)
  } else if (resolved === '5.0') {
    copy(2, 2)
    copy(4, 3)
    copy(5, 4)
  } else {
    copy(2, 2)
    copy(3, 3)
    copy(4, 4, resolved === '7.1' ? Math.SQRT1_2 : 1)
    copy(5, 5, resolved === '7.1' ? Math.SQRT1_2 : 1)
    if (resolved === '7.1') {
      copy(4, 6, Math.SQRT1_2)
      copy(5, 7, Math.SQRT1_2)
    }
  }
  return output
}

export function decodedSpanEnd(span: DecodedAudioSpan): number {
  return span.start + span.left.length / span.sampleRate
}

export function sampleDecodedAudio(span: DecodedAudioSpan, timestamp: number): { left: number; right: number; mono: boolean } | undefined {
  const position = (timestamp - span.start) * span.sampleRate
  if (position < 0 || position >= span.left.length) return undefined
  const index = Math.floor(position)
  const next = Math.min(span.left.length - 1, index + 1)
  const mix = position - index
  return {
    left: span.left[index] + (span.left[next] - span.left[index]) * mix,
    right: span.right[index] + (span.right[next] - span.right[index]) * mix,
    mono: span.mono,
  }
}

export function sampleDecodedSurround(span: DecodedAudioSpan, timestamp: number): number[] | undefined {
  if (!span.surround?.length) return undefined
  const position = (timestamp - span.start) * span.sampleRate
  if (position < 0 || position >= span.left.length) return undefined
  const index = Math.floor(position)
  const next = Math.min(span.left.length - 1, index + 1)
  const mix = position - index
  return span.surround.map((channel) => channel[index] + (channel[next] - channel[index]) * mix)
}

export function findDecodedAudioSpan(spans: DecodedAudioSpan[], timestamp: number): DecodedAudioSpan | undefined {
  let low = 0
  let high = spans.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (spans[middle].start <= timestamp) low = middle + 1
    else high = middle
  }
  const span = spans[Math.max(0, low - 1)]
  return span && timestamp < decodedSpanEnd(span) ? span : undefined
}

export interface PitchPreservedTimeMapOptions {
  spans: DecodedAudioSpan[]
  timelineStart: number
  frameCount: number
  sampleRate: number
  clipStart: number
  clipEnd: number
  reverse: boolean
  mono: boolean
  sourceTimeAt: (timelineTime: number) => number
}

export function renderPitchPreservedTimeMap(options: PitchPreservedTimeMapOptions): Pick<DecodedAudioSpan, 'left' | 'right' | 'mono'> {
  const requestedFrameCount = Math.max(1, Math.floor(options.frameCount))
  const sampleRate = Math.max(8_000, Math.min(384_000, options.sampleRate))
  const historyFrames = Math.max(0, Math.min(Math.round(sampleRate * 0.05), Math.floor((options.timelineStart - options.clipStart) * sampleRate)))
  const renderStart = options.timelineStart - historyFrames / sampleRate
  const frameCount = historyFrames + requestedFrameCount
  const grainLength = Math.max(128, Math.round(sampleRate * 0.04))
  const halfGrain = Math.floor(grainLength / 2)
  const hopFrames = Math.max(32, Math.floor(grainLength / 4))
  const hopSeconds = hopFrames / sampleRate
  const halfSeconds = halfGrain / sampleRate
  const timelineEnd = renderStart + frameCount / sampleRate
  const firstCenter = Math.max(options.clipStart, renderStart)
  const lastCenter = Math.min(options.clipEnd, timelineEnd + halfSeconds)
  const firstGrain = Math.max(0, Math.ceil((firstCenter - options.clipStart) / hopSeconds - 1e-9))
  const lastGrain = Math.max(firstGrain - 1, Math.floor((lastCenter - options.clipStart) / hopSeconds + 1e-9))
  const left = new Float32Array(frameCount)
  const right = options.mono ? left : new Float32Array(frameCount)
  const weights = new Float32Array(frameCount)
  const direction = options.reverse ? -1 : 1

  for (let grain = firstGrain; grain <= lastGrain; grain++) {
    const centerTimeline = options.clipStart + grain * hopSeconds
    const expectedSourceCenter = options.sourceTimeAt(centerTimeline)
    const outputCenter = Math.round((centerTimeline - renderStart) * sampleRate)
    const sourceCenter = expectedSourceCenter + bestGrainAlignment({
      spans: options.spans,
      left,
      right,
      weights,
      outputCenter,
      halfGrain,
      sampleRate,
      direction,
      expectedSourceCenter,
      mono: options.mono,
    })
    for (let grainFrame = 0; grainFrame < grainLength; grainFrame++) {
      const outputFrame = outputCenter + grainFrame - halfGrain
      if (outputFrame < 0 || outputFrame >= frameCount) continue
      const offset = (grainFrame - halfGrain) / sampleRate
      const sourceTime = sourceCenter + direction * offset
      const span = findDecodedAudioSpan(options.spans, sourceTime)
      const values = span ? sampleDecodedAudio(span, sourceTime) : undefined
      if (!values) continue
      const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * grainFrame / Math.max(1, grainLength - 1))
      left[outputFrame] += values.left * window
      if (!options.mono) right[outputFrame] += values.right * window
      weights[outputFrame] += window
    }
  }

  for (let frame = 0; frame < frameCount; frame++) {
    const weight = weights[frame]
    if (weight <= 1e-8) continue
    left[frame] /= weight
    if (!options.mono) right[frame] /= weight
  }
  const outputLeft = left.slice(historyFrames, historyFrames + requestedFrameCount)
  const outputRight = options.mono ? outputLeft : right.slice(historyFrames, historyFrames + requestedFrameCount)
  return { left: outputLeft, right: outputRight, mono: options.mono }
}

function bestGrainAlignment(options: {
  spans: DecodedAudioSpan[]
  left: Float32Array
  right: Float32Array
  weights: Float32Array
  outputCenter: number
  halfGrain: number
  sampleRate: number
  direction: number
  expectedSourceCenter: number
  mono: boolean
}): number {
  let bestShift = 0
  let bestScore = -Infinity
  for (let shiftMs = -6; shiftMs <= 6; shiftMs++) {
    const shift = shiftMs / 1_000
    let cross = 0
    let existingEnergy = 0
    let candidateEnergy = 0
    let compared = 0
    for (let grainFrame = 0; grainFrame <= options.halfGrain; grainFrame += 4) {
      const outputFrame = options.outputCenter + grainFrame - options.halfGrain
      if (outputFrame < 0 || outputFrame >= options.left.length || options.weights[outputFrame] <= 1e-6) continue
      const offset = (grainFrame - options.halfGrain) / options.sampleRate
      const sourceTime = options.expectedSourceCenter + shift + options.direction * offset
      const span = findDecodedAudioSpan(options.spans, sourceTime)
      const values = span ? sampleDecodedAudio(span, sourceTime) : undefined
      if (!values) continue
      const existing = options.mono ? options.left[outputFrame] / options.weights[outputFrame] : (options.left[outputFrame] + options.right[outputFrame]) / (2 * options.weights[outputFrame])
      const candidate = options.mono ? values.left : (values.left + values.right) / 2
      cross += existing * candidate
      existingEnergy += existing * existing
      candidateEnergy += candidate * candidate
      compared++
    }
    if (compared < 16 || existingEnergy <= 1e-10 || candidateEnergy <= 1e-10) continue
    const score = cross / Math.sqrt(existingEnergy * candidateEnergy) - Math.abs(shiftMs) * 1e-5
    if (score > bestScore) {
      bestScore = score
      bestShift = shift
    }
  }
  return bestShift
}
import type { AudioChannelLayout } from '../editor/types'
