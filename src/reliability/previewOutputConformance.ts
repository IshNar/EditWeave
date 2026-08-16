import { clipSourceTime, resolveClipAudioMix, resolveClipTransform, resolveClipTransitionState, resolveTrackAudioMix, resolveVisualEffects, transitionAudioGain } from '../editor/effects'
import { activeVisualClipsAt, clipsWithAudioTransitionTails, constrainTransitionCarryToAsset } from '../editor/transitions'
import type { MediaAsset, TimelineClip, TimelineTrack } from '../editor/types'
import { frameIndexAtTime } from '../editor/frameMath'

export interface ProgramVisualSnapshot {
  clipId: string
  trackId: string
  assetId: string
  sourceFrame: number
  transform: ReturnType<typeof resolveClipTransform>
  transition: ReturnType<typeof resolveClipTransitionState>
  effects: ReturnType<typeof resolveVisualEffects>
}

export interface ProgramAudioSnapshot {
  clipId: string
  trackId: string
  assetId: string
  sourceSample: number
  clipGainDb: number
  clipPan: number
  trackVolume: number
  trackPan: number
  transitionGain: number
}

export interface ProgramSnapshot {
  timelineFrame: number
  visuals: ProgramVisualSnapshot[]
  adjustments: string[]
  captions: string[]
  audio: ProgramAudioSnapshot[]
}

export interface PreviewOutputConformanceResult {
  samples: number
  mismatches: string[]
  maxSourceFrameDelta: number
  maxAudioSampleDelta: number
}

export function createPreviewProgramSnapshot(tracks: TimelineTrack[], assets: MediaAsset[], timelineTime: number, fps: number, sampleRate = 48_000): ProgramSnapshot {
  const activeMattes = tracks.flatMap((track) => track.clips.filter((clip) => clip.enabled !== false && clip.trackMatte && containsTime(clip, timelineTime)).map((clip) => clip.trackMatte!))
  const referencedMatteTrackIds = new Set(activeMattes.map((matte) => matte.sourceTrackId))
  const hiddenMatteTrackIds = new Set(activeMattes.filter((matte) => !matte.showSource).map((matte) => matte.sourceTrackId))
  const visuals = tracks.flatMap((track, order) => {
    if (track.kind !== 'video' || track.muted || (track.visible === false && !referencedMatteTrackIds.has(track.id)) || hiddenMatteTrackIds.has(track.id)) return []
    return activeVisualClipsAt(track.clips.filter((clip) => !clip.adjustmentLayer), timelineTime, fps).flatMap((candidate) => {
      const asset = previewReadyAsset(assets, candidate.assetId)
      if (!asset) return []
      const clip = constrainTransitionCarryToAsset(candidate, asset, fps, timelineTime)
      return [visualSnapshot(clip, track.id, asset, timelineTime, fps, (track.compositePriority ?? order * 100) + (clip.compositePriority ?? 0))]
    })
  }).sort(compareVisualOrder).map(({ order: _order, ...snapshot }) => snapshot)
  return {
    timelineFrame: frameIndexAtTime(timelineTime, fps),
    visuals,
    adjustments: activeAdjustments(tracks, timelineTime),
    captions: activeCaptions(tracks, timelineTime, fps),
    audio: previewAudioSnapshots(tracks, assets, timelineTime, fps, sampleRate),
  }
}

export function createOutputProgramSnapshot(tracks: TimelineTrack[], assets: MediaAsset[], timelineTime: number, fps: number, sampleRate = 48_000): ProgramSnapshot {
  const matteSourceTrackIds = new Set(tracks.flatMap((track) => track.clips.flatMap((clip) => clip.trackMatte ? [clip.trackMatte.sourceTrackId] : [])))
  const videoTracks = tracks.filter((track) => track.kind === 'video' && !track.muted && (track.visible !== false || matteSourceTrackIds.has(track.id))).sort((left, right) => (left.compositePriority ?? tracks.indexOf(left) * 100) - (right.compositePriority ?? tracks.indexOf(right) * 100))
  const hiddenMatteTrackIds = new Set(videoTracks.flatMap((track) => track.clips.filter((clip) => clip.enabled !== false && clip.trackMatte && !clip.trackMatte.showSource && containsTime(clip, timelineTime)).map((clip) => clip.trackMatte!.sourceTrackId)))
  const visuals = videoTracks.flatMap((track, order) => {
    if (hiddenMatteTrackIds.has(track.id)) return []
    return activeVisualClipsAt(track.clips.filter((clip) => !clip.adjustmentLayer), timelineTime, fps).flatMap((candidate) => {
      const asset = outputReadyAsset(assets, candidate.assetId)
      if (!asset) return []
      const clip = constrainTransitionCarryToAsset(candidate, asset, fps, timelineTime)
      return [visualSnapshot(clip, track.id, asset, timelineTime, fps, (track.compositePriority ?? order * 100) + (clip.compositePriority ?? 0))]
    })
  }).sort(compareVisualOrder).map(({ order: _order, ...snapshot }) => snapshot)
  return {
    timelineFrame: frameIndexAtTime(timelineTime, fps),
    visuals,
    adjustments: activeAdjustments(videoTracks, timelineTime),
    captions: activeCaptions(tracks, timelineTime, fps),
    audio: outputAudioSnapshots(tracks, assets, timelineTime, fps, sampleRate),
  }
}

