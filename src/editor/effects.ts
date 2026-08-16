import type { AudioAdjustment, AudioMixKeyframe, CaptionStyle, ClipTransform, ColorAdjustment, EffectMask, MaskPoint, MediaAsset, SpeedKeyframe, TimelineClip, TimelineTrack, TransformKeyframe, VisualEffectKeyframe, VisualEffects } from './types'
import { clamp } from './format'

export const defaultTransform: ClipTransform = {
  positionX: 0,
  positionY: 0,
  scale: 100,
  scaleX: 100,
  scaleY: 100,
  anchorX: 50,
  anchorY: 50,
  skewX: 0,
  skewY: 0,
  rotation: 0,
  opacity: 100,
}

export function imageSequenceUrlAt(asset: MediaAsset, sourceTime: number): string {
  const urls = asset.imageSequenceUrls
  if (!urls?.length) return asset.url
  const frameRate = Math.max(1, asset.imageSequenceFrameRate ?? asset.frameRate ?? 30)
  const index = Math.max(0, Math.min(urls.length - 1, Math.floor(Math.max(0, sourceTime) * frameRate + 1e-6)))
  return urls[index] ?? asset.url
}

export function defaultColorAdjustment(): ColorAdjustment {
  return {
    exposure: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    tint: 0,
    highlights: 0,
    shadows: 0,
    lut: 'none',
    lutIntensity: 100,
    hue: 0,
    vibrance: 0,
    fade: 0,
    vignette: 0,
    lift: 0,
    gamma: 0,
    gain: 0,
    curveShadows: 0,
    curveMidtones: 0,
    curveHighlights: 0,
    masterCurve: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    redCurve: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    greenCurve: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    blueCurve: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    qualifierEnabled: false,
    qualifierHue: 120,
    qualifierHueRange: 30,
    qualifierSaturationMin: 20,
    qualifierSaturationMax: 100,
    qualifierLuminanceMin: 10,
    qualifierLuminanceMax: 95,
    qualifierSoftness: 20,
    qualifierExposure: 0,
    qualifierSaturation: 0,
    qualifierHueShift: 0,
    qualifierShowMask: false,
  }
}

export function defaultAudioAdjustment(): AudioAdjustment {
  return {
    gainDb: 0,
    pan: 0,
    channelMode: 'stereo',
    stereoWidth: 100,
    phaseInvertLeft: false,
    phaseInvertRight: false,
    downmixCenterDb: -3,
    downmixSurroundDb: -3,
    downmixLfeDb: -60,
    lfeSendDb: -60,
    lfeLowpassHz: 120,
    surroundPan: undefined,
    surroundSpread: 60,
    fadeIn: 0,
    fadeOut: 0,
    fadeInCurve: 'linear',
    fadeOutCurve: 'linear',
    normalize: false,
    preservePitch: true,
    noiseReduction: 0,
    voiceEnhance: false,
    deEsser: 0,
    humRemoval: 'off',
    ducking: false,
    duckingAmountDb: -11,
    duckingAttackMs: 180,
    duckingReleaseMs: 650,
    role: 'dialogue',
    sendLevelDb: -60,
    highpassHz: 20,
    eqLowDb: 0,
    eqMidDb: 0,
    eqHighDb: 0,
    compressorThresholdDb: -12,
    compressorRatio: 1,
    limiterDb: -1,
  }
}

export function audioFadeCurveGain(progress: number, curve: NonNullable<AudioAdjustment['fadeInCurve']> = 'linear'): number {
  const value = clamp(progress, 0, 1)
  if (curve === 'equal-power') return Math.sin(value * Math.PI / 2)
  if (curve === 'logarithmic') return Math.log10(1 + value * 9)
  return value
}

export function sourceMasterColor(asset?: MediaAsset): ColorAdjustment | undefined {
  return asset?.masterEffectsEnabled && asset.kind !== 'audio'
    ? { ...defaultColorAdjustment(), ...asset.masterColorAdjustment }
    : undefined
}

export function sourceMasterVisualEffects(asset?: MediaAsset): VisualEffects | undefined {
  return asset?.masterEffectsEnabled && asset.kind !== 'audio'
    ? { ...defaultVisualEffects(), ...asset.masterVisualEffects }
    : undefined
}

export function sourceMasterAudio(asset?: MediaAsset): AudioAdjustment | undefined {
  return asset?.masterEffectsEnabled && asset.kind !== 'image' && asset.masterAudioAdjustment
    ? { ...defaultAudioAdjustment(), ...asset.masterAudioAdjustment, fadeIn: 0, fadeOut: 0, ducking: false, auxSends: undefined, sendBus: undefined, sendLevelDb: undefined }
    : undefined
}

export function hasSourceMasterVisualProcessing(asset?: MediaAsset): boolean {
  if (!asset?.masterEffectsEnabled || asset.kind === 'audio') return false
  const color = sourceMasterColor(asset)!
  const effects = sourceMasterVisualEffects(asset)!
  return color.exposure !== 0 || color.contrast !== 0 || color.saturation !== 0 || color.temperature !== 0 || color.tint !== 0
    || color.highlights !== 0 || color.shadows !== 0 || color.lut !== 'none' || Boolean(color.customLut)
    || Boolean(color.hue) || Boolean(color.vibrance) || Boolean(color.fade) || Boolean(color.vignette)
    || Boolean(color.lift) || Boolean(color.gamma) || Boolean(color.gain) || Boolean(color.curveShadows) || Boolean(color.curveMidtones) || Boolean(color.curveHighlights)
    || hasCustomCurvePoints(color.masterCurve) || hasCustomCurvePoints(color.redCurve) || hasCustomCurvePoints(color.greenCurve) || hasCustomCurvePoints(color.blueCurve)
    || Boolean(color.qualifierEnabled) || Boolean(color.colorNodes?.length)
    || effects.cropTop !== 0 || effects.cropRight !== 0 || effects.cropBottom !== 0 || effects.cropLeft !== 0
    || effects.blur !== 0 || effects.shadowOpacity !== 0 || effects.mask !== 'none' || Boolean(effects.masks?.some((mask) => mask.enabled))
    || Boolean(effects.faceMosaic) || Boolean(effects.chromaKeyEnabled) || Boolean(effects.cornerPinEnabled)
}

function hasCustomCurvePoints(points?: Array<{ x: number; y: number }>): boolean {
  return Boolean(points?.length && (points.length !== 2 || Math.abs(points[0].x) > 0.0001 || Math.abs(points[0].y) > 0.0001 || Math.abs(points[1].x - 1) > 0.0001 || Math.abs(points[1].y - 1) > 0.0001))
}

export function peakNormalizationGain(audioPeak: number | undefined, targetDbfs = -1): number {
  if (audioPeak === undefined || !Number.isFinite(audioPeak) || audioPeak <= 1e-6) return 1
  const requested = gainFromDb(targetDbfs) / audioPeak
  return Math.max(gainFromDb(-24), Math.min(gainFromDb(24), requested))
}

export function peakNormalizationGainDb(audioPeak: number | undefined, targetDbfs = -1): number {
  return 20 * Math.log10(peakNormalizationGain(audioPeak, targetDbfs))
}

export function noiseGateThreshold(noiseReduction: number): number {
  return Math.max(0, Math.min(100, noiseReduction)) / 100 * 0.035
}

export function applyNoiseGate(value: number, noiseReduction: number): number {
  const threshold = noiseGateThreshold(noiseReduction)
  if (threshold <= 0) return value
  const magnitude = Math.abs(value)
  if (magnitude <= threshold) return 0
  if (magnitude >= threshold * 2) return value
  const progress = (magnitude - threshold) / threshold
  const softGain = progress * progress * (3 - 2 * progress)
  return value * softGain
}

export function createNoiseGateCurve(noiseReduction: number, pointCount = 65_537): Float32Array<ArrayBuffer> {
  return createAudioTransferCurve((value) => applyNoiseGate(value, noiseReduction), pointCount)
}

