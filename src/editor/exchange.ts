import type { MediaAsset, SequencePreset, SequenceTransitionDefaults, TimelineClip, TimelineMarker, TimelineTrack } from './types'
import { clipSourceTime, defaultAudioAdjustment } from './effects'
import { normalizeSequenceTransitionDefaults } from './transitions'
import { formatMediaTimecode, parseMediaTimecode } from '../media/timecode'

export interface ImportedTimelineClip {
  id: string
  name: string
  mediaName: string
  reel?: string
  kind: 'video' | 'audio' | 'caption'
  lane: number
  start: number
  duration: number
  sourceOffset: number
  playbackRate: number
  reverse?: boolean
  transitionIn?: TimelineClip['transitionIn']
  transitionOut?: TimelineClip['transitionOut']
  transform?: TimelineClip['transform']
  color?: string
  groupId?: string
  linkGroupId?: string
  freezeFrame?: boolean
  freezeFrameSourceTime?: number
  adjustmentLayer?: boolean
  enabled?: boolean
  frameInterpolation?: TimelineClip['frameInterpolation']
  speedKeyframes?: TimelineClip['speedKeyframes']
  compositePriority?: number
  effectStack?: TimelineClip['effectStack']
  keyframes?: TimelineClip['keyframes']
  motionPathAutoOrient?: boolean
  motionPathOrientationOffset?: number
  motionBlur?: TimelineClip['motionBlur']
  stabilization?: TimelineClip['stabilization']
  colorAdjustment?: TimelineClip['colorAdjustment']
  visualEffects?: TimelineClip['visualEffects']
  visualKeyframes?: TimelineClip['visualKeyframes']
  audioAdjustment?: TimelineClip['audioAdjustment']
  audioMixKeyframes?: TimelineClip['audioMixKeyframes']
  audioDisabled?: boolean
  nestedSequenceId?: string
  multicamAngle?: number
  multicamAudioMode?: TimelineClip['multicamAudioMode']
  multicamAudioAngle?: number
  clipMarkers?: TimelineClip['clipMarkers']
  captionStyle?: TimelineClip['captionStyle']
  captionWords?: TimelineClip['captionWords']
  captionLanguage?: TimelineClip['captionLanguage']
  speaker?: TimelineClip['speaker']
  masterEffectsEnabled?: MediaAsset['masterEffectsEnabled']
  masterColorAdjustment?: MediaAsset['masterColorAdjustment']
  masterVisualEffects?: MediaAsset['masterVisualEffects']
  masterAudioAdjustment?: MediaAsset['masterAudioAdjustment']
  sourceRotation?: MediaAsset['sourceRotation']
  sourcePixelAspectRatio?: MediaAsset['sourcePixelAspectRatio']
  sourceFrameRateOverride?: MediaAsset['sourceFrameRateOverride']
  sourceFieldOrder?: MediaAsset['sourceFieldOrder']
  sourceColorSpaceOverride?: MediaAsset['sourceColorSpaceOverride']
  sourceAlphaMode?: MediaAsset['sourceAlphaMode']
  sourceAlphaBackground?: MediaAsset['sourceAlphaBackground']
  sourceAudioLayout?: MediaAsset['sourceAudioLayout']
  sourceAudioStreamIndex?: MediaAsset['sourceAudioStreamIndex']
}

export interface ImportedTimeline {
  name: string
  fps: number
  width?: number
  height?: number
  timecodeStart?: number
  timecodeDropFrame?: boolean
  transitionDefaults?: SequenceTransitionDefaults
  clips: ImportedTimelineClip[]
  markers: TimelineMarker[]
  trackSettings?: Array<{ kind: TimelineTrack['kind']; lane: number; name?: string; sourceTarget?: boolean; editTarget?: boolean; syncLock?: boolean; muted?: boolean; locked?: boolean; visible?: boolean; solo?: boolean; volume?: number; pan?: number; mixAutomationMode?: TimelineTrack['mixAutomationMode']; mixKeyframes?: TimelineTrack['mixKeyframes']; compositePriority?: number; multicamAngleIndex?: number; labelColor?: string; audioRole?: TimelineTrack['audioRole']; captionLanguage?: TimelineTrack['captionLanguage']; captionFormat?: TimelineTrack['captionFormat']; captionStyle?: TimelineTrack['captionStyle'] }>
}

export interface MaterializedImportedTimeline {
  assets: MediaAsset[]
  tracks: TimelineTrack[]
  aspectRatio: SequencePreset['ratio']
  width: number
  height: number
  matchedMediaCount: number
  offlineMediaCount: number
}

export function materializeImportedTimeline(imported: ImportedTimeline, existingAssets: MediaAsset[], fallbackPreset: SequencePreset): MaterializedImportedTimeline {
  const importedAt = new Date().toISOString()
  const assets = [...existingAssets]
  const offlineByKey = new Map<string, MediaAsset>()
  let matchedMediaCount = 0
  const matchedIds = new Set<string>()
  const mediaForClip = new Map<string, MediaAsset>()
  for (const clip of imported.clips) {
    if (clip.kind === 'caption' || clip.adjustmentLayer) continue
    const candidates = [clip.mediaName, clip.name, clip.reel].filter((value): value is string => Boolean(value?.trim()))
    const match = existingAssets.find((asset) => {
      if (clip.kind === 'video' && asset.kind === 'audio') return false
      const assetKeys = new Set([asset.name, asset.reelName, asset.sourcePath?.split(/[\\/]/).pop()].filter((value): value is string => Boolean(value)).flatMap(mediaMatchKeys))
      return candidates.flatMap(mediaMatchKeys).some((key) => assetKeys.has(key))
    })
    if (match) {
      const hasEditWeaveSourceMetadata = clip.masterEffectsEnabled !== undefined
        || clip.sourceRotation !== undefined
        || clip.sourcePixelAspectRatio !== undefined
        || clip.sourceFrameRateOverride !== undefined
        || clip.sourceFieldOrder !== undefined
        || clip.sourceColorSpaceOverride !== undefined
        || clip.sourceAlphaMode !== undefined
        || clip.sourceAlphaBackground !== undefined
        || clip.sourceAudioLayout !== undefined
        || clip.sourceAudioStreamIndex !== undefined
      const resolvedMatch = !hasEditWeaveSourceMetadata ? match : {
        ...match,
        masterEffectsEnabled: clip.masterEffectsEnabled,
        masterColorAdjustment: structuredClone(clip.masterColorAdjustment),
        masterVisualEffects: structuredClone(clip.masterVisualEffects),
        masterAudioAdjustment: structuredClone(clip.masterAudioAdjustment),
        sourceRotation: clip.sourceRotation,
        sourcePixelAspectRatio: clip.sourcePixelAspectRatio,
        sourceFrameRateOverride: clip.sourceFrameRateOverride,
        sourceFieldOrder: clip.sourceFieldOrder,
        sourceColorSpaceOverride: clip.sourceColorSpaceOverride,
        sourceAlphaMode: clip.sourceAlphaMode,
        sourceAlphaBackground: clip.sourceAlphaBackground,
        sourceAudioLayout: clip.sourceAudioLayout,
        sourceAudioStreamIndex: clip.sourceAudioStreamIndex,
      }
      const matchIndex = assets.findIndex((asset) => asset.id === match.id)
      if (matchIndex >= 0) assets[matchIndex] = resolvedMatch
      mediaForClip.set(clip.id, resolvedMatch)
      if (!matchedIds.has(match.id)) { matchedIds.add(match.id); matchedMediaCount += 1 }
      continue
    }
    const offlineKey = mediaMatchKeys(clip.mediaName)[0] || mediaMatchKeys(clip.reel ?? clip.name)[0] || clip.id
    let offline = offlineByKey.get(offlineKey)
    if (!offline) {
      const related = imported.clips.filter((candidate) => mediaMatchKeys(candidate.mediaName).includes(offlineKey) || mediaMatchKeys(candidate.reel ?? candidate.name).includes(offlineKey))
      const name = clip.mediaName || clip.name || clip.reel || 'Offline Media'
      const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : related.some((candidate) => candidate.kind === 'audio') && !related.some((candidate) => candidate.kind === 'video') ? 'wav' : 'mov'
      offline = {
        id: crypto.randomUUID(), name, kind: related.some((candidate) => candidate.kind === 'video') ? 'video' : 'audio', url: '',
        duration: Math.max(1 / imported.fps, ...related.map((candidate) => candidate.sourceOffset + candidate.duration * candidate.playbackRate)),
        size: 0, extension, width: imported.width, height: imported.height, frameRate: imported.fps,
        status: 'offline', error: `교환 파일에서 참조한 원본을 찾지 못했습니다. “${name}” 원본을 재연결하세요.`,
        proxyStatus: 'none', folder: '교환 파일 · 오프라인', reelName: clip.reel, importedAt,
        masterEffectsEnabled: clip.masterEffectsEnabled,
        masterColorAdjustment: structuredClone(clip.masterColorAdjustment),
        masterVisualEffects: structuredClone(clip.masterVisualEffects),
        masterAudioAdjustment: structuredClone(clip.masterAudioAdjustment),
        sourceRotation: clip.sourceRotation,
        sourcePixelAspectRatio: clip.sourcePixelAspectRatio,
        sourceFrameRateOverride: clip.sourceFrameRateOverride,
        sourceFieldOrder: clip.sourceFieldOrder,
        sourceColorSpaceOverride: clip.sourceColorSpaceOverride,
        sourceAlphaMode: clip.sourceAlphaMode,
        sourceAlphaBackground: clip.sourceAlphaBackground,
        sourceAudioLayout: clip.sourceAudioLayout,
        sourceAudioStreamIndex: clip.sourceAudioStreamIndex,
      }
      offlineByKey.set(offlineKey, offline)
      assets.push(offline)
    }
    mediaForClip.set(clip.id, offline)
  }

  const trackBuckets = new Map<string, TimelineTrack[]>()
  const timelineClips = [...imported.clips].sort((left, right) => left.start - right.start || left.lane - right.lane)
  const linkGroups = new Map<string, Set<ImportedTimelineClip['kind']>>()
  timelineClips.forEach((clip) => {
    if (clip.kind === 'caption') return
    const key = `${clip.mediaName}|${clip.start.toFixed(5)}|${clip.duration.toFixed(5)}|${clip.sourceOffset.toFixed(5)}`
    const kinds = linkGroups.get(key) ?? new Set()
    kinds.add(clip.kind)
    linkGroups.set(key, kinds)
  })
  const linkedIds = new Map<string, string>()
  const importedLinkIds = new Map<string, string>()
  const importedGroupIds = new Map<string, string>()
  for (const source of timelineClips) {
    const bucketKey = `${source.kind}:${source.lane}`
    const bucket = trackBuckets.get(bucketKey) ?? []
    let track = bucket.find((candidate) => !candidate.clips.some((clip) => clip.start < source.start + source.duration && clip.start + clip.duration > source.start))
    if (!track) {
      const laneIndex = bucket.length
      const ordinal = Math.max(1, Math.abs(source.lane) + 1)
      const prefix = source.kind === 'video' ? 'V' : source.kind === 'audio' ? 'A' : 'T'
      const importedTrack = imported.trackSettings?.find((candidate) => candidate.kind === source.kind && candidate.lane === source.lane)
      track = {
        id: `track-${crypto.randomUUID()}`, name: importedTrack?.name || `${prefix}${ordinal}${laneIndex ? `.${laneIndex + 1}` : ''} · 교환 파일`, kind: source.kind,
        sourceTarget: importedTrack?.sourceTarget ?? bucket.length === 0, editTarget: importedTrack?.editTarget ?? true, muted: importedTrack?.muted ?? false, locked: importedTrack?.locked ?? false, syncLock: importedTrack?.syncLock ?? true, multicamAngleIndex: importedTrack?.multicamAngleIndex,
        visible: importedTrack?.visible, solo: importedTrack?.solo, volume: importedTrack?.volume, pan: importedTrack?.pan,
        mixAutomationMode: importedTrack?.mixAutomationMode, mixKeyframes: structuredClone(importedTrack?.mixKeyframes), compositePriority: importedTrack?.compositePriority, labelColor: importedTrack?.labelColor,
        audioRole: importedTrack?.audioRole ?? (source.kind === 'audio' ? 'dialogue' : undefined),
        captionLanguage: importedTrack?.captionLanguage, captionFormat: importedTrack?.captionFormat, captionStyle: structuredClone(importedTrack?.captionStyle), clips: [],
      }
      bucket.push(track)
      trackBuckets.set(bucketKey, bucket)
    }
    const asset = source.kind === 'caption' || source.adjustmentLayer ? undefined : mediaForClip.get(source.id)
    const linkKey = `${source.mediaName}|${source.start.toFixed(5)}|${source.duration.toFixed(5)}|${source.sourceOffset.toFixed(5)}`
    const shouldLink = source.kind !== 'caption' && (linkGroups.get(linkKey)?.size ?? 0) > 1
    const linkGroupId = source.linkGroupId
      ? importedLinkIds.get(source.linkGroupId) ?? crypto.randomUUID()
      : shouldLink ? linkedIds.get(linkKey) ?? crypto.randomUUID() : undefined
    if (source.linkGroupId && linkGroupId) importedLinkIds.set(source.linkGroupId, linkGroupId)
    if (linkGroupId) linkedIds.set(linkKey, linkGroupId)
    const groupId = source.groupId ? importedGroupIds.get(source.groupId) ?? crypto.randomUUID() : undefined
    if (source.groupId && groupId) importedGroupIds.set(source.groupId, groupId)
    track.clips.push({
      id: source.id, trackId: track.id, assetId: asset?.id, name: source.name, start: Math.max(0, source.start),
      duration: Math.max(1 / imported.fps, source.duration), sourceOffset: Math.max(0, source.sourceOffset), kind: source.kind,
      color: source.color ?? (source.kind === 'video' ? '#7862d6' : source.kind === 'audio' ? '#3fb993' : '#c79243'), enabled: source.enabled ?? true,
      transform: source.transform ?? { positionX: 0, positionY: 0, scale: 100, rotation: 0, opacity: 100 },
      playbackRate: source.playbackRate, reverse: source.reverse, freezeFrame: source.freezeFrame, freezeFrameSourceTime: source.freezeFrameSourceTime,
      transitionIn: source.transitionIn, transitionOut: source.transitionOut, groupId, linkGroupId, adjustmentLayer: source.adjustmentLayer,
      frameInterpolation: source.frameInterpolation, speedKeyframes: structuredClone(source.speedKeyframes), compositePriority: source.compositePriority,
      effectStack: structuredClone(source.effectStack), keyframes: structuredClone(source.keyframes), motionPathAutoOrient: source.motionPathAutoOrient, motionPathOrientationOffset: source.motionPathOrientationOffset, motionBlur: structuredClone(source.motionBlur), stabilization: structuredClone(source.stabilization), colorAdjustment: structuredClone(source.colorAdjustment),
      visualEffects: structuredClone(source.visualEffects), visualKeyframes: structuredClone(source.visualKeyframes),
      audioAdjustment: structuredClone(source.audioAdjustment), audioMixKeyframes: structuredClone(source.audioMixKeyframes),
      audioDisabled: source.audioDisabled, nestedSequenceId: source.nestedSequenceId, multicamAngle: source.multicamAngle, multicamAudioMode: source.multicamAudioMode, multicamAudioAngle: source.multicamAudioAngle, clipMarkers: structuredClone(source.clipMarkers),
      captionStyle: structuredClone(source.captionStyle), captionWords: structuredClone(source.captionWords), captionLanguage: source.captionLanguage, speaker: source.speaker,
    })
  }
  for (const importedTrack of imported.trackSettings ?? []) {
    const bucketKey = `${importedTrack.kind}:${importedTrack.lane}`
    if (trackBuckets.has(bucketKey)) continue
    trackBuckets.set(bucketKey, [{
      id: `track-${crypto.randomUUID()}`, name: importedTrack.name || `${importedTrack.kind === 'video' ? 'V' : importedTrack.kind === 'audio' ? 'A' : 'T'}${importedTrack.lane + 1} · 교환 파일`, kind: importedTrack.kind,
      sourceTarget: importedTrack.sourceTarget, editTarget: importedTrack.editTarget, syncLock: importedTrack.syncLock ?? true, multicamAngleIndex: importedTrack.multicamAngleIndex,
      muted: importedTrack.muted ?? false, locked: importedTrack.locked ?? false, visible: importedTrack.visible, solo: importedTrack.solo,
      volume: importedTrack.volume, pan: importedTrack.pan, mixAutomationMode: importedTrack.mixAutomationMode, mixKeyframes: structuredClone(importedTrack.mixKeyframes), compositePriority: importedTrack.compositePriority,
      labelColor: importedTrack.labelColor, audioRole: importedTrack.audioRole, captionLanguage: importedTrack.captionLanguage,
      captionFormat: importedTrack.captionFormat, captionStyle: structuredClone(importedTrack.captionStyle), clips: [],
    }])
  }
  const kindOrder: Record<TimelineTrack['kind'], number> = { video: 0, audio: 1, caption: 2 }
  const orderedTracks = [...trackBuckets.entries()]
    .sort(([left], [right]) => {
      const [leftKind, leftLane] = left.split(':')
      const [rightKind, rightLane] = right.split(':')
      if (leftKind !== rightKind) return kindOrder[leftKind as TimelineTrack['kind']] - kindOrder[rightKind as TimelineTrack['kind']]
      return Number(leftLane) - Number(rightLane)
    })
    .flatMap(([, bucket]) => bucket)
  if (!orderedTracks.some((track) => track.kind === 'video')) orderedTracks.unshift(emptyExchangeTrack('video'))
  if (!orderedTracks.some((track) => track.kind === 'audio')) orderedTracks.push(emptyExchangeTrack('audio'))
  if (!orderedTracks.some((track) => track.kind === 'caption')) orderedTracks.push(emptyExchangeTrack('caption'))
  const width = imported.width ?? fallbackPreset.width
  const height = imported.height ?? fallbackPreset.height
  const aspectRatio = closestAspectRatio(width, height)
  return { assets, tracks: orderedTracks, aspectRatio, width, height, matchedMediaCount, offlineMediaCount: offlineByKey.size }
}

