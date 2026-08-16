import { clipPlaybackRateAtLocal, clipSourceTime } from './effects'
import type { MediaAsset, SequenceTransitionDefaults, TimelineClip } from './types'

export function defaultSequenceTransitionDefaults(): SequenceTransitionDefaults {
  return {
    video: { type: 'crossfade', duration: .5, alignment: 'center-on-cut', easing: 'ease-in-out', audioCurve: 'equal-power' },
    audio: { type: 'crossfade', duration: .5, alignment: 'center-on-cut', easing: 'linear', audioCurve: 'equal-power' },
  }
}

export function normalizeSequenceTransitionDefaults(value?: Partial<SequenceTransitionDefaults>): SequenceTransitionDefaults {
  const defaults = defaultSequenceTransitionDefaults()
  const normalize = (transition: TimelineClip['transitionIn'], fallback: NonNullable<TimelineClip['transitionIn']>): NonNullable<TimelineClip['transitionIn']> => ({
    ...fallback,
    ...transition,
    type: transition?.type && transition.type !== 'none' ? transition.type : fallback.type,
    duration: Math.max(1 / 240, Math.min(60, transition?.duration ?? fallback.duration)),
    alignment: transition?.alignment ?? fallback.alignment,
    easing: transition?.easing ?? fallback.easing,
    audioCurve: transition?.audioCurve ?? fallback.audioCurve,
  })
  return { video: normalize(value?.video, defaults.video), audio: { ...normalize(value?.audio, defaults.audio), type: 'crossfade' } }
}

