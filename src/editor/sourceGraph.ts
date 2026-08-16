import type { ProjectSequence, SourceGraphDomain, SourceGraphSnapshot, TimelineClip, TimelineTrack } from './types'

export const sourceGraphDomains: SourceGraphDomain[] = ['video', 'audio', 'transcript', 'suggestions', 'markers', 'settings']

export interface SourceGraphImpact {
  changedDomains: SourceGraphDomain[]
  legacySnapshot: boolean
  missingSource: boolean
}

export interface SourceGraphBatchEntry extends SourceGraphImpact {
  derivedSequenceId: string
  derivedName: string
  sourceSequenceId: string
  sourceName?: string
}

export interface SourceGraphBatchInspection {
  entries: SourceGraphBatchEntry[]
  domainCounts: Record<SourceGraphDomain, number>
  missingSourceCount: number
}

function fingerprint(value: unknown): string {
  const text = JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function overlaps(start: number, duration: number, rangeStart: number, rangeEnd: number): boolean {
  return start < rangeEnd && start + duration > rangeStart
}

function rangedClips(track: TimelineTrack, start: number, end: number): TimelineClip[] {
  return track.clips.filter((clip) => overlaps(clip.start, clip.duration, start, end))
}

function commonClipPayload(clip: TimelineClip, rangeStart: number) {
  return {
    id: clip.id,
    sourceClipId: clip.sourceClipId,
    assetId: clip.assetId,
    subclipId: clip.subclipId,
    nestedSequenceId: clip.nestedSequenceId,
    start: clip.start - rangeStart,
    duration: clip.duration,
    sourceOffset: clip.sourceOffset,
    enabled: clip.enabled,
    playbackRate: clip.playbackRate,
    speedKeyframes: clip.speedKeyframes,
    reverse: clip.reverse,
    freezeFrame: clip.freezeFrame,
    freezeFrameSourceTime: clip.freezeFrameSourceTime,
  }
}

function videoClipPayload(clip: TimelineClip, rangeStart: number) {
  return {
    ...commonClipPayload(clip, rangeStart),
    transform: clip.transform,
    frameInterpolation: clip.frameInterpolation,
    compositePriority: clip.compositePriority,
    multicamAngleIndex: clip.multicamAngleIndex,
    trackMatte: clip.trackMatte,
    effectStack: clip.effectStack,
    groupId: clip.groupId,
    linkGroupId: clip.linkGroupId,
    transitionIn: clip.transitionIn,
    transitionOut: clip.transitionOut,
    keyframes: clip.keyframes,
    motionPathAutoOrient: clip.motionPathAutoOrient,
    motionPathOrientationOffset: clip.motionPathOrientationOffset,
    motionBlur: clip.motionBlur,
    stabilization: clip.stabilization,
    colorAdjustment: clip.colorAdjustment,
    visualEffects: clip.visualEffects,
    visualKeyframes: clip.visualKeyframes,
    adjustmentLayer: clip.adjustmentLayer,
    clipMarkers: clip.clipMarkers,
  }
}

function audioClipPayload(clip: TimelineClip, rangeStart: number) {
  return {
    ...commonClipPayload(clip, rangeStart),
    audioAdjustment: clip.audioAdjustment,
    audioMixKeyframes: clip.audioMixKeyframes,
    audioDisabled: clip.audioDisabled,
    multicamAudioMode: clip.multicamAudioMode,
    multicamAudioAngle: clip.multicamAudioAngle,
    adrCue: clip.adrCue,
    adrTake: clip.adrTake,
    adrCueId: clip.adrCueId,
    adrTakeId: clip.adrTakeId,
    adrCompRanges: clip.adrCompRanges,
  }
}

export function sourceGraphFingerprints(sequence: ProjectSequence, range?: { start: number; end: number }): Record<SourceGraphDomain, string> {
  const start = range?.start ?? 0
  const end = range?.end ?? Number.POSITIVE_INFINITY
  const videoTracks = sequence.tracks.filter((track) => track.kind === 'video').map((track) => ({
    id: track.id, name: track.name, muted: track.muted, locked: track.locked, visible: track.visible,
    compositePriority: track.compositePriority,
    clips: rangedClips(track, start, end).map((clip) => videoClipPayload(clip, start)),
  }))
  const audioTracks = sequence.tracks.filter((track) => track.kind === 'audio').map((track) => ({
    ...track,
    clips: rangedClips(track, start, end).map((clip) => audioClipPayload(clip, start)),
  }))
  const embeddedAudio = sequence.tracks.filter((track) => track.kind === 'video').map((track) => ({
    id: track.id,
    clips: rangedClips(track, start, end).map((clip) => audioClipPayload(clip, start)),
  }))
  const captionTracks = sequence.tracks.filter((track) => track.kind === 'caption').map((track) => ({
    ...track,
    clips: rangedClips(track, start, end).map((clip) => ({ ...clip, start: clip.start - start })),
  }))
  const transcript = sequence.transcript.filter((segment) => overlaps(segment.start, segment.end - segment.start, start, end)).map((segment) => ({
    ...segment,
    start: segment.start - start,
    end: segment.end - start,
  }))
  const suggestions = sequence.suggestions.filter((item) => overlaps(item.start, item.end - item.start, start, end)).map((item) => ({
    ...item,
    start: item.start - start,
    end: item.end - start,
  }))
  const markers = (sequence.markers ?? []).filter((marker) => overlaps(marker.time, marker.duration ?? Number.EPSILON, start, end)).map((marker) => ({
    ...marker,
    time: marker.time - start,
  }))
  return {
    video: fingerprint(videoTracks),
    audio: fingerprint({ tracks: audioTracks, embeddedAudio, buses: sequence.audioBuses }),
    transcript: fingerprint({ transcript, captionTracks }),
    suggestions: fingerprint(suggestions),
    markers: fingerprint(markers),
    settings: fingerprint({
      aspectRatio: sequence.aspectRatio,
      width: sequence.width,
      height: sequence.height,
      fps: sequence.fps,
      timecodeStart: sequence.timecodeStart,
      timecodeDropFrame: sequence.timecodeDropFrame,
      transitionDefaults: sequence.transitionDefaults,
    }),
  }
}

export function createSourceGraphSnapshot(sequence: ProjectSequence, range?: { start: number; end: number }): SourceGraphSnapshot {
  return { version: 'cutline-source-graph-v1', fingerprints: sourceGraphFingerprints(sequence, range) }
}

export function sequenceFingerprint(sequence: ProjectSequence, range?: { start: number; end: number }): string {
  return fingerprint(sourceGraphFingerprints(sequence, range))
}

export function inspectDerivedSequenceImpact(derived: ProjectSequence, source?: ProjectSequence): SourceGraphImpact {
  if (!source || !derived.sourceRange) return { changedDomains: sourceGraphDomains.slice(), legacySnapshot: !derived.sourceGraphSnapshot, missingSource: !source }
  const current = sourceGraphFingerprints(source, derived.sourceRange)
  if (!derived.sourceGraphSnapshot) {
    const unchanged = Boolean(derived.sourceFingerprint) && sequenceFingerprint(source, derived.sourceRange) === derived.sourceFingerprint
    return { changedDomains: unchanged ? [] : sourceGraphDomains.slice(), legacySnapshot: true, missingSource: false }
  }
  return {
    changedDomains: sourceGraphDomains.filter((domain) => derived.sourceGraphSnapshot?.fingerprints[domain] !== current[domain]),
    legacySnapshot: false,
    missingSource: false,
  }
}

export function inspectSourceGraphBatch(sequences: ProjectSequence[]): SourceGraphBatchInspection {
  const sourceById = new Map(sequences.map((sequence) => [sequence.id, sequence]))
  const entries = sequences.flatMap((sequence): SourceGraphBatchEntry[] => {
    if (!sequence.sourceSequenceId || !sequence.sourceRange) return []
    const source = sourceById.get(sequence.sourceSequenceId)
    const impact = inspectDerivedSequenceImpact(sequence, source)
    if (!impact.changedDomains.length) return []
    return [{
      derivedSequenceId: sequence.id,
      derivedName: sequence.name,
      sourceSequenceId: sequence.sourceSequenceId,
      sourceName: source?.name,
      ...impact,
    }]
  })
  const domainCounts = Object.fromEntries(sourceGraphDomains.map((domain) => [domain, entries.filter((entry) => entry.changedDomains.includes(domain)).length])) as Record<SourceGraphDomain, number>
  return { entries, domainCounts, missingSourceCount: entries.filter((entry) => entry.missingSource).length }
}

const visualEditKeys = [
  'transform', 'compositePriority', 'trackMatte', 'effectStack', 'transitionIn', 'transitionOut', 'keyframes',
  'motionPathAutoOrient', 'motionPathOrientationOffset', 'motionBlur', 'stabilization', 'colorAdjustment',
  'visualEffects', 'visualKeyframes',
] as const satisfies ReadonlyArray<keyof TimelineClip>

const audioEditKeys = [
  'audioAdjustment', 'audioMixKeyframes', 'audioDisabled', 'multicamAudioMode', 'multicamAudioAngle',
  'adrCue', 'adrTake', 'adrCueId', 'adrTakeId', 'adrCompRanges',
] as const satisfies ReadonlyArray<keyof TimelineClip>

function findLineageClip(clip: TimelineClip, tracks: TimelineTrack[]): TimelineClip | undefined {
  const clips = tracks.flatMap((track) => track.clips)
  if (clip.sourceClipId) {
    const exact = clips.find((candidate) => (candidate.sourceClipId ?? candidate.id) === clip.sourceClipId)
    if (exact) return exact
  }
  return clips
    .filter((candidate) => candidate.assetId === clip.assetId && candidate.nestedSequenceId === clip.nestedSequenceId)
    .sort((left, right) => Math.abs(left.start - clip.start) - Math.abs(right.start - clip.start))[0]
}

function copyKeys(target: TimelineClip, source: TimelineClip | undefined, keys: ReadonlyArray<keyof TimelineClip>): TimelineClip {
  if (!source) return target
  const result = { ...target }
  const record = result as unknown as Record<string, unknown>
  for (const key of keys) {
    if (source[key] === undefined) delete record[key]
    else record[key] = source[key]
  }
  return result
}

function mergeRegeneratedVideoTracks(derived: ProjectSequence, regenerated: ProjectSequence, syncAudio: boolean, preserveLocalEdits: boolean): TimelineTrack[] {
  const oldVideo = derived.tracks.filter((track) => track.kind === 'video')
  return regenerated.tracks.filter((track) => track.kind === 'video').map((track) => ({
    ...track,
    clips: track.clips.map((clip) => {
      const previous = findLineageClip(clip, oldVideo)
      let result = preserveLocalEdits ? copyKeys(clip, previous, visualEditKeys) : clip
      if (!syncAudio || preserveLocalEdits) result = copyKeys(result, previous, audioEditKeys)
      return result
    }),
  }))
}

function mergeAudioIntoExistingVideo(derived: ProjectSequence, regenerated: ProjectSequence, preserveLocalEdits: boolean): TimelineTrack[] {
  const regeneratedVideo = regenerated.tracks.filter((track) => track.kind === 'video')
  return derived.tracks.filter((track) => track.kind === 'video').map((track) => ({
    ...track,
    clips: track.clips.map((clip) => preserveLocalEdits ? clip : copyKeys(clip, findLineageClip(clip, regeneratedVideo), audioEditKeys)),
  }))
}

function replaceTrackDomains(base: TimelineTrack[], replacements: TimelineTrack[], kinds: Set<TimelineTrack['kind']>): TimelineTrack[] {
  const selected = replacements.filter((track) => kinds.has(track.kind))
  let inserted = false
  const result = base.flatMap((track) => {
    if (!kinds.has(track.kind)) return [track]
    if (inserted) return []
    inserted = true
    return selected
  })
  return inserted ? result : [...result, ...selected]
}

export function synchronizeDerivedSequenceDomains(options: {
  derived: ProjectSequence
  regenerated: ProjectSequence
  source: ProjectSequence
  domains: Iterable<SourceGraphDomain>
  preserveLocalEdits?: boolean
}): ProjectSequence {
  const { derived, regenerated, source } = options
  const selected = new Set(options.domains)
  const preserve = options.preserveLocalEdits ?? true
  let tracks = derived.tracks

  if (selected.has('video')) {
    tracks = replaceTrackDomains(tracks, mergeRegeneratedVideoTracks(derived, regenerated, selected.has('audio'), preserve), new Set(['video']))
  } else if (selected.has('audio')) {
    tracks = replaceTrackDomains(tracks, mergeAudioIntoExistingVideo(derived, regenerated, preserve), new Set(['video']))
  }
  if (selected.has('audio')) tracks = replaceTrackDomains(tracks, regenerated.tracks, new Set(['audio']))
  if (selected.has('transcript')) tracks = replaceTrackDomains(tracks, regenerated.tracks, new Set(['caption']))

  const currentSnapshot = createSourceGraphSnapshot(source, derived.sourceRange)
  const previous = derived.sourceGraphSnapshot?.fingerprints
  const mergedFingerprints = Object.fromEntries(sourceGraphDomains.map((domain) => [
    domain,
    selected.has(domain) ? currentSnapshot.fingerprints[domain] : previous?.[domain] ?? `legacy:${derived.sourceFingerprint ?? 'unknown'}:${domain}`,
  ])) as Record<SourceGraphDomain, string>
  const fullySynchronized = sourceGraphDomains.every((domain) => mergedFingerprints[domain] === currentSnapshot.fingerprints[domain])

  return {
    ...derived,
    tracks,
    transcript: selected.has('transcript') ? regenerated.transcript : derived.transcript,
    suggestions: selected.has('suggestions') ? regenerated.suggestions : derived.suggestions,
    markers: selected.has('markers') ? regenerated.markers : derived.markers,
    aspectRatio: selected.has('settings') ? regenerated.aspectRatio : derived.aspectRatio,
    width: selected.has('settings') ? regenerated.width : derived.width,
    height: selected.has('settings') ? regenerated.height : derived.height,
    fps: selected.has('settings') ? regenerated.fps : derived.fps,
    timecodeStart: selected.has('settings') ? regenerated.timecodeStart : derived.timecodeStart,
    timecodeDropFrame: selected.has('settings') ? regenerated.timecodeDropFrame : derived.timecodeDropFrame,
    transitionDefaults: selected.has('settings') ? regenerated.transitionDefaults : derived.transitionDefaults,
    audioBuses: selected.has('audio') ? regenerated.audioBuses : derived.audioBuses,
    sourceFingerprint: fullySynchronized ? sequenceFingerprint(source, derived.sourceRange) : derived.sourceFingerprint ?? sequenceFingerprint(source, derived.sourceRange),
    sourceGraphSnapshot: { version: 'cutline-source-graph-v1', fingerprints: mergedFingerprints },
  }
}

export function staleDerivedSequenceIds(sequences: ProjectSequence[]): Set<string> {
  return new Set(inspectSourceGraphBatch(sequences).entries.map((entry) => entry.derivedSequenceId))
}
