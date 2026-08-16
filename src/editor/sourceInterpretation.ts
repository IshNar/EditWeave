import type { MediaAsset, TimelineClip } from './types'

export interface InterpretableDrawable {
  draw(context: CanvasRenderingContext2D, dx: number, dy: number, width: number, height: number): void
}

export interface SourceDrawBounds {
  x: number
  y: number
  width: number
  height: number
}

export function hasSourceInterpretation(asset?: MediaAsset): boolean {
  return Boolean(asset && ((asset.sourceRotation ?? 0) !== 0 || Math.abs((asset.sourcePixelAspectRatio ?? 1) - 1) > .0001 || (asset.sourceFieldOrder ?? 'progressive') !== 'progressive' || asset.sourceAlphaMode === 'ignore'))
}

export function interpretedSourceDimensions(sourceWidth: number, sourceHeight: number, asset: MediaAsset): { width: number; height: number } {
  const pixelAspect = Math.max(.1, Math.min(10, asset.sourcePixelAspectRatio ?? 1))
  const width = Math.max(1, sourceWidth) * pixelAspect
  const height = Math.max(1, sourceHeight)
  const quarterTurn = asset.sourceRotation === 90 || asset.sourceRotation === 270
  return quarterTurn ? { width: height, height: width } : { width, height }
}

export function interpretNormalizedPoint(asset: MediaAsset, x: number, y: number): { x: number; y: number } {
  if (asset.sourceRotation === 90) return { x: 1 - y, y: x }
  if (asset.sourceRotation === 180) return { x: 1 - x, y: 1 - y }
  if (asset.sourceRotation === 270) return { x: y, y: 1 - x }
  return { x, y }
}

export function effectiveSourceHdrFormat(asset: MediaAsset): MediaAsset['hdrFormat'] | undefined {
  if (asset.sourceColorSpaceOverride === 'rec2020-pq') return 'pq'
  if (asset.sourceColorSpaceOverride === 'rec2020-hlg') return 'hlg'
  if (asset.sourceColorSpaceOverride === 'display-p3') return 'wide-gamut'
  if (asset.sourceColorSpaceOverride === 'rec709') return undefined
  return asset.hdrFormat
}

export function effectiveSourceColorLabel(asset: MediaAsset): string {
  if (asset.sourceColorSpaceOverride === 'rec2020-pq') return 'Rec.2020 · PQ'
  if (asset.sourceColorSpaceOverride === 'rec2020-hlg') return 'Rec.2020 · HLG'
  if (asset.sourceColorSpaceOverride === 'display-p3') return 'Display P3'
  if (asset.sourceColorSpaceOverride === 'rec709') return 'Rec.709'
  return [asset.hdrFormat?.toUpperCase(), asset.colorPrimaries, asset.colorTransfer, asset.colorSpace, asset.colorRange].filter(Boolean).join(' · ') || '미지정 / Rec.709 가정'
}

export function sourceFrameConformRate(asset?: MediaAsset): number {
  if (!asset || asset.kind !== 'video' || !asset.sourceFrameRateOverride || !asset.frameRate) return 1
  return Math.max(.05, Math.min(16, asset.sourceFrameRateOverride / asset.frameRate))
}

export function interpretedSourceDuration(mediaDuration: number, asset?: MediaAsset): number {
  return Math.max(0, mediaDuration) / sourceFrameConformRate(asset)
}

export function sourceTimelineToMediaTime(time: number, asset?: MediaAsset): number {
  return Math.max(0, time) * sourceFrameConformRate(asset)
}

export function sourceMediaToTimelineTime(time: number, asset?: MediaAsset): number {
  return Math.max(0, time) / sourceFrameConformRate(asset)
}

