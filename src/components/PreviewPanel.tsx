import { Maximize2, Minimize2, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { audioFadeCurveGain, clipNeedsPitchStretch, clipPlaybackRateAt, clipSourceTime, createCompressorCurve, createLimiterCurve, createMasterSoftClipCurve, createNoiseGateCurve, defaultAudioAdjustment, defaultCaptionStyle, defaultVisualEffects, gainFromDb, hasSourceMasterVisualProcessing, imageSequenceUrlAt, peakNormalizationGain, resolveAdrCompGain, resolveClipAudioMix, resolveClipTransform, resolveTrackAudioMix, resolveVisualEffects, sourceMasterAudio, sourceMasterColor, sourceMasterVisualEffects, transitionAudioGain, visualClipPath, visualFilter } from '../editor/effects'
import { applyChromaKey } from '../editor/chroma'
import { applyCanvasMask, requiresCanvasMask } from '../editor/mask'
import { applyColorCurves, applyColorQualifier, colorCurveTableValues, hasColorQualifier, hasCustomColorCurves } from '../editor/colorCurves'
import { applyBaseColorFilter, applyColorNodeGraph } from '../editor/colorNodes'
import { applyAdjustmentLayer, applyTrackMatteCanvas, drawCaption, drawVisual } from '../media/export'
import { formatTimecode } from '../editor/format'
import { formatMediaTimecode } from '../media/timecode'
import { audioRoles, isAudioBusActive, resolveAudioAuxSends } from '../editor/audioBuses'
import { AUDIO_EQ_FREQUENCIES, AUDIO_EQ_Q } from '../editor/audioDsp'
import { createTimeMappedAudioPreviewDecoder, type TimeMappedAudioPreviewDecoder } from '../media/timeMappedAudioPreview'
import { drawInterpretedSource, hasSourceInterpretation, interpretNormalizedPoint } from '../editor/sourceInterpretation'
import type { AudioBusMap, AudioBusSettings, AudioRole, MediaAsset, SequencePreset, TimelineClip, TimelineTrack } from '../editor/types'
import { drawMotionCompensatedFrame } from '../media/frameInterpolation'
import { applyCornerPin } from '../editor/cornerPin'

interface PreviewLayer {
  clip: TimelineClip
  asset: MediaAsset
  trackId: string
  matteOnly?: boolean
  order: number
}

interface PreviewAudioLayer {
  clip: TimelineClip
  asset: MediaAsset
  track: TimelineTrack
}

function safeControlSkew(transform?: { skewX?: number; skewY?: number }): { x: number; y: number; determinant: number } {
  let x = Math.tan(Math.max(-85, Math.min(85, transform?.skewX ?? 0)) * Math.PI / 180)
  let y = Math.tan(Math.max(-85, Math.min(85, transform?.skewY ?? 0)) * Math.PI / 180)
  let determinant = 1 - x * y
  if (Math.abs(determinant) < 0.001) {
    if (Math.abs(x) > 0.001) y = (1 - (Math.sign(determinant) || 1) * 0.001) / x
    else x = (1 - (Math.sign(determinant) || 1) * 0.001) / Math.max(0.001, y)
    determinant = 1 - x * y
  }
  return { x, y, determinant }
}

interface MulticamPreviewAngle {
  index: number
  name: string
  asset?: MediaAsset
  sourceTime: number
  active: boolean
}

interface PreviewPanelProps {
  preset: SequencePreset
  fps: number
  timecodeStart?: number
  timecodeDropFrame?: boolean
  asset?: MediaAsset
  layers: PreviewLayer[]
  adjustmentClips: TimelineClip[]
  audioLayers: PreviewAudioLayer[]
  audioBuses: AudioBusMap
  captionClips: TimelineClip[]
  sourceTime: number
  syncKey: string
  playhead: number
  duration: number
  isPlaying: boolean
  playbackRate: number
  onTogglePlayback: () => void
  onShuttleReverse: () => void
  onShuttleStop: () => void
  onShuttleForward: () => void
  onSeek: (time: number) => void
  onInsertSource?: () => void
  onOverwriteSource?: () => void
  onReplaceSelectedClip?: () => void
  onFitToFill?: () => void
  sourceIn?: number
  sourceOut?: number
  onMarkIn?: () => void
  onMarkOut?: () => void
  onClearSourceRange?: () => void
  onReverseMatchFrame?: () => void
  onProgramFrame?: (canvas: HTMLCanvasElement, revision: number) => void
  referenceFrame?: ImageData
  comparisonEnabled?: boolean
  comparisonMode?: 'wipe' | 'split'
  comparisonPosition?: number
  onCaptureReference?: () => void
  onToggleComparison?: () => void
  onComparisonModeChange?: (mode: 'wipe' | 'split') => void
  onComparisonPositionChange?: (position: number) => void
  onExportFrame?: (format: 'png' | 'jpeg') => void
  multicamAngles?: MulticamPreviewAngle[]
  multicamAngleCount?: number
  onSwitchMulticamAngle?: (angle: number) => void
  selectedClip?: TimelineClip
  selectedClipLocked?: boolean
  onUpdateSelectedClip?: (id: string, patch: Partial<TimelineClip>) => void
}

interface MediaSyncOptions {
  playing?: boolean
  playbackRate?: number
}

type MonitorAssistMode = 'normal' | 'false-color' | 'zebra-70' | 'zebra-100' | 'video-levels'
interface MonitorOverlaySettings { actionSafe: boolean; titleSafe: boolean; thirds: boolean; center: boolean; timecode: boolean }

function readMonitorOverlays(): MonitorOverlaySettings {
  const defaults: MonitorOverlaySettings = { actionSafe: true, titleSafe: false, thirds: false, center: false, timecode: false }
  try { return { ...defaults, ...JSON.parse(localStorage.getItem('editweave.monitor-overlays.v1') ?? '{}') } } catch { return defaults }
}

function applyMonitorAssist(context: CanvasRenderingContext2D, width: number, height: number, mode: MonitorAssistMode): void {
  if (mode === 'normal') return
  const frame = context.getImageData(0, 0, width, height)
  const data = frame.data
  for (let index = 0; index < data.length; index += 4) {
    const pixel = index / 4
    const x = pixel % width
    const y = Math.floor(pixel / width)
    const red = data[index]
    const green = data[index + 1]
    const blue = data[index + 2]
    const luma = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255
    if (mode === 'false-color') {
      const color = luma < .025 ? [74, 22, 104] : luma < .08 ? [35, 47, 174] : luma < .18 ? [42, 137, 200] : luma < .38 ? [66, 154, 137] : luma < .58 ? [118, 118, 118] : luma < .72 ? [111, 190, 92] : luma < .88 ? [235, 161, 74] : luma < .97 ? [246, 220, 72] : [225, 45, 63]
      data[index] = color[0]
      data[index + 1] = color[1]
      data[index + 2] = color[2]
      continue
    }
    const threshold = mode === 'zebra-70' ? .70 : mode === 'zebra-100' ? .98 : 2
    if ((mode === 'zebra-70' || mode === 'zebra-100') && luma >= threshold) {
      const stripe = (Math.floor(x / 5) + Math.floor(y / 5)) % 2 === 0
      data[index] = stripe ? 245 : Math.round(red * .32)
      data[index + 1] = stripe ? 245 : Math.round(green * .32)
      data[index + 2] = stripe ? 245 : Math.round(blue * .32)
    } else if (mode === 'video-levels' && (Math.min(red, green, blue) < 16 || Math.max(red, green, blue) > 235)) {
      data[index] = 236
      data[index + 1] = (x + y) % 8 < 4 ? 32 : 74
      data[index + 2] = 186
    }
  }
  context.putImageData(frame, 0, 0)
}

const pendingMediaSync = new WeakMap<HTMLMediaElement, { time: number; options: MediaSyncOptions }>()
const pendingMediaSyncListeners = new WeakSet<HTMLMediaElement>()
const MIN_MEDIA_PLAYBACK_RATE = 0.25

function syncMedia(element: HTMLMediaElement, time: number, options: MediaSyncOptions = {}) {
  if (!Number.isFinite(time)) return
  if (element.readyState === 0) {
    pendingMediaSync.set(element, { time, options })
    if (!pendingMediaSyncListeners.has(element)) {
      pendingMediaSyncListeners.add(element)
      element.addEventListener('loadedmetadata', () => {
        pendingMediaSyncListeners.delete(element)
        const pending = pendingMediaSync.get(element)
        pendingMediaSync.delete(element)
        if (pending) syncMedia(element, pending.time, pending.options)
      }, { once: true })
    }
    return
  }
  const safeTime = Math.max(0, Math.min(time, Number.isFinite(element.duration) ? Math.max(0, element.duration - 0.01) : time))
  const intendedRate = Math.max(MIN_MEDIA_PLAYBACK_RATE, Math.min(16, options.playbackRate ?? 1))
  const drift = safeTime - element.currentTime
  if (!options.playing) {
    if (Math.abs(element.playbackRate - intendedRate) > 0.0001) element.playbackRate = intendedRate
    if (Math.abs(drift) > 1 / 240) {
      try { element.currentTime = safeTime } catch { return }
    }
    return
  }
  const hardThreshold = element instanceof HTMLAudioElement ? 0.075 : 0.12
  if (Math.abs(drift) > hardThreshold) {
    element.playbackRate = intendedRate
    try { element.currentTime = safeTime } catch { return }
    return
  }
  if (element instanceof HTMLVideoElement && Math.abs(drift) > 1 / 60) {
    const correction = Math.max(-0.02, Math.min(0.02, drift * 0.3))
    element.playbackRate = Math.max(MIN_MEDIA_PLAYBACK_RATE, Math.min(16, intendedRate * (1 + correction)))
  } else if (Math.abs(element.playbackRate - intendedRate) > 0.0001) {
    element.playbackRate = intendedRate
  }
}

function ProcessedVisualLayer({ layer, sourceTime, playbackRate, isPlaying, style, effects }: { layer: PreviewLayer; sourceTime: number; playbackRate: number; isPlaying: boolean; style: CSSProperties; effects: ReturnType<typeof resolveVisualEffects> }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const masterColor = sourceMasterColor(layer.asset)
  const masterEffects = sourceMasterVisualEffects(layer.asset)
  const processingKey = JSON.stringify({ interpretation: [layer.asset.sourceRotation, layer.asset.sourcePixelAspectRatio, layer.asset.sourceAlphaMode, layer.asset.sourceAlphaBackground], masterEnabled: layer.asset.masterEffectsEnabled, masterColor, masterEffects, effectStack: layer.clip.effectStack, crop: [effects.cropTop, effects.cropRight, effects.cropBottom, effects.cropLeft], mask: effects.mask, points: effects.maskPoints, feather: effects.maskFeather, invert: effects.maskInvert, masks: effects.masks, chroma: [effects.chromaKeyEnabled, effects.chromaKeyColor, effects.chromaKeyTolerance, effects.chromaKeySoftness, effects.chromaSpill], cornerPin: [effects.cornerPinEnabled, effects.cornerPinPoints], mosaic: [effects.faceMosaic, effects.mosaicSize], colorPixels: layer.clip.colorAdjustment })
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const forwardPlaying = isPlaying && !layer.clip.reverse && !layer.clip.freezeFrame
    syncMedia(video, sourceTime, { playing: forwardPlaying, playbackRate })
    if (forwardPlaying) void video.play().catch(() => undefined)
    else video.pause()
  }, [isPlaying, layer.clip.freezeFrame, layer.clip.reverse, playbackRate, sourceTime])

  useEffect(() => {
    let frame = 0
    const draw = () => {
      const canvas = canvasRef.current
      const source = layer.asset.kind === 'image' ? imageRef.current : videoRef.current
      if (!canvas || !source) return
      const sourceWidth = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
      const sourceHeight = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
      if (!sourceWidth || !sourceHeight) return
      const displayWidth = Math.max(2, canvas.clientWidth)
      const displayHeight = Math.max(2, canvas.clientHeight)
      const pixelScale = Math.min(2, window.devicePixelRatio || 1, 960 / Math.max(displayWidth, displayHeight))
      const width = Math.max(2, Math.round(displayWidth * pixelScale))
      const height = Math.max(2, Math.round(displayHeight * pixelScale))
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return
      context.clearRect(0, 0, width, height)
      const bounds = drawInterpretedSource(context, source, sourceWidth, sourceHeight, layer.asset, width / 2, height / 2, width, height)
      const { x: drawX, y: drawY, width: drawWidth, height: drawHeight } = bounds
      if (masterEffects) {
        applyChromaKey(context, width, height, { enabled: masterEffects.chromaKeyEnabled, color: masterEffects.chromaKeyColor, tolerance: masterEffects.chromaKeyTolerance, softness: masterEffects.chromaKeySoftness, spill: masterEffects.chromaSpill })
        applyBaseColorFilter(context, width, height, masterColor)
        applyColorCurves(context, width, height, masterColor)
        applyColorQualifier(context, width, height, masterColor, true)
        applyColorNodeGraph(context, width, height, masterColor)
        const masterFace = masterEffects.faceMosaic ? nearestFace(layer.asset.faceTrack, sourceTime) : undefined
        const interpretedMasterFace = masterFace ? interpretNormalizedPoint(layer.asset, masterFace.x, masterFace.y) : undefined
        if (interpretedMasterFace) drawPreviewMosaic(context, { x: drawX, y: drawY, width: drawWidth, height: drawHeight }, interpretedMasterFace.x, interpretedMasterFace.y, masterEffects.mosaicSize)
        applyCanvasMask(context, width, height, masterEffects, { x: drawX, y: drawY, width: drawWidth, height: drawHeight })
        applyCornerPin(context, { x: drawX, y: drawY, width: drawWidth, height: drawHeight }, masterEffects)
        if (layer.clip.effectStack !== undefined) applyPreviewCanvasFilter(context, visualFilter(undefined, masterEffects))
      }
      if (layer.clip.effectStack !== undefined) {
        applyPreviewEffectStack(context, layer, sourceTime, effects, { x: drawX, y: drawY, width: drawWidth, height: drawHeight })
      } else {
        applyChromaKey(context, width, height, { enabled: effects.chromaKeyEnabled, color: effects.chromaKeyColor, tolerance: effects.chromaKeyTolerance, softness: effects.chromaKeySoftness, spill: effects.chromaSpill })
        applyBaseColorFilter(context, width, height, layer.clip.colorAdjustment)
        applyColorCurves(context, width, height, layer.clip.colorAdjustment)
        applyColorQualifier(context, width, height, layer.clip.colorAdjustment, true)
        applyColorNodeGraph(context, width, height, layer.clip.colorAdjustment)
        const face = effects.faceMosaic ? nearestFace(layer.asset.faceTrack, sourceTime) : undefined
        const interpretedFace = face ? interpretNormalizedPoint(layer.asset, face.x, face.y) : undefined
        if (interpretedFace) drawPreviewMosaic(context, { x: drawX, y: drawY, width: drawWidth, height: drawHeight }, interpretedFace.x, interpretedFace.y, effects.mosaicSize)
        if (requiresCanvasMask(effects)) applyCanvasMask(context, width, height, effects, { x: drawX, y: drawY, width: drawWidth, height: drawHeight })
        applyCornerPin(context, { x: drawX, y: drawY, width: drawWidth, height: drawHeight }, effects)
      }
    }
    const loop = () => {
      draw()
      if (isPlaying) frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    const video = videoRef.current
    const image = imageRef.current
    video?.addEventListener('seeked', draw)
    video?.addEventListener('loadeddata', draw)
    image?.addEventListener('load', draw)
    return () => {
      cancelAnimationFrame(frame)
      video?.removeEventListener('seeked', draw)
      video?.removeEventListener('loadeddata', draw)
      image?.removeEventListener('load', draw)
    }
  }, [isPlaying, layer.asset.kind, layer.asset.url, processingKey, sourceTime])

  return <><canvas ref={canvasRef} className="visual-layer" style={style} aria-label={`${layer.asset.name} 처리 레이어`} />{layer.asset.kind === 'image' || layer.asset.imageSequenceUrls?.length ? <img ref={imageRef} className="chroma-source" src={imageSequenceUrlAt(layer.asset, sourceTime)} alt="" /> : <video ref={videoRef} className="chroma-source" src={layer.asset.url} playsInline muted />}</>
}