export function applyStaticCompressor(value: number, thresholdDb: number, ratio: number, makeupDb = 0): number {
  const magnitude = Math.abs(value)
  if (magnitude <= 1e-12) return 0
  const threshold = Math.max(-60, Math.min(0, thresholdDb))
  const safeRatio = Math.max(1, Math.min(20, ratio))
  const inputDb = 20 * Math.log10(magnitude)
  const compressedDb = inputDb > threshold ? threshold + (inputDb - threshold) / safeRatio : inputDb
  return Math.sign(value) * gainFromDb(compressedDb + Math.max(-24, Math.min(24, makeupDb)))
}

export function applyBrickwallLimiter(value: number, ceilingDb: number): number {
  const ceiling = gainFromDb(Math.max(-24, Math.min(0, ceilingDb)))
  return Math.max(-ceiling, Math.min(ceiling, value))
}

export function createCompressorCurve(thresholdDb: number, ratio: number, makeupDb = 0, inputRange = 4, pointCount = 65_537): Float32Array<ArrayBuffer> {
  const range = Math.max(1, Math.min(16, inputRange))
  return createAudioTransferCurve((value) => applyStaticCompressor(value * range, thresholdDb, ratio, makeupDb), pointCount)
}

export function createLimiterCurve(ceilingDb: number, inputRange = 4, pointCount = 65_537): Float32Array<ArrayBuffer> {
  const range = Math.max(1, Math.min(16, inputRange))
  return createAudioTransferCurve((value) => applyBrickwallLimiter(value * range, ceilingDb), pointCount)
}

export function createMasterSoftClipCurve(inputRange = 4, pointCount = 65_537): Float32Array<ArrayBuffer> {
  const range = Math.max(1, Math.min(16, inputRange))
  return createAudioTransferCurve((value) => Math.tanh(value * range), pointCount)
}

function createAudioTransferCurve(transform: (value: number) => number, pointCount: number): Float32Array<ArrayBuffer> {
  const count = Math.max(1_025, Math.min(131_073, Math.floor(pointCount)))
  const curve = new Float32Array(count)
  for (let index = 0; index < count; index++) {
    const value = index / (count - 1) * 2 - 1
    curve[index] = transform(value)
  }
  return curve
}

export function defaultCaptionStyle(): CaptionStyle {
  return {
    preset: 'default',
    fontSize: 100,
    textColor: '#ffffff',
    backgroundColor: 'rgba(5, 5, 8, 0.74)',
    position: 'bottom',
    highlightColor: '#ffd45c',
    fontFamily: 'sans',
    fontWeight: 800,
    strokeColor: '#000000',
    strokeWidth: 0,
    textAlign: 'center',
    positionX: 50,
    positionY: 84,
    lineHeight: 125,
    letterSpacing: 0,
    maxWidth: 80,
    backgroundEnabled: true,
    backgroundPaddingX: 70,
    backgroundPaddingY: 35,
    backgroundRadius: 35,
    shadowColor: 'rgba(0,0,0,.65)',
    shadowBlur: 6,
    shadowX: 0,
    shadowY: 2,
    rotation: 0,
    safeArea: 'title',
    uppercase: false,
    animation: 'none',
    animationOut: 'none',
    animationDuration: 0.35,
  }
}

export function defaultVisualEffects(): VisualEffects {
  return {
    cropTop: 0,
    cropRight: 0,
    cropBottom: 0,
    cropLeft: 0,
    blur: 0,
    shadowOpacity: 0,
    shadowBlur: 18,
    shadowX: 0,
    shadowY: 8,
    mask: 'none',
    maskPoints: [{ x: 12, y: 12 }, { x: 88, y: 12 }, { x: 88, y: 88 }, { x: 12, y: 88 }],
    maskFeather: 0,
    maskInvert: false,
    faceMosaic: false,
    mosaicSize: 18,
    blendMode: 'normal',
    chromaKeyEnabled: false,
    chromaKeyColor: '#00ff00',
    chromaKeyTolerance: 32,
    chromaKeySoftness: 18,
    chromaSpill: 45,
    cornerPinEnabled: false,
    cornerPinPoints: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
  }
}

export function clipPlaybackRate(clip: TimelineClip): number {
  return Math.max(0.05, Math.min(16, clip.playbackRate ?? 1))
}

export function clipNeedsPitchStretch(clip: TimelineClip): boolean {
  if (clip.freezeFrame) return false
  if (Math.abs(clipPlaybackRate(clip) - 1) > 0.0001) return true
  return Boolean(clip.speedKeyframes?.some((keyframe) => Math.abs(keyframe.rate - 1) > 0.0001))
}

export function pitchPreservationSourcePadding(clip: TimelineClip): number {
  const rates = [clipPlaybackRate(clip), ...(clip.speedKeyframes ?? []).map((keyframe) => Math.max(0.05, Math.min(16, keyframe.rate)))]
  return Math.min(1, 0.05 * Math.max(...rates) + 0.04)
}

function clampRate(rate: number): number {
  return Math.max(0.05, Math.min(16, Number.isFinite(rate) ? rate : 1))
}

interface SpeedAnchor {
  time: number
  rate: number
  easing: SpeedKeyframe['easing']
  curve?: SpeedKeyframe['curve']
  sourceAt: number
}

const speedMapCache = new WeakMap<TimelineClip, SpeedAnchor[]>()

function speedAnchors(clip: TimelineClip): SpeedAnchor[] {
  const cached = speedMapCache.get(clip)
  if (cached) return cached
  const byTime = new Map<number, { time: number; rate: number; easing: SpeedKeyframe['easing']; curve?: SpeedKeyframe['curve'] }>()
  byTime.set(0, { time: 0, rate: clipPlaybackRate(clip), easing: 'linear' })
  for (const keyframe of clip.speedKeyframes ?? []) {
    const time = Math.max(0, Math.min(clip.duration, keyframe.time))
    byTime.set(time, { time, rate: clampRate(keyframe.rate), easing: keyframe.easing, curve: keyframe.curve })
  }
  const raw = [...byTime.values()].sort((a, b) => a.time - b.time)
  let sourceAt = 0
  const anchors = raw.map((anchor, index) => {
    if (index > 0) {
      const previous = raw[index - 1]
      const span = anchor.time - previous.time
      sourceAt += previous.rate * span + (anchor.rate - previous.rate) * span * integratedSpeedProgress(1, anchor.easing, anchor.curve)
    }
    return { ...anchor, sourceAt }
  })
  speedMapCache.set(clip, anchors)
  return anchors
}

function speedProgress(progress: number, easing: SpeedKeyframe['easing'], curve?: SpeedKeyframe['curve']): number {
  const value = Math.max(0, Math.min(1, progress))
  if (easing === 'hold') return value >= 1 ? 1 : 0
  if (easing === 'bezier') return cubicBezierProgress(value, curve)
  if (easing === 'ease-in') return value ** 2
  if (easing === 'ease-out') return 1 - (1 - value) ** 2
  if (easing === 'ease-in-out') return value < 0.5 ? 2 * value ** 2 : 1 - ((-2 * value + 2) ** 2) / 2
  return value
}

function integratedSpeedProgress(progress: number, easing: SpeedKeyframe['easing'], curve?: SpeedKeyframe['curve']): number {
  const value = Math.max(0, Math.min(1, progress))
  if (easing === 'hold') return 0
  if (easing === 'bezier') return integratedCubicBezierProgress(value, curve)
  if (easing === 'ease-in') return value ** 3 / 3
  if (easing === 'ease-out') return value ** 2 - value ** 3 / 3
  if (easing === 'ease-in-out') {
    if (value < 0.5) return 2 * value ** 3 / 3
    return 1 / 12 + (value - 0.5) + (2 / 3) * ((1 - value) ** 3 - 0.125)
  }
  return value ** 2 / 2
}

function normalizedSpeedCurve(curve?: SpeedKeyframe['curve']): NonNullable<SpeedKeyframe['curve']> {
  return {
    x1: Math.max(0, Math.min(1, curve?.x1 ?? 0.33)),
    y1: Math.max(0, Math.min(1, curve?.y1 ?? 0)),
    x2: Math.max(0, Math.min(1, curve?.x2 ?? 0.67)),
    y2: Math.max(0, Math.min(1, curve?.y2 ?? 1)),
  }
}