function emptyExchangeTrack(kind: TimelineTrack['kind']): TimelineTrack {
  const label = kind === 'video' ? 'V1 · 비디오' : kind === 'audio' ? 'A1 · 오디오' : 'T1 · 자막'
  return { id: `track-${crypto.randomUUID()}`, name: label, kind, sourceTarget: true, editTarget: true, muted: false, locked: false, syncLock: true, clips: [] }
}

function mediaMatchKeys(value: string): string[] {
  const filename = value.trim().split(/[\\/]/).pop()?.toLocaleLowerCase() ?? ''
  const stem = filename.replace(/\.[^.]+$/, '')
  const compact = stem.replace(/[^\p{L}\p{N}]+/gu, '')
  return [...new Set([filename, stem, compact].filter(Boolean))]
}

function closestAspectRatio(width: number, height: number): SequencePreset['ratio'] {
  const value = width / Math.max(1, height)
  const candidates: Array<{ ratio: SequencePreset['ratio']; value: number }> = [{ ratio: '16:9', value: 16 / 9 }, { ratio: '9:16', value: 9 / 16 }, { ratio: '4:5', value: 4 / 5 }, { ratio: '1:1', value: 1 }]
  return candidates.sort((left, right) => Math.abs(left.value - value) - Math.abs(right.value - value))[0].ratio
}