function applyPreviewCanvasFilter(context: CanvasRenderingContext2D, filter: string): void {
  if (!filter || filter === 'none') return
  const snapshot = document.createElement('canvas')
  snapshot.width = context.canvas.width
  snapshot.height = context.canvas.height
  snapshot.getContext('2d')?.drawImage(context.canvas, 0, 0)
  context.clearRect(0, 0, context.canvas.width, context.canvas.height)
  context.save()
  context.filter = filter
  context.drawImage(snapshot, 0, 0)
  context.restore()
}

function drawPreviewVignette(context: CanvasRenderingContext2D, amount: number): void {
  if (amount <= 0) return
  const width = context.canvas.width
  const height = context.canvas.height
  const gradient = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * .18, width / 2, height / 2, Math.max(width, height) * .72)
  gradient.addColorStop(0, 'rgba(0,0,0,0)')
  gradient.addColorStop(1, `rgba(0,0,0,${Math.min(.92, amount / 110)})`)
  context.save()
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)
  context.restore()
}

function applyPreviewEffectStack(context: CanvasRenderingContext2D, layer: PreviewLayer, sourceTime: number, effects: ReturnType<typeof resolveVisualEffects>, bounds: { x: number; y: number; width: number; height: number }): void {
  for (const item of layer.clip.effectStack ?? []) {
    if (!item.enabled) continue
    if (item.kind === 'chroma-key') {
      applyChromaKey(context, context.canvas.width, context.canvas.height, { enabled: effects.chromaKeyEnabled, color: effects.chromaKeyColor, tolerance: effects.chromaKeyTolerance, softness: effects.chromaKeySoftness, spill: effects.chromaSpill })
    } else if (item.kind === 'color-grade') {
      applyBaseColorFilter(context, context.canvas.width, context.canvas.height, layer.clip.colorAdjustment)
      applyColorCurves(context, context.canvas.width, context.canvas.height, layer.clip.colorAdjustment)
      applyColorQualifier(context, context.canvas.width, context.canvas.height, layer.clip.colorAdjustment, true)
      applyColorNodeGraph(context, context.canvas.width, context.canvas.height, layer.clip.colorAdjustment)
    } else if (item.kind === 'blur-shadow') {
      applyPreviewCanvasFilter(context, visualFilter(undefined, { ...defaultVisualEffects(), blur: effects.blur, shadowOpacity: effects.shadowOpacity, shadowBlur: effects.shadowBlur, shadowX: effects.shadowX, shadowY: effects.shadowY }))
    } else if (item.kind === 'crop-mask') {
      applyCanvasMask(context, context.canvas.width, context.canvas.height, effects, bounds)
    } else if (item.kind === 'corner-pin') {
      applyCornerPin(context, bounds, effects)
    } else if (item.kind === 'face-mosaic') {
      const face = effects.faceMosaic ? nearestFace(layer.asset.faceTrack, sourceTime) : undefined
      const interpretedFace = face ? interpretNormalizedPoint(layer.asset, face.x, face.y) : undefined
      if (interpretedFace) drawPreviewMosaic(context, bounds, interpretedFace.x, interpretedFace.y, effects.mosaicSize)
    } else if (item.kind === 'vignette') {
      drawPreviewVignette(context, layer.clip.colorAdjustment?.vignette ?? 0)
    }
  }
}

function drawPreviewMosaic(context: CanvasRenderingContext2D, bounds: { x: number; y: number; width: number; height: number }, faceX: number, faceY: number, sizePercent: number): void {
  const fraction = Math.max(0.05, Math.min(0.45, sizePercent / 100))
  const size = Math.min(bounds.width, bounds.height) * fraction
  const x = Math.max(bounds.x, Math.min(bounds.x + bounds.width - size, bounds.x + faceX * bounds.width - size / 2))
  const y = Math.max(bounds.y, Math.min(bounds.y + bounds.height - size, bounds.y + faceY * bounds.height - size / 2))
  const mosaic = document.createElement('canvas')
  mosaic.width = 16
  mosaic.height = 16
  const mosaicContext = mosaic.getContext('2d')
  if (!mosaicContext) return
  mosaicContext.drawImage(context.canvas, x, y, size, size, 0, 0, 16, 16)
  context.save()
  context.imageSmoothingEnabled = false
  context.drawImage(mosaic, x, y, size, size)
  context.restore()
}

function VisualLayer({ layer, playhead, isPlaying }: { layer: PreviewLayer; playhead: number; isPlaying: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const mosaicVideoRef = useRef<HTMLVideoElement>(null)
  const sourceTime = clipSourceTime(layer.clip, playhead)
  const playbackRate = clipPlaybackRateAt(layer.clip, playhead)
  const transform = resolveClipTransform(layer.clip, playhead)
  const transition = layer.clip.transitionIn?.type !== 'none' ? layer.clip.transitionIn?.type : layer.clip.transitionOut?.type
  const effects = resolveVisualEffects(layer.clip, playhead)
  const masterEffects = sourceMasterVisualEffects(layer.asset)
  const showQualifierMask = Boolean(layer.clip.colorAdjustment?.qualifierEnabled && layer.clip.colorAdjustment?.qualifierShowMask)
  const canvasMask = requiresCanvasMask(effects)
  const face = effects.faceMosaic ? nearestFace(layer.asset.faceTrack, sourceTime) : undefined
  let skewX = Math.tan(Math.max(-85, Math.min(85, transform.skewX ?? 0)) * Math.PI / 180)
  let skewY = Math.tan(Math.max(-85, Math.min(85, transform.skewY ?? 0)) * Math.PI / 180)
  const skewDeterminant = 1 - skewX * skewY
  if (Math.abs(skewDeterminant) < 0.001) {
    if (Math.abs(skewX) > 0.001) skewY = (1 - (Math.sign(skewDeterminant) || 1) * 0.001) / skewX
    else skewX = (1 - (Math.sign(skewDeterminant) || 1) * 0.001) / Math.max(0.001, skewY)
  }
  const style: CSSProperties = {
    zIndex: layer.order,
    transformOrigin: `${transform.anchorX ?? 50}% ${transform.anchorY ?? 50}%`,
    transform: `translate(${transform.positionX}px, ${transform.positionY}px) rotate(${transform.rotation}deg) matrix(1, ${skewY}, ${skewX}, 1, 0, 0) scale(${transform.scale / 100 * (transform.scaleX ?? 100) / 100}, ${transform.scale / 100 * (transform.scaleY ?? 100) / 100})`,
    opacity: transform.opacity / 100,
    filter: showQualifierMask ? 'none' : visualFilter(layer.clip.colorAdjustment, effects),
    mixBlendMode: effects.blendMode === 'normal' ? 'normal' : effects.blendMode,
    clipPath: canvasMask ? undefined : visualClipPath(effects),
    background: transition === 'dip-white' ? '#fff' : transition === 'dip-black' ? '#000' : undefined,
    boxShadow: !showQualifierMask && (layer.clip.colorAdjustment?.vignette ?? 0) > 0 ? `inset 0 0 ${Math.max(24, (layer.clip.colorAdjustment?.vignette ?? 0) * 1.8)}px rgba(0,0,0,${Math.min(0.88, (layer.clip.colorAdjustment?.vignette ?? 0) / 115)})` : undefined,
  }
  const mosaicStyle: CSSProperties | undefined = face ? {
    ...style,
    zIndex: layer.order + 0.1,
    clipPath: `circle(${Math.max(2.5, effects.mosaicSize / 2)}% at ${face.x * 100}% ${face.y * 100}%)`,
    filter: `${visualFilter(layer.clip.colorAdjustment)} blur(7px) contrast(1.18)`,
    mixBlendMode: effects.blendMode === 'normal' ? 'normal' : effects.blendMode,
  } : undefined
  const processedStyle: CSSProperties = layer.clip.effectStack !== undefined
    ? { ...style, filter: 'none', boxShadow: undefined, clipPath: undefined }
    : { ...style, filter: showQualifierMask ? 'none' : [visualFilter(undefined, masterEffects), visualFilter(undefined, effects)].filter(Boolean).join(' ') }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = Math.max(MIN_MEDIA_PLAYBACK_RATE, playbackRate)
    if (mosaicVideoRef.current) mosaicVideoRef.current.playbackRate = Math.max(MIN_MEDIA_PLAYBACK_RATE, playbackRate)
    if (isPlaying && !layer.clip.reverse && !layer.clip.freezeFrame) void video.play().catch(() => undefined)
    else video.pause()
    if (mosaicVideoRef.current) {
      if (isPlaying && !layer.clip.reverse && !layer.clip.freezeFrame) void mosaicVideoRef.current.play().catch(() => undefined)
      else mosaicVideoRef.current.pause()
    }
  }, [isPlaying, layer.asset.id, layer.clip.freezeFrame, layer.clip.reverse, playbackRate])

  useEffect(() => {
    const forwardPlaying = isPlaying && !layer.clip.reverse && !layer.clip.freezeFrame
    if (videoRef.current) syncMedia(videoRef.current, sourceTime, { playing: forwardPlaying, playbackRate })
    if (mosaicVideoRef.current) syncMedia(mosaicVideoRef.current, sourceTime, { playing: forwardPlaying, playbackRate })
  }, [isPlaying, layer.clip.freezeFrame, layer.clip.reverse, playbackRate, sourceTime])

  if (layer.clip.effectStack !== undefined || hasSourceInterpretation(layer.asset) || hasSourceMasterVisualProcessing(layer.asset) || effects.chromaKeyEnabled || effects.cornerPinEnabled || canvasMask || hasCustomColorCurves(layer.clip.colorAdjustment) || hasColorQualifier(layer.clip.colorAdjustment) || Boolean(layer.clip.colorAdjustment?.colorNodes?.length) || Boolean(layer.clip.colorAdjustment?.customLut)) return <ProcessedVisualLayer layer={layer} sourceTime={sourceTime} playbackRate={playbackRate} isPlaying={isPlaying} style={processedStyle} effects={effects} />
  if (layer.asset.kind === 'image' || layer.asset.imageSequenceUrls?.length) { const frameUrl = imageSequenceUrlAt(layer.asset, sourceTime); return <><img className="visual-layer" src={frameUrl} style={style} alt="" />{mosaicStyle && <img className="visual-layer" src={frameUrl} style={mosaicStyle} alt="" />}</> }
  return <><video className="visual-layer" ref={videoRef} src={layer.asset.url} playsInline muted style={style} aria-label={`${layer.asset.name} 프로그램 레이어`} />{mosaicStyle && <video className="visual-layer" ref={mosaicVideoRef} src={layer.asset.url} playsInline muted style={mosaicStyle} aria-hidden />}</>
}

function nearestFace(points: MediaAsset['faceTrack'], time: number): NonNullable<MediaAsset['faceTrack']>[number] | undefined {
  if (!points?.length) return undefined
  return points.reduce((nearest, point) => Math.abs(point.time - time) < Math.abs(nearest.time - time) ? point : nearest, points[0])
}

function captionMotion(clip: TimelineClip, playhead: number, animation: NonNullable<ReturnType<typeof defaultCaptionStyle>['animation']>, duration: number): { opacity: number; translateY: number; scale: number } {
  if (animation === 'none') return { opacity: 1, translateY: 0, scale: 1 }
  const progress = Math.max(0, Math.min(1, (playhead - clip.start) / Math.max(0.05, duration)))
  const eased = 1 - (1 - progress) ** 3
  if (animation === 'fade') return { opacity: eased, translateY: 0, scale: 1 }
  if (animation === 'pop') return { opacity: eased, translateY: 0, scale: 0.72 + eased * 0.28 }
  return { opacity: eased, translateY: (1 - eased) * 22, scale: 1 }
}

interface PreviewBusBranch {
  sendGain: GainNode
}