function cubicBezierValue(t: number, first: number, second: number): number {
  const inverse = 1 - t
  return 3 * inverse * inverse * t * first + 3 * inverse * t * t * second + t * t * t
}

function cubicBezierDerivative(t: number, first: number, second: number): number {
  const inverse = 1 - t
  return 3 * inverse * inverse * first + 6 * inverse * t * (second - first) + 3 * t * t * (1 - second)
}

function cubicBezierParameter(progress: number, curve?: SpeedKeyframe['curve']): number {
  const normalized = normalizedSpeedCurve(curve)
  let low = 0
  let high = 1
  for (let index = 0; index < 14; index += 1) {
    const middle = (low + high) / 2
    if (cubicBezierValue(middle, normalized.x1, normalized.x2) < progress) low = middle
    else high = middle
  }
  return (low + high) / 2
}

function cubicBezierProgress(progress: number, curve?: SpeedKeyframe['curve']): number {
  const normalized = normalizedSpeedCurve(curve)
  return cubicBezierValue(cubicBezierParameter(progress, normalized), normalized.y1, normalized.y2)
}

function integratedCubicBezierProgress(progress: number, curve?: SpeedKeyframe['curve']): number {
  if (progress <= 0) return 0
  const normalized = normalizedSpeedCurve(curve)
  const end = cubicBezierParameter(progress, normalized)
  const steps = 16
  const interval = end / steps
  let sum = 0
  for (let index = 0; index <= steps; index += 1) {
    const t = index * interval
    const value = cubicBezierValue(t, normalized.y1, normalized.y2) * cubicBezierDerivative(t, normalized.x1, normalized.x2)
    sum += (index === 0 || index === steps ? 1 : index % 2 === 0 ? 2 : 4) * value
  }
  return sum * interval / 3
}

export function clipPlaybackRateAtLocal(clip: TimelineClip, localTime: number): number {
  if (clip.freezeFrame) return 0
  const time = Math.max(0, Math.min(clip.duration, localTime))
  const anchors = speedAnchors(clip)
  const nextIndex = upperSpeedAnchorIndex(anchors, time)
  if (nextIndex < 0) return anchors[anchors.length - 1]?.rate ?? clipPlaybackRate(clip)
  const previous = anchors[Math.max(0, nextIndex - 1)]
  const next = anchors[nextIndex]
  const span = Math.max(0.000001, next.time - previous.time)
  return previous.rate + (next.rate - previous.rate) * speedProgress((time - previous.time) / span, next.easing, next.curve)
}

export function clipPlaybackRateAt(clip: TimelineClip, timelineTime: number): number {
  return clipPlaybackRateAtLocal(clip, timelineTime - clip.start)
}

export function clipSourceDelta(clip: TimelineClip, localTime: number): number {
  if (clip.freezeFrame) return 0
  const time = Math.max(0, Math.min(clip.duration, localTime))
  const anchors = speedAnchors(clip)
  const nextIndex = upperSpeedAnchorIndex(anchors, time)
  if (nextIndex < 0) {
    const last = anchors[anchors.length - 1]
    return Math.max(0, last.sourceAt + (time - last.time) * last.rate)
  }
  const previous = anchors[Math.max(0, nextIndex - 1)]
  const next = anchors[nextIndex]
  const span = Math.max(0.000001, next.time - previous.time)
  const elapsed = time - previous.time
  const progress = elapsed / span
  return Math.max(0, previous.sourceAt + previous.rate * elapsed + (next.rate - previous.rate) * span * integratedSpeedProgress(progress, next.easing, next.curve))
}

function upperSpeedAnchorIndex(anchors: SpeedAnchor[], time: number): number {
  let low = 0
  let high = anchors.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (anchors[middle].time <= time) low = middle + 1
    else high = middle
  }
  return low < anchors.length ? low : -1
}

export function clipSourceDuration(clip: TimelineClip): number {
  return clipSourceDelta(clip, clip.duration)
}

export function clipSourceTime(clip: TimelineClip, timelineTime: number): number {
  if (clip.freezeFrame) return Math.max(0, clip.freezeFrameSourceTime ?? clip.sourceOffset)
  const elapsed = Math.max(0, Math.min(clip.duration, timelineTime - clip.start))
  const sourceDelta = clipSourceDelta(clip, elapsed)
  return clip.reverse
    ? Math.max(0, clip.sourceOffset + clipSourceDuration(clip) - sourceDelta)
    : clip.sourceOffset + sourceDelta
}

const audioMixKeyframeCache = new WeakMap<TimelineClip, NonNullable<TimelineClip['audioMixKeyframes']>>()

export function resolveClipAudioMix(clip: TimelineClip, timelineTime: number): { gainDb: number; pan: number } {
  const base = { ...defaultAudioAdjustment(), ...clip.audioAdjustment }
  let keyframes = audioMixKeyframeCache.get(clip)
  if (!keyframes) {
    keyframes = [...(clip.audioMixKeyframes ?? [])].sort((a, b) => a.time - b.time)
    audioMixKeyframeCache.set(clip, keyframes)
  }
  if (!keyframes.length) return { gainDb: base.gainDb, pan: base.pan }
  const localTime = Math.max(0, Math.min(clip.duration, timelineTime - clip.start))
  let low = 0
  let high = keyframes.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (keyframes[middle].time < localTime) low = middle + 1
    else high = middle
  }
  if (low === 0) return { gainDb: keyframes[0].gainDb, pan: keyframes[0].pan }
  if (low >= keyframes.length) {
    const last = keyframes[keyframes.length - 1]
    return { gainDb: last.gainDb, pan: last.pan }
  }
  const previous = keyframes[low - 1]
  const next = keyframes[low]
  const progress = applyEasing((localTime - previous.time) / Math.max(0.001, next.time - previous.time), next.easing, next.curve)
  return { gainDb: interpolate(previous.gainDb, next.gainDb, progress), pan: interpolate(previous.pan, next.pan, progress) }
}

const trackMixKeyframeCache = new WeakMap<TimelineTrack, NonNullable<TimelineTrack['mixKeyframes']>>()

export function resolveTrackAudioMix(track: TimelineTrack, timelineTime: number): { volume: number; pan: number } {
  if (track.mixAutomationMode === 'off') return { volume: track.volume ?? 100, pan: track.pan ?? 0 }
  let keyframes = trackMixKeyframeCache.get(track)
  if (!keyframes) {
    keyframes = [...(track.mixKeyframes ?? [])].sort((a, b) => a.time - b.time)
    trackMixKeyframeCache.set(track, keyframes)
  }
  if (!keyframes.length) return { volume: track.volume ?? 100, pan: track.pan ?? 0 }
  let low = 0
  let high = keyframes.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (keyframes[middle].time < timelineTime) low = middle + 1
    else high = middle
  }
  if (low === 0) return { volume: keyframes[0].volume, pan: keyframes[0].pan }
  if (low >= keyframes.length) {
    const last = keyframes[keyframes.length - 1]
    return { volume: last.volume, pan: last.pan }
  }
  const previous = keyframes[low - 1]
  const next = keyframes[low]
  const progress = applyEasing((timelineTime - previous.time) / Math.max(0.001, next.time - previous.time), next.easing, next.curve)
  return { volume: interpolate(previous.volume, next.volume, progress), pan: interpolate(previous.pan, next.pan, progress) }
}

interface CubicPoint { x: number; y: number }

function interpolatePoint(from: CubicPoint, to: CubicPoint, progress: number): CubicPoint {
  return { x: interpolate(from.x, to.x, progress), y: interpolate(from.y, to.y, progress) }
}