export function parseExchangeTimeline(contents: string, filename: string, fallbackFps = 30): ImportedTimeline {
  const extension = filename.split('.').pop()?.toLowerCase()
  if (extension === 'otio' || /"OTIO_SCHEMA"\s*:\s*"Timeline\./i.test(contents)) return parseOtio(contents, fallbackFps)
  if (extension === 'edl' || /^\s*(TITLE:|FCM:|\d{3,}\s+\S+\s+[VA])/m.test(contents)) return parseEdl(contents, fallbackFps)
  if (extension === 'fcpxml' || /<fcpxml[\s>]/i.test(contents)) return parseFcpxml(contents, fallbackFps)
  if (extension === 'xml' || /<xmeml[\s>]/i.test(contents)) return parsePremiereXml(contents, fallbackFps)
  throw new Error('OTIO, FCPXML, Premiere Pro XML 또는 CMX 3600 EDL 파일이 아닙니다.')
}

interface OtioRationalTime { value?: number; rate?: number }
interface OtioTimeRange { start_time?: OtioRationalTime; duration?: OtioRationalTime }
interface OtioItem {
  OTIO_SCHEMA?: string
  name?: string
  kind?: string
  source_range?: OtioTimeRange
  marked_range?: OtioTimeRange
  target_url?: string
  media_reference?: OtioItem
  tracks?: OtioItem
  children?: OtioItem[]
  markers?: OtioItem[]
  metadata?: Record<string, unknown> & { editweave?: Partial<ImportedTimelineClip> & { type?: NonNullable<TimelineClip['transitionIn']>['type']; alignment?: NonNullable<TimelineClip['transitionIn']>['alignment']; easing?: NonNullable<TimelineClip['transitionIn']>['easing']; curve?: NonNullable<TimelineClip['transitionIn']>['curve']; audioCurve?: NonNullable<TimelineClip['transitionIn']>['audioCurve']; kind?: TimelineMarker['kind']; color?: string; status?: TimelineMarker['status']; sourceTarget?: boolean; editTarget?: boolean; syncLock?: boolean; muted?: boolean; locked?: boolean; visible?: boolean; solo?: boolean; volume?: number; pan?: number; mixAutomationMode?: TimelineTrack['mixAutomationMode']; mixKeyframes?: TimelineTrack['mixKeyframes']; multicamAngleIndex?: number; labelColor?: string; audioRole?: TimelineTrack['audioRole']; trackKind?: TimelineTrack['kind']; captionFormat?: TimelineTrack['captionFormat']; width?: number; height?: number; timecodeDropFrame?: boolean; transitionDefaults?: SequenceTransitionDefaults } }
  in_offset?: OtioRationalTime
  out_offset?: OtioRationalTime
  global_start_time?: OtioRationalTime
}

export function parseOtio(contents: string, fallbackFps = 30): ImportedTimeline {
  let timeline: OtioItem
  try { timeline = JSON.parse(contents) as OtioItem } catch { throw new Error('OTIO JSON 문법이 올바르지 않습니다.') }
  if (!timeline.OTIO_SCHEMA?.startsWith('Timeline.')) throw new Error('OTIO Timeline 문서가 아닙니다.')
  const tracksContainer = timeline.tracks ?? (timeline.children?.[0]?.OTIO_SCHEMA?.startsWith('Stack.') ? timeline.children[0] : timeline)
  const tracks = tracksContainer.children ?? []
  const rates = tracks.flatMap((track) => track.children ?? []).flatMap((item) => item.source_range?.duration?.rate ? [item.source_range.duration.rate] : [])
  const fps = rates.find((rate) => Number.isFinite(rate) && rate! > 0) ?? fallbackFps
  const clips: ImportedTimelineClip[] = []
  const trackSettings: NonNullable<ImportedTimeline['trackSettings']> = []
  tracks.forEach((track, lane) => {
    const kind: TimelineTrack['kind'] = track.metadata?.editweave?.trackKind === 'caption' ? 'caption' : track.kind?.toLocaleLowerCase() === 'audio' ? 'audio' : 'video'
    trackSettings.push({ kind, lane, name: track.name, sourceTarget: track.metadata?.editweave?.sourceTarget, editTarget: track.metadata?.editweave?.editTarget, syncLock: track.metadata?.editweave?.syncLock, muted: track.metadata?.editweave?.muted, locked: track.metadata?.editweave?.locked, visible: track.metadata?.editweave?.visible, solo: track.metadata?.editweave?.solo, volume: track.metadata?.editweave?.volume, pan: track.metadata?.editweave?.pan, mixAutomationMode: track.metadata?.editweave?.mixAutomationMode, mixKeyframes: track.metadata?.editweave?.mixKeyframes, compositePriority: track.metadata?.editweave?.compositePriority, multicamAngleIndex: track.metadata?.editweave?.multicamAngleIndex, labelColor: track.metadata?.editweave?.labelColor, audioRole: track.metadata?.editweave?.audioRole, captionLanguage: track.metadata?.editweave?.captionLanguage, captionFormat: track.metadata?.editweave?.captionFormat, captionStyle: track.metadata?.editweave?.captionStyle })
    let cursor = 0
    let pendingTransition: TimelineClip['transitionIn'] | undefined
    for (const item of track.children ?? []) {
      const schema = item.OTIO_SCHEMA ?? ''
      if (schema.startsWith('Transition.')) {
        const before = otioTime(item.in_offset, fps)
        const after = otioTime(item.out_offset, fps)
        const duration = before + after
        const inferredAlignment: NonNullable<TimelineClip['transitionIn']>['alignment'] = before <= 1 / fps ? 'start-at-cut' : after <= 1 / fps ? 'end-at-cut' : 'center-on-cut'
        pendingTransition = { type: item.metadata?.editweave?.type ?? (item.name?.toLocaleLowerCase().includes('wipe') ? 'wipe-left' : 'crossfade'), duration: Math.max(1 / fps, duration), alignment: item.metadata?.editweave?.alignment ?? inferredAlignment, easing: item.metadata?.editweave?.easing, curve: item.metadata?.editweave?.curve, audioCurve: item.metadata?.editweave?.audioCurve }
        continue
      }
      const duration = otioRangeDuration(item.source_range, fps)
      if (schema.startsWith('Gap.')) { cursor += duration; continue }
      if (!schema.startsWith('Clip.')) continue
      const sourceOffset = otioTime(item.source_range?.start_time, fps)
      const mediaReference = item.media_reference
      const targetUrl = mediaReference?.target_url
      const mediaName = mediaReference?.name || (targetUrl ? decodeMediaSourceName(targetUrl) : undefined) || item.name || 'Offline Media'
      const metadata = item.metadata?.editweave
      const assetMetadata = mediaReference?.metadata?.editweave
      clips.push({
        id: crypto.randomUUID(), name: item.name || mediaName, mediaName, kind, lane, start: cursor,
        duration: Math.max(1 / fps, duration), sourceOffset, playbackRate: Math.max(1 / 1000, metadata?.playbackRate ?? 1),
        reverse: metadata?.reverse, transform: metadata?.transform, transitionIn: pendingTransition,
        transitionOut: metadata?.transitionOut, color: metadata?.color, groupId: metadata?.groupId, linkGroupId: metadata?.linkGroupId,
        freezeFrame: metadata?.freezeFrame, freezeFrameSourceTime: metadata?.freezeFrameSourceTime, adjustmentLayer: metadata?.adjustmentLayer,
        enabled: metadata?.enabled, frameInterpolation: metadata?.frameInterpolation, speedKeyframes: metadata?.speedKeyframes,
        compositePriority: metadata?.compositePriority, effectStack: metadata?.effectStack, keyframes: metadata?.keyframes, motionPathAutoOrient: metadata?.motionPathAutoOrient, motionPathOrientationOffset: metadata?.motionPathOrientationOffset, motionBlur: metadata?.motionBlur, stabilization: metadata?.stabilization,
        colorAdjustment: metadata?.colorAdjustment, visualEffects: metadata?.visualEffects, visualKeyframes: metadata?.visualKeyframes,
        audioAdjustment: metadata?.audioAdjustment, audioMixKeyframes: metadata?.audioMixKeyframes,
        audioDisabled: metadata?.audioDisabled, nestedSequenceId: metadata?.nestedSequenceId, multicamAngle: metadata?.multicamAngle, multicamAudioMode: metadata?.multicamAudioMode, multicamAudioAngle: metadata?.multicamAudioAngle, clipMarkers: metadata?.clipMarkers,
        captionStyle: metadata?.captionStyle, captionWords: metadata?.captionWords, captionLanguage: metadata?.captionLanguage, speaker: metadata?.speaker,
        masterEffectsEnabled: assetMetadata?.masterEffectsEnabled, masterColorAdjustment: assetMetadata?.masterColorAdjustment,
        masterVisualEffects: assetMetadata?.masterVisualEffects, masterAudioAdjustment: assetMetadata?.masterAudioAdjustment,
        sourceRotation: assetMetadata?.sourceRotation, sourcePixelAspectRatio: assetMetadata?.sourcePixelAspectRatio,
        sourceFrameRateOverride: assetMetadata?.sourceFrameRateOverride,
        sourceFieldOrder: assetMetadata?.sourceFieldOrder,
        sourceColorSpaceOverride: assetMetadata?.sourceColorSpaceOverride,
        sourceAlphaMode: assetMetadata?.sourceAlphaMode, sourceAlphaBackground: assetMetadata?.sourceAlphaBackground, sourceAudioLayout: assetMetadata?.sourceAudioLayout, sourceAudioStreamIndex: assetMetadata?.sourceAudioStreamIndex,
      })
      pendingTransition = undefined
      cursor += duration
    }
  })
  if (!clips.length) throw new Error('OTIO에서 지원되는 클립을 찾지 못했습니다.')
  const markers = [...(timeline.markers ?? []), ...(tracksContainer.markers ?? [])].map((marker): TimelineMarker => ({
    id: crypto.randomUUID(), time: otioTime(marker.marked_range?.start_time, fps), duration: otioRangeDuration(marker.marked_range, fps) || undefined,
    label: marker.name || 'Marker', description: typeof marker.metadata === 'object' ? String((marker.metadata as Record<string, unknown>).comment ?? '') || undefined : undefined,
    color: marker.metadata?.editweave?.color ?? '#8169e8', kind: marker.metadata?.editweave?.kind ?? 'edit', status: marker.metadata?.editweave?.status,
  }))
  return { name: timeline.name || '가져온 OTIO', fps, width: timeline.metadata?.editweave?.width, height: timeline.metadata?.editweave?.height, timecodeStart: otioTime(timeline.global_start_time, fps), timecodeDropFrame: timeline.metadata?.editweave?.timecodeDropFrame, transitionDefaults: timeline.metadata?.editweave?.transitionDefaults ? normalizeSequenceTransitionDefaults(timeline.metadata.editweave.transitionDefaults) : undefined, clips, markers, trackSettings }
}

function otioTime(value: OtioRationalTime | undefined, fallbackRate: number): number {
  const rate = Number(value?.rate) || fallbackRate
  return (Number(value?.value) || 0) / Math.max(1e-12, rate)
}

function otioRangeDuration(value: OtioTimeRange | undefined, fallbackRate: number): number {
  return otioTime(value?.duration, fallbackRate)
}

export function parsePremiereXml(contents: string, fallbackFps = 30): ImportedTimeline {
  const document = new DOMParser().parseFromString(contents, 'application/xml')
  if (document.querySelector('parsererror')) throw new Error('Premiere Pro XML 문법이 올바르지 않습니다.')
  const sequence = document.querySelector('xmeml > sequence, xmeml sequence')
  if (!sequence) throw new Error('Premiere Pro XML에 시퀀스가 없습니다.')
  const timebase = Number(directText(sequence.querySelector(':scope > rate'), 'timebase')) || fallbackFps
  const ntsc = directText(sequence.querySelector(':scope > rate'), 'ntsc').toUpperCase() === 'TRUE'
  const fps = ntsc && (timebase === 30 || timebase === 60) ? timebase * 1_000 / 1_001 : timebase
  const characteristics = sequence.querySelector(':scope > media > video > format > samplecharacteristics')
  const width = Number(directText(characteristics, 'width')) || undefined
  const height = Number(directText(characteristics, 'height')) || undefined
  const sequenceTimecode = parseMediaTimecode(directText(sequence.querySelector(':scope > timecode'), 'string'), fps)
  const transitionDefaults = parseTransitionDefaultsMetadata(directText(sequence.querySelector(':scope > metadata'), 'editweave-transition-defaults'))
  const files = new Map<string, { name: string }>()
  for (const file of document.querySelectorAll('file')) {
    const id = file.getAttribute('id') ?? ''
    const pathName = decodeMediaSourceName(directText(file, 'pathurl'))
    const name = directText(file, 'name') || pathName || id || 'Offline Media'
    if (id && (!files.has(id) || directText(file, 'pathurl'))) files.set(id, { name })
  }
  const clips: ImportedTimelineClip[] = []
  const parseTrack = (track: Element, kind: 'video' | 'audio', lane: number) => {
    const trackClips: ImportedTimelineClip[] = []
    for (const item of track.querySelectorAll(':scope > clipitem')) {
      const fileElement = item.querySelector(':scope > file')
      const file = files.get(fileElement?.getAttribute('id') ?? '')
      const name = directText(item, 'name') || file?.name || 'Offline Media'
      const startFrames = Number(directText(item, 'start'))
      const endFrames = Number(directText(item, 'end'))
      const inFrames = Number(directText(item, 'in'))
      const outFrames = Number(directText(item, 'out'))
      if (![startFrames, endFrames].every(Number.isFinite) || endFrames <= startFrames) continue
      const speedParameter = [...item.querySelectorAll('filter effect parameter')].find((parameter) => directText(parameter, 'parameterid').toLocaleLowerCase().includes('speed'))
      const speed = Number(directText(speedParameter, 'value'))
      const playbackRate = Number.isFinite(speed) && speed !== 0 ? Math.abs(speed) / 100 : Math.max(1 / 1000, (outFrames - inFrames) / Math.max(1, endFrames - startFrames))
      const effects = [...item.querySelectorAll(':scope > filter > effect')]
      const normalizedId = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '')
      const parameter = (effect: Element | undefined, ...ids: string[]) => [...(effect?.querySelectorAll(':scope > parameter') ?? [])].find((candidate) => ids.includes(normalizedId(directText(candidate, 'parameterid'))))
      const numericParameter = (effect: Element | undefined, fallback: number, ...ids: string[]) => {
        const raw = directText(parameter(effect, ...ids), 'value').trim()
        const parsed = raw ? Number(raw) : Number.NaN
        return Number.isFinite(parsed) ? parsed : fallback
      }
      const motion = effects.find((effect) => ['basic', 'basicmotion'].includes(normalizedId(directText(effect, 'effectid'))) || normalizedId(directText(effect, 'name')) === 'motion')
      const opacityEffect = effects.find((effect) => normalizedId(directText(effect, 'effectid')).includes('opacity') || normalizedId(directText(effect, 'name')) === 'opacity')
      const audioFadeEffect = effects.find((effect) => normalizedId(directText(effect, 'effectid')) === 'editweaveaudiofade' || normalizedId(directText(effect, 'name')) === 'editweaveaudiofade')
      const textParameter = (effect: Element | undefined, fallback: string, ...ids: string[]) => directText(parameter(effect, ...ids), 'value').trim() || fallback
      const fadeCurve = (value: string): NonNullable<NonNullable<TimelineClip['audioAdjustment']>['fadeInCurve']> => ['linear', 'equal-power', 'logarithmic'].includes(value) ? value as NonNullable<NonNullable<TimelineClip['audioAdjustment']>['fadeInCurve']> : 'linear'
      const audioAdjustment: TimelineClip['audioAdjustment'] = audioFadeEffect ? {
        ...defaultAudioAdjustment(),
        fadeIn: Math.max(0, Math.min((endFrames - startFrames) / fps, numericParameter(audioFadeEffect, 0, 'editweavefadein'))),
        fadeOut: Math.max(0, Math.min((endFrames - startFrames) / fps, numericParameter(audioFadeEffect, 0, 'editweavefadeout'))),
        fadeInCurve: fadeCurve(textParameter(audioFadeEffect, 'linear', 'editweavefadeincurve')),
        fadeOutCurve: fadeCurve(textParameter(audioFadeEffect, 'linear', 'editweavefadeoutcurve')),
      } : undefined
      const centerValue = parameter(motion, 'center', 'position')?.querySelector(':scope > value')
      const centerXRaw = directText(centerValue, 'horiz').trim()
      const centerYRaw = directText(centerValue, 'vert').trim()
      const centerX = centerXRaw ? Number(centerXRaw) : Number.NaN
      const centerY = centerYRaw ? Number(centerYRaw) : Number.NaN
      const transform: TimelineClip['transform'] | undefined = kind === 'video' ? {
        positionX: Number.isFinite(centerX) ? centerX - (width ?? 0) / 2 : 0,
        positionY: Number.isFinite(centerY) ? centerY - (height ?? 0) / 2 : 0,
        scale: numericParameter(motion, 100, 'scale'),
        scaleX: numericParameter(motion, 100, 'editweavescalex'),
        scaleY: numericParameter(motion, 100, 'editweavescaley'),
        anchorX: numericParameter(motion, 50, 'editweaveanchorx'),
        anchorY: numericParameter(motion, 50, 'editweaveanchory'),
        skewX: numericParameter(motion, 0, 'editweaveskewx'),
        skewY: numericParameter(motion, 0, 'editweaveskewy'),
        rotation: numericParameter(motion, 0, 'rotation'),
        opacity: Math.max(0, Math.min(100, numericParameter(opacityEffect, 100, 'opacity', 'level'))),
      } : undefined
      const motionBlur: TimelineClip['motionBlur'] | undefined = kind === 'video' && numericParameter(motion, 0, 'editweavemotionblurenabled') >= 0.5 ? {
        enabled: true,
        shutterAngle: Math.max(0, Math.min(720, numericParameter(motion, 180, 'editweavemotionblurshutter'))),
        samples: Math.max(2, Math.min(16, Math.round(numericParameter(motion, 8, 'editweavemotionblursamples')))),
      } : undefined
      const motionPathAutoOrient = kind === 'video' && numericParameter(motion, 0, 'editweavemotionpathautoorient') >= 0.5
      const motionPathOrientationOffset = kind === 'video' ? numericParameter(motion, 0, 'editweavemotionpathorientationoffset') : undefined
      const motionParameters = kind === 'video' ? {
        center: parameter(motion, 'center', 'position'), scale: parameter(motion, 'scale'), rotation: parameter(motion, 'rotation'),
        scaleX: parameter(motion, 'editweavescalex'), scaleY: parameter(motion, 'editweavescaley'), anchorX: parameter(motion, 'editweaveanchorx'), anchorY: parameter(motion, 'editweaveanchory'), skewX: parameter(motion, 'editweaveskewx'), skewY: parameter(motion, 'editweaveskewy'),
        spatialInEnabled: parameter(motion, 'editweavespatialinenabled'), spatialInX: parameter(motion, 'editweavespatialinx'), spatialInY: parameter(motion, 'editweavespatialiny'),
        spatialOutEnabled: parameter(motion, 'editweavespatialoutenabled'), spatialOutX: parameter(motion, 'editweavespatialoutx'), spatialOutY: parameter(motion, 'editweavespatialouty'),
        opacity: parameter(opacityEffect, 'opacity', 'level'),
      } : undefined
      const parameterKeyframes = (value?: Element) => [...(value?.querySelectorAll(':scope > keyframe') ?? [])]
      const keyframeFrame = (keyframe: Element) => {
        const raw = Number(directText(keyframe, 'when'))
        const durationFrames = endFrames - startFrames
        return raw > durationFrames + 1 && raw >= startFrames ? raw - startFrames : raw
      }
      const keyframeAt = (value: Element | undefined, at: number) => parameterKeyframes(value).find((keyframe) => Math.abs(keyframeFrame(keyframe) - at) < 0.5)
      const scalarAt = (value: Element | undefined, at: number, fallback: number) => {
        const points = parameterKeyframes(value).map((keyframe) => ({ frame: keyframeFrame(keyframe), value: Number(directText(keyframe, 'value')) })).filter((point) => Number.isFinite(point.frame) && Number.isFinite(point.value)).sort((left, right) => left.frame - right.frame)
        if (!points.length) return fallback
        const nextIndex = points.findIndex((point) => point.frame >= at)
        if (nextIndex < 0) return points[points.length - 1].value
        if (nextIndex === 0) return points[0].value
        const previous = points[nextIndex - 1]
        const next = points[nextIndex]
        const progress = (at - previous.frame) / Math.max(1, next.frame - previous.frame)
        return previous.value + (next.value - previous.value) * progress
      }
      const centerAt = (at: number) => {
        const points = parameterKeyframes(motionParameters?.center).map((keyframe) => {
          const value = keyframe.querySelector(':scope > value')
          const x = directText(value, 'horiz').trim()
          const y = directText(value, 'vert').trim()
          return { frame: keyframeFrame(keyframe), x: x ? Number(x) : Number.NaN, y: y ? Number(y) : Number.NaN }
        }).filter((point) => Number.isFinite(point.frame) && Number.isFinite(point.x) && Number.isFinite(point.y)).sort((left, right) => left.frame - right.frame)
        if (!points.length) return { x: (width ?? 0) / 2 + (transform?.positionX ?? 0), y: (height ?? 0) / 2 + (transform?.positionY ?? 0) }
        const nextIndex = points.findIndex((point) => point.frame >= at)
        if (nextIndex < 0) return points[points.length - 1]
        if (nextIndex === 0) return points[0]
        const previous = points[nextIndex - 1]
        const next = points[nextIndex]
        const progress = (at - previous.frame) / Math.max(1, next.frame - previous.frame)
        return { x: previous.x + (next.x - previous.x) * progress, y: previous.y + (next.y - previous.y) * progress }
      }
      const transformFrames = motionParameters ? [...new Set(Object.values(motionParameters).flatMap((value) => parameterKeyframes(value).map(keyframeFrame)).filter(Number.isFinite))].sort((left, right) => left - right) : []
      const keyframes: TimelineClip['keyframes'] = transform && motionParameters ? transformFrames.map((at) => {
        const center = centerAt(at)
        const interpolationSource = Object.values(motionParameters).map((value) => keyframeAt(value, at)).find(Boolean)
        const interpolation = directText(interpolationSource, 'interp').toLocaleLowerCase()
        const easing: NonNullable<TimelineClip['keyframes']>[number]['easing'] = interpolation.includes('hold') ? 'hold' : interpolation.includes('easeinout') || interpolation.includes('bezier') ? 'ease-in-out' : interpolation.includes('easein') ? 'ease-in' : interpolation.includes('easeout') ? 'ease-out' : 'linear'
        const spatialIn = scalarAt(motionParameters.spatialInEnabled, at, 0) >= 0.5 ? { x: scalarAt(motionParameters.spatialInX, at, 0), y: scalarAt(motionParameters.spatialInY, at, 0) } : undefined
        const spatialOut = scalarAt(motionParameters.spatialOutEnabled, at, 0) >= 0.5 ? { x: scalarAt(motionParameters.spatialOutX, at, 0), y: scalarAt(motionParameters.spatialOutY, at, 0) } : undefined
        return { id: crypto.randomUUID(), time: Math.max(0, at / fps), easing, spatialIn, spatialOut, transform: { positionX: center.x - (width ?? 0) / 2, positionY: center.y - (height ?? 0) / 2, scale: scalarAt(motionParameters.scale, at, transform.scale), scaleX: scalarAt(motionParameters.scaleX, at, transform.scaleX ?? 100), scaleY: scalarAt(motionParameters.scaleY, at, transform.scaleY ?? 100), anchorX: scalarAt(motionParameters.anchorX, at, transform.anchorX ?? 50), anchorY: scalarAt(motionParameters.anchorY, at, transform.anchorY ?? 50), skewX: scalarAt(motionParameters.skewX, at, transform.skewX ?? 0), skewY: scalarAt(motionParameters.skewY, at, transform.skewY ?? 0), rotation: scalarAt(motionParameters.rotation, at, transform.rotation), opacity: Math.max(0, Math.min(100, scalarAt(motionParameters.opacity, at, transform.opacity))) } }
      }) : undefined
      trackClips.push({ id: crypto.randomUUID(), name, mediaName: file?.name ?? name, kind, lane, start: startFrames / fps, duration: Math.max(1 / fps, (endFrames - startFrames) / fps), sourceOffset: Math.max(0, inFrames / fps), playbackRate, reverse: speed < 0, transform, keyframes: keyframes?.length ? keyframes : undefined, motionPathAutoOrient, motionPathOrientationOffset, motionBlur, audioAdjustment })
    }
    for (const transition of track.querySelectorAll(':scope > transitionitem')) {
      const start = Number(directText(transition, 'start')) / fps
      const end = Number(directText(transition, 'end')) / fps
      const duration = Math.max(1 / fps, end - start)
      const effectName = `${directText(transition, 'effectid')} ${directText(transition, 'name')}`.toLocaleLowerCase()
      const type: NonNullable<TimelineClip['transitionIn']>['type'] = effectName.includes('wipe right') ? 'wipe-right' : effectName.includes('wipe up') ? 'wipe-up' : effectName.includes('wipe down') ? 'wipe-down' : effectName.includes('wipe') ? 'wipe-left' : effectName.includes('dip to white') ? 'dip-white' : effectName.includes('dip') ? 'dip-black' : effectName.includes('blur') ? 'blur-dissolve' : effectName.includes('slide right') ? 'slide-right' : effectName.includes('slide') ? 'slide-left' : effectName.includes('zoom') ? 'zoom' : 'crossfade'
      const parameterValue = (id: string) => [...transition.querySelectorAll('effect > parameter')].find((parameter) => directText(parameter, 'parameterid') === id)?.querySelector(':scope > value')?.textContent?.trim()
      const rawAlignment = parameterValue('editweave-transition-alignment') || directText(transition, 'alignment').toLocaleLowerCase()
      const alignment: NonNullable<TimelineClip['transitionIn']>['alignment'] = rawAlignment.includes('start') ? 'start-at-cut' : rawAlignment.includes('end') ? 'end-at-cut' : 'center-on-cut'
      const rawEasing = parameterValue('editweave-transition-easing')
      const easing = rawEasing && ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'bezier'].includes(rawEasing) ? rawEasing as NonNullable<TimelineClip['transitionIn']>['easing'] : undefined
      const audioCurveValue = parameterValue('editweave-transition-audio-curve')
      const audioCurve = audioCurveValue && ['linear', 'equal-power', 'logarithmic'].includes(audioCurveValue) ? audioCurveValue as NonNullable<TimelineClip['transitionIn']>['audioCurve'] : undefined
      const curveValues = ['x1', 'y1', 'x2', 'y2'].map((axis) => Number(parameterValue(`editweave-transition-${axis}`)))
      const curve = curveValues.every(Number.isFinite) ? { x1: curveValues[0], y1: curveValues[1], x2: curveValues[2], y2: curveValues[3] } : undefined
      const cutTime = alignment === 'start-at-cut' ? start : alignment === 'end-at-cut' ? end : (start + end) / 2
      const next = trackClips.filter((clip) => Math.abs(clip.start - cutTime) <= Math.max(2 / fps, duration)).sort((left, right) => Math.abs(left.start - cutTime) - Math.abs(right.start - cutTime))[0]
      if (next) next.transitionIn = { type, duration, alignment, easing, audioCurve, curve }
    }
    clips.push(...trackClips)
  }
  ;[...sequence.querySelectorAll(':scope > media > video > track')].forEach((track, index) => parseTrack(track, 'video', index))
  ;[...sequence.querySelectorAll(':scope > media > audio > track')].forEach((track, index) => parseTrack(track, 'audio', index))
  if (!clips.length) throw new Error('Premiere Pro XML에서 지원되는 클립을 찾지 못했습니다.')
  const markers = [...sequence.querySelectorAll(':scope > marker')].flatMap((marker): TimelineMarker[] => {
    const frame = Number(directText(marker, 'in'))
    if (!Number.isFinite(frame)) return []
    const out = Number(directText(marker, 'out'))
    return [{ id: crypto.randomUUID(), time: Math.max(0, frame / fps), duration: Number.isFinite(out) && out > frame ? (out - frame) / fps : undefined, label: directText(marker, 'name') || 'Marker', description: directText(marker, 'comment') || undefined, color: '#8169e8', kind: 'edit' }]
  })
  return { name: directText(sequence, 'name') || '가져온 Premiere Pro XML', fps, width, height, timecodeStart: sequenceTimecode?.seconds, timecodeDropFrame: sequenceTimecode?.dropFrame, transitionDefaults, clips, markers }
}

