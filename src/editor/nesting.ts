import { clipPlaybackRateAtLocal, clipSourceTime, defaultAudioAdjustment, defaultColorAdjustment, defaultVisualEffects, resolveClipAudioMix, resolveClipTransform, resolveTrackAudioMix, resolveVisualEffects, sliceClipAutomation } from './effects'
import type { AudioAdjustment, ClipTransform, ColorAdjustment, ColorNode, ProjectSequence, TimelineClip, TimelineTrack, VisualEffects } from './types'
import { composeColorCurve } from './colorCurves'
import { isAudioBusActive, normalizeAudioBuses, resolveAudioAuxSends } from './audioBuses'
import { resolveEffectMasks } from './mask'

export interface NestedSequenceDiagnostic {
  id: string
  kind: 'missing' | 'cycle' | 'depth'
  sequencePath: string[]
  clipName: string
}

export function inspectNestedSequenceGraph(rootTracks: TimelineTrack[], sequences: ProjectSequence[], rootSequenceId = 'active'): NestedSequenceDiagnostic[] {
  const byId = new Map(sequences.map((sequence) => [sequence.id, sequence]))
  const diagnostics: NestedSequenceDiagnostic[] = []
  const emitted = new Set<string>()
  const visitTracks = (tracks: TimelineTrack[], path: string[]) => {
    for (const clip of tracks.flatMap((track) => track.clips).filter((candidate) => candidate.enabled !== false && candidate.nestedSequenceId)) {
      const targetId = clip.nestedSequenceId!
      const keyPrefix = `${path.join('>')}>${targetId}:${clip.id}`
      if (!byId.has(targetId)) {
        if (!emitted.has(`missing:${keyPrefix}`)) diagnostics.push({ id: `nested-missing-${clip.id}`, kind: 'missing', sequencePath: [...path, targetId], clipName: clip.name })
        emitted.add(`missing:${keyPrefix}`)
        continue
      }
      if (path.includes(targetId)) {
        if (!emitted.has(`cycle:${keyPrefix}`)) diagnostics.push({ id: `nested-cycle-${clip.id}`, kind: 'cycle', sequencePath: [...path, targetId], clipName: clip.name })
        emitted.add(`cycle:${keyPrefix}`)
        continue
      }
      if (path.length >= 16) {
        if (!emitted.has(`depth:${keyPrefix}`)) diagnostics.push({ id: `nested-depth-${clip.id}`, kind: 'depth', sequencePath: [...path, targetId], clipName: clip.name })
        emitted.add(`depth:${keyPrefix}`)
        continue
      }
      visitTracks(byId.get(targetId)!.tracks, [...path, targetId])
    }
  }
  visitTracks(rootTracks, [rootSequenceId])
  return diagnostics
}

export function flattenNestedTracks(rootTracks: TimelineTrack[], sequences: ProjectSequence[]): TimelineTrack[] {
  return flatten(rootTracks, sequences, new Set())
}