function splitCubicPoints(points: [CubicPoint, CubicPoint, CubicPoint, CubicPoint], progress: number): [[CubicPoint, CubicPoint, CubicPoint, CubicPoint], [CubicPoint, CubicPoint, CubicPoint, CubicPoint]] {
  const [p0, p1, p2, p3] = points
  const p01 = interpolatePoint(p0, p1, progress)
  const p12 = interpolatePoint(p1, p2, progress)
  const p23 = interpolatePoint(p2, p3, progress)
  const p012 = interpolatePoint(p01, p12, progress)
  const p123 = interpolatePoint(p12, p23, progress)
  const split = interpolatePoint(p012, p123, progress)
  return [[p0, p01, p012, split], [split, p123, p23, p3]]
}

function sliceCubicPoints(points: [CubicPoint, CubicPoint, CubicPoint, CubicPoint], start: number, end: number): [CubicPoint, CubicPoint, CubicPoint, CubicPoint] {
  const boundedStart = clamp(start, 0, 1)
  const boundedEnd = clamp(end, boundedStart, 1)
  const left = splitCubicPoints(points, boundedEnd)[0]
  return boundedStart <= 0 ? left : splitCubicPoints(left, boundedStart / Math.max(.000001, boundedEnd))[1]
}

function preserveSlicedSpatialTangents(sliced: TransformKeyframe[], original: TransformKeyframe[], from: number): TransformKeyframe[] {
  if (!sliced.length) return sliced
  const tolerance = 1 / 1000
  const sortedOriginal = [...original].sort((left, right) => left.time - right.time)
  const result = sliced.map((keyframe, index) => ({
    ...keyframe,
    spatialIn: index === 0 ? undefined : keyframe.spatialIn ? { ...keyframe.spatialIn } : undefined,
    spatialOut: index === sliced.length - 1 ? undefined : keyframe.spatialOut ? { ...keyframe.spatialOut } : undefined,
  }))
  for (let index = 0; index < result.length - 1; index += 1) {
    const localStart = from + result[index].time
    const localEnd = from + result[index + 1].time
    const nextIndex = sortedOriginal.findIndex((keyframe) => keyframe.time >= localEnd - tolerance)
    if (nextIndex <= 0) continue
    const previous = sortedOriginal[nextIndex - 1]
    const next = sortedOriginal[nextIndex]
    if (localStart < previous.time - tolerance || localEnd > next.time + tolerance || (!previous.spatialOut && !next.spatialIn)) continue
    const span = Math.max(.000001, next.time - previous.time)
    const rawStart = clamp((localStart - previous.time) / span, 0, 1)
    const rawEnd = clamp((localEnd - previous.time) / span, rawStart, 1)
    const spatialStart = applyEasing(rawStart, next.easing, next.curve)
    const spatialEnd = applyEasing(rawEnd, next.easing, next.curve)
    const deltaX = next.transform.positionX - previous.transform.positionX
    const deltaY = next.transform.positionY - previous.transform.positionY
    const segment = sliceCubicPoints([
      { x: previous.transform.positionX, y: previous.transform.positionY },
      { x: previous.transform.positionX + (previous.spatialOut?.x ?? deltaX / 3), y: previous.transform.positionY + (previous.spatialOut?.y ?? deltaY / 3) },
      { x: next.transform.positionX + (next.spatialIn?.x ?? -deltaX / 3), y: next.transform.positionY + (next.spatialIn?.y ?? -deltaY / 3) },
      { x: next.transform.positionX, y: next.transform.positionY },
    ], spatialStart, spatialEnd)
    result[index] = { ...result[index], spatialOut: { x: segment[1].x - result[index].transform.positionX, y: segment[1].y - result[index].transform.positionY } }
    result[index + 1] = { ...result[index + 1], spatialIn: { x: segment[2].x - result[index + 1].transform.positionX, y: segment[2].y - result[index + 1].transform.positionY } }
  }
  return result
}

function easingBezier(easing: TransformKeyframe['easing'], curve?: TransformKeyframe['curve']): NonNullable<TransformKeyframe['curve']> {
  if (easing === 'bezier') return normalizedSpeedCurve(curve)
  if (easing === 'ease-in') return { x1: 1 / 3, y1: 0, x2: 2 / 3, y2: 1 / 3 }
  if (easing === 'ease-out') return { x1: 1 / 3, y1: 2 / 3, x2: 2 / 3, y2: 1 }
  if (easing === 'ease-in-out') return { x1: .42, y1: 0, x2: .58, y2: 1 }
  return { x1: 1 / 3, y1: 1 / 3, x2: 2 / 3, y2: 2 / 3 }
}

function sliceTemporalInterpolation(easing: TransformKeyframe['easing'], curve: TransformKeyframe['curve'] | undefined, startProgress: number, endProgress: number): Pick<TransformKeyframe, 'easing' | 'curve'> {
  if (easing === 'hold') return { easing: 'hold', curve: undefined }
  if (startProgress <= .000001 && endProgress >= .999999) return { easing, curve: curve ? { ...curve } : undefined }
  if (easing === 'linear') return { easing: 'linear', curve: undefined }
  if (easing === 'ease-in-out') {
    const start = clamp(startProgress, 0, 1)
    const end = clamp(endProgress, start, 1)
    const startValue = applyEasing(start, easing)
    const endValue = applyEasing(end, easing)
    const valueSpan = endValue - startValue
    if (Math.abs(valueSpan) <= .000001) return { easing: 'linear', curve: undefined }
    const derivative = (progress: number) => progress < .5 ? 4 * progress : 4 * (1 - progress)
    const normalizedStartSlope = derivative(start) * (end - start) / valueSpan
    const normalizedEndSlope = derivative(end) * (end - start) / valueSpan
    return { easing: 'bezier', curve: { x1: 1 / 3, y1: clamp(normalizedStartSlope / 3, 0, 1), x2: 2 / 3, y2: clamp(1 - normalizedEndSlope / 3, 0, 1) } }
  }
  const normalized = easingBezier(easing, curve)
  const startParameter = cubicBezierParameter(clamp(startProgress, 0, 1), normalized)
  const endParameter = cubicBezierParameter(clamp(endProgress, startProgress, 1), normalized)
  const segment = sliceCubicPoints([{ x: 0, y: 0 }, { x: normalized.x1, y: normalized.y1 }, { x: normalized.x2, y: normalized.y2 }, { x: 1, y: 1 }], startParameter, endParameter)
  const xSpan = Math.max(.000001, segment[3].x - segment[0].x)
  const ySpan = segment[3].y - segment[0].y
  if (Math.abs(ySpan) <= .000001) return { easing: 'linear', curve: undefined }
  return {
    easing: 'bezier',
    curve: {
      x1: clamp((segment[1].x - segment[0].x) / xSpan, 0, 1),
      y1: clamp((segment[1].y - segment[0].y) / ySpan, 0, 1),
      x2: clamp((segment[2].x - segment[0].x) / xSpan, 0, 1),
      y2: clamp((segment[2].y - segment[0].y) / ySpan, 0, 1),
    },
  }
}

function slicedBoundaryInterpolation<T extends { time: number; easing: TransformKeyframe['easing']; curve?: TransformKeyframe['curve'] }>(keyframes: T[], from: number, to: number, implicitStart = false): Pick<TransformKeyframe, 'easing' | 'curve'> {
  const tolerance = 1 / 1000
  const nextIndex = keyframes.findIndex((keyframe) => keyframe.time >= to - tolerance)
  if (nextIndex < 0) return { easing: 'linear', curve: undefined }
  const next = keyframes[nextIndex]
  const previousTime = nextIndex > 0 ? keyframes[nextIndex - 1].time : implicitStart ? 0 : undefined
  if (Math.abs(next.time - to) <= tolerance && (previousTime === undefined || from <= previousTime + tolerance)) return { easing: next.easing, curve: next.curve ? { ...next.curve } : undefined }
  if (previousTime === undefined || next.time <= previousTime + tolerance) return { easing: 'linear', curve: undefined }
  const span = next.time - previousTime
  const startProgress = clamp((Math.max(from, previousTime) - previousTime) / span, 0, 1)
  const endProgress = clamp((to - previousTime) / span, startProgress, 1)
  return sliceTemporalInterpolation(next.easing, next.curve, startProgress, endProgress)
}