interface PreviewAudioGraph {
  input: GainNode
  channelNodes: AudioNode[]
  fader: GainNode
  duck: GainNode
  panner: StereoPannerNode
  gate: WaveShaperNode
  highpass: BiquadFilterNode
  low: BiquadFilterNode
  mid: BiquadFilterNode
  high: BiquadFilterNode
  voice: BiquadFilterNode
  deEsser: BiquadFilterNode
  masterHumFundamental: BiquadFilterNode
  masterHumHarmonic: BiquadFilterNode
  humFundamental: BiquadFilterNode
  humHarmonic: BiquadFilterNode
  compressor: WaveShaperNode
  limiter: WaveShaperNode
  primary?: PreviewBusBranch
  preSends: Map<string, PreviewBusBranch>
  postSends: Map<string, PreviewBusBranch>
}

interface PreviewAudioEngine {
  id: string
  context: AudioContext
  busInputs: Map<AudioRole, GainNode>
  outputGain: GainNode
  meters: {
    preLeft: AnalyserNode
    preRight: AnalyserNode
    postLeft: AnalyserNode
    postRight: AnalyserNode
  }
}

const mediaElementAudioSources = new WeakMap<HTMLMediaElement, {
  context: AudioContext
  source: MediaElementAudioSourceNode
}>()

export function getOrCreateMediaElementAudioSource(context: AudioContext, element: HTMLMediaElement): MediaElementAudioSourceNode {
  const existing = mediaElementAudioSources.get(element)
  if (existing) {
    if (existing.context !== context) throw new Error('오디오 미리보기 엘리먼트가 이전 오디오 엔진에 연결되어 있습니다.')
    return existing.source
  }
  const source = context.createMediaElementSource(element)
  mediaElementAudioSources.set(element, { context, source })
  return source
}

function connectStereoMeterTap(context: AudioContext, input: AudioNode): { left: AnalyserNode; right: AnalyserNode } {
  const splitter = context.createChannelSplitter(2)
  const left = context.createAnalyser()
  const right = context.createAnalyser()
  left.fftSize = 2_048
  right.fftSize = 2_048
  const silentSink = context.createGain()
  silentSink.gain.value = 0
  input.connect(splitter)
  splitter.connect(left, 0).connect(silentSink)
  splitter.connect(right, 1).connect(silentSink)
  silentSink.connect(context.destination)
  return { left, right }
}

function connectPreviewBusInput(context: AudioContext, input: AudioNode, busInput: AudioNode, sendLevel: number): PreviewBusBranch {
  const sendGain = context.createGain()
  sendGain.gain.value = sendLevel
  input.connect(sendGain).connect(busInput)
  return { sendGain }
}

function connectPreviewBusProcessing(context: AudioContext, input: AudioNode, settings: AudioBusSettings, master: AudioNode): void {
  let tail = input
  for (const insert of settings.inserts) {
    if (!insert.enabled) continue
    if (insert.type === 'highpass') {
      const node = context.createBiquadFilter()
      node.type = 'highpass'
      node.frequency.value = insert.frequencyHz ?? 80
      node.Q.value = AUDIO_EQ_Q.highpass
      tail.connect(node)
      tail = node
    } else if (insert.type === 'equalizer') {
      const low = context.createBiquadFilter()
      low.type = 'lowshelf'; low.frequency.value = AUDIO_EQ_FREQUENCIES.low; low.gain.value = insert.lowDb ?? 0
      const mid = context.createBiquadFilter()
      mid.type = 'peaking'; mid.frequency.value = AUDIO_EQ_FREQUENCIES.mid; mid.Q.value = AUDIO_EQ_Q.mid; mid.gain.value = insert.midDb ?? 0
      const high = context.createBiquadFilter()
      high.type = 'highshelf'; high.frequency.value = AUDIO_EQ_FREQUENCIES.high; high.gain.value = insert.highDb ?? 0
      tail.connect(low).connect(mid).connect(high)
      tail = high
    } else if (insert.type === 'de-esser') {
      const node = context.createBiquadFilter()
      node.type = 'peaking'; node.frequency.value = 6_500; node.Q.value = 1.7; node.gain.value = -Math.max(0, Math.min(100, insert.amount ?? 45)) * 0.12
      tail.connect(node)
      tail = node
    } else if (insert.type === 'hum-removal') {
      const amount = Math.max(0, Math.min(100, insert.amount ?? 70)) / 100
      const frequency = insert.humFrequencyHz === 50 ? 50 : 60
      const fundamental = context.createBiquadFilter()
      fundamental.type = 'peaking'; fundamental.frequency.value = frequency; fundamental.Q.value = 18; fundamental.gain.value = -30 * amount
      const harmonic = context.createBiquadFilter()
      harmonic.type = 'peaking'; harmonic.frequency.value = frequency * 2; harmonic.Q.value = 16; harmonic.gain.value = -18 * amount
      tail.connect(fundamental).connect(harmonic)
      tail = harmonic
    } else if (insert.type === 'compressor') {
      const inputScale = context.createGain()
      inputScale.gain.value = 0.25
      const node = context.createWaveShaper()
      node.curve = createCompressorCurve(insert.thresholdDb ?? -18, insert.ratio ?? 3, insert.makeupDb ?? 0, 4)
      node.oversample = 'none'
      tail.connect(inputScale).connect(node)
      tail = node
    } else if (insert.type === 'delay') {
      const mix = Math.max(0, Math.min(100, insert.mix ?? 18)) / 100
      const dry = context.createGain()
      const wet = context.createGain()
      const delay = context.createDelay(2.1)
      const feedback = context.createGain()
      const sum = context.createGain()
      dry.gain.value = Math.cos(mix * Math.PI / 2)
      wet.gain.value = Math.sin(mix * Math.PI / 2)
      delay.delayTime.value = Math.max(0.01, Math.min(2, (insert.delayMs ?? 240) / 1_000))
      feedback.gain.value = Math.max(0, Math.min(0.85, (insert.feedback ?? 28) / 100))
      tail.connect(dry).connect(sum)
      tail.connect(delay).connect(wet).connect(sum)
      delay.connect(feedback).connect(delay)
      tail = sum
    } else {
      const inputScale = context.createGain()
      inputScale.gain.value = 0.25
      const node = context.createWaveShaper()
      node.curve = createLimiterCurve(insert.ceilingDb ?? -1, 4)
      node.oversample = 'none'
      tail.connect(inputScale).connect(node)
      tail = node
    }
  }
  const busGain = context.createGain()
  busGain.gain.value = gainFromDb(settings.gainDb)
  const limiterInput = context.createGain()
  limiterInput.gain.value = 0.25
  const safetyLimiter = context.createWaveShaper()
  safetyLimiter.curve = createLimiterCurve(settings.limiterDb, 4)
  safetyLimiter.oversample = 'none'
  tail.connect(busGain).connect(limiterInput).connect(safetyLimiter).connect(master)
}

function createPreviewAudioEngine(audioBuses: AudioBusMap): PreviewAudioEngine {
  const context = new AudioContext()
  const masterSum = context.createGain()
  const masterInput = context.createGain()
  masterInput.gain.value = 0.25
  const master = context.createWaveShaper()
  const outputGain = context.createGain()
  master.curve = createMasterSoftClipCurve(4)
  master.oversample = 'none'
  masterSum.connect(masterInput).connect(master).connect(outputGain).connect(context.destination)
  const preMeters = connectStereoMeterTap(context, masterSum)
  const postMeters = connectStereoMeterTap(context, master)
  const busInputs = new Map<AudioRole, GainNode>()
  for (const role of audioRoles) {
    if (!isAudioBusActive(audioBuses, role)) continue
    const input = context.createGain()
    busInputs.set(role, input)
    connectPreviewBusProcessing(context, input, audioBuses[role], masterSum)
  }
  return {
    id: crypto.randomUUID(),
    context,
    busInputs,
    outputGain,
    meters: { preLeft: preMeters.left, preRight: preMeters.right, postLeft: postMeters.left, postRight: postMeters.right },
  }
}