function flatten(tracks: TimelineTrack[], sequences: ProjectSequence[], ancestors: Set<string>): TimelineTrack[] {
  const result: TimelineTrack[] = []

  for (const [parentIndex, parentTrack] of tracks.entries()) {
    const parentPriority = parentTrack.compositePriority ?? parentIndex * 100
    const regularClips = parentTrack.clips.filter((clip) => clip.enabled !== false && !clip.nestedSequenceId)
    if (regularClips.length) result.push({ ...parentTrack, compositePriority: parentPriority, clips: regularClips })
    for (const nestedClip of parentTrack.clips.filter((clip) => clip.enabled !== false && clip.nestedSequenceId)) {
      const sequenceId = nestedClip.nestedSequenceId!
      if (ancestors.has(sequenceId) || ancestors.size >= 16) continue
      const sequence = sequences.find((candidate) => candidate.id === sequenceId)
      if (!sequence) continue
      const nextAncestors = new Set(ancestors)
      nextAncestors.add(sequenceId)
      const allChildTracks = flatten(sequence.tracks, sequences, nextAncestors)
      const videoAngles = allChildTracks.filter((track) => track.kind === 'video')
      const audioAngles = allChildTracks.filter((track) => track.kind === 'audio')
      const requestedAngle = Math.max(0, nestedClip.multicamAngle ?? 0)
      const selectedAngleTrackId = nestedClip.multicamAngle === undefined ? undefined : (videoAngles.find((track) => track.multicamAngleIndex === requestedAngle) ?? videoAngles[Math.min(videoAngles.length - 1, requestedAngle)])?.id
      const audioMode = nestedClip.multicamAngle === undefined ? 'all' : nestedClip.multicamAudioMode ?? 'camera-1'
      const requestedAudioAngle = audioMode === 'follow-video' ? requestedAngle : audioMode === 'selected-angle' ? Math.max(0, nestedClip.multicamAudioAngle ?? 0) : 0
      const indexedAudioAngles = audioAngles.some((track) => track.multicamAngleIndex !== undefined)
      const selectedAudioTrackId = audioMode === 'all' ? undefined : (audioAngles.find((track) => track.multicamAngleIndex === requestedAudioAngle) ?? (!indexedAudioAngles ? audioAngles[Math.min(audioAngles.length - 1, requestedAudioAngle)] : undefined))?.id
      const childTracks = selectedAngleTrackId ? allChildTracks.filter((track) => (track.kind !== 'video' || track.id === selectedAngleTrackId) && (track.kind !== 'audio' || audioMode === 'all' || track.id === selectedAudioTrackId)) : allChildTracks
      const sourceAtIn = nestedSourceTime(nestedClip, nestedClip.start)
      const sourceAtOut = nestedSourceTime(nestedClip, nestedClip.start + nestedClip.duration)
      const sourceStart = Math.min(sourceAtIn, sourceAtOut)
      const sourceEnd = Math.max(sourceAtIn, sourceAtOut)
      const nestedAudioBuses = normalizeAudioBuses(sequence.audioBuses)
      const nestedTrackIds = new Map(childTracks.map((childTrack) => [childTrack.id, `${parentTrack.id}:nested:${nestedClip.id}:${childTrack.id}`]))

      for (const [trackIndex, childTrack] of childTracks.entries()) {
        const nestedTrackId = nestedTrackIds.get(childTrack.id)!
        const clips = childTrack.clips.flatMap((childClip) => mapNestedClip(childClip, nestedClip, sourceStart, sourceEnd, trackIndex, nestedAudioBuses)).map((clip) => ({
          ...clip,
          trackId: nestedTrackId,
          trackMatte: clip.trackMatte ? { ...clip.trackMatte, sourceTrackId: nestedTrackIds.get(clip.trackMatte.sourceTrackId) ?? clip.trackMatte.sourceTrackId } : undefined,
        }))
        if (!clips.length) continue
        const mixKeyframes = buildNestedTrackMix(parentTrack, childTrack, nestedClip, sourceStart, sourceEnd)
        result.push({
          ...childTrack,
          id: nestedTrackId,
          name: `${nestedClip.name} › ${childTrack.name}`,
          muted: parentTrack.muted || childTrack.muted,
          locked: parentTrack.locked || childTrack.locked,
          visible: parentTrack.visible !== false && childTrack.visible !== false,
          solo: parentTrack.solo || childTrack.solo,
          volume: mixKeyframes ? 100 : ((parentTrack.volume ?? 100) * (childTrack.volume ?? 100)) / 100,
          pan: mixKeyframes ? 0 : Math.max(-100, Math.min(100, (parentTrack.pan ?? 0) + (childTrack.pan ?? 0))),
          mixKeyframes,
          compositePriority: parentPriority + (nestedClip.compositePriority ?? 0) + (trackIndex + 1) / 100,
          clips,
        })
      }
    }
  }
  return result.sort((left, right) => (left.compositePriority ?? 0) - (right.compositePriority ?? 0))
}

function buildNestedTrackMix(parentTrack: TimelineTrack, childTrack: TimelineTrack, parentClip: TimelineClip, sourceStart: number, sourceEnd: number): TimelineTrack['mixKeyframes'] {
  if (!parentTrack.mixKeyframes?.length && !childTrack.mixKeyframes?.length) return undefined
  const outputStart = parentClip.start
  const outputEnd = parentClip.start + parentClip.duration
  const outputTimes = new Set<number>([outputStart, outputEnd])
  parentTrack.mixKeyframes?.forEach((keyframe) => {
    if (keyframe.time > outputStart && keyframe.time < outputEnd) outputTimes.add(keyframe.time)
  })
  childTrack.mixKeyframes?.forEach((keyframe) => {
    if (keyframe.time < sourceStart || keyframe.time > sourceEnd) return
    const outputTime = nestedOutputTime(parentClip, keyframe.time)
    if (outputTime > outputStart && outputTime < outputEnd) outputTimes.add(outputTime)
  })
  return [...outputTimes].sort((a, b) => a - b).map((outputTime) => {
    const childTime = nestedSourceTime(parentClip, outputTime)
    const parentMix = resolveTrackAudioMix(parentTrack, outputTime)
    const childMix = resolveTrackAudioMix(childTrack, childTime)
    return {
      id: crypto.randomUUID(),
      time: outputTime,
      volume: Math.max(0, Math.min(200, parentMix.volume * childMix.volume / 100)),
      pan: Math.max(-100, Math.min(100, parentMix.pan + childMix.pan)),
      easing: 'linear' as const,
    }
  })
}

