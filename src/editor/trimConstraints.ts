import { clipPlaybackRateAtLocal, clipSourceDuration } from './effects'
import type { MediaAsset, ProjectSequence, TimelineClip, TimelineTrack } from './types'

export const MIN_TIMELINE_CLIP_DURATION = 0.05
export const TIMELINE_EDGE_TOLERANCE = 1 / 30

export type ClipSourceDurationMap = ReadonlyMap<string, number>

export interface TrimDeltaRange {
  minimum: number
  maximum: number
}

export interface ClipSourceTrimHandles {
  sourceDuration: number
  sourceSpan: number
  beforeSource: number
  afterSource: number
  startOutward: number
  endOutward: number
}

function sequenceDuration(sequence: ProjectSequence | undefined): number | undefined {
  if (!sequence) return undefined
  return Math.max(0, ...sequence.tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)))
}

/**
 * Builds the authoritative source limit used by trim operations. Images,
 * generated layers and freeze frames are duration-independent; media and
 * nested sequences are limited by their actual source timeline.
 */
export function createClipSourceDurationMap(
  tracks: TimelineTrack[],
  assets: MediaAsset[],
  sequences: ProjectSequence[],
): Map<string, number> {
  const assetsById = new Map<string, MediaAsset>(assets.map((asset) => [asset.id, asset]))
  const sequencesById = new Map<string, ProjectSequence>(sequences.map((sequence) => [sequence.id, sequence]))
  const result = new Map<string, number>()

  tracks.flatMap((track) => track.clips).forEach((clip) => {
    if (clip.freezeFrame || clip.adjustmentLayer || clip.kind === 'caption') {
      result.set(clip.id, Number.POSITIVE_INFINITY)
      return
    }
    if (clip.nestedSequenceId) {
      const duration = sequenceDuration(sequencesById.get(clip.nestedSequenceId))
      if (duration !== undefined) result.set(clip.id, duration)
      return
    }
    const asset = clip.assetId ? assetsById.get(clip.assetId) : undefined
    if (asset?.kind === 'image') {
      result.set(clip.id, Number.POSITIVE_INFINITY)
      return
    }
    if (asset && Number.isFinite(asset.duration) && asset.duration >= 0) {
      result.set(clip.id, asset.duration)
      return
    }
    if (!clip.assetId) result.set(clip.id, Number.POSITIVE_INFINITY)
  })
  return result
}

function sourceLimit(clip: TimelineClip, sourceDurations?: ClipSourceDurationMap): number {
  const consumedEnd = Math.max(0, clip.sourceOffset + clipSourceDuration(clip))
  const configured = sourceDurations?.get(clip.id)
  if (configured === Number.POSITIVE_INFINITY) return configured
  if (configured === undefined || !Number.isFinite(configured)) return consumedEnd
  // A stale or rounded metadata duration must never make the current edit
  // invalid. It simply provides no additional outward handle.
  return Math.max(consumedEnd, configured)
}

export function clipSourceTrimHandles(clip: TimelineClip, sourceDurations?: ClipSourceDurationMap): ClipSourceTrimHandles {
  const sourceSpan = clipSourceDuration(clip)
  const sourceDuration = sourceLimit(clip, sourceDurations)
  if (sourceDuration === Number.POSITIVE_INFINITY || clip.freezeFrame) {
    return {
      sourceDuration,
      sourceSpan,
      beforeSource: Number.POSITIVE_INFINITY,
      afterSource: Number.POSITIVE_INFINITY,
      startOutward: Number.POSITIVE_INFINITY,
      endOutward: Number.POSITIVE_INFINITY,
    }
  }

  const beforeSource = Math.max(0, clip.sourceOffset)
  const afterSource = Math.max(0, sourceDuration - clip.sourceOffset - sourceSpan)
  const startRate = Math.max(0.000001, clipPlaybackRateAtLocal(clip, 0))
  const endRate = Math.max(0.000001, clipPlaybackRateAtLocal(clip, clip.duration))
  return {
    sourceDuration,
    sourceSpan,
    beforeSource,
    afterSource,
    startOutward: (clip.reverse ? afterSource : beforeSource) / startRate,
    endOutward: (clip.reverse ? beforeSource : afterSource) / endRate,
  }
}

export function clipStartTrimDeltaRange(clip: TimelineClip, sourceDurations?: ClipSourceDurationMap): TrimDeltaRange {
  const handles = clipSourceTrimHandles(clip, sourceDurations)
  return {
    minimum: Math.max(-clip.start, -handles.startOutward),
    maximum: Math.max(0, clip.duration - MIN_TIMELINE_CLIP_DURATION),
  }
}

export function clipEndTrimDeltaRange(clip: TimelineClip, sourceDurations?: ClipSourceDurationMap): TrimDeltaRange {
  const handles = clipSourceTrimHandles(clip, sourceDurations)
  return {
    minimum: -Math.max(0, clip.duration - MIN_TIMELINE_CLIP_DURATION),
    maximum: handles.endOutward,
  }
}

export function clipSlipDeltaRange(clip: TimelineClip, edge: 'start' | 'end', sourceDurations?: ClipSourceDurationMap): TrimDeltaRange & { factor: number } {
  const handles = clipSourceTrimHandles(clip, sourceDurations)
  if (clip.freezeFrame || handles.sourceDuration === Number.POSITIVE_INFINITY) {
    return { minimum: 0, maximum: 0, factor: 0 }
  }
  const localTime = edge === 'start' ? 0 : clip.duration
  const direction = clip.reverse ? -1 : 1
  const factor = clipPlaybackRateAtLocal(clip, localTime) * direction
  if (Math.abs(factor) <= 0.000001) return { minimum: 0, maximum: 0, factor: 0 }

  const maximumOffset = Math.max(0, handles.sourceDuration - handles.sourceSpan)
  const lower = (0 - clip.sourceOffset) / factor
  const upper = (maximumOffset - clip.sourceOffset) / factor
  return { minimum: Math.min(lower, upper), maximum: Math.max(lower, upper), factor }
}

export function intersectTrimDeltaRanges(ranges: TrimDeltaRange[]): TrimDeltaRange | undefined {
  if (!ranges.length) return undefined
  const minimum = Math.max(...ranges.map((range) => range.minimum))
  const maximum = Math.min(...ranges.map((range) => range.maximum))
  return minimum <= maximum ? { minimum, maximum } : undefined
}

export function clampTrimDelta(delta: number, range: TrimDeltaRange): number {
  return Math.max(range.minimum, Math.min(range.maximum, delta))
}