function ProgramAudioMeter({ engine, isPlaying }: { engine?: PreviewAudioEngine; isPlaying: boolean }) {
  const [levels, setLevels] = useState({ left: 0, right: 0, prePeak: 0, overload: false })
  const overloadUntilRef = useRef(0)
  useEffect(() => {
    const buffers = engine ? {
      preLeft: new Float32Array(engine.meters.preLeft.fftSize),
      preRight: new Float32Array(engine.meters.preRight.fftSize),
      postLeft: new Float32Array(engine.meters.postLeft.fftSize),
      postRight: new Float32Array(engine.meters.postRight.fftSize),
    } : undefined
    let frame = 0
    const peak = (values: Float32Array) => {
      let result = 0
      for (let index = 0; index < values.length; index++) result = Math.max(result, Math.abs(values[index]))
      return result
    }
    const update = () => {
      let currentLeft = 0
      let currentRight = 0
      let currentPre = 0
      if (engine && buffers && isPlaying && engine.context.state !== 'closed') {
        engine.meters.preLeft.getFloatTimeDomainData(buffers.preLeft)
        engine.meters.preRight.getFloatTimeDomainData(buffers.preRight)
        engine.meters.postLeft.getFloatTimeDomainData(buffers.postLeft)
        engine.meters.postRight.getFloatTimeDomainData(buffers.postRight)
        currentLeft = peak(buffers.postLeft)
        currentRight = peak(buffers.postRight)
        currentPre = Math.max(peak(buffers.preLeft), peak(buffers.preRight))
      }
      const now = performance.now()
      if (currentPre >= 1) overloadUntilRef.current = now + 1_500
      setLevels((previous) => {
        const next = {
          left: Math.max(currentLeft, previous.left * 0.84),
          right: Math.max(currentRight, previous.right * 0.84),
          prePeak: Math.max(currentPre, previous.prePeak * 0.88),
          overload: now < overloadUntilRef.current,
        }
        if (!isPlaying && next.left < 0.0001 && next.right < 0.0001 && next.prePeak < 0.0001 && !next.overload) return previous.left === 0 && previous.right === 0 && previous.prePeak === 0 && !previous.overload ? previous : { left: 0, right: 0, prePeak: 0, overload: false }
        return next
      })
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [engine, isPlaying])
  const maximum = Math.max(levels.left, levels.right)
  const dbfs = maximum > 1e-7 ? 20 * Math.log10(maximum) : -Infinity
  const meterHeight = (value: number) => value > 1e-7 ? Math.max(3, Math.min(100, (20 * Math.log10(value) + 60) / 60 * 100)) : 3
  const title = `프로그램 출력 L ${levels.left > 1e-7 ? `${(20 * Math.log10(levels.left)).toFixed(1)} dBFS` : '-∞'} · R ${levels.right > 1e-7 ? `${(20 * Math.log10(levels.right)).toFixed(1)} dBFS` : '-∞'} · soft clip 입력 peak ${levels.prePeak.toFixed(2)}`
  return <div className={`program-meter ${levels.overload ? 'clipping' : ''}`} title={title} aria-label={title}><span>AUDIO</span><div className="program-meter-bars"><span><small>L</small><i><b style={{ width: `${meterHeight(levels.left)}%` }} /></i></span><span><small>R</small><i><b style={{ width: `${meterHeight(levels.right)}%` }} /></i></span></div><output>{Number.isFinite(dbfs) ? dbfs.toFixed(1) : '−∞'} dB</output></div>
}

function AudioLayer({ layer, playhead, isPlaying, playbackRate: transportRate, engine, dialogueActive }: { layer: PreviewAudioLayer; playhead: number; isPlaying: boolean; playbackRate: number; engine: PreviewAudioEngine; dialogueActive: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const audioGraphRef = useRef<PreviewAudioGraph | undefined>(undefined)
  const duckTargetRef = useRef<number | undefined>(undefined)
  const playheadRef = useRef(playhead)
  const [timeMapDecoder, setTimeMapDecoder] = useState<TimeMappedAudioPreviewDecoder>()
  const [timeMapError, setTimeMapError] = useState<string>()
  playheadRef.current = playhead
  const clipAdjustment = { ...defaultAudioAdjustment(), ...layer.clip.audioAdjustment, ...(layer.track.audioRole ? { role: layer.track.audioRole } : {}) }
  const masterAudio = sourceMasterAudio(layer.asset)
  const adjustment = masterAudio ? {
    ...clipAdjustment,
    channelMode: masterAudio.channelMode !== 'stereo' ? masterAudio.channelMode : clipAdjustment.channelMode,
    stereoWidth: Math.max(0, Math.min(200, (masterAudio.stereoWidth ?? 100) * (clipAdjustment.stereoWidth ?? 100) / 100)),
    phaseInvertLeft: Boolean(masterAudio.phaseInvertLeft) !== Boolean(clipAdjustment.phaseInvertLeft),
    phaseInvertRight: Boolean(masterAudio.phaseInvertRight) !== Boolean(clipAdjustment.phaseInvertRight),
    downmixCenterDb: masterAudio.downmixCenterDb ?? clipAdjustment.downmixCenterDb,
    downmixSurroundDb: masterAudio.downmixSurroundDb ?? clipAdjustment.downmixSurroundDb,
    downmixLfeDb: masterAudio.downmixLfeDb ?? clipAdjustment.downmixLfeDb,
    normalize: masterAudio.normalize || clipAdjustment.normalize,
    noiseReduction: Math.max(masterAudio.noiseReduction, clipAdjustment.noiseReduction),
    voiceEnhance: masterAudio.voiceEnhance || clipAdjustment.voiceEnhance,
    deEsser: Math.min(100, (masterAudio.deEsser ?? 0) + (clipAdjustment.deEsser ?? 0)),
    humRemoval: clipAdjustment.humRemoval && clipAdjustment.humRemoval !== 'off' ? clipAdjustment.humRemoval : masterAudio.humRemoval ?? 'off',
    highpassHz: Math.max(masterAudio.highpassHz ?? 20, clipAdjustment.highpassHz ?? 20),
    eqLowDb: Math.max(-24, Math.min(24, (masterAudio.eqLowDb ?? 0) + (clipAdjustment.eqLowDb ?? 0))),
    eqMidDb: Math.max(-24, Math.min(24, (masterAudio.eqMidDb ?? 0) + (clipAdjustment.eqMidDb ?? 0))),
    eqHighDb: Math.max(-24, Math.min(24, (masterAudio.eqHighDb ?? 0) + (clipAdjustment.eqHighDb ?? 0))),
    compressorThresholdDb: Math.min(masterAudio.compressorThresholdDb ?? -12, clipAdjustment.compressorThresholdDb ?? -12),
    compressorRatio: Math.max(1, Math.min(20, (masterAudio.compressorRatio ?? 1) * (clipAdjustment.compressorRatio ?? 1))),
    limiterDb: Math.min(masterAudio.limiterDb ?? -1, clipAdjustment.limiterDb ?? -1),
  } : clipAdjustment
  const needsTimeMappedPreview = Boolean(layer.clip.reverse) || adjustment.preservePitch && clipNeedsPitchStretch(layer.clip)
  const audioMix = resolveClipAudioMix(layer.clip, playhead)
  const trackMix = resolveTrackAudioMix(layer.track, playhead)
  const sourceTime = clipSourceTime(layer.clip, playhead)
  const playbackRate = clipPlaybackRateAt(layer.clip, playhead) * transportRate
  const auxSends = resolveAudioAuxSends(adjustment).filter((send) => send.enabled && send.bus !== adjustment.role && engine.busInputs.has(send.bus))
  const auxKey = JSON.stringify(auxSends.map((send) => [send.bus, send.levelDb, send.position, send.enabled]))
  const compKey = JSON.stringify(layer.clip.adrCompRanges ?? null)
  const gateCurve = useMemo(() => createNoiseGateCurve(adjustment.noiseReduction), [adjustment.noiseReduction])
  const compressorCurve = useMemo(() => createCompressorCurve(adjustment.compressorThresholdDb ?? -12, adjustment.compressorRatio ?? 1, 0, 4), [adjustment.compressorRatio, adjustment.compressorThresholdDb])
  const limiterCurve = useMemo(() => createLimiterCurve(adjustment.limiterDb ?? -1, 4), [adjustment.limiterDb])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const context = engine.context
    const source = getOrCreateMediaElementAudioSource(context, audio)
    const channelNormalizer = context.createGain()
    const channelNodes: AudioNode[] = []
    const sourceChannels = Math.max(1, Math.min(32, layer.asset.channels ?? 2))
    if (sourceChannels > 2 || layer.asset.sourceAudioLayout === 'mono') {
      channelNormalizer.channelCount = 2
      channelNormalizer.channelCountMode = 'explicit'
      channelNormalizer.channelInterpretation = 'speakers'
      const sourceSplitter = context.createChannelSplitter(sourceChannels)
      const stereoMerger = context.createChannelMerger(2)
      const route = (input: number, output: 0 | 1, gain: number) => {
        const routeGain = context.createGain()
        routeGain.gain.value = gain
        sourceSplitter.connect(routeGain, input)
        routeGain.connect(stereoMerger, 0, output)
        channelNodes.push(routeGain)
      }
      const centerGain = gainFromDb(adjustment.downmixCenterDb ?? -3)
      const surroundGain = gainFromDb(adjustment.downmixSurroundDb ?? -3)
      const lfeGain = gainFromDb(adjustment.downmixLfeDb ?? -60)
      const layout = layer.asset.sourceAudioLayout ?? 'auto'
      const resolvedLayout = layout === 'auto' ? sourceChannels === 4 ? 'quad' : sourceChannels === 5 ? '5.0' : sourceChannels >= 8 ? '7.1' : '5.1' : layout
      source.connect(sourceSplitter)
      if (resolvedLayout === 'mono') {
        route(0, 0, 1)
        route(0, 1, 1)
      } else {
        route(0, 0, 1)
        route(1, 1, 1)
      }
      if (resolvedLayout === 'quad') {
        route(2, 0, surroundGain)
        route(3, 1, surroundGain)
      } else if (resolvedLayout === '5.0') {
        route(2, 0, centerGain)
        route(2, 1, centerGain)
        if (sourceChannels > 3) route(3, 0, surroundGain)
        if (sourceChannels > 4) route(4, 1, surroundGain)
      } else if (resolvedLayout === '5.1' || resolvedLayout === '7.1') {
        if (sourceChannels > 2) {
          route(2, 0, centerGain)
          route(2, 1, centerGain)
        }
        if (sourceChannels > 3) {
          route(3, 0, lfeGain)
          route(3, 1, lfeGain)
        }
        const pairGain = resolvedLayout === '7.1' ? surroundGain * Math.SQRT1_2 : surroundGain
        if (sourceChannels > 4) route(4, 0, pairGain)
        if (sourceChannels > 5) route(5, 1, pairGain)
        if (resolvedLayout === '7.1' && sourceChannels > 6) route(6, 0, pairGain)
        if (resolvedLayout === '7.1' && sourceChannels > 7) route(7, 1, pairGain)
      }
      channelNodes.push(sourceSplitter, stereoMerger)
      stereoMerger.connect(channelNormalizer)
    } else {
      source.connect(channelNormalizer)
    }
    let channelOutput: AudioNode = channelNormalizer
    const channelMode = adjustment.channelMode ?? 'stereo'
    if (channelMode !== 'stereo') {
      const splitter = context.createChannelSplitter(2)
      const merger = context.createChannelMerger(2)
      channelNormalizer.connect(splitter)
      channelNodes.push(splitter, merger)
      if (channelMode === 'swap') {
        splitter.connect(merger, 0, 1)
        splitter.connect(merger, 1, 0)
      } else if (channelMode === 'mono-left' || channelMode === 'mono-right') {
        const inputChannel = channelMode === 'mono-left' ? 0 : 1
        splitter.connect(merger, inputChannel, 0)
        splitter.connect(merger, inputChannel, 1)
      } else {
        const leftMatrix = context.createGain()
        const rightMatrix = context.createGain()
        const sum = context.createGain()
        leftMatrix.gain.value = 0.5
        rightMatrix.gain.value = channelMode === 'mid' ? 0.5 : -0.5
        splitter.connect(leftMatrix, 0)
        splitter.connect(rightMatrix, 1)
        leftMatrix.connect(sum)
        rightMatrix.connect(sum)
        sum.connect(merger, 0, 0)
        sum.connect(merger, 0, 1)
        channelNodes.push(leftMatrix, rightMatrix, sum)
      }
      channelOutput = merger
    }
    const stereoWidth = Math.max(0, Math.min(2, (adjustment.stereoWidth ?? 100) / 100))
    if (Math.abs(stereoWidth - 1) > 0.0001 || adjustment.phaseInvertLeft || adjustment.phaseInvertRight) {
      const splitter = context.createChannelSplitter(2)
      const merger = context.createChannelMerger(2)
      const coefficients = [
        (0.5 + stereoWidth * 0.5) * (adjustment.phaseInvertLeft ? -1 : 1),
        (0.5 - stereoWidth * 0.5) * (adjustment.phaseInvertLeft ? -1 : 1),
        (0.5 - stereoWidth * 0.5) * (adjustment.phaseInvertRight ? -1 : 1),
        (0.5 + stereoWidth * 0.5) * (adjustment.phaseInvertRight ? -1 : 1),
      ]
      const routes = coefficients.map((gainValue, index) => {
        const gain = context.createGain()
        gain.gain.value = gainValue
        splitter.connect(gain, index % 2)
        gain.connect(merger, 0, index < 2 ? 0 : 1)
        return gain
      })
      channelOutput.connect(splitter)
      channelNodes.push(splitter, merger, ...routes)
      channelOutput = merger
    }
    const gate = context.createWaveShaper()
    gate.curve = gateCurve
    gate.oversample = 'none'
    const highpass = context.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.Q.value = AUDIO_EQ_Q.highpass
    const voice = context.createBiquadFilter()
    voice.type = 'peaking'
    voice.frequency.value = AUDIO_EQ_FREQUENCIES.voice
    voice.Q.value = AUDIO_EQ_Q.voice
    const deEsser = context.createBiquadFilter()
    deEsser.type = 'peaking'
    deEsser.frequency.value = 6_500
    deEsser.Q.value = 1.7
    const masterHumFundamental = context.createBiquadFilter()
    masterHumFundamental.type = 'peaking'
    masterHumFundamental.Q.value = 18
    const masterHumHarmonic = context.createBiquadFilter()
    masterHumHarmonic.type = 'peaking'
    masterHumHarmonic.Q.value = 16
    const humFundamental = context.createBiquadFilter()
    humFundamental.type = 'peaking'
    humFundamental.Q.value = 18
    const humHarmonic = context.createBiquadFilter()
    humHarmonic.type = 'peaking'
    humHarmonic.Q.value = 16
    const low = context.createBiquadFilter()
    low.type = 'lowshelf'
    low.frequency.value = AUDIO_EQ_FREQUENCIES.low
    const mid = context.createBiquadFilter()
    mid.type = 'peaking'
    mid.frequency.value = AUDIO_EQ_FREQUENCIES.mid
    mid.Q.value = AUDIO_EQ_Q.mid
    const high = context.createBiquadFilter()
    high.type = 'highshelf'
    high.frequency.value = AUDIO_EQ_FREQUENCIES.high
    const compressor = context.createWaveShaper()
    compressor.curve = compressorCurve
    compressor.oversample = 'none'
    const compressorInput = context.createGain()
    compressorInput.gain.value = 0.25
    const limiter = context.createWaveShaper()
    limiter.curve = limiterCurve
    limiter.oversample = 'none'
    const limiterInput = context.createGain()
    limiterInput.gain.value = 0.25
    const panner = context.createStereoPanner()
    const fader = context.createGain()
    const duck = context.createGain()
    const preTap = context.createGain()
    channelOutput.connect(gate).connect(highpass).connect(low).connect(mid).connect(high).connect(voice).connect(deEsser).connect(masterHumFundamental).connect(masterHumHarmonic).connect(humFundamental).connect(humHarmonic).connect(compressorInput).connect(compressor).connect(limiterInput).connect(limiter).connect(preTap)
    preTap.connect(fader).connect(duck).connect(panner)
    const primaryInput = engine.busInputs.get(adjustment.role)
    const primary = primaryInput ? connectPreviewBusInput(context, panner, primaryInput, 1) : undefined
    const preSends = new Map<string, PreviewBusBranch>()
    const postSends = new Map<string, PreviewBusBranch>()
    auxSends.forEach((send) => {
      const target = engine.busInputs.get(send.bus)
      if (!target) return
      const branch = connectPreviewBusInput(context, send.position === 'pre' ? preTap : panner, target, gainFromDb(send.levelDb))
      ;(send.position === 'pre' ? preSends : postSends).set(send.id, branch)
    })
    audioGraphRef.current = { input: channelNormalizer, channelNodes, fader, duck, panner, gate, highpass, low, mid, high, voice, deEsser, masterHumFundamental, masterHumHarmonic, humFundamental, humHarmonic, compressor, limiter, primary, preSends, postSends }
    duckTargetRef.current = undefined
    return () => {
      audioGraphRef.current = undefined
      duckTargetRef.current = undefined
      audio.pause()
      primary?.sendGain.disconnect()
      preSends.forEach((branch) => branch.sendGain.disconnect())
      postSends.forEach((branch) => branch.sendGain.disconnect())
      ;[source, channelNormalizer, ...channelNodes, gate, highpass, low, mid, high, voice, deEsser, masterHumFundamental, masterHumHarmonic, humFundamental, humHarmonic, compressorInput, compressor, limiterInput, limiter, preTap, fader, duck, panner].forEach((node) => node.disconnect())
    }
  }, [adjustment.channelMode, adjustment.downmixCenterDb, adjustment.downmixLfeDb, adjustment.downmixSurroundDb, adjustment.phaseInvertLeft, adjustment.phaseInvertRight, adjustment.role, adjustment.stereoWidth, auxKey, engine, layer.asset.channels, layer.asset.id])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.playbackRate = Math.max(MIN_MEDIA_PLAYBACK_RATE, playbackRate)
    audio.preservesPitch = adjustment.preservePitch
    const graph = audioGraphRef.current
    if (graph) {
      if (graph.gate.curve !== gateCurve) graph.gate.curve = gateCurve
      if (graph.compressor.curve !== compressorCurve) graph.compressor.curve = compressorCurve
      if (graph.limiter.curve !== limiterCurve) graph.limiter.curve = limiterCurve
      graph.panner.pan.value = Math.max(-1, Math.min(1, (audioMix.pan + (masterAudio?.pan ?? 0) + trackMix.pan) / 100))
      graph.highpass.frequency.value = Math.max(20, adjustment.highpassHz ?? 20)
      graph.low.gain.value = adjustment.eqLowDb ?? 0
      graph.mid.gain.value = adjustment.eqMidDb ?? 0
      graph.high.gain.value = adjustment.eqHighDb ?? 0
      graph.voice.gain.value = adjustment.voiceEnhance ? 4.5 : 0
      graph.deEsser.gain.value = -Math.max(0, Math.min(100, adjustment.deEsser ?? 0)) * 0.12
      const humFrequency = adjustment.humRemoval === '50hz' ? 50 : adjustment.humRemoval === '60hz' ? 60 : 50
      const humEnabled = adjustment.humRemoval === '50hz' || adjustment.humRemoval === '60hz'
      const masterHumFrequency = masterAudio?.humRemoval === '50hz' ? 50 : masterAudio?.humRemoval === '60hz' ? 60 : 50
      const masterHumEnabled = masterAudio?.humRemoval === '50hz' || masterAudio?.humRemoval === '60hz'
      graph.masterHumFundamental.frequency.value = masterHumFrequency
      graph.masterHumFundamental.gain.value = masterHumEnabled ? -30 : 0
      graph.masterHumHarmonic.frequency.value = masterHumFrequency * 2
      graph.masterHumHarmonic.gain.value = masterHumEnabled ? -18 : 0
      graph.humFundamental.frequency.value = humFrequency
      graph.humFundamental.gain.value = clipAdjustment.humRemoval !== 'off' && humEnabled ? -30 : 0
      graph.humHarmonic.frequency.value = humFrequency * 2
      graph.humHarmonic.gain.value = clipAdjustment.humRemoval !== 'off' && humEnabled ? -18 : 0
    }
    const normalizedGain = adjustment.normalize ? peakNormalizationGain(layer.asset.audioPeak) : 1
    const localTime = Math.max(0, playhead - layer.clip.start)
    const remaining = Math.max(0, layer.clip.duration - localTime)
    const fade = Math.min(1, adjustment.fadeIn > 0 ? audioFadeCurveGain(localTime / adjustment.fadeIn, adjustment.fadeInCurve) : 1, adjustment.fadeOut > 0 ? audioFadeCurveGain(remaining / adjustment.fadeOut, adjustment.fadeOutCurve) : 1) * transitionAudioGain(layer.clip, playhead)
    audio.volume = 1
    if (graph) {
      const duckTarget = adjustment.role === 'music' && adjustment.ducking && dialogueActive ? gainFromDb(adjustment.duckingAmountDb ?? -11) : 1
      if (duckTargetRef.current === undefined || Math.abs(duckTargetRef.current - duckTarget) > 1e-5) {
        const transitionMs = duckTarget < (duckTargetRef.current ?? 1) ? adjustment.duckingAttackMs ?? 180 : adjustment.duckingReleaseMs ?? 650
        graph.duck.gain.cancelScheduledValues(engine.context.currentTime)
        graph.duck.gain.setTargetAtTime(duckTarget, engine.context.currentTime, Math.max(0.005, transitionMs / 3000))
        duckTargetRef.current = duckTarget
      }
      const faderGain = gainFromDb(audioMix.gainDb + (masterAudio?.gainDb ?? 0)) * (trackMix.volume / 100)
      const compGain = resolveAdrCompGain(layer.clip, playhead)
      graph.fader.gain.value = Math.max(0, normalizedGain * fade * faderGain * compGain)
      auxSends.filter((send) => send.position === 'pre').forEach((send) => {
        const branch = graph.preSends.get(send.id)
        if (branch) branch.sendGain.gain.value = Math.max(0, normalizedGain * fade * gainFromDb(send.levelDb) * compGain)
      })
      auxSends.filter((send) => send.position === 'post').forEach((send) => {
        const branch = graph.postSends.get(send.id)
        if (branch) branch.sendGain.gain.value = gainFromDb(send.levelDb)
      })
    }
    if (isPlaying && !needsTimeMappedPreview && !layer.clip.freezeFrame) {
      if (engine.context.state === 'suspended') void engine.context.resume()
      void audio.play().catch(() => undefined)
    }
    else audio.pause()
  }, [adjustment.compressorRatio, adjustment.compressorThresholdDb, adjustment.deEsser, adjustment.ducking, adjustment.duckingAmountDb, adjustment.duckingAttackMs, adjustment.duckingReleaseMs, adjustment.eqHighDb, adjustment.eqLowDb, adjustment.eqMidDb, adjustment.fadeIn, adjustment.fadeInCurve, adjustment.fadeOut, adjustment.fadeOutCurve, adjustment.highpassHz, adjustment.humRemoval, adjustment.limiterDb, adjustment.noiseReduction, adjustment.normalize, adjustment.preservePitch, adjustment.role, adjustment.voiceEnhance, audioMix.gainDb, audioMix.pan, auxKey, clipAdjustment.humRemoval, compKey, compressorCurve, dialogueActive, engine, gateCurve, isPlaying, layer.asset.audioPeak, layer.asset.id, layer.clip.duration, layer.clip.freezeFrame, layer.clip.reverse, layer.clip.start, layer.clip.transitionIn, layer.clip.transitionOut, limiterCurve, masterAudio?.gainDb, masterAudio?.humRemoval, masterAudio?.pan, needsTimeMappedPreview, playbackRate, playhead, trackMix.pan, trackMix.volume])

  useEffect(() => {
    if (audioRef.current && !needsTimeMappedPreview) syncMedia(audioRef.current, sourceTime, { playing: isPlaying && !layer.clip.freezeFrame, playbackRate })
  }, [isPlaying, layer.clip.freezeFrame, needsTimeMappedPreview, playbackRate, sourceTime])

  useEffect(() => {
    let cancelled = false
    let decoder: TimeMappedAudioPreviewDecoder | undefined
    setTimeMapDecoder(undefined)
    setTimeMapError(undefined)
    if (!needsTimeMappedPreview || layer.clip.freezeFrame) return
    if (!layer.asset.sourceFile) {
      setTimeMapError('로컬 원본 또는 프록시가 없어 시간 매핑 오디오를 준비할 수 없습니다.')
      return
    }
    void createTimeMappedAudioPreviewDecoder(layer.asset).then((created) => {
      if (cancelled) {
        created.dispose()
        return
      }
      decoder = created
      setTimeMapDecoder(created)
    }).catch((error) => {
      if (!cancelled) setTimeMapError(error instanceof Error ? error.message : String(error))
    })
    return () => {
      cancelled = true
      decoder?.dispose()
    }
  }, [layer.asset.id, layer.asset.sourceFile, layer.asset.sourcePath, layer.clip.freezeFrame, layer.clip.id, needsTimeMappedPreview])

  useEffect(() => {
    if (!timeMapDecoder || !isPlaying || !needsTimeMappedPreview || layer.clip.freezeFrame) return
    const graph = audioGraphRef.current
    if (!graph) return
    const context = engine.context
    const sources = new Set<AudioBufferSourceNode>()
    let cancelled = false
    let timer = 0
    let pumping = false
    let anchorTimeline = playheadRef.current
    let anchorContext = context.currentTime
    let scheduledTimeline = Math.max(layer.clip.start, anchorTimeline + 0.2)
    let scheduledContext = anchorContext + Math.max(0.2, layer.clip.start - anchorTimeline)
    let underruns = 0
    const stopSources = () => {
      sources.forEach((source) => {
        source.onended = null
        try { source.stop() } catch { /* already ended */ }
        source.disconnect()
      })
      sources.clear()
    }
    const rebase = () => {
      stopSources()
      anchorTimeline = playheadRef.current
      anchorContext = context.currentTime
      scheduledTimeline = Math.max(layer.clip.start, anchorTimeline + 0.2)
      scheduledContext = anchorContext + Math.max(0.2, layer.clip.start - anchorTimeline)
    }
    const scheduleNext = () => {
      if (!cancelled) timer = window.setTimeout(() => { void pump() }, 60)
    }
    const pump = async () => {
      if (cancelled || pumping) return
      pumping = true
      try {
        if (context.state === 'suspended') await context.resume()
        const expectedTimeline = anchorTimeline + Math.max(0, context.currentTime - anchorContext)
        if (Math.abs(playheadRef.current - expectedTimeline) > 0.08) rebase()
        while (!cancelled && scheduledContext < context.currentTime + 0.9 && scheduledTimeline < layer.clip.start + layer.clip.duration) {
          if (scheduledContext < context.currentTime + 0.035) {
            underruns++
            rebase()
          }
          const chunkStart = Math.max(layer.clip.start, scheduledTimeline)
          const chunkEnd = Math.min(layer.clip.start + layer.clip.duration, chunkStart + 0.25)
          if (chunkEnd <= chunkStart + 1 / context.sampleRate) break
          const buffer = await timeMapDecoder.renderChunk(layer.clip, chunkStart, chunkEnd, context.sampleRate, adjustment.preservePitch)
          if (cancelled) break
          if (scheduledContext < context.currentTime + 0.02) {
            underruns++
            rebase()
            if (underruns >= 3) throw new Error('속도 매핑 PCM 디코딩이 실시간 재생 속도를 따라가지 못했습니다. 편집 프록시를 사용해주세요.')
            continue
          }
          const source = context.createBufferSource()
          source.buffer = buffer
          source.connect(graph.input)
          sources.add(source)
          source.onended = () => {
            sources.delete(source)
            source.disconnect()
          }
          source.start(scheduledContext)
          scheduledContext += buffer.duration
          scheduledTimeline = chunkEnd
          underruns = 0
        }
      } catch (error) {
        if (!cancelled && (!(error instanceof Error) || error.name !== 'AbortError')) {
          setTimeMapError(error instanceof Error ? error.message : String(error))
          timeMapDecoder.dispose()
          setTimeMapDecoder(undefined)
          cancelled = true
          stopSources()
        }
      } finally {
        pumping = false
        scheduleNext()
      }
    }
    void pump()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      stopSources()
    }
  }, [adjustment.preservePitch, engine, isPlaying, layer.clip, needsTimeMappedPreview, timeMapDecoder])

  return <><audio key={`${engine.id}:${layer.asset.id}:${adjustment.role}:${auxKey}`} ref={audioRef} src={needsTimeMappedPreview ? undefined : layer.asset.url} />{timeMapError && <div className="time-map-audio-warning" role="status">속도 매핑 오디오 미리보기 · {timeMapError}</div>}</>
}