function mapNestedClip(
  child: TimelineClip,
  parent: TimelineClip,
  sourceStart: number,
  sourceEnd: number,
  trackIndex: number,
  nestedAudioBuses: ReturnType<typeof normalizeAudioBuses>,
): TimelineClip[] {
  const childEnd = child.start + child.duration
  const overlapStart = Math.max(child.start, sourceStart)
  const overlapEnd = Math.min(childEnd, sourceEnd)
  if (overlapEnd <= overlapStart) return []
  const childAutomation = sliceClipAutomation(child, overlapStart - child.start, overlapEnd - child.start)
  const firstOutput = nestedOutputTime(parent, parent.reverse ? overlapEnd : overlapStart)
  const lastOutput = nestedOutputTime(parent, parent.reverse ? overlapStart : overlapEnd)
  const outputStart = Math.min(firstOutput, lastOutput)
  const outputDuration = Math.abs(lastOutput - firstOutput)
  if (outputDuration <= 0.0001) return []
  const nestedSpeed = buildNestedSpeed(child, parent, outputStart, outputDuration)
  const transformSamples = buildTransformSamples(child, parent, overlapStart, overlapEnd, outputStart, outputDuration)
  const visualSamples = buildVisualSamples(child, parent, overlapStart, overlapEnd, outputStart, outputDuration)
  const combinedAudio = combineAudio(childAutomation.audioAdjustment ?? child.audioAdjustment, parent.audioAdjustment)
  const nestedBus = nestedAudioBuses[combinedAudio.role]
  const audioSamples = buildAudioSamples(child, parent, overlapStart, overlapEnd, outputStart, outputDuration, nestedBus.gainDb)
  const touchesParentIn = Math.abs(outputStart - parent.start) < 1 / 120
  const touchesParentOut = Math.abs(outputStart + outputDuration - (parent.start + parent.duration)) < 1 / 120
  const touchesChildIn = Math.abs(overlapStart - child.start) < 1 / 120
  const touchesChildOut = Math.abs(overlapEnd - childEnd) < 1 / 120
  const parentTransitionIn = parent.transitionIn
  const childTransitionIn = child.transitionIn
  const parentTransitionOut = parent.transitionOut
  const childTransitionOut = child.transitionOut
  const transitionIn = touchesParentIn && parentTransitionIn && parentTransitionIn.type !== 'none'
    ? { ...parentTransitionIn, duration: Math.min(outputDuration, parentTransitionIn.duration) }
    : touchesChildIn && childTransitionIn && childTransitionIn.type !== 'none'
      ? { ...childTransitionIn, duration: Math.min(outputDuration, nestedMappedDuration(parent, child.start, child.start + childTransitionIn.duration)) }
      : undefined
  const transitionOut = touchesParentOut && parentTransitionOut && parentTransitionOut.type !== 'none'
    ? { ...parentTransitionOut, duration: Math.min(outputDuration, parentTransitionOut.duration) }
    : touchesChildOut && childTransitionOut && childTransitionOut.type !== 'none'
      ? { ...childTransitionOut, duration: Math.min(outputDuration, nestedMappedDuration(parent, childEnd - childTransitionOut.duration, childEnd)) }
      : undefined
  return [{
    ...child,
    id: `${parent.id}:nested:${trackIndex}:${child.id}`,
    trackId: `${parent.trackId}:nested:${trackIndex}`,
    start: outputStart,
    duration: outputDuration,
    sourceOffset: nestedSpeed.sourceOffset,
    playbackRate: nestedSpeed.playbackRate,
    speedKeyframes: nestedSpeed.speedKeyframes,
    reverse: nestedSpeed.reverse,
    transform: transformSamples[0]?.transform ?? combineTransform(child.transform, parent.transform),
    keyframes: transformSamples,
    motionPathAutoOrient: false,
    motionPathOrientationOffset: 0,
    motionBlur: parent.motionBlur?.enabled ? structuredClone(parent.motionBlur) : structuredClone(child.motionBlur),
    transitionIn,
    transitionOut,
    colorAdjustment: combineColor(child.colorAdjustment, parent.colorAdjustment),
    visualEffects: visualSamples[0]?.effects ?? combineVisual(child.visualEffects, parent.visualEffects),
    visualKeyframes: visualSamples,
    audioAdjustment: { ...combinedAudio, gainDb: combinedAudio.gainDb + nestedBus.gainDb, limiterDb: Math.min(combinedAudio.limiterDb ?? -1, nestedBus.limiterDb) },
    audioMixKeyframes: audioSamples,
    adrCompRanges: child.adrCompRanges?.flatMap((range) => {
      const start = Math.max(range.start, overlapStart)
      const end = Math.min(range.end, overlapEnd)
      if (end <= start) return []
      const mappedStart = nestedOutputTime(parent, parent.reverse ? end : start)
      const mappedEnd = nestedOutputTime(parent, parent.reverse ? start : end)
      return [{ start: Math.min(mappedStart, mappedEnd), end: Math.max(mappedStart, mappedEnd) }]
    }),
    audioDisabled: parent.audioDisabled || child.audioDisabled || !isAudioBusActive(nestedAudioBuses, combinedAudio.role),
    groupId: parent.groupId ?? child.groupId,
    linkGroupId: parent.linkGroupId ?? child.linkGroupId,
  }]
}