export function retimeClipForSourceConform(clip: TimelineClip, previousRate: number, nextRate: number): TimelineClip {
  if (clip.freezeFrame || clip.adjustmentLayer || clip.nestedSequenceId || clip.kind === 'caption' || Math.abs(previousRate - nextRate) < .000001) return clip
  const durationScale = previousRate / nextRate
  const rateScale = nextRate / previousRate
  const duration = Math.max(1 / 240, clip.duration * durationScale)
  const scaleTime = (time: number) => Math.max(0, Math.min(duration, time * durationScale))
  const transitionLimit = (edge: 'in' | 'out', transition: TimelineClip['transitionIn']) => {
    const alignment = transition?.alignment ?? (edge === 'in' ? 'start-at-cut' : 'end-at-cut')
    return alignment === 'center-on-cut' ? duration * 2 : duration
  }
  const audioAdjustment = clip.audioAdjustment ? { ...clip.audioAdjustment, fadeIn: Math.min(duration, clip.audioAdjustment.fadeIn * durationScale), fadeOut: Math.min(duration, clip.audioAdjustment.fadeOut * durationScale) } : undefined
  return {
    ...clip,
    duration,
    playbackRate: Math.max(.05, Math.min(16, (clip.playbackRate ?? 1) * rateScale)),
    speedKeyframes: clip.speedKeyframes?.map((keyframe) => ({ ...keyframe, time: scaleTime(keyframe.time), rate: Math.max(.05, Math.min(16, keyframe.rate * rateScale)) })),
    keyframes: clip.keyframes?.map((keyframe) => ({ ...keyframe, time: scaleTime(keyframe.time) })),
    visualKeyframes: clip.visualKeyframes?.map((keyframe) => ({ ...keyframe, time: scaleTime(keyframe.time) })),
    audioMixKeyframes: clip.audioMixKeyframes?.map((keyframe) => ({ ...keyframe, time: scaleTime(keyframe.time) })),
    clipMarkers: clip.clipMarkers?.map((marker) => {
      const time = scaleTime(marker.time)
      return { ...marker, time, duration: marker.duration === undefined ? undefined : Math.min(Math.max(0, duration - time), marker.duration * durationScale) }
    }),
    transitionIn: clip.transitionIn ? { ...clip.transitionIn, duration: Math.min(transitionLimit('in', clip.transitionIn), clip.transitionIn.duration * durationScale) } : undefined,
    transitionOut: clip.transitionOut ? { ...clip.transitionOut, duration: Math.min(transitionLimit('out', clip.transitionOut), clip.transitionOut.duration * durationScale) } : undefined,
    audioAdjustment,
  }
}

export function drawInterpretedSource(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource | InterpretableDrawable,
  sourceWidth: number,
  sourceHeight: number,
  asset: MediaAsset,
  centerX: number,
  centerY: number,
  maximumWidth: number,
  maximumHeight: number,
): SourceDrawBounds {
  const pixelAspect = Math.max(.1, Math.min(10, asset.sourcePixelAspectRatio ?? 1))
  const dimensions = interpretedSourceDimensions(sourceWidth, sourceHeight, asset)
  const fit = Math.min(maximumWidth / dimensions.width, maximumHeight / dimensions.height)
  const rotation = (asset.sourceRotation ?? 0) * Math.PI / 180
  context.save()
  context.translate(centerX, centerY)
  context.rotate(rotation)
  context.scale(fit * pixelAspect, fit)
  if (asset.sourceAlphaMode === 'ignore') {
    context.fillStyle = asset.sourceAlphaBackground || '#000000'
    context.fillRect(-sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight)
  }
  drawFieldInterpretedSource(context, source, sourceWidth, sourceHeight, asset.sourceFieldOrder ?? 'progressive')
  context.restore()
  return { x: centerX - dimensions.width * fit / 2, y: centerY - dimensions.height * fit / 2, width: dimensions.width * fit, height: dimensions.height * fit }
}

function drawFieldInterpretedSource(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource | InterpretableDrawable,
  sourceWidth: number,
  sourceHeight: number,
  fieldOrder: NonNullable<MediaAsset['sourceFieldOrder']>,
): void {
  if (fieldOrder === 'progressive') {
    if ('draw' in source) source.draw(context, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight)
    else context.drawImage(source, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight)
    return
  }
  let drawable: CanvasImageSource
  if ('draw' in source) {
    const buffer = document.createElement('canvas')
    buffer.width = Math.max(1, Math.round(sourceWidth))
    buffer.height = Math.max(1, Math.round(sourceHeight))
    const bufferContext = buffer.getContext('2d')
    if (!bufferContext) return
    source.draw(bufferContext, 0, 0, buffer.width, buffer.height)
    drawable = buffer
  } else drawable = source
  const height = Math.max(1, Math.round(sourceHeight))
  const parity = fieldOrder === 'upper-first' ? 0 : 1
  for (let destinationY = 0; destinationY < height; destinationY += 2) {
    const sourceY = Math.min(height - 1, parity + destinationY)
    const destinationHeight = Math.min(2, height - destinationY)
    context.drawImage(drawable, 0, sourceY, sourceWidth, 1, -sourceWidth / 2, -sourceHeight / 2 + destinationY, sourceWidth, destinationHeight)
  }
}