export function sliceClipSpeed(clip: TimelineClip, fromLocal: number, toLocal: number): Pick<TimelineClip, 'sourceOffset' | 'playbackRate' | 'speedKeyframes'> {
  const from = Math.min(fromLocal, toLocal)
  const to = Math.max(fromLocal, toLocal)
  const extendedRate = (time: number) => time < 0 ? clipPlaybackRateAtLocal(clip, 0) : time > clip.duration ? clipPlaybackRateAtLocal(clip, clip.duration) : clipPlaybackRateAtLocal(clip, time)
  const extendedDelta = (time: number) => time < 0
    ? time * clipPlaybackRateAtLocal(clip, 0)
    : time > clip.duration
      ? clipSourceDuration(clip) + (time - clip.duration) * clipPlaybackRateAtLocal(clip, clip.duration)
      : clipSourceDelta(clip, time)
  const playbackRate = extendedRate(from)
  const sourceOffset = Math.max(0, clip.reverse
    ? clip.sourceOffset + clipSourceDuration(clip) - extendedDelta(to)
    : clip.sourceOffset + extendedDelta(from))
  const duration = to - from
  if (!(clip.speedKeyframes?.length) || duration <= 0.001) return { sourceOffset, playbackRate, speedKeyframes: undefined }
  const sorted = [...clip.speedKeyframes].sort((left, right) => left.time - right.time)
  const tolerance = 1 / 1000
  const interior = sorted.filter((keyframe) => keyframe.time > from + tolerance && keyframe.time < to - tolerance).map((keyframe) => ({ ...structuredClone(keyframe), time: keyframe.time - from }))
  if (interior.length) Object.assign(interior[0], slicedBoundaryInterpolation(sorted, from, from + interior[0].time, true))
  const exactEnd = sorted.find((keyframe) => Math.abs(keyframe.time - to) <= tolerance)
  const endInterpolation = slicedBoundaryInterpolation(sorted, from, to, true)
  const end: SpeedKeyframe = exactEnd
    ? { ...structuredClone(exactEnd), id: crypto.randomUUID(), time: duration, ...endInterpolation }
    : { id: crypto.randomUUID(), time: duration, rate: extendedRate(to), ...endInterpolation }
  const speedKeyframes = [...interior, end]
  return { sourceOffset, playbackRate, speedKeyframes }
}

export function sliceClipAutomation(clip: TimelineClip, fromLocal: number, toLocal: number): Partial<Pick<TimelineClip, 'transform' | 'keyframes' | 'motionPathAutoOrient' | 'motionPathOrientationOffset' | 'stabilization' | 'visualEffects' | 'visualKeyframes' | 'audioAdjustment' | 'audioMixKeyframes' | 'clipMarkers'>> {
  const from = Math.max(0, Math.min(clip.duration, Math.min(fromLocal, toLocal)))
  const to = Math.max(from, Math.min(clip.duration, Math.max(fromLocal, toLocal)))
  const duration = to - from
  const result: Partial<Pick<TimelineClip, 'transform' | 'keyframes' | 'motionPathAutoOrient' | 'motionPathOrientationOffset' | 'stabilization' | 'visualEffects' | 'visualKeyframes' | 'audioAdjustment' | 'audioMixKeyframes' | 'clipMarkers'>> = {}
  if (clip.clipMarkers?.length) {
    result.clipMarkers = clip.clipMarkers.flatMap((marker) => {
      if (!(marker.duration && marker.duration > 0)) {
        return marker.time >= from && (marker.time < to || to === clip.duration && marker.time <= to)
          ? [{ ...structuredClone(marker), id: crypto.randomUUID(), time: marker.time - from }]
          : []
      }
      const overlapStart = Math.max(from, marker.time)
      const overlapEnd = Math.min(to, marker.time + marker.duration)
      if (overlapEnd <= overlapStart) return []
      return [{ ...structuredClone(marker), id: crypto.randomUUID(), time: overlapStart - from, duration: overlapEnd - overlapStart }]
    })
  }
  if (clip.keyframes?.length) {
    const sorted = [...clip.keyframes].sort((left, right) => left.time - right.time)
    const tolerance = 1 / 1000
    const exactStart = sorted.find((keyframe) => Math.abs(keyframe.time - from) <= tolerance)
    const exactEnd = sorted.find((keyframe) => Math.abs(keyframe.time - to) <= tolerance)
    const endInterpolation = slicedBoundaryInterpolation(sorted, from, to)
    const transformClip = { ...clip, motionPathAutoOrient: false, transitionIn: undefined, transitionOut: undefined }
    const start: TransformKeyframe = exactStart
      ? { ...structuredClone(exactStart), id: crypto.randomUUID(), time: 0 }
      : { id: crypto.randomUUID(), time: 0, easing: 'linear', transform: resolveClipTransform(transformClip, clip.start + from) }
    const interior = sorted.filter((keyframe) => keyframe.time > from + tolerance && keyframe.time < to - tolerance).map((keyframe) => ({ ...structuredClone(keyframe), time: keyframe.time - from }))
    if (interior.length) Object.assign(interior[0], slicedBoundaryInterpolation(sorted, from, from + interior[0].time))
    const end: TransformKeyframe | undefined = duration <= tolerance ? undefined : exactEnd
      ? { ...structuredClone(exactEnd), id: crypto.randomUUID(), time: duration, ...endInterpolation }
      : { id: crypto.randomUUID(), time: duration, ...endInterpolation, transform: resolveClipTransform(transformClip, clip.start + to) }
    result.transform = { ...start.transform }
    result.keyframes = preserveSlicedSpatialTangents(end ? [start, ...interior, end] : [start], sorted, from)
    result.motionPathAutoOrient = clip.motionPathAutoOrient
    result.motionPathOrientationOffset = clip.motionPathOrientationOffset
  }
  if (clip.visualKeyframes?.length) {
    const sorted = [...clip.visualKeyframes].sort((left, right) => left.time - right.time)
    const tolerance = 1 / 1000
    const cloneEffects = (effects: VisualEffects): VisualEffects => ({ ...effects, maskPoints: effects.maskPoints?.map((point) => ({ ...point })), cornerPinPoints: effects.cornerPinPoints?.map((point) => ({ ...point })), masks: cloneEffectMasks(effects.masks) })
    const exactStart = sorted.find((keyframe) => Math.abs(keyframe.time - from) <= tolerance)
    const exactEnd = sorted.find((keyframe) => Math.abs(keyframe.time - to) <= tolerance)
    const endInterpolation = slicedBoundaryInterpolation(sorted, from, to)
    const start: VisualEffectKeyframe = exactStart
      ? { ...structuredClone(exactStart), id: crypto.randomUUID(), time: 0 }
      : { id: crypto.randomUUID(), time: 0, easing: 'linear', effects: cloneEffects(resolveVisualEffects(clip, clip.start + from)) }
    const interior = sorted.filter((keyframe) => keyframe.time > from + tolerance && keyframe.time < to - tolerance).map((keyframe) => ({ ...structuredClone(keyframe), time: keyframe.time - from }))
    if (interior.length) Object.assign(interior[0], slicedBoundaryInterpolation(sorted, from, from + interior[0].time))
    const end: VisualEffectKeyframe | undefined = duration <= tolerance ? undefined : exactEnd
      ? { ...structuredClone(exactEnd), id: crypto.randomUUID(), time: duration, ...endInterpolation }
      : { id: crypto.randomUUID(), time: duration, ...endInterpolation, effects: cloneEffects(resolveVisualEffects(clip, clip.start + to)) }
    result.visualEffects = cloneEffects(start.effects)
    result.visualKeyframes = end ? [start, ...interior, end] : [start]
  }
  if (clip.audioMixKeyframes?.length) {
    const sorted = [...clip.audioMixKeyframes].sort((left, right) => left.time - right.time)
    const tolerance = 1 / 1000
    const exactStart = sorted.find((keyframe) => Math.abs(keyframe.time - from) <= tolerance)
    const exactEnd = sorted.find((keyframe) => Math.abs(keyframe.time - to) <= tolerance)
    const endInterpolation = slicedBoundaryInterpolation(sorted, from, to)
    const startMix = resolveClipAudioMix(clip, clip.start + from)
    const start: AudioMixKeyframe = exactStart ? { ...structuredClone(exactStart), id: crypto.randomUUID(), time: 0 } : { id: crypto.randomUUID(), time: 0, easing: 'linear', ...startMix }
    const interior = sorted.filter((keyframe) => keyframe.time > from + tolerance && keyframe.time < to - tolerance).map((keyframe) => ({ ...structuredClone(keyframe), time: keyframe.time - from }))
    if (interior.length) Object.assign(interior[0], slicedBoundaryInterpolation(sorted, from, from + interior[0].time))
    const end: AudioMixKeyframe | undefined = duration <= tolerance ? undefined : exactEnd
      ? { ...structuredClone(exactEnd), id: crypto.randomUUID(), time: duration, ...endInterpolation }
      : { id: crypto.randomUUID(), time: duration, ...endInterpolation, ...resolveClipAudioMix(clip, clip.start + to) }
    result.audioAdjustment = { ...defaultAudioAdjustment(), ...clip.audioAdjustment, gainDb: start.gainDb, pan: start.pan }
    result.audioMixKeyframes = end ? [start, ...interior, end] : [start]
  }
  if (clip.stabilization) {
    const originalSlice = sliceClipAutomation({ ...clip, transform: clip.stabilization.originalTransform, keyframes: clip.stabilization.originalKeyframes, stabilization: undefined }, from, to)
    result.stabilization = {
      ...structuredClone(clip.stabilization),
      originalTransform: originalSlice.transform ?? structuredClone(clip.stabilization.originalTransform),
      originalKeyframes: originalSlice.keyframes,
    }
  }
  return result
}