function buildAudioSamples(
  child: TimelineClip,
  parent: TimelineClip,
  overlapStart: number,
  overlapEnd: number,
  outputStart: number,
  outputDuration: number,
  nestedBusGainDb: number,
): TimelineClip['audioMixKeyframes'] {
  if (!child.audioMixKeyframes?.length && !parent.audioMixKeyframes?.length) return undefined
  const outputTimes = new Set<number>([outputStart, outputStart + outputDuration])
  const addOutputTime = (time: number) => {
    if (time > outputStart && time < outputStart + outputDuration) outputTimes.add(time)
  }
  parent.audioMixKeyframes?.forEach((keyframe) => addOutputTime(parent.start + keyframe.time))
  child.audioMixKeyframes?.forEach((keyframe) => {
    const childTime = child.start + keyframe.time
    if (childTime >= overlapStart && childTime <= overlapEnd) addOutputTime(nestedOutputTime(parent, childTime))
  })
  return [...outputTimes].sort((a, b) => a - b).map((outputTime) => {
    const childTimelineTime = Math.max(overlapStart, Math.min(overlapEnd, nestedSourceTime(parent, outputTime)))
    const childMix = resolveClipAudioMix(child, childTimelineTime)
    const parentMix = resolveClipAudioMix(parent, outputTime)
    return {
      id: crypto.randomUUID(),
      time: Math.max(0, Math.min(outputDuration, outputTime - outputStart)),
      easing: 'linear' as const,
      gainDb: childMix.gainDb + parentMix.gainDb + nestedBusGainDb,
      pan: Math.max(-100, Math.min(100, childMix.pan + parentMix.pan)),
    }
  })
}

function buildVisualSamples(child: TimelineClip, parent: TimelineClip, overlapStart: number, overlapEnd: number, outputStart: number, outputDuration: number): NonNullable<TimelineClip['visualKeyframes']> {
  const outputTimes = new Set<number>([outputStart, outputStart + outputDuration])
  const addOutputTime = (time: number) => {
    if (time > outputStart && time < outputStart + outputDuration) outputTimes.add(time)
  }
  parent.visualKeyframes?.forEach((keyframe) => addOutputTime(parent.start + keyframe.time))
  child.visualKeyframes?.forEach((keyframe) => {
    const childTime = child.start + keyframe.time
    if (childTime >= overlapStart && childTime <= overlapEnd) addOutputTime(nestedOutputTime(parent, childTime))
  })

  return [...outputTimes].sort((a, b) => a - b).map((outputTime) => {
    const childTimelineTime = Math.max(overlapStart, Math.min(overlapEnd, nestedSourceTime(parent, outputTime)))
    return {
      id: crypto.randomUUID(),
      time: Math.max(0, Math.min(outputDuration, outputTime - outputStart)),
      easing: 'linear' as const,
      effects: combineVisual(resolveVisualEffects(child, childTimelineTime), resolveVisualEffects(parent, outputTime)),
    }
  })
}