export function evaluatePreviewOutputConformance(options: { tracks: TimelineTrack[]; assets: MediaAsset[]; sampleTimes: number[]; fps: number; sampleRate?: number }): PreviewOutputConformanceResult {
  const sampleRate = options.sampleRate ?? 48_000
  const mismatches: string[] = []
  let maxSourceFrameDelta = 0
  let maxAudioSampleDelta = 0
  options.sampleTimes.forEach((timelineTime) => {
    const preview = createPreviewProgramSnapshot(options.tracks, options.assets, timelineTime, options.fps, sampleRate)
    const output = createOutputProgramSnapshot(options.tracks, options.assets, timelineTime, options.fps, sampleRate)
    const label = `frame ${preview.timelineFrame}`
    if (preview.timelineFrame !== output.timelineFrame) mismatches.push(`${label}: timeline frame`)
    if (!sameJson(preview.adjustments, output.adjustments)) mismatches.push(`${label}: adjustments`)
    if (!sameJson(preview.captions, output.captions)) mismatches.push(`${label}: captions`)
    if (!sameIds(preview.visuals, output.visuals)) mismatches.push(`${label}: visual layers`)
    if (!sameIds(preview.audio, output.audio)) mismatches.push(`${label}: audio layers`)
    preview.visuals.forEach((layer, index) => {
      const rendered = output.visuals[index]
      if (!rendered || identity(layer) !== identity(rendered)) return
      const delta = Math.abs(layer.sourceFrame - rendered.sourceFrame)
      maxSourceFrameDelta = Math.max(maxSourceFrameDelta, delta)
      if (delta !== 0 || !sameJson(withoutSourceFrame(layer), withoutSourceFrame(rendered))) mismatches.push(`${label}: visual ${identity(layer)}`)
    })
    preview.audio.forEach((layer, index) => {
      const rendered = output.audio[index]
      if (!rendered || identity(layer) !== identity(rendered)) return
      const delta = Math.abs(layer.sourceSample - rendered.sourceSample)
      maxAudioSampleDelta = Math.max(maxAudioSampleDelta, delta)
      if (delta !== 0 || !sameJson(withoutSourceSample(layer), withoutSourceSample(rendered))) mismatches.push(`${label}: audio ${identity(layer)}`)
    })
  })
  return { samples: options.sampleTimes.length, mismatches: [...new Set(mismatches)], maxSourceFrameDelta, maxAudioSampleDelta }
}

function visualSnapshot(clip: TimelineClip, trackId: string, asset: MediaAsset, timelineTime: number, fps: number, order: number): ProgramVisualSnapshot & { order: number } {
  const sourceFps = Math.max(1, asset.sourceFrameRateOverride ?? asset.frameRate ?? fps)
  return {
    clipId: clip.id,
    trackId,
    assetId: asset.id,
    sourceFrame: frameIndexAtTime(clipSourceTime(clip, timelineTime), sourceFps),
    transform: resolveClipTransform(clip, timelineTime),
    transition: resolveClipTransitionState(clip, timelineTime),
    effects: resolveVisualEffects(clip, timelineTime),
    order,
  }
}

function previewAudioSnapshots(tracks: TimelineTrack[], assets: MediaAsset[], timelineTime: number, fps: number, sampleRate: number): ProgramAudioSnapshot[] {
  const hasSolo = tracks.some((track) => (track.kind === 'video' || track.kind === 'audio') && track.solo)
  return tracks.flatMap((track) => {
    if ((track.kind !== 'video' && track.kind !== 'audio') || track.muted || (hasSolo && !track.solo)) return []
    const transitionTrack = { ...track, clips: clipsWithAudioTransitionTails(track.clips, fps) }
    return transitionTrack.clips.filter((clip) => clip.enabled !== false && !clip.audioDisabled && containsTime(clip, timelineTime)).flatMap((clip) => {
      const asset = previewReadyAsset(assets, clip.assetId)
      return asset ? [audioSnapshot(clip, transitionTrack, asset, timelineTime, sampleRate)] : []
    })
  }).sort(compareIdentity)
}