function directText(element: Element | null | undefined, tagName: string): string {
  if (!element) return ''
  return [...element.children].find((child) => child.localName.toLocaleLowerCase() === tagName.toLocaleLowerCase())?.textContent?.trim() ?? ''
}

function parseTransitionDefaultsMetadata(value: string | null | undefined): SequenceTransitionDefaults | undefined {
  if (!value?.trim()) return undefined
  try {
    const parsed = JSON.parse(value) as Partial<SequenceTransitionDefaults>
    return normalizeSequenceTransitionDefaults(parsed)
  } catch {
    return undefined
  }
}

export function parseEdl(contents: string, fps = 30): ImportedTimeline {
  const lines = contents.split(/\r?\n/)
  const name = lines.find((line) => /^TITLE:/i.test(line))?.replace(/^TITLE:\s*/i, '').trim() || '가져온 EDL'
  const dropFrame = lines.some((line) => /^FCM:\s*DROP FRAME/i.test(line))
  const timelineFps = dropFrame && Math.abs(fps - 30) < 1 ? 30_000 / 1_001 : dropFrame && Math.abs(fps - 60) < 1 ? 60_000 / 1_001 : fps
  const transitionDefaults = parseTransitionDefaultsMetadata(lines.find((line) => /^\*\s*EDITWEAVE TRANSITION DEFAULTS:/i.test(line))?.replace(/^\*\s*EDITWEAVE TRANSITION DEFAULTS:\s*/i, ''))
  const clips: ImportedTimelineClip[] = []
  let current: ImportedTimelineClip | undefined
  for (const line of lines) {
    const event = line.match(/^\s*(\d+)\s+(\S+)\s+([VA]+)\s+(\S+)(?:\s+(\d+))?\s+(\d{2}:\d{2}:\d{2}[:;]\d{2})\s+(\d{2}:\d{2}:\d{2}[:;]\d{2})\s+(\d{2}:\d{2}:\d{2}[:;]\d{2})\s+(\d{2}:\d{2}:\d{2}[:;]\d{2})/i)
    if (event) {
      const sourceIn = fromTimecode(event[6], timelineFps, dropFrame)
      const sourceOut = fromTimecode(event[7], timelineFps, dropFrame)
      const recordIn = fromTimecode(event[8], timelineFps, dropFrame)
      const recordOut = fromTimecode(event[9], timelineFps, dropFrame)
      const reel = event[2]
      const channel = event[3].toUpperCase()
      const transitionCode = event[4].toUpperCase()
      const transitionFrames = Number(event[5]) || 0
      const transitionIn: TimelineClip['transitionIn'] | undefined = transitionCode.startsWith('D')
        ? { type: 'crossfade', duration: transitionFrames / timelineFps, alignment: 'center-on-cut' }
        : transitionCode.startsWith('W') ? { type: 'wipe-left', duration: transitionFrames / timelineFps, alignment: 'center-on-cut' } : undefined
      const groupId = crypto.randomUUID()
      const kinds: Array<'video' | 'audio'> = channel.includes('V') ? ['video'] : []
      if (channel.includes('A')) kinds.push('audio')
      if (!kinds.length) kinds.push('video')
      for (const kind of kinds) {
        const clip: ImportedTimelineClip = { id: crypto.randomUUID(), name: reel, mediaName: reel, reel, kind, lane: 0, start: recordIn, duration: Math.max(1 / timelineFps, recordOut - recordIn), sourceOffset: Math.min(sourceIn, sourceOut), playbackRate: Math.max(1 / 1000, Math.abs(sourceOut - sourceIn) / Math.max(1 / timelineFps, recordOut - recordIn)), reverse: sourceOut < sourceIn, transitionIn }
        clips.push(clip)
        current = clip
        if (kinds.length > 1) clip.id = `${groupId}-${kind}`
      }
      continue
    }
    const clipName = line.match(/^\*\s*FROM CLIP NAME:\s*(.+)$/i)?.[1]?.trim()
    if (clipName && current) {
      const siblings = clips.filter((clip) => clip.start === current!.start && clip.reel === current!.reel && clip.name === current!.name)
      siblings.forEach((clip) => { clip.name = clipName; clip.mediaName = clipName })
      continue
    }
    const transitionMetadata = line.match(/^\*\s*EDITWEAVE TRANSITION:\s*alignment=([^;]+);\s*easing=([^;]+);\s*audio=([^;]+)(?:;\s*curve=([^;]+))?/i)
    if (transitionMetadata && current?.transitionIn) {
      const alignmentValue = transitionMetadata[1].trim()
      const easingValue = transitionMetadata[2].trim()
      const audioValue = transitionMetadata[3].trim()
      const curveValues = transitionMetadata[4]?.split(',').map(Number)
      const patch: NonNullable<TimelineClip['transitionIn']> = {
        ...current.transitionIn,
        alignment: ['start-at-cut', 'center-on-cut', 'end-at-cut'].includes(alignmentValue) ? alignmentValue as NonNullable<TimelineClip['transitionIn']>['alignment'] : 'center-on-cut',
        easing: ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'bezier'].includes(easingValue) ? easingValue as NonNullable<TimelineClip['transitionIn']>['easing'] : undefined,
        audioCurve: ['linear', 'equal-power', 'logarithmic'].includes(audioValue) ? audioValue as NonNullable<TimelineClip['transitionIn']>['audioCurve'] : undefined,
        curve: curveValues?.length === 4 && curveValues.every(Number.isFinite) ? { x1: curveValues[0], y1: curveValues[1], x2: curveValues[2], y2: curveValues[3] } : undefined,
      }
      clips.filter((clip) => clip.start === current!.start && clip.reel === current!.reel).forEach((clip) => { if (clip.transitionIn) clip.transitionIn = { ...patch } })
      continue
    }
    const audioFadeMetadata = line.match(/^\*\s*EDITWEAVE AUDIO FADE:\s*in=([\d.]+);\s*out=([\d.]+);\s*inCurve=([^;]+);\s*outCurve=([^;]+)/i)
    if (audioFadeMetadata && current) {
      const duration = current.duration
      const curve = (value: string): NonNullable<NonNullable<TimelineClip['audioAdjustment']>['fadeInCurve']> => ['linear', 'equal-power', 'logarithmic'].includes(value.trim()) ? value.trim() as NonNullable<NonNullable<TimelineClip['audioAdjustment']>['fadeInCurve']> : 'linear'
      const adjustment = {
        ...defaultAudioAdjustment(),
        fadeIn: Math.max(0, Math.min(duration, Number(audioFadeMetadata[1]) || 0)),
        fadeOut: Math.max(0, Math.min(duration, Number(audioFadeMetadata[2]) || 0)),
        fadeInCurve: curve(audioFadeMetadata[3]),
        fadeOutCurve: curve(audioFadeMetadata[4]),
      }
      clips.filter((clip) => clip.start === current!.start && clip.reel === current!.reel).forEach((clip) => { clip.audioAdjustment = { ...adjustment } })
      continue
    }
    const motion = line.match(/^M2\s+\S+\s+(-?[\d.]+)/i)
    if (motion && current) {
      const rate = Number(motion[1]) / 100
      const siblings = clips.filter((clip) => clip.start === current!.start && clip.reel === current!.reel)
      siblings.forEach((clip) => { clip.playbackRate = Math.max(1 / 1000, Math.abs(rate)); clip.reverse = rate < 0 })
    }
  }
  if (!clips.length) throw new Error('EDL에서 편집 이벤트를 찾지 못했습니다.')
  const timecodeStart = Math.min(...clips.map((clip) => clip.start))
  clips.forEach((clip) => { clip.start = Math.max(0, clip.start - timecodeStart) })
  return { name, fps: timelineFps, timecodeStart, timecodeDropFrame: dropFrame, transitionDefaults, clips, markers: [] }
}