function buildTransformSamples(child: TimelineClip, parent: TimelineClip, overlapStart: number, overlapEnd: number, outputStart: number, outputDuration: number): NonNullable<TimelineClip['keyframes']> {
  const outputTimes = new Set<number>([outputStart, outputStart + outputDuration])
  const addOutputTime = (time: number) => {
    if (time > outputStart && time < outputStart + outputDuration) outputTimes.add(time)
  }
  parent.keyframes?.forEach((keyframe) => addOutputTime(parent.start + keyframe.time))
  if (parent.transitionIn?.duration) addOutputTime(parent.start + parent.transitionIn.duration)
  if (parent.transitionOut?.duration) addOutputTime(parent.start + parent.duration - parent.transitionOut.duration)
  child.keyframes?.forEach((keyframe) => {
    const childTime = child.start + keyframe.time
    if (childTime >= overlapStart && childTime <= overlapEnd) addOutputTime(nestedOutputTime(parent, childTime))
  })
  if (child.transitionIn?.duration) addOutputTime(nestedOutputTime(parent, Math.max(overlapStart, Math.min(overlapEnd, child.start + child.transitionIn.duration))))
  if (child.transitionOut?.duration) addOutputTime(nestedOutputTime(parent, Math.max(overlapStart, Math.min(overlapEnd, child.start + child.duration - child.transitionOut.duration))))

  return [...outputTimes].sort((a, b) => a - b).map((outputTime) => {
    const childTimelineTime = Math.max(overlapStart, Math.min(overlapEnd, nestedSourceTime(parent, outputTime)))
    return {
      id: crypto.randomUUID(),
      time: Math.max(0, Math.min(outputDuration, outputTime - outputStart)),
      easing: 'linear' as const,
      transform: combineTransform(resolveClipTransform(child, childTimelineTime), resolveClipTransform(parent, outputTime)),
    }
  })
}

function nestedSourceTime(parent: TimelineClip, outputTime: number): number {
  return clipSourceTime(parent, Math.max(parent.start, Math.min(parent.start + parent.duration, outputTime)))
}

export function nestedOutputTime(parent: TimelineClip, sourceTime: number): number {
  const first = nestedSourceTime(parent, parent.start)
  const last = nestedSourceTime(parent, parent.start + parent.duration)
  const ascending = last >= first
  const target = Math.max(Math.min(first, last), Math.min(Math.max(first, last), sourceTime))
  let low = 0
  let high = parent.duration
  for (let index = 0; index < 28; index += 1) {
    const middle = (low + high) / 2
    const value = nestedSourceTime(parent, parent.start + middle)
    if ((ascending && value < target) || (!ascending && value > target)) low = middle
    else high = middle
  }
  return parent.start + (low + high) / 2
}

function nestedMappedDuration(parent: TimelineClip, childStart: number, childEnd: number): number {
  return Math.abs(nestedOutputTime(parent, childEnd) - nestedOutputTime(parent, childStart))
}

function buildNestedSpeed(child: TimelineClip, parent: TimelineClip, outputStart: number, outputDuration: number): Pick<TimelineClip, 'sourceOffset' | 'playbackRate' | 'speedKeyframes' | 'reverse'> {
  const sampleCount = Math.max(8, Math.min(120, Math.ceil(outputDuration * 12)))
  const samples = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const local = outputDuration * index / sampleCount
    const outputTime = outputStart + local
    const childTime = nestedSourceTime(parent, outputTime)
    const childLocal = Math.max(0, Math.min(child.duration, childTime - child.start))
    const parentLocal = Math.max(0, Math.min(parent.duration, outputTime - parent.start))
    return {
      local,
      mediaTime: clipSourceTime(child, childTime),
      rate: Math.max(0.000001, clipPlaybackRateAtLocal(parent, parentLocal) * clipPlaybackRateAtLocal(child, childLocal)),
    }
  })
  const first = samples[0].mediaTime
  const last = samples[samples.length - 1].mediaTime
  const targetDelta = Math.abs(last - first)
  let integrated = 0
  for (let index = 1; index < samples.length; index += 1) integrated += (samples[index - 1].rate + samples[index].rate) * (samples[index].local - samples[index - 1].local) / 2
  const scale = targetDelta > 0.000001 && integrated > 0.000001 ? targetDelta / integrated : 1
  return {
    sourceOffset: Math.max(0, Math.min(first, last)),
    playbackRate: Math.max(0.05, Math.min(16, samples[0].rate * scale)),
    reverse: last < first,
    speedKeyframes: samples.slice(1).map((sample) => ({ id: crypto.randomUUID(), time: sample.local, rate: Math.max(0.05, Math.min(16, sample.rate * scale)), easing: 'linear' as const })),
  }
}