function SourceMonitor({ asset, sourceTime, syncKey, isPlaying, playbackRate, muted }: { asset: MediaAsset; sourceTime: number; syncKey: string; isPlaying: boolean; playbackRate: number; muted: boolean }) {
  const mediaRef = useRef<HTMLMediaElement>(null)
  useEffect(() => {
    const media = mediaRef.current
    if (!media) return
    media.muted = muted
    if (isPlaying) void media.play().catch(() => undefined)
    else media.pause()
  }, [asset.id, isPlaying, muted])
  useEffect(() => {
    if (mediaRef.current) syncMedia(mediaRef.current, sourceTime, { playing: isPlaying, playbackRate })
  }, [isPlaying, playbackRate, sourceTime, syncKey])

  if (asset.kind !== 'audio' && (hasSourceInterpretation(asset) || hasSourceMasterVisualProcessing(asset))) {
    const sourceClip: TimelineClip = { id: `source-monitor-${asset.id}`, trackId: 'source-monitor', assetId: asset.id, name: asset.name, start: 0, duration: Math.max(.01, asset.duration), sourceOffset: 0, kind: 'video', color: asset.labelColor ?? '#7c5cff', transform: { positionX: 0, positionY: 0, scale: 100, rotation: 0, opacity: 100 } }
    return <ProcessedVisualLayer layer={{ clip: sourceClip, asset, trackId: 'source-monitor', order: 0 }} sourceTime={sourceTime} playbackRate={playbackRate} isPlaying={isPlaying} style={{}} effects={defaultVisualEffects()} />
  }
  if (asset.kind === 'image' || asset.imageSequenceUrls?.length) return <img className="visual-layer" src={imageSequenceUrlAt(asset, sourceTime)} alt={`${asset.name} 미리보기`} />
  if (asset.kind === 'video') return <video className="visual-layer" ref={(element) => { mediaRef.current = element }} src={asset.url} playsInline muted aria-label={`${asset.name} 미리보기`} />
  return <div className="audio-preview"><Volume2 size={28} /><strong>{asset.name}</strong><span>오디오 미디어</span><audio ref={(element) => { mediaRef.current = element }} src={asset.url} muted={muted} /></div>
}