export function resolveClipTransform(clip: TimelineClip, timelineTime: number): ClipTransform {
  const base = { ...defaultTransform, ...clip.transform }
  const keyframes = [...(clip.keyframes ?? [])].sort((a, b) => a.time - b.time)
  if (!keyframes.length) return { ...base, opacity: base.opacity * transitionOpacity(clip, timelineTime) }
  const localTime = Math.max(0, timelineTime - clip.start)
  const nextIndex = keyframes.findIndex((keyframe) => keyframe.time >= localTime)
  if (nextIndex === 0) {
    const first = { ...defaultTransform, ...keyframes[0].transform }
    const direction = clip.motionPathAutoOrient && keyframes.length > 1 ? spatialPathDirection(keyframes[0], keyframes[1], 0) : undefined
    if (direction !== undefined) first.rotation += direction + (clip.motionPathOrientationOffset ?? 0)
    return { ...first, opacity: first.opacity * transitionOpacity(clip, timelineTime) }
  }
  if (nextIndex < 0) {
    const last = { ...defaultTransform, ...keyframes[keyframes.length - 1].transform }
    const direction = clip.motionPathAutoOrient && keyframes.length > 1 ? spatialPathDirection(keyframes[keyframes.length - 2], keyframes[keyframes.length - 1], 1) : undefined
    if (direction !== undefined) last.rotation += direction + (clip.motionPathOrientationOffset ?? 0)
    return { ...last, opacity: last.opacity * transitionOpacity(clip, timelineTime) }
  }
  const previous = keyframes[nextIndex - 1]
  const next = keyframes[nextIndex]
  const span = Math.max(0.001, next.time - previous.time)
  const progress = applyEasing((localTime - previous.time) / span, next.easing, next.curve)
  const curvedPosition = previous.spatialOut || next.spatialIn
    ? {
        x: cubicSpatialCoordinate(previous.transform.positionX, previous.transform.positionX + (previous.spatialOut?.x ?? (next.transform.positionX - previous.transform.positionX) / 3), next.transform.positionX + (next.spatialIn?.x ?? -(next.transform.positionX - previous.transform.positionX) / 3), next.transform.positionX, progress),
        y: cubicSpatialCoordinate(previous.transform.positionY, previous.transform.positionY + (previous.spatialOut?.y ?? (next.transform.positionY - previous.transform.positionY) / 3), next.transform.positionY + (next.spatialIn?.y ?? -(next.transform.positionY - previous.transform.positionY) / 3), next.transform.positionY, progress),
      }
    : undefined
  const pathDirection = clip.motionPathAutoOrient ? spatialPathDirection(previous, next, progress) : undefined
  const transform = {
    positionX: curvedPosition?.x ?? interpolate(previous.transform.positionX, next.transform.positionX, progress),
    positionY: curvedPosition?.y ?? interpolate(previous.transform.positionY, next.transform.positionY, progress),
    scale: interpolate(previous.transform.scale, next.transform.scale, progress),
    scaleX: interpolate(previous.transform.scaleX ?? 100, next.transform.scaleX ?? 100, progress),
    scaleY: interpolate(previous.transform.scaleY ?? 100, next.transform.scaleY ?? 100, progress),
    anchorX: interpolate(previous.transform.anchorX ?? 50, next.transform.anchorX ?? 50, progress),
    anchorY: interpolate(previous.transform.anchorY ?? 50, next.transform.anchorY ?? 50, progress),
    skewX: interpolate(previous.transform.skewX ?? 0, next.transform.skewX ?? 0, progress),
    skewY: interpolate(previous.transform.skewY ?? 0, next.transform.skewY ?? 0, progress),
    rotation: interpolate(previous.transform.rotation, next.transform.rotation, progress) + (pathDirection === undefined ? 0 : pathDirection + (clip.motionPathOrientationOffset ?? 0)),
    opacity: interpolate(previous.transform.opacity, next.transform.opacity, progress),
  }
  transform.opacity *= transitionOpacity(clip, timelineTime)
  return transform
}

function cubicSpatialCoordinate(start: number, firstControl: number, secondControl: number, end: number, progress: number): number {
  const t = Math.max(0, Math.min(1, progress))
  const inverse = 1 - t
  return inverse ** 3 * start + 3 * inverse ** 2 * t * firstControl + 3 * inverse * t ** 2 * secondControl + t ** 3 * end
}

function spatialPathDirection(previous: NonNullable<TimelineClip['keyframes']>[number], next: NonNullable<TimelineClip['keyframes']>[number], progress: number): number | undefined {
  const deltaX = next.transform.positionX - previous.transform.positionX
  const deltaY = next.transform.positionY - previous.transform.positionY
  if (!previous.spatialOut && !next.spatialIn) return Math.hypot(deltaX, deltaY) > 0.0001 ? Math.atan2(deltaY, deltaX) * 180 / Math.PI : undefined
  const firstX = previous.transform.positionX + (previous.spatialOut?.x ?? deltaX / 3)
  const firstY = previous.transform.positionY + (previous.spatialOut?.y ?? deltaY / 3)
  const secondX = next.transform.positionX + (next.spatialIn?.x ?? -deltaX / 3)
  const secondY = next.transform.positionY + (next.spatialIn?.y ?? -deltaY / 3)
  const t = Math.max(0, Math.min(1, progress))
  const inverse = 1 - t
  const derivativeX = 3 * inverse ** 2 * (firstX - previous.transform.positionX) + 6 * inverse * t * (secondX - firstX) + 3 * t ** 2 * (next.transform.positionX - secondX)
  const derivativeY = 3 * inverse ** 2 * (firstY - previous.transform.positionY) + 6 * inverse * t * (secondY - firstY) + 3 * t ** 2 * (next.transform.positionY - secondY)
  return Math.hypot(derivativeX, derivativeY) > 0.0001 ? Math.atan2(derivativeY, derivativeX) * 180 / Math.PI : undefined
}