export function parseFcpxml(contents: string, fallbackFps = 30): ImportedTimeline {
  const document = new DOMParser().parseFromString(contents, 'application/xml')
  const parseError = document.querySelector('parsererror')
  if (parseError) throw new Error('FCPXML 문법이 올바르지 않습니다.')
  const sequence = document.querySelector('sequence')
  if (!sequence) throw new Error('FCPXML에 시퀀스가 없습니다.')
  const project = sequence.closest('project')
  const formatRef = sequence.getAttribute('format')
  const format = formatRef ? document.querySelector(`format[id="${cssAttribute(formatRef)}"]`) : undefined
  const frameDuration = format?.getAttribute('frameDuration')
  const fps = frameDuration ? Math.max(1, Math.min(240, 1 / parseRationalSeconds(frameDuration, 1 / fallbackFps))) : fallbackFps
  const width = Number(format?.getAttribute('width')) || undefined
  const height = Number(format?.getAttribute('height')) || undefined
  const timecodeStart = parseRationalSeconds(sequence.getAttribute('tcStart') ?? '0s', 0)
  const timecodeDropFrame = sequence.getAttribute('tcFormat') === 'DF'
  const sequenceTransitionDefaults = parseTransitionDefaultsMetadata([...sequence.querySelectorAll(':scope > metadata > md')].find((item) => item.getAttribute('key') === 'com.editweave.transition-defaults')?.getAttribute('value'))
  const assets = new Map([...document.querySelectorAll('resources > asset')].map((asset) => {
    const source = asset.querySelector('media-rep')?.getAttribute('src')
    const sourceName = source ? decodeMediaSourceName(source) : undefined
    return [asset.getAttribute('id') ?? '', { name: asset.getAttribute('name') || sourceName || 'Offline Media', hasVideo: asset.getAttribute('hasVideo') !== '0', hasAudio: asset.getAttribute('hasAudio') === '1' }]
  }))
  const clips: ImportedTimelineClip[] = []
  const clipElements = [...document.querySelectorAll('spine asset-clip, spine ref-clip, spine audio')]
    .filter((element) => element.localName !== 'audio' || !element.parentElement?.closest('asset-clip, ref-clip'))
  for (const element of clipElements) {
    const ref = element.getAttribute('ref') ?? ''
    const resource = assets.get(ref)
    const name = element.getAttribute('name') || resource?.name || ref || 'Offline Media'
    const start = parseRationalSeconds(element.getAttribute('offset') ?? '0s', 0)
    const duration = Math.max(1 / fps, parseRationalSeconds(element.getAttribute('duration') ?? `${1 / fps}s`, 1 / fps))
    const sourceOffset = parseRationalSeconds(element.getAttribute('start') ?? '0s', 0)
    const lane = Number(element.getAttribute('lane')) || 0
    const timePoints = [...element.querySelectorAll(':scope > timeMap > timept')].map((point) => ({ time: parseRationalSeconds(point.getAttribute('time') ?? '0s', 0), value: parseRationalSeconds(point.getAttribute('value') ?? '0s', 0) })).sort((left, right) => left.time - right.time)
    const sourceDelta = timePoints.length > 1 ? timePoints[timePoints.length - 1].value - timePoints[0].value : duration
    const transformElement = element.querySelector(':scope > adjust-transform')
    const position = (transformElement?.getAttribute('position') ?? '0 0').split(/\s+/).map(Number)
    const scale = (transformElement?.getAttribute('scale') ?? '1 1').split(/\s+/).map(Number)
    const importedScaleX = Number.isFinite(scale[0]) && Math.abs(scale[0]) >= 0.0001 ? scale[0] * 100 : 100
    const importedScaleY = Number.isFinite(scale[1]) && Math.abs(scale[1]) >= 0.0001 ? scale[1] * 100 : importedScaleX
    const opacity = Number(element.querySelector(':scope > adjust-blend')?.getAttribute('amount') ?? 1)
    const metadataValue = (key: string) => [...element.querySelectorAll(':scope > metadata > md')].find((item) => item.getAttribute('key') === key)?.getAttribute('value')?.trim()
    const fadeInMetadata = Number(metadataValue('com.editweave.audio.fade-in'))
    const fadeOutMetadata = Number(metadataValue('com.editweave.audio.fade-out'))
    const hasAudioFadeMetadata = Number.isFinite(fadeInMetadata) || Number.isFinite(fadeOutMetadata)
    const audioFadeCurve = (value: string | undefined): NonNullable<NonNullable<TimelineClip['audioAdjustment']>['fadeInCurve']> => value && ['linear', 'equal-power', 'logarithmic'].includes(value) ? value as NonNullable<NonNullable<TimelineClip['audioAdjustment']>['fadeInCurve']> : 'linear'
    const audioAdjustment: TimelineClip['audioAdjustment'] = hasAudioFadeMetadata ? {
      ...defaultAudioAdjustment(),
      fadeIn: Math.max(0, Math.min(duration, Number.isFinite(fadeInMetadata) ? fadeInMetadata : 0)),
      fadeOut: Math.max(0, Math.min(duration, Number.isFinite(fadeOutMetadata) ? fadeOutMetadata : 0)),
      fadeInCurve: audioFadeCurve(metadataValue('com.editweave.audio.fade-in-curve')),
      fadeOutCurve: audioFadeCurve(metadataValue('com.editweave.audio.fade-out-curve')),
    } : undefined
    const kinds: Array<'video' | 'audio'> = element.localName === 'audio' || resource?.hasVideo === false ? ['audio'] : ['video']
    if (element.localName !== 'audio' && resource?.hasAudio) kinds.push('audio')
    const linkedBase = crypto.randomUUID()
    kinds.forEach((kind) => clips.push({ id: `${linkedBase}-${kind}`, name, mediaName: resource?.name ?? name, kind, lane, start, duration, sourceOffset: timePoints[0]?.value ?? sourceOffset, playbackRate: Math.max(1 / 1000, Math.abs(sourceDelta) / duration), reverse: sourceDelta < 0, transform: { positionX: position[0] || 0, positionY: -(position[1] || 0), scale: 100, scaleX: importedScaleX, scaleY: importedScaleY, anchorX: 50, anchorY: 50, skewX: Number(transformElement?.getAttribute('editweave-skew-x')) || 0, skewY: Number(transformElement?.getAttribute('editweave-skew-y')) || 0, rotation: Number(transformElement?.getAttribute('rotation')) || 0, opacity: Math.max(0, Math.min(100, opacity * 100)) }, audioAdjustment: structuredClone(audioAdjustment) }))
  }
  for (const transition of sequence.querySelectorAll('spine transition')) {
    const offset = parseRationalSeconds(transition.getAttribute('offset') ?? '0s', 0)
    const duration = Math.max(1 / fps, parseRationalSeconds(transition.getAttribute('duration') ?? `${1 / fps}s`, 1 / fps))
    const transitionMetadata = (key: string) => [...transition.querySelectorAll(':scope > metadata > md')].find((item) => item.getAttribute('key') === key)?.getAttribute('value')?.trim()
    const effectName = `${transition.getAttribute('name') ?? ''} ${transition.querySelector('filter-video, filter-audio')?.getAttribute('name') ?? ''}`.toLocaleLowerCase()
    const metadataType = transitionMetadata('com.editweave.transition.type')
    const inferredType: NonNullable<TimelineClip['transitionIn']>['type'] = effectName.includes('wipe right') ? 'wipe-right' : effectName.includes('wipe up') ? 'wipe-up' : effectName.includes('wipe down') ? 'wipe-down' : effectName.includes('wipe') ? 'wipe-left' : effectName.includes('dip to white') ? 'dip-white' : effectName.includes('dip') ? 'dip-black' : effectName.includes('blur') ? 'blur-dissolve' : effectName.includes('slide right') ? 'slide-right' : effectName.includes('slide') ? 'slide-left' : effectName.includes('zoom') ? 'zoom' : 'crossfade'
    const type = metadataType && ['crossfade', 'dip-black', 'dip-white', 'blur-dissolve', 'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'slide-left', 'slide-right', 'zoom'].includes(metadataType) ? metadataType as NonNullable<TimelineClip['transitionIn']>['type'] : inferredType
    const alignmentValue = transitionMetadata('com.editweave.transition.alignment')
    const alignment: NonNullable<TimelineClip['transitionIn']>['alignment'] = alignmentValue && ['start-at-cut', 'center-on-cut', 'end-at-cut'].includes(alignmentValue) ? alignmentValue as NonNullable<TimelineClip['transitionIn']>['alignment'] : 'center-on-cut'
    const easingValue = transitionMetadata('com.editweave.transition.easing')
    const easing = easingValue && ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'bezier'].includes(easingValue) ? easingValue as NonNullable<TimelineClip['transitionIn']>['easing'] : undefined
    const audioCurveValue = transitionMetadata('com.editweave.transition.audio-curve')
    const audioCurve = audioCurveValue && ['linear', 'equal-power', 'logarithmic'].includes(audioCurveValue) ? audioCurveValue as NonNullable<TimelineClip['transitionIn']>['audioCurve'] : undefined
    const curveValues = ['x1', 'y1', 'x2', 'y2'].map((axis) => Number(transitionMetadata(`com.editweave.transition.${axis}`)))
    const curve = curveValues.every(Number.isFinite) ? { x1: curveValues[0], y1: curveValues[1], x2: curveValues[2], y2: curveValues[3] } : undefined
    const nextStart = offset + duration
    clips.filter((clip) => Math.abs(clip.start - nextStart) <= 2 / fps).forEach((clip) => { clip.transitionIn = { type, duration, alignment, easing, audioCurve, curve } })
  }
  if (!clips.length) throw new Error('FCPXML 시퀀스에서 지원되는 클립을 찾지 못했습니다.')
  const markers = [...sequence.querySelectorAll('marker, chapter-marker')].map((marker): TimelineMarker => {
    const owner = marker.parentElement?.closest('asset-clip, ref-clip')
    const ownerOffset = owner ? parseRationalSeconds(owner.getAttribute('offset') ?? '0s', 0) : 0
    const ownerSourceStart = owner ? parseRationalSeconds(owner.getAttribute('start') ?? '0s', 0) : 0
    const markerStart = parseRationalSeconds(marker.getAttribute('start') ?? '0s', 0)
    return { id: crypto.randomUUID(), time: Math.max(0, ownerOffset + markerStart - ownerSourceStart), duration: parseRationalSeconds(marker.getAttribute('duration') ?? '0s', 0) || undefined, label: marker.getAttribute('value') || marker.getAttribute('name') || 'Marker', description: marker.getAttribute('note') || undefined, color: marker.localName === 'chapter-marker' ? '#e0a04b' : '#8169e8', kind: marker.localName === 'chapter-marker' ? 'chapter' : 'edit' }
  })
  return { name: project?.getAttribute('name') || '가져온 FCPXML', fps, width, height, timecodeStart, timecodeDropFrame, transitionDefaults: sequenceTransitionDefaults, clips, markers }
}