function combineTransform(child: ClipTransform, parent: ClipTransform): ClipTransform {
  const radians = parent.rotation * Math.PI / 180
  const parentScaleX = parent.scale / 100 * (parent.scaleX ?? 100) / 100
  const parentScaleY = parent.scale / 100 * (parent.scaleY ?? 100) / 100
  const offsetX = child.positionX * parentScaleX
  const offsetY = child.positionY * parentScaleY
  const shearedX = offsetX + Math.tan((parent.skewX ?? 0) * Math.PI / 180) * offsetY
  const shearedY = Math.tan((parent.skewY ?? 0) * Math.PI / 180) * offsetX + offsetY
  return {
    positionX: parent.positionX + shearedX * Math.cos(radians) - shearedY * Math.sin(radians),
    positionY: parent.positionY + shearedX * Math.sin(radians) + shearedY * Math.cos(radians),
    scale: child.scale * parent.scale / 100,
    scaleX: (child.scaleX ?? 100) * (parent.scaleX ?? 100) / 100,
    scaleY: (child.scaleY ?? 100) * (parent.scaleY ?? 100) / 100,
    anchorX: child.anchorX ?? 50,
    anchorY: child.anchorY ?? 50,
    skewX: (child.skewX ?? 0) + (parent.skewX ?? 0),
    skewY: (child.skewY ?? 0) + (parent.skewY ?? 0),
    rotation: child.rotation + parent.rotation,
    opacity: child.opacity * parent.opacity / 100,
  }
}

function combineColor(childRaw?: ColorAdjustment, parentRaw?: ColorAdjustment): ColorAdjustment {
  const child = { ...defaultColorAdjustment(), ...childRaw }
  const parent = { ...defaultColorAdjustment(), ...parentRaw }
  const mergedNodes = combineColorNodes(childRaw, parentRaw)
  return {
    exposure: child.exposure + parent.exposure,
    contrast: child.contrast + parent.contrast,
    saturation: child.saturation + parent.saturation,
    temperature: child.temperature + parent.temperature,
    tint: child.tint + parent.tint,
    highlights: child.highlights + parent.highlights,
    shadows: child.shadows + parent.shadows,
    lut: parent.lut !== 'none' ? parent.lut : child.lut,
    lutIntensity: parent.lut !== 'none' ? parent.lutIntensity : child.lutIntensity,
    hue: (child.hue ?? 0) + (parent.hue ?? 0),
    vibrance: (child.vibrance ?? 0) + (parent.vibrance ?? 0),
    fade: Math.max(child.fade ?? 0, parent.fade ?? 0),
    vignette: Math.max(child.vignette ?? 0, parent.vignette ?? 0),
    lift: (child.lift ?? 0) + (parent.lift ?? 0),
    gamma: (child.gamma ?? 0) + (parent.gamma ?? 0),
    gain: (child.gain ?? 0) + (parent.gain ?? 0),
    curveShadows: (child.curveShadows ?? 0) + (parent.curveShadows ?? 0),
    curveMidtones: (child.curveMidtones ?? 0) + (parent.curveMidtones ?? 0),
    curveHighlights: (child.curveHighlights ?? 0) + (parent.curveHighlights ?? 0),
    masterCurve: composeColorCurve(child.masterCurve, parent.masterCurve),
    redCurve: composeColorCurve(child.redCurve, parent.redCurve),
    greenCurve: composeColorCurve(child.greenCurve, parent.greenCurve),
    blueCurve: composeColorCurve(child.blueCurve, parent.blueCurve),
    qualifierEnabled: parent.qualifierEnabled || child.qualifierEnabled,
    qualifierHue: parent.qualifierEnabled ? parent.qualifierHue : child.qualifierHue,
    qualifierHueRange: parent.qualifierEnabled ? parent.qualifierHueRange : child.qualifierHueRange,
    qualifierSaturationMin: parent.qualifierEnabled ? parent.qualifierSaturationMin : child.qualifierSaturationMin,
    qualifierSaturationMax: parent.qualifierEnabled ? parent.qualifierSaturationMax : child.qualifierSaturationMax,
    qualifierLuminanceMin: parent.qualifierEnabled ? parent.qualifierLuminanceMin : child.qualifierLuminanceMin,
    qualifierLuminanceMax: parent.qualifierEnabled ? parent.qualifierLuminanceMax : child.qualifierLuminanceMax,
    qualifierSoftness: parent.qualifierEnabled ? parent.qualifierSoftness : child.qualifierSoftness,
    qualifierExposure: parent.qualifierEnabled ? parent.qualifierExposure : child.qualifierExposure,
    qualifierSaturation: parent.qualifierEnabled ? parent.qualifierSaturation : child.qualifierSaturation,
    qualifierHueShift: parent.qualifierEnabled ? parent.qualifierHueShift : child.qualifierHueShift,
    qualifierShowMask: parent.qualifierEnabled ? parent.qualifierShowMask : child.qualifierShowMask,
    colorNodes: mergedNodes.nodes,
    colorOutputNodeId: mergedNodes.outputId,
  }
}