function curveFilterId(clipId: string): string {
  return `editweave-curve-${clipId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function ColorCurveFilterDefinitions({ clips }: { clips: TimelineClip[] }) {
  const curved = clips.filter((clip) => hasCustomColorCurves(clip.colorAdjustment))
  if (!curved.length) return null
  return <svg className="color-curve-filter-definitions" aria-hidden><defs>{curved.map((clip) => <filter key={clip.id} id={curveFilterId(clip.id)} colorInterpolationFilters="sRGB"><feComponentTransfer><feFuncR type="table" tableValues={colorCurveTableValues(clip.colorAdjustment, 'redCurve')} /><feFuncG type="table" tableValues={colorCurveTableValues(clip.colorAdjustment, 'greenCurve')} /><feFuncB type="table" tableValues={colorCurveTableValues(clip.colorAdjustment, 'blueCurve')} /><feFuncA type="identity" /></feComponentTransfer></filter>)}</defs></svg>
}

function ProgramCanvas({ preset, layers, adjustmentClips, captionClips, playhead, isPlaying, playbackRate: transportRate, monitorAssist, transparentPreview, onProgramFrame }: { preset: SequencePreset; layers: PreviewLayer[]; adjustmentClips: TimelineClip[]; captionClips: TimelineClip[]; playhead: number; isPlaying: boolean; playbackRate: number; monitorAssist: MonitorAssistMode; transparentPreview: boolean; onProgramFrame?: (canvas: HTMLCanvasElement, revision: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const adjustmentCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const pictureLayerCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const matteCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameBlendCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const cleanOutputCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const sourceRefs = useRef(new Map<string, HTMLVideoElement | HTMLImageElement>())
  const revisionRef = useRef(0)
  const lastPublishRef = useRef(0)
  const lastPublishedKeyRef = useRef('')
  const drawProgram = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderScale = Math.min(1, 960 / Math.max(preset.width, preset.height))
    const width = Math.max(2, Math.round(preset.width * renderScale))
    const height = Math.max(2, Math.round(preset.height * renderScale))
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!context) return
    context.save()
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.globalCompositeOperation = 'copy'
    if (transparentPreview) context.clearRect(0, 0, width, height)
    else {
      context.fillStyle = '#08080b'
      context.fillRect(0, 0, width, height)
    }
    context.restore()
    const pictureLayerCanvas = pictureLayerCanvasRef.current ?? document.createElement('canvas')
    const matteCanvas = matteCanvasRef.current ?? document.createElement('canvas')
    pictureLayerCanvasRef.current = pictureLayerCanvas
    matteCanvasRef.current = matteCanvas
    if (pictureLayerCanvas.width !== width) pictureLayerCanvas.width = width
    if (pictureLayerCanvas.height !== height) pictureLayerCanvas.height = height
    if (matteCanvas.width !== width) matteCanvas.width = width
    if (matteCanvas.height !== height) matteCanvas.height = height
    const pictureLayerContext = pictureLayerCanvas.getContext('2d', { alpha: true, willReadFrequently: true })
    const matteContext = matteCanvas.getContext('2d', { alpha: true, willReadFrequently: true })
    const resolveProgramSource = (layer: PreviewLayer): { source: CanvasImageSource; width: number; height: number } | undefined => {
      const source = sourceRefs.current.get(layer.clip.id)
      if (!source) return undefined
      const sourceWidth = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
      const sourceHeight = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
      const interpolatesFrames = layer.clip.frameInterpolation === 'blend' || layer.clip.frameInterpolation === 'optical-flow'
      if (!sourceWidth || !sourceHeight || !interpolatesFrames || !(source instanceof HTMLVideoElement)) return sourceWidth && sourceHeight ? { source, width: sourceWidth, height: sourceHeight } : undefined
      const secondary = sourceRefs.current.get(`${layer.clip.id}:blend`)
      if (!(secondary instanceof HTMLVideoElement) || !secondary.videoWidth || !secondary.videoHeight) return { source, width: sourceWidth, height: sourceHeight }
      const frameRate = Math.max(1, layer.asset.frameRate || 30)
      const exactFrame = Math.max(0, clipSourceTime(layer.clip, playhead)) * frameRate
      const fraction = exactFrame - Math.floor(exactFrame)
      if (fraction <= 0.0001) return { source, width: sourceWidth, height: sourceHeight }
      const blendCanvas = frameBlendCanvasRef.current ?? document.createElement('canvas')
      frameBlendCanvasRef.current = blendCanvas
      if (layer.clip.frameInterpolation === 'optical-flow') {
        drawMotionCompensatedFrame(blendCanvas, source, secondary, sourceWidth, sourceHeight, fraction)
        return { source: blendCanvas, width: sourceWidth, height: sourceHeight }
      }
      if (blendCanvas.width !== sourceWidth) blendCanvas.width = sourceWidth
      if (blendCanvas.height !== sourceHeight) blendCanvas.height = sourceHeight
      const blendContext = blendCanvas.getContext('2d', { alpha: true })
      if (!blendContext) return { source, width: sourceWidth, height: sourceHeight }
      blendContext.save()
      blendContext.setTransform(1, 0, 0, 1, 0, 0)
      blendContext.globalCompositeOperation = 'copy'
      blendContext.globalAlpha = 1
      blendContext.drawImage(source, 0, 0, sourceWidth, sourceHeight)
      blendContext.globalCompositeOperation = 'source-over'
      blendContext.globalAlpha = fraction
      blendContext.drawImage(secondary, 0, 0, sourceWidth, sourceHeight)
      blendContext.restore()
      return { source: blendCanvas, width: sourceWidth, height: sourceHeight }
    }
    for (const layer of [...layers].sort((left, right) => left.order - right.order)) {
      const resolvedSource = resolveProgramSource(layer)
      if (!resolvedSource || !pictureLayerContext || !matteContext) continue
      if (layer.matteOnly) continue
      pictureLayerContext.setTransform(1, 0, 0, 1, 0, 0)
      pictureLayerContext.globalCompositeOperation = 'copy'
      pictureLayerContext.clearRect(0, 0, width, height)
      drawVisual(pictureLayerContext, resolvedSource.source, resolvedSource.width, resolvedSource.height, layer.asset, layer.clip, playhead, width, height, renderScale, 'source-over')
      if (layer.clip.trackMatte) {
        const matteLayer = [...layers].filter((candidate) => candidate.trackId === layer.clip.trackMatte!.sourceTrackId && candidate.clip.id !== layer.clip.id).sort((left, right) => right.order - left.order)[0]
        const matteSource = matteLayer ? resolveProgramSource(matteLayer) : undefined
        matteContext.setTransform(1, 0, 0, 1, 0, 0)
        matteContext.globalCompositeOperation = 'copy'
        matteContext.clearRect(0, 0, width, height)
        if (matteLayer && matteSource) drawVisual(matteContext, matteSource.source, matteSource.width, matteSource.height, matteLayer.asset, matteLayer.clip, playhead, width, height, renderScale, 'source-over')
        applyTrackMatteCanvas(pictureLayerContext, matteContext, matteCanvas, layer.clip.trackMatte.mode)
      }
      context.save()
      const blendMode = resolveVisualEffects(layer.clip, playhead).blendMode
      context.globalCompositeOperation = !blendMode || blendMode === 'normal' ? 'source-over' : blendMode
      context.drawImage(pictureLayerCanvas, 0, 0)
      context.restore()
    }
    let adjustmentCanvas = adjustmentCanvasRef.current
    if (!adjustmentCanvas) {
      adjustmentCanvas = document.createElement('canvas')
      adjustmentCanvasRef.current = adjustmentCanvas
    }
    if (adjustmentCanvas.width !== width) adjustmentCanvas.width = width
    if (adjustmentCanvas.height !== height) adjustmentCanvas.height = height
    const adjustmentContext = adjustmentCanvas.getContext('2d', { alpha: true, willReadFrequently: true })
    if (adjustmentContext) adjustmentClips.forEach((clip) => applyAdjustmentLayer(context, adjustmentContext, adjustmentCanvas!, clip, playhead, width, height, transparentPreview))
    captionClips.forEach((clip) => drawCaption(context, clip, playhead, width, height))
    const cleanOutputCanvas = cleanOutputCanvasRef.current ?? document.createElement('canvas')
    cleanOutputCanvasRef.current = cleanOutputCanvas
    if (cleanOutputCanvas.width !== width) cleanOutputCanvas.width = width
    if (cleanOutputCanvas.height !== height) cleanOutputCanvas.height = height
    const cleanOutputContext = cleanOutputCanvas.getContext('2d', { alpha: true })
    if (cleanOutputContext) {
      cleanOutputContext.globalCompositeOperation = 'copy'
      cleanOutputContext.drawImage(canvas, 0, 0)
    }
    const now = performance.now()
    const publishKey = JSON.stringify({
      time: Number(playhead.toFixed(4)),
      layers: layers.map((layer) => [layer.clip.id, layer.clip.transform, layer.clip.keyframes, layer.clip.colorAdjustment, layer.clip.visualEffects, layer.clip.visualKeyframes, layer.clip.trackMatte, layer.clip.frameInterpolation, layer.trackId, layer.order]),
      adjustments: adjustmentClips.map((clip) => [clip.id, clip.colorAdjustment, clip.visualEffects, clip.visualKeyframes]),
      captions: captionClips.map((clip) => [clip.id, clip.name, clip.captionStyle, clip.captionWords]),
    })
    if (onProgramFrame && publishKey !== lastPublishedKeyRef.current && (!isPlaying || now - lastPublishRef.current >= 250)) {
      lastPublishRef.current = now
      lastPublishedKeyRef.current = publishKey
      onProgramFrame(cleanOutputCanvas, ++revisionRef.current)
    }
    applyMonitorAssist(context, width, height, monitorAssist)
  }, [adjustmentClips, captionClips, isPlaying, layers, monitorAssist, onProgramFrame, playhead, preset.height, preset.width, transparentPreview])

  useEffect(() => {
    for (const layer of layers) {
      const source = sourceRefs.current.get(layer.clip.id)
      if (!(source instanceof HTMLVideoElement)) continue
      const sourceTime = clipSourceTime(layer.clip, playhead)
      const playbackRate = clipPlaybackRateAt(layer.clip, playhead) * transportRate
      if (layer.clip.frameInterpolation === 'blend' || layer.clip.frameInterpolation === 'optical-flow') {
        const frameRate = Math.max(1, layer.asset.frameRate || 30)
        const exactFrame = Math.max(0, sourceTime) * frameRate
        const lowerTime = Math.floor(exactFrame) / frameRate
        const upperTime = Math.ceil(exactFrame) / frameRate
        const secondary = sourceRefs.current.get(`${layer.clip.id}:blend`)
        source.pause()
        syncMedia(source, lowerTime, { playing: false, playbackRate: 1 })
        if (secondary instanceof HTMLVideoElement) {
          secondary.pause()
          syncMedia(secondary, upperTime, { playing: false, playbackRate: 1 })
        }
        continue
      }
      const forwardPlaying = isPlaying && !layer.clip.reverse && !layer.clip.freezeFrame
      if (forwardPlaying) {
        syncMedia(source, sourceTime, { playing: true, playbackRate })
        void source.play().catch(() => undefined)
      } else {
        source.pause()
        syncMedia(source, sourceTime, { playing: false, playbackRate })
      }
    }
    const frame = requestAnimationFrame(drawProgram)
    return () => cancelAnimationFrame(frame)
  }, [drawProgram, isPlaying, layers, playhead, transportRate])

  return <><canvas ref={canvasRef} className="program-composite visual-layer" aria-label="프로그램 합성 화면" />{layers.map((layer) => layer.asset.kind === 'image' || layer.asset.imageSequenceUrls?.length
    ? <img key={`program-source-${layer.clip.id}`} ref={(element) => { if (element) sourceRefs.current.set(layer.clip.id, element); else sourceRefs.current.delete(layer.clip.id) }} className="chroma-source" src={imageSequenceUrlAt(layer.asset, clipSourceTime(layer.clip, playhead))} alt="" onLoad={drawProgram} />
    : <Fragment key={`program-source-${layer.clip.id}`}><video ref={(element) => { if (element) sourceRefs.current.set(layer.clip.id, element); else sourceRefs.current.delete(layer.clip.id) }} className="chroma-source" src={layer.asset.url} playsInline muted onLoadedData={drawProgram} onSeeked={drawProgram} />{(layer.clip.frameInterpolation === 'blend' || layer.clip.frameInterpolation === 'optical-flow') && <video ref={(element) => { const key = `${layer.clip.id}:blend`; if (element) sourceRefs.current.set(key, element); else sourceRefs.current.delete(key) }} className="chroma-source" src={layer.asset.url} playsInline muted onLoadedData={drawProgram} onSeeked={drawProgram} />}</Fragment>)}</>
}

function ReferenceCompareOverlay({ frame, mode, position }: { frame: ImageData; mode: 'wipe' | 'split'; position: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = frame.width
    canvas.height = frame.height
    canvas.getContext('2d')?.putImageData(frame, 0, 0)
  }, [frame])
  const boundary = mode === 'split' ? 50 : Math.max(0, Math.min(100, position))
  return <div className="reference-compare-overlay" aria-label="기준 프레임 비교"><canvas ref={canvasRef} style={{ clipPath: `inset(0 ${100 - boundary}% 0 0)` }} /><i style={{ left: `${boundary}%` }} /><span style={{ left: `${Math.max(2, boundary - 1)}%` }}>REFERENCE</span><b>CURRENT</b></div>
}

function MulticamAngleTile({ angle, isPlaying, playbackRate, onSelect }: { angle: MulticamPreviewAngle; isPlaying: boolean; playbackRate: number; onSelect: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = videoRef.current
    if (!video || angle.asset?.kind !== 'video' || angle.asset.imageSequenceUrls?.length) return
    syncMedia(video, angle.sourceTime, { playing: isPlaying, playbackRate: Math.max(MIN_MEDIA_PLAYBACK_RATE, playbackRate) })
    if (isPlaying) void video.play().catch(() => undefined)
    else video.pause()
  }, [angle.asset?.id, angle.asset?.kind, angle.sourceTime, isPlaying, playbackRate])
  return <button className={`multicam-angle-tile ${angle.active ? 'active' : ''}`} onClick={onSelect} title={`${angle.name}로 전환`}>
    {angle.asset && (angle.asset.kind === 'image' || angle.asset.imageSequenceUrls?.length) ? <img src={imageSequenceUrlAt(angle.asset, angle.sourceTime)} alt="" /> : angle.asset?.kind === 'video' ? <video ref={videoRef} src={angle.asset.url} playsInline muted /> : <span>오프라인</span>}
    <i>CAM {angle.index + 1}</i><strong>{angle.name}</strong>
  </button>
}

export function PreviewPanel({ preset, fps, timecodeStart = 0, timecodeDropFrame = false, asset, layers, adjustmentClips, audioLayers, audioBuses, captionClips, sourceTime, syncKey, playhead, duration, isPlaying, playbackRate, onTogglePlayback, onShuttleReverse, onShuttleStop, onShuttleForward, onSeek, onInsertSource, onOverwriteSource, onReplaceSelectedClip, onFitToFill, sourceIn, sourceOut, onMarkIn, onMarkOut, onClearSourceRange, onReverseMatchFrame, onProgramFrame, referenceFrame, comparisonEnabled = false, comparisonMode = 'wipe', comparisonPosition = 50, onCaptureReference, onToggleComparison, onComparisonModeChange, onComparisonPositionChange, onExportFrame, multicamAngles = [], onSwitchMulticamAngle, selectedClip, selectedClipLocked = false, onUpdateSelectedClip }: PreviewPanelProps) {
  const audioBusKey = useMemo(() => JSON.stringify(audioBuses), [audioBuses])
  const sourceHasAudio = Boolean(asset && asset.kind !== 'image' && (asset.kind === 'audio' || asset.audioCodec || asset.channels))
  const hasProgramAudio = !asset && audioLayers.length > 0
  const hasMonitorAudio = hasProgramAudio || sourceHasAudio
  const sourceAudioClip: TimelineClip | undefined = asset && sourceHasAudio ? { id: `source-audio-${asset.id}`, trackId: 'source-audio', assetId: asset.id, name: asset.name, start: 0, duration: Math.max(.01, asset.duration), sourceOffset: 0, kind: 'audio', color: asset.labelColor ?? '#3fb993', transform: { positionX: 0, positionY: 0, scale: 100, rotation: 0, opacity: 100 }, audioAdjustment: defaultAudioAdjustment() } : undefined
  const sourceAudioTrack: TimelineTrack | undefined = sourceAudioClip ? { id: 'source-audio', name: '소스 모니터', kind: 'audio', muted: false, locked: false, visible: true, audioRole: 'dialogue', volume: 100, pan: 0, clips: [sourceAudioClip] } : undefined
  const dialogueActive = audioLayers.some((layer) => (layer.track.audioRole ?? ({ ...defaultAudioAdjustment(), ...layer.clip.audioAdjustment }).role) === 'dialogue')
  const forwardPlaying = isPlaying && playbackRate > 0
  const [audioEngine, setAudioEngine] = useState<PreviewAudioEngine>()
  const [monitorMuted, setMonitorMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [monitorAssist, setMonitorAssist] = useState<MonitorAssistMode>('normal')
  const [monitorOverlays, setMonitorOverlays] = useState(readMonitorOverlays)
  const [cleanFeed, setCleanFeed] = useState(false)
  const [transparentPreview, setTransparentPreview] = useState(false)
  const [transformControls, setTransformControls] = useState(true)
  const [clipOverride, setClipOverride] = useState<TimelineClip>()
  const [transformSnap, setTransformSnap] = useState({ x: false, y: false })
  const stageWrapRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const transformPatchRef = useRef<Partial<TimelineClip> | undefined>(undefined)
  const transformGestureRef = useRef<{
    mode: 'move' | 'scale' | 'rotate' | 'anchor' | 'corner-pin'
    cornerIndex?: number
    clip: TimelineClip
    manualTransform: TimelineClip['transform']
    manualEffects: ReturnType<typeof resolveVisualEffects>
    startX: number
    startY: number
    anchorX: number
    anchorY: number
    startDistance: number
    startAngle: number
  } | undefined>(undefined)
  useEffect(() => {
    setClipOverride(undefined)
    setTransformSnap({ x: false, y: false })
    transformGestureRef.current = undefined
  }, [selectedClip?.id])
  const visibleSelectedClip = !asset && selectedClip && selectedClip.kind !== 'audio' && !selectedClip.adjustmentLayer && playhead >= selectedClip.start && playhead <= selectedClip.start + selectedClip.duration ? selectedClip : undefined
  const displayedSelectedClip = clipOverride?.id === visibleSelectedClip?.id ? clipOverride : visibleSelectedClip
  const selectedLayer = visibleSelectedClip ? layers.find((layer) => layer.clip.id === visibleSelectedClip.id) : undefined
  const selectedSourceWidth = selectedLayer?.asset.width ?? preset.width
  const selectedSourceHeight = selectedLayer?.asset.height ?? preset.height
  const selectedFit = visibleSelectedClip?.kind === 'caption' ? 1 : Math.min(preset.width / Math.max(1, selectedSourceWidth), preset.height / Math.max(1, selectedSourceHeight))
  const selectedBoxWidth = visibleSelectedClip?.kind === 'caption' ? preset.width * Math.max(0.25, Math.min(1, (visibleSelectedClip.captionStyle?.maxWidth ?? 80) / 100)) : selectedSourceWidth * selectedFit
  const selectedBoxHeight = visibleSelectedClip?.kind === 'caption' ? preset.height * 0.16 : selectedSourceHeight * selectedFit
  const effectiveLayers = clipOverride ? layers.map((layer) => layer.clip.id === clipOverride.id ? { ...layer, clip: clipOverride } : layer) : layers
  const effectiveCaptionClips = clipOverride ? captionClips.map((clip) => clip.id === clipOverride.id ? clipOverride : clip) : captionClips
  const buildTransformPatch = (clip: TimelineClip, transform: TimelineClip['transform']): Partial<TimelineClip> => {
    if (!clip.keyframes?.length) return { transform: { ...clip.transform, ...transform } }
    const localTime = Math.max(0, Math.min(clip.duration, playhead - clip.start))
    const matching = clip.keyframes.find((keyframe) => Math.abs(keyframe.time - localTime) <= 1 / Math.max(1, fps))
    const keyframes = matching
      ? clip.keyframes.map((keyframe) => keyframe.id === matching.id ? { ...keyframe, transform } : keyframe)
      : [...clip.keyframes, { id: crypto.randomUUID(), time: localTime, easing: 'ease-in-out' as const, transform }].sort((left, right) => left.time - right.time)
    return { keyframes }
  }
  const buildVisualPatch = (clip: TimelineClip, effects: ReturnType<typeof resolveVisualEffects>): Partial<TimelineClip> => {
    if (!clip.visualKeyframes?.length) return { visualEffects: effects }
    const localTime = Math.max(0, Math.min(clip.duration, playhead - clip.start))
    const matching = clip.visualKeyframes.find((keyframe) => Math.abs(keyframe.time - localTime) <= 1 / Math.max(1, fps))
    const visualKeyframes = matching
      ? clip.visualKeyframes.map((keyframe) => keyframe.id === matching.id ? { ...keyframe, effects } : keyframe)
      : [...clip.visualKeyframes, { id: crypto.randomUUID(), time: localTime, easing: 'ease-in-out' as const, effects }].sort((left, right) => left.time - right.time)
    return { visualKeyframes }
  }
  const beginTransformGesture = (mode: 'move' | 'scale' | 'rotate' | 'anchor' | 'corner-pin', event: ReactPointerEvent<HTMLElement>, cornerIndex?: number) => {
    if (!displayedSelectedClip || selectedClipLocked || isPlaying) return
    const stage = stageRef.current
    if (!stage) return
    event.preventDefault()
    event.stopPropagation()
    const control = event.currentTarget.closest('.program-transform-box') as HTMLElement | null
    control?.setPointerCapture(event.pointerId)
    const bounds = stage.getBoundingClientRect()
    const resolved = resolveClipTransform(displayedSelectedClip, playhead)
    const manualTransform = resolveClipTransform({ ...displayedSelectedClip, motionPathAutoOrient: false, transitionIn: undefined, transitionOut: undefined }, playhead)
    const manualEffects = resolveVisualEffects(displayedSelectedClip, playhead)
    const anchorX = bounds.left + bounds.width / 2 + resolved.positionX / preset.width * bounds.width
    const anchorY = bounds.top + bounds.height / 2 + resolved.positionY / preset.height * bounds.height
    transformGestureRef.current = { mode, cornerIndex, clip: displayedSelectedClip, manualTransform, manualEffects, startX: event.clientX, startY: event.clientY, anchorX, anchorY, startDistance: Math.max(1, Math.hypot(event.clientX - anchorX, event.clientY - anchorY)), startAngle: Math.atan2(event.clientY - anchorY, event.clientX - anchorX) }
  }
  const moveTransformGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = transformGestureRef.current
    const stage = stageRef.current
    if (!gesture || !stage || event.buttons !== 1) return
    const bounds = stage.getBoundingClientRect()
    let patch: Partial<TimelineClip>
    if (gesture.mode === 'anchor') {
      const resolved = resolveClipTransform(gesture.clip, playhead)
      const anchorScreenX = bounds.left + bounds.width / 2 + resolved.positionX / preset.width * bounds.width
      const anchorScreenY = bounds.top + bounds.height / 2 + resolved.positionY / preset.height * bounds.height
      const screenX = (event.clientX - anchorScreenX) / Math.max(1, bounds.width) * preset.width
      const screenY = (event.clientY - anchorScreenY) / Math.max(1, bounds.height) * preset.height
      const inverseAngle = -resolved.rotation * Math.PI / 180
      const rotatedX = Math.cos(inverseAngle) * screenX - Math.sin(inverseAngle) * screenY
      const rotatedY = Math.sin(inverseAngle) * screenX + Math.cos(inverseAngle) * screenY
      const skew = safeControlSkew(resolved)
      const localScaledX = (rotatedX - skew.x * rotatedY) / skew.determinant
      const localScaledY = (rotatedY - skew.y * rotatedX) / skew.determinant
      const horizontalScale = resolved.scale / 100 * (resolved.scaleX ?? 100) / 100
      const verticalScale = resolved.scale / 100 * (resolved.scaleY ?? 100) / 100
      const anchorX = (localScaledX / (Math.abs(horizontalScale) < 0.0001 ? 0.0001 : horizontalScale) + selectedBoxWidth * (resolved.anchorX ?? 50) / 100) / Math.max(1, selectedBoxWidth) * 100
      const anchorY = (localScaledY / (Math.abs(verticalScale) < 0.0001 ? 0.0001 : verticalScale) + selectedBoxHeight * (resolved.anchorY ?? 50) / 100) / Math.max(1, selectedBoxHeight) * 100
      const deltaX = selectedBoxWidth * (anchorX - (resolved.anchorX ?? 50)) / 100 * horizontalScale
      const deltaY = selectedBoxHeight * (anchorY - (resolved.anchorY ?? 50)) / 100 * verticalScale
      const skewedX = deltaX + skew.x * deltaY
      const skewedY = skew.y * deltaX + deltaY
      const angle = resolved.rotation * Math.PI / 180
      const positionX = gesture.manualTransform.positionX + Math.cos(angle) * skewedX - Math.sin(angle) * skewedY
      const positionY = gesture.manualTransform.positionY + Math.sin(angle) * skewedX + Math.cos(angle) * skewedY
      patch = buildTransformPatch(gesture.clip, { ...gesture.manualTransform, anchorX, anchorY, positionX, positionY })
    } else if (gesture.mode === 'corner-pin' && gesture.cornerIndex !== undefined) {
      const transform = resolveClipTransform(gesture.clip, playhead)
      const anchorX = bounds.left + bounds.width / 2 + transform.positionX / preset.width * bounds.width
      const anchorY = bounds.top + bounds.height / 2 + transform.positionY / preset.height * bounds.height
      const screenX = (event.clientX - anchorX) / Math.max(1, bounds.width) * preset.width
      const screenY = (event.clientY - anchorY) / Math.max(1, bounds.height) * preset.height
      const angle = -transform.rotation * Math.PI / 180
      const rotatedX = Math.cos(angle) * screenX - Math.sin(angle) * screenY
      const rotatedY = Math.sin(angle) * screenX + Math.cos(angle) * screenY
      const skew = safeControlSkew(transform)
      const localScaledX = (rotatedX - skew.x * rotatedY) / skew.determinant
      const localScaledY = (rotatedY - skew.y * rotatedX) / skew.determinant
      const horizontalScale = transform.scale / 100 * (transform.scaleX ?? 100) / 100
      const verticalScale = transform.scale / 100 * (transform.scaleY ?? 100) / 100
      const point = {
        x: (localScaledX / (Math.abs(horizontalScale) < 0.0001 ? 0.0001 : horizontalScale) + selectedBoxWidth * (transform.anchorX ?? 50) / 100) / Math.max(1, selectedBoxWidth) * 100,
        y: (localScaledY / (Math.abs(verticalScale) < 0.0001 ? 0.0001 : verticalScale) + selectedBoxHeight * (transform.anchorY ?? 50) / 100) / Math.max(1, selectedBoxHeight) * 100,
      }
      const points = (gesture.manualEffects.cornerPinPoints?.length === 4 ? gesture.manualEffects.cornerPinPoints : [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]).map((candidate, index) => index === gesture.cornerIndex ? point : { ...candidate })
      patch = buildVisualPatch(gesture.clip, { ...gesture.manualEffects, cornerPinEnabled: true, cornerPinPoints: points })
    } else {
      let transform = { ...gesture.manualTransform }
      if (gesture.mode === 'move') {
      let deltaX = (event.clientX - gesture.startX) / Math.max(1, bounds.width) * preset.width
      let deltaY = (event.clientY - gesture.startY) / Math.max(1, bounds.height) * preset.height
      if (event.shiftKey) Math.abs(deltaX) >= Math.abs(deltaY) ? deltaY = 0 : deltaX = 0
      let positionX = gesture.manualTransform.positionX + deltaX
      let positionY = gesture.manualTransform.positionY + deltaY
      const snapX = !event.altKey && Math.abs(positionX) <= 8 / Math.max(1, bounds.width) * preset.width
      const snapY = !event.altKey && Math.abs(positionY) <= 8 / Math.max(1, bounds.height) * preset.height
      if (snapX) positionX = 0
      if (snapY) positionY = 0
      setTransformSnap({ x: snapX, y: snapY })
      transform = { ...transform, positionX, positionY }
      } else if (gesture.mode === 'scale') {
      let scale = gesture.manualTransform.scale * Math.hypot(event.clientX - gesture.anchorX, event.clientY - gesture.anchorY) / gesture.startDistance
      if (event.shiftKey) scale = Math.round(scale / 5) * 5
      transform = { ...transform, scale: Math.max(0.1, Math.min(4000, scale)) }
      } else {
      let rotation = gesture.manualTransform.rotation + (Math.atan2(event.clientY - gesture.anchorY, event.clientX - gesture.anchorX) - gesture.startAngle) * 180 / Math.PI
      if (event.shiftKey) rotation = Math.round(rotation / 15) * 15
      transform = { ...transform, rotation }
      }
      patch = buildTransformPatch(gesture.clip, transform)
    }
    const next = { ...gesture.clip, ...patch }
    transformPatchRef.current = patch
    setClipOverride(next)
  }
  const endTransformGesture = (event: ReactPointerEvent<HTMLElement>) => {
    if (!transformGestureRef.current) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const clip = transformGestureRef.current.clip
    const patch = transformPatchRef.current
    transformGestureRef.current = undefined
    transformPatchRef.current = undefined
    setTransformSnap({ x: false, y: false })
    if (patch) onUpdateSelectedClip?.(clip.id, patch)
    requestAnimationFrame(() => requestAnimationFrame(() => setClipOverride(undefined)))
  }
  useEffect(() => {
    if (!hasMonitorAudio) {
      setAudioEngine(undefined)
      return
    }
    const next = createPreviewAudioEngine(audioBuses)
    setAudioEngine(next)
    return () => { void next.context.close() }
  }, [audioBusKey, hasMonitorAudio])
  useEffect(() => {
    if (!audioEngine || audioEngine.context.state === 'closed') return
    audioEngine.outputGain.gain.setTargetAtTime(monitorMuted ? 0 : 1, audioEngine.context.currentTime, 0.01)
  }, [audioEngine, monitorMuted])
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === stageWrapRef.current)
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])
  useEffect(() => { localStorage.setItem('editweave.monitor-overlays.v1', JSON.stringify(monitorOverlays)) }, [monitorOverlays])
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else {
      const request = stageWrapRef.current?.requestFullscreen()
      if (request) void request.catch(() => undefined)
    }
  }
  const selectedResolvedTransform = displayedSelectedClip ? resolveClipTransform(displayedSelectedClip, playhead) : undefined
  const nudgeSelectedTransform = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!displayedSelectedClip || selectedClipLocked || isPlaying || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    const amount = event.altKey ? 0.1 : event.shiftKey ? 10 : 1
    const transform = resolveClipTransform({ ...displayedSelectedClip, motionPathAutoOrient: false, transitionIn: undefined, transitionOut: undefined }, playhead)
    if (event.key === 'ArrowLeft') transform.positionX -= amount
    else if (event.key === 'ArrowRight') transform.positionX += amount
    else if (event.key === 'ArrowUp') transform.positionY -= amount
    else transform.positionY += amount
    onUpdateSelectedClip?.(displayedSelectedClip.id, buildTransformPatch(displayedSelectedClip, transform))
  }
  const controlSkew = safeControlSkew(selectedResolvedTransform)
  const controlSkewX = controlSkew.x
  const controlSkewY = controlSkew.y
  const selectedResolvedEffects = displayedSelectedClip ? resolveVisualEffects(displayedSelectedClip, playhead) : undefined
  const selectedCornerPinPoints = selectedResolvedEffects?.cornerPinEnabled ? selectedResolvedEffects.cornerPinPoints?.length === 4 ? selectedResolvedEffects.cornerPinPoints : [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] : undefined
  const selectedCornerPolygon = selectedCornerPinPoints?.map((point) => `${point.x},${point.y}`).join(' ')
  const transformBoxStyle: CSSProperties | undefined = selectedResolvedTransform ? {
    left: `${50 + selectedResolvedTransform.positionX / preset.width * 100 - (selectedResolvedTransform.anchorX ?? 50) / 100 * selectedBoxWidth / preset.width * 100}%`,
    top: `${50 + selectedResolvedTransform.positionY / preset.height * 100 - (selectedResolvedTransform.anchorY ?? 50) / 100 * selectedBoxHeight / preset.height * 100}%`,
    width: `${selectedBoxWidth / preset.width * 100}%`,
    height: `${selectedBoxHeight / preset.height * 100}%`,
    transformOrigin: `${selectedResolvedTransform.anchorX ?? 50}% ${selectedResolvedTransform.anchorY ?? 50}%`,
    transform: `rotate(${selectedResolvedTransform.rotation}deg) matrix(1, ${controlSkewY}, ${controlSkewX}, 1, 0, 0) scale(${selectedResolvedTransform.scale / 100 * (selectedResolvedTransform.scaleX ?? 100) / 100}, ${selectedResolvedTransform.scale / 100 * (selectedResolvedTransform.scaleY ?? 100) / 100})`,
  } : undefined
  return (
    <main className="preview-panel panel-surface">
      <div className="monitor-labels"><span>{asset ? 'SOURCE' : 'PROGRAM'}{isPlaying && playbackRate !== 1 ? ` · ${playbackRate > 0 ? '+' : ''}${playbackRate}×` : ''}</span><span>{preset.width} × {preset.height} · {fps} fps</span>{!asset && <button className={`monitor-alpha-toggle ${transparentPreview ? 'active' : ''}`} onClick={() => setTransparentPreview((value) => !value)}>알파 배경</button>}</div>
      <div className={`stage-wrap ${!asset && multicamAngles.length > 1 && !cleanFeed ? 'multicam' : ''} ${cleanFeed ? 'clean-feed' : ''}`} ref={stageWrapRef}>
        <div ref={stageRef} className={`stage ratio-${preset.ratio.replace(':', '-')} ${!asset && transparentPreview ? 'alpha-checkerboard' : ''}`} style={{ aspectRatio: `${preset.width} / ${preset.height}`, '--monitor-aspect': preset.width / preset.height } as CSSProperties}>
          {asset?.url && <SourceMonitor asset={asset} sourceTime={sourceTime} syncKey={syncKey} isPlaying={forwardPlaying} playbackRate={Math.max(MIN_MEDIA_PLAYBACK_RATE, playbackRate)} muted />}
          {!asset && <>{layers.length || captionClips.length || adjustmentClips.length ? <ProgramCanvas preset={preset} layers={effectiveLayers} adjustmentClips={adjustmentClips} captionClips={effectiveCaptionClips} playhead={playhead} isPlaying={forwardPlaying} playbackRate={Math.max(MIN_MEDIA_PLAYBACK_RATE, playbackRate)} monitorAssist={cleanFeed ? 'normal' : monitorAssist} transparentPreview={transparentPreview} onProgramFrame={onProgramFrame} /> : <div className="program-composite"><div className="demo-frame"><span className="demo-kicker">CREATOR WORKFLOW</span><h1>긴 영상에서<br /><em>좋은 순간만.</em></h1><p>Long-form → Shorts, one timeline.</p><div className="demo-orbit orbit-one" /><div className="demo-orbit orbit-two" /></div></div>}</>}
          {!asset && !cleanFeed && comparisonEnabled && referenceFrame && <ReferenceCompareOverlay frame={referenceFrame} mode={comparisonMode} position={comparisonPosition} />}
          {!asset && !cleanFeed && transformControls && transformSnap.x && <i className="transform-snap-guide vertical" />}
          {!asset && !cleanFeed && transformControls && transformSnap.y && <i className="transform-snap-guide horizontal" />}
          {!asset && !cleanFeed && transformControls && transformBoxStyle && displayedSelectedClip && <div tabIndex={selectedClipLocked || isPlaying ? -1 : 0} className={`program-transform-box ${selectedCornerPinPoints ? 'corner-pin-active' : ''} ${selectedClipLocked || isPlaying ? 'locked' : ''}`} style={transformBoxStyle} onKeyDown={nudgeSelectedTransform} onPointerDown={(event) => beginTransformGesture('move', event)} onPointerMove={moveTransformGesture} onPointerUp={endTransformGesture} onPointerCancel={endTransformGesture}><button type="button" className="transform-anchor" style={{ left: `${selectedResolvedTransform?.anchorX ?? 50}%`, top: `${selectedResolvedTransform?.anchorY ?? 50}%` }} aria-label="선택 클립 앵커 이동" onPointerDown={(event) => beginTransformGesture('anchor', event)} /><i className="transform-rotate-line" /><button type="button" className="transform-rotate-handle" aria-label="선택 클립 회전" onPointerDown={(event) => beginTransformGesture('rotate', event)} />{(selectedCornerPinPoints ? ['n', 'e', 's', 'w'] : ['nw', 'ne', 'se', 'sw']).map((corner) => <button type="button" key={corner} className={`transform-scale-handle ${corner}`} aria-label={`선택 클립 크기 조절 ${corner}`} onPointerDown={(event) => beginTransformGesture('scale', event)} />)}{selectedCornerPinPoints && <><svg className="corner-pin-outline" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points={selectedCornerPolygon} /></svg>{selectedCornerPinPoints.map((point, index) => <button type="button" key={`corner-pin-${index}`} className="corner-pin-handle" style={{ left: `${point.x}%`, top: `${point.y}%` }} aria-label={`${['좌상', '우상', '우하', '좌하'][index]} 코너 핀`} onPointerDown={(event) => beginTransformGesture('corner-pin', event, index)} />)}</>}<span className="transform-box-label">{displayedSelectedClip.name}</span></div>}
          {!asset && audioEngine && audioLayers.map((layer) => <AudioLayer key={`audio-${audioEngine.id}-${layer.clip.id}`} layer={layer} playhead={playhead} isPlaying={forwardPlaying} playbackRate={Math.max(MIN_MEDIA_PLAYBACK_RATE, playbackRate)} engine={audioEngine} dialogueActive={dialogueActive} />)}
          {asset && audioEngine && sourceAudioClip && sourceAudioTrack && <AudioLayer key={`source-audio-${audioEngine.id}-${asset.id}`} layer={{ clip: sourceAudioClip, asset, track: sourceAudioTrack }} playhead={sourceTime} isPlaying={forwardPlaying} playbackRate={Math.max(MIN_MEDIA_PLAYBACK_RATE, playbackRate)} engine={audioEngine} dialogueActive={false} />}
          {!asset && !cleanFeed && <div className="program-monitor-overlays">{monitorOverlays.actionSafe && <div className="monitor-safe monitor-safe-action"><span>ACTION SAFE</span></div>}{monitorOverlays.titleSafe && <div className="monitor-safe monitor-safe-title"><span>TITLE SAFE</span></div>}{monitorOverlays.thirds && <div className="monitor-thirds"><i /><i /><b /><b /></div>}{monitorOverlays.center && <div className="monitor-center"><i /><b /></div>}{monitorOverlays.timecode && <time>{formatMediaTimecode(timecodeStart + playhead, fps, timecodeDropFrame)}</time>}</div>}
          {!asset && !cleanFeed && preset.ratio !== '16:9' && captionClips.some((clip) => (clip.captionStyle?.position ?? 'bottom') === 'bottom' && (clip.captionStyle?.fontSize ?? 100) > 130) && <div className="safe-collision-warning">자막이 플랫폼 UI 안전 영역과 겹칠 수 있습니다.</div>}
        </div>
        {!asset && !cleanFeed && multicamAngles.length > 1 && <aside className="multicam-angle-monitor"><header><strong>MULTICAM</strong><small>재생 중 선택하면 해당 프레임에서 컷</small></header><div>{multicamAngles.map((angle) => <MulticamAngleTile key={angle.index} angle={angle} isPlaying={forwardPlaying} playbackRate={playbackRate} onSelect={() => onSwitchMulticamAngle?.(angle.index)} />)}</div></aside>}
      </div>
      <div className={`transport ${asset ? 'source-transport' : ''}`}>
        {asset && <div className="source-scrubber"><input aria-label="소스 미디어 위치" type="range" min="0" max={Math.max(0.01, duration)} step="0.01" value={Math.min(duration, playhead)} onChange={(event) => onSeek(Number(event.target.value))} /><span>I {sourceIn === undefined ? '—' : formatTimecode(sourceIn, true)}</span><span>O {sourceOut === undefined ? '—' : formatTimecode(sourceOut, true)}</span></div>}
        <div className="time-display active">{formatMediaTimecode(timecodeStart + playhead, fps, timecodeDropFrame)}</div>
        <div className="transport-buttons">{asset && <button className="source-mark-button" onClick={onMarkIn} title="소스 인 점 (I)">I</button>}<button className="icon-button" onClick={() => onSeek(Math.max(0, playhead - 5))} aria-label="5초 뒤로"><SkipBack size={17} /></button><button className="source-mark-button" onClick={onShuttleReverse} title="역방향 셔틀 (J)">J</button><button className="source-mark-button" onClick={onShuttleStop} title="셔틀 정지 (K)">K</button><button className="play-button" onClick={onTogglePlayback} aria-label={isPlaying ? '일시 정지' : '재생'}>{isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><button className="source-mark-button" onClick={onShuttleForward} title="정방향 셔틀 (L)">L</button><button className="icon-button" onClick={() => onSeek(Math.min(duration, playhead + 5))} aria-label="5초 앞으로"><SkipForward size={17} /></button>{asset && <button className="source-mark-button" onClick={onMarkOut} title="소스 아웃 점 (O)">O</button>}{asset && <button className="source-edit-button" onClick={onInsertSource} title="소스를 재생 헤드에 삽입 (,)">삽입</button>}{asset && <button className="source-edit-button" onClick={onOverwriteSource} title="소스를 재생 헤드에 덮어쓰기 (.)">덮어쓰기</button>}{asset && onReplaceSelectedClip && <button className="source-edit-button" onClick={onReplaceSelectedClip} title="선택 타임라인 클립의 위치·길이·효과를 유지하고 현재 소스로 교체">소스로 교체</button>}{asset && onFitToFill && <button className="source-edit-button" onClick={onFitToFill} title="소스 IN/OUT을 시퀀스 IN/OUT 길이에 맞춰 덮어쓰기 (Shift+R)">Fit to Fill</button>}{asset && onReverseMatchFrame && <button className="source-edit-button" onClick={onReverseMatchFrame} title="현재 소스 프레임을 사용하는 타임라인 클립 찾기 (Shift+F)">타임라인 찾기</button>}{asset && (sourceIn !== undefined || sourceOut !== undefined) && <button className="source-clear-button" onClick={onClearSourceRange}>범위 해제</button>}</div>
        <div className="monitor-tools"><ProgramAudioMeter engine={audioEngine} isPlaying={forwardPlaying} />{!asset && <button className={`monitor-text-button ${transformControls ? 'active' : ''}`} onClick={() => setTransformControls((value) => !value)}>변형 핸들</button>}{!asset && <button className={`monitor-text-button ${cleanFeed ? 'active' : ''}`} onClick={() => setCleanFeed((value) => !value)}>클린 피드</button>}{!asset && <details className="monitor-overlay-menu"><summary className="monitor-text-button">가이드</summary><div>{([['actionSafe','액션 세이프'],['titleSafe','타이틀 세이프'],['thirds','3분할'],['center','중앙 십자'],['timecode','타임코드']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={monitorOverlays[key]} onChange={(event) => setMonitorOverlays((current) => ({ ...current, [key]: event.target.checked }))} /> {label}</label>)}</div></details>}{!asset && <select className={`monitor-assist-select ${monitorAssist !== 'normal' ? 'active' : ''}`} value={monitorAssist} onChange={(event) => setMonitorAssist(event.target.value as MonitorAssistMode)} title="모니터 노출·레벨 보조"><option value="normal">일반 화면</option><option value="false-color">False Color</option><option value="zebra-70">Zebra 70 IRE</option><option value="zebra-100">Zebra 100 IRE</option><option value="video-levels">비디오 레벨 경고</option></select>}{!asset && onCaptureReference && <button className="monitor-text-button" onClick={onCaptureReference}>기준 저장</button>}{!asset && referenceFrame && onToggleComparison && <button className={`monitor-text-button ${comparisonEnabled ? 'active' : ''}`} onClick={onToggleComparison}>비교</button>}{!asset && comparisonEnabled && referenceFrame && <><select className="comparison-mode-select" value={comparisonMode} onChange={(event) => onComparisonModeChange?.(event.target.value as 'wipe' | 'split')}><option value="wipe">와이프</option><option value="split">좌우</option></select>{comparisonMode === 'wipe' && <input className="comparison-position" aria-label="비교 와이프 위치" type="range" min="5" max="95" value={comparisonPosition} onChange={(event) => onComparisonPositionChange?.(Number(event.target.value))} />}</>}{!asset && onExportFrame && <details className="export-frame-menu"><summary className="monitor-text-button">프레임</summary><div><button onClick={() => onExportFrame('png')}>PNG 저장</button><button onClick={() => onExportFrame('jpeg')}>JPEG 저장</button></div></details>}<button className={`monitor-icon-button ${monitorMuted ? 'active' : ''}`} onClick={() => setMonitorMuted((muted) => !muted)} aria-label={monitorMuted ? '모니터 음소거 해제' : '모니터 음소거'}>{monitorMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button><button className="monitor-icon-button" onClick={toggleFullscreen} aria-label={fullscreen ? '전체화면 종료' : '모니터 전체화면'}>{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button></div>
      </div>
    </main>
  )
}