export function transitionOpacity(clip: TimelineClip, timelineTime: number): number {
  const localTime = Math.max(0, timelineTime - clip.start)
  const remaining = Math.max(0, clip.start + clip.duration - timelineTime)
  let opacity = 1
  const fades = (type: NonNullable<TimelineClip['transitionIn']>['type']) => !['none', 'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'slide-left', 'slide-right', 'zoom'].includes(type)
  if (clip.transitionIn?.type && fades(clip.transitionIn.type) && (clip.transitionIn?.duration ?? 0) > 0) {
    opacity *= transitionProgress(clip.transitionIn, transitionInRawProgress(clip.transitionIn, localTime))
  }
  if (clip.transitionOut?.type && fades(clip.transitionOut.type) && (clip.transitionOut?.duration ?? 0) > 0) {
    opacity *= transitionProgress(clip.transitionOut, transitionOutRawProgress(clip.transitionOut, remaining))
  }
  return opacity
}

export interface ClipTransitionState {
  type: NonNullable<TimelineClip['transitionIn']>['type']
  progress: number
  translateX: number
  translateY: number
  scale: number
  blur: number
}

export function resolveClipTransitionState(clip: TimelineClip, timelineTime: number): ClipTransitionState {
  const localTime = Math.max(0, timelineTime - clip.start)
  const remaining = Math.max(0, clip.start + clip.duration - timelineTime)
  type ActiveTransition = { transition: NonNullable<TimelineClip['transitionIn']>; type: Exclude<NonNullable<TimelineClip['transitionIn']>['type'], 'none'>; progress: number }
  const candidates: ActiveTransition[] = []
  if (clip.transitionIn && clip.transitionIn.type !== 'none' && clip.transitionIn.duration > 0) {
    const progress = transitionInRawProgress(clip.transitionIn, localTime)
    if (progress < 1) candidates.push({ transition: clip.transitionIn, type: clip.transitionIn.type, progress })
  }
  if (clip.transitionOut && clip.transitionOut.type !== 'none' && clip.transitionOut.duration > 0) {
    const progress = transitionOutRawProgress(clip.transitionOut, remaining)
    if (progress < 1) candidates.push({ transition: clip.transitionOut, type: clip.transitionOut.type, progress })
  }
  const active = candidates.sort((left, right) => left.progress - right.progress)[0]
  if (!active) return { type: 'none', progress: 1, translateX: 0, translateY: 0, scale: 1, blur: 0 }
  const eased = transitionProgress(active.transition, active.progress)
  const distance = 1 - eased
  return {
    type: active.type,
    progress: eased,
    translateX: active.type === 'slide-left' ? -distance : active.type === 'slide-right' ? distance : 0,
    translateY: 0,
    scale: active.type === 'zoom' ? 0.72 + eased * 0.28 : 1,
    blur: active.type === 'blur-dissolve' ? distance * 18 : 0,
  }
}

export function transitionAudioGain(clip: TimelineClip, timelineTime: number): number {
  const localTime = Math.max(0, timelineTime - clip.start)
  const remaining = Math.max(0, clip.start + clip.duration - timelineTime)
  const active = [
    clip.transitionIn && clip.transitionIn.type !== 'none' && clip.transitionIn.duration > 0 ? { transition: clip.transitionIn, progress: transitionInRawProgress(clip.transitionIn, localTime) } : undefined,
    clip.transitionOut && clip.transitionOut.type !== 'none' && clip.transitionOut.duration > 0 ? { transition: clip.transitionOut, progress: transitionOutRawProgress(clip.transitionOut, remaining) } : undefined,
  ].filter((candidate): candidate is { transition: NonNullable<TimelineClip['transitionIn']>; progress: number } => Boolean(candidate && candidate.progress < 1)).sort((left, right) => left.progress - right.progress)[0]
  if (!active) return 1
  const progress = transitionProgress(active.transition, active.progress)
  return audioFadeCurveGain(progress, active.transition.audioCurve ?? 'equal-power')
}

function transitionProgress(transition: NonNullable<TimelineClip['transitionIn']>, rawProgress: number): number {
  const progress = Math.max(0, Math.min(1, rawProgress))
  if (transition.easing === 'bezier') return cubicBezierProgress(progress, transition.curve)
  if (transition.easing === 'ease-in') return progress * progress
  if (transition.easing === 'ease-out') return 1 - (1 - progress) ** 2
  if (transition.easing === 'linear') return progress
  return progress * progress * (3 - 2 * progress)
}

function transitionInRawProgress(transition: NonNullable<TimelineClip['transitionIn']>, localTime: number): number {
  const duration = Math.max(0.000001, transition.duration)
  const beforeCut = transition.alignment === 'end-at-cut' ? duration : transition.alignment === 'center-on-cut' ? duration / 2 : 0
  return (localTime + beforeCut) / duration
}

function transitionOutRawProgress(transition: NonNullable<TimelineClip['transitionOut']>, remaining: number): number {
  const duration = Math.max(0.000001, transition.duration)
  const afterCut = transition.alignment === 'start-at-cut' ? duration : transition.alignment === 'center-on-cut' ? duration / 2 : 0
  return (remaining + afterCut) / duration
}

export function colorFilter(adjustment?: ColorAdjustment): string {
  const value = { ...defaultColorAdjustment(), ...adjustment }
  const lut = lutFilter(value.lut, value.lutIntensity / 100)
  const exposure = Math.pow(2, value.exposure)
  const tonalBrightness = 1 + value.shadows / 400 + value.highlights / 800 + (value.lift ?? 0) / 250 + (value.gamma ?? 0) / 350 + (value.gain ?? 0) / 220 + (value.curveShadows ?? 0) / 450 + (value.curveMidtones ?? 0) / 350 + (value.curveHighlights ?? 0) / 300
  const brightness = Math.max(0, exposure * tonalBrightness)
  const fadeMix = Math.max(0, Math.min(100, value.fade ?? 0)) / 100
  const contrast = Math.max(0, (1 + value.contrast / 100 + ((value.curveHighlights ?? 0) - (value.curveShadows ?? 0)) / 240) * (1 - fadeMix * 0.42))
  const saturation = Math.max(0, 1 + value.saturation / 100 + (value.vibrance ?? 0) / 160 - fadeMix * 0.12)
  const hue = value.temperature * -0.22 + value.tint * 0.16 + (value.hue ?? 0)
  return `brightness(${brightness}) contrast(${contrast}) saturate(${saturation}) hue-rotate(${hue}deg) ${lut}`.trim()
}

export function visualFilter(adjustment?: ColorAdjustment, effects?: VisualEffects): string {
  const value = { ...defaultVisualEffects(), ...effects }
  const filters = [colorFilter(adjustment)]
  if (value.blur > 0) filters.push(`blur(${Math.max(0, value.blur)}px)`)
  if (value.shadowOpacity > 0) filters.push(`drop-shadow(${value.shadowX}px ${value.shadowY}px ${Math.max(0, value.shadowBlur)}px rgba(0,0,0,${Math.max(0, Math.min(1, value.shadowOpacity / 100))}))`)
  return filters.filter(Boolean).join(' ')
}

export function resolveVisualEffects(clip: TimelineClip, timelineTime: number): VisualEffects {
  const base = { ...defaultVisualEffects(), ...clip.visualEffects }
  const keyframes = [...(clip.visualKeyframes ?? [])].sort((a, b) => a.time - b.time)
  if (!keyframes.length) return base
  const localTime = Math.max(0, timelineTime - clip.start)
  const nextIndex = keyframes.findIndex((keyframe) => keyframe.time >= localTime)
  if (nextIndex === 0) return { ...defaultVisualEffects(), ...keyframes[0].effects }
  if (nextIndex < 0) return { ...defaultVisualEffects(), ...keyframes[keyframes.length - 1].effects }
  const previous = { ...defaultVisualEffects(), ...keyframes[nextIndex - 1].effects }
  const next = { ...defaultVisualEffects(), ...keyframes[nextIndex].effects }
  const previousFrame = keyframes[nextIndex - 1]
  const nextFrame = keyframes[nextIndex]
  const progress = applyEasing((localTime - previousFrame.time) / Math.max(0.001, nextFrame.time - previousFrame.time), nextFrame.easing, nextFrame.curve)
  const number = (from: number, to: number) => interpolate(from, to, progress)
  const points = previous.maskPoints?.length === next.maskPoints?.length ? previous.maskPoints?.map((point, index) => ({ x: number(point.x, next.maskPoints![index].x), y: number(point.y, next.maskPoints![index].y) })) : progress < 0.5 ? previous.maskPoints : next.maskPoints
  const cornerPinPoints = previous.cornerPinPoints?.length === 4 && next.cornerPinPoints?.length === 4
    ? previous.cornerPinPoints.map((point, index) => ({ x: number(point.x, next.cornerPinPoints![index].x), y: number(point.y, next.cornerPinPoints![index].y) }))
    : progress < 0.5 ? previous.cornerPinPoints : next.cornerPinPoints
  const masks = interpolateEffectMasks(previous.masks, next.masks, progress, number)
  return {
    ...base,
    cropTop: number(previous.cropTop, next.cropTop),
    cropRight: number(previous.cropRight, next.cropRight),
    cropBottom: number(previous.cropBottom, next.cropBottom),
    cropLeft: number(previous.cropLeft, next.cropLeft),
    blur: number(previous.blur, next.blur),
    shadowOpacity: number(previous.shadowOpacity, next.shadowOpacity),
    shadowBlur: number(previous.shadowBlur, next.shadowBlur),
    shadowX: number(previous.shadowX, next.shadowX),
    shadowY: number(previous.shadowY, next.shadowY),
    mosaicSize: number(previous.mosaicSize, next.mosaicSize),
    maskFeather: number(previous.maskFeather ?? 0, next.maskFeather ?? 0),
    chromaKeyTolerance: number(previous.chromaKeyTolerance ?? 32, next.chromaKeyTolerance ?? 32),
    chromaKeySoftness: number(previous.chromaKeySoftness ?? 18, next.chromaKeySoftness ?? 18),
    chromaSpill: number(previous.chromaSpill ?? 45, next.chromaSpill ?? 45),
    mask: progress < 0.5 ? previous.mask : next.mask,
    maskPoints: points,
    masks,
    maskInvert: progress < 0.5 ? previous.maskInvert : next.maskInvert,
    blendMode: progress < 0.5 ? previous.blendMode : next.blendMode,
    faceMosaic: progress < 0.5 ? previous.faceMosaic : next.faceMosaic,
    chromaKeyEnabled: progress < 0.5 ? previous.chromaKeyEnabled : next.chromaKeyEnabled,
    chromaKeyColor: progress < 0.5 ? previous.chromaKeyColor : next.chromaKeyColor,
    cornerPinEnabled: progress < 0.5 ? previous.cornerPinEnabled : next.cornerPinEnabled,
    cornerPinPoints,
  }
}

function cloneEffectMasks(masks?: EffectMask[]): EffectMask[] | undefined {
  return masks?.map((mask) => ({ ...mask, points: mask.points.map((point) => ({ ...point, inHandle: point.inHandle ? { ...point.inHandle } : undefined, outHandle: point.outHandle ? { ...point.outHandle } : undefined })) }))
}

function interpolateEffectMasks(previous: EffectMask[] | undefined, next: EffectMask[] | undefined, progress: number, number: (from: number, to: number) => number): EffectMask[] | undefined {
  if (!previous?.length && !next?.length) return undefined
  if (!previous || !next || previous.length !== next.length || previous.some((mask, index) => mask.id !== next[index]?.id || mask.points.length !== next[index]?.points.length)) return cloneEffectMasks(progress < 0.5 ? previous : next)
  const interpolateHandle = (from?: MaskPoint['inHandle'], to?: MaskPoint['inHandle']) => from && to ? { x: number(from.x, to.x), y: number(from.y, to.y) } : progress < 0.5 ? from && { ...from } : to && { ...to }
  return previous.map((mask, index) => {
    const target = next[index]
    return {
      ...mask,
      name: progress < 0.5 ? mask.name : target.name,
      shape: progress < 0.5 ? mask.shape : target.shape,
      feather: number(mask.feather, target.feather),
      opacity: number(mask.opacity, target.opacity),
      invert: progress < 0.5 ? mask.invert : target.invert,
      operation: progress < 0.5 ? mask.operation : target.operation,
      enabled: progress < 0.5 ? mask.enabled : target.enabled,
      points: mask.points.map((point, pointIndex) => ({ x: number(point.x, target.points[pointIndex].x), y: number(point.y, target.points[pointIndex].y), inHandle: interpolateHandle(point.inHandle, target.points[pointIndex].inHandle), outHandle: interpolateHandle(point.outHandle, target.points[pointIndex].outHandle) })),
    }
  })
}

export function visualClipPath(effects?: VisualEffects): string | undefined {
  const value = { ...defaultVisualEffects(), ...effects }
  const top = Math.max(0, Math.min(49, value.cropTop))
  const right = Math.max(0, Math.min(49, value.cropRight))
  const bottom = Math.max(0, Math.min(49, value.cropBottom))
  const left = Math.max(0, Math.min(49, value.cropLeft))
  if (value.mask === 'polygon' && (value.maskPoints?.length ?? 0) >= 3) return `polygon(${value.maskPoints!.map((point) => `${Math.max(0, Math.min(100, point.x))}% ${Math.max(0, Math.min(100, point.y))}%`).join(', ')})`
  if (value.mask === 'ellipse') return `ellipse(${Math.max(1, 50 - (left + right) / 2)}% ${Math.max(1, 50 - (top + bottom) / 2)}% at 50% 50%)`
  if (value.mask === 'rounded') return `inset(${top}% ${right}% ${bottom}% ${left}% round 9%)`
  if (top || right || bottom || left) return `inset(${top}% ${right}% ${bottom}% ${left}%)`
  return undefined
}

export function gainFromDb(db: number): number {
  return Math.pow(10, Math.max(-60, Math.min(24, db)) / 20)
}

export function resolveAdrCompGain(clip: TimelineClip, timelineTime: number, crossfade = 0.012): number {
  if (!clip.adrCompRanges) return 1
  if (!clip.adrCompRanges.length) return 0
  return clip.adrCompRanges.reduce((maximum, range) => {
    if (timelineTime < range.start - crossfade || timelineTime >= range.end + crossfade) return maximum
    const fadeIn = Math.max(0, Math.min(1, (timelineTime - (range.start - crossfade)) / (crossfade * 2)))
    const fadeOut = Math.max(0, Math.min(1, ((range.end + crossfade) - timelineTime) / (crossfade * 2)))
    return Math.max(maximum, Math.min(fadeIn, fadeOut))
  }, 0)
}

function lutFilter(preset: ColorAdjustment['lut'], intensity: number): string {
  const mix = Math.max(0, Math.min(1, intensity))
  if (preset === 'cinematic') return `contrast(${1 + 0.16 * mix}) saturate(${1 - 0.08 * mix}) sepia(${0.08 * mix})`
  if (preset === 'warm') return `sepia(${0.18 * mix}) saturate(${1 + 0.16 * mix})`
  if (preset === 'cool') return `hue-rotate(${12 * mix}deg) saturate(${1 + 0.08 * mix})`
  if (preset === 'mono') return `grayscale(${mix}) contrast(${1 + 0.08 * mix})`
  return ''
}

function interpolate(from: number, to: number, progress: number): number {
  return from + (to - from) * Math.max(0, Math.min(1, progress))
}

function applyEasing(progress: number, easing: 'linear' | 'hold' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'bezier', curve?: { x1: number; y1: number; x2: number; y2: number }): number {
  const value = Math.max(0, Math.min(1, progress))
  if (easing === 'hold') return value >= 1 ? 1 : 0
  if (easing === 'bezier') return cubicBezierProgress(value, curve)
  if (easing === 'ease-in') return value * value
  if (easing === 'ease-out') return 1 - (1 - value) ** 2
  if (easing === 'ease-in-out') return value < 0.5 ? 2 * value * value : 1 - (-2 * value + 2) ** 2 / 2
  return value
}