function outputAudioSnapshots(tracks: TimelineTrack[], assets: MediaAsset[], timelineTime: number, fps: number, sampleRate: number): ProgramAudioSnapshot[] {
  const hasSolo = tracks.some((track) => (track.kind === 'video' || track.kind === 'audio') && track.solo)
  const candidates = tracks.filter((track) => (track.kind === 'video' || track.kind === 'audio') && !track.muted && (!hasSolo || track.solo)).map((track) => ({ ...track, clips: clipsWithAudioTransitionTails(track.clips, fps) }))
  return candidates.flatMap((track) => track.clips.filter((clip) => clip.enabled !== false && !clip.audioDisabled && containsTime(clip, timelineTime)).flatMap((clip) => {
    const asset = outputReadyAsset(assets, clip.assetId)
    return asset ? [audioSnapshot(clip, track, asset, timelineTime, sampleRate)] : []
  })).sort(compareIdentity)
}

function audioSnapshot(clip: TimelineClip, track: TimelineTrack, asset: MediaAsset, timelineTime: number, sampleRate: number): ProgramAudioSnapshot {
  const clipMix = resolveClipAudioMix(clip, timelineTime)
  const trackMix = resolveTrackAudioMix(track, timelineTime)
  return {
    clipId: clip.id,
    trackId: track.id,
    assetId: asset.id,
    sourceSample: Math.round(clipSourceTime(clip, timelineTime) * sampleRate),
    clipGainDb: clipMix.gainDb,
    clipPan: clipMix.pan,
    trackVolume: trackMix.volume,
    trackPan: trackMix.pan,
    transitionGain: transitionAudioGain(clip, timelineTime),
  }
}

function activeAdjustments(tracks: TimelineTrack[], timelineTime: number): string[] {
  return tracks.flatMap((track) => track.kind !== 'video' || track.muted || track.visible === false ? [] : track.clips.filter((clip) => clip.enabled !== false && clip.adjustmentLayer && containsTime(clip, timelineTime)).map((clip) => clip.id)).sort()
}

function activeCaptions(tracks: TimelineTrack[], timelineTime: number, fps: number): string[] {
  return tracks.flatMap((track) => track.kind !== 'caption' || track.muted || track.visible === false ? [] : activeVisualClipsAt(track.clips, timelineTime, fps).map((clip) => clip.id)).sort()
}

function previewReadyAsset(assets: MediaAsset[], assetId?: string): MediaAsset | undefined {
  const asset = assets.find((candidate) => candidate.id === assetId)
  return asset?.status === 'ready' && Boolean(asset.url) ? asset : undefined
}

function outputReadyAsset(assets: MediaAsset[], assetId?: string): MediaAsset | undefined {
  const asset = assets.find((candidate) => candidate.id === assetId)
  return asset?.status === 'ready' && Boolean(asset.sourceFile) ? asset : undefined
}

function containsTime(clip: TimelineClip, timelineTime: number): boolean {
  return timelineTime >= clip.start && timelineTime < clip.start + clip.duration
}

function identity(value: { clipId: string; trackId: string; assetId: string }): string {
  return `${value.trackId}:${value.clipId}:${value.assetId}`
}

function sameIds(left: Array<{ clipId: string; trackId: string; assetId: string }>, right: Array<{ clipId: string; trackId: string; assetId: string }>): boolean {
  return left.length === right.length && left.every((value, index) => identity(value) === identity(right[index]))
}

function compareIdentity(left: { clipId: string; trackId: string; assetId: string }, right: { clipId: string; trackId: string; assetId: string }): number {
  return identity(left).localeCompare(identity(right))
}

function compareVisualOrder(left: ProgramVisualSnapshot & { order: number }, right: ProgramVisualSnapshot & { order: number }): number {
  return left.order - right.order || compareIdentity(left, right)
}

function withoutSourceFrame(value: ProgramVisualSnapshot): Omit<ProgramVisualSnapshot, 'sourceFrame'> {
  const { sourceFrame: _sourceFrame, ...rest } = value
  return rest
}

function withoutSourceSample(value: ProgramAudioSnapshot): Omit<ProgramAudioSnapshot, 'sourceSample'> {
  const { sourceSample: _sourceSample, ...rest } = value
  return rest
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