function parseRationalSeconds(value: string, fallback: number): number {
  const normalized = value.trim().replace(/s$/, '')
  const fraction = normalized.match(/^(-?[\d.]+)\/([\d.]+)$/)
  if (fraction) return Number(fraction[1]) / Math.max(1e-12, Number(fraction[2]))
  const seconds = Number(normalized)
  return Number.isFinite(seconds) ? seconds : fallback
}

function decodeMediaSourceName(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value.replace(/^file:\/\//i, ''))
    return decoded.split(/[\\/]/).pop() || undefined
  } catch {
    return value.split(/[\\/]/).pop() || undefined
  }
}

function fromTimecode(value: string, fps: number, dropFrame = value.includes(';')): number {
  const parts = value.split(/[:;]/).map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return 0
  const nominalFps = Math.round(fps)
  const totalMinutes = parts[0] * 60 + parts[1]
  const droppedFrames = dropFrame && (nominalFps === 30 || nominalFps === 60) ? Math.round(nominalFps * 0.066666) * (totalMinutes - Math.floor(totalMinutes / 10)) : 0
  const frameNumber = ((parts[0] * 3600 + parts[1] * 60 + parts[2]) * nominalFps + parts[3]) - droppedFrames
  return frameNumber / fps
}

function cssAttribute(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}

export function createEdl(projectName: string, tracks: TimelineTrack[], assets: MediaAsset[], fps = 30, timecodeStart = 0, dropFrame = false, transitionDefaults?: SequenceTransitionDefaults): string {
  const clips = tracks.filter((track) => (track.kind === 'video' || track.kind === 'audio') && !track.muted).flatMap((track) => track.clips)
    .filter((clip) => clip.assetId)
    .sort((a, b) => a.start - b.start)
  const lines = [`TITLE: ${projectName}`, `FCM: ${dropFrame ? 'DROP FRAME' : 'NON-DROP FRAME'}`, `* EDITWEAVE TRANSITION DEFAULTS: ${JSON.stringify(normalizeSequenceTransitionDefaults(transitionDefaults))}`, '']
  clips.forEach((clip, index) => {
    const asset = assets.find((item) => item.id === clip.assetId)
    const reel = sanitizeReel(asset?.name ?? clip.name)
    const sourceA = clipSourceTime(clip, clip.start)
    const sourceB = clipSourceTime(clip, clip.start + clip.duration)
    const sourceTimecodeStart = asset?.timecodeStart ?? 0
    const sourceIn = formatMediaTimecode(sourceTimecodeStart + Math.min(sourceA, sourceB), fps, Boolean(asset?.timecodeDropFrame))
    const sourceOut = formatMediaTimecode(sourceTimecodeStart + Math.max(sourceA, sourceB), fps, Boolean(asset?.timecodeDropFrame))
    const recordIn = formatMediaTimecode(timecodeStart + clip.start, fps, dropFrame)
    const recordOut = formatMediaTimecode(timecodeStart + clip.start + clip.duration, fps, dropFrame)
    const transitionType = clip.transitionIn?.type === 'crossfade' || clip.transitionIn?.type === 'blur-dissolve' ? 'D' : clip.transitionIn?.type?.startsWith('wipe-') ? 'W001' : 'C'
    const transitionDuration = transitionType === 'C' ? '' : ` ${Math.max(1, Math.round((clip.transitionIn?.duration ?? 0) * fps)).toString().padStart(3, '0')}`
    lines.push(`${String(index + 1).padStart(3, '0')}  ${reel.padEnd(8, ' ')} ${clip.kind === 'audio' ? 'A' : 'V'}     ${transitionType.padEnd(4, ' ')}${transitionDuration.padEnd(5, ' ')} ${sourceIn} ${sourceOut} ${recordIn} ${recordOut}`)
    lines.push(`* FROM CLIP NAME: ${asset?.name ?? clip.name}`)
    if (clip.transitionIn && clip.transitionIn.type !== 'none') lines.push(`* EDITWEAVE TRANSITION: alignment=${clip.transitionIn.alignment ?? 'center-on-cut'}; easing=${clip.transitionIn.easing ?? 'ease-in-out'}; audio=${clip.transitionIn.audioCurve ?? 'equal-power'}${clip.transitionIn.curve ? `; curve=${clip.transitionIn.curve.x1},${clip.transitionIn.curve.y1},${clip.transitionIn.curve.x2},${clip.transitionIn.curve.y2}` : ''}`)
    if ((clip.audioAdjustment?.fadeIn ?? 0) > 0 || (clip.audioAdjustment?.fadeOut ?? 0) > 0) lines.push(`* EDITWEAVE AUDIO FADE: in=${clip.audioAdjustment?.fadeIn ?? 0}; out=${clip.audioAdjustment?.fadeOut ?? 0}; inCurve=${clip.audioAdjustment?.fadeInCurve ?? 'linear'}; outCurve=${clip.audioAdjustment?.fadeOutCurve ?? 'linear'}`)
    if (!clip.speedKeyframes?.length && clip.playbackRate && clip.playbackRate !== 1) lines.push(`M2  ${reel.padEnd(8, ' ')} ${(clip.playbackRate * 100).toFixed(3)} ${sourceIn}`)
    if (clip.speedKeyframes?.length) lines.push(`* EDITWEAVE SPEED RAMP: ${clip.speedKeyframes.map((keyframe) => `${keyframe.time.toFixed(3)}s=${(keyframe.rate * 100).toFixed(1)}%`).join(', ')}`)
    lines.push('')
  })
  return lines.join('\n')
}