function combineColorNodes(child?: ColorAdjustment, parent?: ColorAdjustment): { nodes?: ColorNode[]; outputId?: string } {
  const childNodes = child?.colorNodes?.slice(0, 16) ?? []
  const parentNodes = parent?.colorNodes?.slice(0, Math.max(0, 16 - childNodes.length)) ?? []
  if (!childNodes.length && !parentNodes.length) return {}
  const cloneBranch = (nodes: ColorNode[], prefix: string, sourceId: string) => {
    const idMap = new Map(nodes.map((node) => [node.id, `${prefix}-${node.id}`]))
    return nodes.map((node) => ({
      ...node,
      id: idMap.get(node.id)!,
      inputIds: node.inputIds.map((inputId) => inputId === 'source' ? sourceId : idMap.get(inputId)).filter((inputId): inputId is string => Boolean(inputId)),
      adjustment: { ...node.adjustment },
    }))
  }
  const childClones = cloneBranch(childNodes, 'nested-child', 'source')
  const childOutput = (child?.colorOutputNodeId
    ? childClones.find((node) => node.id === `nested-child-${child.colorOutputNodeId}`)?.id
    : undefined) ?? (childClones.length ? childClones[childClones.length - 1].id : 'source')
  const parentClones = cloneBranch(parentNodes, 'nested-parent', childOutput ?? 'source')
  const nodes = [...childClones, ...parentClones]
  const parentOutput = (parent?.colorOutputNodeId
    ? parentClones.find((node) => node.id === `nested-parent-${parent.colorOutputNodeId}`)?.id
    : undefined) ?? (parentClones.length ? parentClones[parentClones.length - 1].id : undefined)
  return { nodes, outputId: parentOutput ?? childOutput }
}

function combineVisual(childRaw?: VisualEffects, parentRaw?: VisualEffects): VisualEffects {
  const child = { ...defaultVisualEffects(), ...childRaw }
  const parent = { ...defaultVisualEffects(), ...parentRaw }
  const childMasks = resolveEffectMasks(child)
  const parentMasks = resolveEffectMasks(parent)
  const parentMaskActive = parentMasks.length > 0 || parent.cropTop > 0 || parent.cropRight > 0 || parent.cropBottom > 0 || parent.cropLeft > 0
  const masks = [...childMasks.map((mask) => ({ ...mask, points: mask.points.map((point) => ({ ...point })) })), ...parentMasks.map((mask, index) => ({ ...mask, id: `${mask.id}-nested-parent`, operation: (childMasks.length && index === 0 ? 'intersect' : mask.operation) as typeof mask.operation, points: mask.points.map((point) => ({ ...point })) }))]
  return {
    cropTop: Math.min(49, child.cropTop + parent.cropTop),
    cropRight: Math.min(49, child.cropRight + parent.cropRight),
    cropBottom: Math.min(49, child.cropBottom + parent.cropBottom),
    cropLeft: Math.min(49, child.cropLeft + parent.cropLeft),
    blur: child.blur + parent.blur,
    shadowOpacity: Math.max(child.shadowOpacity, parent.shadowOpacity),
    shadowBlur: Math.max(child.shadowBlur, parent.shadowBlur),
    shadowX: child.shadowX + parent.shadowX,
    shadowY: child.shadowY + parent.shadowY,
    mask: masks.length ? 'none' : parentMaskActive ? parent.mask : child.mask,
    maskPoints: masks.length ? undefined : parentMaskActive && parent.mask === 'polygon' ? parent.maskPoints : child.maskPoints,
    maskFeather: Math.max(child.maskFeather ?? 0, parent.maskFeather ?? 0),
    maskInvert: parentMaskActive ? parent.maskInvert : child.maskInvert,
    masks: masks.length ? masks : undefined,
    faceMosaic: child.faceMosaic || parent.faceMosaic,
    mosaicSize: Math.max(child.mosaicSize, parent.mosaicSize),
    blendMode: parent.blendMode !== 'normal' ? parent.blendMode : child.blendMode,
    chromaKeyEnabled: child.chromaKeyEnabled || parent.chromaKeyEnabled,
    chromaKeyColor: parent.chromaKeyEnabled ? parent.chromaKeyColor : child.chromaKeyColor,
    chromaKeyTolerance: parent.chromaKeyEnabled ? parent.chromaKeyTolerance : child.chromaKeyTolerance,
    chromaKeySoftness: parent.chromaKeyEnabled ? parent.chromaKeySoftness : child.chromaKeySoftness,
    chromaSpill: parent.chromaKeyEnabled ? parent.chromaSpill : child.chromaSpill,
    cornerPinEnabled: parent.cornerPinEnabled || child.cornerPinEnabled,
    cornerPinPoints: (parent.cornerPinEnabled ? parent.cornerPinPoints : child.cornerPinPoints)?.map((point) => ({ ...point })),
  }
}