const usesOutgoingPicture = (type: NonNullable<TimelineClip['transitionIn']>['type']) =>
  ['crossfade', 'blur-dissolve', 'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'slide-left', 'slide-right', 'zoom'].includes(type)

const fadesOutgoingPicture = (type: NonNullable<TimelineClip['transitionIn']>['type']) =>
  type === 'crossfade' || type === 'blur-dissolve'

function transitionSides(transition: NonNullable<TimelineClip['transitionIn']>): { before: number; after: number } {
  const duration = Math.max(0, transition.duration)
  if (transition.alignment === 'end-at-cut') return { before: duration, after: 0 }
  if (transition.alignment === 'center-on-cut') return { before: duration / 2, after: duration / 2 }
  return { before: 0, after: duration }
}

function outgoingTransitionSides(transition: NonNullable<TimelineClip['transitionOut']>): { before: number; after: number } {
  const duration = Math.max(0, transition.duration)
  if (transition.alignment === 'start-at-cut') return { before: 0, after: duration }
  if (transition.alignment === 'center-on-cut') return { before: duration / 2, after: duration / 2 }
  return { before: duration, after: 0 }
}

function shiftedIncoming(clip: TimelineClip, before: number, transition: NonNullable<TimelineClip['transitionIn']>): TimelineClip {
  if (before <= 0) return clip
  const rate = clipPlaybackRateAtLocal(clip, 0)
  const shiftKeyframes = <T extends { time: number }>(items?: T[]) => items?.map((item) => ({ ...item, time: item.time + before }))
  return {
    ...clip,
    id: `${clip.id}:transition-head`,
    start: clip.start - before,
    duration: clip.duration + before,
    sourceOffset: clip.reverse ? clip.sourceOffset : clip.sourceOffset - before * rate,
    speedKeyframes: shiftKeyframes(clip.speedKeyframes),
    keyframes: shiftKeyframes(clip.keyframes),
    visualKeyframes: shiftKeyframes(clip.visualKeyframes),
    audioMixKeyframes: shiftKeyframes(clip.audioMixKeyframes),
    captionWords: clip.captionWords?.map((word) => ({ ...word, start: word.start + before, end: word.end + before })),
    transitionIn: { ...transition, alignment: 'start-at-cut' },
  }
}

function extendedOutgoing(clip: TimelineClip, after: number): TimelineClip {
  if (after <= 0) return clip
  const endRate = clipPlaybackRateAtLocal(clip, clip.duration)
  return { ...clip, duration: clip.duration + after, sourceOffset: clip.reverse ? clip.sourceOffset - after * endRate : clip.sourceOffset }
}

/**
 * Returns the visible clips on one track and, for a transition across a butt cut,
 * a stable synthetic tail of the outgoing clip. This gives wipes, slides and
 * dissolves a real outgoing picture instead of transitioning against empty black.
 */
export function activeVisualClipsAt(clips: TimelineClip[], timelineTime: number, fps: number): TimelineClip[] {
  const ordered = clips.filter((clip) => clip.enabled !== false).sort((left, right) => left.start - right.start || left.id.localeCompare(right.id))
  const active = ordered.filter((clip) => timelineTime >= clip.start && timelineTime < clip.start + clip.duration)
  const tolerance = 1 / Math.max(1, fps)
  const carries: TimelineClip[] = []
  const replacements: TimelineClip[] = []
  const suppressedIds = new Set<string>()
  ordered.forEach((outgoing, index) => {
    const transition = outgoing.transitionOut
    if (!transition || transition.type === 'none' || transition.duration <= 0 || (transition.alignment ?? 'end-at-cut') === 'end-at-cut') return
    const cut = outgoing.start + outgoing.duration
    const next = ordered.slice(index + 1).find((candidate) => Math.abs(candidate.start - cut) <= tolerance)
    if (next?.transitionIn?.type && next.transitionIn.type !== 'none') return
    const sides = outgoingTransitionSides(transition)
    const before = Math.min(outgoing.duration, sides.before)
    const after = sides.after
    if (timelineTime < cut - before || timelineTime >= cut + after) return
    suppressedIds.add(outgoing.id)
    carries.push({ ...extendedOutgoing(outgoing, after), id: `${outgoing.id}:transition-tail:self`, transitionOut: { ...transition, duration: before + after, alignment: 'end-at-cut' } })
  })
  ordered.forEach((incoming, index) => {
    const transition = incoming.transitionIn
    if (!transition || transition.type === 'none' || transition.duration <= 0) return
    const sides = transitionSides(transition)
    const before = Math.min(incoming.duration, sides.before)
    const after = Math.min(incoming.duration, sides.after)
    const windowStart = incoming.start - before
    const windowEnd = incoming.start + after
    if (timelineTime < windowStart || timelineTime >= windowEnd) return
    if (before > 0) {
      suppressedIds.add(incoming.id)
      replacements.push(shiftedIncoming(incoming, before, { ...transition, duration: before + after }))
    }
    if (!usesOutgoingPicture(transition.type)) return
    const outgoing = ordered.slice(0, index).reverse().find((candidate) => Math.abs(candidate.start + candidate.duration - incoming.start) <= tolerance)
    if (!outgoing) return
    const duration = before + after
    if (fadesOutgoingPicture(transition.type)) suppressedIds.add(outgoing.id)
    if (after <= 0 && !fadesOutgoingPicture(transition.type)) return
    carries.push({
      ...extendedOutgoing(outgoing, after),
      id: `${outgoing.id}:transition-tail:${incoming.id}`,
      transitionOut: fadesOutgoingPicture(transition.type) ? { ...transition, type: 'crossfade', duration, alignment: 'end-at-cut' } : undefined,
    })
  })
  return [...carries, ...active.filter((clip) => !suppressedIds.has(clip.id)), ...replacements].sort((left, right) => (left.compositePriority ?? 0) - (right.compositePriority ?? 0) || left.start - right.start)
}

/** Builds the same butt-cut overlap for the audio renderer and preview mixer. */
export function clipsWithAudioTransitionTails(clips: TimelineClip[], fps: number): TimelineClip[] {
  const ordered = clips.slice().sort((left, right) => left.start - right.start || left.id.localeCompare(right.id))
  const tolerance = 1 / Math.max(1, fps)
  const replacements = new Map<string, TimelineClip>()
  ordered.forEach((outgoing, index) => {
    const transition = outgoing.transitionOut
    if (!transition || transition.type === 'none' || transition.duration <= 0 || (transition.alignment ?? 'end-at-cut') === 'end-at-cut') return
    const cut = outgoing.start + outgoing.duration
    const next = ordered.slice(index + 1).find((candidate) => Math.abs(candidate.start - cut) <= tolerance)
    if (next?.transitionIn?.type && next.transitionIn.type !== 'none') return
    const sides = outgoingTransitionSides(transition)
    const before = Math.min(outgoing.duration, sides.before)
    const after = sides.after
    replacements.set(outgoing.id, { ...extendedOutgoing(outgoing, after), transitionOut: { ...transition, duration: before + after, alignment: 'end-at-cut' } })
  })
  ordered.forEach((incoming, index) => {
    const transition = incoming.transitionIn
    if (!transition || transition.type === 'none' || transition.duration <= 0) return
    const sides = transitionSides(transition)
    const before = Math.min(incoming.duration, sides.before)
    const after = Math.min(incoming.duration, sides.after)
    if (before > 0) replacements.set(incoming.id, { ...shiftedIncoming(incoming, before, { ...transition, duration: before + after }), id: incoming.id })
    const outgoing = ordered.slice(0, index).reverse().find((candidate) => Math.abs(candidate.start + candidate.duration - incoming.start) <= tolerance)
    if (!outgoing || outgoing.audioDisabled || outgoing.freezeFrame) return
    const duration = before + after
    const currentOutgoing = replacements.get(outgoing.id) ?? outgoing
    replacements.set(outgoing.id, {
      ...extendedOutgoing(currentOutgoing, after),
      transitionOut: { ...transition, type: 'crossfade', duration, alignment: 'end-at-cut' },
    })
  })
  return clips.map((clip) => replacements.get(clip.id) ?? clip)
}

/** Repeats the last valid outgoing frame only when a transition tail exceeds the source handle. */
export function constrainTransitionCarryToAsset(clip: TimelineClip, asset: MediaAsset, fps: number, timelineTime: number): TimelineClip {
  if (asset.kind === 'image') return clip
  if (clip.id.includes(':transition-head')) {
    const requestedSourceTime = clipSourceTime(clip, timelineTime)
    const lastSourceTime = Math.max(0, asset.duration - 1 / Math.max(1, asset.frameRate || fps))
    if (requestedSourceTime < 0) return { ...clip, freezeFrame: true, freezeFrameSourceTime: 0 }
    if (requestedSourceTime > lastSourceTime) return { ...clip, freezeFrame: true, freezeFrameSourceTime: lastSourceTime }
    return clip
  }
  if (!clip.id.includes(':transition-tail:') || !clip.transitionOut?.duration) return clip
  const lastSourceTime = Math.max(0, asset.duration - 1 / Math.max(1, asset.frameRate || fps))
  const requestedSourceTime = clipSourceTime(clip, timelineTime)
  if (requestedSourceTime < 0) return { ...clip, freezeFrame: true, freezeFrameSourceTime: 0 }
  if (requestedSourceTime <= lastSourceTime + 1 / Math.max(1, fps)) return clip
  return { ...clip, freezeFrame: true, freezeFrameSourceTime: lastSourceTime }
}