export function createFcpxml(projectName: string, preset: SequencePreset, tracks: TimelineTrack[], assets: MediaAsset[], fps = 30, timecodeStart = 0, dropFrame = false, transitionDefaults?: SequenceTransitionDefaults): string {
  const timelineClips = tracks.filter((track) => (track.kind === 'video' || track.kind === 'audio') && !track.muted).flatMap((track, lane) => track.clips.map((clip) => ({ clip, lane: track.kind === 'audio' ? -(lane + 1) : lane })))
    .filter(({ clip }) => clip.assetId)
    .sort((a, b) => a.clip.start - b.clip.start)
  const duration = Math.max(1, ...timelineClips.map(({ clip }) => clip.start + clip.duration))
  const assetIds = [...new Set(timelineClips.map(({ clip }) => clip.assetId!))]
  const resources = assetIds.map((id, index) => {
    const asset = assets.find((item) => item.id === id)
    const mediaRep = asset?.sourcePath ? `<media-rep kind="original-media" src="${escapeXml(toPremierePathUrl(asset.sourcePath))}"/>` : ''
    return `    <asset id="r${index + 2}" name="${escapeXml(asset?.name ?? id)}" start="0s" duration="${seconds(asset?.duration ?? duration, fps)}" hasVideo="${asset?.kind === 'audio' ? '0' : '1'}" hasAudio="${asset?.kind === 'image' ? '0' : '1'}">${mediaRep}</asset>`
  }).join('\n')
  const spine = timelineClips.map(({ clip, lane }) => {
    const ref = `r${assetIds.indexOf(clip.assetId!) + 2}`
    const transform = clip.transform
    const timePoints = clip.speedKeyframes?.length || clip.reverse
      ? [0, ...(clip.speedKeyframes ?? []).map((keyframe) => keyframe.time), clip.duration]
        .filter((time, index, values) => time >= 0 && time <= clip.duration && values.indexOf(time) === index)
        .sort((a, b) => a - b)
        .map((time) => `<timept time="${seconds(time, fps)}" value="${seconds(clipSourceTime(clip, clip.start + time), fps)}" interp="smooth2"/>`).join('')
      : ''
    const timeMap = timePoints ? `<timeMap>${timePoints}</timeMap>` : ''
    const scaleX = transform.scale / 100 * (transform.scaleX ?? 100) / 100
    const scaleY = transform.scale / 100 * (transform.scaleY ?? 100) / 100
    const audioFadeMetadata = (clip.audioAdjustment?.fadeIn ?? 0) > 0 || (clip.audioAdjustment?.fadeOut ?? 0) > 0 ? `<metadata><md key="com.editweave.audio.fade-in" value="${clip.audioAdjustment?.fadeIn ?? 0}"/><md key="com.editweave.audio.fade-out" value="${clip.audioAdjustment?.fadeOut ?? 0}"/><md key="com.editweave.audio.fade-in-curve" value="${escapeXml(clip.audioAdjustment?.fadeInCurve ?? 'linear')}"/><md key="com.editweave.audio.fade-out-curve" value="${escapeXml(clip.audioAdjustment?.fadeOutCurve ?? 'linear')}"/></metadata>` : ''
    const transition = clip.transitionIn
    const transitionXml = transition && transition.type !== 'none' && transition.duration > 0 ? (() => {
      const name = transition.type === 'crossfade' ? clip.kind === 'audio' ? 'Cross Fade (+3dB)' : 'Cross Dissolve' : transition.type === 'dip-black' ? 'Dip to Black' : transition.type === 'dip-white' ? 'Dip to White' : transition.type === 'blur-dissolve' ? 'Blur Dissolve' : transition.type === 'wipe-right' ? 'Wipe Right' : transition.type === 'wipe-up' ? 'Wipe Up' : transition.type === 'wipe-down' ? 'Wipe Down' : transition.type === 'wipe-left' ? 'Wipe Left' : transition.type === 'slide-right' ? 'Slide Right' : transition.type === 'slide-left' ? 'Slide Left' : 'Zoom'
      const curve = transition.curve
      const metadata = `<metadata><md key="com.editweave.transition.type" value="${transition.type}"/><md key="com.editweave.transition.alignment" value="${transition.alignment ?? 'center-on-cut'}"/><md key="com.editweave.transition.easing" value="${transition.easing ?? 'ease-in-out'}"/><md key="com.editweave.transition.audio-curve" value="${transition.audioCurve ?? 'equal-power'}"/>${curve ? `<md key="com.editweave.transition.x1" value="${curve.x1}"/><md key="com.editweave.transition.y1" value="${curve.y1}"/><md key="com.editweave.transition.x2" value="${curve.x2}"/><md key="com.editweave.transition.y2" value="${curve.y2}"/>` : ''}</metadata>`
      return `<transition name="${name}" offset="${seconds(Math.max(0, clip.start - transition.duration), fps)}" duration="${seconds(transition.duration, fps)}" lane="${lane}"><filter-${clip.kind === 'audio' ? 'audio' : 'video'} name="${name}"/>${metadata}</transition>`
    })() : ''
    return `          ${transitionXml}<asset-clip name="${escapeXml(clip.name)}" ref="${ref}" offset="${seconds(clip.start, fps)}" start="${seconds(clip.sourceOffset, fps)}" duration="${seconds(clip.duration, fps)}" lane="${lane}">${timeMap}<adjust-transform position="${transform.positionX} ${-transform.positionY}" scale="${scaleX} ${scaleY}" rotation="${transform.rotation}"/><adjust-blend amount="${transform.opacity / 100}"/>${audioFadeMetadata}</asset-clip>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r1" name="EditWeave ${preset.ratio}" frameDuration="1/${fps}s" width="${preset.width}" height="${preset.height}"/>
${resources}
  </resources>
  <library><event name="${escapeXml(projectName)}"><project name="${escapeXml(projectName)}"><sequence format="r1" duration="${seconds(duration, fps)}" tcStart="${seconds(timecodeStart, fps)}" tcFormat="${dropFrame ? 'DF' : 'NDF'}"><metadata><md key="com.editweave.transition-defaults" value="${escapeXml(JSON.stringify(normalizeSequenceTransitionDefaults(transitionDefaults)))}"/></metadata><spine>
${spine}
        </spine></sequence></project></event></library>
</fcpxml>`
}

export function createPremiereXml(projectName: string, preset: SequencePreset, tracks: TimelineTrack[], assets: MediaAsset[], markers: TimelineMarker[] = [], fps = 30, timecodeStart = 0, dropFrame = false, transitionDefaults?: SequenceTransitionDefaults): string {
  const nominalFps = Math.round(fps)
  const ntsc = Math.abs(fps - nominalFps) > 0.001
  const frame = (secondsValue: number) => Math.max(0, Math.round(secondsValue * fps))
  const sequenceDuration = Math.max(1, ...tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)))
  const assetNumber = new Map(assets.map((asset, index) => [asset.id, index + 1]))
  const fileXml = (asset: MediaAsset | undefined, fallbackName: string) => {
    const id = `file-${assetNumber.get(asset?.id ?? '') ?? Math.abs(hashText(fallbackName))}`
    const name = asset?.name ?? fallbackName
    const pathUrl = asset?.sourcePath ? `<pathurl>${escapeXml(toPremierePathUrl(asset.sourcePath))}</pathurl>` : ''
    const mediaKinds = asset?.kind === 'audio' ? '<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></audio>' : `<video><samplecharacteristics><width>${asset?.width ?? preset.width}</width><height>${asset?.height ?? preset.height}</height></samplecharacteristics></video><audio><samplecharacteristics><depth>16</depth><samplerate>${asset?.sampleRate ?? 48000}</samplerate></samplecharacteristics></audio>`
    return `<file id="${id}"><name>${escapeXml(name)}</name>${pathUrl}<duration>${frame(asset?.duration ?? sequenceDuration)}</duration><rate><timebase>${nominalFps}</timebase><ntsc>${ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate><media>${mediaKinds}</media></file>`
  }
  const trackXml = (track: TimelineTrack, kind: 'video' | 'audio') => {
    const orderedClips = track.clips.filter((clip) => clip.kind === kind && clip.assetId).sort((left, right) => left.start - right.start)
    const clips = orderedClips.map((clip) => {
      const asset = assets.find((candidate) => candidate.id === clip.assetId)
      const sourceStart = clipSourceTime(clip, clip.start)
      const sourceEnd = clipSourceTime(clip, clip.start + clip.duration)
      const speed = clip.reverse ? -(clip.playbackRate ?? 1) * 100 : (clip.playbackRate ?? 1) * 100
      const speedFilter = Math.abs(speed - 100) > 0.01 ? `<filter><effect><name>Time Remap</name><effectid>timeremap</effectid><parameter><parameterid>speed</parameterid><value>${speed.toFixed(4)}</value></parameter></effect></filter>` : ''
      const transform = clip.transform
      const motionKeyframes = [...(clip.keyframes ?? [])].sort((left, right) => left.time - right.time)
      const interpolation = (easing: NonNullable<TimelineClip['keyframes']>[number]['easing']) => easing === 'hold' ? 'hold' : easing === 'linear' ? 'linear' : easing === 'ease-in' ? 'easein' : easing === 'ease-out' ? 'easeout' : 'easeinout'
      const scalarKeyframes = (value: (keyframe: NonNullable<TimelineClip['keyframes']>[number]) => number) => motionKeyframes.map((keyframe) => `<keyframe><when>${frame(keyframe.time)}</when><value>${value(keyframe)}</value><interp>${interpolation(keyframe.easing)}</interp></keyframe>`).join('')
      const scalarParameter = (id: string, name: string, base: number, value: (keyframe: NonNullable<TimelineClip['keyframes']>[number]) => number) => `<parameter><parameterid>${id}</parameterid><name>${name}</name><value>${base}</value>${scalarKeyframes(value)}</parameter>`
      const centerKeyframes = motionKeyframes.map((keyframe) => `<keyframe><when>${frame(keyframe.time)}</when><value><horiz>${preset.width / 2 + keyframe.transform.positionX}</horiz><vert>${preset.height / 2 + keyframe.transform.positionY}</vert></value><interp>${interpolation(keyframe.easing)}</interp></keyframe>`).join('')
      const centerParameter = `<parameter><parameterid>center</parameterid><name>Center</name><value><horiz>${preset.width / 2 + transform.positionX}</horiz><vert>${preset.height / 2 + transform.positionY}</vert></value>${centerKeyframes}</parameter>`
      const motionBlurParameters = `<parameter><parameterid>editweave-motion-blur-enabled</parameterid><value>${clip.motionBlur?.enabled ? 1 : 0}</value></parameter><parameter><parameterid>editweave-motion-blur-shutter</parameterid><value>${clip.motionBlur?.shutterAngle ?? 180}</value></parameter><parameter><parameterid>editweave-motion-blur-samples</parameterid><value>${clip.motionBlur?.samples ?? 8}</value></parameter><parameter><parameterid>editweave-motion-path-auto-orient</parameterid><value>${clip.motionPathAutoOrient ? 1 : 0}</value></parameter><parameter><parameterid>editweave-motion-path-orientation-offset</parameterid><value>${clip.motionPathOrientationOffset ?? 0}</value></parameter>`
      const spatialParameters = motionKeyframes.some((keyframe) => keyframe.spatialIn || keyframe.spatialOut) ? `${scalarParameter('editweave-spatial-in-enabled', 'EditWeave Spatial In Enabled', 0, (keyframe) => keyframe.spatialIn ? 1 : 0)}${scalarParameter('editweave-spatial-in-x', 'EditWeave Spatial In X', 0, (keyframe) => keyframe.spatialIn?.x ?? 0)}${scalarParameter('editweave-spatial-in-y', 'EditWeave Spatial In Y', 0, (keyframe) => keyframe.spatialIn?.y ?? 0)}${scalarParameter('editweave-spatial-out-enabled', 'EditWeave Spatial Out Enabled', 0, (keyframe) => keyframe.spatialOut ? 1 : 0)}${scalarParameter('editweave-spatial-out-x', 'EditWeave Spatial Out X', 0, (keyframe) => keyframe.spatialOut?.x ?? 0)}${scalarParameter('editweave-spatial-out-y', 'EditWeave Spatial Out Y', 0, (keyframe) => keyframe.spatialOut?.y ?? 0)}` : ''
      const motionFilter = kind === 'video' ? `<filter><effect><name>Motion</name><effectid>basic</effectid><effectcategory>motion</effectcategory>${centerParameter}${scalarParameter('scale', 'Scale', transform.scale, (keyframe) => keyframe.transform.scale)}${scalarParameter('rotation', 'Rotation', transform.rotation, (keyframe) => keyframe.transform.rotation)}${scalarParameter('editweave-scale-x', 'EditWeave Scale X', transform.scaleX ?? 100, (keyframe) => keyframe.transform.scaleX ?? 100)}${scalarParameter('editweave-scale-y', 'EditWeave Scale Y', transform.scaleY ?? 100, (keyframe) => keyframe.transform.scaleY ?? 100)}${scalarParameter('editweave-anchor-x', 'EditWeave Anchor X', transform.anchorX ?? 50, (keyframe) => keyframe.transform.anchorX ?? 50)}${scalarParameter('editweave-anchor-y', 'EditWeave Anchor Y', transform.anchorY ?? 50, (keyframe) => keyframe.transform.anchorY ?? 50)}${scalarParameter('editweave-skew-x', 'EditWeave Skew X', transform.skewX ?? 0, (keyframe) => keyframe.transform.skewX ?? 0)}${scalarParameter('editweave-skew-y', 'EditWeave Skew Y', transform.skewY ?? 0, (keyframe) => keyframe.transform.skewY ?? 0)}${spatialParameters}${motionBlurParameters}</effect></filter><filter><effect><name>Opacity</name><effectid>opacity</effectid>${scalarParameter('opacity', 'Opacity', transform.opacity, (keyframe) => keyframe.transform.opacity)}</effect></filter>` : ''
      const audioFadeFilter = !clip.audioDisabled && ((clip.audioAdjustment?.fadeIn ?? 0) > 0 || (clip.audioAdjustment?.fadeOut ?? 0) > 0) ? `<filter><effect><name>EditWeave Audio Fade</name><effectid>editweave-audio-fade</effectid><effectcategory>audio</effectcategory><parameter><parameterid>editweave-fade-in</parameterid><value>${clip.audioAdjustment?.fadeIn ?? 0}</value></parameter><parameter><parameterid>editweave-fade-out</parameterid><value>${clip.audioAdjustment?.fadeOut ?? 0}</value></parameter><parameter><parameterid>editweave-fade-in-curve</parameterid><value>${escapeXml(clip.audioAdjustment?.fadeInCurve ?? 'linear')}</value></parameter><parameter><parameterid>editweave-fade-out-curve</parameterid><value>${escapeXml(clip.audioAdjustment?.fadeOutCurve ?? 'linear')}</value></parameter></effect></filter>` : ''
      return `<clipitem id="clipitem-${escapeXml(clip.id)}"><name>${escapeXml(clip.name)}</name><duration>${frame(clip.duration)}</duration><rate><timebase>${nominalFps}</timebase><ntsc>${ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate><start>${frame(clip.start)}</start><end>${frame(clip.start + clip.duration)}</end><in>${frame(Math.min(sourceStart, sourceEnd))}</in><out>${frame(Math.max(sourceStart, sourceEnd))}</out>${fileXml(asset, clip.name)}${speedFilter}${motionFilter}${audioFadeFilter}</clipitem>`
    }).join('')
    const transitions = orderedClips.flatMap((clip) => {
      const transition = clip.transitionIn
      if (!transition || transition.type === 'none' || transition.duration <= 0) return []
      const alignment = transition.alignment ?? 'start-at-cut'
      const before = alignment === 'end-at-cut' ? transition.duration : alignment === 'center-on-cut' ? transition.duration / 2 : 0
      const after = transition.duration - before
      const effectName = kind === 'audio' ? 'Cross Fade (+3dB)' : transition.type === 'crossfade' ? 'Cross Dissolve' : transition.type === 'dip-black' ? 'Dip to Black' : transition.type === 'dip-white' ? 'Dip to White' : transition.type === 'blur-dissolve' ? 'Blur Dissolve' : transition.type === 'wipe-right' ? 'Wipe Right' : transition.type === 'wipe-up' ? 'Wipe Up' : transition.type === 'wipe-down' ? 'Wipe Down' : transition.type === 'wipe-left' ? 'Wipe Left' : transition.type === 'slide-right' ? 'Slide Right' : transition.type === 'slide-left' ? 'Slide Left' : 'Zoom'
      const parameter = (id: string, value: string | number | undefined) => value === undefined ? '' : `<parameter><parameterid>${id}</parameterid><value>${value}</value></parameter>`
      const curve = transition.curve
      const parameters = `${parameter('editweave-transition-alignment', alignment)}${parameter('editweave-transition-easing', transition.easing)}${parameter('editweave-transition-audio-curve', transition.audioCurve)}${parameter('editweave-transition-x1', curve?.x1)}${parameter('editweave-transition-y1', curve?.y1)}${parameter('editweave-transition-x2', curve?.x2)}${parameter('editweave-transition-y2', curve?.y2)}`
      return [`<transitionitem><name>${effectName}</name><duration>${frame(transition.duration)}</duration><rate><timebase>${nominalFps}</timebase><ntsc>${ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate><start>${frame(clip.start - before)}</start><end>${frame(clip.start + after)}</end><alignment>${alignment === 'center-on-cut' ? 'center' : alignment === 'start-at-cut' ? 'start' : 'end'}</alignment><effect><name>${effectName}</name><effectid>${effectName}</effectid><effectcategory>${kind === 'audio' ? 'Audio Crossfade' : 'Dissolve'}</effectcategory><effecttype>transition</effecttype><mediatype>${kind}</mediatype>${parameters}</effect></transitionitem>`]
    }).join('')
    return `<track><name>${escapeXml(track.name)}</name><enabled>${track.muted ? 'FALSE' : 'TRUE'}</enabled><locked>${track.locked ? 'TRUE' : 'FALSE'}</locked>${clips}${transitions}</track>`
  }
  const markerXml = markers.map((marker) => `<marker><name>${escapeXml(marker.label)}</name>${marker.description ? `<comment>${escapeXml(marker.description)}</comment>` : ''}<in>${frame(marker.time)}</in><out>${frame(marker.time + (marker.duration ?? 0))}</out></marker>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5"><sequence id="sequence-1"><name>${escapeXml(projectName)}</name><duration>${frame(sequenceDuration)}</duration><rate><timebase>${nominalFps}</timebase><ntsc>${ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate><timecode><rate><timebase>${nominalFps}</timebase><ntsc>${ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate><string>${formatMediaTimecode(timecodeStart, fps, dropFrame)}</string><displayformat>${dropFrame ? 'DF' : 'NDF'}</displayformat></timecode><metadata><editweave-transition-defaults>${escapeXml(JSON.stringify(normalizeSequenceTransitionDefaults(transitionDefaults)))}</editweave-transition-defaults></metadata><media><video><format><samplecharacteristics><rate><timebase>${nominalFps}</timebase><ntsc>${ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate><width>${preset.width}</width><height>${preset.height}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>${tracks.filter((track) => track.kind === 'video').map((track) => trackXml(track, 'video')).join('')}</video><audio><format><samplecharacteristics><depth>24</depth><samplerate>48000</samplerate></samplecharacteristics></format>${tracks.filter((track) => track.kind === 'audio').map((track) => trackXml(track, 'audio')).join('')}</audio></media>${markerXml}</sequence></xmeml>`
}

export function createOtio(projectName: string, tracks: TimelineTrack[], assets: MediaAsset[], markers: TimelineMarker[] = [], fps = 30, timecodeStart = 0, preset?: SequencePreset, timecodeDropFrame = false, transitionDefaults?: SequenceTransitionDefaults): string {
  const rationalTime = (secondsValue: number) => ({ OTIO_SCHEMA: 'RationalTime.1', value: Math.round(Math.max(0, secondsValue) * fps), rate: fps })
  const timeRange = (start: number, duration: number) => ({ OTIO_SCHEMA: 'TimeRange.1', start_time: rationalTime(start), duration: rationalTime(duration) })
  const children = tracks.map((track) => {
    let cursor = 0
    const items: unknown[] = []
    for (const clip of [...track.clips].sort((left, right) => left.start - right.start)) {
      if (clip.start > cursor + 1 / fps) items.push({ OTIO_SCHEMA: 'Gap.1', name: 'Gap', source_range: timeRange(0, clip.start - cursor), effects: [], markers: [], metadata: {} })
      if (track.kind !== 'caption' && clip.transitionIn && clip.transitionIn.type !== 'none') {
        const alignment = clip.transitionIn.alignment ?? 'start-at-cut'
        const before = alignment === 'end-at-cut' ? clip.transitionIn.duration : alignment === 'center-on-cut' ? clip.transitionIn.duration / 2 : 0
        const after = clip.transitionIn.duration - before
        items.push({ OTIO_SCHEMA: 'Transition.1', name: clip.transitionIn.type, transition_type: 'SMPTE_Dissolve', in_offset: rationalTime(before), out_offset: rationalTime(after), metadata: { editweave: { type: clip.transitionIn.type, alignment, easing: clip.transitionIn.easing, curve: clip.transitionIn.curve, audioCurve: clip.transitionIn.audioCurve } } })
      }
      const asset = assets.find((candidate) => candidate.id === clip.assetId)
      items.push({
        OTIO_SCHEMA: 'Clip.2', name: clip.name, source_range: timeRange(clip.sourceOffset, clip.duration), effects: [], markers: [],
        media_reference: asset ? { OTIO_SCHEMA: 'ExternalReference.1', name: asset.name, target_url: asset.sourcePath ? toPremierePathUrl(asset.sourcePath) : '', available_range: timeRange(0, asset.duration), metadata: { editweave: { assetId: asset.id, reelName: asset.reelName, masterEffectsEnabled: asset.masterEffectsEnabled, masterColorAdjustment: asset.masterColorAdjustment, masterVisualEffects: asset.masterVisualEffects, masterAudioAdjustment: asset.masterAudioAdjustment, sourceRotation: asset.sourceRotation, sourcePixelAspectRatio: asset.sourcePixelAspectRatio, sourceFrameRateOverride: asset.sourceFrameRateOverride, sourceFieldOrder: asset.sourceFieldOrder, sourceColorSpaceOverride: asset.sourceColorSpaceOverride, sourceAlphaMode: asset.sourceAlphaMode, sourceAlphaBackground: asset.sourceAlphaBackground, sourceAudioLayout: asset.sourceAudioLayout, sourceAudioStreamIndex: asset.sourceAudioStreamIndex } } } : { OTIO_SCHEMA: 'MissingReference.1', name: track.kind === 'caption' ? 'EditWeave Caption' : clip.name, metadata: { editweave: {} } },
        metadata: { editweave: {
          playbackRate: clip.playbackRate ?? 1, reverse: Boolean(clip.reverse), transform: clip.transform, color: clip.color,
          groupId: clip.groupId, linkGroupId: clip.linkGroupId, freezeFrame: clip.freezeFrame, freezeFrameSourceTime: clip.freezeFrameSourceTime,
          adjustmentLayer: clip.adjustmentLayer, transitionOut: clip.transitionOut, trackId: track.id,
          enabled: clip.enabled, frameInterpolation: clip.frameInterpolation, speedKeyframes: clip.speedKeyframes, compositePriority: clip.compositePriority,
          effectStack: clip.effectStack, keyframes: clip.keyframes, motionPathAutoOrient: clip.motionPathAutoOrient, motionPathOrientationOffset: clip.motionPathOrientationOffset, motionBlur: clip.motionBlur, stabilization: clip.stabilization, colorAdjustment: clip.colorAdjustment, visualEffects: clip.visualEffects,
          visualKeyframes: clip.visualKeyframes, audioAdjustment: clip.audioAdjustment, audioMixKeyframes: clip.audioMixKeyframes,
          audioDisabled: clip.audioDisabled, nestedSequenceId: clip.nestedSequenceId, multicamAngle: clip.multicamAngle, multicamAudioMode: clip.multicamAudioMode, multicamAudioAngle: clip.multicamAudioAngle, clipMarkers: clip.clipMarkers,
          captionStyle: clip.captionStyle, captionWords: clip.captionWords, captionLanguage: clip.captionLanguage, speaker: clip.speaker,
        } },
      })
      cursor = Math.max(cursor, clip.start + clip.duration)
    }
    return { OTIO_SCHEMA: 'Track.1', name: track.name, kind: track.kind === 'audio' ? 'Audio' : 'Video', source_range: null, effects: [], markers: [], children: items, metadata: { editweave: { trackKind: track.kind, sourceTarget: track.sourceTarget, editTarget: track.editTarget, syncLock: track.syncLock, muted: track.muted, locked: track.locked, visible: track.visible, solo: track.solo, volume: track.volume, pan: track.pan, mixAutomationMode: track.mixAutomationMode, mixKeyframes: track.mixKeyframes, compositePriority: track.compositePriority, multicamAngleIndex: track.multicamAngleIndex, labelColor: track.labelColor, audioRole: track.audioRole, captionLanguage: track.captionLanguage, captionFormat: track.captionFormat, captionStyle: track.captionStyle } } }
  })
  const document = {
    OTIO_SCHEMA: 'Timeline.1', name: projectName, global_start_time: rationalTime(timecodeStart),
    tracks: { OTIO_SCHEMA: 'Stack.1', name: 'tracks', source_range: null, effects: [], markers: [], children, metadata: {} },
    markers: markers.map((marker) => ({ OTIO_SCHEMA: 'Marker.2', name: marker.label, color: 'PURPLE', marked_range: timeRange(marker.time, marker.duration ?? 0), metadata: { comment: marker.description ?? '', editweave: { kind: marker.kind, color: marker.color, status: marker.status } } })),
    metadata: { editweave: { exportedAt: new Date().toISOString(), width: preset?.width, height: preset?.height, timecodeDropFrame, transitionDefaults: normalizeSequenceTransitionDefaults(transitionDefaults) } },
  }
  return JSON.stringify(document, (_key, value) => value === undefined ? undefined : value, 2)
}

function toPremierePathUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return encodeURI(`file://localhost/${normalized.replace(/^\//, '')}`)
}