function combineAudio(childRaw?: AudioAdjustment, parentRaw?: AudioAdjustment): AudioAdjustment {
  const child = { ...defaultAudioAdjustment(), ...childRaw }
  const parent = { ...defaultAudioAdjustment(), ...parentRaw }
  return {
    gainDb: child.gainDb + parent.gainDb,
    pan: Math.max(-100, Math.min(100, child.pan + parent.pan)),
    channelMode: parent.channelMode !== 'stereo' ? parent.channelMode : child.channelMode,
    stereoWidth: Math.max(0, Math.min(200, (child.stereoWidth ?? 100) * (parent.stereoWidth ?? 100) / 100)),
    phaseInvertLeft: Boolean(child.phaseInvertLeft) !== Boolean(parent.phaseInvertLeft),
    phaseInvertRight: Boolean(child.phaseInvertRight) !== Boolean(parent.phaseInvertRight),
    downmixCenterDb: parent.downmixCenterDb !== -3 ? parent.downmixCenterDb : child.downmixCenterDb,
    downmixSurroundDb: parent.downmixSurroundDb !== -3 ? parent.downmixSurroundDb : child.downmixSurroundDb,
    downmixLfeDb: parent.downmixLfeDb !== -60 ? parent.downmixLfeDb : child.downmixLfeDb,
    fadeIn: Math.max(child.fadeIn, parent.fadeIn),
    fadeOut: Math.max(child.fadeOut, parent.fadeOut),
    fadeInCurve: parent.fadeIn >= child.fadeIn ? parent.fadeInCurve : child.fadeInCurve,
    fadeOutCurve: parent.fadeOut >= child.fadeOut ? parent.fadeOutCurve : child.fadeOutCurve,
    normalize: child.normalize || parent.normalize,
    preservePitch: child.preservePitch && parent.preservePitch,
    noiseReduction: Math.min(100, child.noiseReduction + parent.noiseReduction),
    voiceEnhance: child.voiceEnhance || parent.voiceEnhance,
    ducking: child.ducking || parent.ducking,
    duckingAmountDb: Math.min(child.duckingAmountDb ?? -11, parent.duckingAmountDb ?? -11),
    duckingAttackMs: Math.min(child.duckingAttackMs ?? 180, parent.duckingAttackMs ?? 180),
    duckingReleaseMs: Math.max(child.duckingReleaseMs ?? 650, parent.duckingReleaseMs ?? 650),
    role: child.role,
    sendBus: undefined,
    sendLevelDb: undefined,
    auxSends: [...resolveAudioAuxSends(child), ...resolveAudioAuxSends(parent)].slice(0, 4).map((send) => ({ ...send, id: crypto.randomUUID() })),
    highpassHz: Math.max(child.highpassHz ?? 20, parent.highpassHz ?? 20),
    eqLowDb: (child.eqLowDb ?? 0) + (parent.eqLowDb ?? 0),
    eqMidDb: (child.eqMidDb ?? 0) + (parent.eqMidDb ?? 0),
    eqHighDb: (child.eqHighDb ?? 0) + (parent.eqHighDb ?? 0),
    compressorThresholdDb: Math.min(child.compressorThresholdDb ?? -12, parent.compressorThresholdDb ?? -12),
    compressorRatio: Math.max(child.compressorRatio ?? 1, parent.compressorRatio ?? 1),
    limiterDb: Math.min(child.limiterDb ?? -1, parent.limiterDb ?? -1),
  }
}