function hashText(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index++) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  return hash
}

export function createChapterList(projectName: string, markers: TimelineMarker[]): string {
  const chapters = markers.filter((marker) => marker.kind === 'chapter').sort((left, right) => left.time - right.time)
  const entries = chapters.length && chapters[0].time < 1 ? chapters : [{ id: 'chapter-start', time: 0, label: projectName, description: '', color: '#000000', kind: 'chapter' as const }, ...chapters]
  return entries.map((marker) => `${chapterTime(marker.time)} ${marker.label.trim() || '챕터'}`).join('\n')
}

export function createMarkerCsv(markers: TimelineMarker[], fps = 30, timecodeStart = 0, dropFrame = false): string {
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const header = ['Timecode', 'Seconds', 'Duration', 'Type', 'Status', 'Label', 'Description', 'Author'].map(escape).join(',')
  const rows = [...markers].sort((left, right) => left.time - right.time).map((marker) => [
    formatMediaTimecode(timecodeStart + marker.time, fps, dropFrame), marker.time.toFixed(3), (marker.duration ?? 0).toFixed(3), marker.kind, marker.status ?? '', marker.label, marker.description ?? '', marker.author ?? '',
  ].map(escape).join(','))
  return [header, ...rows].join('\n')
}

function chapterTime(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value))
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  return hours > 0 ? [hours, minutes, seconds].map((item) => String(item).padStart(2, '0')).join(':') : `${minutes}:${String(seconds).padStart(2, '0')}`
}

function seconds(value: number, fps: number): string {
  const frames = Math.max(0, Math.round(value * fps))
  return `${frames}/${fps}s`
}


function sanitizeReel(value: string): string {
  return value.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() || 'EDITWEAVE'
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
}
