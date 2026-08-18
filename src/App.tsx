import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { InspectorPanel } from './components/InspectorPanel'
import { ExportDialog, type ExportRequest } from './components/ExportDialog'
import { MediaPanel } from './components/MediaPanel'
import { ProjectHistoryDialog } from './components/ProjectHistoryDialog'
import { ProjectManagerDialog } from './components/ProjectManagerDialog'
import { ScratchDiskDialog } from './components/ScratchDiskDialog'
import { SequenceManagerDialog, type SequenceCreateSettings } from './components/SequenceManagerDialog'
import { ComfyDialog } from './components/ComfyDialog'
import { CreatorPackDialog } from './components/CreatorPackDialog'
import { DerivedSyncDialog } from './components/DerivedSyncDialog'
import { SourceGraphBatchDialog } from './components/SourceGraphBatchDialog'
import { RenderQueueDialog } from './components/RenderQueueDialog'
import { PreviewPanel } from './components/PreviewPanel'
import { ShortsDialog } from './components/ShortsDialog'
import { ShortcutDialog } from './components/ShortcutDialog'
import { TranscriptCutDialog } from './components/TranscriptCutDialog'
import { AudioMixerDialog } from './components/AudioMixerDialog'
import { VoiceoverDialog, type VoiceoverSessionResult } from './components/VoiceoverDialog'
import { ReviewDialog } from './components/ReviewDialog'
import { SceneDetectionDialog, type SceneReviewPoint } from './components/SceneDetectionDialog'
import { AiPrivacyDialog } from './components/AiPrivacyDialog'
import { AiActivityDialog } from './components/AiActivityDialog'
import type { AutomateSequenceOptions } from './components/AutomateSequenceDialog'
import type { MulticamSourceOptions } from './components/MulticamSourceDialog'
import { PasteAttributesDialog, type PasteAttributeOptions } from './components/PasteAttributesDialog'
import { SequenceTabs } from './components/SequenceTabs'
import { Timeline } from './components/Timeline'
import { Topbar } from './components/Topbar'
import { createInitialTracks, initialTracks, sequencePresets } from './editor/demo'
import { readAiPrivacySettings, writeAiPrivacySettings } from './platform/aiPrivacy'
import { defaultAdrTeamDefaults, type AdrTeamDefaults } from './platform/audioTemplates'
import { clipNeedsPitchStretch, clipSourceDuration, clipSourceTime, defaultAudioAdjustment, defaultCaptionStyle, defaultColorAdjustment, defaultVisualEffects, resolveClipTransform, resolveVisualEffects, sliceClipAutomation, sliceClipSpeed } from './editor/effects'
import { estimateAudioLoudness, inspectDelivery } from './editor/delivery'
import { audioRoles, defaultAudioBuses, normalizeAudioBuses, updateAudioBus } from './editor/audioBuses'
import { createChapterList, createEdl, createFcpxml, createMarkerCsv, createOtio, createPremiereXml, materializeImportedTimeline, parseExchangeTimeline } from './editor/exchange'
import { clamp, formatFileSize, formatTimecode } from './editor/format'
import { snapTimeToFrame, timeAtFrame } from './editor/frameMath'
import { appendHistorySnapshot, redoHistorySnapshot, undoHistorySnapshot } from './editor/history'
import { assessTimelinePerformance } from './editor/performance'
import { estimateClapSync, estimateWaveformSync } from './editor/audioSync'
import { flattenNestedTracks, nestedOutputTime } from './editor/nesting'
import { activeVisualClipsAt, clipsWithAudioTransitionTails, constrainTransitionCarryToAsset, defaultSequenceTransitionDefaults, normalizeSequenceTransitionDefaults } from './editor/transitions'
import { createSourceGraphSnapshot, inspectDerivedSequenceImpact, inspectSourceGraphBatch, sequenceFingerprint, staleDerivedSequenceIds, synchronizeDerivedSequenceDomains } from './editor/sourceGraph'
import { duplicateProjectSequence, inspectSequenceDeletion, removeAssetReferencesFromSequences, renderReplacementSourceAssetIds, renameProjectSequence } from './editor/sequenceManagement'
import { assignSourceTarget, normalizeSourceTargets, repairSourceTargetAfterRemoval, resolveSourceTargetTrack, toggleSourceTarget } from './editor/trackTargeting'
import { createClipSourceDurationMap } from './editor/trimConstraints'
import { inspectAdrRippleInsert, rippleInsertAdrCues, rippleInsertMarkers, rippleInsertSuggestions, rippleInsertTranscript } from './editor/rippleInsert'
import { inspectAdrRippleDelete, normalizeRippleDeleteRange, rippleDeleteAdrCues, rippleDeleteMarkers, rippleDeleteSuggestions, rippleDeleteTranscript } from './editor/rippleDelete'
import { inspectAdrOverwrite } from './editor/overwrite'
import { branchSequenceFromVersion, mergeProjectVersions, resolveProjectMergeConflict } from './editor/versionMerge'
import { createReviewPackage, mergeReviewComments, parseReviewPackage } from './editor/reviewPackage'
import { createProjectDocument, getProjectSequences, parseProjectDocument, readAutosave, readAutosaveHistory, reconcileProjectAssets, restoreAssets, saveAutosave } from './editor/project'
import { addTimelineTrack, extendTimelineClipAtEnd, extendTimelineClipAtStart, insertTimelineClip, insertTimelineGap, liftTimelineRange, linkClipsAtTime, moveClipGroup, overwriteMovedTimelineClips, removeTimelineRange, removeTimelineTrack, setClipGroup, snapClipStart, snapTimelineTime, splitTimelineClipsAt, trimTimelineClipAdvancedResult, unlinkClip, upsertMarker } from './editor/timelineOps'
import type { AdrCue, AiActivityRecord, AspectRatio, AudioBusMap, AudioBusSettings, AudioRole, ClipMarker, ClipTransition, EditWeaveProjectDocument, EditMode, EditorTool, EditSuggestion, EditorPanel, MaskPoint, MediaAsset, MediaKind, ProjectMergeSession, ProjectSequence, ShortsCandidate, SourceGraphDomain, SpeakerVoiceProfile, TimelineClip, TimelineMarker, TimelineTrack, TitleTemplate, TrackKind, TranscriptSegment, TrimMode } from './editor/types'
import { createRoughCutSuggestions, defaultCreatorLearningProfile, normalizeCreatorLearningProfile, recordSuggestionFeedback, resetCreatorFeedback } from './ai/roughCut'
import { appendAiActivity, finishAiActivity, normalizeAiActivityLog, startAiActivity, updateAiActivity } from './ai/activity'
import { enrichSemanticHighlights } from './ai/semanticHighlights'
import { parseAudienceRetentionCsv } from './ai/retention'
import { createVideoForegroundMasks, removeImageBackground } from './ai/backgroundRemoval'
import { parseComfyWorkflow, runComfyImageWorkflow } from './integrations/comfyui'
import { createSpeakerVoiceProfiles, reidentifyTranscriptSpeakers, transcribeLocally, transcriptionModelForQuality } from './ai/transcribe'
import { analyzeMediaFile } from './media/analyze'
import { exportAudioMaster, exportAudioStem, exportSequence } from './media/export'
import { mergeRenderedSegments } from './media/mergeSegments'
import { createAudioCompatibilityProxy, createEditingProxy, createImageCompatibilityProxy, createImageSequenceProxy } from './media/proxy'
import { trackFacesInRange } from './media/motionTracking'
import { detectSceneCuts } from './media/sceneDetection'
import { trackObjectInRange } from './media/objectTracking'
import { formatMediaTimecode } from './media/timecode'
import { audioMediaExtensions, imageMediaExtensions, videoMediaExtensions } from './media/extensions'
import { createMediaMetadataCsv, parseMediaMetadataCsv } from './media/metadataCsv'
import { effectiveSourceHdrFormat, interpretedSourceDuration, retimeClipForSourceConform, sourceFrameConformRate, sourceMediaToTimelineTime, sourceTimelineToMediaTime } from './editor/sourceInterpretation'
import { createDeliveryPackage, createProjectArchive, findMediaRelinkCandidates, mediaFileQuickSignature, openExchangeFileNative, openMediaFilesNative, openMediaFolderNative, openProjectFileAtPath, openProjectFileNative, openProjectFromBrowserFile, prepareAudioStemTarget, prepareRenderedVideoTargetAtPath, prepareRenderedVideoTargetInDirectory, readMediaEntriesFromPaths, readMediaFilesFromPaths, renderedVideoExists, reserveAudioWavPathInDirectory, reserveRenderedVideoPathInDirectory, revealMediaInFileManager, runningInDesktop, saveAudioStem, saveExchangeFile, saveFrameImage, saveMarkerDeliveryFile, saveMediaMetadataFile, saveProjectFile, saveRenderedVideo, saveReviewFile, saveReviewPackageFile, saveSubtitleFile, selectAudioWavPath, selectMediaRelinkDirectory, selectProjectSavePath, selectRenderedVideoDirectory, selectRenderedVideoPath, selectReviewVideoPath, writeProjectFileAtPath } from './platform/projectFiles'
import type { MediaFileReadFailure, ProjectArchiveOptions } from './platform/projectFiles'
import { deleteProxyFile, loadProxyFile, persistProxyFile, proxyFileSize, proxyPreviewUrl } from './platform/proxyCache'
import { clearRenderRecovery, createRenderFingerprint, readRenderRecovery, writeRenderRecovery, type RenderRecoveryRecord } from './platform/renderRecovery'
import { createPauseGate, readRenderQueue, writeRenderQueue, type PauseGate, type RenderQueueJob } from './platform/renderQueue'
import { cleanupRenderSegments, decodeRenderHdrSource, encodeRenderHdrSegment, inspectRenderSegments, prepareRenderAudioMaster, prepareRenderHdrRawSegment, prepareRenderSegment } from './platform/renderSegments'
import { openHdrRawSource } from './platform/hdrRawSource'
import { applyHdrOutputMetadata, collectHdrOutputMetadata } from './platform/hdrMetadata'
import { deleteLanReviewComment, startLanReviewSession, stopLanReviewSession, syncLanReviewSession, type LanReviewSession } from './platform/lanReview'
import { acquireProjectLock, heartbeatProjectLock, releaseProjectLock, type ProjectLockResult } from './platform/projectLock'
import { checkForUpdate, clearStoredUpdateAttempt, currentEditWeaveVersion, downloadVerifiedUpdateInstaller, launchVerifiedUpdateInstaller, markUpdateInstallerLaunched, markUpdateInstallerLaunchFailed, matchingStoredUpdateInstaller, prepareExistingVerifiedUpdateInstaller, reconcileStoredUpdateAttempt, rememberVerifiedUpdateInstaller, selectUpdateInstallerDestination } from './platform/update'
import { deleteVoiceoverRecording, persistVoiceoverRecording } from './platform/recordingStore'
import { measureRenderedLoudness } from './platform/loudness'
import { inspectAudioOutputSettings, inspectAudioProjectRouting, normalizeAudioDeliveryProfileId } from './platform/audioDeliveryConformance'
import { finalizeMasterCodec, finalizeRequestedCodec, intermediateRenderCodec, isMezzanineCodec, muxContinuousSurroundAudio, renderCodecLabel } from './platform/renderTranscode'
import { applyBroadcastWavMetadata } from './platform/wavMetadata'
import { forgetRecentProject, readRecentProjects, rememberRecentProject } from './platform/recentProjects'
import { commandFromEvent, readShortcuts, writeShortcuts, type ShortcutMap } from './platform/shortcuts'
import { applyWorkspacePreset, readWorkspacePreferences, updateWorkspaceDimensions, writeWorkspacePreferences, type WorkspaceDimensions, type WorkspacePresetId } from './platform/workspaceLayouts'
import { authorizeKnownScratchRoots, clearScratchDiskArea, isCurrentScratchPath, readScratchDiskPreferences, scratchRoot } from './platform/scratchDisks'
import { parseSubtitleFile, transcriptToSrt, transcriptToTtml, transcriptToVtt } from './transcript/subtitles'
import { createDerivedShortsSequence, generateShortsCandidates } from './shorts/generate'
import { resolveEffectMasks } from './editor/mask'

const defaultTransform = { positionX: 0, positionY: 0, scale: 100, scaleX: 100, scaleY: 100, anchorX: 50, anchorY: 50, skewX: 0, skewY: 0, rotation: 0, opacity: 100 }
type AudioDeliverableRole = AudioRole | 'mix'
const audioStemFileLabels: Record<AudioDeliverableRole, string> = { mix: 'Full-Mix', dialogue: 'DX-Dialogue', music: 'MX-Music', effects: 'FX-Effects', ambient: 'AMB-Ambient' }

function audioExportBlocker(request: ExportRequest, tracks: TimelineTrack[], buses?: AudioBusMap): string | undefined {
  const profileId = normalizeAudioDeliveryProfileId(request.audioDeliveryProfile)
  const issues = [
    ...inspectAudioOutputSettings({ profileId, sampleRate: request.audioSampleRate, channels: request.audioChannels, bitDepth: 24, mixdownWav: request.audioMixdownWav, stemRoles: request.audioStems }),
    ...inspectAudioProjectRouting(tracks, buses, request.audioChannels),
  ]
  const blockers = issues.filter((issue) => issue.level === 'blocker')
  return blockers.length ? blockers.map((issue) => `${issue.title}: ${issue.detail}`).join(' ') : undefined
}

function releaseObjectUrl(url: string | undefined): void {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
}

function releaseImageSequenceUrls(asset: MediaAsset | undefined): void {
  if (!asset?.imageSequenceUrls?.length) return
  new Set(asset.imageSequenceUrls).forEach((url) => releaseObjectUrl(url))
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await task(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

function withDeadline<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([operation, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

function resolvePreviewMediaAsset(asset: MediaAsset | undefined): MediaAsset | undefined {
  if (!asset) return undefined
  if (asset.useProxy && asset.proxyStatus === 'ready' && asset.proxyUrl) {
    return {
      ...asset,
      url: asset.proxyUrl,
      sourceFile: asset.proxyFile,
      imageSequenceFiles: undefined,
      imageSequencePaths: undefined,
      imageSequenceUrls: undefined,
      streamingSource: Boolean((asset.proxyFile as (File & { __editweaveStreaming?: boolean }) | undefined)?.__editweaveStreaming),
      status: 'ready',
      error: undefined,
    }
  }
  return asset.url && asset.status === 'ready' ? asset : undefined
}

interface EditorHistorySnapshot {
  tracks: TimelineTrack[]
  transcript: TranscriptSegment[]
  suggestions: EditSuggestion[]
  markers: TimelineMarker[]
  audioBuses: AudioBusMap
  adrCues: AdrCue[]
}

interface ClipClipboardPayload {
  baseStart: number
  entries: Array<{ trackId: string; trackKind: TrackKind; clip: TimelineClip }>
}

interface TimelineRange {
  start: number
  end: number
}

function resolveRequestedExportRange(request: ExportRequest, timelineEnd: number, minimumDuration: number, workArea?: { start: number; end: number }): TimelineRange {
  const explicit = request.range !== 'sequence' && Number.isFinite(request.rangeStart) && Number.isFinite(request.rangeEnd)
    ? { start: request.rangeStart!, end: request.rangeEnd! }
    : request.range === 'work-area' ? workArea : undefined
  if (!explicit) return { start: 0, end: timelineEnd }
  const start = Math.max(0, Math.min(timelineEnd - minimumDuration, Math.min(explicit.start, explicit.end)))
  const end = Math.max(start + minimumDuration, Math.min(timelineEnd, Math.max(explicit.start, explicit.end)))
  return { start, end }
}

function createRenderSequenceSnapshots(sequences: ProjectSequence[], rootIds: Iterable<string>): ProjectSequence[] {
  const byId = new Map(sequences.map((sequence) => [sequence.id, sequence]))
  const pending = [...new Set(rootIds)]
  const included = new Set<string>()
  while (pending.length) {
    const id = pending.shift()!
    if (included.has(id)) continue
    const sequence = byId.get(id)
    if (!sequence) continue
    included.add(id)
    sequence.tracks.forEach((track) => track.clips.forEach((clip) => {
      if (clip.nestedSequenceId && !included.has(clip.nestedSequenceId)) pending.push(clip.nestedSequenceId)
    }))
  }
  return sequences.filter((sequence) => included.has(sequence.id)).map((sequence) => structuredClone(sequence))
}

function renderJobSnapshotAssetIds(job: RenderQueueJob): Set<string> {
  return new Set((job.sequenceSnapshots ?? []).flatMap((sequence) => sequence.tracks.flatMap((track) => track.clips.flatMap((clip) => [
    ...[clip.assetId, clip.subclipId].filter((id): id is string => Boolean(id)),
    ...renderReplacementSourceAssetIds(clip),
  ]))))
}

function renderQueueReferencedAssetIds(jobs: RenderQueueJob[]): Set<string> {
  const retainedStatuses = new Set<RenderQueueJob['status']>(['queued', 'running', 'paused', 'failed', 'interrupted'])
  return new Set(jobs.filter((job) => retainedStatuses.has(job.status)).flatMap((job) => [...renderJobSnapshotAssetIds(job)]))
}

function mergeTimelineRanges(ranges: TimelineRange[]): TimelineRange[] {
  const ordered = ranges.filter((range) => range.end - range.start > 1 / 240).sort((left, right) => left.start - right.start)
  return ordered.reduce<TimelineRange[]>((merged, range) => {
    const previous = merged[merged.length - 1]
    if (!previous || range.start > previous.end + 1 / 240) merged.push({ ...range })
    else previous.end = Math.max(previous.end, range.end)
    return merged
  }, [])
}

function rippleTimeThroughRanges(time: number, rangesDescending: TimelineRange[]): number {
  return rangesDescending.reduce((current, range) => current >= range.end ? current - (range.end - range.start) : current > range.start ? range.start : current, time)
}

function createClipClipboardPayload(tracks: TimelineTrack[], selectedClipIds: Iterable<string>): ClipClipboardPayload | undefined {
  const requestedIds = new Set(selectedClipIds)
  if (!requestedIds.size) return undefined
  const requested = tracks.flatMap((track) => track.clips).filter((clip) => requestedIds.has(clip.id) && !clip.adrCueId)
  if (!requested.length) return undefined
  const relationIds = new Set(requested.flatMap((clip) => [clip.groupId, clip.linkGroupId]).filter((id): id is string => Boolean(id)))
  const entries = tracks.flatMap((track) => track.clips
    .filter((clip) => !clip.adrCueId && (requestedIds.has(clip.id) || relationIds.has(clip.groupId ?? '') || relationIds.has(clip.linkGroupId ?? '')))
    .map((clip) => ({ trackId: track.id, trackKind: track.kind, clip: structuredClone(clip) })))
  if (!entries.length) return undefined
  return { baseStart: Math.min(...entries.map((entry) => entry.clip.start)), entries }
}

function automationPatchForClip(source: TimelineClip, target: TimelineClip): Partial<TimelineClip> {
  const scaleTime = (time: number) => Math.max(0, Math.min(target.duration, time * target.duration / Math.max(0.001, source.duration)))
  const patch: Partial<TimelineClip> = {}
  if (source.kind !== 'audio' && target.kind !== 'audio') {
    patch.transform = structuredClone(source.transform)
    patch.keyframes = source.keyframes?.map((keyframe) => ({ ...structuredClone(keyframe), id: crypto.randomUUID(), time: scaleTime(keyframe.time) }))
    patch.stabilization = source.stabilization ? { ...structuredClone(source.stabilization), originalKeyframes: source.stabilization.originalKeyframes?.map((keyframe) => ({ ...structuredClone(keyframe), id: crypto.randomUUID(), time: scaleTime(keyframe.time) })) } : undefined
  }
  if (source.kind !== 'caption' && target.kind !== 'caption') {
    patch.playbackRate = source.playbackRate
    patch.speedKeyframes = source.speedKeyframes?.map((keyframe) => ({ ...structuredClone(keyframe), id: crypto.randomUUID(), time: scaleTime(keyframe.time) }))
    patch.audioAdjustment = source.audioAdjustment ? {
      ...structuredClone(source.audioAdjustment),
      auxSends: source.audioAdjustment.auxSends?.map((send) => ({ ...structuredClone(send), id: crypto.randomUUID() })),
    } : undefined
    patch.audioMixKeyframes = source.audioMixKeyframes?.map((keyframe) => ({ ...structuredClone(keyframe), id: crypto.randomUUID(), time: scaleTime(keyframe.time) }))
  }
  if (source.kind === 'video' && target.kind === 'video') {
    patch.colorAdjustment = structuredClone(source.colorAdjustment)
    patch.visualEffects = structuredClone(source.visualEffects)
    patch.effectStack = source.effectStack?.map((item) => ({ ...structuredClone(item), id: crypto.randomUUID() }))
    patch.visualKeyframes = source.visualKeyframes?.map((keyframe) => ({ ...structuredClone(keyframe), id: crypto.randomUUID(), time: scaleTime(keyframe.time) }))
  }
  return patch
}

function selectedAttributePatchForClip(source: TimelineClip, target: TimelineClip, options: PasteAttributeOptions): Partial<TimelineClip> {
  const complete = automationPatchForClip(source, target)
  const patch: Partial<TimelineClip> = {}
  if (options.motion && source.kind === 'video' && target.kind === 'video') {
    patch.transform = complete.transform
    patch.keyframes = complete.keyframes
    patch.stabilization = complete.stabilization
  }
  if (options.colorEffects && source.kind === 'video' && target.kind === 'video') {
    patch.colorAdjustment = complete.colorAdjustment
    patch.visualEffects = complete.visualEffects
    patch.effectStack = complete.effectStack
    patch.visualKeyframes = complete.visualKeyframes
  }
  if (options.speed && source.kind !== 'caption' && target.kind !== 'caption') {
    patch.playbackRate = complete.playbackRate
    patch.speedKeyframes = complete.speedKeyframes
    patch.frameInterpolation = source.frameInterpolation
    patch.reverse = source.reverse
    patch.freezeFrame = source.freezeFrame
    patch.freezeFrameSourceTime = source.freezeFrame ? target.sourceOffset : undefined
  }
  if (options.audio && source.kind !== 'caption' && target.kind !== 'caption') {
    patch.audioAdjustment = complete.audioAdjustment
    patch.audioMixKeyframes = complete.audioMixKeyframes
  }
  if (options.transitions && source.kind !== 'caption' && target.kind !== 'caption') {
    patch.transitionIn = structuredClone(source.transitionIn)
    patch.transitionOut = structuredClone(source.transitionOut)
  }
  if (options.captions && source.kind === 'caption' && target.kind === 'caption') patch.captionStyle = structuredClone(source.captionStyle)
  return patch
}

function duplicateClipForPaste(source: TimelineClip, targetTrackId: string, trackIdMap: ReadonlyMap<string, string>): TimelineClip {
  const clip = structuredClone(source)
  const maskIds = new Map<string, string>()
  const remapMasks = (effects: TimelineClip['visualEffects']) => effects ? {
    ...effects,
    masks: effects.masks?.map((mask) => {
      let id = maskIds.get(mask.id)
      if (!id) { id = crypto.randomUUID(); maskIds.set(mask.id, id) }
      return { ...mask, id }
    }),
  } : undefined
  const nodeIds = new Map((clip.colorAdjustment?.colorNodes ?? []).map((node) => [node.id, crypto.randomUUID()]))
  return {
    ...clip,
    id: crypto.randomUUID(),
    trackId: targetTrackId,
    trackMatte: clip.trackMatte ? { ...clip.trackMatte, sourceTrackId: trackIdMap.get(clip.trackMatte.sourceTrackId) ?? clip.trackMatte.sourceTrackId } : undefined,
    effectStack: clip.effectStack?.map((item) => ({ ...item, id: crypto.randomUUID() })),
    speedKeyframes: clip.speedKeyframes?.map((keyframe) => ({ ...keyframe, id: crypto.randomUUID() })),
    keyframes: clip.keyframes?.map((keyframe) => ({ ...keyframe, id: crypto.randomUUID() })),
    stabilization: clip.stabilization ? { ...clip.stabilization, originalKeyframes: clip.stabilization.originalKeyframes?.map((keyframe) => ({ ...keyframe, id: crypto.randomUUID() })) } : undefined,
    visualEffects: remapMasks(clip.visualEffects),
    visualKeyframes: clip.visualKeyframes?.map((keyframe) => ({ ...keyframe, id: crypto.randomUUID(), effects: remapMasks(keyframe.effects)! })),
    colorAdjustment: clip.colorAdjustment ? {
      ...clip.colorAdjustment,
      colorNodes: clip.colorAdjustment.colorNodes?.map((node) => ({ ...node, id: nodeIds.get(node.id)!, inputIds: node.inputIds.map((inputId) => nodeIds.get(inputId) ?? inputId) })),
      colorOutputNodeId: clip.colorAdjustment.colorOutputNodeId ? nodeIds.get(clip.colorAdjustment.colorOutputNodeId) ?? clip.colorAdjustment.colorOutputNodeId : undefined,
    } : undefined,
    audioAdjustment: clip.audioAdjustment ? { ...clip.audioAdjustment, auxSends: clip.audioAdjustment.auxSends?.map((send) => ({ ...send, id: crypto.randomUUID() })) } : undefined,
    audioMixKeyframes: clip.audioMixKeyframes?.map((keyframe) => ({ ...keyframe, id: crypto.randomUUID() })),
    clipMarkers: clip.clipMarkers?.map((marker) => ({ ...marker, id: crypto.randomUUID() })),
  }
}

function reconcileReviewMarkerDeletions(before: TimelineMarker[], after: TimelineMarker[], deletedIds: Set<string>): void {
  const beforeComments = new Set(before.filter((marker) => marker.kind === 'comment').map((marker) => marker.id))
  const afterComments = new Set(after.filter((marker) => marker.kind === 'comment').map((marker) => marker.id))
  beforeComments.forEach((id) => { if (!afterComments.has(id)) deletedIds.add(id) })
  afterComments.forEach((id) => { if (!beforeComments.has(id)) deletedIds.delete(id) })
}

function addRippleBoundaryFades(tracks: TimelineTrack[], boundary: number): TimelineTrack[] {
  return tracks.map((track) => track.locked || (track.kind !== 'audio' && track.kind !== 'video') ? track : ({
    ...track,
    clips: track.clips.map((clip) => {
      if (clip.adrCueId) return clip
      const adjustment = { ...defaultAudioAdjustment(), ...clip.audioAdjustment }
      if (Math.abs(clip.start + clip.duration - boundary) < 1 / 30) return { ...clip, audioAdjustment: { ...adjustment, fadeOut: Math.max(adjustment.fadeOut, 0.08) } }
      if (Math.abs(clip.start - boundary) < 1 / 30) return { ...clip, audioAdjustment: { ...adjustment, fadeIn: Math.max(adjustment.fadeIn, 0.08) } }
      return clip
    }),
  }))
}

function getMediaKind(file: File): MediaKind | undefined {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  if (file.type.startsWith('image/')) return imageMediaExtensions.has(extension) ? 'image' : undefined
  if (videoMediaExtensions.has(extension)) return 'video'
  if (audioMediaExtensions.has(extension)) return 'audio'
  if (imageMediaExtensions.has(extension)) return 'image'
  return undefined
}

function normalizedMediaPath(value: string | undefined): string | undefined {
  if (!value) return undefined
  const windowsPath = value.includes('\\') || /^[a-z]:[\\/]/i.test(value)
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
  return windowsPath ? normalized.toLocaleLowerCase() : normalized
}

function mediaPathSuffixScore(previousPath: string | undefined, candidatePath: string): number {
  const previous = normalizedMediaPath(previousPath)?.split('/') ?? []
  const candidate = normalizedMediaPath(candidatePath)?.split('/') ?? []
  let score = 0
  for (let offset = 1; offset <= Math.min(previous.length, candidate.length); offset += 1) {
    if (previous[previous.length - offset] !== candidate[candidate.length - offset]) break
    score += 1
  }
  return score
}

function mediaFilenameKey(value: string | undefined): string {
  const filename = value?.trim().split(/[\\/]/).pop()?.toLocaleLowerCase() ?? ''
  return filename.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}]+/gu, '')
}

function importedFileIdentity(file: File): string {
  const pathFile = file as File & { __editweaveSourcePath?: string; __editweaveFileSize?: number }
  const size = pathFile.__editweaveFileSize ?? file.size
  const path = normalizedMediaPath(pathFile.__editweaveSourcePath)
  return path ? `path:${path}|${size}` : `file:${file.name}|${size}|${file.lastModified}|${file.type}`
}

function isAlreadyConnectedSource(asset: MediaAsset, file: File, quickSignature?: string): boolean {
  const pathFile = file as File & { __editweaveSourcePath?: string; __editweaveFileSize?: number }
  const size = pathFile.__editweaveFileSize ?? file.size
  const currentPath = normalizedMediaPath(asset.sourcePath)
  const incomingPath = normalizedMediaPath(pathFile.__editweaveSourcePath)
  const hasComparableSignatures = asset.sourceQuickSignature !== undefined && quickSignature !== undefined
  const sourceRevisionMatches = hasComparableSignatures
    ? asset.sourceQuickSignature === quickSignature
    : asset.sourceLastModified === undefined || Math.abs(asset.sourceLastModified - file.lastModified) < 2_000
  if (currentPath && incomingPath) return currentPath === incomingPath && asset.size === size && sourceRevisionMatches
  return Boolean(asset.sourceFile
    && asset.sourceFile.name === file.name
    && asset.size === size
    && sourceRevisionMatches
    && asset.sourceFile.type === file.type)
}

function timelineTimeForClipSource(clip: TimelineClip, sourceTime: number): number | undefined {
  const sourceAtStart = clipSourceTime(clip, clip.start)
  const sourceAtEnd = clipSourceTime(clip, clip.start + clip.duration)
  if (sourceTime < Math.min(sourceAtStart, sourceAtEnd) - 1 / 120 || sourceTime > Math.max(sourceAtStart, sourceAtEnd) + 1 / 120) {
    const sourceDelta = sourceAtEnd - sourceAtStart
    if (Math.abs(sourceDelta) < 1e-6) return undefined
    return clip.start + (sourceTime - sourceAtStart) / sourceDelta * clip.duration
  }
  let low = clip.start
  let high = clip.start + clip.duration
  for (let iteration = 0; iteration < 28; iteration++) {
    const middle = (low + high) / 2
    const current = clipSourceTime(clip, middle)
    if ((!clip.reverse && current < sourceTime) || (clip.reverse && current > sourceTime)) low = middle
    else high = middle
  }
  return (low + high) / 2
}

function uniqueQueuedFilename(base: string, hint: string, jobs: RenderQueueJob[], targetProjectId: string): string {
  const cleanBase = base.replace(/\.mp4$/i, '').trim() || 'editweave-export'
  const used = new Set(jobs.filter((job) => job.projectId === targetProjectId).map((job) => job.settings.filename.replace(/\.mp4$/i, '').toLocaleLowerCase()))
  if (!used.has(cleanBase.toLocaleLowerCase())) return cleanBase
  const cleanHint = hint.replace(/[<>:"/\\|?*]+/g, '-').trim() || 'sequence'
  let candidate = `${cleanBase}-${cleanHint}`
  let suffix = 2
  while (used.has(candidate.toLocaleLowerCase())) candidate = `${cleanBase}-${cleanHint}-${suffix++}`
  return candidate
}

function replaceAdrCompRange(cue: AdrCue, takeId: string, start: number, end: number): NonNullable<AdrCue['compSegments']> {
  const rangeStart = Math.max(cue.start, Math.min(cue.end - 0.02, Math.min(start, end)))
  const rangeEnd = Math.max(rangeStart + 0.02, Math.min(cue.end, Math.max(start, end)))
  const initial = cue.compSegments?.length
    ? cue.compSegments
    : cue.selectedTakeId ? [{ id: crypto.randomUUID(), start: cue.start, end: cue.end, takeId: cue.selectedTakeId }] : []
  const replaced = initial.flatMap((segment) => {
    if (segment.end <= rangeStart || segment.start >= rangeEnd) return [segment]
    return [
      ...(segment.start < rangeStart ? [{ ...segment, id: crypto.randomUUID(), end: rangeStart }] : []),
      ...(segment.end > rangeEnd ? [{ ...segment, id: crypto.randomUUID(), start: rangeEnd }] : []),
    ]
  })
  replaced.push({ id: crypto.randomUUID(), start: rangeStart, end: rangeEnd, takeId })
  const sorted = replaced.sort((left, right) => left.start - right.start)
  return sorted.reduce<NonNullable<AdrCue['compSegments']>>((result, segment) => {
    const previous = result[result.length - 1]
    if (previous && previous.takeId === segment.takeId && Math.abs(previous.end - segment.start) < 0.021) previous.end = segment.end
    else result.push({ ...segment })
    return result
  }, [])
}

function warpTrackedMaskPoint(point: MaskPoint, bounds: { minX: number; maxX: number; minY: number; maxY: number }, corners: Array<{ x: number; y: number }>): MaskPoint {
  const transform = (x: number, y: number) => {
    const u = Math.max(0, Math.min(1, (x - bounds.minX) / Math.max(0.001, bounds.maxX - bounds.minX)))
    const v = Math.max(0, Math.min(1, (y - bounds.minY) / Math.max(0.001, bounds.maxY - bounds.minY)))
    const [topLeft, topRight, bottomRight, bottomLeft] = corners
    const top = { x: topLeft.x * (1 - u) + topRight.x * u, y: topLeft.y * (1 - u) + topRight.y * u }
    const bottom = { x: bottomLeft.x * (1 - u) + bottomRight.x * u, y: bottomLeft.y * (1 - u) + bottomRight.y * u }
    return { x: Math.max(0, Math.min(100, x + (top.x * (1 - v) + bottom.x * v) * 100)), y: Math.max(0, Math.min(100, y + (top.y * (1 - v) + bottom.y * v) * 100)) }
  }
  const anchor = transform(point.x, point.y)
  const transformHandle = (handle?: { x: number; y: number }) => {
    if (!handle) return undefined
    const endpoint = transform(point.x + handle.x, point.y + handle.y)
    return { x: endpoint.x - anchor.x, y: endpoint.y - anchor.y }
  }
  return { ...point, ...anchor, inHandle: transformHandle(point.inHandle), outHandle: transformHandle(point.outHandle) }
}

export default function App() {
  const restoredProjectRef = useRef<EditWeaveProjectDocument | undefined>(readAutosave())
  const recoveredRenderRef = useRef<RenderRecoveryRecord | undefined>(readRenderRecovery())
  const restoredProject = restoredProjectRef.current
  const initialCreatedAtRef = useRef(restoredProject?.createdAt ?? new Date().toISOString())
  const initialSequencesRef = useRef<ProjectSequence[]>(restoredProject ? getProjectSequences(restoredProject) : [{
    id: 'sequence-main',
    name: '메인 시퀀스',
    kind: 'main',
    aspectRatio: '16:9',
    width: 1920,
    height: 1080,
    fps: 30,
    transitionDefaults: defaultSequenceTransitionDefaults(),
    tracks: initialTracks,
    transcript: [],
    suggestions: [],
    createdAt: initialCreatedAtRef.current,
  }])
  const initialActiveSequence = initialSequencesRef.current.find((sequence) => sequence.id === restoredProject?.activeSequenceId) ?? initialSequencesRef.current[0]
  const [projectId, setProjectId] = useState(restoredProject?.id ?? crypto.randomUUID())
  const [createdAt, setCreatedAt] = useState(initialCreatedAtRef.current)
  const [projectName, setProjectName] = useState(restoredProject?.name ?? '새로운 크리에이터 프로젝트')
  const [activeSequenceId, setActiveSequenceId] = useState(initialActiveSequence.id)
  const [sequenceLibrary, setSequenceLibrary] = useState<ProjectSequence[]>(initialSequencesRef.current)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(initialActiveSequence.aspectRatio)
  const [activePanel, setActivePanel] = useState<EditorPanel>('media')
  const [workspacePreferences, setWorkspacePreferences] = useState(readWorkspacePreferences)
  const [assets, setAssets] = useState<MediaAsset[]>(restoredProject ? restoreAssets(restoredProject) : [])
  const [mediaBins, setMediaBins] = useState<string[]>(() => [...new Set([...(restoredProject?.mediaBins ?? []), ...(restoredProject?.assets ?? []).map((asset) => asset.folder ?? '')].map((name) => name.trim()).filter(Boolean))])
  const [selectedAssetId, setSelectedAssetId] = useState<string | undefined>(undefined)
  const [tracks, setTracks] = useState<TimelineTrack[]>(initialActiveSequence.tracks)
  const [markers, setMarkers] = useState<TimelineMarker[]>(initialActiveSequence.markers ?? [])
  const [audioBuses, setAudioBuses] = useState<AudioBusMap>(() => normalizeAudioBuses(initialActiveSequence.audioBuses))
  const [editMode, setEditMode] = useState<EditMode>('append')
  const [activeTool, setActiveTool] = useState<EditorTool>('selection')
  const [trimMode, setTrimMode] = useState<TrimMode>('normal')
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [linkedSelectionEnabled, setLinkedSelectionEnabled] = useState(true)
  const [selectionFollowsPlayhead, setSelectionFollowsPlayhead] = useState(false)
  const [selectedTrackId, setSelectedTrackId] = useState<string | undefined>(initialActiveSequence.tracks.find((track) => track.kind === 'video')?.id)
  const [transcript, setTranscript] = useState<TranscriptSegment[]>(initialActiveSequence.transcript)
  const [suggestions, setSuggestions] = useState<EditSuggestion[]>(initialActiveSequence.suggestions)
  const [correctionDictionary, setCorrectionDictionary] = useState<Record<string, string>>(restoredProject?.correctionDictionary ?? {})
  const [speakerVoiceProfiles, setSpeakerVoiceProfiles] = useState<SpeakerVoiceProfile[]>(() => restoredProject?.speakerVoiceProfiles?.length ? restoredProject.speakerVoiceProfiles : createSpeakerVoiceProfiles(initialSequencesRef.current.flatMap((sequence) => sequence.transcript)))
  const [creatorLearningProfile, setCreatorLearningProfile] = useState(() => normalizeCreatorLearningProfile(restoredProject?.creatorLearningProfile))
  const [selectedTranscriptId, setSelectedTranscriptId] = useState<string | undefined>(undefined)
  const [selectedClipId, setSelectedClipId] = useState<string | undefined>(undefined)
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(() => new Set())
  const [hasClipClipboard, setHasClipClipboard] = useState(false)
  const [pasteAttributesOpen, setPasteAttributesOpen] = useState(false)
  const [past, setPast] = useState<EditorHistorySnapshot[]>([])
  const [future, setFuture] = useState<EditorHistorySnapshot[]>([])
  const [playhead, setPlayhead] = useState(0)
  const [sequenceWorkArea, setSequenceWorkArea] = useState<{ start: number; end: number } | undefined>(initialActiveSequence.workArea)
  const [sequenceLoopPlayback, setSequenceLoopPlayback] = useState(Boolean(initialActiveSequence.loopPlayback))
  const [programScopeFrame, setProgramScopeFrame] = useState<{ canvas: HTMLCanvasElement; revision: number }>()
  const [programReferenceFrame, setProgramReferenceFrame] = useState<{ sequenceId: string; time: number; image: ImageData }>()
  const [referenceComparisonEnabled, setReferenceComparisonEnabled] = useState(false)
  const [referenceComparisonMode, setReferenceComparisonMode] = useState<'wipe' | 'split'>('wipe')
  const [referenceComparisonPosition, setReferenceComparisonPosition] = useState(50)
  const handleProgramFrame = useCallback((canvas: HTMLCanvasElement, revision: number) => setProgramScopeFrame({ canvas, revision }), [])
  const [sourcePlayhead, setSourcePlayhead] = useState(0)
  const [sourceInPoint, setSourceInPoint] = useState<number | undefined>(undefined)
  const [sourceOutPoint, setSourceOutPoint] = useState<number | undefined>(undefined)
  const [isPlaying, setIsPlaying] = useState(false)
  const [shuttleRate, setShuttleRate] = useState(1)
  const [zoom, setZoom] = useState(10)
  const [toast, setToast] = useState<string | undefined>(recoveredRenderRef.current ? recoveredRenderRef.current.completedSegments ? `이전 렌더의 완료 체크포인트 ${recoveredRenderRef.current.completedSegments}/${recoveredRenderRef.current.totalSegments ?? '?'}를 찾았습니다. 렌더 큐에서 이어갈 수 있습니다.` : `이전 렌더가 ${Math.round(recoveredRenderRef.current.progress * 100)}%에서 중단되었습니다. 렌더 큐에서 재시도할 수 있습니다.` : restoredProject ? '자동 저장 프로젝트를 복구했습니다.' : undefined)
  const [saveState, setSaveState] = useState(restoredProject ? '자동 저장에서 복구됨' : '로컬 자동 저장 준비')
  const [projectFilePath, setProjectFilePath] = useState<string | undefined>(undefined)
  const [recentProjects, setRecentProjects] = useState(readRecentProjects)
  const [projectLock, setProjectLock] = useState<ProjectLockResult | undefined>(undefined)
  const projectLockInstanceRef = useRef(crypto.randomUUID().replace(/-/g, ''))
  const projectLockRef = useRef<{ path: string; lock: ProjectLockResult } | undefined>(undefined)
  const [exportOpen, setExportOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportStage, setExportStage] = useState('준비')
  const [exportError, setExportError] = useState<string | undefined>(undefined)
  const [renderJobs, setRenderJobs] = useState<RenderQueueJob[]>(() => readRenderQueue())
  const [renderQueueOpen, setRenderQueueOpen] = useState(false)
  const [activeRenderJobId, setActiveRenderJobId] = useState<string | undefined>(undefined)
  const [isExportPaused, setIsExportPaused] = useState(false)
  const [queueRunnerActive, setQueueRunnerActive] = useState(false)
  const [shortsOpen, setShortsOpen] = useState(false)
  const [derivedSyncRequest, setDerivedSyncRequest] = useState<{ derivedId: string; sourceId: string }>()
  const [sourceGraphBatchOpen, setSourceGraphBatchOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [archivingProject, setArchivingProject] = useState(false)
  const [projectManagerOpen, setProjectManagerOpen] = useState(false)
  const [scratchDiskOpen, setScratchDiskOpen] = useState(false)
  const [scratchDiskPreferences, setScratchDiskPreferences] = useState(readScratchDiskPreferences)
  const [sequenceManagerOpen, setSequenceManagerOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [audioMixerOpen, setAudioMixerOpen] = useState(false)
  const [voiceoverOpen, setVoiceoverOpen] = useState(false)
  const [voiceoverStart, setVoiceoverStart] = useState(0)
  const [adrLoopRange, setAdrLoopRange] = useState<{ start: number; end: number }>()
  const [adrCues, setAdrCues] = useState<AdrCue[]>(restoredProject?.adrCues ?? [])
  const [adrDefaults, setAdrDefaults] = useState<AdrTeamDefaults>(defaultAdrTeamDefaults)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [creatorPackOpen, setCreatorPackOpen] = useState(false)
  const [lanReviewSession, setLanReviewSession] = useState<LanReviewSession | undefined>(undefined)
  const [lanReviewBusy, setLanReviewBusy] = useState(false)
  const [lanReviewError, setLanReviewError] = useState<string | undefined>(undefined)
  const lanReviewDeletedIdsRef = useRef(new Set<string>())
  const lanReviewSessionRef = useRef<LanReviewSession | undefined>(lanReviewSession)
  const [motionTrackingClipId, setMotionTrackingClipId] = useState<string | undefined>(undefined)
  const [sceneDetectionClipId, setSceneDetectionClipId] = useState<string | undefined>(undefined)
  const [objectTrackingClipId, setObjectTrackingClipId] = useState<string | undefined>(undefined)
  const [stabilizationClipId, setStabilizationClipId] = useState<string | undefined>(undefined)
  const [sceneReview, setSceneReview] = useState<{ clipId: string; clipName: string; points: SceneReviewPoint[] } | undefined>(undefined)
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(() => readShortcuts())
  const [pendingTranscriptCut, setPendingTranscriptCut] = useState<TranscriptSegment | undefined>(undefined)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [autosaveHistory, setAutosaveHistory] = useState<EditWeaveProjectDocument[]>([])
  const [mergeSessions, setMergeSessions] = useState<ProjectMergeSession[]>(restoredProject?.mergeSessions ?? [])
  const [transcriptionRunning, setTranscriptionRunning] = useState(false)
  const [transcriptionProgress, setTranscriptionProgress] = useState(0)
  const [transcriptionStage, setTranscriptionStage] = useState('준비')
  const [roughCutAnalysisRunning, setRoughCutAnalysisRunning] = useState(false)
  const [roughCutAnalysisProgress, setRoughCutAnalysisProgress] = useState(0)
  const [roughCutAnalysisStage, setRoughCutAnalysisStage] = useState('준비')
  const [backgroundRemovalRunning, setBackgroundRemovalRunning] = useState(false)
  const [backgroundRemovalProgress, setBackgroundRemovalProgress] = useState(0)
  const [backgroundRemovalStage, setBackgroundRemovalStage] = useState('준비')
  const [videoBackgroundRemovalClipId, setVideoBackgroundRemovalClipId] = useState<string | undefined>(undefined)
  const [renderReplaceClipId, setRenderReplaceClipId] = useState<string | undefined>(undefined)
  const [renderReplaceProgress, setRenderReplaceProgress] = useState(0)
  const [renderReplaceStage, setRenderReplaceStage] = useState('준비')
  const [comfyOpen, setComfyOpen] = useState(false)
  const [comfyAssetId, setComfyAssetId] = useState<string | undefined>(undefined)
  const [comfyRunning, setComfyRunning] = useState(false)
  const [comfyProgress, setComfyProgress] = useState(0)
  const [comfyStage, setComfyStage] = useState('준비')
  const [comfyError, setComfyError] = useState<string | undefined>(undefined)
  const [aiPrivacyOpen, setAiPrivacyOpen] = useState(false)
  const [aiPrivacySettings, setAiPrivacySettings] = useState(readAiPrivacySettings)
  const [aiActivityOpen, setAiActivityOpen] = useState(false)
  const [aiActivityLog, setAiActivityLog] = useState<AiActivityRecord[]>(() => normalizeAiActivityLog(restoredProject?.aiActivityLog))
  const projectInputRef = useRef<HTMLInputElement>(null)
  const exchangeInputRef = useRef<HTMLInputElement>(null)
  const exportAbortRef = useRef<AbortController | undefined>(undefined)
  const transcriptionAbortRef = useRef<AbortController | undefined>(undefined)
  const renderReplaceAbortRef = useRef<AbortController | undefined>(undefined)
  const exportPauseRef = useRef<PauseGate | undefined>(undefined)
  const queueOutputDirectoryRef = useRef<string | undefined>(undefined)
  const proxyAbortRef = useRef<Map<string, AbortController>>(new Map())
  const proxyBatchStateRef = useRef<{ cancelledIds: Set<string>; queuedIds: Set<string>; activeId?: string } | undefined>(undefined)
  const comfyAbortRef = useRef<AbortController | undefined>(undefined)
  const motionTrackingAbortRef = useRef<AbortController | undefined>(undefined)
  const sceneDetectionAbortRef = useRef<AbortController | undefined>(undefined)
  const objectTrackingAbortRef = useRef<AbortController | undefined>(undefined)
  const stabilizationAbortRef = useRef<AbortController | undefined>(undefined)
  const videoBackgroundRemovalAbortRef = useRef<AbortController | undefined>(undefined)
  const initialProxyRestoreStartedRef = useRef(false)
  const initialSourceRelinkStartedRef = useRef(false)
  const playbackClockRef = useRef<{ mode: 'source' | 'timeline'; sampledAtMs: number; position: number } | undefined>(undefined)
  const playbackRenderAtRef = useRef(0)
  const autosavePlayheadRef = useRef(playhead)
  const assetsRef = useRef<MediaAsset[]>(assets)
  const tracksRef = useRef<TimelineTrack[]>(tracks)
  const transcriptRef = useRef<TranscriptSegment[]>(transcript)
  const suggestionsRef = useRef<EditSuggestion[]>(suggestions)
  const markersRef = useRef<TimelineMarker[]>(markers)
  const audioBusesRef = useRef<AudioBusMap>(audioBuses)
  const adrCuesRef = useRef<AdrCue[]>(adrCues)
  const transcriptEditSnapshotRef = useRef<EditorHistorySnapshot | undefined>(undefined)
  const clipClipboardRef = useRef<ClipClipboardPayload | undefined>(undefined)
  const attributeSourceClipRef = useRef<TimelineClip | undefined>(undefined)

  const activeSequenceMetadata = sequenceLibrary.find((sequence) => sequence.id === activeSequenceId)
  const activeTransitionDefaults = useMemo(() => normalizeSequenceTransitionDefaults(activeSequenceMetadata?.transitionDefaults), [activeSequenceMetadata?.transitionDefaults])
  const ratioPreset = sequencePresets.find((item) => item.ratio === aspectRatio) ?? sequencePresets[0]
  const preset = useMemo(() => ({
    ...ratioPreset,
    width: activeSequenceMetadata?.width ?? ratioPreset.width,
    height: activeSequenceMetadata?.height ?? ratioPreset.height,
  }), [activeSequenceMetadata?.height, activeSequenceMetadata?.width, ratioPreset])
  const activeSequenceFps = activeSequenceMetadata?.fps ?? 30
  autosavePlayheadRef.current = playhead
  const activeSequenceTimecodeStart = activeSequenceMetadata?.timecodeStart ?? 0
  const activeSequenceTimecodeDropFrame = Boolean(activeSequenceMetadata?.timecodeDropFrame)
  const captureProgramReference = useCallback(() => {
    const canvas = programScopeFrame?.canvas
    const context = canvas?.getContext('2d', { willReadFrequently: true })
    if (!canvas || !context || !canvas.width || !canvas.height) {
      setToast('기준으로 저장할 프로그램 프레임이 없습니다.')
      return
    }
    try {
      setProgramReferenceFrame({ sequenceId: activeSequenceId, time: playhead, image: context.getImageData(0, 0, canvas.width, canvas.height) })
      setReferenceComparisonEnabled(true)
      setToast(`현재 ${formatTimecode(playhead, true, activeSequenceFps)} 프레임을 컬러 비교 기준으로 저장했습니다.`)
    } catch {
      setToast('현재 프로그램 프레임을 비교 기준으로 저장하지 못했습니다.')
    }
  }, [activeSequenceFps, activeSequenceId, playhead, programScopeFrame])
  const exportProgramFrame = useCallback(async (format: 'png' | 'jpeg') => {
    const canvas = programScopeFrame?.canvas
    if (!canvas || !canvas.width || !canvas.height) {
      setToast('저장할 프로그램 프레임이 없습니다.')
      return
    }
    try {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('프레임 이미지 인코딩 실패')), format === 'jpeg' ? 'image/jpeg' : 'image/png', format === 'jpeg' ? 0.95 : undefined))
      const frameNumber = Math.max(0, Math.round(playhead * activeSequenceFps)).toString().padStart(8, '0')
      const sequenceName = activeSequenceMetadata?.name ?? 'sequence'
      const path = await saveFrameImage(await blob.arrayBuffer(), `${sequenceName}-frame-${frameNumber}`, format)
      if (path) setToast(`현재 프레임을 ${format === 'jpeg' ? 'JPEG' : 'PNG'}로 저장했습니다: ${path}`)
    } catch (error) {
      setToast(error instanceof Error ? `프레임 저장 실패: ${error.message}` : '현재 프레임을 저장하지 못했습니다.')
    }
  }, [activeSequenceFps, activeSequenceMetadata?.name, playhead, programScopeFrame])

  const captureActiveSequence = useCallback((): ProjectSequence => {
    const current = sequenceLibrary.find((sequence) => sequence.id === activeSequenceId)
    return {
      ...current,
      id: activeSequenceId,
      name: current?.name ?? '메인 시퀀스',
      kind: current?.kind ?? 'main',
      playhead,
      workArea: sequenceWorkArea,
      loopPlayback: sequenceLoopPlayback,
      aspectRatio,
      width: preset.width,
      height: preset.height,
      fps: current?.fps ?? 30,
      tracks,
      transcript,
      suggestions,
      markers,
      audioBuses,
      createdAt: current?.createdAt ?? createdAt,
    }
  }, [activeSequenceId, aspectRatio, audioBuses, createdAt, markers, playhead, preset.height, preset.width, sequenceLibrary, sequenceLoopPlayback, sequenceWorkArea, suggestions, tracks, transcript])
  const activeSequenceKind = sequenceLibrary.find((sequence) => sequence.id === activeSequenceId)?.kind ?? 'main'
  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId)
  const selectedSourceAsset = selectedAsset?.parentAssetId ? assets.find((asset) => asset.id === selectedAsset.parentAssetId) ?? selectedAsset : selectedAsset
  const sourceDuration = selectedAsset ? (selectedAsset.kind === 'image' ? 5 : Math.max(0.01, interpretedSourceDuration(selectedAsset.duration, selectedSourceAsset))) : 0
  const selectedClip = tracks.flatMap((track) => track.clips).find((clip) => clip.id === selectedClipId)
  const selectedClipTrack = tracks.find((track) => track.clips.some((clip) => clip.id === selectedClipId))
  const selectedClipLocked = selectedClipTrack?.locked ?? false
  const selectedMulticamSequence = selectedClip?.nestedSequenceId && selectedClip.multicamAngle !== undefined ? sequenceLibrary.find((sequence) => sequence.id === selectedClip.nestedSequenceId && sequence.kind === 'multicam') : undefined
  const selectedMulticamTime = selectedClip ? clipSourceTime(selectedClip, playhead) : 0
  const multicamPreviewAngles = selectedMulticamSequence?.tracks.filter((track) => track.kind === 'video').map((track, index) => {
    const angleClip = track.clips.find((clip) => selectedMulticamTime >= clip.start && selectedMulticamTime < clip.start + clip.duration) ?? track.clips[0]
    const angleAsset = angleClip?.assetId ? resolvePreviewMediaAsset(assets.find((asset) => asset.id === angleClip.assetId)) : undefined
    return { index, name: track.name, asset: angleAsset, sourceTime: angleClip ? clipSourceTime(angleClip, selectedMulticamTime) : 0, active: selectedClip?.multicamAngle === index }
  }) ?? []
  const flattenedTracks = useMemo(() => flattenNestedTracks(tracks, sequenceLibrary), [sequenceLibrary, tracks])
  const selectedResolvedAsset = selectedAsset && selectedSourceAsset ? { ...selectedAsset, url: selectedSourceAsset.url, sourceFile: selectedSourceAsset.sourceFile, sourcePath: selectedSourceAsset.sourcePath, streamingSource: selectedSourceAsset.streamingSource, status: selectedSourceAsset.status, error: selectedSourceAsset.error, proxyFile: selectedSourceAsset.proxyFile, proxyUrl: selectedSourceAsset.proxyUrl, proxyStatus: selectedSourceAsset.proxyStatus, proxyWidth: selectedSourceAsset.proxyWidth, proxyHeight: selectedSourceAsset.proxyHeight, proxyFrameRate: selectedSourceAsset.proxyFrameRate, proxySize: selectedSourceAsset.proxySize, useProxy: selectedSourceAsset.useProxy, masterEffectsEnabled: selectedSourceAsset.masterEffectsEnabled, masterColorAdjustment: selectedSourceAsset.masterColorAdjustment, masterVisualEffects: selectedSourceAsset.masterVisualEffects, masterAudioAdjustment: selectedSourceAsset.masterAudioAdjustment, sourceRotation: selectedSourceAsset.sourceRotation, sourcePixelAspectRatio: selectedSourceAsset.sourcePixelAspectRatio, sourceFrameRateOverride: selectedSourceAsset.sourceFrameRateOverride, sourceFieldOrder: selectedSourceAsset.sourceFieldOrder, sourceColorSpaceOverride: selectedSourceAsset.sourceColorSpaceOverride, sourceAlphaMode: selectedSourceAsset.sourceAlphaMode, sourceAlphaBackground: selectedSourceAsset.sourceAlphaBackground, sourceAudioLayout: selectedSourceAsset.sourceAudioLayout, audioStreams: selectedSourceAsset.audioStreams, sourceAudioStreamIndex: selectedSourceAsset.sourceAudioStreamIndex } : selectedAsset
  const effectivePreviewAsset = resolvePreviewMediaAsset(selectedResolvedAsset)
  const activeTrackMattes = flattenedTracks.flatMap((track) => track.clips.filter((clip) => clip.enabled !== false && playhead >= clip.start && playhead < clip.start + clip.duration && clip.trackMatte).map((clip) => clip.trackMatte!))
  const referencedMatteTrackIds = new Set(activeTrackMattes.map((matte) => matte.sourceTrackId))
  const hiddenMatteTrackIds = new Set(activeTrackMattes.filter((matte) => !matte.showSource).map((matte) => matte.sourceTrackId))
  const activeProgramLayers = flattenedTracks.flatMap((track, order) => track.kind !== 'video' || track.muted || (track.visible === false && !referencedMatteTrackIds.has(track.id)) ? [] : activeVisualClipsAt(track.clips.filter((clip) => !clip.adjustmentLayer), playhead, activeSequenceFps)
    .flatMap((clip) => {
      const original = assets.find((asset) => asset.id === clip.assetId)
      const asset = resolvePreviewMediaAsset(original)
      if (!asset) return []
      return [{ clip: constrainTransitionCarryToAsset(clip, asset, activeSequenceFps, playhead), asset, trackId: track.id, matteOnly: hiddenMatteTrackIds.has(track.id), order: (track.compositePriority ?? order * 100) + (clip.compositePriority ?? 0) }]
    }))
  const activeAdjustmentClips = flattenedTracks.flatMap((track) => track.kind !== 'video' || track.muted || track.visible === false ? [] : track.clips.filter((clip) => clip.enabled !== false && clip.adjustmentLayer && playhead >= clip.start && playhead < clip.start + clip.duration))
  const hasSoloAudio = flattenedTracks.some((track) => (track.kind === 'audio' || track.kind === 'video') && track.solo)
  const activeAudioLayers = flattenedTracks.flatMap((track) => {
    if ((track.kind !== 'audio' && track.kind !== 'video') || track.muted || (hasSoloAudio && !track.solo)) return []
    const transitionTrack = { ...track, clips: clipsWithAudioTransitionTails(track.clips, activeSequenceFps) }
    return transitionTrack.clips
    .filter((clip) => clip.enabled !== false && !clip.audioDisabled && (playhead >= clip.start && playhead < clip.start + clip.duration || isPlaying && (Boolean(clip.reverse) || (clip.audioAdjustment?.preservePitch ?? true) && clipNeedsPitchStretch(clip)) && playhead < clip.start && playhead >= clip.start - 1.25))
    .flatMap((clip) => {
      const original = assets.find((item) => item.id === clip.assetId)
      const asset = resolvePreviewMediaAsset(original)
      if (!asset) return []
      return [{ clip, asset, track: transitionTrack }]
    })
  })
  const activeCaptionClips = flattenedTracks.flatMap((track) => track.kind !== 'caption' || track.muted || track.visible === false ? [] : activeVisualClipsAt(track.clips, playhead, activeSequenceFps))
  const timelineLoopRange = adrLoopRange ?? (sequenceLoopPlayback ? sequenceWorkArea : undefined)
  const workspaceStyle = {
    '--workspace-media-width': `${workspacePreferences.mediaWidth}px`,
    '--workspace-inspector-width': `${workspacePreferences.inspectorWidth}px`,
    '--workspace-timeline-size': `${workspacePreferences.timelinePercent}%`,
    '--workspace-monitor-size': `${100 - workspacePreferences.timelinePercent}%`,
  } as CSSProperties

  const changeWorkspacePreset = useCallback((presetId: WorkspacePresetId) => {
    setWorkspacePreferences((current) => applyWorkspacePreset(current, presetId))
    if (presetId === 'captions') setActivePanel('transcript')
    else if (presetId === 'editing') setActivePanel('media')
  }, [])

  const resizeWorkspace = useCallback((patch: Partial<WorkspaceDimensions>) => {
    setWorkspacePreferences((current) => updateWorkspaceDimensions(current, patch))
  }, [])

  const saveCustomWorkspace = useCallback(() => {
    setWorkspacePreferences((current) => ({
      ...current,
      preset: 'custom',
      savedCustom: {
        mediaWidth: current.mediaWidth,
        inspectorWidth: current.inspectorWidth,
        timelinePercent: current.timelinePercent,
      },
    }))
    setToast('현재 패널 구성을 사용자 작업공간으로 저장했습니다.')
  }, [])

  useEffect(() => {
    writeWorkspacePreferences(workspacePreferences)
  }, [workspacePreferences])

  useEffect(() => {
    if (!activeProgramLayers.length) setProgramScopeFrame(undefined)
  }, [activeProgramLayers.length, activeSequenceId])
  const sourceTime = 0
  const previewSyncKey = selectedAsset ? `source-${selectedAsset.id}` : `program-${activeProgramLayers.map((layer) => layer.clip.id).join('-') || 'empty'}`
  const timelineDuration = Math.max(activeSequenceKind === 'shorts' ? 15 : 120, ...tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration + 10)))
  useEffect(() => {
    if (!selectionFollowsPlayhead || selectedAssetId) return
    const targetTracks = tracks.filter((track) => track.editTarget !== false)
    const preferredTrack = targetTracks.find((track) => track.id === selectedTrackId)
    const activeOnTrack = (track: TimelineTrack) => track.clips.find((clip) => playhead >= clip.start && playhead < clip.start + clip.duration)
    const primary = preferredTrack ? activeOnTrack(preferredTrack) : undefined
    const resolvedPrimary = primary ?? targetTracks.flatMap((track) => activeOnTrack(track) ?? []).find(Boolean)
    if (!resolvedPrimary) {
      setSelectedClipId(undefined)
      setSelectedClipIds(new Set())
      return
    }
    const selected = tracks.flatMap((track) => track.clips.filter((clip) => clip.id === resolvedPrimary.id || Boolean(resolvedPrimary.groupId && clip.groupId === resolvedPrimary.groupId) || Boolean(linkedSelectionEnabled && resolvedPrimary.linkGroupId && clip.linkGroupId === resolvedPrimary.linkGroupId)))
    setSelectedClipId(resolvedPrimary.id)
    setSelectedClipIds(new Set(selected.map((clip) => clip.id)))
    const track = tracks.find((candidate) => candidate.clips.some((clip) => clip.id === resolvedPrimary.id))
    if (track) setSelectedTrackId(track.id)
  }, [linkedSelectionEnabled, playhead, selectedAssetId, selectedTrackId, selectionFollowsPlayhead, tracks])
  const transcribableAsset = [selectedResolvedAsset, ...assets]
    .flatMap((asset) => {
      const preview = resolvePreviewMediaAsset(asset)
      return preview && (preview.kind === 'video' || preview.kind === 'audio') && preview.sourceFile ? [preview] : []
    })[0]
  const exportableVideoClips = flattenedTracks.filter((track) => track.kind === 'video' && !track.muted && track.visible !== false).flatMap((track) => track.clips).filter((clip) => {
    const asset = assets.find((item) => item.id === clip.assetId)
    return asset?.status === 'ready' && asset.sourceFile
  })
  const exportableAudioClips = flattenedTracks.filter((track) => (track.kind === 'video' || track.kind === 'audio') && !track.muted).flatMap((track) => track.clips).filter((clip) => {
    if (clip.enabled === false || clip.audioDisabled) return false
    const asset = assets.find((item) => item.id === clip.assetId)
    return Boolean(asset?.status === 'ready' && asset.sourceFile && (asset.kind === 'audio' || asset.audioCodec || asset.channels))
  })
  const exportDuration = Math.max(0, ...flattenedTracks.filter((track) => !track.muted).flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)))
  const exportSelectedRange = useMemo(() => {
    const selected = tracks.flatMap((track) => track.clips.filter((clip) => selectedClipIds.has(clip.id)))
    return selected.length ? { start: Math.min(...selected.map((clip) => clip.start)), end: Math.max(...selected.map((clip) => clip.start + clip.duration)) } : undefined
  }, [selectedClipIds, tracks])
  const shortsCandidates = useMemo(() => generateShortsCandidates(transcript, tracks, { assets, suggestions, markers }), [assets, markers, suggestions, tracks, transcript])
  const performanceHealth = useMemo(() => assessTimelinePerformance(tracks), [tracks])
  const graphSequences = useMemo(() => sequenceLibrary.map((sequence) => sequence.id === activeSequenceId ? { ...sequence, aspectRatio, width: preset.width, height: preset.height, tracks, transcript, suggestions, markers, audioBuses, workArea: sequenceWorkArea, loopPlayback: sequenceLoopPlayback } : sequence), [activeSequenceId, aspectRatio, audioBuses, markers, preset.height, preset.width, sequenceLibrary, sequenceLoopPlayback, sequenceWorkArea, suggestions, tracks, transcript])
  const queuedRenderAssetIds = useMemo(() => renderQueueReferencedAssetIds(renderJobs), [renderJobs])
  const projectUsedAssetIds = useMemo(() => new Set([
    ...graphSequences.flatMap((sequence) => sequence.tracks.flatMap((track) => track.clips.flatMap((clip) => [...[clip.assetId, clip.subclipId].filter((id): id is string => Boolean(id)), ...renderReplacementSourceAssetIds(clip)]))),
    ...adrCues.flatMap((cue) => cue.takes.map((take) => take.assetId)),
    ...queuedRenderAssetIds,
  ]), [adrCues, graphSequences, queuedRenderAssetIds])
  const staleSequenceIds = useMemo(() => staleDerivedSequenceIds(graphSequences), [graphSequences])
  const sourceGraphBatchInspection = useMemo(() => inspectSourceGraphBatch(graphSequences), [graphSequences])
  const deliveryIssues = useMemo(() => inspectDelivery({ tracks: flattenedTracks, sourceTracks: tracks, assets, sequences: graphSequences, aspectRatio, audioBuses, activeSequenceId, markers, mergeSessions, adrCues }), [activeSequenceId, adrCues, aspectRatio, assets, audioBuses, flattenedTracks, graphSequences, markers, mergeSessions, tracks])
  const deliveryBlocked = deliveryIssues.some((issue) => issue.level === 'blocker')

  useEffect(() => {
    assetsRef.current = assets
  }, [assets])

  useEffect(() => {
    const timers = assets.filter((asset) => asset.status === 'analyzing').map((asset) => {
      const importedAt = asset.importedAt ? Date.parse(asset.importedAt) : Number.NaN
      const startedAt = asset.analysisStartedAt ?? (Number.isFinite(importedAt) ? importedAt : Date.now())
      const remaining = Math.max(0, 20_000 - (Date.now() - startedAt))
      return window.setTimeout(() => {
        setAssets((current) => current.map((item) => item.id === asset.id && item.status === 'analyzing' ? {
          ...item,
          status: 'error',
          analysisStartedAt: undefined,
          error: '기본 미디어 분석이 20초 안에 끝나지 않아 중단했습니다. 같은 파일을 다시 가져오면 자동으로 재시도합니다.',
        } : item))
      }, remaining)
    })
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [assets])

  useEffect(() => {
    setIsPlaying(false)
    setSourcePlayhead(0)
    setSourceInPoint(undefined)
    setSourceOutPoint(undefined)
  }, [selectedAssetId])

  const hydrateCachedProxies = useCallback(async (candidates: MediaAsset[]) => {
    const cachedAssets = candidates.filter((asset) => (asset.kind === 'video' || asset.kind === 'audio' || asset.kind === 'image') && (asset.proxyCachePath || asset.proxySourcePath))
    if (!cachedAssets.length) return
    if (!runningInDesktop()) {
      setAssets((current) => current.map((asset) => asset.proxyStatus === 'loading' ? { ...asset, proxyStatus: 'none' } : asset))
      return
    }

    await Promise.all(cachedAssets.map(async (asset) => {
      try {
        let proxyFile = asset.proxyCachePath ? await loadProxyFile(asset.proxyCachePath, asset.name) : undefined
        const externalPath = asset.proxySourcePath ?? (!proxyFile ? asset.proxyCachePath : undefined)
        if (!proxyFile && externalPath) {
          const external = await readMediaFilesFromPaths([externalPath])
          proxyFile = external.files[0]
        }
        if (!proxyFile) {
          const attached = Boolean(asset.proxySourcePath)
          setAssets((current) => current.map((item) => item.id === asset.id ? attached
            ? { ...item, proxyStatus: 'error', proxyError: '연결된 외부 프록시를 찾지 못했습니다. 프록시를 다시 연결해주세요.', useProxy: false }
            : { ...item, proxyCachePath: undefined, proxyOrigin: undefined, proxyPurpose: undefined, proxyEnabled: undefined, proxyCachedAt: undefined, proxySize: undefined, proxyWidth: undefined, proxyHeight: undefined, proxyFrameRate: undefined, proxyTimecode: undefined, proxyTimecodeVerified: undefined, proxyTimecodeMismatch: undefined, proxyStatus: 'none', useProxy: false } : item))
          return
        }
        const latest = assetsRef.current.find((item) => item.id === asset.id)
        if (latest?.proxyUrl || latest?.proxyCachePath !== asset.proxyCachePath || latest?.proxySourcePath !== asset.proxySourcePath) return
        const proxyUrl = proxyPreviewUrl(proxyFile)
        setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, proxyFile, proxyUrl, proxySize: proxyFileSize(proxyFile), proxyPurpose: item.proxyPurpose ?? (item.proxySourcePath ? 'external' : item.videoDecodable === false || item.audioDecodable === false || item.imageDecodable === false ? 'compatibility' : 'editing'), proxyStatus: 'ready', useProxy: item.status === 'offline' || item.videoDecodable === false || item.audioDecodable === false || item.imageDecodable === false || item.proxyEnabled !== false } : item))
      } catch (error) {
        const message = error instanceof Error ? error.message : '디스크 프록시를 불러오지 못했습니다.'
        setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, proxyStatus: 'error', proxyError: message, useProxy: false } : item))
      }
    }))
  }, [])

  useEffect(() => {
    if (initialProxyRestoreStartedRef.current) return
    initialProxyRestoreStartedRef.current = true
    void authorizeKnownScratchRoots().then(() => hydrateCachedProxies(assetsRef.current))
  }, [hydrateCachedProxies])

  useEffect(() => {
    tracksRef.current = tracks
    transcriptRef.current = transcript
    suggestionsRef.current = suggestions
    markersRef.current = markers
  }, [markers, suggestions, tracks, transcript])

  useEffect(() => {
    setSelectedClipIds((current) => {
      if (!selectedClipId) return current.size ? new Set() : current
      if (current.has(selectedClipId)) return current
      return new Set([selectedClipId])
    })
  }, [selectedClipId])

  useEffect(() => {
    const available = new Set(tracks.flatMap((track) => track.clips.map((clip) => clip.id)))
    setSelectedClipIds((current) => {
      const retained = new Set([...current].filter((id) => available.has(id)))
      return retained.size === current.size ? current : retained
    })
  }, [tracks])

  useEffect(() => () => {
    proxyAbortRef.current.forEach((controller) => controller.abort())
    proxyBatchStateRef.current?.queuedIds.clear()
    exportAbortRef.current?.abort()
    exportPauseRef.current?.resume()
    comfyAbortRef.current?.abort()
    assetsRef.current.forEach((asset) => {
      releaseImageSequenceUrls(asset)
      releaseObjectUrl(asset.url)
      releaseObjectUrl(asset.proxyUrl)
    })
    const locked = projectLockRef.current
    if (locked) void releaseProjectLock(locked.path, projectLockInstanceRef.current).catch(() => undefined)
  }, [])

  useEffect(() => {
    projectLockRef.current = projectFilePath && projectLock ? { path: projectFilePath, lock: projectLock } : undefined
  }, [projectFilePath, projectLock])

  useEffect(() => {
    if (!projectFilePath || !projectLock) return
    let stopped = false
    const heartbeat = async () => {
      try {
        const owned = await heartbeatProjectLock(projectFilePath, projectLockInstanceRef.current)
        if (!owned && !stopped) {
          setProjectLock(undefined)
          setProjectFilePath(undefined)
          setToast('공유 프로젝트 잠금을 잃었습니다. 다른 파일로 저장해 현재 변경을 보호하세요.')
        }
      } catch (error) {
        if (!stopped) setToast(error instanceof Error ? error.message : '공유 프로젝트 잠금 heartbeat에 실패했습니다.')
      }
    }
    const interval = window.setInterval(() => { void heartbeat() }, 15_000)
    return () => { stopped = true; window.clearInterval(interval) }
  }, [projectFilePath, projectLock])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(undefined), 3000)
    return () => window.clearTimeout(timeout)
  }, [toast])

  useEffect(() => {
    let cancelled = false
    void currentEditWeaveVersion().then((version) => {
      if (cancelled) return
      const result = reconcileStoredUpdateAttempt(version)
      if (result.status === 'applied') setToast(`EditWeave ${result.targetVersion} 업데이트가 적용되었습니다.`)
      else if (result.status === 'not-applied') setToast(`EditWeave ${result.targetVersion} 업데이트가 적용되지 않았습니다. 업데이트 확인에서 기존 설치 파일을 다시 검증할 수 있습니다.`)
      else if (result.status === 'expired') setToast(`EditWeave ${result.targetVersion} 업데이트 재시도 기록이 만료되었습니다. 새 설치 파일을 받아주세요.`)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    writeRenderQueue(renderJobs)
  }, [renderJobs])

  useEffect(() => {
    writeShortcuts(shortcuts)
  }, [shortcuts])

  const updateRenderJob = useCallback((id: string, patch: Partial<RenderQueueJob>) => {
    setRenderJobs((jobs) => jobs.map((job) => job.id === id ? { ...job, ...patch, updatedAt: new Date().toISOString() } : job))
  }, [])

  useEffect(() => {
    setSaveState('변경사항 저장 중…')
    const timeout = window.setTimeout(() => {
      const document = createProjectDocument({ id: projectId, createdAt, name: projectName, aspectRatio, assets, mediaBins, tracks, transcript, suggestions, markers, audioBuses, playhead: autosavePlayheadRef.current, activeSequenceId, sequences: sequenceLibrary, correctionDictionary, speakerVoiceProfiles, adrCues, creatorLearningProfile, mergeSessions, aiActivityLog })
      const saved = saveAutosave(document)
      setSaveState(saved ? `자동 저장됨 · ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : '자동 저장 실패 · 프로젝트 파일로 저장하세요')
    }, 650)
    return () => window.clearTimeout(timeout)
  }, [activeSequenceId, adrCues, aiActivityLog, aspectRatio, assets, audioBuses, correctionDictionary, createdAt, creatorLearningProfile, markers, mediaBins, mergeSessions, projectId, projectName, sequenceLibrary, speakerVoiceProfiles, suggestions, tracks, transcript])

  useEffect(() => {
    if (!isPlaying) {
      playbackClockRef.current = undefined
      playbackRenderAtRef.current = 0
      return
    }

    let frameId = 0
    const tick = (now: number) => {
      const renderIntervalMs = 1000 / Math.max(24, Math.min(60, activeSequenceFps))
      if (playbackRenderAtRef.current && now - playbackRenderAtRef.current < renderIntervalMs) {
        frameId = requestAnimationFrame(tick)
        return
      }
      playbackRenderAtRef.current = now
      if (selectedAssetId) {
        setSourcePlayhead((current) => {
          const previous = playbackClockRef.current
          const rebased = !previous || previous.mode !== 'source' || Math.abs(previous.position - current) > 1 / 120
          const origin = rebased ? current : previous.position
          const sampledAtMs = rebased ? now : previous.sampledAtMs
          const next = origin + Math.max(0, (now - sampledAtMs) / 1000) * shuttleRate
          const begin = sourceInPoint ?? 0
          const end = sourceOutPoint ?? sourceDuration
          if (next >= end) {
            playbackClockRef.current = { mode: 'source', sampledAtMs: now, position: end }
            setIsPlaying(false)
            return end
          }
          if (shuttleRate < 0 && next <= begin) {
            playbackClockRef.current = { mode: 'source', sampledAtMs: now, position: begin }
            setIsPlaying(false)
            return begin
          }
          playbackClockRef.current = { mode: 'source', sampledAtMs: now, position: next }
          return next
        })
      } else {
        setPlayhead((current) => {
          const previous = playbackClockRef.current
          const rebased = !previous || previous.mode !== 'timeline' || Math.abs(previous.position - current) > 1 / 120
          const origin = rebased ? current : previous.position
          const sampledAtMs = rebased ? now : previous.sampledAtMs
          let next = origin + Math.max(0, (now - sampledAtMs) / 1000) * shuttleRate
          if (timelineLoopRange && shuttleRate > 0 && next >= timelineLoopRange.end) {
            const loopDuration = Math.max(1 / 120, timelineLoopRange.end - timelineLoopRange.start)
            next = timelineLoopRange.start + (next - timelineLoopRange.start) % loopDuration
          }
          if (timelineLoopRange && shuttleRate < 0 && next <= timelineLoopRange.start) {
            const loopDuration = Math.max(1 / 120, timelineLoopRange.end - timelineLoopRange.start)
            next = timelineLoopRange.end - (timelineLoopRange.start - next) % loopDuration
          }
          if (next >= timelineDuration) {
            playbackClockRef.current = { mode: 'timeline', sampledAtMs: now, position: timelineDuration }
            setIsPlaying(false)
            return timelineDuration
          }
          if (shuttleRate < 0 && next <= 0) {
            playbackClockRef.current = { mode: 'timeline', sampledAtMs: now, position: 0 }
            setIsPlaying(false)
            return 0
          }
          playbackClockRef.current = { mode: 'timeline', sampledAtMs: now, position: next }
          return next
        })
      }
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [activeSequenceFps, isPlaying, selectedAssetId, shuttleRate, sourceDuration, sourceInPoint, sourceOutPoint, timelineDuration, timelineLoopRange])

  const updateAdrCues = useCallback((update: AdrCue[] | ((current: AdrCue[]) => AdrCue[])) => {
    const next = typeof update === 'function' ? update(adrCuesRef.current) : update
    adrCuesRef.current = next
    setAdrCues(next)
  }, [])

  const beginAiActivity = useCallback((input: Parameters<typeof startAiActivity>[0]): string => {
    const record = startAiActivity(input)
    setAiActivityLog((current) => appendAiActivity(current, record))
    return record.id
  }, [])

  const endAiActivity = useCallback((id: string, update: Parameters<typeof finishAiActivity>[1]) => {
    setAiActivityLog((current) => updateAiActivity(current, id, (record) => finishAiActivity(record, update)))
  }, [])

  const buildProjectDocument = useCallback(() => createProjectDocument({
    id: projectId,
    createdAt,
    name: projectName,
    aspectRatio,
    assets,
    mediaBins,
    tracks,
    transcript,
    suggestions,
    markers,
    audioBuses,
    playhead,
    activeSequenceId,
    sequences: sequenceLibrary,
    correctionDictionary,
    speakerVoiceProfiles,
    adrCues,
    creatorLearningProfile,
    mergeSessions,
    aiActivityLog,
  }), [activeSequenceId, adrCues, aiActivityLog, aspectRatio, assets, audioBuses, correctionDictionary, createdAt, creatorLearningProfile, markers, mediaBins, mergeSessions, playhead, projectId, projectName, sequenceLibrary, speakerVoiceProfiles, suggestions, tracks, transcript])

  const commitEditor = useCallback((mutation: {
    tracks?: (current: TimelineTrack[]) => TimelineTrack[]
    transcript?: (current: TranscriptSegment[]) => TranscriptSegment[]
    suggestions?: (current: EditSuggestion[]) => EditSuggestion[]
    markers?: (current: TimelineMarker[]) => TimelineMarker[]
    audioBuses?: (current: AudioBusMap) => AudioBusMap
    adrCues?: (current: AdrCue[]) => AdrCue[]
  }) => {
    const before: EditorHistorySnapshot = {
      tracks: tracksRef.current,
      transcript: transcriptRef.current,
      suggestions: suggestionsRef.current,
      markers: markersRef.current,
      audioBuses: audioBusesRef.current,
      adrCues: adrCuesRef.current,
    }
    const next: EditorHistorySnapshot = {
      tracks: mutation.tracks?.(before.tracks) ?? before.tracks,
      transcript: mutation.transcript?.(before.transcript) ?? before.transcript,
      suggestions: mutation.suggestions?.(before.suggestions) ?? before.suggestions,
      markers: mutation.markers?.(before.markers) ?? before.markers,
      audioBuses: mutation.audioBuses?.(before.audioBuses) ?? before.audioBuses,
      adrCues: mutation.adrCues?.(before.adrCues) ?? before.adrCues,
    }
    if (next.tracks === before.tracks && next.transcript === before.transcript && next.suggestions === before.suggestions && next.markers === before.markers && next.audioBuses === before.audioBuses && next.adrCues === before.adrCues) return
    if (lanReviewSessionRef.current && next.markers !== before.markers) reconcileReviewMarkerDeletions(before.markers, next.markers, lanReviewDeletedIdsRef.current)
    setPast((items) => appendHistorySnapshot(items, before))
    setFuture([])
    tracksRef.current = next.tracks
    transcriptRef.current = next.transcript
    suggestionsRef.current = next.suggestions
    markersRef.current = next.markers
    audioBusesRef.current = next.audioBuses
    adrCuesRef.current = next.adrCues
    setTracks(next.tracks)
    setTranscript(next.transcript)
    setSuggestions(next.suggestions)
    setMarkers(next.markers)
    setAudioBuses(next.audioBuses)
    setAdrCues(next.adrCues)
  }, [])

  const commitTracks = useCallback((update: (current: TimelineTrack[]) => TimelineTrack[]) => {
    commitEditor({ tracks: update })
  }, [commitEditor])

  const updateTrackTransient = useCallback((id: string, patch: Partial<TimelineTrack>) => {
    const next = tracksRef.current.map((track) => track.id === id ? { ...track, ...patch } : track)
    tracksRef.current = next
    setTracks(next)
  }, [])

  const updateClipTransient = useCallback((id: string, patch: Partial<TimelineClip>) => {
    const next = tracksRef.current.map((track) => ({ ...track, clips: track.clips.map((clip) => clip.id === id ? { ...clip, ...patch } : clip) }))
    tracksRef.current = next
    setTracks(next)
  }, [])

  useEffect(() => {
    if (!lanReviewSession) return
    if (lanReviewSession.sequenceId !== activeSequenceId) {
      void stopLanReviewSession(lanReviewSession.token).catch(() => undefined)
      lanReviewSessionRef.current = undefined
      setLanReviewSession(undefined)
      setLanReviewError('시퀀스가 변경되어 이전 LAN 검토 세션을 종료했습니다.')
      return
    }
    let cancelled = false
    let syncing = false
    const synchronize = async () => {
      if (syncing) return
      syncing = true
      try {
        const localComments = markersRef.current.filter((marker) => marker.kind === 'comment')
        const deletedIds = [...lanReviewDeletedIdsRef.current]
        const remoteComments = await syncLanReviewSession(lanReviewSession.token, localComments, deletedIds)
        if (cancelled) return
        deletedIds.forEach((id) => lanReviewDeletedIdsRef.current.delete(id))
        const merged = mergeReviewComments(markersRef.current, remoteComments)
        if (merged.added || merged.updated) commitEditor({ markers: () => merged.markers })
        setLanReviewError(undefined)
      } catch (error) {
        if (!cancelled) setLanReviewError(error instanceof Error ? error.message : 'LAN 검토 코멘트를 동기화하지 못했습니다.')
      } finally {
        syncing = false
      }
    }
    void synchronize()
    const interval = window.setInterval(() => { void synchronize() }, 3000)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [activeSequenceId, commitEditor, lanReviewSession])

  const startLanReview = useCallback(async () => {
    if (lanReviewBusy) return
    setLanReviewBusy(true)
    setLanReviewError(undefined)
    try {
      const videoPath = await selectReviewVideoPath()
      if (!videoPath) return
      const now = new Date().toISOString()
      const comments = markersRef.current.filter((marker) => marker.kind === 'comment').map((marker) => ({ ...marker, updatedAt: marker.updatedAt ?? marker.createdAt ?? now }))
      const session = await startLanReviewSession({ token: crypto.randomUUID().replace(/-/g, ''), projectName, sequenceId: activeSequenceId, videoPath, comments })
      lanReviewSessionRef.current = session
      setLanReviewSession(session)
      setToast('같은 네트워크에서 열 수 있는 검토 링크를 시작했습니다.')
    } catch (error) {
      setLanReviewError(error instanceof Error ? error.message : 'LAN 검토 링크를 시작하지 못했습니다.')
    } finally {
      setLanReviewBusy(false)
    }
  }, [activeSequenceId, lanReviewBusy, projectName])

  const stopLanReview = useCallback(async () => {
    const session = lanReviewSession
    lanReviewSessionRef.current = undefined
    setLanReviewSession(undefined)
    setLanReviewError(undefined)
    if (session) await stopLanReviewSession(session.token).catch(() => undefined)
  }, [lanReviewSession])

  const commitAudioBus = useCallback((role: AudioRole, patch: Partial<AudioBusSettings>) => {
    commitEditor({ audioBuses: (current) => updateAudioBus(current, role, patch) })
  }, [commitEditor])

  const undo = useCallback(() => {
    const current = { tracks: tracksRef.current, transcript: transcriptRef.current, suggestions: suggestionsRef.current, markers: markersRef.current, audioBuses: audioBusesRef.current, adrCues: adrCuesRef.current }
    const transition = undoHistorySnapshot(past, current, future)
    if (!transition) return
    const previous = transition.value
    if (lanReviewSessionRef.current) reconcileReviewMarkerDeletions(current.markers, previous.markers, lanReviewDeletedIdsRef.current)
    setFuture(transition.future)
    tracksRef.current = previous.tracks
    transcriptRef.current = previous.transcript
    suggestionsRef.current = previous.suggestions
    markersRef.current = previous.markers
    audioBusesRef.current = previous.audioBuses
    adrCuesRef.current = previous.adrCues
    setTracks(previous.tracks)
    setTranscript(previous.transcript)
    setSuggestions(previous.suggestions)
    setMarkers(previous.markers)
    setAudioBuses(previous.audioBuses)
    setAdrCues(previous.adrCues)
    setPast(transition.past)
  }, [future, past])

  const redo = useCallback(() => {
    const current = { tracks: tracksRef.current, transcript: transcriptRef.current, suggestions: suggestionsRef.current, markers: markersRef.current, audioBuses: audioBusesRef.current, adrCues: adrCuesRef.current }
    const transition = redoHistorySnapshot(past, current, future)
    if (!transition) return
    const next = transition.value
    if (lanReviewSessionRef.current) reconcileReviewMarkerDeletions(current.markers, next.markers, lanReviewDeletedIdsRef.current)
    setPast(transition.past)
    tracksRef.current = next.tracks
    transcriptRef.current = next.transcript
    suggestionsRef.current = next.suggestions
    markersRef.current = next.markers
    audioBusesRef.current = next.audioBuses
    adrCuesRef.current = next.adrCues
    setTracks(next.tracks)
    setTranscript(next.transcript)
    setSuggestions(next.suggestions)
    setMarkers(next.markers)
    setAudioBuses(next.audioBuses)
    setAdrCues(next.adrCues)
    setFuture(transition.future)
  }, [future, past])

  const commitRippleDelete = useCallback((start: number, end: number, options: { addAudioFades?: boolean; clearSuggestions?: boolean; appliedSuggestionId?: string; updateTracks?: (removed: TimelineTrack[]) => TimelineTrack[]; forcedTrackIds?: Iterable<string> } = {}): boolean => {
    const range = normalizeRippleDeleteRange(start, end)
    if (range.duration <= 0) {
      setToast('리플 삭제 범위가 비어 있습니다.')
      return false
    }
    const blockers = inspectAdrRippleDelete(tracksRef.current, adrCuesRef.current, activeSequenceId, range.start, range.end)
    if (blockers.length) {
      setToast(blockers[0])
      return false
    }
    const timestamp = new Date().toISOString()
    commitEditor({
      tracks: (current) => {
        const removed = removeTimelineRange(current, range.start, range.end, options.forcedTrackIds)
        const updated = options.updateTracks?.(removed) ?? removed
        return options.addAudioFades ? addRippleBoundaryFades(updated, range.start) : updated
      },
      transcript: (current) => rippleDeleteTranscript(current, range.start, range.end),
      suggestions: options.clearSuggestions
        ? () => []
        : (current) => rippleDeleteSuggestions(current, range.start, range.end, options.appliedSuggestionId),
      markers: (current) => rippleDeleteMarkers(current, range.start, range.end, timestamp),
      adrCues: (current) => rippleDeleteAdrCues(current, activeSequenceId, range.start, range.end, timestamp),
    })
    setAdrLoopRange((current) => {
      if (!current || current.end <= range.start) return current
      if (current.start >= range.end) return { start: current.start - range.duration, end: current.end - range.duration }
      return undefined
    })
    setVoiceoverStart((current) => current >= range.end ? current - range.duration : current)
    return true
  }, [activeSequenceId, commitEditor])

  const commitRippleInsertGap = useCallback((at: number, duration: number, updateTracks: (gapped: TimelineTrack[]) => TimelineTrack[], forcedTrackIds: Iterable<string> = []): boolean => {
    if (duration <= 1 / 240) return false
    const blockers = inspectAdrRippleInsert(tracksRef.current, adrCuesRef.current, activeSequenceId, at)
    if (blockers.length) {
      setToast(blockers[0])
      return false
    }
    const timestamp = new Date().toISOString()
    commitEditor({
      tracks: (current) => updateTracks(insertTimelineGap(current, at, duration, forcedTrackIds)),
      transcript: (current) => rippleInsertTranscript(current, at, duration),
      suggestions: (current) => rippleInsertSuggestions(current, at, duration),
      markers: (current) => rippleInsertMarkers(current, at, duration, timestamp),
      adrCues: (current) => rippleInsertAdrCues(current, activeSequenceId, at, duration, timestamp),
    })
    setAdrLoopRange((current) => current && current.start >= at ? { start: current.start + duration, end: current.end + duration } : current)
    setVoiceoverStart((current) => current >= at ? current + duration : current)
    return true
  }, [activeSequenceId, commitEditor])

  const updateClip = useCallback((id: string, patch: Partial<TimelineClip>) => {
    const targetClip = tracksRef.current.flatMap((track) => track.clips).find((clip) => clip.id === id)
    if (targetClip?.adrCueId && ('start' in patch || 'duration' in patch || 'sourceOffset' in patch)) {
      setToast('ADR 테이크의 위치와 길이는 ADR 세션에서 관리됩니다.')
      return
    }
    if (tracksRef.current.some((track) => track.locked && track.clips.some((clip) => clip.id === id))) {
      setToast('잠긴 트랙의 클립은 수정할 수 없습니다.')
      return
    }
    commitTracks((current) => current.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => clip.id === id ? { ...clip, ...patch } : clip),
    })))
  }, [commitTracks])

  const applyClipAutomationToSelection = useCallback((sourceClipId: string) => {
    const source = tracksRef.current.flatMap((track) => track.clips).find((clip) => clip.id === sourceClipId)
    if (!source) return
    commitTracks((current) => current.map((track) => track.locked ? track : ({
      ...track,
      clips: track.clips.map((clip) => selectedClipIds.has(clip.id) && clip.id !== sourceClipId && !clip.adrCueId
        ? { ...clip, ...automationPatchForClip(source, clip) }
        : clip),
    })))
  }, [commitTracks, selectedClipIds])

  const applyEffectPresetToSelection = useCallback((sourceClipId: string, patch: Partial<TimelineClip>) => {
    commitTracks((current) => current.map((track) => track.locked ? track : ({
      ...track,
      clips: track.clips.map((clip) => {
        if (!selectedClipIds.has(clip.id) || clip.id === sourceClipId || clip.adrCueId || clip.kind === 'caption') return clip
        const compatible: Partial<TimelineClip> = {
          audioAdjustment: patch.audioAdjustment ? {
            ...structuredClone(patch.audioAdjustment),
            auxSends: patch.audioAdjustment.auxSends?.map((send) => ({ ...structuredClone(send), id: crypto.randomUUID() })),
          } : undefined,
          ...(clip.kind === 'video' ? {
            colorAdjustment: structuredClone(patch.colorAdjustment),
            visualEffects: structuredClone(patch.visualEffects),
            effectStack: patch.effectStack?.map((item) => ({ ...structuredClone(item), id: crypto.randomUUID() })),
          } : {}),
        }
        return { ...clip, ...compatible }
      }),
    })))
  }, [commitTracks, selectedClipIds])

  const applyAudioFadesToSelection = useCallback((sourceClipId: string) => {
    const source = tracksRef.current.flatMap((track) => track.clips).find((clip) => clip.id === sourceClipId)
    if (!source || source.kind === 'caption') return
    const sourceAudio = { ...defaultAudioAdjustment(), ...source.audioAdjustment }
    commitTracks((current) => current.map((track) => track.locked ? track : ({
      ...track,
      clips: track.clips.map((clip) => !selectedClipIds.has(clip.id) || clip.id === sourceClipId || clip.adrCueId || clip.kind === 'caption' ? clip : ({
        ...clip,
        audioAdjustment: {
          ...defaultAudioAdjustment(),
          ...clip.audioAdjustment,
          fadeIn: Math.min(clip.duration, sourceAudio.fadeIn),
          fadeOut: Math.min(clip.duration, sourceAudio.fadeOut),
          fadeInCurve: sourceAudio.fadeInCurve,
          fadeOutCurve: sourceAudio.fadeOutCurve,
        },
      })),
    })))
  }, [commitTracks, selectedClipIds])

  const applyTransitionPreset = useCallback((sourceClipId: string, edge: 'in' | 'out', presetTransition: ClipTransition | undefined, scope: 'selection' | 'linked') => {
    const source = tracksRef.current.flatMap((track) => track.clips).find((clip) => clip.id === sourceClipId)
    if (!source || source.kind === 'caption' || source.adrCueId) return
    const sourceBoundary = edge === 'in' ? source.start : source.start + source.duration
    const sourceMediaKind = source.kind === 'audio' ? 'audio' : 'video'
    const relationIds = new Set([source.groupId, source.linkGroupId].filter((id): id is string => Boolean(id)))
    let applied = 0
    commitTracks((current) => current.map((track) => track.locked ? track : ({
      ...track,
      clips: track.clips.map((clip) => {
        if (clip.kind === 'caption' || clip.adrCueId) return clip
        const mediaKind = clip.kind === 'audio' ? 'audio' : 'video'
        const boundary = edge === 'in' ? clip.start : clip.start + clip.duration
        const selectedTarget = scope === 'selection' && selectedClipIds.has(clip.id) && mediaKind === sourceMediaKind
        const linkedTarget = scope === 'linked'
          && Math.abs(boundary - sourceBoundary) <= 1 / 240
          && (clip.id === source.id || relationIds.has(clip.groupId ?? '') || relationIds.has(clip.linkGroupId ?? ''))
        if (!selectedTarget && !linkedTarget) return clip
        applied += 1
        if (!presetTransition) return { ...clip, [edge === 'in' ? 'transitionIn' : 'transitionOut']: undefined }
        const transition: ClipTransition = { ...structuredClone(presetTransition), type: mediaKind === 'audio' ? 'crossfade' : presetTransition.type }
        transition.duration = Math.min(transition.duration, (transition.alignment ?? 'center-on-cut') === 'center-on-cut' ? clip.duration * 2 : clip.duration)
        return { ...clip, [edge === 'in' ? 'transitionIn' : 'transitionOut']: transition }
      }),
    })))
    setToast(scope === 'linked'
      ? `링크된 영상·오디오 ${applied}개 편집점의 전환을 ${presetTransition ? '적용' : '제거'}했습니다.`
      : `선택한 ${applied}개 클립의 ${edge === 'in' ? '시작' : '끝'} 전환을 ${presetTransition ? '적용' : '제거'}했습니다.`)
  }, [commitTracks, selectedClipIds])

  const setDefaultTransitionFromPreset = useCallback((mediaKind: 'video' | 'audio', presetTransition: ClipTransition) => {
    const transition: ClipTransition = {
      ...structuredClone(presetTransition),
      type: mediaKind === 'audio' ? 'crossfade' : presetTransition.type,
    }
    const nextDefaults = normalizeSequenceTransitionDefaults({
      ...activeTransitionDefaults,
      [mediaKind]: transition,
    })
    setSequenceLibrary((sequences) => sequences.map((sequence) => sequence.id === activeSequenceId ? { ...sequence, transitionDefaults: nextDefaults } : sequence))
    setToast(`${mediaKind === 'audio' ? '오디오' : '영상'} 프리셋을 현재 시퀀스 기본 전환으로 지정했습니다.`)
  }, [activeSequenceId, activeTransitionDefaults])

  const applyCaptionStyleToTrack = useCallback((sourceClipId: string) => {
    const sourceTrack = tracksRef.current.find((track) => track.clips.some((clip) => clip.id === sourceClipId))
    const source = sourceTrack?.clips.find((clip) => clip.id === sourceClipId)
    if (!sourceTrack || sourceTrack.kind !== 'caption' || source?.kind !== 'caption') return
    const style = structuredClone({ ...defaultCaptionStyle(), ...source.captionStyle })
    commitTracks((current) => current.map((track) => track.id === sourceTrack.id ? {
      ...track,
      captionStyle: style,
      clips: track.clips.map((clip) => clip.kind === 'caption' ? { ...clip, captionStyle: structuredClone(style) } : clip),
    } : track))
    setToast(`“${sourceTrack.name}”의 모든 자막에 현재 스타일을 적용했습니다.`)
  }, [commitTracks])

  const deleteSelected = useCallback(() => {
    const payload = createClipClipboardPayload(tracksRef.current, selectedClipIds)
    if (!payload) {
      if (selectedClip?.adrCueId) setToast('ADR 테이크는 마이크 창의 대본 큐에서 삭제해주세요.')
      return
    }
    const removeIds = new Set(payload.entries.map((entry) => entry.clip.id))
    const blocked = tracksRef.current.some((track) => track.locked && track.clips.some((clip) => removeIds.has(clip.id)))
    if (blocked) {
      setToast('선택 범위에 잠긴 트랙의 클립이 있습니다. 잠금을 해제한 뒤 삭제해주세요.')
      return
    }
    if (payload.entries.some((entry) => entry.clip.adrCueId)) {
      setToast('ADR 테이크는 마이크 창의 대본 큐에서 삭제해주세요.')
      return
    }
    commitTracks((current) => current.map((track) => ({
      ...track,
      clips: track.clips.filter((clip) => !removeIds.has(clip.id)),
    })))
    setSelectedClipId(undefined)
    setSelectedClipIds(new Set())
  }, [commitTracks, selectedClip?.adrCueId, selectedClipIds])

  const toggleSelectedClipsEnabled = useCallback(() => {
    const editable = tracksRef.current.flatMap((track) => track.locked ? [] : track.clips.filter((clip) => selectedClipIds.has(clip.id)))
    if (!editable.length) {
      setToast('활성 상태를 바꿀 잠금 해제 클립이 없습니다.')
      return
    }
    const enabled = editable.some((clip) => clip.enabled === false)
    const editableIds = new Set(editable.map((clip) => clip.id))
    commitTracks((current) => current.map((track) => track.locked ? track : ({ ...track, clips: track.clips.map((clip) => editableIds.has(clip.id) ? { ...clip, enabled } : clip) })))
    setToast(`${editable.length}개 클립을 ${enabled ? '활성화' : '비활성화'}했습니다.`)
  }, [commitTracks, selectedClipIds])

  const setSelectedClipsColor = useCallback((color: string) => {
    const editableIds = new Set(tracksRef.current.flatMap((track) => track.locked ? [] : track.clips.filter((clip) => selectedClipIds.has(clip.id)).map((clip) => clip.id)))
    if (!editableIds.size) return
    commitTracks((current) => current.map((track) => track.locked ? track : ({ ...track, clips: track.clips.map((clip) => editableIds.has(clip.id) ? { ...clip, color } : clip) })))
  }, [commitTracks, selectedClipIds])

  const rippleDeleteSelected = useCallback(() => {
    const payload = createClipClipboardPayload(tracksRef.current, selectedClipIds)
    if (!payload) {
      setToast(selectedClip?.adrCueId ? 'ADR 테이크는 ADR 세션에서 관리해주세요.' : '리플 삭제할 클립을 선택해주세요.')
      return
    }
    const selectedIds = new Set(payload.entries.map((entry) => entry.clip.id))
    if (tracksRef.current.some((track) => track.locked && track.clips.some((clip) => selectedIds.has(clip.id)))) {
      setToast('선택 범위에 잠긴 트랙의 클립이 있어 리플 삭제하지 않았습니다.')
      return
    }
    const ranges = mergeTimelineRanges(payload.entries.map((entry) => ({ start: entry.clip.start, end: entry.clip.start + entry.clip.duration })))
    const blocker = ranges.flatMap((range) => inspectAdrRippleDelete(tracksRef.current, adrCuesRef.current, activeSequenceId, range.start, range.end))[0]
    if (blocker) {
      setToast(blocker)
      return
    }
    const descending = [...ranges].sort((left, right) => right.start - left.start)
    const timestamp = new Date().toISOString()
    commitEditor({
      tracks: (current) => descending.reduce((next, range) => addRippleBoundaryFades(removeTimelineRange(next, range.start, range.end, new Set(payload.entries.map((entry) => entry.trackId))), range.start), current),
      transcript: (current) => descending.reduce((next, range) => rippleDeleteTranscript(next, range.start, range.end), current),
      suggestions: (current) => descending.reduce((next, range) => rippleDeleteSuggestions(next, range.start, range.end), current),
      markers: (current) => descending.reduce((next, range) => rippleDeleteMarkers(next, range.start, range.end, timestamp), current),
      adrCues: (current) => descending.reduce((next, range) => rippleDeleteAdrCues(next, activeSequenceId, range.start, range.end, timestamp), current),
    })
    setAdrLoopRange((current) => {
      if (!current) return current
      if (ranges.some((range) => current.start < range.end && current.end > range.start)) return undefined
      return { start: rippleTimeThroughRanges(current.start, descending), end: rippleTimeThroughRanges(current.end, descending) }
    })
    setVoiceoverStart((current) => rippleTimeThroughRanges(current, descending))
    setPlayhead((current) => rippleTimeThroughRanges(current, descending))
    setSelectedClipId(undefined)
    setSelectedClipIds(new Set())
    setToast(`${payload.entries.length}개 선택 클립의 ${ranges.length}개 시간 구간을 리플 삭제했습니다.`)
  }, [activeSequenceId, commitEditor, selectedClip?.adrCueId, selectedClipIds])

  const closeGapAtPlayhead = useCallback(() => {
    const targetTracks = tracksRef.current.filter((track) => track.editTarget !== false && !track.locked)
    if (!targetTracks.length) {
      setToast('간격을 닫을 편집 대상 트랙이 없습니다.')
      return
    }
    const targetIds = new Set(targetTracks.map((track) => track.id))
    const participants = tracksRef.current.filter((track) => !track.locked && (track.syncLock !== false || targetIds.has(track.id)))
    const tolerance = 1 / Math.max(24, activeSequenceFps * 2)
    const active = participants.flatMap((track) => track.clips).find((clip) => clip.enabled !== false && clip.start <= playhead + tolerance && clip.start + clip.duration > playhead + tolerance)
    if (active) {
      setToast('재생 헤드가 클립 위에 있습니다. 모든 동기화 대상 트랙이 비어 있는 간격 안으로 옮겨주세요.')
      return
    }
    const clips = participants.flatMap((track) => track.clips.filter((clip) => clip.enabled !== false))
    const gapStart = clips.reduce((latest, clip) => clip.start + clip.duration <= playhead + tolerance ? Math.max(latest, clip.start + clip.duration) : latest, 0)
    const nextStarts = clips.flatMap((clip) => clip.start > playhead + tolerance ? [clip.start] : [])
    if (!nextStarts.length) {
      setToast('재생 헤드 뒤에 당겨올 클립이 없습니다.')
      return
    }
    const gapEnd = Math.min(...nextStarts)
    if (gapEnd - gapStart <= tolerance || playhead < gapStart - tolerance || playhead > gapEnd + tolerance) {
      setToast('닫을 수 있는 공통 빈 구간을 찾지 못했습니다.')
      return
    }
    if (!commitRippleDelete(gapStart, gapEnd, { forcedTrackIds: targetIds })) return
    setPlayhead(gapStart)
    setSelectedClipId(undefined)
    setSelectedClipIds(new Set())
    setToast(`${(gapEnd - gapStart).toFixed(2)}초의 빈 구간을 닫고 뒤 타임라인을 당겼습니다.`)
  }, [activeSequenceFps, commitRippleDelete, playhead])

  const copySelectedClips = useCallback(() => {
    const payload = createClipClipboardPayload(tracksRef.current, selectedClipIds)
    if (!payload) {
      setToast(selectedClip?.adrCueId ? 'ADR 테이크는 세션 참조를 유지하기 위해 일반 클립보드로 복사하지 않습니다.' : '복사할 클립을 선택해주세요.')
      return
    }
    clipClipboardRef.current = payload
    attributeSourceClipRef.current = structuredClone(tracksRef.current.flatMap((track) => track.clips).find((clip) => clip.id === selectedClipId) ?? payload.entries[0].clip)
    setHasClipClipboard(true)
    setToast(`${payload.entries.length}개 클립을 편집 클립보드에 복사했습니다.`)
  }, [selectedClip?.adrCueId, selectedClipId, selectedClipIds])

  const openPasteAttributes = useCallback(() => {
    if (!attributeSourceClipRef.current) {
      setToast('속성을 가져올 클립을 먼저 복사해주세요.')
      return
    }
    if (!selectedClipIds.size) {
      setToast('속성을 적용할 타임라인 클립을 선택해주세요.')
      return
    }
    setPasteAttributesOpen(true)
  }, [selectedClipIds])

  const pasteSelectedClipAttributes = useCallback((options: PasteAttributeOptions) => {
    const source = attributeSourceClipRef.current
    if (!source) return
    let applied = 0
    commitTracks((current) => current.map((track) => track.locked ? track : ({
      ...track,
      clips: track.clips.map((clip) => {
        if (!selectedClipIds.has(clip.id) || clip.adrCueId || clip.adjustmentLayer || clip.nestedSequenceId) return clip
        const patch = selectedAttributePatchForClip(source, clip, options)
        if (!Object.keys(patch).length) return clip
        applied += 1
        return { ...clip, ...patch }
      }),
    })))
    setPasteAttributesOpen(false)
    setToast(applied ? `“${source.name}”의 선택 속성을 ${applied}개 클립에 적용했습니다.` : '복사한 속성과 호환되는 잠금 해제 대상 클립이 없습니다.')
  }, [commitTracks, selectedClipIds])

  const cutSelectedClips = useCallback(() => {
    const payload = createClipClipboardPayload(tracksRef.current, selectedClipIds)
    if (!payload) {
      setToast(selectedClip?.adrCueId ? 'ADR 테이크는 잘라낼 수 없습니다.' : '잘라낼 클립을 선택해주세요.')
      return
    }
    const removeIds = new Set(payload.entries.map((entry) => entry.clip.id))
    if (tracksRef.current.some((track) => track.locked && track.clips.some((clip) => removeIds.has(clip.id)))) {
      setToast('선택 범위에 잠긴 트랙의 클립이 있어 잘라내지 않았습니다.')
      return
    }
    clipClipboardRef.current = payload
    setHasClipClipboard(true)
    commitTracks((current) => current.map((track) => ({ ...track, clips: track.clips.filter((clip) => !removeIds.has(clip.id)) })))
    setSelectedClipId(undefined)
    setSelectedClipIds(new Set())
    setToast(`${payload.entries.length}개 클립을 잘라냈습니다.`)
  }, [commitTracks, selectedClip?.adrCueId, selectedClipIds])

  const pasteClipClipboard = useCallback((at = playhead, pasteMode: EditMode = editMode) => {
    const payload = clipClipboardRef.current
    if (!payload?.entries.length) {
      setToast('편집 클립보드에 붙여넣을 클립이 없습니다.')
      return
    }
    const currentTracks = tracksRef.current
    const selectedTrack = currentTracks.find((track) => track.id === selectedTrackId && !track.locked)
    const groupIds = new Map<string, string>()
    const linkIds = new Map<string, string>()
    const nextId = (map: Map<string, string>, current?: string) => {
      if (!current) return undefined
      let replacement = map.get(current)
      if (!replacement) {
        replacement = crypto.randomUUID()
        map.set(current, replacement)
      }
      return replacement
    }
    const targetTrackBySourceId = new Map<string, TimelineTrack>()
    payload.entries.forEach((entry) => {
      if (targetTrackBySourceId.has(entry.trackId)) return
      const sourceTrack = currentTracks.find((track) => track.id === entry.trackId && track.kind === entry.trackKind && !track.locked)
      const targetTrack = sourceTrack ?? (selectedTrack?.kind === entry.trackKind ? selectedTrack : undefined) ?? currentTracks.find((track) => track.kind === entry.trackKind && !track.locked)
      if (targetTrack) targetTrackBySourceId.set(entry.trackId, targetTrack)
    })
    const targetTrackIds = new Map([...targetTrackBySourceId].map(([sourceId, target]) => [sourceId, target.id]))
    const copies = payload.entries.flatMap((entry) => {
      const targetTrack = targetTrackBySourceId.get(entry.trackId)
      if (!targetTrack) return []
      const clip = duplicateClipForPaste(entry.clip, targetTrack.id, targetTrackIds)
      return [{
        trackId: targetTrack.id,
        clip: {
          ...clip,
          name: `${clip.name} · 복사`,
          start: Math.max(0, at + clip.start - payload.baseStart),
          groupId: nextId(groupIds, clip.groupId),
          linkGroupId: nextId(linkIds, clip.linkGroupId),
        } satisfies TimelineClip,
      }]
    })
    if (!copies.length) {
      setToast('붙여넣을 종류의 잠금 해제 트랙이 없습니다.')
      return
    }
    const byTrack = new Map<string, TimelineClip[]>()
    copies.forEach(({ trackId, clip }) => byTrack.set(trackId, [...(byTrack.get(trackId) ?? []), clip]))
    const pastedDuration = Math.max(...copies.map(({ clip }) => clip.start + clip.duration)) - at
    if (pasteMode === 'insert') {
      const blockers = inspectAdrRippleInsert(tracksRef.current, adrCuesRef.current, activeSequenceId, at)
      if (blockers.length) {
        setToast(blockers[0])
        return
      }
    }
    if (pasteMode === 'overwrite') {
      const blockers = [...byTrack].flatMap(([trackId, clips]) => inspectAdrOverwrite(tracksRef.current, adrCuesRef.current, activeSequenceId, trackId, Math.min(...clips.map((clip) => clip.start)), Math.max(...clips.map((clip) => clip.start + clip.duration))))
      if (blockers.length) {
        setToast(blockers[0])
        return
      }
    }
    const rippleTimestamp = new Date().toISOString()
    commitEditor({
      tracks: (current) => {
        const prepared = pasteMode === 'insert' ? insertTimelineGap(current, at, pastedDuration, byTrack.keys()) : current
        return [...byTrack].reduce((next, [trackId, clips]) => clips.reduce((updated, clip) => insertTimelineClip(updated, trackId, clip, pasteMode === 'overwrite' ? 'overwrite' : 'append'), next), prepared)
      },
      transcript: pasteMode === 'insert' ? (current) => rippleInsertTranscript(current, at, pastedDuration) : undefined,
      suggestions: pasteMode === 'insert' ? (current) => rippleInsertSuggestions(current, at, pastedDuration) : undefined,
      markers: pasteMode === 'insert' ? (current) => rippleInsertMarkers(current, at, pastedDuration, rippleTimestamp) : undefined,
      adrCues: pasteMode === 'insert' ? (current) => rippleInsertAdrCues(current, activeSequenceId, at, pastedDuration, rippleTimestamp) : undefined,
    })
    setSelectedClipId(copies[0].clip.id)
    setSelectedClipIds(new Set(copies.map(({ clip }) => clip.id)))
    setSelectedTrackId(copies[0].trackId)
    setSelectedAssetId(undefined)
    setToast(`${copies.length}개 클립을 ${formatTimecode(at, true)}에 붙여넣었습니다.`)
  }, [activeSequenceId, commitEditor, editMode, playhead, selectedTrackId])

  const duplicateSelectedClips = useCallback(() => {
    const payload = createClipClipboardPayload(tracksRef.current, selectedClipIds)
    if (!payload) {
      setToast('복제할 일반 클립을 선택해주세요.')
      return
    }
    clipClipboardRef.current = payload
    setHasClipClipboard(true)
    const end = Math.max(...payload.entries.map((entry) => entry.clip.start + entry.clip.duration))
    pasteClipClipboard(end, 'append')
  }, [pasteClipClipboard, selectedClipIds])

  const arrangeSelectedClips = useCallback((mode: 'align-start' | 'align-end' | 'align-playhead' | 'distribute' | 'remove-gaps') => {
    const selected = tracksRef.current.flatMap((track) => track.clips.filter((clip) => selectedClipIds.has(clip.id)).map((clip) => ({ clip, track })))
    if (selected.length < 2) {
      setToast('정렬할 클립을 두 개 이상 선택해주세요.')
      return
    }
    if (selected.some(({ track }) => track.locked) || selected.some(({ clip }) => clip.adrCueId)) {
      setToast('잠긴 트랙 또는 ADR 테이크를 제외하고 정렬해주세요.')
      return
    }
    const starts = new Map<string, number>()
    if (mode === 'align-start' || mode === 'align-end' || mode === 'align-playhead') {
      const target = mode === 'align-start' ? Math.min(...selected.map(({ clip }) => clip.start)) : mode === 'align-end' ? Math.max(...selected.map(({ clip }) => clip.start + clip.duration)) : playhead
      selected.forEach(({ clip }) => starts.set(clip.id, mode === 'align-end' ? target - clip.duration : target))
    } else {
      const byTrack = new Map<string, TimelineClip[]>()
      selected.forEach(({ clip, track }) => byTrack.set(track.id, [...(byTrack.get(track.id) ?? []), clip]))
      for (const clips of byTrack.values()) {
        const ordered = clips.sort((left, right) => left.start - right.start)
        if (ordered.length < (mode === 'distribute' ? 3 : 2)) continue
        const firstStart = ordered[0].start
        const gap = mode === 'remove-gaps' ? 0 : ((ordered[ordered.length - 1].start + ordered[ordered.length - 1].duration - firstStart) - ordered.reduce((sum, clip) => sum + clip.duration, 0)) / (ordered.length - 1)
        if (gap < -1 / 240) {
          setToast('선택 범위가 클립 총 길이보다 짧아 동일 간격으로 배치할 수 없습니다.')
          return
        }
        let cursor = firstStart
        ordered.forEach((clip) => { starts.set(clip.id, cursor); cursor += clip.duration + Math.max(0, gap) })
      }
    }
    if (!starts.size) {
      setToast(mode === 'distribute' ? '같은 트랙에서 세 개 이상 선택해야 동일 간격으로 배치할 수 있습니다.' : '같은 트랙에서 두 개 이상 선택해주세요.')
      return
    }
    const moved = selected.filter(({ clip }) => starts.has(clip.id)).map(({ clip }) => ({ ...clip, start: Math.max(0, starts.get(clip.id)!) }))
    const movedIds = new Set(moved.map((clip) => clip.id))
    const collision = moved.some((clip, index) => moved.slice(index + 1).some((other) => other.trackId === clip.trackId && other.start < clip.start + clip.duration - 1 / 240 && other.start + other.duration > clip.start + 1 / 240))
      || moved.some((clip) => tracksRef.current.find((track) => track.id === clip.trackId)?.clips.some((other) => !movedIds.has(other.id) && other.start < clip.start + clip.duration - 1 / 240 && other.start + other.duration > clip.start + 1 / 240))
    if (collision) {
      setToast('정렬 결과가 같은 트랙의 다른 클립과 겹칩니다. 빈 공간을 확보하거나 다른 정렬 방식을 선택해주세요.')
      return
    }
    const movedById = new Map(moved.map((clip) => [clip.id, clip]))
    commitTracks((current) => current.map((track) => ({ ...track, clips: track.clips.map((clip) => movedById.get(clip.id) ?? clip).sort((left, right) => left.start - right.start) })))
    setToast(`${moved.length}개 클립을 ${mode === 'align-start' ? '시작점' : mode === 'align-end' ? '끝점' : mode === 'align-playhead' ? '재생 헤드' : mode === 'distribute' ? '동일 간격' : '간격 없이'} 기준으로 정리했습니다.`)
  }, [commitTracks, playhead, selectedClipIds])

  const matchSelectedClipLoudness = useCallback((targetLufs: number) => {
    const candidates = tracksRef.current.flatMap((track) => track.locked ? [] : track.clips
      .filter((clip) => selectedClipIds.has(clip.id) && !clip.audioDisabled && (clip.kind === 'audio' || clip.kind === 'video'))
      .map((clip) => ({ track, clip })))
    const shifts = new Map<string, number>()
    for (const { track, clip } of candidates) {
      const asset = assetsRef.current.find((item) => item.id === clip.assetId)
      if (!asset?.waveform?.length && asset?.audioPeak === undefined) continue
      const isolatedTrack: TimelineTrack = { ...track, muted: false, solo: false, volume: 100, pan: 0, mixKeyframes: undefined, clips: [clip] }
      const measured = estimateAudioLoudness([isolatedTrack], assetsRef.current, defaultAudioBuses())
      if (measured.lufs === undefined) continue
      shifts.set(clip.id, clamp(targetLufs - measured.lufs, -24, 24))
    }
    if (!shifts.size) {
      setToast('선택 클립에 러드니스 계산용 오디오 파형이나 피크 분석값이 없습니다.')
      return
    }
    commitTracks((current) => current.map((track) => track.locked ? track : ({
      ...track,
      clips: track.clips.map((clip) => {
        const shift = shifts.get(clip.id)
        if (shift === undefined) return clip
        const audioAdjustment = { ...defaultAudioAdjustment(), ...clip.audioAdjustment }
        return {
          ...clip,
          audioAdjustment: { ...audioAdjustment, gainDb: clamp(audioAdjustment.gainDb + shift, -48, 24) },
          audioMixKeyframes: clip.audioMixKeyframes?.map((keyframe) => ({ ...keyframe, gainDb: clamp(keyframe.gainDb + shift, -48, 24) })),
        }
      }),
    })))
    setToast(`${shifts.size}개 클립의 예상 러드니스를 ${targetLufs} LUFS에 맞췄습니다.`)
  }, [commitTracks, selectedClipIds])

  const splitClipAt = useCallback((clipId: string, at: number) => {
    const editTime = snapTimeToFrame(at, activeSequenceFps)
    const clip = tracksRef.current.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId)
    const track = tracksRef.current.find((candidate) => candidate.clips.some((item) => item.id === clipId))
    if (!clip || !track) return
    if (track.locked) {
      setToast('트랙 잠금을 해제한 뒤 분할해주세요.')
      return
    }
    if (clip.adrCueId) {
      setToast('ADR 테이크 분할은 세션 참조를 보호하기 위해 제한됩니다.')
      return
    }
    const offset = editTime - clip.start
    const minimumEdge = Math.max(1 / activeSequenceFps, 0.05)
    if (offset < minimumEdge || offset > clip.duration - minimumEdge) {
      setToast('클립 시작과 끝에서 한 프레임 이상 안쪽을 선택해주세요.')
      return
    }
    const targetIds = tracksRef.current.flatMap((track) => track.locked ? [] : track.clips
      .filter((candidate) => candidate.id === clip.id || Boolean(clip.groupId && candidate.groupId === clip.groupId) || Boolean(linkedSelectionEnabled && clip.linkGroupId && candidate.linkGroupId === clip.linkGroupId))
      .map((candidate) => candidate.id))
    if (tracksRef.current.flatMap((candidate) => candidate.clips).some((candidate) => targetIds.includes(candidate.id) && candidate.adrCueId)) {
      setToast('ADR 테이크 분할은 세션 참조를 보호하기 위해 제한됩니다.')
      return
    }
    const result = splitTimelineClipsAt(tracksRef.current, editTime, targetIds)
    if (!result.rightClipIds.length) return
    commitTracks(() => result.tracks)
    setSelectedClipId(result.rightClipIds[0])
    setSelectedClipIds(new Set(result.rightClipIds))
    const rightTrack = result.tracks.find((candidate) => candidate.clips.some((item) => item.id === result.rightClipIds[0]))
    if (rightTrack) setSelectedTrackId(rightTrack.id)
    setSelectedAssetId(undefined)
    setPlayhead(editTime)
    setToast(`${result.rightClipIds.length}개 클립에 ${formatTimecode(editTime, true, activeSequenceFps)} 편집점을 추가했습니다.`)
  }, [activeSequenceFps, commitTracks, linkedSelectionEnabled])

  const splitSelected = useCallback(() => {
    if (!selectedClip) return
    splitClipAt(selectedClip.id, playhead)
  }, [playhead, selectedClip, splitClipAt])

  const addEditAtPlayhead = useCallback((allTracks: boolean) => {
    const editTime = snapTimeToFrame(playhead, activeSequenceFps)
    const targetTracks = tracksRef.current.filter((track) => !track.locked && (allTracks || track.editTarget !== false))
    if (!targetTracks.length) {
      setToast(allTracks ? '편집점을 추가할 잠금 해제 트랙이 없습니다.' : '편집점을 추가할 소스 대상 트랙이 없습니다.')
      return
    }
    const clips = targetTracks.flatMap((track) => track.clips.filter((clip) => editTime > clip.start + 0.05 && editTime < clip.start + clip.duration - 0.05))
    if (!clips.length) {
      setToast('재생 헤드가 대상 클립 내부에 있지 않습니다.')
      return
    }
    if (clips.some((clip) => clip.adrCueId)) {
      setToast('ADR 테이크와 겹친 위치에는 일반 편집점을 추가할 수 없습니다.')
      return
    }
    const result = splitTimelineClipsAt(tracksRef.current, editTime, clips.map((clip) => clip.id))
    if (!result.rightClipIds.length) return
    commitTracks(() => result.tracks)
    setSelectedClipId(result.rightClipIds[result.rightClipIds.length - 1])
    setSelectedClipIds(new Set(result.rightClipIds))
    setSelectedAssetId(undefined)
    setToast(`${result.rightClipIds.length}개 트랙에 편집점을 추가했습니다.`)
  }, [activeSequenceFps, commitTracks, playhead])

  const addEditToTargetTracks = useCallback(() => addEditAtPlayhead(false), [addEditAtPlayhead])
  const addEditToAllTracks = useCallback(() => addEditAtPlayhead(true), [addEditAtPlayhead])

  const selectTrackClipsFromPlayhead = useCallback((direction: 'forward' | 'backward', allTracks: boolean) => {
    const currentTracks = tracksRef.current
    const selectedTrack = currentTracks.find((track) => track.id === selectedTrackId && !track.locked)
    const targetTracks = allTracks
      ? currentTracks.filter((track) => !track.locked)
      : selectedTrack ? [selectedTrack] : currentTracks.filter((track) => track.editTarget !== false && !track.locked)
    if (!targetTracks.length) {
      setToast('클립을 선택할 잠금 해제 트랙이 없습니다.')
      return
    }
    const initial = targetTracks.flatMap((track) => track.clips.filter((clip) => direction === 'forward'
      ? clip.start >= playhead - 1 / 240 || clip.start < playhead && clip.start + clip.duration > playhead
      : clip.start <= playhead + 1 / 240))
    if (!initial.length) {
      setSelectedClipId(undefined)
      setSelectedClipIds(new Set())
      setToast(direction === 'forward' ? '재생 헤드 이후에 선택할 클립이 없습니다.' : '재생 헤드 이전에 선택할 클립이 없습니다.')
      return
    }
    const groupIds = new Set(initial.flatMap((clip) => clip.groupId ? [clip.groupId] : []))
    const linkIds = new Set(initial.flatMap((clip) => linkedSelectionEnabled && clip.linkGroupId ? [clip.linkGroupId] : []))
    const selected = currentTracks.flatMap((track) => track.locked ? [] : track.clips.filter((clip) => initial.some((candidate) => candidate.id === clip.id) || Boolean(clip.groupId && groupIds.has(clip.groupId)) || Boolean(linkedSelectionEnabled && clip.linkGroupId && linkIds.has(clip.linkGroupId))))
    const ordered = [...selected].sort((left, right) => left.start - right.start)
    const primary = direction === 'forward' ? ordered[0] : ordered[ordered.length - 1]
    setSelectedClipIds(new Set(ordered.map((clip) => clip.id)))
    setSelectedClipId(primary?.id)
    setSelectedAssetId(undefined)
    const primaryTrack = primary && currentTracks.find((track) => track.clips.some((clip) => clip.id === primary.id))
    if (primaryTrack) setSelectedTrackId(primaryTrack.id)
    setToast(`${ordered.length}개 클립을 ${direction === 'forward' ? '앞쪽' : '뒤쪽'} 방향으로 선택했습니다.`)
  }, [linkedSelectionEnabled, playhead, selectedTrackId])

  const selectTrackForward = useCallback(() => selectTrackClipsFromPlayhead('forward', false), [selectTrackClipsFromPlayhead])
  const selectTrackBackward = useCallback(() => selectTrackClipsFromPlayhead('backward', false), [selectTrackClipsFromPlayhead])
  const selectAllTracksForward = useCallback(() => selectTrackClipsFromPlayhead('forward', true), [selectTrackClipsFromPlayhead])
  const selectAllTracksBackward = useCallback(() => selectTrackClipsFromPlayhead('backward', true), [selectTrackClipsFromPlayhead])

  const seekTimelineEditPoint = useCallback((direction: 'previous' | 'next') => {
    const targetTracks = tracksRef.current.filter((track) => !track.locked && track.editTarget !== false)
    const searchable = targetTracks.length ? targetTracks : tracksRef.current.filter((track) => !track.locked)
    const points = [...new Set(searchable.flatMap((track) => track.clips.flatMap((clip) => [clip.start, clip.start + clip.duration])).map((time) => Math.round(time * 240) / 240))].sort((left, right) => left - right)
    const destination = direction === 'next'
      ? points.find((time) => time > playhead + 1 / 240)
      : [...points].reverse().find((time) => time < playhead - 1 / 240)
    if (destination === undefined) {
      setToast(direction === 'next' ? '다음 편집점이 없습니다.' : '이전 편집점이 없습니다.')
      return
    }
    setSelectedAssetId(undefined)
    setPlayhead(destination)
  }, [playhead])

  const seekPreviousEditPoint = useCallback(() => seekTimelineEditPoint('previous'), [seekTimelineEditPoint])
  const seekNextEditPoint = useCallback(() => seekTimelineEditPoint('next'), [seekTimelineEditPoint])
  const seekSelectedClipStart = useCallback(() => {
    if (!selectedClip) {
      setToast('시작점으로 이동할 클립을 선택해주세요.')
      return
    }
    setSelectedAssetId(undefined)
    setPlayhead(selectedClip.start)
  }, [selectedClip])
  const seekSelectedClipEnd = useCallback(() => {
    if (!selectedClip) {
      setToast('끝점으로 이동할 클립을 선택해주세요.')
      return
    }
    setSelectedAssetId(undefined)
    setPlayhead(selectedClip.start + selectedClip.duration)
  }, [selectedClip])

  const selectEditPointAtPlayhead = useCallback(() => {
    const targetTracks = tracksRef.current.filter((track) => track.editTarget !== false)
    const boundaryClips = targetTracks.flatMap((track) => track.clips.filter((clip) => Math.abs(clip.start - playhead) <= 1 / 240 || Math.abs(clip.start + clip.duration - playhead) <= 1 / 240))
    if (!boundaryClips.length) {
      setToast('현재 재생 헤드에 편집점이 없습니다.')
      return
    }
    const groupIds = new Set(boundaryClips.flatMap((clip) => clip.groupId ? [clip.groupId] : []))
    const linkIds = new Set(boundaryClips.flatMap((clip) => linkedSelectionEnabled && clip.linkGroupId ? [clip.linkGroupId] : []))
    const selected = tracksRef.current.flatMap((track) => track.clips.filter((clip) => boundaryClips.some((candidate) => candidate.id === clip.id) || Boolean(clip.groupId && groupIds.has(clip.groupId)) || Boolean(linkedSelectionEnabled && clip.linkGroupId && linkIds.has(clip.linkGroupId))))
    const outgoing = boundaryClips.find((clip) => Math.abs(clip.start + clip.duration - playhead) <= 1 / 240)
    const primary = outgoing ?? boundaryClips[0]
    setSelectedClipIds(new Set(selected.map((clip) => clip.id)))
    setSelectedClipId(primary.id)
    setSelectedAssetId(undefined)
    const primaryTrack = tracksRef.current.find((track) => track.clips.some((clip) => clip.id === primary.id))
    if (primaryTrack) setSelectedTrackId(primaryTrack.id)
    setToast(`${selected.length}개 클립의 편집점을 선택했습니다.`)
  }, [linkedSelectionEnabled, playhead])

  const applyDefaultTransitionAtEdit = useCallback((kind: 'video' | 'audio') => {
    const tolerance = 1 / Math.max(1, activeSequenceFps)
    const assignments = new Map<string, 'in' | 'out'>()
    const eligibleTracks = tracksRef.current.filter((track) => !track.locked && track.kind === kind && track.editTarget !== false)
    eligibleTracks.forEach((track) => {
      const incoming = track.clips.find((clip) => Math.abs(clip.start - playhead) <= tolerance)
      if (incoming) assignments.set(incoming.id, 'in')
      else {
        const outgoing = track.clips.find((clip) => Math.abs(clip.start + clip.duration - playhead) <= tolerance)
        if (outgoing) assignments.set(outgoing.id, 'out')
      }
    })
    if (!assignments.size) {
      tracksRef.current.filter((track) => !track.locked && track.kind === kind).forEach((track) => track.clips.forEach((clip) => {
        if (!selectedClipIds.has(clip.id)) return
        assignments.set(clip.id, Math.abs(playhead - clip.start) <= Math.abs(playhead - clip.start - clip.duration) ? 'in' : 'out')
      }))
    }
    if (!assignments.size) {
      setToast(kind === 'audio' ? '오디오 편집점 또는 오디오 클립을 선택해주세요.' : '영상 편집점 또는 영상 클립을 선택해주세요.')
      return
    }
    commitTracks((current) => current.map((track) => track.locked ? track : ({
      ...track,
      clips: track.clips.map((clip) => {
        const edge = assignments.get(clip.id)
        if (!edge) return clip
        const configured = kind === 'audio' ? activeTransitionDefaults.audio : activeTransitionDefaults.video
        const transition = { ...structuredClone(configured), duration: Math.min(configured.duration, (configured.alignment ?? 'center-on-cut') === 'center-on-cut' ? clip.duration * 2 : clip.duration) }
        return edge === 'in' ? { ...clip, transitionIn: transition } : { ...clip, transitionOut: transition }
      }),
    })))
    setToast(`기본 ${kind === 'audio' ? '오디오' : '영상'} 전환을 ${assignments.size}개 편집점에 적용했습니다.`)
  }, [activeSequenceFps, activeTransitionDefaults, commitTracks, playhead, selectedClipIds])

  const applyDefaultVideoTransition = useCallback(() => applyDefaultTransitionAtEdit('video'), [applyDefaultTransitionAtEdit])
  const applyDefaultAudioTransition = useCallback(() => applyDefaultTransitionAtEdit('audio'), [applyDefaultTransitionAtEdit])

  const removeTransitionsAtEdit = useCallback(() => {
    const tolerance = 1 / Math.max(1, activeSequenceFps)
    const removals = new Map<string, { in?: boolean; out?: boolean }>()
    tracksRef.current.filter((track) => !track.locked && track.kind !== 'caption' && track.editTarget !== false).forEach((track) => track.clips.forEach((clip) => {
      if (Math.abs(clip.start - playhead) <= tolerance && clip.transitionIn?.type && clip.transitionIn.type !== 'none') removals.set(clip.id, { ...removals.get(clip.id), in: true })
      if (Math.abs(clip.start + clip.duration - playhead) <= tolerance && clip.transitionOut?.type && clip.transitionOut.type !== 'none') removals.set(clip.id, { ...removals.get(clip.id), out: true })
    }))
    if (!removals.size) tracksRef.current.filter((track) => !track.locked).forEach((track) => track.clips.forEach((clip) => {
      if (!selectedClipIds.has(clip.id)) return
      const removeIn = Boolean(clip.transitionIn?.type && clip.transitionIn.type !== 'none')
      const removeOut = Boolean(clip.transitionOut?.type && clip.transitionOut.type !== 'none')
      if (removeIn || removeOut) removals.set(clip.id, { in: removeIn, out: removeOut })
    }))
    if (!removals.size) {
      setToast('현재 편집점이나 선택 클립에 제거할 전환이 없습니다.')
      return
    }
    commitTracks((current) => current.map((track) => track.locked ? track : ({
      ...track,
      clips: track.clips.map((clip) => {
        const removal = removals.get(clip.id)
        return !removal ? clip : { ...clip, transitionIn: removal.in ? undefined : clip.transitionIn, transitionOut: removal.out ? undefined : clip.transitionOut }
      }),
    })))
    const edgeCount = [...removals.values()].reduce((count, removal) => count + Number(Boolean(removal.in)) + Number(Boolean(removal.out)), 0)
    setToast(`전환 ${edgeCount}개를 제거했습니다.`)
  }, [activeSequenceFps, commitTracks, playhead, selectedClipIds])

  const moveTimelineClip = useCallback((id: string, start: number, targetTrackId?: string) => {
    const snapTargets = [
      ...markersRef.current.flatMap((marker) => [marker.time, ...(marker.duration ? [marker.time + marker.duration] : [])]),
      ...(sequenceWorkArea ? [sequenceWorkArea.start, sequenceWorkArea.end] : []),
    ]
    const targetClip = tracksRef.current.flatMap((track) => track.clips).find((clip) => clip.id === id)
    if (targetClip?.adrCueId) {
      setToast('ADR 테이크의 위치는 ADR 세션에서 관리됩니다.')
      return
    }
    const sourceTrack = tracksRef.current.find((track) => track.clips.some((clip) => clip.id === id))
    const destinationTrack = targetTrackId ? tracksRef.current.find((track) => track.id === targetTrackId) : sourceTrack
    if (targetClip && sourceTrack && destinationTrack && destinationTrack.id !== sourceTrack.id) {
      if (destinationTrack.kind !== sourceTrack.kind || destinationTrack.locked) {
        setToast('같은 종류의 잠금 해제 트랙으로만 클립을 이동할 수 있습니다.')
        return
      }
      const allClips = tracksRef.current.flatMap((track) => track.clips)
      const moving = selectedClipIds.size >= 2 && selectedClipIds.has(id)
        ? createClipClipboardPayload(tracksRef.current, selectedClipIds)?.entries.map((entry) => entry.clip) ?? [targetClip]
        : allClips.filter((clip) => clip.id === id || Boolean(targetClip.groupId && clip.groupId === targetClip.groupId) || Boolean(linkedSelectionEnabled && targetClip.linkGroupId && clip.linkGroupId === targetClip.linkGroupId))
      if (moving.some((clip) => clip.adrCueId)) {
        setToast('ADR 테이크가 포함된 선택은 트랙 사이로 이동할 수 없습니다.')
        return
      }
      const sourceSiblings = tracksRef.current.filter((track) => track.kind === sourceTrack.kind)
      const trackDelta = sourceSiblings.findIndex((track) => track.id === destinationTrack.id) - sourceSiblings.findIndex((track) => track.id === sourceTrack.id)
      const destinationIds = new Map<string, string>()
      for (const clip of moving) {
        const origin = tracksRef.current.find((track) => track.clips.some((candidate) => candidate.id === clip.id))
        if (!origin) continue
        const siblings = tracksRef.current.filter((track) => track.kind === origin.kind)
        const shifted = siblings[siblings.findIndex((track) => track.id === origin.id) + trackDelta]
        const next = shifted ?? (origin.kind !== sourceTrack.kind ? origin : undefined)
        if (!next || next.locked) {
          setToast('함께 선택된 모든 클립을 옮길 수 있는 대응 트랙이 없습니다.')
          return
        }
        destinationIds.set(clip.id, next.id)
      }
      const movingIds = new Set(moving.map((clip) => clip.id))
      const requested = snapTimeToFrame(snapEnabled ? snapClipStart(tracksRef.current, id, start, playhead, snapTargets) : start, activeSequenceFps)
      const minimumStart = Math.min(...moving.map((clip) => clip.start))
      const delta = Math.max(-minimumStart, requested - targetClip.start)
      const moved = moving.map((clip) => ({ ...clip, trackId: destinationIds.get(clip.id) ?? clip.trackId, start: snapTimeToFrame(clip.start + delta, activeSequenceFps) }))
      const blockers = moved.flatMap((clip) => inspectAdrOverwrite(tracksRef.current, adrCuesRef.current, activeSequenceId, clip.trackId, clip.start, clip.start + clip.duration))
      if (blockers.length) {
        setToast(blockers[0])
        return
      }
      commitTracks((current) => overwriteMovedTimelineClips(current, moved))
      setSelectedTrackId(destinationTrack.id)
      return
    }
    if (!targetClip || selectedClipIds.size < 2 || !selectedClipIds.has(id)) {
      if (!targetClip) return
      const movingIds = new Set(tracksRef.current.flatMap((track) => track.clips.filter((clip) => clip.id === id || Boolean(targetClip.groupId && clip.groupId === targetClip.groupId) || Boolean(linkedSelectionEnabled && targetClip.linkGroupId && clip.linkGroupId === targetClip.linkGroupId)).map((clip) => clip.id)))
      const relocated = moveClipGroup(tracksRef.current, id, snapTimeToFrame(snapEnabled ? snapClipStart(tracksRef.current, id, start, playhead, snapTargets) : start, activeSequenceFps), linkedSelectionEnabled)
      const moved = relocated.flatMap((track) => track.clips.filter((clip) => movingIds.has(clip.id)))
      const blockers = moved.flatMap((clip) => inspectAdrOverwrite(tracksRef.current, adrCuesRef.current, activeSequenceId, clip.trackId, clip.start, clip.start + clip.duration))
      if (blockers.length) {
        setToast(blockers[0])
        return
      }
      commitTracks((current) => overwriteMovedTimelineClips(current, moved))
      return
    }
    if (tracksRef.current.flatMap((track) => track.clips).some((clip) => selectedClipIds.has(clip.id) && clip.adrCueId)) {
      setToast('ADR 테이크가 포함된 다중 선택은 일반 클립과 함께 이동할 수 없습니다.')
      return
    }
    const payload = createClipClipboardPayload(tracksRef.current, selectedClipIds)
    if (!payload) return
    const movingIds = new Set(payload.entries.map((entry) => entry.clip.id))
    if (tracksRef.current.some((track) => track.locked && track.clips.some((clip) => movingIds.has(clip.id)))) {
      setToast('선택 범위에 잠긴 트랙의 클립이 있어 함께 이동할 수 없습니다.')
      return
    }
    const requested = snapTimeToFrame(snapEnabled ? snapClipStart(tracksRef.current, id, start, playhead, snapTargets) : start, activeSequenceFps)
    const minimumStart = Math.min(...payload.entries.map((entry) => entry.clip.start))
    const delta = Math.max(-minimumStart, requested - targetClip.start)
    const moved = payload.entries.map((entry) => ({ ...entry.clip, start: snapTimeToFrame(entry.clip.start + delta, activeSequenceFps) }))
    const blockers = moved.flatMap((clip) => inspectAdrOverwrite(tracksRef.current, adrCuesRef.current, activeSequenceId, clip.trackId, clip.start, clip.start + clip.duration))
    if (blockers.length) {
      setToast(blockers[0])
      return
    }
    commitTracks((current) => overwriteMovedTimelineClips(current, moved))
  }, [activeSequenceFps, activeSequenceId, commitTracks, linkedSelectionEnabled, playhead, selectedClipIds, sequenceWorkArea, snapEnabled])

  const nudgeSelectedClips = useCallback((frames: number) => {
    if (tracksRef.current.flatMap((track) => track.clips).some((clip) => selectedClipIds.has(clip.id) && clip.adrCueId)) {
      setToast('ADR 테이크는 ADR 세션의 큐 위치로 이동해주세요.')
      return
    }
    const payload = createClipClipboardPayload(tracksRef.current, selectedClipIds)
    if (!payload) return
    const movingIds = new Set(payload.entries.map((entry) => entry.clip.id))
    if (tracksRef.current.some((track) => track.locked && track.clips.some((clip) => movingIds.has(clip.id)))) {
      setToast('선택 범위에 잠긴 트랙의 클립이 있어 이동하지 않았습니다.')
      return
    }
    const minimumStart = Math.min(...payload.entries.map((entry) => entry.clip.start))
    const requestedDelta = timeAtFrame(Math.abs(frames), activeSequenceFps) * Math.sign(frames)
    const delta = Math.max(-minimumStart, requestedDelta)
    if (Math.abs(delta) < 1 / 240) return
    const moved = payload.entries.map((entry) => ({ ...entry.clip, start: snapTimeToFrame(entry.clip.start + delta, activeSequenceFps) }))
    const blockers = moved.flatMap((clip) => inspectAdrOverwrite(tracksRef.current, adrCuesRef.current, activeSequenceId, clip.trackId, clip.start, clip.start + clip.duration))
    if (blockers.length) {
      setToast(blockers[0])
      return
    }
    commitTracks((current) => overwriteMovedTimelineClips(current, moved))
    setPlayhead((current) => Math.max(0, current + delta))
  }, [activeSequenceFps, activeSequenceId, commitTracks, selectedClipIds])

  const trimClip = useCallback((id: string, edge: 'start' | 'end', time: number) => {
    const targetClip = tracksRef.current.flatMap((track) => track.clips).find((clip) => clip.id === id)
    if (!targetClip) return
    const targetTrack = tracksRef.current.find((track) => track.clips.some((clip) => clip.id === id))
    if (targetTrack?.locked) {
      setToast('잠긴 트랙의 클립은 트림할 수 없습니다.')
      return
    }
    if (targetClip.adrCueId) {
      setToast('ADR 테이크의 길이는 ADR 세션에서 관리됩니다.')
      return
    }
    const snapTargets = [
      ...markersRef.current.flatMap((marker) => [marker.time, ...(marker.duration ? [marker.time + marker.duration] : [])]),
      ...(sequenceWorkArea ? [sequenceWorkArea.start, sequenceWorkArea.end] : []),
    ]
    const requestedTime = snapTimeToFrame(snapEnabled
      ? snapTimelineTime(tracksRef.current, time, playhead, snapTargets, new Set([id]))
      : time, activeSequenceFps)
    const materializedSequences = sequenceLibrary.map((sequence) => sequence.id === activeSequenceId
      ? { ...sequence, tracks: tracksRef.current }
      : sequence)
    const sourceDurations = createClipSourceDurationMap(tracksRef.current, assetsRef.current, materializedSequences)
    if (trimMode !== 'ripple') {
      const result = trimTimelineClipAdvancedResult(tracksRef.current, id, edge, requestedTime, trimMode, sourceDurations, linkedSelectionEnabled)
      if (!result.changed) {
        if (result.reason) setToast(result.reason)
        return
      }
      commitTracks(() => result.tracks)
      if (trimMode === 'rate-stretch') {
        const stretched = result.tracks.flatMap((track) => track.clips).find((clip) => clip.id === id)
        if (stretched) setToast(`속도 늘이기 · ${stretched.duration.toFixed(2)}초 · 시작 속도 ${Math.round((stretched.playbackRate ?? 1) * 100)}%`)
      }
      return
    }

    const oldStart = targetClip.start
    const oldEnd = targetClip.start + targetClip.duration
    const oldBoundary = edge === 'start' ? oldStart : oldEnd
    const constrained = trimTimelineClipAdvancedResult(tracksRef.current, id, edge, requestedTime, 'ripple', sourceDurations, linkedSelectionEnabled)
    if (!constrained.changed || constrained.appliedBoundary === undefined) {
      if (constrained.reason) setToast(constrained.reason)
      return
    }
    const requested = constrained.appliedBoundary
    const delta = requested - oldBoundary

    if ((edge === 'start' && delta > 0) || (edge === 'end' && delta < 0)) {
      const rangeStart = edge === 'start' ? oldStart : requested
      const rangeEnd = edge === 'start' ? requested : oldEnd
      const restored = commitRippleDelete(rangeStart, rangeEnd, { updateTracks: (removed) => removed.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.id !== id) return clip
          const audioAdjustment = targetClip.audioAdjustment || clip.audioAdjustment
            ? { ...defaultAudioAdjustment(), ...clip.audioAdjustment, ...(edge === 'start' ? { fadeIn: targetClip.audioAdjustment?.fadeIn ?? 0 } : { fadeOut: targetClip.audioAdjustment?.fadeOut ?? 0 }) }
            : undefined
          return edge === 'start'
            ? { ...clip, transitionIn: targetClip.transitionIn, audioAdjustment }
            : { ...clip, transitionOut: targetClip.transitionOut, audioAdjustment }
        }),
      })) })
      if (!restored) return
      setToast(`${Math.abs(delta).toFixed(2)}초를 줄이고 뒤 타임라인을 당겼습니다.`)
      return
    }

    const insertedDuration = Math.abs(delta)
    const insertAt = edge === 'start' ? oldStart : oldEnd
    const originalClips = new Map<string, TimelineClip>(tracksRef.current.flatMap((track) => track.clips).map((clip) => [clip.id, clip]))
    const constrainedClips = new Map<string, TimelineClip>(constrained.tracks.flatMap((track) => track.clips).map((clip) => [clip.id, clip]))
    const extensionIds = new Set([...originalClips].flatMap(([clipId, original]) => {
      const resized = constrainedClips.get(clipId)
      return resized && resized.duration > original.duration + 1 / 240 ? [clipId] : []
    }))
    const extensionTrackIds = new Set(tracksRef.current.filter((track) => track.clips.some((clip) => extensionIds.has(clip.id))).map((track) => track.id))
    const committed = commitRippleInsertGap(insertAt, insertedDuration, (gapped) => gapped.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        if (!extensionIds.has(clip.id)) return clip
        const original = originalClips.get(clip.id)
        if (!original) return clip
        return edge === 'start'
          ? extendTimelineClipAtStart({ ...original, groupId: clip.groupId, linkGroupId: clip.linkGroupId }, original.start, insertedDuration)
          : extendTimelineClipAtEnd(clip, insertedDuration)
      }).sort((left, right) => left.start - right.start),
    })), extensionTrackIds)
    if (committed) setToast(`${insertedDuration.toFixed(2)}초를 늘리고 뒤 타임라인을 밀었습니다.`)
  }, [activeSequenceId, commitRippleDelete, commitRippleInsertGap, commitTracks, linkedSelectionEnabled, playhead, sequenceLibrary, sequenceWorkArea, snapEnabled, trimMode])

  const addMarkerAtPlayhead = useCallback(() => {
    commitEditor({ markers: (current) => upsertMarker(current, playhead) })
    setToast('현재 재생 위치에 마커를 추가했습니다.')
  }, [commitEditor, playhead])

  const addClipMarkerAtPlayhead = useCallback(() => {
    if (!selectedClip) return
    const localTime = Math.max(0, Math.min(selectedClip.duration, playhead - selectedClip.start))
    const marker: ClipMarker = { id: crypto.randomUUID(), time: localTime, label: '클립 마커', color: '#f2b84b' }
    updateClip(selectedClip.id, { clipMarkers: [...(selectedClip.clipMarkers ?? []), marker].sort((left, right) => left.time - right.time) })
    setToast(`${selectedClip.name} 내부 ${formatTimecode(localTime, true, activeSequenceFps)}에 마커를 추가했습니다.`)
  }, [activeSequenceFps, playhead, selectedClip, updateClip])

  const updateClipMarker = useCallback((clipId: string, markerId: string, patch: Partial<ClipMarker>) => {
    const clip = tracksRef.current.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId)
    if (!clip) return
    updateClip(clipId, { clipMarkers: clip.clipMarkers?.map((marker) => marker.id === markerId ? { ...marker, ...patch, time: patch.time === undefined ? marker.time : Math.max(0, Math.min(clip.duration, patch.time)) } : marker).sort((left, right) => left.time - right.time) })
  }, [updateClip])

  const removeClipMarker = useCallback((clipId: string, markerId: string) => {
    const clip = tracksRef.current.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId)
    if (!clip) return
    updateClip(clipId, { clipMarkers: clip.clipMarkers?.filter((marker) => marker.id !== markerId) })
  }, [updateClip])

  const addRangeMarker = useCallback((start: number, end: number, kind: TimelineMarker['kind']) => {
    const rangeStart = Math.max(0, Math.min(start, end))
    const rangeEnd = Math.max(rangeStart + 1 / activeSequenceFps, Math.max(start, end))
    const timestamp = new Date().toISOString()
    const marker: TimelineMarker = { id: crypto.randomUUID(), time: rangeStart, duration: rangeEnd - rangeStart, label: kind === 'chapter' ? '새 챕터 범위' : kind === 'comment' ? '새 검토 범위' : '새 편집 범위', color: kind === 'chapter' ? '#f1b84b' : kind === 'comment' ? '#59c9a5' : '#9d7bea', kind, status: kind === 'comment' ? 'open' : undefined, createdAt: timestamp, updatedAt: timestamp }
    commitEditor({ markers: (current) => [...current, marker].sort((left, right) => left.time - right.time) })
    setPlayhead(rangeStart)
    setToast(`${formatTimecode(rangeStart, true, activeSequenceFps)}부터 범위 마커를 추가했습니다.`)
  }, [activeSequenceFps, commitEditor])

  const addTrack = useCallback((kind: TrackKind) => {
    const next = addTimelineTrack(tracksRef.current, kind)
    const added = next.find((track) => !tracksRef.current.some((item) => item.id === track.id))
    const targeted = added ? assignSourceTarget(next, added.id) : next
    commitTracks(() => targeted)
    if (added) setSelectedTrackId(added.id)
  }, [commitTracks])

  const moveTrack = useCallback((trackId: string, direction: -1 | 1) => {
    commitTracks((current) => {
      const index = current.findIndex((track) => track.id === trackId)
      if (index < 0) return current
      const kind = current[index].kind
      const siblingIndexes = current.flatMap((track, candidateIndex) => track.kind === kind ? [candidateIndex] : [])
      const siblingPosition = siblingIndexes.indexOf(index)
      const targetIndex = siblingIndexes[siblingPosition + direction]
      if (targetIndex === undefined) return current
      const next = [...current]
      ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
      return next.map((track, order) => track.kind === 'video' ? { ...track, compositePriority: order * 100 } : track)
    })
  }, [commitTracks])

  const duplicateTrack = useCallback((trackId: string) => {
    const source = tracksRef.current.find((track) => track.id === trackId)
    if (!source) return
    const duplicateTrackId = crypto.randomUUID()
    const trackIdMap = new Map([[source.id, duplicateTrackId]])
    const groupIds = new Map<string, string>()
    const linkIds = new Map<string, string>()
    const remapRelation = (id: string | undefined, map: Map<string, string>) => {
      if (!id) return undefined
      const existing = map.get(id)
      if (existing) return existing
      const next = crypto.randomUUID()
      map.set(id, next)
      return next
    }
    const duplicate: TimelineTrack = {
      ...structuredClone(source),
      id: duplicateTrackId,
      name: `${source.name} 복사`,
      sourceTarget: false,
      locked: false,
      mixKeyframes: source.mixKeyframes?.map((keyframe) => ({ ...structuredClone(keyframe), id: crypto.randomUUID() })),
      clips: source.clips.map((clip) => ({
        ...duplicateClipForPaste(clip, duplicateTrackId, trackIdMap),
        groupId: remapRelation(clip.groupId, groupIds),
        linkGroupId: remapRelation(clip.linkGroupId, linkIds),
        adrCueId: undefined,
        renderReplacement: undefined,
      })),
    }
    commitTracks((current) => {
      const index = current.findIndex((track) => track.id === trackId)
      if (index < 0) return current
      const next = [...current.slice(0, index + 1), duplicate, ...current.slice(index + 1)]
      return next.map((track, order) => track.kind === 'video' ? { ...track, compositePriority: order * 100 } : track)
    })
    setSelectedTrackId(duplicateTrackId)
    setSelectedClipId(undefined)
    setSelectedClipIds(new Set())
    setToast(`“${source.name}” 트랙과 클립·효과·자동화를 복제했습니다.`)
  }, [commitTracks])

  const removeTrack = useCallback((trackId: string) => {
    const removed = tracksRef.current.find((track) => track.id === trackId)
    const next = removeTimelineTrack(tracksRef.current, trackId)
    if (next === tracksRef.current) {
      setToast('각 종류의 마지막 트랙은 삭제할 수 없습니다.')
      return
    }
    const repaired = removed ? repairSourceTargetAfterRemoval(next, removed) : next
    commitTracks(() => repaired)
    if (selectedTrackId === trackId) setSelectedTrackId(repaired.find((track) => track.kind === removed?.kind)?.id ?? repaired[0]?.id)
    if (selectedClip && selectedClip.trackId === trackId) setSelectedClipId(undefined)
  }, [commitTracks, selectedClip, selectedTrackId])

  const toggleTrackSourceTarget = useCallback((trackId: string) => {
    const track = tracksRef.current.find((item) => item.id === trackId)
    if (!track) return
    const enabling = track.sourceTarget !== true
    commitTracks((current) => toggleSourceTarget(current, trackId))
    const kind = track.kind === 'video' ? '비디오' : track.kind === 'audio' ? '오디오' : '자막'
    setToast(enabling ? `“${track.name}”을 ${kind} 소스 대상으로 지정했습니다.` : `${kind} 소스 대상을 해제했습니다. 다시 지정하기 전에는 해당 종류를 타임라인에 추가하지 않습니다.`)
  }, [commitTracks])

  const toggleTrackEditTarget = useCallback((trackId: string) => {
    const track = tracksRef.current.find((item) => item.id === trackId)
    if (!track) return
    const enabling = track.editTarget === false
    commitTracks((current) => current.map((item) => item.id === trackId ? { ...item, editTarget: enabling } : item))
    setToast(`“${track.name}” 편집 대상을 ${enabling ? '켰습니다' : '껐습니다'}.`)
  }, [commitTracks])

  const setAllTrackEditTargets = useCallback((enabled: boolean) => {
    commitTracks((current) => current.map((track) => ({ ...track, editTarget: enabled })))
    setToast(enabled ? '모든 트랙을 편집 대상으로 지정했습니다.' : '모든 트랙의 편집 대상을 해제했습니다.')
  }, [commitTracks])

  const setAllTrackSyncLocks = useCallback((enabled: boolean) => {
    commitTracks((current) => current.map((track) => ({ ...track, syncLock: enabled || track.clips.some((clip) => clip.adrCueId) })))
    setToast(enabled ? '모든 트랙의 동기화 잠금을 켰습니다.' : 'ADR 보호 트랙을 제외한 동기화 잠금을 해제했습니다.')
  }, [commitTracks])

  const setTrackHeight = useCallback((trackId: string, height: number) => {
    commitTracks((current) => current.map((track) => track.id === trackId ? { ...track, displayHeight: Math.max(40, Math.min(180, height)) } : track))
  }, [commitTracks])

  const setAllTrackHeights = useCallback((height: number) => {
    commitTracks((current) => current.map((track) => ({ ...track, displayHeight: Math.max(40, Math.min(180, height)) })))
  }, [commitTracks])

  const linkActiveClips = useCallback(() => {
    commitTracks((current) => linkClipsAtTime(current, playhead))
    setToast('재생 헤드와 겹치는 클립을 연결했습니다.')
  }, [commitTracks, playhead])

  const unlinkSelectedClip = useCallback(() => {
    if (!selectedClipId) return
    commitTracks((current) => unlinkClip(current, selectedClipId))
    setToast('클립 연결을 해제했습니다.')
  }, [commitTracks, selectedClipId])

  const groupActiveClips = useCallback(() => {
    const selected = tracksRef.current.filter((track) => !track.locked).flatMap((track) => track.clips).filter((clip) => selectedClipIds.has(clip.id)).map((clip) => clip.id)
    const ids = selected.length >= 2
      ? selected
      : tracksRef.current.filter((track) => !track.locked).flatMap((track) => track.clips).filter((clip) => playhead >= clip.start && playhead < clip.start + clip.duration).map((clip) => clip.id)
    if (ids.length < 2) {
      setToast('그룹으로 묶을 클립을 2개 이상 선택하거나 재생 헤드에 겹쳐주세요.')
      return
    }
    commitTracks((current) => setClipGroup(current, ids, crypto.randomUUID()))
    setToast(`${ids.length}개 클립을 그룹으로 묶었습니다.`)
  }, [commitTracks, playhead, selectedClipIds])

  const ungroupSelectedClip = useCallback(() => {
    const selected = tracksRef.current.flatMap((track) => track.clips).filter((clip) => selectedClipIds.has(clip.id) || clip.id === selectedClipId)
    const groupIds = new Set(selected.flatMap((clip) => clip.groupId ? [clip.groupId] : []))
    if (!groupIds.size) return
    const ids = tracksRef.current.flatMap((track) => track.clips).filter((clip) => clip.groupId && groupIds.has(clip.groupId)).map((clip) => clip.id)
    commitTracks((current) => setClipGroup(current, ids, undefined))
    setToast(`${groupIds.size}개 클립 그룹을 해제했습니다.`)
  }, [commitTracks, selectedClipId, selectedClipIds])

  const handleFiles = useCallback(async (fileCollection: FileList | File[], readFailures: MediaFileReadFailure[] = [], importedBins: string[] = []) => {
    const normalizedBins = [...new Set(importedBins.map((name) => name.trim()).filter(Boolean))]
    if (normalizedBins.length) setMediaBins((current) => [...new Set([...current, ...normalizedBins])])
    const selectedFiles = Array.from(fileCollection)
    const files = selectedFiles.filter((file) => Boolean(getMediaKind(file)))
    const unsupportedFiles = selectedFiles.filter((file) => !getMediaKind(file))
    if (!files.length) {
      setToast(readFailures.length
        ? `미디어 ${readFailures.length}개를 읽지 못했습니다. ${readFailures[0].name}: ${readFailures[0].message}`
        : unsupportedFiles.length
          ? `지원하지 않는 파일 ${unsupportedFiles.length}개입니다. ${unsupportedFiles[0].name}`
          : '지원되는 영상, 오디오 또는 이미지 파일을 선택해주세요.')
      return []
    }

    const currentAssets = assetsRef.current
    const pendingAssets: MediaAsset[] = []
    const signaturePairs = await mapWithConcurrency(files, 4, async (file) => [file, await mediaFileQuickSignature(file)] as const)
    const quickSignatureByFile = new Map(signaturePairs)
    const pendingFiles = new Set<string>()
    const claimedOfflineIds = new Set<string>()
    const duplicateAssetIds: string[] = []
    let duplicateCount = 0
    for (const file of files) {
      const fileIdentity = importedFileIdentity(file)
      if (pendingFiles.has(fileIdentity)) {
        duplicateCount += 1
        continue
      }
      pendingFiles.add(fileIdentity)
      const pathFile = file as File & { __editweaveSourcePath?: string; __editweaveFileSize?: number; __editweaveStreaming?: boolean; __editweaveStreamUrl?: string; __editweaveImportFolder?: string; __editweaveImageSequenceFiles?: File[]; __editweaveImageSequenceFrameRate?: number }
      const actualSize = pathFile.__editweaveFileSize ?? file.size
      const sourceQuickSignature = quickSignatureByFile.get(file)
      const imageSequenceFiles = pathFile.__editweaveImageSequenceFiles
      const imageSequenceFrameRate = pathFile.__editweaveImageSequenceFrameRate
      const imageSequencePaths = imageSequenceFiles?.flatMap((item) => {
        const path = (item as File & { __editweaveSourcePath?: string }).__editweaveSourcePath
        return path ? [path] : []
      })
      const imageSequenceUrls = imageSequenceFiles?.map((item) => URL.createObjectURL(item))
      const connectedMatch = currentAssets.find((asset) => (asset.status === 'ready' || asset.status === 'analyzing') && isAlreadyConnectedSource(asset, file, sourceQuickSignature))
      if (connectedMatch) {
        duplicateCount += 1
        duplicateAssetIds.push(connectedMatch.id)
        continue
      }
      const offlineMatch = currentAssets.find((asset) => (asset.status === 'offline' || asset.status === 'error') && !claimedOfflineIds.has(asset.id) && (isAlreadyConnectedSource(asset, file, sourceQuickSignature) || asset.name === file.name && asset.size === actualSize && (asset.sourceQuickSignature === undefined || sourceQuickSignature === undefined ? asset.sourceLastModified === undefined || Math.abs(asset.sourceLastModified - file.lastModified) < 2_000 : asset.sourceQuickSignature === sourceQuickSignature)))
      const incomingPath = normalizedMediaPath(pathFile.__editweaveSourcePath)
      const changedPathMatch = incomingPath ? currentAssets.find((asset) => !asset.parentAssetId && !claimedOfflineIds.has(asset.id) && normalizedMediaPath(asset.sourcePath) === incomingPath && !isAlreadyConnectedSource(asset, file, sourceQuickSignature)) : undefined
      const matchedAsset = offlineMatch ?? changedPathMatch
      if (matchedAsset) claimedOfflineIds.add(matchedAsset.id)
      const nextAsset: MediaAsset = {
        ...matchedAsset,
        id: matchedAsset?.id ?? crypto.randomUUID(),
        name: imageSequenceFiles?.length ? `${file.name.replace(/(\d+)(\.[^.]+)$/, '')}[${imageSequenceFiles.length} frames]` : file.name,
        kind: imageSequenceFiles?.length ? 'video' : getMediaKind(file) ?? 'video',
        url: imageSequenceUrls?.[0] ?? pathFile.__editweaveStreamUrl ?? URL.createObjectURL(file),
        sourceFile: file,
        sourcePath: pathFile.__editweaveSourcePath ?? matchedAsset?.sourcePath,
        sourceLastModified: file.lastModified,
        sourceQuickSignature,
        imageSequenceFiles,
        imageSequencePaths,
        imageSequenceUrls,
        imageSequenceFrameRate,
        folder: matchedAsset?.folder ?? pathFile.__editweaveImportFolder,
        streamingSource: Boolean(pathFile.__editweaveStreaming),
        duration: imageSequenceFiles?.length ? imageSequenceFiles.length / Math.max(1, imageSequenceFrameRate ?? activeSequenceFps) : matchedAsset?.duration ?? 10,
        size: imageSequenceFiles?.reduce((sum, item) => sum + ((item as File & { __editweaveFileSize?: number }).__editweaveFileSize ?? item.size), 0) ?? actualSize,
        extension: file.name.split('.').pop() ?? 'media',
        status: 'analyzing',
        analysisStartedAt: Date.now(),
        error: undefined,
        proxyStatus: changedPathMatch ? 'none' : matchedAsset?.proxyStatus ?? 'none',
        useProxy: changedPathMatch ? false : matchedAsset?.proxyStatus === 'ready' ? matchedAsset.useProxy : false,
        importedAt: matchedAsset?.importedAt ?? new Date().toISOString(),
      }
      if (changedPathMatch) {
        releaseObjectUrl(changedPathMatch.proxyUrl)
        void deleteProxyFile(changedPathMatch.proxyCachePath).catch(() => undefined)
        Object.assign(nextAsset, {
          proxyFile: undefined, proxyUrl: undefined, proxySize: undefined, proxyWidth: undefined, proxyHeight: undefined, proxyFrameRate: undefined,
          proxyCachePath: undefined, proxySourcePath: undefined, proxySourceName: undefined, proxyOrigin: undefined, proxyPurpose: undefined, proxyEnabled: undefined,
          proxyCachedAt: undefined, proxyTimecode: undefined, proxyTimecodeVerified: undefined, proxyTimecodeMismatch: undefined, proxyProgress: undefined, proxyError: undefined,
        })
      }
      if (matchedAsset?.url !== nextAsset.url) releaseObjectUrl(matchedAsset?.url)
      pendingAssets.push(nextAsset)
    }

    if (!pendingAssets.length) {
      if (duplicateAssetIds[0]) setSelectedAssetId(duplicateAssetIds[0])
      const skipNotes = [readFailures.length ? `읽기 실패 ${readFailures.length}개 (${readFailures[0].name})` : '', unsupportedFiles.length ? `미지원 ${unsupportedFiles.length}개 (${unsupportedFiles[0].name})` : ''].filter(Boolean)
      setToast(`이미 등록된 동일 원본 ${duplicateCount}개를 다시 추가하지 않았습니다.${skipNotes.length ? ` · ${skipNotes.join(' · ')}` : ''}`)
      return []
    }

    const pendingIds = new Set(pendingAssets.map((asset) => asset.id))
    const nextAssets = [...currentAssets.filter((asset) => !pendingIds.has(asset.id)), ...pendingAssets]
    assetsRef.current = nextAssets
    setAssets(nextAssets)
    const assignedBins = pendingAssets.flatMap((asset) => asset.folder ? [asset.folder] : [])
    if (assignedBins.length) setMediaBins((current) => [...new Set([...current, ...assignedBins])])
    setSelectedAssetId(pendingAssets[0]?.id)
    const intakeNotes = [duplicateCount ? `중복 ${duplicateCount}개 건너뜀` : '', readFailures.length ? `읽기 실패 ${readFailures.length}개` : '', unsupportedFiles.length ? `미지원 ${unsupportedFiles.length}개` : ''].filter(Boolean)
    setToast(`${pendingAssets.length}개 미디어를 가져와 분석하고 있습니다.${intakeNotes.length ? ` · ${intakeNotes.join(' · ')}` : ''}`)

    const outcomes = await mapWithConcurrency(pendingAssets, 3, async (asset) => {
      try {
        // Keep optional waveform and face-model work off the critical import path.
        // The asset becomes usable after metadata + one thumbnail frame; deeper
        // analysis is merged in the background below.
        const analysis = await withDeadline(
          analyzeMediaFile(asset.sourceFile!, asset.url, asset.imageSequenceFiles?.length ? 'image' : asset.kind, {
            includeWaveform: false,
            includeFaceTrack: false,
          }),
          12_000,
          '기본 미디어 분석이 12초 안에 응답하지 않았습니다.',
        )
        const manualTimecode = asset.timecodeSource === 'manual' ? {
          timecodeStart: asset.timecodeStart,
          sourceTimecode: asset.sourceTimecode,
          timecodeDropFrame: asset.timecodeDropFrame,
          timecodeSource: asset.timecodeSource,
          reelName: asset.reelName ?? analysis.reelName,
        } : undefined
        const selectedSourceStream = analysis.audioStreams?.find((stream) => stream.index === (asset.sourceAudioStreamIndex ?? 0))
        const analyzedAsset: MediaAsset = asset.imageSequenceFiles?.length
          ? { ...asset, ...analysis, kind: 'video', duration: asset.imageSequenceFiles.length / Math.max(1, asset.imageSequenceFrameRate ?? activeSequenceFps), frameRate: asset.imageSequenceFrameRate ?? activeSequenceFps, videoCodec: 'image-sequence', videoDecodable: analysis.imageDecodable !== false, audioCodec: undefined, audioDecodable: undefined, sampleRate: undefined, channels: undefined, ...(manualTimecode ?? {}), status: 'ready' }
          : { ...asset, ...analysis, audioCodec: selectedSourceStream?.codec ?? analysis.audioCodec, sampleRate: selectedSourceStream?.sampleRate ?? analysis.sampleRate, channels: selectedSourceStream?.channels ?? analysis.channels, audioDecodable: (asset.sourceAudioStreamIndex ?? 0) > 0 ? false : analysis.audioDecodable, ...(manualTimecode ?? {}), status: 'ready' }
        setAssets((current) => current.map((item) => item.id === asset.id ? {
          ...item,
          ...analysis,
          ...(manualTimecode ?? {}),
          kind: analyzedAsset.kind,
          duration: analyzedAsset.duration,
          frameRate: analyzedAsset.frameRate,
          videoCodec: analyzedAsset.videoCodec,
          videoDecodable: analyzedAsset.videoDecodable,
          audioCodec: analyzedAsset.audioCodec,
          audioDecodable: analyzedAsset.audioDecodable,
          sampleRate: analyzedAsset.sampleRate,
          channels: analyzedAsset.channels,
          status: 'ready',
          analysisStartedAt: undefined,
          error: undefined,
          proxyFile: item.proxyFile ?? analyzedAsset.proxyFile,
          proxyUrl: item.proxyUrl ?? analyzedAsset.proxyUrl,
          proxyStatus: item.proxyStatus === 'ready' ? 'ready' : analyzedAsset.proxyStatus,
          useProxy: item.proxyStatus === 'ready' ? true : analyzedAsset.useProxy,
        } : item))
        if (!asset.imageSequenceFiles?.length && asset.kind !== 'image') {
          void analyzeMediaFile(asset.sourceFile!, asset.url, asset.kind, {
            includeWaveform: true,
            // Expensive ML tracking is available through the explicit tracking tool.
            // Import enrichment must remain responsive.
            includeFaceTrack: false,
          }).then((enrichment) => {
            setAssets((current) => current.map((item) => item.id === asset.id ? {
              ...item,
              thumbnailUrl: enrichment.thumbnailUrl ?? item.thumbnailUrl,
              waveform: enrichment.waveform ?? item.waveform,
              audioPeak: enrichment.audioPeak ?? item.audioPeak,
              faceTrack: enrichment.faceTrack ?? item.faceTrack,
            } : item))
          }).catch(() => undefined)
        }
        const streaming = Boolean((asset.sourceFile as File & { __editweaveStreaming?: boolean }).__editweaveStreaming)
        const needsVideoProxy = asset.kind === 'video' && !asset.imageSequenceFiles?.length && Boolean(analyzedAsset.sourcePath) && (analyzedAsset.videoDecodable === false || Boolean(analyzedAsset.audioCodec && analyzedAsset.audioDecodable === false))
        const needsImageSequenceProxy = asset.kind === 'video' && Boolean(asset.imageSequenceFiles?.length && asset.imageSequencePaths?.length) && analyzedAsset.videoDecodable === false
        const needsAudioProxy = asset.kind === 'audio' && Boolean(analyzedAsset.sourcePath) && analyzedAsset.audioDecodable === false
        const needsImageProxy = asset.kind === 'image' && Boolean(analyzedAsset.sourcePath) && analyzedAsset.imageDecodable === false
        const proxyAlreadyAvailable = analyzedAsset.proxyStatus === 'ready' || analyzedAsset.proxyStatus === 'loading'
        if (!proxyAlreadyAvailable && ((asset.kind === 'video' && !asset.imageSequenceFiles?.length && (streaming || needsVideoProxy)) || needsImageSequenceProxy || needsAudioProxy || needsImageProxy)) {
          const controller = new AbortController()
          proxyAbortRef.current.set(asset.id, controller)
          setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, proxyStatus: 'creating', proxyProgress: 0 } : item))
          try {
            const proxy = analyzedAsset.kind === 'audio'
              ? await createAudioCompatibilityProxy(analyzedAsset, { projectId, signal: controller.signal, onProgress: (progress) => setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, proxyProgress: progress } : item)) })
              : analyzedAsset.kind === 'image'
                ? await createImageCompatibilityProxy(analyzedAsset, { projectId, signal: controller.signal, onProgress: (progress) => setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, proxyProgress: progress } : item)) })
                : analyzedAsset.imageSequencePaths?.length
                  ? await createImageSequenceProxy(analyzedAsset, { projectId, quality: 'compatibility', signal: controller.signal, onProgress: (progress) => setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, proxyProgress: progress } : item)) })
                  : await createEditingProxy(analyzedAsset, { projectId, quality: analyzedAsset.videoDecodable === false || Boolean(analyzedAsset.audioCodec && analyzedAsset.audioDecodable === false) ? 'compatibility' : 'editing', signal: controller.signal, onProgress: (progress) => setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, proxyProgress: progress } : item)) })
            const proxyUrl = proxyPreviewUrl(proxy.file)
            const proxyAnalysis = analyzedAsset.kind === 'audio' || analyzedAsset.kind === 'image' ? await analyzeMediaFile(proxy.file, proxyUrl, analyzedAsset.kind).catch(() => undefined) : undefined
            setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, proxyFile: proxy.file, proxyUrl, proxySize: proxyFileSize(proxy.file), proxyWidth: 'width' in proxy ? proxy.width : proxyAnalysis?.width, proxyHeight: 'height' in proxy ? proxy.height : proxyAnalysis?.height, proxyFrameRate: 'frameRate' in proxy ? proxy.frameRate : undefined, proxyCachePath: proxy.cachePath, proxySourcePath: undefined, proxySourceName: undefined, proxyOrigin: 'generated', proxyPurpose: analyzedAsset.videoDecodable === false || analyzedAsset.audioDecodable === false || analyzedAsset.imageDecodable === false ? 'compatibility' : 'editing', proxyCachedAt: proxy.cachedAt, proxyTimecode: 'proxyTimecode' in proxy ? proxy.proxyTimecode : undefined, proxyTimecodeVerified: 'proxyTimecodeVerified' in proxy ? proxy.proxyTimecodeVerified : undefined, proxyTimecodeMismatch: 'proxyTimecodeMismatch' in proxy ? proxy.proxyTimecodeMismatch : undefined, waveform: proxyAnalysis?.waveform ?? item.waveform, audioPeak: proxyAnalysis?.audioPeak ?? item.audioPeak, thumbnailUrl: proxyAnalysis?.thumbnailUrl ?? item.thumbnailUrl, proxyStatus: 'ready', proxyProgress: 1, proxyEnabled: true, useProxy: true } : item))
          } catch (error) {
            const message = error instanceof Error ? error.message : '호환 편집 프록시 생성 실패'
            const canceled = error instanceof DOMException && error.name === 'AbortError'
            setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, proxyStatus: canceled ? 'none' : 'error', proxyError: canceled ? undefined : message, proxyProgress: undefined, useProxy: false } : item))
          } finally {
            proxyAbortRef.current.delete(asset.id)
          }
        }
        return analyzedAsset
      } catch (error) {
        const analysisMessage = error instanceof Error ? error.message : '미디어 분석에 실패했습니다.'
        if (runningInDesktop() && asset.sourcePath && (asset.kind === 'video' || asset.kind === 'audio' || asset.kind === 'image')) {
          const controller = new AbortController()
          proxyAbortRef.current.set(asset.id, controller)
          setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, status: 'ready', analysisStartedAt: undefined, proxyStatus: 'creating', proxyProgress: 0, error: undefined } : item))
          try {
            const recoveryAsset: MediaAsset = asset.kind === 'audio'
              ? { ...asset, audioDecodable: false }
              : asset.kind === 'image'
                ? { ...asset, imageDecodable: false }
                : { ...asset, width: asset.width ?? 1920, height: asset.height ?? 1080, frameRate: asset.frameRate ?? activeSequenceFps, videoDecodable: false }
            const proxy = recoveryAsset.kind === 'audio'
              ? await createAudioCompatibilityProxy(recoveryAsset, { projectId, signal: controller.signal, onProgress: (progress) => setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, proxyProgress: progress } : item)) })
              : recoveryAsset.kind === 'image'
                ? await createImageCompatibilityProxy(recoveryAsset, { projectId, signal: controller.signal, onProgress: (progress) => setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, proxyProgress: progress } : item)) })
                : recoveryAsset.imageSequencePaths?.length
                  ? await createImageSequenceProxy(recoveryAsset, { projectId, quality: 'compatibility', signal: controller.signal, onProgress: (progress) => setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, proxyProgress: progress } : item)) })
                  : await createEditingProxy(recoveryAsset, { projectId, quality: 'compatibility', signal: controller.signal, onProgress: (progress) => setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, proxyProgress: progress } : item)) })
            const proxyUrl = proxyPreviewUrl(proxy.file)
            const proxyAnalysis = await analyzeMediaFile(proxy.file, proxyUrl, recoveryAsset.kind)
            const recoveredAsset: MediaAsset = {
              ...recoveryAsset,
              ...proxyAnalysis,
              videoDecodable: recoveryAsset.kind === 'video' ? false : proxyAnalysis.videoDecodable,
              imageDecodable: recoveryAsset.kind === 'image' ? false : proxyAnalysis.imageDecodable,
              audioDecodable: recoveryAsset.kind === 'audio' || proxyAnalysis.audioCodec ? false : proxyAnalysis.audioDecodable,
              proxyFile: proxy.file,
              proxyUrl,
              proxySize: proxyFileSize(proxy.file),
              proxyWidth: 'width' in proxy ? proxy.width : undefined,
              proxyHeight: 'height' in proxy ? proxy.height : undefined,
              proxyFrameRate: 'frameRate' in proxy ? proxy.frameRate : undefined,
              proxyCachePath: proxy.cachePath,
              proxySourcePath: undefined,
              proxySourceName: undefined,
              proxyOrigin: 'generated',
              proxyPurpose: 'compatibility',
              proxyCachedAt: proxy.cachedAt,
              proxyTimecode: 'proxyTimecode' in proxy ? proxy.proxyTimecode : undefined,
              proxyTimecodeVerified: 'proxyTimecodeVerified' in proxy ? proxy.proxyTimecodeVerified : undefined,
              proxyTimecodeMismatch: 'proxyTimecodeMismatch' in proxy ? proxy.proxyTimecodeMismatch : undefined,
              status: 'ready',
              error: undefined,
              proxyStatus: 'ready',
              proxyProgress: 1,
              proxyEnabled: true,
              useProxy: true,
            }
            setAssets((current) => current.map((item) => item.id === asset.id ? recoveredAsset : item))
            return recoveredAsset
          } catch (proxyError) {
            const proxyMessage = proxyError instanceof Error ? proxyError.message : '호환 변환에 실패했습니다.'
            setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, status: 'error', error: `${analysisMessage} · ${proxyMessage}`, proxyStatus: 'error', proxyError: proxyMessage, proxyProgress: undefined, useProxy: false } : item))
            return undefined
          } finally {
            proxyAbortRef.current.delete(asset.id)
          }
        }
        setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, status: 'error', analysisStartedAt: undefined, error: analysisMessage } : item))
        return undefined
      }
    })
    const completed = outcomes.filter((asset): asset is MediaAsset => Boolean(asset))
    const refreshedDurations = new Map(completed.map((asset) => [asset.id, asset.duration]))
    if (assetsRef.current.some((asset) => asset.parentAssetId && refreshedDurations.has(asset.parentAssetId))) {
      setAssets((current) => current.map((asset) => {
        const rootDuration = asset.parentAssetId ? refreshedDurations.get(asset.parentAssetId) : undefined
        if (rootDuration === undefined) return asset
        const subclipIn = Math.min(asset.subclipIn ?? 0, Math.max(0, rootDuration - 1 / 60))
        const subclipOut = Math.max(subclipIn + 1 / 60, Math.min(asset.subclipOut ?? rootDuration, rootDuration))
        return { ...asset, subclipIn, subclipOut, duration: Math.max(1 / 60, subclipOut - subclipIn) }
      }))
    }
    const failed = outcomes.length - completed.length
    const resultNotes = [failed ? `분석 실패 ${failed}개` : '', duplicateCount ? `중복 ${duplicateCount}개 건너뜀` : '', readFailures.length ? `경로 읽기 실패 ${readFailures.length}개 (${readFailures[0].name})` : '', unsupportedFiles.length ? `미지원 ${unsupportedFiles.length}개 (${unsupportedFiles[0].name})` : ''].filter(Boolean)
    const enrichmentCount = completed.filter((asset) => !asset.imageSequenceFiles?.length && asset.kind !== 'image').length
    setToast(`미디어 ${completed.length}개 기본 분석 완료${enrichmentCount ? ' · 파형·얼굴 정보는 백그라운드 처리' : ''}${resultNotes.length ? ` · ${resultNotes.join(' · ')}` : ''}`)
    return completed
  }, [activeSequenceFps, projectId])

  const handleImageSequenceFiles = useCallback((fileCollection: FileList | File[], frameRate: number) => {
    const images = Array.from(fileCollection).filter((file) => getMediaKind(file) === 'image')
    if (images.length < 2) {
      setToast('이미지 시퀀스는 번호가 이어지는 이미지 파일을 두 장 이상 선택해주세요.')
      return
    }
    const numbered = images.flatMap((file) => {
      const match = file.name.match(/^(.*?)(\d+)(\.[^.]+)$/)
      return match ? [{ file, prefix: match[1].toLocaleLowerCase(), digits: match[2].length, frame: Number(match[2]), extension: match[3].toLocaleLowerCase() }] : []
    })
    if (numbered.length !== images.length) {
      setToast('모든 이미지 파일명 끝에 프레임 번호가 있어야 합니다. 예: shot_0001.png')
      return
    }
    const first = numbered[0]
    const matching = numbered.filter((item) => item.prefix === first.prefix && item.digits === first.digits && item.extension === first.extension).sort((a, b) => a.frame - b.frame)
    if (matching.length !== images.length || new Set(matching.map((item) => item.frame)).size !== images.length) {
      setToast('하나의 이미지 시퀀스만 선택하고 중복 프레임 번호를 제거해주세요.')
      return
    }
    const missingFrame = matching.find((item, index) => item.frame !== matching[0].frame + index)
    if (missingFrame) {
      setToast(`프레임 번호가 연속되지 않습니다. ${matching[0].frame}부터 누락 없이 선택해주세요.`)
      return
    }
    const orderedFiles = matching.map((item) => item.file)
    const carrier = orderedFiles[0] as File & { __editweaveImageSequenceFiles?: File[]; __editweaveImageSequenceFrameRate?: number }
    carrier.__editweaveImageSequenceFiles = orderedFiles
    carrier.__editweaveImageSequenceFrameRate = Math.max(1, Math.min(240, frameRate))
    void handleFiles([carrier])
  }, [handleFiles])

  const replaceMediaAsset = useCallback(async (assetId: string, file: File, preserveProxy = false): Promise<boolean> => {
    const asset = assetsRef.current.find((candidate) => candidate.id === assetId)
    if (!asset || asset.parentAssetId) return false
    const replacementKind = getMediaKind(file)
    if (!replacementKind) {
      setToast(`지원하지 않는 원본입니다: ${file.name}`)
      return false
    }
    if (replacementKind !== asset.kind) {
      setToast(`원본 교체는 같은 미디어 종류만 가능합니다. 현재 ${asset.kind} · 선택 ${replacementKind}`)
      return false
    }
    const pathFile = file as File & { __editweaveSourcePath?: string; __editweaveFileSize?: number; __editweaveStreaming?: boolean; __editweaveStreamUrl?: string }
    const nextUrl = pathFile.__editweaveStreamUrl ?? URL.createObjectURL(file)
    const sourceSignaturePromise = mediaFileQuickSignature(file)
    const preserveConnectedProxy = preserveProxy && asset.proxyStatus === 'ready' && Boolean(asset.proxyFile || asset.proxyUrl || asset.proxyCachePath || asset.proxySourcePath)
    const manualTimecode = asset.timecodeSource === 'manual' ? {
      timecodeStart: asset.timecodeStart,
      sourceTimecode: asset.sourceTimecode,
      timecodeDropFrame: asset.timecodeDropFrame,
      timecodeSource: asset.timecodeSource,
    } : {}
    const replacementBase: MediaAsset = {
      ...asset,
      name: preserveProxy ? asset.name : file.name,
      kind: replacementKind,
      url: nextUrl,
      sourceFile: file,
      sourcePath: pathFile.__editweaveSourcePath,
      sourceLastModified: file.lastModified,
      sourceQuickSignature: asset.sourceQuickSignature,
      streamingSource: Boolean(pathFile.__editweaveStreaming),
      imageSequenceFiles: undefined,
      imageSequencePaths: undefined,
      imageSequenceUrls: undefined,
      imageSequenceFrameRate: undefined,
      duration: asset.duration,
      size: pathFile.__editweaveFileSize ?? file.size,
      extension: file.name.split('.').pop() ?? asset.extension,
      width: undefined, height: undefined, videoCodec: undefined, videoDecodable: undefined, imageDecodable: undefined,
      frameRate: undefined, variableFrameRate: undefined, frameRateVariation: undefined,
      audioCodec: undefined, audioDecodable: undefined, sampleRate: undefined, channels: undefined, audioStreams: undefined, sourceAudioStreamIndex: undefined,
      audioPeak: undefined, thumbnailUrl: undefined, waveform: undefined,
      proxyFile: preserveConnectedProxy ? asset.proxyFile : undefined, proxyUrl: preserveConnectedProxy ? asset.proxyUrl : undefined, proxySize: preserveConnectedProxy ? asset.proxySize : undefined, proxyWidth: preserveConnectedProxy ? asset.proxyWidth : undefined, proxyHeight: preserveConnectedProxy ? asset.proxyHeight : undefined, proxyFrameRate: preserveConnectedProxy ? asset.proxyFrameRate : undefined,
      proxyCachePath: preserveConnectedProxy ? asset.proxyCachePath : undefined, proxySourcePath: preserveConnectedProxy ? asset.proxySourcePath : undefined, proxySourceName: preserveConnectedProxy ? asset.proxySourceName : undefined, proxyOrigin: preserveConnectedProxy ? asset.proxyOrigin : undefined, proxyPurpose: preserveConnectedProxy ? asset.proxyPurpose : undefined, proxyCachedAt: preserveConnectedProxy ? asset.proxyCachedAt : undefined, proxyTimecode: preserveConnectedProxy ? asset.proxyTimecode : undefined, proxyTimecodeVerified: preserveConnectedProxy ? asset.proxyTimecodeVerified : undefined, proxyTimecodeMismatch: preserveConnectedProxy ? asset.proxyTimecodeMismatch : undefined,
      proxyStatus: preserveConnectedProxy ? 'ready' : 'none', proxyProgress: preserveConnectedProxy ? 1 : undefined, proxyError: undefined, proxyEnabled: preserveConnectedProxy ? asset.proxyEnabled : undefined, useProxy: preserveConnectedProxy ? asset.proxyEnabled !== false : false,
      timecodeStart: undefined, sourceTimecode: undefined, timecodeDropFrame: undefined, timecodeSource: undefined, reelName: undefined,
      colorPrimaries: undefined, colorTransfer: undefined, colorSpace: undefined, colorRange: undefined, hdrFormat: undefined, hdrMasteringDisplay: undefined,
      maxContentLightLevel: undefined, maxFrameAverageLightLevel: undefined, faceTrack: undefined,
      ...manualTimecode,
      status: 'ready',
      error: undefined,
    }
    const commitReplacement = (replacement: MediaAsset) => {
      const nextAssets = assetsRef.current.map((candidate) => {
        if (candidate.id === assetId) return replacement
        if (candidate.parentAssetId !== assetId) return candidate
        const subclipIn = Math.min(candidate.subclipIn ?? 0, Math.max(0, replacement.duration - 1 / 60))
        const subclipOut = Math.max(subclipIn + 1 / 60, Math.min(candidate.subclipOut ?? replacement.duration, replacement.duration))
        return { ...candidate, subclipIn, subclipOut, duration: Math.max(1 / 60, subclipOut - subclipIn) }
      })
      assetsRef.current = nextAssets
      setAssets(nextAssets)
      releaseImageSequenceUrls(asset)
      releaseObjectUrl(asset.url)
      if (!preserveConnectedProxy || replacement.proxyUrl !== asset.proxyUrl) releaseObjectUrl(asset.proxyUrl)
      if (!preserveConnectedProxy) void deleteProxyFile(asset.proxyCachePath).catch(() => undefined)
      setSelectedAssetId(assetId)
    }
    setToast(`${asset.name}의 새 원본을 분석하고 있습니다.`)
    try {
      const [analysis, sourceQuickSignature] = await Promise.all([analyzeMediaFile(file, nextUrl, replacementKind), sourceSignaturePromise])
      const nextDuration = replacementKind === 'image' ? asset.duration : analysis.duration
      const replacement: MediaAsset = {
        ...replacementBase,
        ...analysis,
        duration: nextDuration,
        sourceQuickSignature,
        ...manualTimecode,
      }
      commitReplacement(replacement)
      const needsCodecProxy = !preserveConnectedProxy && Boolean(replacement.sourcePath) && (replacement.kind === 'video'
        ? replacement.streamingSource || replacement.videoDecodable === false || Boolean(replacement.audioCodec && replacement.audioDecodable === false)
        : replacement.kind === 'audio' ? replacement.audioDecodable === false : replacement.kind === 'image' && replacement.imageDecodable === false)
      if (needsCodecProxy) {
        const controller = new AbortController()
        proxyAbortRef.current.set(assetId, controller)
        assetsRef.current = assetsRef.current.map((candidate) => candidate.id === assetId ? { ...candidate, proxyStatus: 'creating', proxyProgress: 0 } : candidate)
        setAssets(assetsRef.current)
        setToast(`${file.name} 원본 교체 완료 · 호환 편집 프록시를 생성하고 있습니다.`)
        try {
          const proxy = replacement.kind === 'audio'
            ? await createAudioCompatibilityProxy(replacement, { projectId, signal: controller.signal, onProgress: (progress) => setAssets((current) => current.map((candidate) => candidate.id === assetId ? { ...candidate, proxyProgress: progress } : candidate)) })
            : replacement.kind === 'image'
              ? await createImageCompatibilityProxy(replacement, { projectId, signal: controller.signal, onProgress: (progress) => setAssets((current) => current.map((candidate) => candidate.id === assetId ? { ...candidate, proxyProgress: progress } : candidate)) })
              : await createEditingProxy(replacement, { projectId, quality: replacement.videoDecodable === false || Boolean(replacement.audioCodec && replacement.audioDecodable === false) ? 'compatibility' : 'editing', signal: controller.signal, onProgress: (progress) => setAssets((current) => current.map((candidate) => candidate.id === assetId ? { ...candidate, proxyProgress: progress } : candidate)) })
          const proxyUrl = proxyPreviewUrl(proxy.file)
          const proxyAnalysis = replacement.kind === 'audio' || replacement.kind === 'image' ? await analyzeMediaFile(proxy.file, proxyUrl, replacement.kind).catch(() => undefined) : undefined
          assetsRef.current = assetsRef.current.map((candidate) => candidate.id === assetId ? { ...candidate, proxyFile: proxy.file, proxyUrl, proxySize: proxyFileSize(proxy.file), proxyWidth: 'width' in proxy ? proxy.width : proxyAnalysis?.width, proxyHeight: 'height' in proxy ? proxy.height : proxyAnalysis?.height, proxyFrameRate: 'frameRate' in proxy ? proxy.frameRate : undefined, proxyCachePath: proxy.cachePath, proxySourcePath: undefined, proxySourceName: undefined, proxyOrigin: 'generated', proxyPurpose: replacement.videoDecodable === false || replacement.audioDecodable === false || replacement.imageDecodable === false ? 'compatibility' : 'editing', proxyCachedAt: proxy.cachedAt, proxyTimecode: 'proxyTimecode' in proxy ? proxy.proxyTimecode : undefined, proxyTimecodeVerified: 'proxyTimecodeVerified' in proxy ? proxy.proxyTimecodeVerified : undefined, proxyTimecodeMismatch: 'proxyTimecodeMismatch' in proxy ? proxy.proxyTimecodeMismatch : undefined, waveform: proxyAnalysis?.waveform ?? candidate.waveform, audioPeak: proxyAnalysis?.audioPeak ?? candidate.audioPeak, thumbnailUrl: proxyAnalysis?.thumbnailUrl ?? candidate.thumbnailUrl, proxyStatus: 'ready', proxyProgress: 1, proxyError: undefined, proxyEnabled: true, useProxy: true } : candidate)
          setAssets(assetsRef.current)
          setToast(`${file.name} 원본과 호환 편집 프록시로 교체했습니다. 타임라인 편집과 효과는 유지됩니다.`)
        } catch (error) {
          const canceled = error instanceof DOMException && error.name === 'AbortError'
          assetsRef.current = assetsRef.current.map((candidate) => candidate.id === assetId ? { ...candidate, proxyStatus: canceled ? 'none' : 'error', proxyProgress: undefined, proxyError: canceled ? undefined : error instanceof Error ? error.message : '호환 프록시 생성 실패', useProxy: false } : candidate)
          setAssets(assetsRef.current)
          setToast(canceled ? '원본은 교체했고 프록시 생성은 취소했습니다.' : '원본은 교체했지만 호환 프록시를 만들지 못했습니다. 미디어 패널에서 다시 생성할 수 있습니다.')
        } finally {
          proxyAbortRef.current.delete(assetId)
        }
      } else {
        setToast(preserveProxy ? `${asset.name}의 전체 해상도 원본을 다시 연결했습니다.${preserveConnectedProxy ? ' 기존 프록시 연결도 유지됩니다.' : ''}` : `${asset.name}의 원본을 ${file.name}(으)로 교체했습니다. 타임라인 편집과 효과는 유지됩니다.`)
      }
      return true
    } catch (error) {
      const analysisMessage = error instanceof Error ? error.message : '새 원본을 분석하지 못했습니다.'
      const sourceQuickSignature = await sourceSignaturePromise
      if (runningInDesktop() && replacementBase.sourcePath) {
        const controller = new AbortController()
        proxyAbortRef.current.set(assetId, controller)
        setToast(`${file.name} 분석기를 우회해 호환 원본으로 변환하고 있습니다.`)
        try {
          const recoveryAsset: MediaAsset = replacementKind === 'audio'
            ? { ...replacementBase, sourceQuickSignature, audioDecodable: false }
            : replacementKind === 'image'
              ? { ...replacementBase, sourceQuickSignature, imageDecodable: false }
              : { ...replacementBase, sourceQuickSignature, width: asset.width ?? 1920, height: asset.height ?? 1080, frameRate: asset.frameRate ?? activeSequenceFps, videoDecodable: false }
          const proxy = recoveryAsset.kind === 'audio'
            ? await createAudioCompatibilityProxy(recoveryAsset, { projectId, signal: controller.signal })
            : recoveryAsset.kind === 'image'
              ? await createImageCompatibilityProxy(recoveryAsset, { projectId, signal: controller.signal })
              : await createEditingProxy(recoveryAsset, { projectId, quality: 'compatibility', signal: controller.signal })
          const proxyUrl = proxyPreviewUrl(proxy.file)
          const proxyAnalysis = await analyzeMediaFile(proxy.file, proxyUrl, recoveryAsset.kind)
          const replacement: MediaAsset = {
            ...recoveryAsset,
            ...proxyAnalysis,
            duration: replacementKind === 'image' ? asset.duration : proxyAnalysis.duration,
            videoDecodable: replacementKind === 'video' ? false : proxyAnalysis.videoDecodable,
            imageDecodable: replacementKind === 'image' ? false : proxyAnalysis.imageDecodable,
            audioDecodable: replacementKind === 'audio' || proxyAnalysis.audioCodec ? false : proxyAnalysis.audioDecodable,
            proxyFile: proxy.file,
            proxyUrl,
            proxySize: proxyFileSize(proxy.file),
            proxyWidth: 'width' in proxy ? proxy.width : proxyAnalysis.width,
            proxyHeight: 'height' in proxy ? proxy.height : proxyAnalysis.height,
            proxyFrameRate: 'frameRate' in proxy ? proxy.frameRate : undefined,
            proxyCachePath: proxy.cachePath,
            proxySourcePath: undefined,
            proxySourceName: undefined,
            proxyOrigin: 'generated',
            proxyPurpose: 'compatibility',
            proxyCachedAt: proxy.cachedAt,
            proxyTimecode: 'proxyTimecode' in proxy ? proxy.proxyTimecode : undefined,
            proxyTimecodeVerified: 'proxyTimecodeVerified' in proxy ? proxy.proxyTimecodeVerified : undefined,
            proxyTimecodeMismatch: 'proxyTimecodeMismatch' in proxy ? proxy.proxyTimecodeMismatch : undefined,
            proxyStatus: 'ready', proxyProgress: 1, proxyError: undefined, proxyEnabled: true, useProxy: true,
          }
          commitReplacement(replacement)
          setToast(`${file.name} 원본을 호환 프록시와 함께 교체했습니다. 기존 타임라인 편집과 효과는 유지됩니다.`)
          return true
        } catch (proxyError) {
          releaseObjectUrl(nextUrl)
          setToast(`원본 교체 실패: ${analysisMessage} · ${proxyError instanceof Error ? proxyError.message : '호환 변환 실패'}`)
          return false
        } finally {
          proxyAbortRef.current.delete(assetId)
        }
      }
      releaseObjectUrl(nextUrl)
      setToast(`원본 교체 실패: ${analysisMessage}`)
      return false
    }
  }, [activeSequenceFps, projectId])

  const batchRelinkOfflineMedia = useCallback(async () => {
    const offline = assetsRef.current.filter((asset) => !asset.parentAssetId && (asset.status === 'offline' || asset.status === 'error'))
    if (!offline.length) {
      setToast('재연결할 오프라인 미디어가 없습니다.')
      return
    }
    if (!runningInDesktop()) {
      setToast('폴더 일괄 재연결은 데스크톱 앱에서 사용할 수 있습니다.')
      return
    }
    const directory = await selectMediaRelinkDirectory()
    if (!directory) return
    setToast(`${offline.length}개 오프라인 원본을 선택 폴더와 하위 폴더에서 찾고 있습니다.`)
    try {
      const candidates = await findMediaRelinkCandidates(directory, offline.flatMap((asset) => {
        const firstSequenceFrame = asset.imageSequencePaths?.[0]?.split(/[\\/]/).pop()
        return [asset.name, asset.reelName, firstSequenceFrame].filter((value): value is string => Boolean(value))
      }))
      const selected = offline.flatMap((asset) => {
        const firstSequenceFrame = asset.imageSequencePaths?.[0]?.split(/[\\/]/).pop()
        const lookupNames = [asset.name, asset.reelName, firstSequenceFrame].filter((value): value is string => Boolean(value))
        const lookupKeys = new Set(lookupNames.map(mediaFilenameKey).filter(Boolean))
        const namedMatches = candidates.filter((candidate) => lookupNames.some((name) => candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase()) || lookupKeys.has(mediaFilenameKey(candidate.name)))
        const signatureMatches = asset.sourceQuickSignature ? namedMatches.filter((candidate) => candidate.quickSignature === asset.sourceQuickSignature) : []
        const matches = (signatureMatches.length
          ? signatureMatches
          : asset.sourceQuickSignature
            ? namedMatches.filter((candidate) => candidate.quickSignature === undefined)
            : namedMatches)
          .sort((left, right) => {
            const leftScore = (asset.sourceQuickSignature && left.quickSignature === asset.sourceQuickSignature ? 50_000 : 0) + (left.name.toLocaleLowerCase() === asset.name.toLocaleLowerCase() ? 20_000 : 0) + (asset.size > 0 && left.size === asset.size ? 10_000 : 0) + (asset.sourceLastModified !== undefined && left.modifiedAt !== undefined && Math.abs(asset.sourceLastModified - left.modifiedAt) < 2_000 ? 5_000 : 0) + mediaPathSuffixScore(asset.sourcePath, left.path)
            const rightScore = (asset.sourceQuickSignature && right.quickSignature === asset.sourceQuickSignature ? 50_000 : 0) + (right.name.toLocaleLowerCase() === asset.name.toLocaleLowerCase() ? 20_000 : 0) + (asset.size > 0 && right.size === asset.size ? 10_000 : 0) + (asset.sourceLastModified !== undefined && right.modifiedAt !== undefined && Math.abs(asset.sourceLastModified - right.modifiedAt) < 2_000 ? 5_000 : 0) + mediaPathSuffixScore(asset.sourcePath, right.path)
            return rightScore - leftScore
          })
        return matches[0] ? [{ asset, candidate: matches[0] }] : []
      })
      if (!selected.length) {
        setToast(`선택 폴더에서 오프라인 원본과 같은 파일명을 찾지 못했습니다.`)
        return
      }
      const readResult = await readMediaFilesFromPaths([...new Set(selected.map(({ candidate }) => candidate.path))])
      const filesByPath = new Map(readResult.files.map((file) => [normalizedMediaPath((file as File & { __editweaveSourcePath?: string }).__editweaveSourcePath), file]))
      let connected = 0
      for (const { asset, candidate } of selected) {
        if ((asset.imageSequencePaths?.length ?? 0) >= 2) {
          const sequenceDirectory = candidate.path.replace(/[\\/][^\\/]+$/, '')
          const result = await readMediaEntriesFromPaths([sequenceDirectory])
          const expected = asset.imageSequencePaths![0].split(/[\\/]/).pop()?.match(/^(.*?)(\d+)(\.[^.]+)$/)
          const sequenceFiles = expected ? result.files.filter((item) => {
            const match = item.name.match(/^(.*?)(\d+)(\.[^.]+)$/)
            return Boolean(match && match[1].toLocaleLowerCase() === expected[1].toLocaleLowerCase() && match[2].length === expected[2].length && match[3].toLocaleLowerCase() === expected[3].toLocaleLowerCase())
          }) : []
          if (sequenceFiles.length === asset.imageSequencePaths!.length) {
            handleImageSequenceFiles(sequenceFiles, asset.imageSequenceFrameRate ?? asset.frameRate ?? activeSequenceFps)
            connected += 1
          }
          continue
        }
        const file = filesByPath.get(normalizedMediaPath(candidate.path))
        if (file && await replaceMediaAsset(asset.id, file, true)) connected += 1
      }
      const missing = offline.length - connected
      setToast(`일괄 재연결 완료 · ${connected}개 연결${missing ? ` · ${missing}개 미발견 또는 분석 실패` : ''}${readResult.failures.length ? ` · 읽기 실패 ${readResult.failures.length}개` : ''}`)
    } catch (error) {
      setToast(error instanceof Error ? `일괄 재연결 실패: ${error.message}` : '선택 폴더에서 오프라인 미디어를 재연결하지 못했습니다.')
    }
  }, [activeSequenceFps, handleImageSequenceFiles, replaceMediaAsset])

  const completeVoiceover = useCallback(async (session: VoiceoverSessionResult) => {
    if (!session.takes.length) throw new Error('저장할 ADR 테이크가 없습니다.')
    const persistedFiles = await Promise.all(session.takes.map((take) => persistVoiceoverRecording(projectId, take.file)))
    const imported = await handleFiles(persistedFiles)
    if (imported.length !== session.takes.length) throw new Error('일부 ADR 테이크를 분석하지 못했습니다.')

    const cueId = crypto.randomUUID()
    let nextTracks = tracksRef.current
    const usedTrackIds = new Set<string>()
    const takeRecords: AdrCue['takes'] = []
    const clips: TimelineClip[] = []
    for (let index = 0; index < session.takes.length; index++) {
      const take = session.takes[index]
      const asset = imported[index]
      const laneName = `ADR · Take ${take.takeNumber}`
      let targetTrack = nextTracks.find((track) => track.kind === 'audio' && track.name === laneName && !track.locked && !usedTrackIds.has(track.id) && !track.clips.some((clip) => clip.start < session.end && clip.start + clip.duration > session.start))
      if (!targetTrack) {
        const previousIds = new Set(nextTracks.map((track) => track.id))
        nextTracks = addTimelineTrack(nextTracks, 'audio')
        targetTrack = nextTracks.find((track) => track.kind === 'audio' && !previousIds.has(track.id))
      }
      if (!targetTrack) throw new Error(`ADR Take ${take.takeNumber} 레인을 만들지 못했습니다.`)
      usedTrackIds.add(targetTrack.id)
      const takeId = crypto.randomUUID()
      const clipId = crypto.randomUUID()
      const selected = take.takeNumber === session.selectedTakeNumber
      const clip: TimelineClip = {
        id: clipId,
        trackId: targetTrack.id,
        assetId: asset.id,
        name: take.cue ? `ADR T${take.takeNumber} · ${take.cue.slice(0, 36)}` : `ADR T${take.takeNumber} · ${formatTimecode(session.start, true)}`,
        start: session.start,
        duration: Math.max(0.05, asset.duration),
        sourceOffset: 0,
        kind: 'audio',
        color: selected ? '#21b889' : '#466d63',
        transform: { ...defaultTransform },
        playbackRate: 1,
        reverse: false,
        freezeFrame: false,
        transitionIn: { type: 'none', duration: 0.5 },
        transitionOut: { type: 'none', duration: 0.5 },
        colorAdjustment: defaultColorAdjustment(),
        audioAdjustment: { ...defaultAudioAdjustment(), role: 'dialogue', fadeIn: 0.02, fadeOut: 0.04 },
        audioDisabled: !selected,
        adrCue: take.cue,
        adrTake: take.takeNumber,
        adrCueId: cueId,
        adrTakeId: takeId,
        adrCompRanges: selected ? [{ start: session.start, end: Math.max(session.start + 0.5, session.end) }] : [],
      }
      clips.push(clip)
      takeRecords.push({ id: takeId, assetId: asset.id, clipId, trackId: targetTrack.id, takeNumber: take.takeNumber, duration: asset.duration, createdAt: new Date().toISOString() })
    }
    const clipByTrack = new Map(clips.map((clip) => [clip.trackId, clip]))
    nextTracks = nextTracks.map((track) => {
      const clip = clipByTrack.get(track.id)
      if (!clip) return track
      return { ...track, name: `ADR · Take ${clip.adrTake}`, syncLock: true, clips: [...track.clips, clip].sort((left, right) => left.start - right.start) }
    })
    const selectedTake = takeRecords.find((take) => take.takeNumber === session.selectedTakeNumber) ?? takeRecords[0]
    const now = new Date().toISOString()
    const cueEnd = Math.max(session.start + 0.5, session.end)
    const cue: AdrCue = { id: cueId, sequenceId: activeSequenceId, start: session.start, end: cueEnd, text: session.takes.find((take) => take.takeNumber === session.selectedTakeNumber)?.cue ?? session.takes[0]?.cue ?? '', status: 'approved', selectedTakeId: selectedTake.id, takes: takeRecords, compSegments: [{ id: crypto.randomUUID(), start: session.start, end: cueEnd, takeId: selectedTake.id }], createdAt: now, updatedAt: now }
    commitTracks(() => nextTracks)
    updateAdrCues((current) => [...current, cue])
    setSelectedAssetId(undefined)
    setSelectedClipId(selectedTake.clipId)
    setSelectedTrackId(selectedTake.trackId)
    setPlayhead(session.start)
    setToast(`ADR 큐와 ${takeRecords.length}개 테이크 레인을 저장하고 Take ${selectedTake.takeNumber}을 채택했습니다.`)
  }, [activeSequenceId, commitTracks, handleFiles, projectId, updateAdrCues])

  const selectAdrTake = useCallback((cueId: string, takeId: string) => {
    const cue = adrCues.find((item) => item.id === cueId)
    const selected = cue?.takes.find((take) => take.id === takeId)
    if (!cue || !selected) return
    const clipIds = new Set(cue.takes.map((take) => take.clipId))
    commitTracks((current) => current.map((track) => ({ ...track, clips: track.clips.map((clip) => clipIds.has(clip.id) ? { ...clip, audioDisabled: clip.id !== selected.clipId, adrCompRanges: clip.id === selected.clipId ? [{ start: cue.start, end: cue.end }] : [], color: clip.id === selected.clipId ? '#21b889' : '#466d63' } : clip) })))
    updateAdrCues((current) => current.map((item) => item.id === cueId ? { ...item, selectedTakeId: takeId, compSegments: [{ id: crypto.randomUUID(), start: item.start, end: item.end, takeId }], status: 'approved', updatedAt: new Date().toISOString() } : item))
    setSelectedClipId(selected.clipId)
    setSelectedTrackId(selected.trackId)
    setSelectedAssetId(undefined)
    setPlayhead(cue.start)
    setToast(`ADR Take ${selected.takeNumber}을 채택했습니다.`)
  }, [adrCues, commitTracks, updateAdrCues])

  const assignAdrCompRange = useCallback((cueId: string, takeId: string, start: number, end: number) => {
    const cue = adrCues.find((item) => item.id === cueId)
    if (!cue || !cue.takes.some((take) => take.id === takeId)) return
    const segments = replaceAdrCompRange(cue, takeId, start, end)
    const rangesByTake = new Map(cue.takes.map((take) => [take.id, segments.filter((segment) => segment.takeId === take.id).map(({ start: rangeStart, end: rangeEnd }) => ({ start: rangeStart, end: rangeEnd }))]))
    const clipByTake = new Map(cue.takes.map((take) => [take.clipId, take.id]))
    commitTracks((current) => current.map((track) => ({ ...track, clips: track.clips.map((clip) => {
      const clipTakeId = clipByTake.get(clip.id)
      if (!clipTakeId) return clip
      const ranges = rangesByTake.get(clipTakeId) ?? []
      return { ...clip, audioDisabled: ranges.length === 0, adrCompRanges: ranges, color: ranges.length ? '#21b889' : '#466d63' }
    }) })))
    updateAdrCues((current) => current.map((item) => item.id === cueId ? { ...item, selectedTakeId: takeId, compSegments: segments, status: 'approved', updatedAt: new Date().toISOString() } : item))
    setToast(`ADR 구간 ${formatTimecode(Math.min(start, end), true)}–${formatTimecode(Math.max(start, end), true)}에 선택 테이크를 채택했습니다.`)
  }, [adrCues, commitTracks, updateAdrCues])

  const deleteAdrCue = useCallback((cueId: string) => {
    const cue = adrCues.find((item) => item.id === cueId)
    if (!cue || cue.sequenceId !== activeSequenceId) return
    const clipIds = new Set(cue.takes.map((take) => take.clipId))
    const assetIds = new Set(cue.takes.map((take) => take.assetId))
    const currentSequence = captureActiveSequence()
    const projectSequences = sequenceLibrary.map((sequence) => sequence.id === currentSequence.id ? currentSequence : sequence)
    const sharedAssetIds = new Set([...assetIds].filter((assetId) =>
      projectSequences.some((sequence) => sequence.tracks.some((track) => track.clips.some((clip) => clip.assetId === assetId && !(sequence.id === cue.sequenceId && clipIds.has(clip.id)))))
      || adrCues.some((item) => item.id !== cue.id && item.takes.some((take) => take.assetId === assetId))))
    const removableAssetIds = new Set([...assetIds].filter((assetId) => !sharedAssetIds.has(assetId)))
    const sharedNote = sharedAssetIds.size ? `\n\n다른 클립 또는 ADR 큐에서 사용하는 녹음 원본 ${sharedAssetIds.size}개는 프로젝트와 디스크에 보존됩니다.` : ''
    if (!window.confirm(`ADR 큐와 테이크 레인을 삭제할까요? 전용 녹음 원본 ${removableAssetIds.size}개는 디스크에서도 삭제되며 실행 취소할 수 없습니다.${sharedNote}`)) return
    const recordings = assetsRef.current.filter((asset) => removableAssetIds.has(asset.id))
    recordings.forEach((asset) => {
      releaseObjectUrl(asset.url)
      releaseObjectUrl(asset.proxyUrl)
    })
    void Promise.all(recordings.flatMap((asset) => [deleteVoiceoverRecording(asset.sourcePath).catch(() => undefined), deleteProxyFile(asset.proxyCachePath).catch(() => undefined)]))
    commitTracks((current) => current.map((track) => ({ ...track, clips: track.clips.filter((clip) => !clipIds.has(clip.id)) })))
    const nextAssets = assetsRef.current.filter((asset) => !removableAssetIds.has(asset.id))
    assetsRef.current = nextAssets
    setAssets(nextAssets)
    setSelectedAssetId((current) => current && removableAssetIds.has(current) ? undefined : current)
    updateAdrCues((current) => current.filter((item) => item.id !== cueId))
    setSelectedClipId(undefined)
    setToast(`ADR 큐와 테이크 레인을 삭제했습니다. 전용 원본 ${removableAssetIds.size}개 삭제 · 공유 원본 ${sharedAssetIds.size}개 보존`)
  }, [activeSequenceId, adrCues, captureActiveSequence, commitTracks, sequenceLibrary, updateAdrCues])

  const relinkSourceAssets = useCallback(async (candidates: MediaAsset[]) => {
    if (!runningInDesktop()) return
    const imageSequences = candidates.filter((asset) => asset.status === 'offline' && (asset.imageSequencePaths?.length ?? 0) >= 2)
    for (const asset of imageSequences) {
      try {
        const result = await readMediaFilesFromPaths(asset.imageSequencePaths!)
        if (result.files.length) handleImageSequenceFiles(result.files, asset.imageSequenceFrameRate ?? asset.frameRate ?? activeSequenceFps)
      } catch {
        // The regular relink flow below keeps the asset offline when sequence frames are unavailable.
      }
    }
    const sequenceIds = new Set(imageSequences.map((asset) => asset.id))
    const paths = candidates.flatMap((asset) => asset.status === 'offline' && !sequenceIds.has(asset.id) && asset.sourcePath ? [asset.sourcePath] : [])
    if (!paths.length) return
    try {
      const result = await readMediaFilesFromPaths(paths)
      if (result.files.length || result.failures.length) await handleFiles(result.files, result.failures)
    } catch (error) {
      setToast(error instanceof Error ? `원본 미디어 자동 연결 실패: ${error.message}` : '원본 미디어를 자동으로 연결하지 못했습니다.')
    }
  }, [activeSequenceFps, handleFiles, handleImageSequenceFiles])

  useEffect(() => {
    if (initialSourceRelinkStartedRef.current) return
    initialSourceRelinkStartedRef.current = true
    void relinkSourceAssets(assetsRef.current)
  }, [relinkSourceAssets])

  useEffect(() => {
    if (!runningInDesktop()) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== 'drop' || !event.payload.paths.length) return
      void readMediaEntriesFromPaths(event.payload.paths)
        .then((result) => handleFiles(result.files, result.failures, result.bins))
        .catch((error: unknown) => setToast(error instanceof Error ? `드롭한 파일을 읽지 못했습니다: ${error.message}` : '드롭한 파일을 읽지 못했습니다.'))
    })).then((dispose) => {
      if (disposed) dispose()
      else unlisten = dispose
    }).catch((error: unknown) => setToast(error instanceof Error ? `파일 드롭 기능을 준비하지 못했습니다: ${error.message}` : '파일 드롭 기능을 준비하지 못했습니다.'))
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [handleFiles])

  const attachProxy = useCallback(async (assetId: string, file: File): Promise<boolean> => {
    const asset = assetsRef.current.find((item) => item.id === assetId)
    if (!asset || asset.parentAssetId || asset.proxyStatus === 'creating') return false
    const proxyKind = getMediaKind(file)
    if (!proxyKind || proxyKind !== asset.kind) {
      setToast(`외부 프록시는 원본과 같은 미디어 종류여야 합니다. 원본 ${asset.kind} · 선택 ${proxyKind ?? '미지원'}`)
      return false
    }
    const pathFile = file as File & { __editweaveSourcePath?: string; __editweaveFileSize?: number; __editweaveStreaming?: boolean; __editweaveStreamUrl?: string }
    const proxyUrl = proxyPreviewUrl(file)
    setAssets((current) => current.map((item) => item.id === assetId ? { ...item, proxyStatus: 'loading', proxyError: undefined } : item))
    try {
      const analysis = await analyzeMediaFile(file, proxyUrl, proxyKind)
      const directlyPlayable = proxyKind === 'video' ? analysis.videoDecodable !== false : proxyKind === 'audio' ? analysis.audioDecodable !== false : analysis.imageDecodable !== false
      if (!directlyPlayable) throw new Error('선택한 파일은 편집 미리보기에서 직접 재생할 수 있는 프록시 형식이 아닙니다.')
      if (asset.kind !== 'image' && asset.duration > 0 && analysis.duration > 0) {
        const durationDifference = Math.abs(asset.duration - analysis.duration)
        const durationTolerance = Math.max(.5, asset.duration * .01)
        if (durationDifference > durationTolerance) throw new Error(`프록시 길이가 원본과 ${durationDifference.toFixed(2)}초 다릅니다. 동일한 전체 길이의 프록시를 연결해주세요.`)
      }
      if (asset.kind !== 'audio' && asset.width && asset.height && analysis.width && analysis.height) {
        const sourceAspect = asset.width / asset.height
        const proxyAspect = analysis.width / analysis.height
        if (Math.abs(sourceAspect - proxyAspect) / sourceAspect > .01) throw new Error(`프록시 화면비가 원본과 다릅니다. 원본 ${asset.width}×${asset.height} · 프록시 ${analysis.width}×${analysis.height}`)
      }
      const frameRateMismatch = asset.kind === 'video' && Boolean(asset.frameRate && analysis.frameRate && Math.abs(asset.frameRate - analysis.frameRate) > .01)
      const startTimecodeMismatch = Boolean(asset.sourceTimecode && analysis.sourceTimecode && asset.sourceTimecode !== analysis.sourceTimecode)
      const timecodeMismatch = frameRateMismatch || startTimecodeMismatch
      const previousCachePath = asset.proxyCachePath
      releaseObjectUrl(asset.proxyUrl)
      const nextAssets = assetsRef.current.map((item) => item.id === assetId ? {
        ...item,
        proxyFile: file,
        proxyUrl,
        proxySize: pathFile.__editweaveFileSize ?? file.size,
        proxyWidth: analysis.width,
        proxyHeight: analysis.height,
        proxyFrameRate: analysis.frameRate,
        proxyCachePath: undefined,
        proxySourcePath: pathFile.__editweaveSourcePath,
        proxySourceName: file.name,
        proxyOrigin: 'attached' as const,
        proxyPurpose: 'external' as const,
        proxyCachedAt: undefined,
        proxyTimecode: analysis.sourceTimecode,
        proxyTimecodeVerified: !timecodeMismatch && Boolean(asset.sourceTimecode && analysis.sourceTimecode),
        proxyTimecodeMismatch: timecodeMismatch,
        proxyStatus: 'ready' as const,
        proxyProgress: 1,
        proxyError: undefined,
        proxyEnabled: true,
        useProxy: true,
      } : item)
      assetsRef.current = nextAssets
      setAssets(nextAssets)
      await deleteProxyFile(previousCachePath).catch(() => undefined)
      setToast(`외부 프록시를 연결했습니다: ${file.name}${timecodeMismatch ? ' · 원본과 fps 또는 시작 TC가 달라 TC 불일치로 표시됩니다.' : ''}`)
      return true
    } catch (error) {
      releaseObjectUrl(proxyUrl)
      const message = error instanceof Error ? error.message : '외부 프록시를 연결하지 못했습니다.'
      setAssets((current) => current.map((item) => item.id === assetId ? { ...item, proxyStatus: item.proxyFile || item.proxyUrl ? 'ready' : 'error', proxyError: message, useProxy: Boolean(item.proxyFile || item.proxyUrl) } : item))
      setToast(message)
      return false
    }
  }, [])

  const batchRelinkExternalProxies = useCallback(async () => {
    const missing = assetsRef.current.filter((asset) => !asset.parentAssetId && asset.proxySourcePath && asset.proxyStatus === 'error')
    if (!missing.length) {
      setToast('다시 연결할 외부 프록시가 없습니다.')
      return
    }
    if (!runningInDesktop()) {
      setToast('외부 프록시 폴더 Relink는 데스크톱 앱에서 사용할 수 있습니다.')
      return
    }
    const directory = await selectMediaRelinkDirectory()
    if (!directory) return
    const expectedNames = missing.map((asset) => asset.proxySourceName ?? asset.proxySourcePath!.split(/[\\/]/).pop() ?? '').filter(Boolean)
    setToast(`${missing.length}개 외부 프록시를 선택 폴더와 하위 폴더에서 찾고 있습니다.`)
    try {
      const candidates = await findMediaRelinkCandidates(directory, expectedNames)
      const byName = new Map<string, typeof candidates>()
      candidates.forEach((candidate) => {
        const key = candidate.name.toLocaleLowerCase()
        byName.set(key, [...(byName.get(key) ?? []), candidate])
      })
      let connected = 0
      await mapWithConcurrency(missing, 3, async (asset) => {
        const expected = (asset.proxySourceName ?? asset.proxySourcePath!.split(/[\\/]/).pop() ?? '').toLocaleLowerCase()
        const candidate = byName.get(expected)?.[0]
        if (!candidate) return
        const result = await readMediaFilesFromPaths([candidate.path])
        const file = result.files[0]
        if (file && await attachProxy(asset.id, file)) connected += 1
      })
      setToast(`외부 프록시 ${connected}/${missing.length}개를 다시 연결했습니다.${connected < missing.length ? ' 찾지 못한 항목은 개별 외부 프록시 연결로 지정할 수 있습니다.' : ''}`)
    } catch (error) {
      setToast(error instanceof Error ? `외부 프록시 Relink 실패: ${error.message}` : '외부 프록시를 일괄 재연결하지 못했습니다.')
    }
  }, [attachProxy])

  const createProxy = useCallback(async (assetId: string, maxDimension = 960) => {
    const asset = assetsRef.current.find((item) => item.id === assetId)
    if (!asset?.sourceFile || (asset.kind !== 'video' && asset.kind !== 'audio' && asset.kind !== 'image') || asset.proxyStatus === 'creating') return
    const proxyPurpose: NonNullable<MediaAsset['proxyPurpose']> = asset.kind !== 'video' || asset.videoDecodable === false || asset.audioDecodable === false ? 'compatibility' : 'editing'
    const controller = new AbortController()
    proxyAbortRef.current.set(assetId, controller)
    setAssets((current) => current.map((item) => item.id === assetId ? { ...item, proxyPurpose, proxyStatus: 'creating', proxyProgress: 0, proxyError: undefined } : item))
    let lastProgress = 0
    let lastProgressAt = 0
    const updateProxyProgress = (progress: number) => {
      const now = performance.now()
      if (progress < 1 && progress - lastProgress < 0.02 && now - lastProgressAt < 100) return
      lastProgress = progress
      lastProgressAt = now
      setAssets((current) => current.map((item) => item.id === assetId && Math.abs((item.proxyProgress ?? 0) - progress) >= 0.001 ? { ...item, proxyProgress: progress } : item))
    }
    try {
      const proxy = asset.kind === 'audio'
        ? await createAudioCompatibilityProxy(asset, {
            projectId,
            signal: controller.signal,
            onProgress: updateProxyProgress,
          })
        : asset.kind === 'image'
          ? await createImageCompatibilityProxy(asset, {
              projectId,
              signal: controller.signal,
              onProgress: updateProxyProgress,
            })
          : asset.imageSequencePaths?.length
            ? await createImageSequenceProxy(asset, {
                projectId,
                maxDimension: proxyPurpose === 'compatibility' ? undefined : maxDimension,
                quality: proxyPurpose,
                signal: controller.signal,
                onProgress: updateProxyProgress,
              })
            : await createEditingProxy(asset, {
              projectId,
              maxDimension: proxyPurpose === 'compatibility' ? undefined : maxDimension,
              quality: proxyPurpose,
              signal: controller.signal,
              onProgress: updateProxyProgress,
            })
      let persisted: Awaited<ReturnType<typeof persistProxyFile>>
      let cacheWarning: string | undefined
      try {
        persisted = proxy.cachePath ? { cachePath: proxy.cachePath, cachedAt: proxy.cachedAt ?? new Date().toISOString() } : await persistProxyFile(projectId, assetId, proxy.file)
      } catch (error) {
        cacheWarning = error instanceof Error ? error.message : '디스크 캐시 저장 실패'
      }
      const proxyUrl = proxyPreviewUrl(proxy.file)
      const proxyAnalysis = asset.kind === 'audio' || asset.kind === 'image' ? await analyzeMediaFile(proxy.file, proxyUrl, asset.kind).catch(() => undefined) : undefined
      setAssets((current) => current.map((item) => {
        if (item.id !== assetId) return item
        releaseObjectUrl(item.proxyUrl)
        return { ...item, proxyFile: proxy.file, proxyUrl, proxySize: proxyFileSize(proxy.file), proxyWidth: 'width' in proxy ? proxy.width : proxyAnalysis?.width, proxyHeight: 'height' in proxy ? proxy.height : proxyAnalysis?.height, proxyFrameRate: 'frameRate' in proxy ? proxy.frameRate : undefined, proxyCachePath: persisted?.cachePath ?? item.proxyCachePath, proxySourcePath: undefined, proxySourceName: undefined, proxyOrigin: 'generated', proxyPurpose, proxyCachedAt: persisted?.cachedAt ?? item.proxyCachedAt, proxyTimecode: 'proxyTimecode' in proxy ? proxy.proxyTimecode : undefined, proxyTimecodeVerified: 'proxyTimecodeVerified' in proxy ? proxy.proxyTimecodeVerified : undefined, proxyTimecodeMismatch: 'proxyTimecodeMismatch' in proxy ? proxy.proxyTimecodeMismatch : undefined, waveform: proxyAnalysis?.waveform ?? item.waveform, audioPeak: proxyAnalysis?.audioPeak ?? item.audioPeak, thumbnailUrl: proxyAnalysis?.thumbnailUrl ?? item.thumbnailUrl, proxyStatus: 'ready', proxyProgress: 1, proxyEnabled: true, useProxy: true }
      }))
      const videoProxy = 'width' in proxy ? proxy : undefined
      setToast(cacheWarning ? `프록시는 만들었지만 디스크 저장에 실패했습니다: ${cacheWarning}` : asset.kind === 'audio' ? `48kHz PCM 오디오 호환 프록시를 만들었습니다${persisted ? ' · 디스크 저장됨' : ''}` : asset.kind === 'image' ? `알파 보존 PNG 이미지 호환 프록시를 만들었습니다${persisted ? ' · 디스크 저장됨' : ''}` : `${proxyPurpose === 'compatibility' ? '원본 해상도 고품질 호환 미디어' : '편집 프록시'}를 만들었습니다: ${videoProxy?.width ?? 0}×${videoProxy?.height ?? 0}, ${(videoProxy?.frameRate ?? asset.frameRate ?? 30).toFixed(3).replace(/\.0+$/, '')}fps${persisted ? ' · 디스크 저장됨' : ''}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '프록시 생성에 실패했습니다.'
      const canceled = error instanceof Error && error.name === 'AbortError'
      setAssets((current) => current.map((item) => item.id === assetId ? canceled
        ? { ...item, proxyStatus: 'none', proxyError: undefined, proxyProgress: undefined, useProxy: false }
        : { ...item, proxyStatus: 'error', proxyError: message, proxyProgress: undefined, useProxy: false } : item))
      setToast(message)
    } finally {
      proxyAbortRef.current.delete(assetId)
    }
  }, [projectId])

  const selectSourceAudioStream = useCallback(async (assetId: string, streamIndex: number) => {
    const asset = assetsRef.current.find((item) => item.id === assetId)
    const stream = asset?.audioStreams?.find((item) => item.index === streamIndex)
    if (!asset || !stream || asset.sourceAudioStreamIndex === streamIndex || asset.proxyStatus === 'creating') return
    proxyAbortRef.current.get(assetId)?.abort()
    await deleteProxyFile(asset.proxyCachePath).catch(() => undefined)
    releaseObjectUrl(asset.proxyUrl)
    const next: MediaAsset = {
      ...asset,
      sourceAudioStreamIndex: streamIndex,
      audioCodec: stream.codec ?? asset.audioCodec,
      sampleRate: stream.sampleRate ?? asset.sampleRate,
      channels: stream.channels ?? asset.channels,
      audioDecodable: false,
      waveform: undefined,
      audioPeak: undefined,
      proxyFile: undefined,
      proxyUrl: undefined,
      proxySize: undefined,
      proxyWidth: undefined,
      proxyHeight: undefined,
      proxyFrameRate: undefined,
      proxyCachePath: undefined,
      proxySourcePath: undefined,
      proxySourceName: undefined,
      proxyOrigin: undefined,
      proxyPurpose: undefined,
      proxyEnabled: undefined,
      proxyCachedAt: undefined,
      proxyTimecode: undefined,
      proxyTimecodeVerified: undefined,
      proxyTimecodeMismatch: undefined,
      proxyStatus: 'none',
      proxyProgress: undefined,
      proxyError: undefined,
      useProxy: false,
    }
    assetsRef.current = assetsRef.current.map((item) => item.id === assetId ? next : item)
    setAssets(assetsRef.current)
    setToast(`오디오 스트림 ${streamIndex + 1}${stream.language ? ` · ${stream.language}` : ''}${stream.title ? ` · ${stream.title}` : ''}을 선택했습니다. 호환 프록시를 다시 생성합니다.`)
    await createProxy(assetId)
  }, [createProxy])

  const createProxyBatch = useCallback(async (assetIds: string[], maxDimension = 960) => {
    const queue = [...new Set(assetIds)].filter((assetId) => {
      const asset = assetsRef.current.find((item) => item.id === assetId)
      return asset?.kind === 'video' && asset.status === 'ready' && asset.proxyStatus !== 'ready' && asset.proxyStatus !== 'creating'
    })
    if (!queue.length) return
    const previous = proxyBatchStateRef.current
    if (previous) {
      previous.queuedIds.forEach((assetId) => previous.cancelledIds.add(assetId))
      if (previous.activeId) {
        previous.cancelledIds.add(previous.activeId)
        proxyAbortRef.current.get(previous.activeId)?.abort()
      }
    }
    const batchState: { cancelledIds: Set<string>; queuedIds: Set<string>; activeId?: string } = { cancelledIds: new Set<string>(), queuedIds: new Set(queue) }
    proxyBatchStateRef.current = batchState
    setAssets((current) => current.map((asset) => batchState.queuedIds.has(asset.id) ? { ...asset, proxyStatus: 'queued', proxyProgress: 0, proxyError: undefined } : asset))
    setToast(`프록시 ${queue.length}개 생성 큐를 시작했습니다.`)
    for (const assetId of queue) {
      batchState.queuedIds.delete(assetId)
      if (batchState.cancelledIds.has(assetId)) continue
      batchState.activeId = assetId
      await createProxy(assetId, maxDimension)
      batchState.activeId = undefined
    }
    const cancelled = batchState.cancelledIds.size
    if (proxyBatchStateRef.current === batchState) proxyBatchStateRef.current = undefined
    setAssets((current) => current.map((asset) => asset.proxyStatus === 'queued' && batchState.cancelledIds.has(asset.id) ? { ...asset, proxyStatus: 'none', proxyProgress: undefined } : asset))
    setToast(cancelled ? `프록시 큐를 마쳤습니다. ${queue.length - cancelled}개 처리 · ${cancelled}개 취소` : `프록시 생성 큐 ${queue.length}개 처리를 마쳤습니다.`)
  }, [createProxy])

  const cancelProxy = useCallback((assetId: string) => {
    proxyBatchStateRef.current?.cancelledIds.add(assetId)
    proxyBatchStateRef.current?.queuedIds.delete(assetId)
    proxyAbortRef.current.get(assetId)?.abort()
    setAssets((current) => current.map((asset) => asset.id === assetId && asset.proxyStatus === 'queued' ? { ...asset, proxyStatus: 'none', proxyProgress: undefined } : asset))
  }, [])

  const cancelProxyBatch = useCallback((assetIds: string[]) => {
    const ids = new Set(assetIds)
    ids.forEach((assetId) => {
      proxyBatchStateRef.current?.cancelledIds.add(assetId)
      proxyBatchStateRef.current?.queuedIds.delete(assetId)
      proxyAbortRef.current.get(assetId)?.abort()
    })
    setAssets((current) => current.map((asset) => ids.has(asset.id) && asset.proxyStatus === 'queued' ? { ...asset, proxyStatus: 'none', proxyProgress: undefined } : asset))
    setToast(`프록시 생성 ${ids.size}개를 취소했습니다.`)
  }, [])

  const toggleProxy = useCallback((assetId: string) => {
    const target = assetsRef.current.find((item) => item.id === assetId)
    if (target && (target.videoDecodable === false || target.audioDecodable === false || target.imageDecodable === false)) {
      setAssets((current) => current.map((item) => item.id === assetId && item.proxyStatus === 'ready' ? { ...item, proxyEnabled: true, useProxy: true } : item))
      setToast('이 원본 코덱은 직접 재생할 수 없어 호환 프록시를 계속 사용합니다.')
      return
    }
    setAssets((current) => current.map((item) => item.id === assetId && item.proxyStatus === 'ready' ? { ...item, proxyEnabled: !item.useProxy, useProxy: !item.useProxy } : item))
  }, [])

  const setProxiesEnabled = useCallback((assetIds: string[], enabled: boolean) => {
    const ids = new Set(assetIds)
    const compatibilityLocked = enabled ? 0 : assetsRef.current.filter((item) => ids.has(item.id) && item.proxyStatus === 'ready' && (item.videoDecodable === false || item.audioDecodable === false || item.imageDecodable === false)).length
    setAssets((current) => current.map((item) => {
      if (!ids.has(item.id) || item.proxyStatus !== 'ready') return item
      const required = item.videoDecodable === false || item.audioDecodable === false || item.imageDecodable === false
      return { ...item, proxyEnabled: enabled || required, useProxy: enabled || required }
    }))
    setToast(enabled ? `준비된 프록시 ${ids.size}개를 미리보기에 사용합니다.` : compatibilityLocked ? `직접 재생 가능한 원본만 전환했습니다. 호환 프록시 필수 ${compatibilityLocked}개는 유지됩니다.` : `선택 미디어 ${ids.size}개를 원본 미리보기로 전환했습니다.`)
  }, [])

  const deleteProxy = useCallback(async (assetId: string) => {
    const asset = assetsRef.current.find((item) => item.id === assetId)
    if (!asset) return
    try {
      await deleteProxyFile(asset.proxyCachePath)
      releaseObjectUrl(asset.proxyUrl)
      setAssets((current) => current.map((item) => item.id === assetId ? { ...item, proxyFile: undefined, proxyUrl: undefined, proxySize: undefined, proxyWidth: undefined, proxyHeight: undefined, proxyFrameRate: undefined, proxyCachePath: undefined, proxySourcePath: undefined, proxySourceName: undefined, proxyOrigin: undefined, proxyPurpose: undefined, proxyEnabled: undefined, proxyCachedAt: undefined, proxyTimecode: undefined, proxyTimecodeVerified: undefined, proxyTimecodeMismatch: undefined, proxyStatus: 'none', proxyProgress: undefined, proxyError: undefined, useProxy: false } : item))
      setToast(asset.proxySourcePath ? '외부 프록시 연결을 분리했습니다. 프록시 파일과 원본은 그대로 유지됩니다.' : '편집 프록시를 삭제했습니다. 원본 미디어는 그대로 유지됩니다.')
    } catch (error) {
      setToast(error instanceof Error ? `프록시 삭제 실패: ${error.message}` : '프록시를 삭제하지 못했습니다.')
    }
  }, [])

  const deleteProxyBatch = useCallback(async (assetIds: string[]) => {
    const ids = new Set(assetIds)
    const targets = assetsRef.current.filter((asset) => ids.has(asset.id) && (asset.proxyCachePath || asset.proxySourcePath || asset.proxyUrl))
    if (!targets.length || !window.confirm(`선택한 편집 프록시 ${targets.length}개를 정리할까요? 외부 연결은 분리만 하며 원본·외부 프록시 파일은 유지됩니다.`)) return
    await Promise.all(targets.map((asset) => deleteProxyFile(asset.proxyCachePath)))
    targets.forEach((asset) => releaseObjectUrl(asset.proxyUrl))
    const targetIds = new Set(targets.map((asset) => asset.id))
    setAssets((current) => current.map((asset) => targetIds.has(asset.id) ? { ...asset, proxyFile: undefined, proxyUrl: undefined, proxySize: undefined, proxyWidth: undefined, proxyHeight: undefined, proxyFrameRate: undefined, proxyCachePath: undefined, proxySourcePath: undefined, proxySourceName: undefined, proxyOrigin: undefined, proxyPurpose: undefined, proxyEnabled: undefined, proxyCachedAt: undefined, proxyTimecode: undefined, proxyTimecodeVerified: undefined, proxyTimecodeMismatch: undefined, proxyStatus: 'none', proxyProgress: undefined, proxyError: undefined, useProxy: false } : asset))
    setToast(`선택한 프록시 ${targets.length}개를 삭제했습니다. 원본은 유지됩니다.`)
  }, [])

  const deleteAllProxies = useCallback(async () => {
    const cached = assetsRef.current.filter((asset) => asset.proxyCachePath || asset.proxySourcePath || asset.proxyUrl)
    if (!cached.length || !window.confirm(`이 프로젝트의 편집 프록시 ${cached.length}개를 정리할까요? 외부 연결은 분리만 하며 원본·외부 프록시 파일은 유지됩니다.`)) return
    await Promise.all(cached.map((asset) => deleteProxyFile(asset.proxyCachePath)))
    cached.forEach((asset) => releaseObjectUrl(asset.proxyUrl))
    const ids = new Set(cached.map((asset) => asset.id))
    setAssets((current) => current.map((asset) => ids.has(asset.id) ? { ...asset, proxyFile: undefined, proxyUrl: undefined, proxySize: undefined, proxyWidth: undefined, proxyHeight: undefined, proxyFrameRate: undefined, proxyCachePath: undefined, proxySourcePath: undefined, proxySourceName: undefined, proxyOrigin: undefined, proxyPurpose: undefined, proxyEnabled: undefined, proxyCachedAt: undefined, proxyTimecode: undefined, proxyTimecodeVerified: undefined, proxyTimecodeMismatch: undefined, proxyStatus: 'none', proxyProgress: undefined, proxyError: undefined, useProxy: false } : asset))
    setToast(`편집 프록시 ${cached.length}개를 정리했습니다. 원본은 유지됩니다.`)
  }, [])

  const updateMediaAsset = useCallback((assetId: string, patch: Partial<MediaAsset>) => {
    const previous = assetsRef.current.find((asset) => asset.id === assetId)
    if (!previous) return
    const next = { ...previous, ...patch }
    assetsRef.current = assetsRef.current.map((asset) => asset.id === assetId ? next : asset)
    setAssets(assetsRef.current)
    if (typeof patch.folder === 'string' && patch.folder.trim()) setMediaBins((current) => current.includes(patch.folder!.trim()) ? current : [...current, patch.folder!.trim()])
    const renamed = Boolean(typeof patch.name === 'string' && patch.name.trim() && patch.name.trim() !== previous.name)
    const frameRateChanged = Object.prototype.hasOwnProperty.call(patch, 'sourceFrameRateOverride') && previous.kind === 'video'
    const previousRate = sourceFrameConformRate(previous)
    const nextRate = sourceFrameConformRate(next)
    const shouldRetime = frameRateChanged && Math.abs(previousRate - nextRate) >= .000001
    if (!renamed && !shouldRetime) return
    const updateTracks = (sourceTracks: TimelineTrack[]) => sourceTracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        const referencesAsset = previous.parentAssetId ? clip.subclipId === assetId : clip.assetId === assetId
        let updated = shouldRetime && clip.assetId === assetId ? retimeClipForSourceConform(clip, previousRate, nextRate) : clip
        if (renamed && referencesAsset) {
          const name = patch.name!.trim()
          if (updated.name === previous.name) updated = { ...updated, name }
          else if (updated.name === `${previous.name} · 내장 오디오`) updated = { ...updated, name: `${name} · 내장 오디오` }
          else if (updated.name === `${previous.name} · 연결 오디오`) updated = { ...updated, name: `${name} · 연결 오디오` }
        }
        return updated
      }),
    }))
    commitEditor({ tracks: updateTracks })
    setSequenceLibrary((sequences) => sequences.map((sequence) => sequence.id === activeSequenceId ? sequence : { ...sequence, tracks: updateTracks(sequence.tracks) }))
    if (shouldRetime) setToast(`“${previous.name}”을 ${(next.sourceFrameRateOverride ?? next.frameRate ?? 30).toFixed(3).replace(/\.0+$/, '')}fps로 해석하고 사용 중인 클립 길이를 다시 계산했습니다.`)
  }, [activeSequenceId, commitEditor])

  const createSourceSubclip = useCallback((assetId: string) => {
    const source = assetsRef.current.find((asset) => asset.id === assetId)
    if (!source || source.kind === 'image') return
    const rootSource = source.parentAssetId ? assetsRef.current.find((asset) => asset.id === source.parentAssetId) ?? source : source
    const interpretedDuration = interpretedSourceDuration(source.duration, rootSource)
    const localIn = Math.max(0, Math.min(interpretedDuration, sourceInPoint ?? 0))
    const localOut = Math.max(localIn, Math.min(interpretedDuration, sourceOutPoint ?? interpretedDuration))
    if (localOut - localIn < 1 / 60) {
      setToast('서브클립으로 저장할 소스 IN·OUT 범위가 너무 짧습니다.')
      return
    }
    const rootId = source.parentAssetId ?? source.id
    const rootOffset = source.subclipIn ?? 0
    const mediaIn = sourceTimelineToMediaTime(localIn, rootSource)
    const mediaOut = sourceTimelineToMediaTime(localOut, rootSource)
    const name = window.prompt('서브클립 이름', `${source.name.replace(/\.[^.]+$/, '')} · ${formatTimecode(localIn, true)}–${formatTimecode(localOut, true)}`)?.trim()
    if (!name) return
    const subclip: MediaAsset = {
      ...structuredClone(source),
      id: crypto.randomUUID(),
      name,
      parentAssetId: rootId,
      subclipIn: rootOffset + mediaIn,
      subclipOut: rootOffset + mediaOut,
      duration: mediaOut - mediaIn,
      importedAt: new Date().toISOString(),
      folder: source.folder,
      tags: [...(source.tags ?? []), '서브클립'],
      notes: source.notes,
    }
    assetsRef.current = [...assetsRef.current, subclip]
    setAssets(assetsRef.current)
    setSelectedAssetId(subclip.id)
    setSourcePlayhead(0)
    setSourceInPoint(undefined)
    setSourceOutPoint(undefined)
    setToast(`서브클립 “${name}”을 프로젝트 미디어에 저장했습니다.`)
  }, [sourceInPoint, sourceOutPoint])

  const addAssetToTimeline = useCallback((assetId: string, modeOverride?: EditMode, options: { fitToWorkArea?: boolean } = {}) => {
    const asset = assets.find((item) => item.id === assetId)
    const sourceAsset = asset?.parentAssetId ? assets.find((item) => item.id === asset.parentAssetId) : asset
    if (!asset || !sourceAsset || !resolvePreviewMediaAsset(sourceAsset)) {
      setToast('타임라인에 추가할 원본 또는 준비된 프록시가 없습니다.')
      return
    }
    const targetKind = asset.kind === 'audio' ? 'audio' : 'video'
    const targetTrack = resolveSourceTargetTrack(tracks, targetKind)
    const embeddedAudio = asset.kind === 'video' && Boolean(sourceAsset.audioCodec || sourceAsset.channels)
    const audioTargetTrack = embeddedAudio ? resolveSourceTargetTrack(tracks, 'audio') : undefined
    if (!targetTrack) {
      setToast(`${targetKind === 'video' ? 'V' : 'A'} 소스 대상이 없습니다. 타임라인 트랙 머리글의 대상 버튼을 켜주세요.`)
      return
    }
    if (targetTrack.locked) {
      setToast('대상 트랙 잠금을 해제한 뒤 미디어를 추가해주세요.')
      return
    }
    if (audioTargetTrack?.locked) {
      setToast('A 소스 대상 트랙 잠금을 해제하거나 오디오 소스 패치를 꺼주세요.')
      return
    }
    if (options.fitToWorkArea && !sequenceWorkArea) {
      setToast('Fit to Fill에 사용할 시퀀스 IN·OUT 작업 구간을 먼저 지정해주세요.')
      return
    }
    const requestedMode = options.fitToWorkArea ? 'overwrite' : modeOverride ?? editMode
    const insertionTracks = [targetTrack, ...(audioTargetTrack && audioTargetTrack.id !== targetTrack.id ? [audioTargetTrack] : [])]
    const start = options.fitToWorkArea && sequenceWorkArea ? sequenceWorkArea.start : requestedMode === 'append'
      ? insertionTracks.flatMap((track) => track.clips).reduce((latest, clip) => Math.max(latest, clip.start + clip.duration), 0)
      : playhead
    const clipId = crypto.randomUUID()
    const linkGroupId = embeddedAudio && audioTargetTrack ? crypto.randomUUID() : undefined
    const localRangeStart = assetId === selectedAssetId && asset.kind !== 'image' ? sourceInPoint ?? 0 : 0
    const interpretedDuration = interpretedSourceDuration(asset.duration, sourceAsset)
    const localRangeEnd = assetId === selectedAssetId && asset.kind !== 'image' ? sourceOutPoint ?? interpretedDuration : interpretedDuration
    const rangeStart = (asset.subclipIn ?? 0) + sourceTimelineToMediaTime(localRangeStart, sourceAsset)
    const rangeEnd = (asset.subclipIn ?? 0) + sourceTimelineToMediaTime(localRangeEnd, sourceAsset)
    if (rangeEnd - rangeStart < 1 / 60) {
      setToast('소스 인·아웃 범위가 너무 짧습니다.')
      return
    }
    const sourceRangeDuration = localRangeEnd - localRangeStart
    const mediaRangeDuration = rangeEnd - rangeStart
    const targetDuration = options.fitToWorkArea && sequenceWorkArea ? sequenceWorkArea.end - sequenceWorkArea.start : asset.kind === 'image' ? 5 : sourceRangeDuration
    const fitPlaybackRate = asset.kind === 'image' ? 1 : mediaRangeDuration / Math.max(1 / activeSequenceFps, targetDuration)
    if (options.fitToWorkArea && asset.kind !== 'image' && (fitPlaybackRate < 0.05 || fitPlaybackRate > 16)) {
      setToast(`Fit to Fill 속도 ${(fitPlaybackRate * 100).toFixed(1)}%는 지원 범위 5–1600%를 벗어납니다.`)
      return
    }
    const clip: TimelineClip = {
      id: clipId,
      trackId: targetTrack.id,
      assetId: sourceAsset.id,
      subclipId: asset.parentAssetId ? asset.id : undefined,
      name: asset.name,
      start,
      duration: targetDuration,
      sourceOffset: rangeStart,
      kind: targetKind,
      color: asset.labelColor ?? sourceAsset.labelColor ?? targetTrack.labelColor ?? (targetKind === 'audio' ? '#169676' : '#7160e8'),
      transform: { ...defaultTransform },
      playbackRate: fitPlaybackRate,
      frameInterpolation: asset.kind === 'video' ? options.fitToWorkArea && Math.abs(fitPlaybackRate - 1) > 0.001 ? 'blend' : 'sampling' : undefined,
      reverse: false,
      freezeFrame: false,
      transitionIn: { type: 'none', duration: 0.5 },
      transitionOut: { type: 'none', duration: 0.5 },
      colorAdjustment: defaultColorAdjustment(),
      audioAdjustment: defaultAudioAdjustment(),
      audioDisabled: asset.kind === 'video' ? true : undefined,
      linkGroupId,
    }
    const audioClip: TimelineClip | undefined = embeddedAudio && audioTargetTrack ? {
      ...clip,
      id: crypto.randomUUID(),
      trackId: audioTargetTrack.id,
      name: `${asset.name} · 내장 오디오`,
      kind: 'audio',
      color: asset.labelColor ?? sourceAsset.labelColor ?? audioTargetTrack.labelColor ?? '#169676',
      frameInterpolation: undefined,
      colorAdjustment: undefined,
      visualEffects: undefined,
      effectStack: undefined,
      audioDisabled: false,
      audioAdjustment: { ...defaultAudioAdjustment(), role: audioTargetTrack.audioRole ?? 'dialogue' },
    } : undefined
    if (requestedMode === 'insert') {
      const blockers = inspectAdrRippleInsert(tracksRef.current, adrCuesRef.current, activeSequenceId, start)
      if (blockers.length) {
        setToast(blockers[0])
        return
      }
    } else if (requestedMode === 'overwrite') {
      const blockers = [targetTrack, ...(audioTargetTrack ? [audioTargetTrack] : [])].flatMap((track) => inspectAdrOverwrite(tracksRef.current, adrCuesRef.current, activeSequenceId, track.id, start, start + clip.duration))
      if (blockers.length) {
        setToast(blockers[0])
        return
      }
    }
    const rippleTimestamp = new Date().toISOString()
    commitEditor({
      tracks: (current) => {
        const prepared = requestedMode === 'insert' ? insertTimelineGap(current, start, clip.duration, insertionTracks.map((track) => track.id)) : current
        const withVideoOrAudio = insertTimelineClip(prepared, targetTrack.id, clip, requestedMode === 'insert' ? 'append' : requestedMode)
        return audioClip ? insertTimelineClip(withVideoOrAudio, audioClip.trackId, audioClip, requestedMode === 'insert' ? 'append' : requestedMode) : withVideoOrAudio
      },
      transcript: requestedMode === 'insert' ? (current) => rippleInsertTranscript(current, start, clip.duration) : undefined,
      suggestions: requestedMode === 'insert' ? (current) => rippleInsertSuggestions(current, start, clip.duration) : undefined,
      markers: requestedMode === 'insert' ? (current) => rippleInsertMarkers(current, start, clip.duration, rippleTimestamp) : undefined,
      adrCues: requestedMode === 'insert' ? (current) => rippleInsertAdrCues(current, activeSequenceId, start, clip.duration, rippleTimestamp) : undefined,
    })
    if (requestedMode === 'insert') setAdrLoopRange((current) => current && current.start >= start ? { start: current.start + clip.duration, end: current.end + clip.duration } : current)
    setSelectedClipId(clipId)
    setSelectedClipIds(new Set([clipId, ...(audioClip ? [audioClip.id] : [])]))
    setPlayhead(start)
    setSelectedTrackId(targetTrack.id)
    const patchNote = embeddedAudio ? audioClip ? ` · ${audioTargetTrack?.name}에 내장 오디오 연결` : ' · A 소스 패치가 꺼져 영상만 배치' : ''
    setToast((options.fitToWorkArea ? `Fit to Fill · 소스 ${sourceRangeDuration.toFixed(2)}초를 시퀀스 ${targetDuration.toFixed(2)}초에 ${(fitPlaybackRate * 100).toFixed(1)}% 속도로 맞췄습니다.` : requestedMode === 'append' ? '타임라인 끝에 미디어를 추가했습니다.' : requestedMode === 'insert' ? '재생 헤드에 삽입했습니다.' : '재생 헤드 구간을 덮어썼습니다.') + patchNote)
  }, [activeSequenceFps, activeSequenceId, assets, commitEditor, editMode, playhead, selectedAssetId, sequenceWorkArea, sourceInPoint, sourceOutPoint, tracks])

  const automateAssetsToSequence = useCallback((assetIds: string[], options: AutomateSequenceOptions) => {
    const orderedAssets = assetIds.flatMap((id) => {
      const asset = assetsRef.current.find((candidate) => candidate.id === id)
      const source = asset?.parentAssetId ? assetsRef.current.find((candidate) => candidate.id === asset.parentAssetId) : asset
      return asset && source && resolvePreviewMediaAsset(source) ? [{ asset, source }] : []
    })
    if (!orderedAssets.length) {
      setToast('자동 배치할 준비된 미디어가 없습니다.')
      return
    }
    const currentTracks = tracksRef.current
    const videoTarget = orderedAssets.some(({ asset }) => asset.kind !== 'audio') ? resolveSourceTargetTrack(currentTracks, 'video') : undefined
    const audioTarget = orderedAssets.some(({ asset, source }) => asset.kind === 'audio' || options.includeEmbeddedAudio && asset.kind === 'video' && Boolean(source.audioCodec || source.channels)) ? resolveSourceTargetTrack(currentTracks, 'audio') : undefined
    if (orderedAssets.some(({ asset }) => asset.kind !== 'audio') && (!videoTarget || videoTarget.locked)) {
      setToast('잠금 해제된 V 소스 대상 트랙을 지정해주세요.')
      return
    }
    if (orderedAssets.some(({ asset }) => asset.kind === 'audio') && (!audioTarget || audioTarget.locked)) {
      setToast('잠금 해제된 A 소스 대상 트랙을 지정해주세요.')
      return
    }
    if (audioTarget?.locked) {
      setToast('내장 오디오를 배치할 A 소스 대상 트랙의 잠금을 해제해주세요.')
      return
    }
    const placementMarkers = options.placement === 'markers' ? [...new Set(markersRef.current.filter((marker) => marker.kind !== 'comment' && marker.time >= playhead - 1 / activeSequenceFps).map((marker) => marker.time))].sort((left, right) => left - right) : []
    if (options.placement === 'markers' && !placementMarkers.length) {
      setToast('재생 헤드 이후에 자동 배치할 시퀀스 마커가 없습니다.')
      return
    }
    const placements: Array<{ trackId: string; clip: TimelineClip; primary: boolean }> = []
    let cursor = playhead
    orderedAssets.forEach(({ asset, source }, index) => {
      const start = placementMarkers[index] ?? cursor
      const conformRate = sourceFrameConformRate(source)
      const sourceDuration = asset.kind === 'image' ? options.stillDuration : Math.max(1 / activeSequenceFps, interpretedSourceDuration(asset.duration, source))
      const nextMarker = placementMarkers[index + 1]
      const duration = nextMarker !== undefined ? Math.max(1 / activeSequenceFps, Math.min(sourceDuration, nextMarker - start)) : sourceDuration
      const targetTrack = asset.kind === 'audio' ? audioTarget! : videoTarget!
      const embeddedAudio = options.includeEmbeddedAudio && asset.kind === 'video' && Boolean(source.audioCodec || source.channels) && audioTarget
      const linkGroupId = embeddedAudio ? crypto.randomUUID() : undefined
      const transitionDuration = Math.min(duration / 2, options.transitionDuration)
      const transitionType = options.transition === 'crossfade' ? 'crossfade' as const : 'none' as const
      const clip: TimelineClip = {
        id: crypto.randomUUID(),
        trackId: targetTrack.id,
        assetId: source.id,
        subclipId: asset.parentAssetId ? asset.id : undefined,
        name: asset.name,
        start,
        duration,
        sourceOffset: asset.subclipIn ?? 0,
        kind: asset.kind === 'audio' ? 'audio' : 'video',
        color: asset.labelColor ?? source.labelColor ?? targetTrack.labelColor ?? (asset.kind === 'audio' ? '#169676' : '#7160e8'),
        transform: { ...defaultTransform },
        playbackRate: asset.kind === 'image' ? 1 : conformRate,
        frameInterpolation: asset.kind === 'video' ? 'sampling' : undefined,
        reverse: false,
        freezeFrame: false,
        transitionIn: { type: index > 0 ? transitionType : 'none', duration: transitionDuration },
        transitionOut: { type: index < orderedAssets.length - 1 ? transitionType : 'none', duration: transitionDuration },
        colorAdjustment: asset.kind === 'audio' ? undefined : defaultColorAdjustment(),
        audioAdjustment: { ...defaultAudioAdjustment(), role: targetTrack.audioRole ?? (asset.kind === 'audio' ? 'music' : 'dialogue') },
        audioDisabled: asset.kind === 'video' ? true : undefined,
        linkGroupId,
      }
      placements.push({ trackId: targetTrack.id, clip, primary: true })
      if (embeddedAudio) placements.push({ trackId: embeddedAudio.id, primary: false, clip: {
        ...clip,
        id: crypto.randomUUID(),
        trackId: embeddedAudio.id,
        name: `${asset.name} · 내장 오디오`,
        kind: 'audio',
        color: asset.labelColor ?? source.labelColor ?? embeddedAudio.labelColor ?? '#169676',
        frameInterpolation: undefined,
        colorAdjustment: undefined,
        visualEffects: undefined,
        effectStack: undefined,
        audioDisabled: false,
        audioAdjustment: { ...defaultAudioAdjustment(), role: embeddedAudio.audioRole ?? 'dialogue' },
      } })
      cursor = Math.max(cursor, start + duration)
    })
    const editMode = options.placement === 'markers' ? 'overwrite' : options.editMode
    const targetTrackIds = new Set(placements.map((placement) => placement.trackId))
    const totalDuration = Math.max(0, ...placements.map(({ clip }) => clip.start + clip.duration)) - playhead
    if (editMode === 'insert') {
      const blockers = inspectAdrRippleInsert(currentTracks, adrCuesRef.current, activeSequenceId, playhead)
      if (blockers.length) { setToast(blockers[0]); return }
    } else {
      const blockers = placements.flatMap(({ clip }) => inspectAdrOverwrite(currentTracks, adrCuesRef.current, activeSequenceId, clip.trackId, clip.start, clip.start + clip.duration))
      if (blockers.length) { setToast(blockers[0]); return }
    }
    const rippleTimestamp = new Date().toISOString()
    commitEditor({
      tracks: (current) => {
        const prepared = editMode === 'insert' ? insertTimelineGap(current, playhead, totalDuration, targetTrackIds) : current
        return placements.reduce((next, placement) => insertTimelineClip(next, placement.trackId, placement.clip, editMode === 'insert' ? 'append' : 'overwrite'), prepared)
      },
      transcript: editMode === 'insert' ? (current) => rippleInsertTranscript(current, playhead, totalDuration) : undefined,
      suggestions: editMode === 'insert' ? (current) => rippleInsertSuggestions(current, playhead, totalDuration) : undefined,
      markers: editMode === 'insert' ? (current) => rippleInsertMarkers(current, playhead, totalDuration, rippleTimestamp) : undefined,
      adrCues: editMode === 'insert' ? (current) => rippleInsertAdrCues(current, activeSequenceId, playhead, totalDuration, rippleTimestamp) : undefined,
    })
    const primaryClips = placements.filter((placement) => placement.primary).map(({ clip }) => clip)
    setSelectedAssetId(undefined)
    setSelectedClipId(primaryClips[primaryClips.length - 1]?.id)
    setSelectedClipIds(new Set(placements.map(({ clip }) => clip.id)))
    setSelectedTrackId(primaryClips[primaryClips.length - 1]?.trackId)
    setPlayhead(placements[0]?.clip.start ?? playhead)
    setToast(`미디어 ${orderedAssets.length}개를 ${options.placement === 'markers' ? `시퀀스 마커 ${Math.min(placementMarkers.length, orderedAssets.length)}개 기준` : '재생 헤드부터 연속'}으로 자동 배치했습니다.${placements.length > orderedAssets.length ? ` 내장 오디오 ${placements.length - orderedAssets.length}개 연결.` : ''}`)
  }, [activeSequenceFps, activeSequenceId, commitEditor, playhead])

  const replaceSelectedClipFromSource = useCallback(() => {
    const clip = tracksRef.current.flatMap((track) => track.clips).find((candidate) => candidate.id === selectedClipId)
    const asset = assetsRef.current.find((candidate) => candidate.id === selectedAssetId)
    const sourceAsset = asset?.parentAssetId ? assetsRef.current.find((candidate) => candidate.id === asset.parentAssetId) : asset
    if (!clip || !asset || !sourceAsset?.url || sourceAsset.status !== 'ready') {
      setToast('소스 미디어와 교체할 타임라인 클립을 각각 선택해주세요.')
      return
    }
    if (clip.kind === 'caption' || clip.adjustmentLayer || clip.nestedSequenceId || clip.renderReplacement || clip.adrCueId) {
      setToast('일반 영상·이미지·오디오 클립만 소스 교체할 수 있습니다.')
      return
    }
    const compatible = clip.kind === 'video' ? asset.kind === 'video' || asset.kind === 'image' : asset.kind === 'audio' || asset.kind === 'video' && Boolean(sourceAsset.audioCodec || sourceAsset.channels)
    if (!compatible) {
      setToast(clip.kind === 'video' ? '영상 클립은 영상 또는 이미지 소스로 교체할 수 있습니다.' : '오디오 클립은 오디오가 포함된 소스로 교체할 수 있습니다.')
      return
    }
    const linkedAudio = clip.linkGroupId ? tracksRef.current.flatMap((track) => track.clips.filter((candidate) => candidate.id !== clip.id && candidate.kind === 'audio' && candidate.linkGroupId === clip.linkGroupId && Math.abs(candidate.start - clip.start) <= 1 / 240 && Math.abs(candidate.duration - clip.duration) <= 1 / 240)) : []
    const affectedIds = new Set([clip.id, ...linkedAudio.map((candidate) => candidate.id)])
    if (tracksRef.current.some((track) => track.locked && track.clips.some((candidate) => affectedIds.has(candidate.id)))) {
      setToast('교체 대상 또는 연결 오디오 트랙의 잠금을 해제해주세요.')
      return
    }
    const base = asset.subclipIn ?? 0
    const boundEnd = asset.subclipOut ?? base + asset.duration
    const requiredSourceDuration = asset.kind === 'image' || clip.freezeFrame ? 0 : clipSourceDuration(clip)
    const interpretedDuration = interpretedSourceDuration(asset.duration, sourceAsset)
    const localAnchor = Math.max(0, Math.min(interpretedDuration, clip.reverse ? sourceOutPoint ?? sourcePlayhead : sourceInPoint ?? sourcePlayhead))
    const mediaAnchor = sourceTimelineToMediaTime(localAnchor, sourceAsset)
    const sourceOffset = asset.kind === 'image' ? 0 : clip.reverse ? base + mediaAnchor - requiredSourceDuration : base + mediaAnchor
    if (sourceOffset < base - 1 / 240 || sourceOffset + requiredSourceDuration > boundEnd + 1 / 240) {
      setToast(`선택 소스에 기존 속도·길이를 유지할 ${(requiredSourceDuration).toFixed(2)}초 핸들이 부족합니다. 소스 위치 또는 IN/OUT을 조정해주세요.`)
      return
    }
    const hasEmbeddedAudio = asset.kind === 'video' && Boolean(sourceAsset.audioCodec || sourceAsset.channels)
    commitTracks((current) => current.map((track) => ({
      ...track,
      clips: track.clips.map((candidate) => {
        if (candidate.id === clip.id) return {
          ...candidate,
          assetId: sourceAsset.id,
          subclipId: asset.parentAssetId ? asset.id : undefined,
          name: asset.name,
          sourceOffset: Math.max(0, sourceOffset),
          freezeFrameSourceTime: candidate.freezeFrame ? base + mediaAnchor : candidate.freezeFrameSourceTime,
          audioDisabled: asset.kind === 'image' || asset.kind === 'video' && !hasEmbeddedAudio ? true : candidate.audioDisabled,
        }
        if (!affectedIds.has(candidate.id) || candidate.kind !== 'audio') return candidate
        return {
          ...candidate,
          assetId: sourceAsset.id,
          subclipId: asset.parentAssetId ? asset.id : undefined,
          name: `${asset.name} · 연결 오디오`,
          sourceOffset: Math.max(0, sourceOffset),
          enabled: hasEmbeddedAudio,
          audioDisabled: !hasEmbeddedAudio,
        }
      }),
    })))
    setToast(`“${clip.name}”의 위치·길이·효과·키프레임을 유지하고 소스를 “${asset.name}”으로 교체했습니다.${linkedAudio.length ? hasEmbeddedAudio ? ' 연결 오디오도 함께 교체했습니다.' : ' 새 소스에 오디오가 없어 연결 오디오는 비활성화했습니다.' : ''}`)
  }, [commitTracks, selectedAssetId, selectedClipId, sourceInPoint, sourceOutPoint, sourcePlayhead])

  const removeSelectedImageBackground = useCallback(async (assetId: string) => {
    const asset = assetsRef.current.find((item) => item.id === assetId)
    if (!asset?.sourceFile || asset.kind !== 'image' || backgroundRemovalRunning) return
    const activityId = beginAiActivity({ operation: 'image-background-removal', label: '로컬 AI 이미지 배경 제거', processing: { location: 'local-device', processor: 'MODNet background matting' }, input: { assetIds: [asset.id], dataCategories: ['선택 이미지 픽셀'], summary: `“${asset.name}” 이미지 1개` }, reason: '원본을 보존하면서 투명 배경 PNG를 생성합니다.', approval: 'user-confirmed-change', undo: { available: false, method: 'delete-created-asset', description: '생성된 PNG 미디어를 프로젝트에서 삭제' } })
    setBackgroundRemovalRunning(true)
    setBackgroundRemovalProgress(0)
    setBackgroundRemovalStage('준비')
    try {
      const output = await removeImageBackground(asset.sourceFile, (progress, stage) => {
        setBackgroundRemovalProgress(progress)
        setBackgroundRemovalStage(stage)
      })
      const generated = await handleFiles([output])
      endAiActivity(activityId, { status: 'completed', changes: { summary: `투명 PNG 미디어 ${generated.length}개 생성 · 원본 유지`, assets: generated.length } })
      setToast('배경을 제거한 투명 PNG를 새 미디어로 추가했습니다. 원본은 유지됩니다.')
    } catch (error) {
      endAiActivity(activityId, { status: 'failed', error: error instanceof Error ? error.message : '배경 제거 실패' })
      setToast(error instanceof Error ? `배경 제거 실패: ${error.message}` : '배경 제거에 실패했습니다.')
    } finally {
      setBackgroundRemovalRunning(false)
    }
  }, [backgroundRemovalRunning, beginAiActivity, endAiActivity, handleFiles])

  const removeSelectedVideoBackground = useCallback(async (clipId: string) => {
    const clip = tracksRef.current.flatMap((track) => track.clips).find((item) => item.id === clipId)
    const asset = assetsRef.current.find((item) => item.id === clip?.assetId)
    if (!clip || !asset?.sourceFile || asset.kind !== 'video' || backgroundRemovalRunning) return
    const baseVisual = resolveVisualEffects(clip, clip.start)
    const maximumExistingMasks = Math.max(resolveEffectMasks(baseVisual).length, ...(clip.visualKeyframes ?? []).map((keyframe) => resolveEffectMasks(keyframe.effects).length))
    if (maximumExistingMasks >= 8) {
      setToast('영상 전경 마스크를 추가하려면 기존 마스크를 하나 이상 삭제해주세요.')
      return
    }
    const activityId = beginAiActivity({ operation: 'video-background-removal', label: '로컬 AI 영상 배경 제거', processing: { location: 'local-device', processor: 'MODNet temporal foreground masks' }, input: { sequenceId: activeSequenceId, assetIds: [asset.id], clipIds: [clip.id], timeRange: { start: clip.start, end: clip.start + clip.duration }, dataCategories: ['선택 클립 프레임', '기존 시각 효과 마스크'], summary: `“${clip.name}” ${clip.duration.toFixed(2)}초` }, reason: '선택 클립의 시간축 전경 마스크를 생성해 배경을 비파괴로 제거합니다.', approval: 'user-confirmed-change', undo: { available: true, method: 'editor-history', description: '한 번의 실행 취소로 전경 마스크 제거' } })
    const controller = new AbortController()
    videoBackgroundRemovalAbortRef.current = controller
    setVideoBackgroundRemovalClipId(clipId)
    setBackgroundRemovalRunning(true)
    setBackgroundRemovalProgress(0)
    setBackgroundRemovalStage('영상 준비')
    try {
      const sourceAtStart = clipSourceTime(clip, clip.start)
      const sourceAtEnd = clipSourceTime(clip, clip.start + clip.duration)
      const trackingAsset = asset.useProxy && asset.proxyFile ? { ...asset, sourceFile: asset.proxyFile, sourcePath: (asset.proxyFile as File & { __editweaveSourcePath?: string }).__editweaveSourcePath } : asset
      const frames = await createVideoForegroundMasks(trackingAsset.sourceFile!, trackingAsset.sourcePath, sourceAtStart, sourceAtEnd, {
        signal: controller.signal,
        onProgress: (progress, stage) => { setBackgroundRemovalProgress(progress); setBackgroundRemovalStage(stage) },
      })
      const sourceIn = clipSourceTime(clip, clip.start)
      const sourceOut = clipSourceTime(clip, clip.start + clip.duration)
      const ascending = sourceOut >= sourceIn
      const mapped = frames.map((frame) => {
        let low = 0
        let high = clip.duration
        for (let iteration = 0; iteration < 26; iteration++) {
          const middle = (low + high) / 2
          const value = clipSourceTime(clip, clip.start + middle)
          if ((ascending && value < frame.sourceTime) || (!ascending && value > frame.sourceTime)) low = middle
          else high = middle
        }
        return { ...frame, time: (low + high) / 2 }
      }).sort((left, right) => left.time - right.time)
      const maskId = crypto.randomUUID()
      const maskAt = (time: number) => {
        const upper = mapped.findIndex((frame) => frame.time >= time)
        if (upper <= 0) return mapped[Math.max(0, upper)]?.points ?? mapped[0].points
        if (upper < 0) return mapped[mapped.length - 1].points
        const previous = mapped[upper - 1]
        const next = mapped[upper]
        const progress = (time - previous.time) / Math.max(0.001, next.time - previous.time)
        return previous.points.map((point, index) => ({ x: point.x + ((next.points[index]?.x ?? point.x) - point.x) * progress, y: point.y + ((next.points[index]?.y ?? point.y) - point.y) * progress }))
      }
      const times = new Set<number>([0, ...mapped.map((frame) => frame.time), ...(clip.visualKeyframes ?? []).map((keyframe) => keyframe.time)])
      const samples = [...times].filter((time) => time >= 0 && time <= clip.duration).sort((left, right) => left - right).map((time) => {
        const resolved = resolveVisualEffects(clip, clip.start + time)
        const existing = resolveEffectMasks(resolved).map((mask) => ({ ...mask, points: mask.points.map((point) => ({ ...point })) }))
        const foreground = { id: maskId, name: 'AI 영상 전경', shape: 'polygon' as const, points: maskAt(time), feather: 1.2, opacity: 100, invert: false, operation: 'intersect' as const, enabled: true }
        return { id: crypto.randomUUID(), time, easing: 'linear' as const, effects: { ...resolved, mask: 'none' as const, maskPoints: undefined, masks: [...existing, foreground] } }
      })
      updateClip(clip.id, { visualEffects: samples[0]?.effects ?? baseVisual, visualKeyframes: samples.slice(1) })
      const averageConfidence = frames.reduce((sum, frame) => sum + frame.confidence, 0) / frames.length
      endAiActivity(activityId, { status: 'completed', changes: { summary: `전경 마스크 표본 ${frames.length}개 적용 · 평균 신뢰도 ${Math.round(averageConfidence * 100)}%`, clips: 1 } })
      setToast(`영상 전경 마스크 ${frames.length}개를 시간축에 적용했습니다. 평균 신뢰도 ${Math.round(averageConfidence * 100)}%.`)
    } catch (error) {
      const cancelled = controller.signal.aborted || error instanceof DOMException && error.name === 'AbortError'
      endAiActivity(activityId, { status: cancelled ? 'cancelled' : 'failed', error: error instanceof Error ? error.message : '영상 배경 제거 실패' })
      setToast(error instanceof Error ? error.message : '영상 배경 제거에 실패했습니다.')
    } finally {
      videoBackgroundRemovalAbortRef.current = undefined
      setVideoBackgroundRemovalClipId(undefined)
      setBackgroundRemovalRunning(false)
    }
  }, [activeSequenceId, backgroundRemovalRunning, beginAiActivity, endAiActivity, updateClip])

  const runSelectedComfyWorkflow = useCallback(async (endpoint: string, workflowRaw: string) => {
    const asset = assetsRef.current.find((item) => item.id === comfyAssetId)
    if (!asset?.sourceFile || asset.kind !== 'image' || comfyRunning) return
    if (!aiPrivacySettings.externalComfyUiAllowed) {
      setComfyError('AI 데이터 설정에서 ComfyUI 전송 범위에 동의해야 실행할 수 있습니다.')
      return
    }
    const activityId = beginAiActivity({ operation: 'external-comfy-workflow', label: '외부 ComfyUI 워크플로', processing: { location: 'external-user-service', processor: '사용자 지정 ComfyUI 서버' }, input: { assetIds: [asset.id], dataCategories: ['선택 이미지 픽셀', '사용자 제공 워크플로 JSON'], summary: `“${asset.name}”과 워크플로를 승인된 ComfyUI로 전송` }, reason: '사용자가 선택한 외부 생성형 이미지 워크플로를 실행합니다.', approval: 'user-confirmed-external-transfer', undo: { available: false, method: 'delete-created-asset', description: '생성된 결과 미디어를 프로젝트에서 삭제' } })
    const controller = new AbortController()
    comfyAbortRef.current = controller
    setComfyRunning(true)
    setComfyError(undefined)
    setComfyProgress(0)
    setComfyStage('준비')
    try {
      const workflow = parseComfyWorkflow(workflowRaw)
      const output = await runComfyImageWorkflow({
        endpoint,
        workflow,
        input: asset.sourceFile,
        signal: controller.signal,
        onProgress: ({ progress, stage }) => {
          setComfyProgress(progress)
          setComfyStage(stage)
        },
      })
      const generated = await handleFiles([output])
      endAiActivity(activityId, { status: 'completed', changes: { summary: `ComfyUI 결과 미디어 ${generated.length}개 생성`, assets: generated.length } })
      setComfyOpen(false)
      setToast('ComfyUI 결과 이미지를 새 미디어로 가져왔습니다. 원본은 유지됩니다.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ComfyUI 작업에 실패했습니다.'
      const cancelled = error instanceof DOMException && error.name === 'AbortError'
      endAiActivity(activityId, { status: cancelled ? 'cancelled' : 'failed', error: message })
      setComfyError(message)
      setComfyStage(error instanceof DOMException && error.name === 'AbortError' ? '취소됨' : '오류')
    } finally {
      setComfyRunning(false)
      comfyAbortRef.current = undefined
    }
  }, [aiPrivacySettings.externalComfyUiAllowed, beginAiActivity, comfyAssetId, comfyRunning, endAiActivity, handleFiles])

  const addAdjustmentLayer = useCallback(() => {
    const track = resolveSourceTargetTrack(tracks, 'video')
    if (!track) {
      setToast('V 소스 대상이 없습니다. 조정 레이어를 놓을 비디오 대상을 켜주세요.')
      return
    }
    if (track.locked) {
      setToast('V 소스 대상 트랙의 잠금을 해제해주세요.')
      return
    }
    const clip: TimelineClip = {
      id: crypto.randomUUID(),
      trackId: track.id,
      name: '조정 레이어',
      start: playhead,
      duration: 5,
      sourceOffset: 0,
      kind: 'video',
      color: '#c15cff',
      transform: { ...defaultTransform },
      colorAdjustment: defaultColorAdjustment(),
      visualEffects: defaultVisualEffects(),
      adjustmentLayer: true,
    }
    commitTracks((current) => current.map((item) => item.id === track.id ? { ...item, clips: [...item.clips, clip].sort((a, b) => a.start - b.start) } : item))
    setSelectedAssetId(undefined)
    setSelectedTrackId(track.id)
    setSelectedClipId(clip.id)
    setToast('5초 조정 레이어를 추가했습니다. 색보정과 시각 효과가 하위 합성 화면에 적용됩니다.')
  }, [commitTracks, playhead, tracks])

  const addTitleAtPlayhead = useCallback((template: TitleTemplate) => {
    const track = resolveSourceTargetTrack(tracks, 'caption')
    if (!track) {
      setToast('T 소스 대상이 없습니다. 모션 텍스트를 놓을 자막 대상을 켜주세요.')
      return
    }
    if (track.locked) {
      setToast('T 소스 대상 트랙의 잠금을 해제해주세요.')
      return
    }
    const templates: Record<TitleTemplate, { name: string; style: TimelineClip['captionStyle'] }> = {
      headline: { name: '새 헤드라인', style: { ...defaultCaptionStyle(), template, preset: 'minimal', fontSize: 150, position: 'middle', positionY: 50, animation: 'pop', animationOut: 'fade' } },
      'lower-third': { name: '이름 · 역할', style: { ...defaultCaptionStyle(), template, preset: 'minimal', fontSize: 82, position: 'bottom', positionX: 24, positionY: 78, textAlign: 'left', animation: 'slide-up', animationOut: 'slide-down' } },
      quote: { name: '“강조할 문장을 입력하세요”', style: { ...defaultCaptionStyle(), template, preset: 'minimal', fontFamily: 'serif', fontWeight: 600, fontSize: 118, position: 'middle', positionY: 48, animation: 'fade', animationOut: 'fade' } },
      subscribe: { name: '구독과 좋아요', style: { ...defaultCaptionStyle(), template, preset: 'bold', fontSize: 118, backgroundColor: 'rgba(220,42,58,.9)', position: 'bottom', positionY: 78, animation: 'pop', animationOut: 'pop' } },
      callout: { name: '핵심 포인트', style: { ...defaultCaptionStyle(), template, preset: 'bold', fontSize: 110, textColor: '#17131f', backgroundColor: 'rgba(255,213,92,.96)', position: 'top', positionY: 18, animation: 'slide-up', animationOut: 'fade' } },
    }
    const selectedTemplate = templates[template]
    const clip: TimelineClip = {
      id: crypto.randomUUID(),
      trackId: track.id,
      name: selectedTemplate.name,
      start: playhead,
      duration: 5,
      sourceOffset: 0,
      kind: 'caption',
      color: '#d99b38',
      transform: { ...defaultTransform },
      captionStyle: selectedTemplate.style,
    }
    commitTracks((current) => current.map((item) => item.id === track.id ? { ...item, clips: [...item.clips, clip].sort((a, b) => a.start - b.start) } : item))
    setSelectedAssetId(undefined)
    setSelectedTrackId(track.id)
    setSelectedClipId(clip.id)
    setToast(`${selectedTemplate.name} 모션 텍스트를 추가했습니다.`)
  }, [commitTracks, playhead, tracks])

  const trackClipFaceMotion = useCallback(async (clipId: string) => {
    const clip = tracksRef.current.flatMap((track) => track.clips).find((item) => item.id === clipId)
    const asset = assetsRef.current.find((item) => item.id === clip?.assetId)
    if (!clip || !asset?.sourceFile || asset.kind !== 'video') {
      setToast('이 클립에는 모션 추적에 사용할 영상 원본이 없습니다.')
      return
    }
    if (clip.keyframes?.length && !window.confirm('기존 위치·크기 키프레임을 얼굴 모션 추적 결과로 교체할까요?')) return
    const sourceAtStart = clipSourceTime(clip, clip.start)
    const sourceAtEnd = clipSourceTime(clip, clip.start + clip.duration)
    const sourceStart = Math.min(sourceAtStart, sourceAtEnd)
    const sourceEnd = Math.max(sourceAtStart, sourceAtEnd)
    const activityId = beginAiActivity({ operation: 'face-tracking', label: '로컬 AI 얼굴 모션 추적', processing: { location: 'local-device', processor: 'MediaPipe face detector' }, input: { sequenceId: activeSequenceId, assetIds: [asset.id], clipIds: [clip.id], timeRange: { start: clip.start, end: clip.start + clip.duration }, dataCategories: ['선택 클립 프레임'], summary: `“${clip.name}” ${clip.duration.toFixed(2)}초` }, reason: '검출된 얼굴 중심을 따라 위치 키프레임을 생성합니다.', approval: 'user-confirmed-change', undo: { available: true, method: 'editor-history', description: '한 번의 실행 취소로 이전 위치 키프레임 복원' } })
    const controller = new AbortController()
    motionTrackingAbortRef.current = controller
    setMotionTrackingClipId(clipId)
    setToast('선택 클립 구간의 얼굴 모션을 로컬에서 분석하고 있습니다.')
    try {
      const trackingAsset = asset.useProxy && asset.proxyFile ? { ...asset, sourceFile: asset.proxyFile, sourcePath: (asset.proxyFile as File & { __editweaveSourcePath?: string }).__editweaveSourcePath } : asset
      const tracked = await trackFacesInRange(trackingAsset, sourceStart, sourceEnd, { signal: controller.signal, onProgress: (progress) => {
        if (Math.round(progress * 100) % 10 === 0) setToast(`얼굴 모션 추적 ${Math.round(progress * 100)}%`)
      } })
      const points = tracked.length >= 2 ? tracked : (asset.faceTrack ?? []).filter((point) => point.time >= sourceStart && point.time <= sourceEnd).sort((a, b) => a.time - b.time)
      if (points.length < 2) throw new Error('클립 구간 안에서 얼굴 추적점을 2개 이상 찾지 못했습니다.')
      let smoothX = points[0].x
      let smoothY = points[0].y
      const keyframes = points.map((point) => {
        smoothX = smoothX * 0.42 + point.x * 0.58
        smoothY = smoothY * 0.42 + point.y * 0.58
        let low = clip.start
        let high = clip.start + clip.duration
        for (let iteration = 0; iteration < 24; iteration++) {
          const middle = (low + high) / 2
          const current = clipSourceTime(clip, middle)
          if ((!clip.reverse && current < point.time) || (clip.reverse && current > point.time)) low = middle
          else high = middle
        }
        return {
          id: crypto.randomUUID(),
          time: Math.max(0, Math.min(clip.duration, (low + high) / 2 - clip.start)),
          easing: 'ease-in-out' as const,
          transform: {
            ...clip.transform,
            positionX: Math.round(clip.transform.positionX + (0.5 - smoothX) * preset.width),
            positionY: Math.round(clip.transform.positionY + (0.5 - smoothY) * preset.height),
          },
        }
      }).sort((a, b) => a.time - b.time)
      setAssets((current) => current.map((item) => item.id === asset.id && tracked.length ? { ...item, faceTrack: [...(item.faceTrack ?? []).filter((point) => point.time < sourceStart || point.time > sourceEnd), ...tracked].sort((a, b) => a.time - b.time) } : item))
      updateClip(clip.id, { keyframes })
      endAiActivity(activityId, { status: 'completed', changes: { summary: `얼굴 추적 위치 키프레임 ${keyframes.length}개 적용`, clips: 1 } })
      setToast(`얼굴 추적 표본 ${keyframes.length}개를 위치 키프레임으로 적용했습니다.`)
    } catch (error) {
      const cancelled = controller.signal.aborted || error instanceof DOMException && error.name === 'AbortError'
      endAiActivity(activityId, { status: cancelled ? 'cancelled' : 'failed', error: error instanceof Error ? error.message : '얼굴 추적 실패' })
      setToast(error instanceof Error ? error.message : '얼굴 모션 추적에 실패했습니다.')
    } finally {
      motionTrackingAbortRef.current = undefined
      setMotionTrackingClipId(undefined)
    }
  }, [activeSequenceId, beginAiActivity, endAiActivity, preset.height, preset.width, updateClip])

  const trackMaskedObject = useCallback(async (clipId: string) => {
    const clip = tracksRef.current.flatMap((track) => track.clips).find((item) => item.id === clipId)
    const asset = assetsRef.current.find((item) => item.id === clip?.assetId)
    if (!clip || !asset?.sourceFile || asset.kind !== 'video') {
      setToast('이 클립에는 일반 물체 추적에 사용할 영상 원본이 없습니다.')
      return
    }
    const correctionTimeline = clip.visualKeyframes?.length ? Math.max(clip.start, Math.min(clip.start + clip.duration, playhead)) : clip.start
    const correctionLocal = correctionTimeline - clip.start
    const visual = resolveVisualEffects(clip, correctionTimeline)
    const allMasks = visual.masks ?? resolveEffectMasks(visual)
    const trackedMask = allMasks.find((mask) => mask.enabled && (mask.shape === 'polygon' || mask.shape === 'bezier'))
    const maskPoints = trackedMask?.points ?? []
    if (maskPoints.length < 3) {
      setToast('먼저 추적할 물체를 둘러싸는 다각형 또는 베지어 마스크를 만들어주세요.')
      return
    }
    if (clip.visualKeyframes?.length && !window.confirm(`${correctionLocal.toFixed(2)}초의 현재 마스크를 교정 기준으로 삼고, 이 지점 이후 추적 키프레임만 다시 만들까요? 이전 키프레임은 유지됩니다.`)) return
    const minimumX = Math.min(...maskPoints.map((point) => point.x)) / 100
    const maximumX = Math.max(...maskPoints.map((point) => point.x)) / 100
    const minimumY = Math.min(...maskPoints.map((point) => point.y)) / 100
    const maximumY = Math.max(...maskPoints.map((point) => point.y)) / 100
    const sourceAtStart = clipSourceTime(clip, correctionTimeline)
    const sourceAtEnd = clipSourceTime(clip, clip.start + clip.duration)
    const activityId = beginAiActivity({ operation: 'object-tracking', label: '로컬 AI 4점 물체 추적', processing: { location: 'local-device', processor: 'EditWeave four-point tracker' }, input: { sequenceId: activeSequenceId, assetIds: [asset.id], clipIds: [clip.id], timeRange: { start: correctionTimeline, end: clip.start + clip.duration }, dataCategories: ['선택 클립 프레임', '사용자 지정 마스크'], summary: `“${clip.name}” 마스크 교정점 ${maskPoints.length}개` }, reason: '사용자 마스크를 기준으로 이동·회전·크기·원근 변화 키프레임을 생성합니다.', approval: 'user-confirmed-change', undo: { available: true, method: 'editor-history', description: '한 번의 실행 취소로 이전 마스크 키프레임 복원' } })
    const controller = new AbortController()
    objectTrackingAbortRef.current = controller
    setObjectTrackingClipId(clipId)
    setToast('자유형 마스크의 네 기준점을 추적해 이동·회전·크기·원근 변화를 분석하고 있습니다.')
    try {
      const trackingAsset = asset.useProxy && asset.proxyFile ? { ...asset, sourceFile: asset.proxyFile, sourcePath: (asset.proxyFile as File & { __editweaveSourcePath?: string }).__editweaveSourcePath } : asset
      const tracked = await trackObjectInRange(trackingAsset, sourceAtStart, sourceAtEnd, { x: minimumX, y: minimumY, width: maximumX - minimumX, height: maximumY - minimumY }, { signal: controller.signal, onProgress: (progress) => {
        if (Math.round(progress * 100) % 10 === 0) setToast(`4점 원근 모션 추적 ${Math.round(progress * 100)}%`)
      } })
      if (tracked.length < 2) throw new Error('일반 물체 추적점을 충분히 만들지 못했습니다.')
      let smoothCorners = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]
      const maskBounds = { minX: Math.min(...maskPoints.map((point) => point.x)), maxX: Math.max(...maskPoints.map((point) => point.x)), minY: Math.min(...maskPoints.map((point) => point.y)), maxY: Math.max(...maskPoints.map((point) => point.y)) }
      const visualKeyframes = tracked.map((point) => {
        smoothCorners = smoothCorners.map((corner, index) => ({ x: corner.x * 0.35 + (point.cornerOffsets?.[index]?.x ?? point.offsetX) * 0.65, y: corner.y * 0.35 + (point.cornerOffsets?.[index]?.y ?? point.offsetY) * 0.65 }))
        let low = clip.start
        let high = clip.start + clip.duration
        for (let iteration = 0; iteration < 24; iteration++) {
          const middle = (low + high) / 2
          const current = clipSourceTime(clip, middle)
          if ((!clip.reverse && current < point.time) || (clip.reverse && current > point.time)) low = middle
          else high = middle
        }
        return {
          id: crypto.randomUUID(),
          time: Math.max(0, Math.min(clip.duration, (low + high) / 2 - clip.start)),
          easing: 'linear' as const,
          effects: trackedMask ? { ...visual, masks: allMasks.map((mask) => mask.id === trackedMask.id ? { ...mask, points: mask.points.map((maskPoint) => warpTrackedMaskPoint(maskPoint, maskBounds, smoothCorners)) } : { ...mask, points: mask.points.map((maskPoint) => ({ ...maskPoint })) }) } : { ...visual, maskPoints: maskPoints.map((maskPoint) => warpTrackedMaskPoint(maskPoint, maskBounds, smoothCorners)) },
        }
      }).sort((a, b) => a.time - b.time)
      const retainedKeyframes = (clip.visualKeyframes ?? []).filter((keyframe) => keyframe.time < correctionLocal - 1 / 60)
      const baseline = trackedMask ? { ...visual, masks: allMasks.map((mask) => ({ ...mask, points: mask.points.map((point) => ({ ...point })) })) } : { ...visual, maskPoints: maskPoints.map((point) => ({ ...point })) }
      updateClip(clip.id, {
        visualEffects: correctionLocal <= 1 / 60 ? baseline : clip.visualEffects,
        visualKeyframes: [...retainedKeyframes, ...visualKeyframes].sort((left, right) => left.time - right.time),
      })
      const averageConfidence = tracked.reduce((sum, point) => sum + point.confidence, 0) / tracked.length
      const reacquiredCount = tracked.filter((point) => point.reacquired).length
      endAiActivity(activityId, { status: 'completed', changes: { summary: `4점 추적 키프레임 ${visualKeyframes.length}개 적용 · 재획득 ${reacquiredCount}회`, clips: 1 } })
      setToast(`4점 원근 추적 표본 ${visualKeyframes.length}개를 적용했습니다. 평균 신뢰도 ${Math.round(averageConfidence * 100)}%${reacquiredCount ? ` · 가림 뒤 재획득 ${reacquiredCount}회` : ''}.`)
    } catch (error) {
      const cancelled = controller.signal.aborted || error instanceof DOMException && error.name === 'AbortError'
      endAiActivity(activityId, { status: cancelled ? 'cancelled' : 'failed', error: error instanceof Error ? error.message : '물체 추적 실패' })
      setToast(error instanceof Error ? error.message : '일반 물체 모션 추적에 실패했습니다.')
    } finally {
      objectTrackingAbortRef.current = undefined
      setObjectTrackingClipId(undefined)
    }
  }, [activeSequenceId, beginAiActivity, endAiActivity, playhead, updateClip])

  const stabilizeClipMotion = useCallback(async (clipId: string) => {
    const clip = tracksRef.current.flatMap((track) => track.clips).find((item) => item.id === clipId)
    const asset = assetsRef.current.find((item) => item.id === clip?.assetId)
    if (!clip || !asset?.sourceFile || asset.kind !== 'video') {
      setToast('이 클립에는 안정화할 영상 원본이 없습니다.')
      return
    }
    if (clip.keyframes?.length && !clip.stabilization && !window.confirm('현재 위치·크기 키프레임을 보존한 상태에서 안정화 보정을 새 키프레임으로 결합할까요?')) return
    const sourceAtStart = clipSourceTime(clip, clip.start)
    const sourceAtEnd = clipSourceTime(clip, clip.start + clip.duration)
    const activityId = beginAiActivity({ operation: 'stabilization', label: '로컬 AI 영상 안정화', processing: { location: 'local-device', processor: 'EditWeave four-point stabilization' }, input: { sequenceId: activeSequenceId, assetIds: [asset.id], clipIds: [clip.id], timeRange: { start: clip.start, end: clip.start + clip.duration }, dataCategories: ['선택 클립 프레임', '기존 변형 키프레임'], summary: `“${clip.name}” ${clip.duration.toFixed(2)}초` }, reason: '카메라 이동·회전·줌을 추적해 안정화 보정과 자동 크롭을 생성합니다.', approval: 'user-confirmed-change', undo: { available: true, method: 'editor-history', description: '한 번의 실행 취소로 원래 변형·키프레임 복원' } })
    const controller = new AbortController()
    stabilizationAbortRef.current = controller
    setStabilizationClipId(clipId)
    setToast('4점 특징 추적으로 카메라 이동·회전·줌을 안정화하고 있습니다.')
    try {
      const trackingAsset = asset.useProxy && asset.proxyFile ? { ...asset, sourceFile: asset.proxyFile, sourcePath: (asset.proxyFile as File & { __editweaveSourcePath?: string }).__editweaveSourcePath } : asset
      const tracked = await trackObjectInRange(trackingAsset, sourceAtStart, sourceAtEnd, { x: 0.12, y: 0.12, width: 0.76, height: 0.76 }, { signal: controller.signal, onProgress: (progress) => {
        if (Math.round(progress * 100) % 10 === 0) setToast(`영상 안정화 분석 ${Math.round(progress * 100)}%`)
      } })
      if (tracked.length < 3) throw new Error('안정화에 필요한 추적 표본을 충분히 만들지 못했습니다.')
      const originalTransform = structuredClone(clip.stabilization?.originalTransform ?? clip.transform)
      const originalKeyframes = structuredClone(clip.stabilization?.originalKeyframes ?? clip.keyframes)
      const timelinePoints = tracked.map((point) => {
        let low = clip.start
        let high = clip.start + clip.duration
        for (let iteration = 0; iteration < 24; iteration++) {
          const middle = (low + high) / 2
          const current = clipSourceTime(clip, middle)
          if ((!clip.reverse && current < point.time) || (clip.reverse && current > point.time)) low = middle
          else high = middle
        }
        return { ...point, localTime: Math.max(0, Math.min(clip.duration, (low + high) / 2 - clip.start)) }
      }).sort((left, right) => left.localTime - right.localTime)
      const radius = Math.max(2, Math.min(8, Math.round(timelinePoints.length / 24)))
      const smooth = timelinePoints.map((_, index) => {
        const from = Math.max(0, index - radius)
        const to = Math.min(timelinePoints.length - 1, index + radius)
        let weightSum = 0
        let x = 0
        let y = 0
        let rotation = 0
        let scale = 0
        for (let neighbor = from; neighbor <= to; neighbor++) {
          const distance = Math.abs(neighbor - index)
          const weight = radius + 1 - distance
          const point = timelinePoints[neighbor]
          weightSum += weight
          x += point.offsetX * weight
          y += point.offsetY * weight
          rotation += point.rotation * weight
          scale += point.scale * weight
        }
        return { x: x / weightSum, y: y / weightSum, rotation: rotation / weightSum, scale: scale / weightSum }
      })
      const strength = 0.9
      let maximumShift = 0
      let maximumRotation = 0
      const corrections = timelinePoints.map((point, index) => {
        const correctionX = (smooth[index].x - point.offsetX) * strength
        const correctionY = (smooth[index].y - point.offsetY) * strength
        const correctionRotation = (smooth[index].rotation - point.rotation) * strength
        const scaleCorrection = 1 + (smooth[index].scale / Math.max(0.05, point.scale) - 1) * strength
        maximumShift = Math.max(maximumShift, Math.abs(correctionX), Math.abs(correctionY))
        maximumRotation = Math.max(maximumRotation, Math.abs(correctionRotation))
        return { correctionX, correctionY, correctionRotation, scaleCorrection }
      })
      const autoScale = Math.max(1, Math.min(1.35, 1.025 + maximumShift * 2.2 + Math.sin(maximumRotation * Math.PI / 180) * 0.7))
      const keyframes = timelinePoints.map((point, index) => {
        const baseline = resolveClipTransform({ ...clip, stabilization: undefined, transform: originalTransform, keyframes: originalKeyframes }, clip.start + point.localTime)
        const correction = corrections[index]
        return {
          id: crypto.randomUUID(),
          time: point.localTime,
          easing: 'linear' as const,
          transform: {
            ...baseline,
            positionX: baseline.positionX + correction.correctionX * preset.width,
            positionY: baseline.positionY + correction.correctionY * preset.height,
            rotation: baseline.rotation + correction.correctionRotation,
            scale: baseline.scale * autoScale * correction.scaleCorrection,
          },
        }
      })
      updateClip(clip.id, {
        transform: keyframes[0]?.transform ?? clip.transform,
        keyframes,
        stabilization: { method: 'four-point', strength, autoScale, sampleCount: keyframes.length, analyzedAt: new Date().toISOString(), originalTransform, originalKeyframes },
      })
      const averageConfidence = tracked.reduce((sum, point) => sum + point.confidence, 0) / tracked.length
      endAiActivity(activityId, { status: 'completed', changes: { summary: `안정화 키프레임 ${keyframes.length}개 · 자동 크롭 ${(autoScale * 100).toFixed(1)}% · 신뢰도 ${Math.round(averageConfidence * 100)}%`, clips: 1 } })
      setToast(`영상 안정화 표본 ${keyframes.length}개 적용 · 자동 크롭 ${(autoScale * 100).toFixed(1)}% · 추적 신뢰도 ${Math.round(averageConfidence * 100)}%`)
    } catch (error) {
      const cancelled = controller.signal.aborted || error instanceof DOMException && error.name === 'AbortError'
      endAiActivity(activityId, { status: cancelled ? 'cancelled' : 'failed', error: error instanceof Error ? error.message : '영상 안정화 실패' })
      setToast(error instanceof Error ? error.message : '영상 안정화에 실패했습니다.')
    } finally {
      stabilizationAbortRef.current = undefined
      setStabilizationClipId(undefined)
    }
  }, [activeSequenceId, beginAiActivity, endAiActivity, preset.height, preset.width, updateClip])

  const detectScenesForClip = useCallback(async (clipId: string) => {
    const clip = tracksRef.current.flatMap((track) => track.clips).find((item) => item.id === clipId)
    const asset = assetsRef.current.find((item) => item.id === clip?.assetId)
    if (!clip || !asset?.sourceFile || asset.kind !== 'video') {
      setToast('이 클립에는 장면 전환을 분석할 영상 원본이 없습니다.')
      return
    }
    const sourceAtStart = clipSourceTime(clip, clip.start)
    const sourceAtEnd = clipSourceTime(clip, clip.start + clip.duration)
    const activityId = beginAiActivity({ operation: 'scene-detection', label: '로컬 장면 전환 감지', processing: { location: 'local-device', processor: 'EditWeave frame-difference detector' }, input: { sequenceId: activeSequenceId, assetIds: [asset.id], clipIds: [clip.id], timeRange: { start: clip.start, end: clip.start + clip.duration }, dataCategories: ['선택 클립 축소 프레임'], summary: `“${clip.name}” ${clip.duration.toFixed(2)}초` }, reason: '클립 분할 또는 마커 적용 전에 장면 전환 후보를 검토용으로 찾습니다.', approval: 'analysis-only', undo: { available: false, method: 'none', description: '분석만 수행하며 승인 전 타임라인 변경 없음' } })
    const controller = new AbortController()
    sceneDetectionAbortRef.current = controller
    setSceneDetectionClipId(clipId)
    setToast('선택 클립의 장면 전환을 로컬에서 분석하고 있습니다.')
    try {
      const analysisAsset = asset.useProxy && asset.proxyFile ? { ...asset, sourceFile: asset.proxyFile, sourcePath: (asset.proxyFile as File & { __editweaveSourcePath?: string }).__editweaveSourcePath } : asset
      const candidates = await detectSceneCuts(analysisAsset, sourceAtStart, sourceAtEnd, { signal: controller.signal, onProgress: (progress) => {
        if (Math.round(progress * 100) % 10 === 0) setToast(`장면 전환 감지 ${Math.round(progress * 100)}%`)
      } })
      const points = candidates.map((candidate) => {
        let low = clip.start
        let high = clip.start + clip.duration
        for (let iteration = 0; iteration < 24; iteration++) {
          const middle = (low + high) / 2
          const current = clipSourceTime(clip, middle)
          if ((!clip.reverse && current < candidate.sourceTime) || (clip.reverse && current > candidate.sourceTime)) low = middle
          else high = middle
        }
        return { id: crypto.randomUUID(), timelineTime: (low + high) / 2, sourceTime: candidate.sourceTime, score: candidate.score }
      }).filter((point) => point.timelineTime > clip.start + 0.08 && point.timelineTime < clip.start + clip.duration - 0.08).sort((a, b) => a.timelineTime - b.timelineTime)
      setSceneReview({ clipId, clipName: clip.name, points })
      endAiActivity(activityId, { status: 'completed', changes: { summary: `검토 대기 장면 전환 후보 ${points.length}개 · 타임라인 미적용` } })
      setToast(points.length ? `${points.length}개 장면 전환 후보를 찾았습니다. 적용 전에 선택해주세요.` : '뚜렷한 장면 전환을 찾지 못했습니다.')
    } catch (error) {
      const cancelled = controller.signal.aborted || error instanceof DOMException && error.name === 'AbortError'
      endAiActivity(activityId, { status: cancelled ? 'cancelled' : 'failed', error: error instanceof Error ? error.message : '장면 전환 감지 실패' })
      setToast(error instanceof Error ? error.message : '장면 전환 감지에 실패했습니다.')
    } finally {
      sceneDetectionAbortRef.current = undefined
      setSceneDetectionClipId(undefined)
    }
  }, [activeSequenceId, beginAiActivity, endAiActivity])

  const addSceneMarkers = useCallback((points: SceneReviewPoint[]) => {
    commitEditor({ markers: (current) => [...current, ...points.map((point, index) => ({ id: crypto.randomUUID(), time: point.timelineTime, label: `감지 장면 ${index + 1}`, color: '#e8b958', kind: 'edit' as const }))].sort((a, b) => a.time - b.time) })
    setSceneReview(undefined)
    const activityId = beginAiActivity({ operation: 'scene-detection-apply', label: '장면 감지 결과 적용 · 마커', processing: { location: 'local-device', processor: 'User-reviewed scene detection' }, input: { sequenceId: activeSequenceId, dataCategories: ['장면 후보 점수', '사용자 선택'], summary: `선택한 장면 후보 ${points.length}개` }, reason: '사용자가 승인한 장면 전환 후보를 비파괴 편집 마커로 적용합니다.', approval: 'user-confirmed-change', undo: { available: true, method: 'editor-history', description: '한 번의 실행 취소로 추가 마커 제거' } })
    endAiActivity(activityId, { status: 'completed', changes: { summary: `장면 전환 마커 ${points.length}개 추가`, markers: points.length } })
    setToast(`${points.length}개 장면 전환을 비파괴 마커로 추가했습니다.`)
  }, [activeSequenceId, beginAiActivity, commitEditor, endAiActivity])

  const splitAtDetectedScenes = useCallback((points: SceneReviewPoint[]) => {
    if (!sceneReview) return
    const source = tracksRef.current.flatMap((track) => track.clips).find((clip) => clip.id === sceneReview.clipId)
    if (!source) {
      setSceneReview(undefined)
      setToast('분할할 원본 클립이 더 이상 타임라인에 없습니다.')
      return
    }
    const relationId = source.groupId ?? source.linkGroupId
    const cutTimes = [...new Set(points.map((point) => point.timelineTime))].sort((a, b) => a - b)
    commitTracks((current) => current.map((track) => track.locked ? track : ({ ...track, clips: track.clips.flatMap((clip) => {
      const related = clip.id === source.id || Boolean(relationId && (clip.groupId === relationId || clip.linkGroupId === relationId))
      if (!related) return [clip]
      const boundaries = [clip.start, ...cutTimes.filter((time) => time > clip.start + 0.05 && time < clip.start + clip.duration - 0.05), clip.start + clip.duration]
      if (boundaries.length <= 2) return [clip]
      return boundaries.slice(0, -1).map((start, index) => {
        const end = boundaries[index + 1]
        return {
          ...clip,
          id: index === 0 ? clip.id : crypto.randomUUID(),
          name: index === 0 ? clip.name : `${clip.name} · 장면 ${index + 1}`,
          start,
          duration: end - start,
          ...sliceClipSpeed(clip, start - clip.start, end - clip.start),
          ...sliceClipAutomation(clip, start - clip.start, end - clip.start),
          transitionIn: index === 0 ? clip.transitionIn : undefined,
          transitionOut: index === boundaries.length - 2 ? clip.transitionOut : undefined,
          audioAdjustment: clip.audioAdjustment ? { ...clip.audioAdjustment, fadeIn: index === 0 ? clip.audioAdjustment.fadeIn : 0, fadeOut: index === boundaries.length - 2 ? clip.audioAdjustment.fadeOut : 0 } : undefined,
        }
      })
    }).sort((a, b) => a.start - b.start) })))
    setSceneReview(undefined)
    setSelectedClipId(source.id)
    const activityId = beginAiActivity({ operation: 'scene-detection-apply', label: '장면 감지 결과 적용 · 클립 분할', processing: { location: 'local-device', processor: 'User-reviewed scene detection' }, input: { sequenceId: activeSequenceId, clipIds: [source.id], dataCategories: ['장면 후보 점수', '사용자 선택'], summary: `선택한 장면 전환 ${points.length}개` }, reason: '사용자가 승인한 장면 전환 지점에서 연결된 클립을 분할합니다.', approval: 'user-confirmed-change', undo: { available: true, method: 'editor-history', description: '한 번의 실행 취소로 모든 분할 복원' } })
    endAiActivity(activityId, { status: 'completed', changes: { summary: `장면 전환 ${points.length}개 지점에서 클립 분할`, clips: points.length + 1 } })
    setToast(`${points.length}개 장면 전환 지점에서 클립을 분할했습니다. 실행 취소로 되돌릴 수 있습니다.`)
  }, [activeSequenceId, beginAiActivity, commitTracks, endAiActivity, sceneReview])

  const generateCaptionsFromTranscript = useCallback((language = 'ko') => {
    const captionTrack = tracks.find((track) => track.kind === 'caption')
    if (!captionTrack || !transcript.length) return
    const clips: TimelineClip[] = transcript.map((segment, index) => ({
      id: `caption-${segment.id}`,
      trackId: captionTrack.id,
      name: segment.text,
      start: segment.start,
      duration: Math.max(0.2, segment.end - segment.start),
      sourceOffset: 0,
      kind: 'caption',
      color: index % 2 ? '#e78a42' : '#d6a23e',
      transform: { ...defaultTransform },
      captionStyle: structuredClone(captionTrack.captionStyle ?? defaultCaptionStyle()),
      captionWords: segment.words?.map((word) => ({ ...word, start: Math.max(0, word.start - segment.start), end: Math.max(0, word.end - segment.start) })),
      captionLanguage: segment.language ?? language,
      speaker: segment.speaker,
    }))
    commitTracks((current) => current.map((track) => track.id === captionTrack.id ? { ...track, captionLanguage: language, captionFormat: 'subtitle', captionStyle: structuredClone(captionTrack.captionStyle ?? defaultCaptionStyle()), clips } : track))
    setSelectedClipId(clips[0].id)
    setToast(`대본 ${clips.length}개를 자막 트랙에 반영했습니다.`)
  }, [commitTracks, tracks, transcript])

  const splitTranscriptCue = useCallback((segmentId: string) => {
    const segment = transcriptRef.current.find((item) => item.id === segmentId)
    if (!segment || segment.end - segment.start < 2 / activeSequenceFps) return
    const middle = Math.round(((segment.start + segment.end) / 2) * activeSequenceFps) / activeSequenceFps
    const words = segment.words ?? []
    const leftWords = words.filter((word) => word.start < middle)
    const rightWords = words.filter((word) => word.end > middle)
    const tokens = segment.text.trim().split(/\s+/)
    const tokenSplit = Math.max(1, Math.min(tokens.length - 1, Math.round(tokens.length / 2)))
    const leftText = leftWords.length ? leftWords.map((word) => word.text).join(' ') : tokens.slice(0, tokenSplit).join(' ')
    const rightText = rightWords.length ? rightWords.map((word) => word.text).join(' ') : tokens.slice(tokenSplit).join(' ')
    if (!leftText || !rightText) return
    const left: TranscriptSegment = { ...segment, id: crypto.randomUUID(), end: middle, text: leftText, words: leftWords.length ? leftWords : undefined }
    const right: TranscriptSegment = { ...segment, id: crypto.randomUUID(), start: middle, text: rightText, words: rightWords.length ? rightWords : undefined }
    commitEditor({ transcript: (current) => current.flatMap((item) => item.id === segmentId ? [left, right] : [item]).sort((a, b) => a.start - b.start) })
    setSelectedTranscriptId(right.id)
    setPlayhead(middle)
    setToast('자막 큐를 두 구간으로 분할했습니다.')
  }, [activeSequenceFps, commitEditor])

  const mergeTranscriptCueWithNext = useCallback((segmentId: string) => {
    const ordered = [...transcriptRef.current].sort((a, b) => a.start - b.start)
    const index = ordered.findIndex((segment) => segment.id === segmentId)
    const segment = ordered[index]
    const next = ordered[index + 1]
    if (!segment || !next) return
    const merged: TranscriptSegment = {
      ...segment,
      id: crypto.randomUUID(),
      end: Math.max(segment.end, next.end),
      text: `${segment.text.trim()} ${next.text.trim()}`.trim(),
      words: segment.words?.length || next.words?.length ? [...(segment.words ?? []), ...(next.words ?? [])].sort((a, b) => a.start - b.start) : undefined,
      language: segment.language ?? next.language,
      speaker: segment.speaker === next.speaker ? segment.speaker : segment.speaker ?? next.speaker,
    }
    commitEditor({ transcript: (current) => current.filter((item) => item.id !== segment.id && item.id !== next.id).concat(merged).sort((a, b) => a.start - b.start) })
    setSelectedTranscriptId(merged.id)
    setPlayhead(merged.start)
    setToast('선택 자막 큐와 다음 큐를 병합했습니다.')
  }, [commitEditor])

  const importSubtitleFile = useCallback(async (file: File) => {
    try {
      const segments = parseSubtitleFile(await file.text())
      if (!segments.length) throw new Error('유효한 자막 구간을 찾지 못했습니다.')
      commitEditor({ transcript: () => segments, suggestions: () => [] })
      setActivePanel('transcript')
      setSelectedTranscriptId(segments[0].id)
      setPlayhead(segments[0].start)
      setToast(`${segments.length}개 자막 구간을 가져왔습니다.`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '자막 파일을 읽지 못했습니다.')
    }
  }, [commitEditor])

  const exportSubtitles = useCallback(async (format: 'srt' | 'vtt' | 'ttml', language = 'ko') => {
    if (!transcript.length) return
    try {
      const contents = format === 'vtt' ? transcriptToVtt(transcript) : format === 'ttml' ? transcriptToTtml(transcript, language) : transcriptToSrt(transcript)
      const path = await saveSubtitleFile(contents, `${projectName}-자막`, format)
      if (path) setToast(`${format.toUpperCase()} 자막을 저장했습니다: ${path}`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : `${format.toUpperCase()} 자막 저장에 실패했습니다.`)
    }
  }, [projectName, transcript])

  const runTranscription = useCallback(async () => {
    if (!transcribableAsset?.sourceFile || transcriptionRunning) return
    const activityId = beginAiActivity({
      operation: 'transcription',
      label: '로컬 음성 인식·화자 재식별',
      processing: { location: 'local-device', processor: transcriptionModelForQuality(aiPrivacySettings.transcriptionQuality) },
      input: { sequenceId: activeSequenceId, assetIds: [transcribableAsset.id], dataCategories: ['오디오', '기존 화자 특징', '사용자 교정 사전'], summary: `“${transcribableAsset.name}”의 음성 트랙` },
      reason: '타임라인 편집과 자막 생성에 사용할 시간축 대본을 만듭니다.',
      approval: 'user-confirmed-change',
      undo: { available: true, method: 'editor-history', description: '한 번의 실행 취소로 대본·제안 복원 · 새 화자 프로필은 AI 데이터 설정에서 별도 삭제' },
    })
    const controller = new AbortController()
    transcriptionAbortRef.current?.abort()
    transcriptionAbortRef.current = controller
    setTranscriptionRunning(true)
    setTranscriptionProgress(0)
    setTranscriptionStage('준비')
    try {
      const rawSegments = await transcribeLocally(transcribableAsset.proxyFile ?? transcribableAsset.sourceFile, ({ progress, stage }) => {
        setTranscriptionProgress(progress)
        setTranscriptionStage(stage)
      }, controller.signal, aiPrivacySettings.transcriptionQuality)
      const knownSpeakers = [...sequenceLibrary.filter((sequence) => sequence.id !== activeSequenceId).flatMap((sequence) => sequence.transcript), ...transcriptRef.current]
      const reidentified = reidentifyTranscriptSpeakers(rawSegments, knownSpeakers, speakerVoiceProfiles)
      const segments = reidentified.map((segment) => Object.entries(correctionDictionary).reduce((current, [source, replacement]) => ({ ...current, text: current.text.split(source).join(replacement), words: current.words?.map((word) => ({ ...word, text: word.text.split(source).join(replacement) })) }), segment))
      if (!segments.length) throw new Error('인식된 음성이 없습니다.')
      setSpeakerVoiceProfiles((current) => createSpeakerVoiceProfiles(segments, current))
      commitEditor({ transcript: () => segments, suggestions: () => [] })
      endAiActivity(activityId, { status: 'completed', changes: { summary: `대본 ${segments.length}개 생성 · 기존 AI 제안 초기화`, transcriptSegments: segments.length, suggestions: 0 } })
      setSelectedTranscriptId(segments[0].id)
      setPlayhead(segments[0].start)
      setToast(`로컬 음성 인식으로 ${segments.length}개 구간을 만들었습니다.`)
    } catch (error) {
      const cancelled = controller.signal.aborted || error instanceof DOMException && error.name === 'AbortError'
      const message = error instanceof Error ? error.message : '로컬 음성 인식에 실패했습니다.'
      endAiActivity(activityId, { status: cancelled ? 'cancelled' : 'failed', error: message })
      if (cancelled) setToast('로컬 음성 인식과 화자 재식별을 취소했습니다.')
      else setToast(message)
    } finally {
      if (transcriptionAbortRef.current === controller) {
        transcriptionAbortRef.current = undefined
        setTranscriptionRunning(false)
        setTranscriptionProgress(0)
        setTranscriptionStage('준비')
      }
    }
  }, [activeSequenceId, aiPrivacySettings.transcriptionQuality, beginAiActivity, commitEditor, correctionDictionary, endAiActivity, sequenceLibrary, speakerVoiceProfiles, transcribableAsset, transcriptionRunning])

  const cancelTranscription = useCallback(() => {
    if (!transcriptionAbortRef.current) return
    setTranscriptionStage('취소 중')
    transcriptionAbortRef.current.abort()
  }, [])

  const clearSpeakerProfiles = useCallback(() => {
    const count = new Set([...speakerVoiceProfiles.map((profile) => profile.identityId), ...transcriptRef.current.map((segment) => segment.speakerIdentityId), ...sequenceLibrary.flatMap((sequence) => sequence.transcript.map((segment) => segment.speakerIdentityId))].filter(Boolean)).size
    if (!count || !window.confirm(`이 프로젝트에 저장된 화자 음성 특징 ${count}개를 삭제할까요? 화자 이름과 대본은 유지되지만 다음 전사에서 동일 인물을 자동으로 연결할 수 없습니다.`)) return
    const clear = (segment: TranscriptSegment): TranscriptSegment => ({ ...segment, speakerEmbedding: undefined, speakerEmbeddingVersion: undefined, speakerIdentityId: undefined, speakerConfidence: undefined, speakerAssignedManually: undefined })
    commitEditor({ transcript: (segments) => segments.map(clear) })
    setSequenceLibrary((sequences) => sequences.map((sequence) => sequence.id === activeSequenceId ? sequence : { ...sequence, transcript: sequence.transcript.map(clear) }))
    setSpeakerVoiceProfiles([])
    setToast(`화자 음성 특징 ${count}개를 프로젝트에서 삭제했습니다.`)
  }, [activeSequenceId, commitEditor, sequenceLibrary, speakerVoiceProfiles])

  const updateTranscriptText = useCallback((id: string, patch: Partial<TranscriptSegment>) => {
    const next = transcriptRef.current.map((segment) => segment.id === id ? { ...segment, ...patch } : segment)
    transcriptRef.current = next
    setTranscript(next)
  }, [])

  const renameTranscriptSpeaker = useCallback((segmentId: string, from: string, to: string) => {
    const source = from.trim()
    const replacement = to.trim() || source || '화자 1'
    if (!source || source === replacement) return
    const editedIdentity = transcriptRef.current.find((segment) => segment.id === segmentId)?.speakerIdentityId
    const identityIds = new Set([editedIdentity, ...transcriptRef.current.filter((segment) => (segment.speaker ?? '화자 1') === source).map((segment) => segment.speakerIdentityId)].filter((value): value is string => Boolean(value)))
    const matchesIdentity = (segment: TranscriptSegment) => Boolean(segment.speakerIdentityId && identityIds.has(segment.speakerIdentityId))
    const next = transcriptRef.current.map((segment) => (segment.speaker ?? '화자 1') === source || matchesIdentity(segment) ? { ...segment, speaker: replacement, speakerAssignedManually: true } : segment)
    transcriptRef.current = next
    setTranscript(next)
    if (identityIds.size) setSequenceLibrary((sequences) => sequences.map((sequence) => ({ ...sequence, transcript: sequence.transcript.map((segment) => matchesIdentity(segment) ? { ...segment, speaker: replacement, speakerAssignedManually: true } : segment) })))
    if (identityIds.size) setSpeakerVoiceProfiles((profiles) => profiles.map((profile) => identityIds.has(profile.identityId) ? { ...profile, speaker: replacement, updatedAt: new Date().toISOString() } : profile))
  }, [])

  const assignTranscriptSegmentSpeaker = useCallback((id: string, requestedSpeaker?: string) => {
    const current = transcriptRef.current.find((segment) => segment.id === id)
    if (!current) return
    const used = new Set(transcriptRef.current.map((segment) => segment.speaker ?? '화자 1'))
    let speaker = requestedSpeaker?.trim()
    if (!speaker) {
      let number = 1
      while (used.has(`화자 ${number}`)) number += 1
      speaker = `화자 ${number}`
    }
    if ((current.speaker ?? '화자 1') === speaker) return
    const existingIdentity = transcriptRef.current.find((segment) => segment.id !== id && (segment.speaker ?? '화자 1') === speaker)?.speakerIdentityId
    const updated: TranscriptSegment = { ...current, speaker, speakerIdentityId: existingIdentity ?? current.speakerIdentityId ?? crypto.randomUUID(), speakerConfidence: 1, speakerAssignedManually: true }
    commitEditor({ transcript: (segments) => segments.map((segment) => segment.id === id ? updated : segment) })
    setSpeakerVoiceProfiles((profiles) => createSpeakerVoiceProfiles([updated], profiles).map((profile) => profile.identityId === updated.speakerIdentityId ? { ...profile, speaker } : profile))
    setToast(`선택 발화를 “${speaker}”로 재지정했습니다.`)
  }, [commitEditor])

  const beginTranscriptEdit = useCallback(() => {
    transcriptEditSnapshotRef.current ??= {
      tracks: tracksRef.current,
      transcript: transcriptRef.current,
      suggestions: suggestionsRef.current,
      markers: markersRef.current,
      audioBuses: audioBusesRef.current,
      adrCues: adrCuesRef.current,
    }
  }, [])

  const commitTranscriptEdit = useCallback(() => {
    const before = transcriptEditSnapshotRef.current
    transcriptEditSnapshotRef.current = undefined
    if (!before || before.transcript === transcriptRef.current) return
    const changed = JSON.stringify(before.transcript) !== JSON.stringify(transcriptRef.current)
    if (!changed) return
    setPast((items) => [...items, before].slice(-60))
    setFuture([])
  }, [])

  const removeTranscriptSegment = useCallback((segment: TranscriptSegment, addAudioFades = true) => {
    if (!commitRippleDelete(segment.start, segment.end, { addAudioFades, clearSuggestions: true })) return
    setSelectedTranscriptId(undefined)
    setSelectedClipId(undefined)
    setPlayhead(segment.start)
    setPendingTranscriptCut(undefined)
    setToast(`${(segment.end - segment.start).toFixed(1)}초 구간을 리플 삭제했습니다.`)
  }, [commitRippleDelete])

  const importAudienceRetention = useCallback(async (file: File) => {
    try {
      const duration = Math.max(1, ...transcript.map((segment) => segment.end), ...tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)))
      const retention = parseAudienceRetentionCsv(await file.text(), file.name, duration)
      setCreatorLearningProfile((current) => ({ ...normalizeCreatorLearningProfile(current), audienceRetention: retention, updatedAt: new Date().toISOString() }))
      setToast(`${retention.samples.length}개의 YouTube 유지율 지점을 가져왔습니다.`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '유지율 CSV를 가져오지 못했습니다.')
    }
  }, [tracks, transcript])

  const analyzeRoughCut = useCallback(async () => {
    if (roughCutAnalysisRunning) return
    const audioTrack = tracks.find((track) => track.kind === 'audio')
    const videoTrack = tracks.find((track) => track.kind === 'video')
    const sourceClips = audioTrack?.clips.some((clip) => clip.assetId) ? audioTrack.clips : videoTrack?.clips ?? []
    const activityId = beginAiActivity({
      operation: 'rough-cut-analysis',
      label: '채널 맞춤 초벌 편집 분석',
      processing: { location: 'local-device', processor: 'EditWeave rules + multilingual-e5-small' },
      input: { sequenceId: activeSequenceId, assetIds: [...new Set(sourceClips.flatMap((clip) => clip.assetId ? [clip.assetId] : []))], clipIds: sourceClips.map((clip) => clip.id), dataCategories: ['대본', '오디오 파형', '채널 적용·기각 피드백', ...(creatorLearningProfile.audienceRetention ? ['유지율 CSV'] : [])], summary: `대본 ${transcript.length}개 · 소스 클립 ${sourceClips.length}개` },
      reason: '침묵·군더더기·반복 제거와 하이라이트 후보를 적용 전 검토용으로 제안합니다.',
      approval: 'analysis-only',
      undo: { available: true, method: 'editor-history', description: '분석 전 제안 목록으로 실행 취소' },
    })
    setRoughCutAnalysisRunning(true)
    setRoughCutAnalysisProgress(0)
    setRoughCutAnalysisStage('기본 편집 후보 분석')
    let base: EditSuggestion[] = []
    try {
      base = createRoughCutSuggestions(transcript, sourceClips, assets, creatorLearningProfile)
      setRoughCutAnalysisProgress(0.01)
      const next = transcript.length
        ? await enrichSemanticHighlights(transcript, base, creatorLearningProfile, (progress, stage) => { setRoughCutAnalysisProgress(progress); setRoughCutAnalysisStage(stage) })
        : base
      commitEditor({ suggestions: () => next })
      endAiActivity(activityId, { status: 'completed', changes: { summary: `검토 대기 AI 제안 ${next.length}개 생성 · 타임라인 미적용`, suggestions: next.length } })
      setToast(next.length ? `${next.length}개의 채널 맞춤 초벌 편집 후보를 찾았습니다.` : '제거할 후보를 찾지 못했습니다.')
    } catch (error) {
      commitEditor({ suggestions: () => base })
      endAiActivity(activityId, { status: 'completed', changes: { summary: `의미 분석 실패 후 기본 제안 ${base.length}개 생성`, suggestions: base.length }, error: error instanceof Error ? error.message : '의미 분석 실패' })
      setToast(error instanceof Error ? `의미 분석은 실패했지만 기본 후보 ${base.length}개를 만들었습니다: ${error.message}` : `의미 분석은 실패했지만 기본 후보 ${base.length}개를 만들었습니다.`)
    } finally {
      setRoughCutAnalysisRunning(false)
      setRoughCutAnalysisProgress(0)
      setRoughCutAnalysisStage('준비')
    }
  }, [activeSequenceId, assets, beginAiActivity, commitEditor, creatorLearningProfile, endAiActivity, roughCutAnalysisRunning, tracks, transcript])

  const applySuggestion = useCallback((suggestion: EditSuggestion) => {
    if (suggestion.type === 'highlight') {
      setCreatorLearningProfile((current) => recordSuggestionFeedback(current, suggestion, 'applied'))
      commitEditor({
        suggestions: (current) => current.map((item) => item.id === suggestion.id ? { ...item, status: 'applied' } : item),
        markers: (current) => [...current, { id: crypto.randomUUID(), time: suggestion.start, label: suggestion.label.replace(/^하이라이트:\s*/, ''), color: '#f1b84b', kind: 'chapter' as const, createdAt: new Date().toISOString() }].sort((left, right) => left.time - right.time),
      })
      setPlayhead(suggestion.start)
      const activityId = beginAiActivity({ operation: 'suggestion-apply', label: `AI 제안 적용 · ${suggestion.label}`, processing: { location: 'local-device', processor: 'EditWeave rough-cut decision' }, input: { sequenceId: activeSequenceId, timeRange: { start: suggestion.start, end: suggestion.end }, dataCategories: ['AI 추천 점수', '추천 이유', '사용자 승인'], summary: `${suggestion.type} · ${Math.round(suggestion.score * 100)}% · ${suggestion.start.toFixed(2)}–${suggestion.end.toFixed(2)}초` }, reason: suggestion.reason, approval: 'user-confirmed-change', undo: { available: true, method: 'editor-history', description: '마커는 한 번의 실행 취소로 제거 · 채널 적용 피드백은 학습 초기화 전까지 유지' } })
      endAiActivity(activityId, { status: 'completed', changes: { summary: '하이라이트 후보를 챕터 마커로 적용', markers: 1 } })
      setToast('하이라이트 후보를 챕터 마커로 적용했습니다.')
      return
    }
    if (!commitRippleDelete(suggestion.start, suggestion.end, { appliedSuggestionId: suggestion.id, addAudioFades: true })) return
    setCreatorLearningProfile((current) => recordSuggestionFeedback(current, suggestion, 'applied'))
    const activityId = beginAiActivity({ operation: 'suggestion-apply', label: `AI 제안 적용 · ${suggestion.label}`, processing: { location: 'local-device', processor: 'EditWeave rough-cut decision' }, input: { sequenceId: activeSequenceId, timeRange: { start: suggestion.start, end: suggestion.end }, dataCategories: ['AI 추천 점수', '추천 이유', '사용자 승인'], summary: `${suggestion.type} · ${Math.round(suggestion.score * 100)}% · ${suggestion.start.toFixed(2)}–${suggestion.end.toFixed(2)}초` }, reason: suggestion.reason, approval: 'user-confirmed-change', undo: { available: true, method: 'editor-history', description: '리플 삭제는 한 번의 실행 취소로 복원 · 채널 적용 피드백은 학습 초기화 전까지 유지' } })
    endAiActivity(activityId, { status: 'completed', changes: { summary: `${(suggestion.end - suggestion.start).toFixed(2)}초 구간 리플 삭제`, clips: tracksRef.current.flatMap((track) => track.clips).filter((clip) => clip.start < suggestion.end && clip.start + clip.duration > suggestion.start).length } })
    setPlayhead(suggestion.start)
    setSelectedClipId(undefined)
    setToast(`${suggestion.label} 구간을 제거했습니다.`)
  }, [activeSequenceId, beginAiActivity, commitEditor, commitRippleDelete, endAiActivity])

  const dismissSuggestion = useCallback((id: string) => {
    const target = suggestionsRef.current.find((suggestion) => suggestion.id === id)
    if (target) setCreatorLearningProfile((current) => recordSuggestionFeedback(current, target, 'dismissed'))
    commitEditor({ suggestions: (current) => current.map((suggestion) => suggestion.id === id ? { ...suggestion, status: 'dismissed' } : suggestion) })
    if (target) {
      const activityId = beginAiActivity({ operation: 'suggestion-dismiss', label: `AI 제안 유지 · ${target.label}`, processing: { location: 'local-device', processor: 'EditWeave creator feedback' }, input: { sequenceId: activeSequenceId, timeRange: { start: target.start, end: target.end }, dataCategories: ['AI 추천 점수', '추천 이유', '사용자 유지 결정'], summary: `${target.type} · ${Math.round(target.score * 100)}%` }, reason: target.reason, approval: 'user-confirmed-change', undo: { available: true, method: 'editor-history', description: '제안 상태는 실행 취소 가능 · 채널 기각 피드백은 학습 초기화 전까지 유지' } })
      endAiActivity(activityId, { status: 'completed', changes: { summary: 'AI 제안을 적용하지 않고 채널 기각 피드백에 반영' } })
    }
  }, [activeSequenceId, beginAiActivity, commitEditor, endAiActivity])

  const nestActiveClips = useCallback(() => {
    const selectedClips = tracks.flatMap((track) => track.clips.filter((clip) => selectedClipIds.has(clip.id)))
    if (selectedClips.length && tracks.some((track) => track.locked && track.clips.some((clip) => selectedClipIds.has(clip.id)))) {
      setToast('선택에 잠긴 트랙의 클립이 포함되어 중첩하지 않았습니다.')
      return
    }
    const activeClips = selectedClips.length
      ? selectedClips
      : tracks
      .filter((track) => !track.locked)
      .flatMap((track) => track.clips)
      .filter((clip) => playhead >= clip.start && playhead < clip.start + clip.duration)
    if (!activeClips.length) {
      setToast('재생 헤드에 겹친 잠금 해제 클립이 없습니다.')
      return
    }
    const nestedClipIds = new Set(activeClips.map((clip) => clip.id))
    const rangeStart = Math.min(...activeClips.map((clip) => clip.start))
    const rangeEnd = Math.max(...activeClips.map((clip) => clip.start + clip.duration))
    const overlapsUnselected = (track: TimelineTrack) => track.clips.some((clip) => !nestedClipIds.has(clip.id) && clip.start < rangeEnd && clip.start + clip.duration > rangeStart)
    let workingTracks = tracks
    let targetTrack = resolveSourceTargetTrack(workingTracks, 'video')
    if (!targetTrack) {
      setToast('중첩 클립을 놓을 V 소스 대상을 켜주세요.')
      return
    }
    if (targetTrack.locked) {
      setToast('중첩 클립 대상 트랙의 잠금을 해제해주세요.')
      return
    }
    if (overlapsUnselected(targetTrack)) {
      targetTrack = workingTracks.find((track) => track.kind === 'video' && !track.locked && !overlapsUnselected(track))
      if (!targetTrack) {
        const expanded = addTimelineTrack(workingTracks, 'video')
        targetTrack = expanded.find((track) => !workingTracks.some((candidate) => candidate.id === track.id))
        if (!targetTrack) {
          setToast('중첩 클립을 놓을 빈 비디오 트랙을 만들지 못했습니다.')
          return
        }
        workingTracks = assignSourceTarget(expanded, targetTrack.id)
      }
    }

    const nestedSequenceId = crypto.randomUUID()
    const nestedName = `중첩 시퀀스 ${sequenceLibrary.filter((sequence) => sequence.kind === 'nested').length + 1}`
    const mapTimeRange = <T extends { start: number; end: number },>(item: T): T => ({
      ...item,
      start: Math.max(0, item.start - rangeStart),
      end: Math.min(rangeEnd, item.end) - rangeStart,
    })
    const nestedTracks = tracks.flatMap((track) => {
      const childTrackId = `${nestedSequenceId}:${track.id}`
      const clips = track.clips
        .filter((clip) => nestedClipIds.has(clip.id))
        .map((clip) => ({ ...clip, id: crypto.randomUUID(), trackId: childTrackId, start: clip.start - rangeStart }))
      return clips.length ? [{ ...track, id: childTrackId, clips }] : []
    })
    const nestedTranscript = transcript
      .filter((segment) => segment.end > rangeStart && segment.start < rangeEnd)
      .map((segment) => ({
        ...mapTimeRange(segment),
        id: crypto.randomUUID(),
        words: segment.words?.filter((word) => word.end > rangeStart && word.start < rangeEnd).map((word) => mapTimeRange(word)),
      }))
    const nestedSuggestions = suggestions
      .filter((suggestion) => suggestion.end > rangeStart && suggestion.start < rangeEnd)
      .map((suggestion) => ({ ...mapTimeRange(suggestion), id: crypto.randomUUID() }))
    const nestedMarkers = markers
      .filter((marker) => marker.time >= rangeStart && marker.time < rangeEnd)
      .map((marker) => ({ ...marker, id: crypto.randomUUID(), time: marker.time - rangeStart }))
    const nestedSequence: ProjectSequence = {
      id: nestedSequenceId,
      name: nestedName,
      kind: 'nested',
      sourceSequenceId: activeSequenceId,
      sourceRange: { start: rangeStart, end: rangeEnd },
      aspectRatio,
      width: preset.width,
      height: preset.height,
      fps: sequenceLibrary.find((sequence) => sequence.id === activeSequenceId)?.fps ?? 30,
      timecodeStart: activeSequenceTimecodeStart + rangeStart,
      timecodeDropFrame: activeSequenceTimecodeDropFrame,
      transitionDefaults: structuredClone(activeTransitionDefaults),
      tracks: nestedTracks,
      transcript: nestedTranscript,
      suggestions: nestedSuggestions,
      markers: nestedMarkers,
      audioBuses,
      createdAt: new Date().toISOString(),
    }
    const nestedClip: TimelineClip = {
      id: crypto.randomUUID(),
      trackId: targetTrack.id,
      nestedSequenceId,
      name: nestedName,
      start: rangeStart,
      duration: rangeEnd - rangeStart,
      sourceOffset: 0,
      kind: 'video',
      color: '#6c5ce7',
      transform: { ...defaultTransform },
      playbackRate: 1,
    }
    const nextTracks = workingTracks.map((track) => ({
      ...track,
      clips: [
        ...track.clips.filter((clip) => !nestedClipIds.has(clip.id)),
        ...(track.id === targetTrack.id ? [nestedClip] : []),
      ].sort((a, b) => a.start - b.start),
    }))
    const parentSequence = { ...captureActiveSequence(), tracks: nextTracks }
    commitEditor({ tracks: () => nextTracks })
    setSequenceLibrary((items) => [
      ...items.map((sequence) => sequence.id === parentSequence.id ? parentSequence : sequence),
      nestedSequence,
    ])
    setSelectedTrackId(targetTrack.id)
    setSelectedClipId(nestedClip.id)
    setPlayhead(rangeStart)
    setToast(`${activeClips.length}개 클립을 “${nestedName}”으로 묶었습니다.`)
  }, [activeSequenceId, activeSequenceTimecodeDropFrame, activeSequenceTimecodeStart, activeTransitionDefaults, aspectRatio, audioBuses, captureActiveSequence, commitEditor, markers, playhead, preset.height, preset.width, selectedClipIds, sequenceLibrary, suggestions, tracks, transcript])

  const createMulticamAtPlayhead = useCallback(() => {
    const angles = tracks.flatMap((track) => track.kind !== 'video' || track.locked || track.muted || track.visible === false ? [] : track.clips
      .filter((clip) => !clip.adjustmentLayer && playhead >= clip.start && playhead < clip.start + clip.duration)
      .map((clip) => ({ track, clip })))
    if (angles.length < 2) {
      setToast('재생 헤드에 겹친 잠금 해제 비디오 클립이 2개 이상 필요합니다.')
      return
    }
    const sequenceId = crypto.randomUUID()
    const name = `멀티캠 ${sequenceLibrary.filter((sequence) => sequence.kind === 'multicam').length + 1}`
    const rangeStart = Math.min(...angles.map(({ clip }) => clip.start))
    const rangeEnd = Math.max(...angles.map(({ clip }) => clip.start + clip.duration))
    const linkedAudioAngles = angles.map(({ clip }) => {
      const detached = clip.linkGroupId ? tracks.flatMap((track) => track.kind !== 'audio' || track.locked ? [] : track.clips.filter((candidate) => candidate.linkGroupId === clip.linkGroupId).map((candidate) => ({ track, clip: candidate }))).find(Boolean) : undefined
      if (detached) return detached
      const asset = assets.find((candidate) => candidate.id === clip.assetId)
      return !clip.audioDisabled && (asset?.audioCodec || asset?.channels) ? { track: undefined, clip: { ...clip, kind: 'audio' as const } } : undefined
    })
    const angleIds = new Set([...angles.map(({ clip }) => clip.id), ...linkedAudioAngles.flatMap((item) => item?.track ? [item.clip.id] : [])])
    const angleTracks: TimelineTrack[] = angles.map(({ track, clip }, index) => {
      const trackId = `${sequenceId}:angle:${index}`
      return {
        ...track,
        id: trackId,
        name: `CAM ${index + 1} · ${clip.name}`,
        multicamAngleIndex: index,
        muted: false,
        visible: true,
        solo: false,
        clips: [{ ...clip, id: crypto.randomUUID(), trackId, start: clip.start - rangeStart, groupId: undefined, linkGroupId: undefined, audioDisabled: Boolean(linkedAudioAngles[index]) || clip.audioDisabled }],
      }
    })
    const audioAngleTracks: TimelineTrack[] = linkedAudioAngles.flatMap((item, index) => {
      if (!item) return []
      const trackId = `${sequenceId}:audio-angle:${index}`
      return [{
        ...(item.track ?? { kind: 'audio' as const, sourceTarget: false, editTarget: true, muted: false, locked: false, syncLock: true, volume: 100, pan: 0, visible: true, solo: false, clips: [] }),
        id: trackId,
        name: `CAM ${index + 1} AUDIO · ${item.clip.name}`,
        multicamAngleIndex: index,
        muted: false,
        solo: false,
        clips: [{ ...item.clip, id: crypto.randomUUID(), trackId, start: item.clip.start - rangeStart, groupId: undefined, linkGroupId: undefined }],
      }]
    })
    const multicamSequence: ProjectSequence = {
      id: sequenceId,
      name,
      kind: 'multicam',
      sourceSequenceId: activeSequenceId,
      sourceRange: { start: rangeStart, end: rangeEnd },
      aspectRatio,
      width: preset.width,
      height: preset.height,
      fps: sequenceLibrary.find((sequence) => sequence.id === activeSequenceId)?.fps ?? 30,
      timecodeStart: activeSequenceTimecodeStart + rangeStart,
      timecodeDropFrame: activeSequenceTimecodeDropFrame,
      transitionDefaults: structuredClone(activeTransitionDefaults),
      tracks: [...angleTracks, ...audioAngleTracks],
      transcript: [],
      suggestions: [],
      markers: [],
      audioBuses,
      createdAt: new Date().toISOString(),
    }
    const targetTrack = angles[0].track
    const multicamClip: TimelineClip = {
      id: crypto.randomUUID(),
      trackId: targetTrack.id,
      nestedSequenceId: sequenceId,
      multicamAngle: 0,
      multicamAudioMode: linkedAudioAngles[0] ? 'camera-1' : linkedAudioAngles.some(Boolean) ? 'selected-angle' : 'all',
      multicamAudioAngle: linkedAudioAngles[0] ? undefined : Math.max(0, linkedAudioAngles.findIndex(Boolean)),
      name,
      start: rangeStart,
      duration: rangeEnd - rangeStart,
      sourceOffset: 0,
      kind: 'video',
      color: '#b05bd3',
      transform: { ...defaultTransform },
      playbackRate: 1,
    }
    const nextTracks = tracks.map((track) => ({
      ...track,
      clips: [...track.clips.filter((clip) => !angleIds.has(clip.id)), ...(track.id === targetTrack.id ? [multicamClip] : [])].sort((a, b) => a.start - b.start),
    }))
    const parentSequence = { ...captureActiveSequence(), tracks: nextTracks }
    commitEditor({ tracks: () => nextTracks })
    setSequenceLibrary((items) => [...items.map((sequence) => sequence.id === parentSequence.id ? parentSequence : sequence), multicamSequence])
    setSelectedTrackId(targetTrack.id)
    setSelectedClipId(multicamClip.id)
    setPlayhead(rangeStart)
    setToast(`${angles.length}개 각도를 “${name}”으로 묶었습니다. 1–${Math.min(9, angles.length)} 키 또는 각도 버튼으로 전환할 수 있습니다.`)
  }, [activeSequenceId, activeSequenceTimecodeDropFrame, activeSequenceTimecodeStart, activeTransitionDefaults, aspectRatio, assets, audioBuses, captureActiveSequence, commitEditor, playhead, preset.height, preset.width, sequenceLibrary, tracks])

  const createMulticamFromAssets = useCallback((assetIds: string[], options: MulticamSourceOptions) => {
    const selectedAssets = assetIds.map((id) => assets.find((asset) => asset.id === id)).filter((asset): asset is MediaAsset => Boolean(asset && asset.kind === 'video' && !asset.parentAssetId))
    if (selectedAssets.length < 2) {
      setToast('멀티캠 소스 시퀀스에는 서로 다른 비디오 원본이 2개 이상 필요합니다.')
      return
    }
    const reference = selectedAssets[0]
    const rawShifts = selectedAssets.map((asset, index) => {
      if (index === 0 || options.syncMode === 'start') return { shift: 0, confidence: 1 }
      if (options.syncMode === 'timecode') return asset.timecodeStart !== undefined && reference.timecodeStart !== undefined ? { shift: asset.timecodeStart - reference.timecodeStart, confidence: 1 } : { shift: 0, confidence: 0 }
      const result = options.syncMode === 'clap' ? estimateClapSync(reference, asset) : estimateWaveformSync(reference, asset, Math.max(30, Math.min(600, Math.max(reference.duration, asset.duration))))
      return result ? { shift: result.timelineShift, confidence: result.confidence } : { shift: 0, confidence: 0 }
    })
    const earliestShift = Math.min(...rawShifts.map((item) => item.shift))
    const starts = rawShifts.map((item) => item.shift - earliestShift)
    const sequenceId = crypto.randomUUID()
    const existingNames = new Set(sequenceLibrary.map((sequence) => sequence.name))
    const requestedName = options.name.trim() || '멀티캠 소스'
    let name = requestedName
    let suffix = 2
    while (existingNames.has(name)) name = `${requestedName} ${suffix++}`
    const videoTracks: TimelineTrack[] = selectedAssets.map((asset, index) => {
      const trackId = `${sequenceId}:angle:${index}`
      const duration = interpretedSourceDuration(asset.duration, asset)
      return {
        id: trackId, name: `CAM ${index + 1} · ${asset.camera || asset.name}`, kind: 'video', sourceTarget: index === 0, editTarget: true,
        muted: false, locked: false, syncLock: true, visible: true, solo: false, compositePriority: index * 100, multicamAngleIndex: index, clips: [{
          id: crypto.randomUUID(), trackId, assetId: asset.id, name: asset.name, start: starts[index], duration, sourceOffset: 0, kind: 'video',
          color: asset.labelColor ?? '#7160e8', transform: { ...defaultTransform }, playbackRate: sourceFrameConformRate(asset), frameInterpolation: 'sampling',
          colorAdjustment: defaultColorAdjustment(), audioAdjustment: defaultAudioAdjustment(), audioDisabled: Boolean(asset.audioCodec || asset.channels),
        }],
      }
    })
    const audioTracks: TimelineTrack[] = selectedAssets.flatMap((asset, index) => {
      if (!asset.audioCodec && !asset.channels) return []
      const trackId = `${sequenceId}:audio-angle:${index}`
      const duration = interpretedSourceDuration(asset.duration, asset)
      return [{
        id: trackId, name: `CAM ${index + 1} AUDIO · ${asset.camera || asset.name}`, kind: 'audio' as const, sourceTarget: index === 0, editTarget: true,
        muted: false, locked: false, syncLock: true, visible: true, solo: false, volume: 100, pan: 0, audioRole: 'dialogue' as const, multicamAngleIndex: index, clips: [{
          id: crypto.randomUUID(), trackId, assetId: asset.id, name: `${asset.name} · 카메라 오디오`, start: starts[index], duration, sourceOffset: 0, kind: 'audio' as const,
          color: asset.labelColor ?? '#169676', transform: { ...defaultTransform }, playbackRate: sourceFrameConformRate(asset), audioAdjustment: { ...defaultAudioAdjustment(), role: 'dialogue' as const }, audioDisabled: false,
        }],
      }]
    })
    const sequenceDuration = Math.max(...videoTracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)))
    const absoluteStarts = selectedAssets.flatMap((asset) => asset.timecodeStart === undefined ? [] : [asset.timecodeStart])
    const multicamSequence: ProjectSequence = {
      id: sequenceId, name, kind: 'multicam', aspectRatio, width: preset.width, height: preset.height,
      fps: reference.sourceFrameRateOverride ?? reference.frameRate ?? activeSequenceFps,
      timecodeStart: options.syncMode === 'timecode' && absoluteStarts.length ? Math.min(...absoluteStarts) : activeSequenceTimecodeStart,
      timecodeDropFrame: options.syncMode === 'timecode' ? selectedAssets.some((asset) => asset.timecodeDropFrame) : activeSequenceTimecodeDropFrame,
      transitionDefaults: structuredClone(activeTransitionDefaults),
      tracks: [...videoTracks, ...audioTracks], transcript: [], suggestions: [], markers: [], audioBuses: defaultAudioBuses(), createdAt: new Date().toISOString(),
    }
    const currentSequence = captureActiveSequence()
    if (!options.placeOnTimeline) {
      setSequenceLibrary((sequences) => [...sequences.map((sequence) => sequence.id === currentSequence.id ? currentSequence : sequence), multicamSequence])
      const lowConfidence = rawShifts.filter((item) => item.confidence < .25).length
      setToast(`“${name}” 멀티캠 소스 시퀀스를 만들었습니다.${lowConfidence ? ` 동기화 신뢰도가 낮은 각도 ${lowConfidence}개는 시작점에 배치했습니다.` : ''}`)
      return
    }
    const targetTrack = resolveSourceTargetTrack(tracksRef.current, 'video')
    if (!targetTrack || targetTrack.locked) {
      setSequenceLibrary((sequences) => [...sequences.map((sequence) => sequence.id === currentSequence.id ? currentSequence : sequence), multicamSequence])
      setToast(`“${name}”을 만들었습니다. 배치할 잠금 해제 V 소스 대상 트랙이 없어 시퀀스만 저장했습니다.`)
      return
    }
    const multicamClip: TimelineClip = {
      id: crypto.randomUUID(), trackId: targetTrack.id, nestedSequenceId: sequenceId, multicamAngle: 0, multicamAudioMode: options.audioMode, multicamAudioAngle: options.audioAngle,
      name, start: playhead, duration: sequenceDuration, sourceOffset: 0, kind: 'video', color: '#b05bd3', transform: { ...defaultTransform }, playbackRate: 1,
    }
    const nextTracks = insertTimelineClip(tracksRef.current, targetTrack.id, multicamClip, 'overwrite')
    const parentSequence = { ...currentSequence, tracks: nextTracks }
    commitEditor({ tracks: () => nextTracks })
    setSequenceLibrary((sequences) => [...sequences.map((sequence) => sequence.id === parentSequence.id ? parentSequence : sequence), multicamSequence])
    setSelectedAssetId(undefined)
    setSelectedTrackId(targetTrack.id)
    setSelectedClipId(multicamClip.id)
    setSelectedClipIds(new Set([multicamClip.id]))
    const averageConfidence = rawShifts.reduce((sum, item) => sum + item.confidence, 0) / rawShifts.length
    setToast(`“${name}” 멀티캠 소스 생성 · ${selectedAssets.length}각도 · ${options.syncMode === 'timecode' ? '타임코드' : options.syncMode === 'waveform' ? `파형 ${Math.round(averageConfidence * 100)}%` : options.syncMode === 'clap' ? `클랩 ${Math.round(averageConfidence * 100)}%` : '시작점'} 동기화`)
  }, [activeSequenceFps, activeSequenceTimecodeDropFrame, activeSequenceTimecodeStart, activeTransitionDefaults, aspectRatio, assets, captureActiveSequence, commitEditor, playhead, preset.height, preset.width, sequenceLibrary])

  const switchMulticamAngle = useCallback((angle: number) => {
    if (!selectedClip?.nestedSequenceId || selectedClip.multicamAngle === undefined) {
      setToast('멀티캠 클립을 선택한 뒤 각도를 전환해주세요.')
      return
    }
    const sequence = sequenceLibrary.find((item) => item.id === selectedClip.nestedSequenceId && item.kind === 'multicam')
    const angleCount = sequence?.tracks.filter((track) => track.kind === 'video').length ?? 0
    if (angle < 0 || angle >= angleCount) {
      setToast(`선택한 멀티캠에는 ${angleCount}개 각도가 있습니다.`)
      return
    }
    const localTime = playhead - selectedClip.start
    const canCut = localTime > 1 / 30 && localTime < selectedClip.duration - 1 / 30
    if (!canCut) {
      updateClip(selectedClip.id, { multicamAngle: angle })
      setToast(`멀티캠 각도 ${angle + 1}로 변경했습니다.`)
      return
    }
    const rightId = crypto.randomUUID()
    commitTracks((current) => current.map((track) => ({
      ...track,
      clips: track.clips.flatMap((clip) => clip.id !== selectedClip.id ? [clip] : [
        { ...clip, duration: localTime, ...sliceClipSpeed(clip, 0, localTime), ...sliceClipAutomation(clip, 0, localTime), transitionOut: undefined, audioAdjustment: clip.audioAdjustment ? { ...clip.audioAdjustment, fadeOut: 0 } : undefined },
        { ...clip, id: rightId, start: playhead, duration: clip.duration - localTime, ...sliceClipSpeed(clip, localTime, clip.duration), ...sliceClipAutomation(clip, localTime, clip.duration), transitionIn: undefined, audioAdjustment: clip.audioAdjustment ? { ...clip.audioAdjustment, fadeIn: 0 } : undefined, multicamAngle: angle },
      ]).sort((a, b) => a.start - b.start),
    })))
    setSelectedClipId(rightId)
    setSelectedClipIds(new Set([rightId]))
    setToast(`재생 헤드에서 멀티캠 각도 ${angle + 1}로 컷했습니다.`)
  }, [commitTracks, playhead, selectedClip, sequenceLibrary, updateClip])

  const switchMulticamAudioAngle = useCallback((angle: number) => {
    if (!selectedClip?.nestedSequenceId || selectedClip.multicamAngle === undefined) {
      setToast('멀티캠 클립을 선택한 뒤 오디오 각도를 전환해주세요.')
      return
    }
    const sequence = sequenceLibrary.find((item) => item.id === selectedClip.nestedSequenceId && item.kind === 'multicam')
    const available = sequence?.tracks.some((track) => track.kind === 'audio' && track.multicamAngleIndex === angle)
    if (!available) {
      setToast(`CAM ${angle + 1}에는 전환할 오디오 트랙이 없습니다.`)
      return
    }
    const localTime = playhead - selectedClip.start
    const canCut = localTime > 1 / 30 && localTime < selectedClip.duration - 1 / 30
    if (!canCut) {
      updateClip(selectedClip.id, { multicamAudioMode: 'selected-angle', multicamAudioAngle: angle })
      setToast(`영상은 유지하고 CAM ${angle + 1} 오디오로 고정했습니다.`)
      return
    }
    const rightId = crypto.randomUUID()
    commitTracks((current) => current.map((track) => ({
      ...track,
      clips: track.clips.flatMap((clip) => clip.id !== selectedClip.id ? [clip] : [
        { ...clip, duration: localTime, ...sliceClipSpeed(clip, 0, localTime), ...sliceClipAutomation(clip, 0, localTime), transitionOut: undefined, audioAdjustment: clip.audioAdjustment ? { ...clip.audioAdjustment, fadeOut: 0 } : undefined },
        { ...clip, id: rightId, start: playhead, duration: clip.duration - localTime, ...sliceClipSpeed(clip, localTime, clip.duration), ...sliceClipAutomation(clip, localTime, clip.duration), transitionIn: undefined, audioAdjustment: clip.audioAdjustment ? { ...clip.audioAdjustment, fadeIn: 0 } : undefined, multicamAudioMode: 'selected-angle' as const, multicamAudioAngle: angle },
      ]).sort((left, right) => left.start - right.start),
    })))
    setSelectedClipId(rightId)
    setSelectedClipIds(new Set([rightId]))
    setToast(`재생 헤드에서 영상은 유지하고 CAM ${angle + 1} 오디오로 컷했습니다.`)
  }, [commitTracks, playhead, selectedClip, sequenceLibrary, updateClip])

  const applySynchronizedClipPositions = useCallback((referenceId: string, aligned: Array<{ id: string; nextStart: number }>) => {
    const positions = new Map(aligned.map((item) => [item.id, item.nextStart]))
    const movingIds = new Set(positions.keys())
    const proposed = tracksRef.current.flatMap((track) => track.clips.map((clip) => ({
      track,
      clip: positions.has(clip.id) ? { ...clip, start: positions.get(clip.id)! } : clip,
    })))
    const collision = proposed.some(({ track, clip }) => {
      if (!movingIds.has(clip.id)) return false
      return proposed.some(({ track: otherTrack, clip: other }) => other.id !== clip.id
        && otherTrack.id === track.id
        && other.start < clip.start + clip.duration - 1 / 240
        && other.start + other.duration > clip.start + 1 / 240)
    })
    if (collision) {
      setToast('동기화 위치가 같은 트랙의 다른 클립과 겹칩니다. 대상 클립을 별도 트랙으로 옮긴 뒤 다시 동기화해주세요.')
      return false
    }
    commitTracks((current) => current.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => positions.has(clip.id) ? { ...clip, start: positions.get(clip.id)! } : clip).sort((a, b) => a.start - b.start),
    })))
    setSelectedClipIds(new Set([referenceId, ...movingIds]))
    return true
  }, [commitTracks])

  const syncNearbyClipsByWaveform = useCallback(() => {
    if (!selectedClip?.assetId) {
      setToast('파형이 있는 기준 영상 또는 오디오 클립을 선택해주세요.')
      return
    }
    const referenceAsset = assets.find((asset) => asset.id === selectedClip.assetId)
    if (!referenceAsset?.waveform?.length) {
      setToast('선택 클립에 분석된 오디오 파형이 없습니다.')
      return
    }
    const explicitSelection = selectedClipIds.size >= 2 && selectedClipIds.has(selectedClip.id) ? selectedClipIds : undefined
    const candidates = tracks.filter((track) => !track.locked && (track.kind === 'video' || track.kind === 'audio')).flatMap((track) => track.clips)
      .filter((clip) => clip.id !== selectedClip.id && clip.assetId && !clip.adrCueId
        && (explicitSelection ? explicitSelection.has(clip.id) : Math.abs(clip.start - selectedClip.start) <= 60))
    const aligned = candidates.flatMap((clip) => {
      const targetAsset = assets.find((asset) => asset.id === clip.assetId)
      if (!targetAsset) return []
      const result = estimateWaveformSync(referenceAsset, targetAsset)
      if (!result || result.confidence < 0.25) return []
      const targetSourceAtStart = clipSourceTime(clip, clip.start)
      const nextStart = timelineTimeForClipSource(selectedClip, targetSourceAtStart + result.timelineShift)
      if (nextStart === undefined) return []
      return [{ id: clip.id, nextStart: Math.max(0, nextStart), confidence: result.confidence }]
    })
    if (!aligned.length) {
      setToast('신뢰할 수 있는 파형 동기화 지점을 찾지 못했습니다.')
      return
    }
    if (!applySynchronizedClipPositions(selectedClip.id, aligned)) return
    const averageConfidence = aligned.reduce((sum, item) => sum + item.confidence, 0) / aligned.length
    setToast(`${aligned.length}개 클립을 파형으로 동기화했습니다. 평균 신뢰도 ${Math.round(averageConfidence * 100)}%.`)
  }, [applySynchronizedClipPositions, assets, selectedClip, selectedClipIds, tracks])

  const syncNearbyClipsByClap = useCallback(() => {
    if (!selectedClip?.assetId) {
      setToast('클랩이 있는 기준 영상 또는 오디오 클립을 선택해주세요.')
      return
    }
    const referenceAsset = assets.find((asset) => asset.id === selectedClip.assetId)
    if (!referenceAsset?.waveform?.length) {
      setToast('선택 클립에 분석된 오디오 파형이 없습니다.')
      return
    }
    const referenceClap = estimateClapSync(referenceAsset, referenceAsset)
    if (!referenceClap) {
      setToast('기준 클립에서 뚜렷한 클랩 피크를 찾지 못했습니다.')
      return
    }
    const explicitSelection = selectedClipIds.size >= 2 && selectedClipIds.has(selectedClip.id) ? selectedClipIds : undefined
    const candidates = tracks.filter((track) => !track.locked && (track.kind === 'video' || track.kind === 'audio')).flatMap((track) => track.clips)
      .filter((clip) => clip.id !== selectedClip.id && clip.assetId && !clip.adrCueId
        && (explicitSelection ? explicitSelection.has(clip.id) : Math.abs(clip.start - selectedClip.start) <= 120))
    const aligned = candidates.flatMap((clip) => {
      const targetAsset = assets.find((asset) => asset.id === clip.assetId)
      if (!targetAsset) return []
      const result = estimateClapSync(referenceAsset, targetAsset)
      if (!result || result.confidence < 0.2) return []
      const targetSourceAtStart = clipSourceTime(clip, clip.start)
      const referenceTime = timelineTimeForClipSource(selectedClip, targetSourceAtStart + result.timelineShift)
      if (referenceTime === undefined) return []
      return [{ id: clip.id, nextStart: Math.max(0, referenceTime), confidence: result.confidence }]
    })
    if (!aligned.length) {
      setToast('클립 범위 안에서 함께 맞출 수 있는 클랩 피크를 찾지 못했습니다.')
      return
    }
    if (!applySynchronizedClipPositions(selectedClip.id, aligned)) return
    setToast(`${aligned.length}개 클립을 클랩 피크로 동기화했습니다.`)
  }, [applySynchronizedClipPositions, assets, selectedClip, selectedClipIds, tracks])

  const syncNearbyClipsByTimecode = useCallback(() => {
    if (!selectedClip?.assetId) {
      setToast('소스 타임코드가 있는 기준 클립을 선택해주세요.')
      return
    }
    const referenceAsset = assets.find((asset) => asset.id === selectedClip.assetId)
    if (referenceAsset?.timecodeStart === undefined) {
      setToast('미디어 정보에서 기준 자산의 시작 타임코드를 먼저 입력해주세요.')
      return
    }
    const explicitSelection = selectedClipIds.size >= 2 && selectedClipIds.has(selectedClip.id) ? selectedClipIds : undefined
    const candidates = tracks.filter((track) => !track.locked && (track.kind === 'video' || track.kind === 'audio')).flatMap((track) => track.clips)
      .filter((clip) => clip.id !== selectedClip.id && clip.assetId && !clip.adrCueId
        && (explicitSelection ? explicitSelection.has(clip.id) : true))
    const aligned = candidates.flatMap((clip) => {
      const targetAsset = assets.find((asset) => asset.id === clip.assetId)
      if (targetAsset?.timecodeStart === undefined) return []
      const targetAbsoluteAtStart = targetAsset.timecodeStart + clipSourceTime(clip, clip.start)
      const referenceSource = targetAbsoluteAtStart - referenceAsset.timecodeStart!
      const referenceTime = timelineTimeForClipSource(selectedClip, referenceSource)
      if (referenceTime === undefined) return []
      return [{ id: clip.id, nextStart: Math.max(0, referenceTime) }]
    })
    if (!aligned.length) {
      setToast('같은 타임코드 범위에서 맞출 수 있는 잠금 해제 클립이 없습니다.')
      return
    }
    if (!applySynchronizedClipPositions(selectedClip.id, aligned)) return
    setToast(`${aligned.length}개 클립을 소스 타임코드로 동기화했습니다.`)
  }, [applySynchronizedClipPositions, assets, selectedClip, selectedClipIds, tracks])

  const detachSelectedAudio = useCallback(() => {
    if (!selectedClip || selectedClip.kind !== 'video' || selectedClip.adjustmentLayer || selectedClip.nestedSequenceId || !selectedClip.assetId) {
      setToast('오디오가 포함된 일반 영상 클립을 선택해주세요.')
      return
    }
    if (selectedClip.audioDisabled) {
      setToast('이 영상 클립의 내장 오디오는 이미 분리되었거나 꺼져 있습니다.')
      return
    }
    const asset = assets.find((item) => item.id === selectedClip.assetId)
    if (!asset || asset.kind !== 'video' || asset.audioDecodable === false) {
      setToast('선택한 영상에서 사용할 수 있는 오디오를 찾지 못했습니다.')
      return
    }
    const rangeEnd = selectedClip.start + selectedClip.duration
    const available = (track: TimelineTrack) => track.kind === 'audio' && !track.locked && !track.clips.some((clip) => clip.start < rangeEnd && clip.start + clip.duration > selectedClip.start)
    let preparedTracks = tracks
    let audioTrack = [resolveSourceTargetTrack(tracks, 'audio'), ...tracks].find((track): track is TimelineTrack => Boolean(track && available(track)))
    if (!audioTrack) {
      preparedTracks = addTimelineTrack(tracks, 'audio')
      audioTrack = preparedTracks.find((track) => !tracks.some((candidate) => candidate.id === track.id))
    }
    if (!audioTrack) return
    const linkGroupId = selectedClip.linkGroupId ?? crypto.randomUUID()
    const audioClip: TimelineClip = {
      ...selectedClip,
      id: crypto.randomUUID(),
      trackId: audioTrack.id,
      name: `${selectedClip.name} · 오디오`,
      kind: 'audio',
      color: audioTrack.labelColor ?? '#169676',
      audioDisabled: false,
      visualEffects: undefined,
      colorAdjustment: undefined,
      transitionIn: { type: 'none', duration: 0 },
      transitionOut: { type: 'none', duration: 0 },
      keyframes: undefined,
      adjustmentLayer: false,
      nestedSequenceId: undefined,
      linkGroupId,
      audioAdjustment: { ...defaultAudioAdjustment(), ...selectedClip.audioAdjustment, role: audioTrack.audioRole ?? selectedClip.audioAdjustment?.role ?? 'dialogue' },
    }
    const targetedTracks = preparedTracks === tracks ? preparedTracks : assignSourceTarget(preparedTracks, audioTrack.id)
    commitTracks(() => targetedTracks.map((track) => {
      if (track.id === audioTrack.id) return { ...track, clips: [...track.clips, audioClip].sort((a, b) => a.start - b.start) }
      return { ...track, clips: track.clips.map((clip) => clip.id === selectedClip.id ? { ...clip, audioDisabled: true, linkGroupId } : clip) }
    }))
    setSelectedClipId(audioClip.id)
    setSelectedClipIds(new Set([selectedClip.id, audioClip.id]))
    setSelectedTrackId(audioTrack.id)
    setToast('내장 오디오를 연결된 오디오 클립으로 분리했습니다. 연결을 해제한 뒤 서로 다르게 트림하면 J/L 컷을 만들 수 있습니다.')
  }, [assets, commitTracks, selectedClip, tracks])

  const renderAndReplaceSelectedClip = useCallback(async () => {
    const sourceClip = tracksRef.current.flatMap((track) => track.clips).find((clip) => clip.id === selectedClipId)
    if (!sourceClip || sourceClip.kind !== 'video' || !sourceClip.assetId || sourceClip.adjustmentLayer || sourceClip.nestedSequenceId || sourceClip.renderReplacement) {
      setToast('일반 영상 클립을 선택해주세요. 이미 렌더 교체된 클립은 먼저 원본으로 복원해야 합니다.')
      return
    }
    if (sourceClip.trackMatte) {
      setToast('트랙 매트가 연결된 클립은 매트 소스를 중첩한 뒤 Render and Replace해주세요.')
      return
    }
    const sourceTrack = tracksRef.current.find((track) => track.clips.some((clip) => clip.id === sourceClip.id))
    if (!sourceTrack || sourceTrack.locked) {
      setToast('대상 트랙 잠금을 해제한 뒤 렌더 교체해주세요.')
      return
    }
    const originals = tracksRef.current.flatMap((track) => track.clips.filter((clip) => clip.id === sourceClip.id || Boolean(sourceClip.linkGroupId && clip.linkGroupId === sourceClip.linkGroupId && Math.abs(clip.start - sourceClip.start) <= 1 / 240 && Math.abs(clip.duration - sourceClip.duration) <= 1 / 240)))
    if (originals.some((clip) => clip.adrCueId)) {
      setToast('ADR 테이크가 연결된 클립은 세션 참조 보호를 위해 렌더 교체할 수 없습니다.')
      return
    }
    const originalIds = new Set(originals.map((clip) => clip.id))
    const renderTracks = tracksRef.current.map((track) => ({ ...track, muted: false, visible: true, clips: track.clips.filter((clip) => originalIds.has(clip.id)) })).filter((track) => track.clips.length)
    const includeAudio = originals.some((clip) => (clip.kind === 'audio' || clip.kind === 'video') && !clip.audioDisabled)
    const renderHeight = Math.max(16, Math.min(8_192, Math.round(Math.min(preset.width, preset.height))))
    const renderFps = Math.max(1, Math.min(240, activeSequenceFps))
    const controller = new AbortController()
    renderReplaceAbortRef.current?.abort()
    renderReplaceAbortRef.current = controller
    setRenderReplaceClipId(sourceClip.id)
    setRenderReplaceProgress(0)
    setRenderReplaceStage('렌더 준비')
    setToast('선택 클립 Render and Replace를 시작했습니다.')
    try {
      const result = await exportSequence({
        projectName: `${projectName}-${sourceClip.name}-rendered`,
        preset,
        height: renderHeight,
        fps: renderFps,
        codec: 'avc',
        allowCodecFallback: true,
        colorMode: 'sdr',
        includeAudio,
        assets: assetsRef.current,
        tracks: renderTracks,
        audioBuses: audioBusesRef.current,
        rangeStart: sourceClip.start,
        rangeEnd: sourceClip.start + sourceClip.duration,
        signal: controller.signal,
        onProgress: (progress, stage) => {
          setRenderReplaceProgress(progress)
          setRenderReplaceStage(stage)
        },
      })
      if (controller.signal.aborted) throw new DOMException('Render and Replace cancelled', 'AbortError')
      if (!result.buffer) throw new Error('렌더 교체용 출력 버퍼를 만들지 못했습니다.')
      const renderedAssetId = crypto.randomUUID()
      const safeName = sourceClip.name.replace(/[<>:"/\\|?*]+/g, '-').replace(/\.[^.]+$/, '') || 'clip'
      const file = new File([result.buffer], `${safeName}.rendered.mp4`, { type: result.mimeType || 'video/mp4', lastModified: Date.now() })
      setRenderReplaceStage('렌더 파일 저장')
      const persisted = await persistVoiceoverRecording(projectId, file)
      if (controller.signal.aborted) throw new DOMException('Render and Replace cancelled', 'AbortError')
      const sourcePath = (persisted as File & { __editweaveSourcePath?: string }).__editweaveSourcePath
      const renderedAsset: MediaAsset = {
        id: renderedAssetId,
        name: persisted.name,
        kind: 'video',
        url: URL.createObjectURL(persisted),
        sourceFile: persisted,
        sourcePath,
        duration: sourceClip.duration,
        size: persisted.size,
        extension: 'mp4',
        width: result.width,
        height: result.height,
        videoCodec: result.actualCodec,
        videoDecodable: true,
        audioCodec: includeAudio ? 'aac' : undefined,
        audioDecodable: includeAudio ? true : undefined,
        sampleRate: includeAudio ? 48_000 : undefined,
        channels: includeAudio ? 2 : undefined,
        status: 'ready',
        importedAt: new Date().toISOString(),
        folder: 'Render and Replace',
        tags: ['렌더 교체', '생성 미디어'],
      }
      const replacement: TimelineClip = {
        ...sourceClip,
        assetId: renderedAssetId,
        subclipId: undefined,
        name: `${sourceClip.name} · 렌더 교체`,
        sourceOffset: 0,
        playbackRate: 1,
        speedKeyframes: undefined,
        frameInterpolation: 'sampling',
        reverse: false,
        freezeFrame: false,
        freezeFrameSourceTime: undefined,
        transform: { ...defaultTransform },
        keyframes: undefined,
        compositePriority: undefined,
        trackMatte: undefined,
        effectStack: undefined,
        colorAdjustment: defaultColorAdjustment(),
        visualEffects: defaultVisualEffects(),
        visualKeyframes: undefined,
        audioAdjustment: defaultAudioAdjustment(),
        audioMixKeyframes: undefined,
        audioDisabled: !includeAudio,
        transitionIn: sourceClip.transitionIn,
        transitionOut: sourceClip.transitionOut,
        linkGroupId: undefined,
        renderReplacement: {
          originalClipsJson: JSON.stringify(originals),
          originalAssetIds: [...new Set(originals.flatMap((clip) => [clip.assetId, clip.subclipId].filter((id): id is string => Boolean(id))))],
          renderedAssetId,
          createdAt: new Date().toISOString(),
        },
      }
      assetsRef.current = [...assetsRef.current, renderedAsset]
      setAssets(assetsRef.current)
      commitTracks((current) => current.map((track) => ({
        ...track,
        clips: [...track.clips.filter((clip) => !originalIds.has(clip.id)), ...(track.id === sourceTrack.id ? [replacement] : [])].sort((left, right) => left.start - right.start),
      })))
      setSelectedClipId(replacement.id)
      setSelectedClipIds(new Set([replacement.id]))
      setToast(`“${sourceClip.name}”의 효과와 연결 오디오를 렌더 파일로 교체했습니다.`)
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) setToast('Render and Replace를 취소했습니다. 원본 클립은 변경되지 않았습니다.')
      else setToast(error instanceof Error ? `Render and Replace 실패: ${error.message}` : 'Render and Replace에 실패했습니다.')
    } finally {
      if (renderReplaceAbortRef.current === controller) {
        renderReplaceAbortRef.current = undefined
        setRenderReplaceClipId(undefined)
        setRenderReplaceProgress(0)
        setRenderReplaceStage('준비')
      }
    }
  }, [activeSequenceFps, commitTracks, preset, projectId, projectName, selectedClipId])

  const cancelRenderAndReplace = useCallback(() => {
    const controller = renderReplaceAbortRef.current
    if (!controller) return
    setRenderReplaceStage('취소 중')
    controller.abort()
  }, [])

  const restoreRenderAndReplaceClip = useCallback(() => {
    const replacement = tracksRef.current.flatMap((track) => track.clips).find((clip) => clip.id === selectedClipId)
    if (!replacement?.renderReplacement) {
      setToast('원본으로 복원할 렌더 교체 클립을 선택해주세요.')
      return
    }
    let originals: TimelineClip[]
    try {
      const parsed: unknown = JSON.parse(replacement.renderReplacement.originalClipsJson)
      if (!Array.isArray(parsed) || !parsed.length) throw new Error('원본 클립 스냅샷이 비어 있습니다.')
      originals = parsed as TimelineClip[]
    } catch (error) {
      setToast(error instanceof Error ? `원본 복원 실패: ${error.message}` : '원본 클립 스냅샷을 읽지 못했습니다.')
      return
    }
    commitTracks((current) => current.map((track) => ({
      ...track,
      clips: [...track.clips.filter((clip) => clip.id !== replacement.id), ...originals.filter((clip) => clip.trackId === track.id)].sort((left, right) => left.start - right.start),
    })))
    const primary = originals.find((clip) => clip.kind === 'video') ?? originals[0]
    setSelectedClipId(primary.id)
    setSelectedClipIds(new Set(originals.map((clip) => clip.id)))
    setSelectedTrackId(primary.trackId)
    setToast('렌더 교체 전 원본 클립·효과·키프레임·연결 오디오를 복원했습니다. 렌더 파일은 프로젝트 미디어에 유지됩니다.')
  }, [commitTracks, selectedClipId])

  const removeAsset = useCallback(async (assetId: string) => {
    const asset = assetsRef.current.find((item) => item.id === assetId)
    if (!asset) return
    const removedAssetIds = new Set([assetId, ...assetsRef.current.filter((item) => item.parentAssetId === assetId).map((item) => item.id)])
    const current = captureActiveSequence()
    const materializedSequences = sequenceLibrary.map((sequence) => sequence.id === current.id ? current : sequence)
    const removal = removeAssetReferencesFromSequences(materializedSequences, removedAssetIds)
    const clipReferences = removal.removedClipCount
    const renderRecoveryReferences = removal.committedRenderReplacementCount
    const affectedRenderJobs = renderJobs.filter((job) => [...renderJobSnapshotAssetIds(job)].some((id) => removedAssetIds.has(id)))
    const activeRenderReferences = affectedRenderJobs.filter((job) => job.status === 'running' || job.status === 'paused')
    if (activeRenderReferences.length) {
      setToast(`이 미디어를 사용하는 렌더 작업 ${activeRenderReferences.length}개가 실행 중입니다. 작업을 취소하거나 완료한 뒤 제거해주세요.`)
      return
    }
    const invalidatedRenderJobs = affectedRenderJobs.filter((job) => job.status !== 'completed' && job.status !== 'cancelled')
    const adrReferences = adrCues.reduce((count, cue) => count + cue.takes.filter((take) => removedAssetIds.has(take.assetId)).length, 0)
    if (adrReferences) {
      setToast(`이 미디어는 ADR 테이크 ${adrReferences}개에서 사용 중입니다. ADR 세션에서 해당 테이크를 먼저 삭제해주세요.`)
      return
    }
    const renderQueueNotice = invalidatedRenderJobs.length ? ` 렌더 큐 작업 ${invalidatedRenderJobs.length}개는 참조 미디어 누락으로 실패 처리됩니다.` : ''
    const confirmation = clipReferences
      ? `“${asset.name}”을 프로젝트에서 제거할까요? 전체 시퀀스의 해당 클립 ${clipReferences}개도 함께 제거되며${renderRecoveryReferences ? ` Render & Replace 복원 기록 ${renderRecoveryReferences}개는 현재 렌더 결과로 확정됩니다.` : ''}${renderQueueNotice} 원본 파일은 삭제하지 않습니다.`
      : `프로젝트에서 “${asset.name}”을 제거할까요?${renderRecoveryReferences ? ` Render & Replace 복원 기록 ${renderRecoveryReferences}개는 현재 렌더 결과로 확정됩니다.` : ''}${renderQueueNotice} 원본 파일은 삭제하지 않습니다.`
    if (!window.confirm(confirmation)) return
    if (clipReferences || renderRecoveryReferences) {
      const nextSequences = removal.sequences
      const nextActive = nextSequences.find((sequence) => sequence.id === activeSequenceId)
      setSequenceLibrary(nextSequences)
      if (nextActive) {
        tracksRef.current = nextActive.tracks
        setTracks(nextActive.tracks)
      }
      setSelectedClipId(undefined)
      setPast([])
      setFuture([])
    }
    if (!asset.parentAssetId) {
      await deleteProxyFile(asset.proxyCachePath).catch(() => undefined)
      if (asset.tags?.includes('생성 미디어')) await deleteVoiceoverRecording(asset.sourcePath).catch(() => undefined)
      releaseImageSequenceUrls(asset)
      releaseObjectUrl(asset.url)
      releaseObjectUrl(asset.proxyUrl)
    }
    const nextAssets = assetsRef.current.filter((item) => !removedAssetIds.has(item.id))
    assetsRef.current = nextAssets
    setAssets(nextAssets)
    if (invalidatedRenderJobs.length) {
      const invalidatedIds = new Set(invalidatedRenderJobs.map((job) => job.id))
      setRenderJobs((jobs) => jobs.map((job) => invalidatedIds.has(job.id) ? { ...job, status: 'failed', stage: '참조 미디어가 프로젝트에서 제거됨', error: `“${asset.name}” 원본이 제거되어 이 스냅샷을 출력할 수 없습니다.`, updatedAt: new Date().toISOString() } : job))
    }
    setSelectedAssetId(undefined)
    setToast(clipReferences
      ? `프로젝트 미디어와 전체 시퀀스의 해당 클립 ${clipReferences}개를 제거했습니다.${renderRecoveryReferences ? ` 렌더 교체 복원 ${renderRecoveryReferences}개 확정.` : ''}${invalidatedRenderJobs.length ? ` 렌더 작업 ${invalidatedRenderJobs.length}개 실패 처리.` : ''} 원본 파일은 유지됩니다.`
      : `프로젝트에서 미디어를 제거했습니다.${renderRecoveryReferences ? ` 렌더 교체 복원 ${renderRecoveryReferences}개를 현재 결과로 확정했습니다.` : ''}${invalidatedRenderJobs.length ? ` 렌더 작업 ${invalidatedRenderJobs.length}개 실패 처리.` : ''} 원본 파일은 유지됩니다.`)
  }, [activeSequenceId, adrCues, captureActiveSequence, renderJobs, sequenceLibrary])

  const makeAssetOffline = useCallback((assetId: string) => {
    const requested = assetsRef.current.find((asset) => asset.id === assetId)
    const root = requested?.parentAssetId ? assetsRef.current.find((asset) => asset.id === requested.parentAssetId) : requested
    if (!root || root.status === 'offline') return
    const proxyAvailable = root.proxyStatus === 'ready' && Boolean(root.proxyFile || root.proxyCachePath || root.proxySourcePath)
    if (!window.confirm(`“${root.name}”의 원본 연결만 해제할까요? 타임라인 클립·효과·메타데이터${proxyAvailable ? '와 편집 프록시' : ''}는 유지되며 나중에 다시 연결할 수 있습니다.`)) return
    releaseImageSequenceUrls(root)
    releaseObjectUrl(root.url)
    assetsRef.current = assetsRef.current.map((asset) => asset.id === root.id ? {
      ...asset,
      sourceFile: undefined,
      imageSequenceFiles: undefined,
      imageSequenceUrls: undefined,
      url: '',
      status: 'offline',
      error: '원본 미디어 연결이 해제되었습니다. 파일 연결 또는 폴더 Relink로 다시 연결하세요.',
      useProxy: proxyAvailable,
    } : asset)
    setAssets(assetsRef.current)
    setToast(proxyAvailable ? '원본을 오프라인으로 전환했습니다. 타임라인은 편집 프록시로 계속 재생됩니다.' : '원본을 오프라인으로 전환했습니다. 타임라인 편집은 유지되며 파일 연결로 복구할 수 있습니다.')
  }, [])

  const removeAssets = useCallback(async (assetIds: string[]) => {
    const requested = new Set(assetIds)
    if (!requested.size) return
    const existing = assetsRef.current.filter((asset) => requested.has(asset.id))
    if (!existing.length) return
    const removedAssetIds = new Set(existing.flatMap((asset) => [asset.id, ...assetsRef.current.filter((candidate) => candidate.parentAssetId === asset.id).map((candidate) => candidate.id)]))
    const adrReferences = adrCues.reduce((count, cue) => count + cue.takes.filter((take) => removedAssetIds.has(take.assetId)).length, 0)
    if (adrReferences) {
      setToast(`선택 미디어 중 ADR 테이크 ${adrReferences}개가 참조하는 원본이 있습니다. ADR 세션에서 해당 테이크를 먼저 삭제해주세요.`)
      return
    }
    const current = captureActiveSequence()
    const materializedSequences = sequenceLibrary.map((sequence) => sequence.id === current.id ? current : sequence)
    const removal = removeAssetReferencesFromSequences(materializedSequences, removedAssetIds)
    const clipReferences = removal.removedClipCount
    const renderRecoveryReferences = removal.committedRenderReplacementCount
    const affectedRenderJobs = renderJobs.filter((job) => [...renderJobSnapshotAssetIds(job)].some((id) => removedAssetIds.has(id)))
    const activeRenderReferences = affectedRenderJobs.filter((job) => job.status === 'running' || job.status === 'paused')
    if (activeRenderReferences.length) {
      setToast(`선택 미디어를 사용하는 렌더 작업 ${activeRenderReferences.length}개가 실행 중입니다. 작업을 취소하거나 완료한 뒤 제거해주세요.`)
      return
    }
    const invalidatedRenderJobs = affectedRenderJobs.filter((job) => job.status !== 'completed' && job.status !== 'cancelled')
    const generatedRootCount = existing.filter((asset) => !asset.parentAssetId && asset.tags?.includes('생성 미디어')).length
    const diskNotice = generatedRootCount ? ` 앱에서 만든 전용 파일 ${generatedRootCount}개는 디스크에서도 삭제됩니다.` : ' 디스크 원본은 유지됩니다.'
    const renderQueueNotice = invalidatedRenderJobs.length ? ` 렌더 큐 작업 ${invalidatedRenderJobs.length}개는 참조 미디어 누락으로 실패 처리됩니다.` : ''
    const confirmation = clipReferences
      ? `선택한 프로젝트 미디어 ${existing.length}개를 제거할까요? 전체 시퀀스의 참조 클립 ${clipReferences}개도 함께 제거됩니다.${renderRecoveryReferences ? ` Render & Replace 복원 기록 ${renderRecoveryReferences}개는 현재 렌더 결과로 확정됩니다.` : ''}${renderQueueNotice}${diskNotice}`
      : `선택한 프로젝트 미디어 ${existing.length}개를 제거할까요?${renderRecoveryReferences ? ` Render & Replace 복원 기록 ${renderRecoveryReferences}개는 현재 렌더 결과로 확정됩니다.` : ''}${renderQueueNotice}${diskNotice}`
    if (!window.confirm(confirmation)) return
    const nextSequences = removal.sequences
    const nextActive = nextSequences.find((sequence) => sequence.id === activeSequenceId)
    setSequenceLibrary(nextSequences)
    if (nextActive) {
      tracksRef.current = nextActive.tracks
      setTracks(nextActive.tracks)
    }
    const rootAssets = assetsRef.current.filter((asset) => removedAssetIds.has(asset.id) && !asset.parentAssetId)
    rootAssets.forEach((asset) => {
      releaseImageSequenceUrls(asset)
      releaseObjectUrl(asset.url)
      releaseObjectUrl(asset.proxyUrl)
    })
    await Promise.all(rootAssets.flatMap((asset) => [deleteProxyFile(asset.proxyCachePath).catch(() => undefined), ...(asset.tags?.includes('생성 미디어') ? [deleteVoiceoverRecording(asset.sourcePath).catch(() => undefined)] : [])]))
    const nextAssets = assetsRef.current.filter((asset) => !removedAssetIds.has(asset.id))
    assetsRef.current = nextAssets
    setAssets(nextAssets)
    if (invalidatedRenderJobs.length) {
      const invalidatedIds = new Set(invalidatedRenderJobs.map((job) => job.id))
      const removedNames = existing.slice(0, 3).map((asset) => asset.name).join(', ')
      setRenderJobs((jobs) => jobs.map((job) => invalidatedIds.has(job.id) ? { ...job, status: 'failed', stage: '참조 미디어가 프로젝트에서 제거됨', error: `${removedNames}${existing.length > 3 ? ` 외 ${existing.length - 3}개` : ''} 원본이 제거되어 이 스냅샷을 출력할 수 없습니다.`, updatedAt: new Date().toISOString() } : job))
    }
    setSelectedAssetId(undefined)
    setSelectedClipId(undefined)
    setPast([])
    setFuture([])
    setToast(`프로젝트 미디어 ${existing.length}개${removedAssetIds.size > existing.length ? `와 서브클립 ${removedAssetIds.size - existing.length}개` : ''}를 제거했습니다.${clipReferences ? ` 참조 클립 ${clipReferences}개 제거.` : ''}${renderRecoveryReferences ? ` 렌더 교체 복원 ${renderRecoveryReferences}개 확정.` : ''}${invalidatedRenderJobs.length ? ` 렌더 작업 ${invalidatedRenderJobs.length}개 실패 처리.` : ''} 디스크 원본은 유지됩니다.`)
  }, [activeSequenceId, adrCues, captureActiveSequence, renderJobs, sequenceLibrary])

  const removeUnusedAssets = useCallback(() => {
    const current = captureActiveSequence()
    const sequences = sequenceLibrary.map((sequence) => sequence.id === current.id ? current : sequence)
    const usedIds = new Set([
      ...sequences.flatMap((sequence) => sequence.tracks.flatMap((track) => track.clips.flatMap((clip) => [...[clip.assetId, clip.subclipId].filter((id): id is string => Boolean(id)), ...renderReplacementSourceAssetIds(clip)]))),
      ...adrCues.flatMap((cue) => cue.takes.map((take) => take.assetId)),
      ...queuedRenderAssetIds,
    ])
    const unusedIds = assetsRef.current.filter((asset) => !usedIds.has(asset.id) && (!asset.parentAssetId || !usedIds.has(asset.parentAssetId))).map((asset) => asset.id)
    if (!unusedIds.length) {
      setToast('전체 시퀀스·ADR·렌더 큐에서 사용하지 않는 프로젝트 미디어가 없습니다.')
      return
    }
    void removeAssets(unusedIds)
  }, [adrCues, captureActiveSequence, queuedRenderAssetIds, removeAssets, sequenceLibrary])

  const loadSequence = useCallback((sequence: ProjectSequence) => {
    const normalizedTracks = normalizeSourceTargets(sequence.tracks)
    const sequenceDuration = Math.max(0, ...normalizedTracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)))
    setActiveSequenceId(sequence.id)
    setAspectRatio(sequence.aspectRatio)
    setTracks(normalizedTracks)
    setTranscript(sequence.transcript)
    setSuggestions(sequence.suggestions)
    setMarkers(sequence.markers ?? [])
    const nextAudioBuses = normalizeAudioBuses(sequence.audioBuses)
    setAudioBuses(nextAudioBuses)
    setSequenceWorkArea(sequence.workArea)
    setSequenceLoopPlayback(Boolean(sequence.loopPlayback))
    tracksRef.current = normalizedTracks
    transcriptRef.current = sequence.transcript
    suggestionsRef.current = sequence.suggestions
    markersRef.current = sequence.markers ?? []
    audioBusesRef.current = nextAudioBuses
    setPast([])
    setFuture([])
    setSelectedAssetId(undefined)
    setSelectedTranscriptId(undefined)
    setSelectedClipId(undefined)
    setSelectedClipIds(new Set())
    setSelectedTrackId(resolveSourceTargetTrack(normalizedTracks, 'video')?.id ?? normalizedTracks[0]?.id)
    setPlayhead(clamp(sequence.playhead ?? 0, 0, sequenceDuration))
    setIsPlaying(false)
  }, [])

  const switchSequence = useCallback((id: string) => {
    if (id === activeSequenceId) return
    const target = sequenceLibrary.find((sequence) => sequence.id === id)
    if (!target) return
    const current = captureActiveSequence()
    setSequenceLibrary((items) => items.map((sequence) => sequence.id === current.id ? current : sequence))
    loadSequence(target)
    setToast(`${target.name} 시퀀스로 전환했습니다.`)
  }, [activeSequenceId, captureActiveSequence, loadSequence, sequenceLibrary])

  const openNestedSequence = useCallback((id: string) => {
    if (id === activeSequenceId) return
    const target = sequenceLibrary.find((sequence) => sequence.id === id)
    if (!target) return
    const candidates = tracks.flatMap((track) => track.clips).filter((clip) => clip.nestedSequenceId === id)
    const sourceClip = candidates.find((clip) => clip.id === selectedClipId)
      ?? candidates.find((clip) => playhead >= clip.start && playhead <= clip.start + clip.duration)
      ?? candidates[0]
    const nestedTime = sourceClip
      ? clipSourceTime(sourceClip, clamp(playhead, sourceClip.start, sourceClip.start + sourceClip.duration))
      : target.playhead ?? 0
    const current = captureActiveSequence()
    setSequenceLibrary((items) => items.map((sequence) => sequence.id === current.id ? current : sequence))
    loadSequence({ ...target, playhead: nestedTime })
    setToast(`${target.name} 내부 ${formatTimecode(nestedTime, true, target.fps)}로 들어갔습니다.`)
  }, [activeSequenceId, captureActiveSequence, loadSequence, playhead, selectedClipId, sequenceLibrary, tracks])

  const returnToSourceSequence = useCallback(() => {
    const currentMetadata = sequenceLibrary.find((sequence) => sequence.id === activeSequenceId)
    const parent = currentMetadata?.sourceSequenceId ? sequenceLibrary.find((sequence) => sequence.id === currentMetadata.sourceSequenceId) : undefined
    if (!currentMetadata || !parent) return
    const parentClip = parent.tracks.flatMap((track) => track.clips).find((clip) => clip.nestedSequenceId === currentMetadata.id)
    const parentTime = parentClip ? nestedOutputTime(parentClip, playhead) : parent.playhead ?? 0
    const current = captureActiveSequence()
    setSequenceLibrary((items) => items.map((sequence) => sequence.id === current.id ? current : sequence))
    loadSequence({ ...parent, playhead: parentTime })
    if (parentClip) {
      setSelectedClipId(parentClip.id)
      setSelectedClipIds(new Set([parentClip.id]))
      setSelectedTrackId(parentClip.trackId)
    }
    setToast(`${parent.name} · ${formatTimecode(parentTime, true, parent.fps)}로 돌아갔습니다.`)
  }, [activeSequenceId, captureActiveSequence, loadSequence, playhead, sequenceLibrary])

  const revealAssetUse = useCallback((assetId: string) => {
    const asset = assetsRef.current.find((candidate) => candidate.id === assetId)
    if (!asset) return
    const current = captureActiveSequence()
    const materialized = sequenceLibrary.map((sequence) => sequence.id === current.id ? current : sequence)
    const ordered = [...materialized].sort((left, right) => Number(right.id === activeSequenceId) - Number(left.id === activeSequenceId))
    const usage = ordered.flatMap((sequence) => sequence.tracks.flatMap((track) => track.clips.flatMap((clip) => {
      const matches = asset.parentAssetId ? clip.subclipId === asset.id : clip.assetId === asset.id || Boolean(clip.subclipId && assetsRef.current.find((candidate) => candidate.id === clip.subclipId)?.parentAssetId === asset.id)
      return matches ? [{ sequence, track, clip }] : []
    })))[0]
    if (!usage) {
      setToast(`“${asset.name}”을 사용하는 타임라인 클립이 없습니다.`)
      return
    }
    setSequenceLibrary(materialized)
    if (usage.sequence.id !== activeSequenceId) loadSequence(usage.sequence)
    setSelectedAssetId(undefined)
    setSelectedClipId(usage.clip.id)
    setSelectedClipIds(new Set([usage.clip.id]))
    setSelectedTrackId(usage.track.id)
    setPlayhead(usage.clip.start)
    setToast(`“${usage.sequence.name}”의 ${usage.track.name} · ${formatTimecode(usage.clip.start, true, usage.sequence.fps)}에서 사용 중입니다.`)
  }, [activeSequenceId, captureActiveSequence, loadSequence, sequenceLibrary])

  const revealMediaPath = useCallback((path: string) => {
    void revealMediaInFileManager(path)
      .then(() => setToast(`파일 관리자에서 ${path.split(/[\\/]/).pop() ?? '미디어'} 위치를 열었습니다.`))
      .catch((error: unknown) => setToast(error instanceof Error ? error.message : '미디어 파일 위치를 열지 못했습니다.'))
  }, [])

  const copyMediaPath = useCallback((path: string) => {
    void navigator.clipboard.writeText(path)
      .then(() => setToast('미디어 경로를 클립보드에 복사했습니다.'))
      .catch(() => setToast('미디어 경로를 클립보드에 복사하지 못했습니다.'))
  }, [])

  const sequenceRuntimeBlockers = useCallback((sequenceId: string): string[] => {
    const blockers: string[] = []
    const pendingJobs = renderJobs.filter((job) => job.projectId === projectId
      && job.status !== 'completed'
      && job.status !== 'cancelled'
      && (job.sequenceId === sequenceId || job.sequenceIds?.includes(sequenceId)))
    if (pendingJobs.length) blockers.push(`대기·진행·재시도 가능한 렌더 작업 ${pendingJobs.length}개가 참조 중입니다.`)
    if (isExporting && activeSequenceId === sequenceId) blockers.push('현재 이 시퀀스를 출력 중입니다.')
    if (lanReviewSession?.sequenceId === sequenceId) blockers.push('활성 LAN 검토 세션이 연결되어 있습니다.')
    if (voiceoverOpen && activeSequenceId === sequenceId) blockers.push('ADR·보이스오버 창이 이 시퀀스를 사용 중입니다.')
    return blockers
  }, [activeSequenceId, isExporting, lanReviewSession?.sequenceId, projectId, renderJobs, voiceoverOpen])

  const liveSequenceLibrary = useMemo(() => {
    const current = captureActiveSequence()
    return sequenceLibrary.map((sequence) => sequence.id === current.id ? current : sequence)
  }, [captureActiveSequence, sequenceLibrary])

  const sequenceDeleteAssessments = useMemo(() => liveSequenceLibrary.map((sequence) => inspectSequenceDeletion({
    sequences: liveSequenceLibrary,
    adrCues,
    mergeSessions,
    targetSequenceId: sequence.id,
    runtimeBlockers: sequenceRuntimeBlockers(sequence.id),
  })), [adrCues, liveSequenceLibrary, mergeSessions, sequenceRuntimeBlockers])

  const renameSequence = useCallback((sequenceId: string, name: string): boolean => {
    try {
      const current = captureActiveSequence()
      const materialized = sequenceLibrary.map((sequence) => sequence.id === current.id ? current : sequence)
      const renamed = renameProjectSequence(materialized, sequenceId, name)
      const active = renamed.find((sequence) => sequence.id === activeSequenceId)
      setSequenceLibrary(renamed)
      if (active) {
        tracksRef.current = active.tracks
        setTracks(active.tracks)
      }
      setToast(`시퀀스 이름을 “${renamed.find((sequence) => sequence.id === sequenceId)?.name}”(으)로 변경했습니다.`)
      return true
    } catch (error) {
      setToast(error instanceof Error ? error.message : '시퀀스 이름을 변경하지 못했습니다.')
      return false
    }
  }, [activeSequenceId, captureActiveSequence, sequenceLibrary])

  const duplicateSequence = useCallback((sequenceId: string) => {
    try {
      const current = captureActiveSequence()
      const materialized = sequenceLibrary.map((sequence) => sequence.id === current.id ? current : sequence)
      const duplicated = duplicateProjectSequence({ sourceSequenceId: sequenceId, sequences: materialized, adrCues, availableAssetIds: new Set(assetsRef.current.map((asset) => asset.id)) })
      setSequenceLibrary([...materialized, duplicated.sequence])
      updateAdrCues((cues) => [...cues, ...duplicated.adrCues])
      loadSequence(duplicated.sequence)
      setToast(`“${duplicated.sequence.name}”을 만들었습니다. ADR ${duplicated.adrCues.length}개를 독립 복제하고 미디어 원본은 공유합니다.`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '시퀀스를 복제하지 못했습니다.')
    }
  }, [adrCues, captureActiveSequence, loadSequence, sequenceLibrary, updateAdrCues])

  const createBlankSequence = useCallback((settings: SequenceCreateSettings) => {
    const current = captureActiveSequence()
    const materialized = sequenceLibrary.map((sequence) => sequence.id === current.id ? current : sequence)
    const sequenceNumber = materialized.filter((sequence) => sequence.kind === 'main').length + 1
    const baseName = settings.name.trim() || `시퀀스 ${sequenceNumber}`
    let name = baseName
    let suffix = 2
    const usedNames = new Set(materialized.map((sequence) => sequence.name.trim().toLocaleLowerCase()))
    while (usedNames.has(name.toLocaleLowerCase())) name = `${baseName} ${suffix++}`
    const sequence: ProjectSequence = {
      id: `sequence-${crypto.randomUUID()}`,
      name,
      kind: 'main',
      aspectRatio: settings.aspectRatio,
      width: settings.width,
      height: settings.height,
      fps: settings.fps,
      timecodeStart: settings.timecodeStart,
      timecodeDropFrame: settings.timecodeDropFrame,
      transitionDefaults: defaultSequenceTransitionDefaults(),
      tracks: createInitialTracks().map((track) => ({ ...track, id: `track-${crypto.randomUUID()}` })),
      transcript: [],
      suggestions: [],
      markers: [],
      audioBuses: defaultAudioBuses(),
      createdAt: new Date().toISOString(),
    }
    setSequenceLibrary([...materialized, sequence])
    loadSequence(sequence)
    setToast(`빈 “${name}” 시퀀스를 만들었습니다.`)
  }, [captureActiveSequence, loadSequence, sequenceLibrary])

  const updateSequenceSettings = useCallback((sequenceId: string, patch: Pick<ProjectSequence, 'aspectRatio' | 'width' | 'height' | 'fps' | 'timecodeStart' | 'timecodeDropFrame' | 'transitionDefaults'>) => {
    const transitionDefaults = normalizeSequenceTransitionDefaults(patch.transitionDefaults)
    setSequenceLibrary((items) => items.map((sequence) => sequence.id === sequenceId ? { ...sequence, ...patch, transitionDefaults } : sequence))
    if (sequenceId === activeSequenceId) setAspectRatio(patch.aspectRatio)
    setToast(`시퀀스 규격 ${patch.width}×${patch.height} · ${patch.fps}fps · 기본 영상 ${transitionDefaults.video.type} ${transitionDefaults.video.duration.toFixed(2)}초 · 오디오 ${transitionDefaults.audio.duration.toFixed(2)}초`)
  }, [activeSequenceId])

  const deleteSequence = useCallback((sequenceId: string) => {
    const current = captureActiveSequence()
    const materialized = sequenceLibrary.map((sequence) => sequence.id === current.id ? current : sequence)
    const target = materialized.find((sequence) => sequence.id === sequenceId)
    if (!target) {
      setToast('삭제할 시퀀스를 찾을 수 없습니다.')
      return
    }
    const assessment = inspectSequenceDeletion({
      sequences: materialized,
      adrCues,
      mergeSessions,
      targetSequenceId: sequenceId,
      runtimeBlockers: sequenceRuntimeBlockers(sequenceId),
    })
    if (!assessment.canDelete) {
      setToast(`시퀀스를 삭제할 수 없습니다. ${assessment.blockers.join(' ')}`)
      return
    }
    const cueNotice = assessment.adrCueCount ? `\nADR 큐 ${assessment.adrCueCount}개와 해당 타임라인 기록은 함께 제거되지만 녹음 미디어와 디스크 원본은 유지됩니다.` : ''
    if (!window.confirm(`“${target.name}” 시퀀스를 삭제할까요?${cueNotice}\n프로젝트 미디어와 디스크 원본은 삭제되지 않습니다.`)) return
    const remaining = materialized.filter((sequence) => sequence.id !== sequenceId)
    setSequenceLibrary(remaining)
    updateAdrCues((cues) => cues.filter((cue) => cue.sequenceId !== sequenceId))
    if (activeSequenceId === sequenceId) {
      const next = remaining.find((sequence) => sequence.id === target.sourceSequenceId)
        ?? remaining.find((sequence) => sequence.kind === 'main')
        ?? remaining[0]
      loadSequence(next)
    }
    setToast(`“${target.name}” 시퀀스를 삭제했습니다. 미디어 원본은 유지됩니다.`)
  }, [activeSequenceId, adrCues, captureActiveSequence, loadSequence, mergeSessions, sequenceLibrary, sequenceRuntimeBlockers, updateAdrCues])

  const locateMergeConflict = useCallback((sessionId: string, conflictId: string, side: 'current' | 'branch') => {
    const conflict = mergeSessions.find((session) => session.id === sessionId)?.conflicts.find((candidate) => candidate.id === conflictId)
    const targetSequenceId = side === 'branch' ? conflict?.branchSequenceId : conflict?.sequenceId
    if (!conflict || !targetSequenceId) return
    const current = captureActiveSequence()
    const nextLibrary = sequenceLibrary.map((sequence) => sequence.id === current.id ? current : sequence)
    const target = nextLibrary.find((sequence) => sequence.id === targetSequenceId)
    if (!target) {
      setToast('충돌이 발생한 시퀀스를 찾을 수 없습니다.')
      return
    }
    setSequenceLibrary(nextLibrary)
    loadSequence(target)
    const entityId = side === 'branch' ? conflict.branchEntityId ?? conflict.entityId : conflict.entityId
    const reviewMarker = side === 'current' ? target.markers?.find((candidate) => candidate.id === conflict.markerId) : undefined
    const entityClip = target.tracks.flatMap((track) => track.clips).find((clip) => clip.id === entityId)
    const transcriptItem = target.transcript.find((candidate) => candidate.id === entityId)
    const suggestion = target.suggestions.find((candidate) => candidate.id === entityId)
    const marker = target.markers?.find((candidate) => candidate.id === entityId)
    setPlayhead(reviewMarker?.time ?? entityClip?.start ?? transcriptItem?.start ?? suggestion?.start ?? marker?.time ?? 0)
    setHistoryOpen(false)
    setToast(`“${conflict.label}” ${side === 'branch' ? '상대 분기' : '현재 충돌 위치'}로 이동했습니다.`)
  }, [captureActiveSequence, loadSequence, mergeSessions, sequenceLibrary])

  const resolveMergeConflict = useCallback((sessionId: string, conflictId: string, resolution: 'current' | 'incoming') => {
    try {
      const resolved = resolveProjectMergeConflict(buildProjectDocument(), sessionId, conflictId, resolution)
      const sequences = getProjectSequences(resolved)
      const active = sequences.find((sequence) => sequence.id === resolved.activeSequenceId) ?? sequences[0]
      if (!active) throw new Error('충돌 해결 결과에 활성 시퀀스가 없습니다.')
      const resolvedAssets = reconcileProjectAssets(assetsRef.current, resolved.assets)
      const retainedUrls = new Set(resolvedAssets.flatMap((asset) => [asset.url, asset.proxyUrl].filter((url): url is string => Boolean(url))))
      assetsRef.current.forEach((asset) => {
        if (asset.url && !retainedUrls.has(asset.url)) releaseObjectUrl(asset.url)
        if (asset.proxyUrl && !retainedUrls.has(asset.proxyUrl)) releaseObjectUrl(asset.proxyUrl)
      })
      assetsRef.current = resolvedAssets
      setAssets(resolvedAssets)
      setSelectedAssetId((current) => current && resolvedAssets.some((asset) => asset.id === current) ? current : undefined)
      setMergeSessions(resolved.mergeSessions ?? [])
      setAiActivityLog(normalizeAiActivityLog(resolved.aiActivityLog))
      updateAdrCues(resolved.adrCues ?? [])
      setCorrectionDictionary(resolved.correctionDictionary ?? {})
      setSpeakerVoiceProfiles(resolved.speakerVoiceProfiles?.length ? resolved.speakerVoiceProfiles : createSpeakerVoiceProfiles(sequences.flatMap((sequence) => sequence.transcript)))
      setCreatorLearningProfile(normalizeCreatorLearningProfile(resolved.creatorLearningProfile))
      setSequenceLibrary(sequences)
      loadSequence(active)
      void hydrateCachedProxies(resolvedAssets)
      void relinkSourceAssets(resolvedAssets)
      setToast(resolution === 'incoming' ? '상대 편집 결정을 현재 프로젝트에 적용하고 충돌을 해결했습니다.' : '현재 편집 결정을 유지하고 충돌을 해결했습니다.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '공동 작업 충돌을 해결하지 못했습니다.')
    }
  }, [buildProjectDocument, hydrateCachedProxies, loadSequence, relinkSourceAssets, updateAdrCues])

  const createShortsVersions = useCallback((candidates: ShortsCandidate[], derivedAspectRatio: Exclude<AspectRatio, '16:9'>) => {
    if (!candidates.length) return
    const current = captureActiveSequence()
    const derived = candidates.map((candidate) => ({ ...createDerivedShortsSequence({
      sourceSequenceId: activeSequenceId,
      candidate,
      tracks,
      transcript,
      suggestions,
      markers,
      assets,
      aspectRatio: derivedAspectRatio,
      sourceFingerprint: sequenceFingerprint(current, { start: candidate.start, end: candidate.end }),
      sourceGraphSnapshot: createSourceGraphSnapshot(current, { start: candidate.start, end: candidate.end }),
      sourceFps: current.fps,
      sourceTimecodeStart: current.timecodeStart,
      sourceTimecodeDropFrame: current.timecodeDropFrame,
    }), audioBuses: current.audioBuses }))
    const nextLibrary = [
      ...sequenceLibrary.map((sequence) => sequence.id === current.id ? current : sequence),
      ...derived,
    ]
    setSequenceLibrary(nextLibrary)
    loadSequence(derived[0])
    const activityId = beginAiActivity({
      operation: 'shorts-generation',
      label: `AI 쇼츠 파생 · ${derivedAspectRatio}`,
      processing: { location: 'local-device', processor: 'EditWeave multimodal shorts + face reframe' },
      input: { sequenceId: current.id, timeRange: { start: Math.min(...candidates.map((candidate) => candidate.start)), end: Math.max(...candidates.map((candidate) => candidate.end)) }, dataCategories: ['대본 훅', 'AI 하이라이트', '오디오 에너지', '얼굴 궤적', '장면 경계'], summary: `선택 후보 ${candidates.length}개 · ${derivedAspectRatio}` },
      reason: candidates.map((candidate) => candidate.reason).filter(Boolean).join(' / ') || '선택한 멀티모달 후보를 플랫폼 화면비 파생물로 생성합니다.',
      approval: 'user-confirmed-change',
      undo: { available: false, method: 'delete-created-sequence', description: '시퀀스 관리에서 생성된 파생 쇼츠를 삭제' },
    })
    endAiActivity(activityId, { status: 'completed', changes: { summary: `파생 쇼츠 시퀀스 ${derived.length}개 생성`, sequences: derived.length, clips: derived.reduce((sum, sequence) => sum + sequence.tracks.flatMap((track) => track.clips).length, 0) } })
    setShortsOpen(false)
    setToast(`${derivedAspectRatio} 파생 시퀀스 ${derived.length}개를 만들었습니다. 원본 시퀀스는 그대로 보존됩니다.`)
  }, [activeSequenceId, assets, beginAiActivity, captureActiveSequence, endAiActivity, loadSequence, markers, sequenceLibrary, suggestions, tracks, transcript])

  const refreshActiveDerivedSequence = useCallback(() => {
    const derived = graphSequences.find((sequence) => sequence.id === activeSequenceId)
    if (!derived || derived.kind !== 'shorts' || !derived.sourceSequenceId || !derived.sourceRange) return
    const source = graphSequences.find((sequence) => sequence.id === derived.sourceSequenceId)
    if (!source) {
      setToast('파생 시퀀스의 원본 시퀀스를 찾을 수 없습니다.')
      return
    }
    setDerivedSyncRequest({ derivedId: derived.id, sourceId: source.id })
  }, [activeSequenceId, graphSequences])

  const regenerateDerivedFromSource = useCallback((derived: ProjectSequence, source: ProjectSequence): ProjectSequence | undefined => {
    if (!derived.sourceRange) return undefined
    const duration = derived.sourceRange.end - derived.sourceRange.start
    const targetDuration = ([15, 30, 60] as const).reduce((best, value) => Math.abs(value - duration) < Math.abs(best - duration) ? value : best, 30)
    return createDerivedShortsSequence({
      sourceSequenceId: source.id,
      candidate: { id: crypto.randomUUID(), targetDuration, start: derived.sourceRange.start, end: derived.sourceRange.end, title: derived.name, hook: derived.transcript[0]?.text ?? derived.name, score: 1 },
      tracks: source.tracks,
      transcript: source.transcript,
      suggestions: source.suggestions,
      markers: source.markers,
      assets,
      aspectRatio: derived.aspectRatio as Exclude<AspectRatio, '16:9'>,
      sourceFingerprint: sequenceFingerprint(source, derived.sourceRange),
      sourceGraphSnapshot: createSourceGraphSnapshot(source, derived.sourceRange),
      sourceFps: source.fps,
      sourceTimecodeStart: source.timecodeStart,
      sourceTimecodeDropFrame: source.timecodeDropFrame,
    })
  }, [assets])

  const applyDerivedSynchronization = useCallback((domains: SourceGraphDomain[], preserveLocalEdits: boolean) => {
    if (!derivedSyncRequest) return
    const derived = graphSequences.find((sequence) => sequence.id === derivedSyncRequest.derivedId)
    const source = graphSequences.find((sequence) => sequence.id === derivedSyncRequest.sourceId)
    if (!derived || !source || !derived.sourceRange) {
      setDerivedSyncRequest(undefined)
      setToast('파생 시퀀스와 원본 연결을 다시 확인해 주세요.')
      return
    }
    const refreshed = regenerateDerivedFromSource(derived, source)
    if (!refreshed) return
    const replacement = synchronizeDerivedSequenceDomains({
      derived,
      regenerated: { ...refreshed, audioBuses: source.audioBuses },
      source,
      domains,
      preserveLocalEdits,
    })
    setSequenceLibrary((items) => items.map((sequence) => sequence.id === derived.id ? replacement : sequence))
    loadSequence(replacement)
    setDerivedSyncRequest(undefined)
    setToast(`원본 변경 ${domains.length}개 영역을 반영했습니다.${preserveLocalEdits ? ' 파생 쇼츠의 직접 보정은 보존했습니다.' : ''}`)
  }, [derivedSyncRequest, graphSequences, loadSequence, regenerateDerivedFromSource])

  const applyBatchDerivedSynchronization = useCallback((sequenceIds: string[], preserveLocalEdits: boolean, openExport: boolean) => {
    const selectedIds = new Set(sequenceIds)
    const replacements = new Map<string, ProjectSequence>()
    for (const entry of sourceGraphBatchInspection.entries) {
      if (!selectedIds.has(entry.derivedSequenceId) || entry.missingSource) continue
      const derived = graphSequences.find((sequence) => sequence.id === entry.derivedSequenceId)
      const source = graphSequences.find((sequence) => sequence.id === entry.sourceSequenceId)
      if (!derived || !source) continue
      const regenerated = regenerateDerivedFromSource(derived, source)
      if (!regenerated) continue
      replacements.set(derived.id, synchronizeDerivedSequenceDomains({
        derived,
        regenerated: { ...regenerated, audioBuses: source.audioBuses },
        source,
        domains: entry.changedDomains,
        preserveLocalEdits,
      }))
    }
    if (!replacements.size) {
      setToast('동기화할 수 있는 파생물을 찾지 못했습니다.')
      return
    }
    setSequenceLibrary((items) => items.map((sequence) => replacements.get(sequence.id) ?? sequence))
    const activeReplacement = replacements.get(activeSequenceId)
    if (activeReplacement) loadSequence(activeReplacement)
    setSourceGraphBatchOpen(false)
    setToast(`파생 쇼츠 ${replacements.size}개를 최신화했습니다.${preserveLocalEdits ? ' 직접 보정은 보존했습니다.' : ''}`)
    if (openExport) {
      setExportError(undefined)
      setExportOpen(true)
    }
  }, [activeSequenceId, graphSequences, loadSequence, regenerateDerivedFromSource, sourceGraphBatchInspection.entries])

  const exportableShortsSequences = useMemo(() => {
    const current = captureActiveSequence()
    return sequenceLibrary
      .map((sequence) => sequence.id === current.id ? current : sequence)
      .filter((sequence) => sequence.kind === 'shorts' && sequence.tracks.some((track) => track.kind === 'video' && !track.muted && track.clips.some((clip) => {
        const asset = assets.find((item) => item.id === clip.assetId)
        return asset?.status === 'ready' && asset.sourceFile
      })))
  }, [assets, captureActiveSequence, sequenceLibrary])

  const applyProject = useCallback((project: EditWeaveProjectDocument, options: { trustStableMediaIds?: boolean } = {}) => {
    const sameProject = project.id === projectId
    if (!sameProject) {
      clipClipboardRef.current = undefined
      setHasClipClipboard(false)
    }
    const nextAssets = sameProject ? reconcileProjectAssets(assetsRef.current, project.assets, { trustStableIds: options.trustStableMediaIds }) : restoreAssets(project)
    const retainedUrls = new Set(nextAssets.flatMap((asset) => [asset.url, asset.proxyUrl].filter((url): url is string => Boolean(url))))
    assetsRef.current.forEach((asset) => {
      if (asset.url && !retainedUrls.has(asset.url)) releaseObjectUrl(asset.url)
      if (asset.proxyUrl && !retainedUrls.has(asset.proxyUrl)) releaseObjectUrl(asset.proxyUrl)
    })
    setProjectId(project.id)
    setCreatedAt(project.createdAt)
    setProjectName(project.name)
    setMediaBins([...new Set([...(project.mediaBins ?? []), ...project.assets.map((asset) => asset.folder ?? '')].map((name) => name.trim()).filter(Boolean))])
    setCorrectionDictionary(project.correctionDictionary ?? {})
    setSpeakerVoiceProfiles(project.speakerVoiceProfiles?.length ? project.speakerVoiceProfiles : createSpeakerVoiceProfiles(getProjectSequences(project).flatMap((sequence) => sequence.transcript)))
    setCreatorLearningProfile(normalizeCreatorLearningProfile(project.creatorLearningProfile))
    setMergeSessions(project.mergeSessions ?? [])
    setAiActivityLog(normalizeAiActivityLog(project.aiActivityLog))
    updateAdrCues(project.adrCues ?? [])
    setAdrLoopRange(undefined)
    const sequences = getProjectSequences(project)
    const active = sequences.find((sequence) => sequence.id === project.activeSequenceId) ?? sequences[0]
    setSequenceLibrary(sequences)
    setActiveSequenceId(active.id)
    setAspectRatio(active.aspectRatio)
    assetsRef.current = nextAssets
    setAssets(nextAssets)
    void hydrateCachedProxies(nextAssets)
    void relinkSourceAssets(nextAssets)
    setTracks(active.tracks)
    setTranscript(active.transcript)
    setSuggestions(active.suggestions)
    setMarkers(active.markers ?? [])
    setSequenceWorkArea(active.workArea)
    setSequenceLoopPlayback(Boolean(active.loopPlayback))
    const nextAudioBuses = normalizeAudioBuses(active.audioBuses)
    setAudioBuses(nextAudioBuses)
    tracksRef.current = active.tracks
    transcriptRef.current = active.transcript
    suggestionsRef.current = active.suggestions
    markersRef.current = active.markers ?? []
    audioBusesRef.current = nextAudioBuses
    setPast([])
    setFuture([])
    setSelectedAssetId(undefined)
    setSelectedTranscriptId(undefined)
    setSelectedClipId(undefined)
    setSelectedTrackId(active.tracks.find((track) => track.kind === 'video')?.id ?? active.tracks[0]?.id)
    setPlayhead(0)
    setIsPlaying(false)
    setToast(sameProject ? '프로젝트 버전을 적용했습니다. 현재 장비의 정상 미디어 연결은 유지됩니다.' : '프로젝트를 열었습니다. 오프라인 미디어는 같은 파일을 다시 가져오면 연결됩니다.')
  }, [hydrateCachedProxies, projectId, relinkSourceAssets, updateAdrCues])

  const claimProjectPath = useCallback(async (path: string): Promise<boolean> => {
    let result = await acquireProjectLock(path, projectLockInstanceRef.current)
    if (!result.acquired) {
      const owner = result.owner
      const label = `${owner.user || '다른 사용자'}@${owner.host || '다른 장비'}`
      const reason = result.stale ? `${label}의 잠금 heartbeat가 45초 이상 지나 만료됐습니다.` : `${label}에서 이 프로젝트를 편집 중입니다.`
      if (!window.confirm(`${reason}\n\n기존 잠금을 강제로 인수할까요? 활성 편집자의 잠금을 인수하면 저장 충돌이 발생할 수 있습니다.`)) return false
      result = await acquireProjectLock(path, projectLockInstanceRef.current, true)
      if (!result.acquired) throw new Error('공유 프로젝트 잠금을 인수하지 못했습니다.')
    }
    const previous = projectLockRef.current
    if (previous && previous.path !== path) await releaseProjectLock(previous.path, projectLockInstanceRef.current).catch(() => undefined)
    projectLockRef.current = { path, lock: result }
    setProjectFilePath(path)
    setProjectLock(result)
    return true
  }, [])

  const releaseCurrentProjectLock = useCallback(async () => {
    const current = projectLockRef.current
    projectLockRef.current = undefined
    setProjectFilePath(undefined)
    setProjectLock(undefined)
    if (current) await releaseProjectLock(current.path, projectLockInstanceRef.current).catch(() => undefined)
  }, [])

  const saveProject = useCallback(async () => {
    try {
      const document = buildProjectDocument()
      let path: string | undefined
      if (runningInDesktop()) {
        path = projectFilePath ?? await selectProjectSavePath(projectName)
        if (!path || !await claimProjectPath(path)) return
        await writeProjectFileAtPath(path, document)
      } else {
        path = await saveProjectFile(document)
      }
      if (path) {
        if (runningInDesktop()) setRecentProjects(rememberRecentProject(path, document.name))
        setSaveState('프로젝트 파일 저장됨')
        setToast(`프로젝트를 저장했습니다: ${path}`)
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : '프로젝트 저장에 실패했습니다.')
    }
  }, [buildProjectDocument, claimProjectPath, projectFilePath, projectName])

  const saveProjectAs = useCallback(async () => {
    try {
      const snapshot = buildProjectDocument()
      if (!runningInDesktop()) {
        const path = await saveProjectFile(snapshot)
        if (path) setToast(`프로젝트 사본을 저장했습니다: ${path}`)
        return
      }
      const path = await selectProjectSavePath(projectName)
      if (!path || !await claimProjectPath(path)) return
      const nextProjectId = crypto.randomUUID()
      const nextCreatedAt = new Date().toISOString()
      const document = { ...snapshot, id: nextProjectId, createdAt: nextCreatedAt, updatedAt: nextCreatedAt }
      await writeProjectFileAtPath(path, document)
      setProjectId(nextProjectId)
      setCreatedAt(nextCreatedAt)
      setRecentProjects(rememberRecentProject(path, document.name))
      setSaveState('새 프로젝트 파일로 저장됨')
      setToast(`프로젝트를 새 파일로 저장하고 현재 작업 경로를 전환했습니다: ${path}`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '다른 이름으로 프로젝트 저장에 실패했습니다.')
    }
  }, [buildProjectDocument, claimProjectPath, projectName])

  const archiveProject = useCallback(async (options: ProjectArchiveOptions) => {
    if (archivingProject) return
    if (!runningInDesktop()) {
      setToast('이동 가능한 프로젝트 아카이브는 데스크톱 앱에서 사용할 수 있습니다.')
      return
    }
    setArchivingProject(true)
    setToast('프로젝트 원본과 프록시를 아카이브 폴더로 수집하고 있습니다.')
    try {
      const result = await createProjectArchive(buildProjectDocument(), options)
      if (!result) { setToast('프로젝트 아카이브 저장을 취소했습니다.'); return }
      setProjectManagerOpen(false)
      setToast(`프로젝트 수집 완료 · 원본 ${result.mediaCount}개${result.trimmedMedia ? ` · 사용 범위 축소 ${result.trimmedMedia}개` : ''}${result.excludedUnusedMedia ? ` · 미사용 제외 ${result.excludedUnusedMedia}개` : ''} · 프록시 ${result.proxyCount}개${result.failures.length ? ` · 처리 실패 ${result.failures.length}개` : ''}: ${result.directory}`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '프로젝트 아카이브를 만들지 못했습니다.')
    } finally {
      setArchivingProject(false)
    }
  }, [archivingProject, buildProjectDocument])

  const clearScratchDisk = useCallback(async (kind: 'proxy' | 'render') => {
    if (kind === 'render' && isExporting) {
      setToast('진행 중인 렌더가 끝난 뒤 렌더 복구 캐시를 정리해주세요.')
      return
    }
    try {
      const removed = await clearScratchDiskArea(kind, scratchDiskPreferences)
      if (kind === 'proxy') {
        const nextAssets = assetsRef.current.map((asset) => {
          if (!asset.proxyCachePath || !isCurrentScratchPath('proxy', asset.proxyCachePath, scratchDiskPreferences)) return asset
          releaseObjectUrl(asset.proxyUrl)
          return { ...asset, proxyFile: undefined, proxyUrl: undefined, proxySize: undefined, proxyWidth: undefined, proxyHeight: undefined, proxyFrameRate: undefined, proxyCachePath: undefined, proxyOrigin: undefined, proxyPurpose: undefined, proxyEnabled: undefined, proxyCachedAt: undefined, proxyTimecode: undefined, proxyTimecodeVerified: undefined, proxyTimecodeMismatch: undefined, proxyStatus: 'none' as const, proxyProgress: undefined, proxyError: undefined, useProxy: false }
        })
        assetsRef.current = nextAssets
        setAssets(nextAssets)
      } else {
        const currentRoot = scratchRoot('render', scratchDiskPreferences) ?? null
        setRenderJobs((jobs) => jobs.map((job) => {
          const jobRoot = 'renderScratchRoot' in job ? job.renderScratchRoot ?? null : null
          return jobRoot === currentRoot && (job.status === 'failed' || job.status === 'interrupted') ? { ...job, progress: 0, stage: '렌더 복구 캐시 정리됨 · 처음부터 재시도', updatedAt: new Date().toISOString() } : job
        }))
      }
      setToast(`${kind === 'proxy' ? '프록시' : '렌더 복구'} 캐시 ${removed.files}개를 정리했습니다. 디스크 원본과 ADR 녹음은 유지됩니다.`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '스크래치 캐시를 정리하지 못했습니다.')
    }
  }, [isExporting, scratchDiskPreferences])

  const checkUpdates = useCallback(async () => {
    if (checkingUpdate) return
    setCheckingUpdate(true)
    try {
      const currentVersion = await currentEditWeaveVersion()
      const result = await checkForUpdate(currentVersion)
      if (!result.configured) setToast('업데이트 서버가 아직 설정되지 않았습니다. VITE_EDITWEAVE_UPDATE_MANIFEST를 지정해주세요.')
      else if (!result.available || !result.manifest) setToast('현재 최신 버전을 사용하고 있습니다.')
      else {
        const previous = matchingStoredUpdateInstaller(result.manifest)
        if (runningInDesktop() && previous && window.confirm(`EditWeave ${result.manifest.version}의 기존 설치 파일이 있습니다. SHA-256과 운영체제 서명을 다시 검사해 실행할까요?\n\n${previous.installerPath}`)) {
          try {
            setToast('기존 업데이트 설치 파일을 다시 검증하고 있습니다.')
            const installer = await prepareExistingVerifiedUpdateInstaller(result.manifest, previous.installerPath)
            rememberVerifiedUpdateInstaller(result.manifest, installer, currentVersion)
            markUpdateInstallerLaunched()
            try { await launchVerifiedUpdateInstaller(installer) } catch (error) { markUpdateInstallerLaunchFailed(); throw error }
            setToast('재검증된 업데이트 설치 파일을 실행했습니다. 설치 프로그램 안내를 따라주세요.')
            return
          } catch (error) {
            clearStoredUpdateAttempt()
            setToast(error instanceof Error ? `기존 설치 파일을 재사용하지 못했습니다: ${error.message}` : '기존 설치 파일을 재사용하지 못했습니다.')
          }
        }
        if (!window.confirm(`EditWeave ${result.manifest.version} 버전이 있습니다. 새 설치 파일을 내려받을까요?\n\n${result.manifest.notes ?? ''}`)) return
        if (!runningInDesktop()) {
          window.open(result.manifest.downloadUrl, '_blank', 'noopener,noreferrer')
        } else {
          const destination = await selectUpdateInstallerDestination(result.manifest)
          if (!destination) return
          setToast('서명된 업데이트 설치 파일을 다운로드하고 SHA-256을 확인하고 있습니다.')
          const installer = await downloadVerifiedUpdateInstaller(result.manifest, destination)
          rememberVerifiedUpdateInstaller(result.manifest, installer, currentVersion)
          setToast(`업데이트 설치 파일 검증 완료 · ${formatFileSize(installer.size)} · ${installer.signer}`)
          if (window.confirm(`EditWeave ${result.manifest.version} 설치 파일의 SHA-256과 운영체제 서명 검증이 끝났습니다. 지금 실행할까요?\n\n서명자: ${installer.signer}\n${installer.path}`)) {
            markUpdateInstallerLaunched()
            try { await launchVerifiedUpdateInstaller(installer) } catch (error) { markUpdateInstallerLaunchFailed(); throw error }
            setToast('검증된 업데이트 설치 파일을 실행했습니다. 설치 프로그램 안내를 따라주세요.')
          }
        }
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : '업데이트를 확인하지 못했습니다.')
    } finally {
      setCheckingUpdate(false)
    }
  }, [checkingUpdate])

  const openProject = useCallback(async () => {
    if (!runningInDesktop()) {
      projectInputRef.current?.click()
      return
    }
    try {
      const opened = await openProjectFileNative()
      if (opened && await claimProjectPath(opened.path)) {
        applyProject(opened.project)
        setRecentProjects(rememberRecentProject(opened.path, opened.project.name))
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : '프로젝트를 열지 못했습니다.')
    }
  }, [applyProject, claimProjectPath])

  const importExchangeContents = useCallback((contents: string, filename: string) => {
    try {
      const imported = parseExchangeTimeline(contents, filename, activeSequenceFps)
      const materialized = materializeImportedTimeline(imported, assetsRef.current, preset)
      const current = captureActiveSequence()
      const currentLibrary = sequenceLibrary.map((sequence) => sequence.id === current.id ? current : sequence)
      const baseName = `${imported.name} · 가져옴`
      let sequenceName = baseName
      let suffix = 2
      const names = new Set(currentLibrary.map((sequence) => sequence.name.trim().toLocaleLowerCase()))
      while (names.has(sequenceName.toLocaleLowerCase())) sequenceName = `${baseName} ${suffix++}`
      const sequence: ProjectSequence = {
        id: `sequence-${crypto.randomUUID()}`,
        name: sequenceName,
        kind: 'main',
        aspectRatio: materialized.aspectRatio,
        width: materialized.width,
        height: materialized.height,
        fps: imported.fps,
        timecodeStart: imported.timecodeStart,
        timecodeDropFrame: imported.timecodeDropFrame,
        transitionDefaults: imported.transitionDefaults ?? defaultSequenceTransitionDefaults(),
        tracks: materialized.tracks,
        transcript: [],
        suggestions: [],
        markers: imported.markers,
        audioBuses: defaultAudioBuses(),
        createdAt: new Date().toISOString(),
      }
      assetsRef.current = materialized.assets
      setAssets(materialized.assets)
      setSequenceLibrary([...currentLibrary, sequence])
      loadSequence(sequence)
      setActivePanel('media')
      const mediaSummary = [
        materialized.matchedMediaCount ? `기존 미디어 ${materialized.matchedMediaCount}개 연결` : '',
        materialized.offlineMediaCount ? `오프라인 ${materialized.offlineMediaCount}개 생성` : '',
      ].filter(Boolean).join(' · ')
      setToast(`“${sequenceName}” 시퀀스로 클립 ${imported.clips.length}개를 가져왔습니다.${mediaSummary ? ` ${mediaSummary}.` : ''}`)
    } catch (error) {
      setToast(error instanceof Error ? `교환 파일 가져오기 실패: ${error.message}` : 'Premiere Pro XML·FCPXML·EDL 시퀀스를 가져오지 못했습니다.')
    }
  }, [activeSequenceFps, captureActiveSequence, loadSequence, preset, sequenceLibrary])

  const importExchangeFile = useCallback(async () => {
    if (!runningInDesktop()) {
      exchangeInputRef.current?.click()
      return
    }
    try {
      const opened = await openExchangeFileNative()
      if (opened) importExchangeContents(opened.contents, opened.name)
    } catch (error) {
      setToast(error instanceof Error ? `교환 파일을 열지 못했습니다: ${error.message}` : 'Premiere Pro XML·FCPXML·EDL 파일을 열지 못했습니다.')
    }
  }, [importExchangeContents])

  const openRecentProject = useCallback(async (path: string) => {
    try {
      const project = await openProjectFileAtPath(path)
      if (!await claimProjectPath(path)) return
      applyProject(project)
      setRecentProjects(rememberRecentProject(path, project.name))
    } catch (error) {
      setRecentProjects(forgetRecentProject(path))
      setToast(error instanceof Error ? `최근 프로젝트를 열지 못했습니다: ${error.message}` : '최근 프로젝트를 열지 못해 목록에서 제거했습니다.')
    }
  }, [applyProject, claimProjectPath])

  const newProject = useCallback(() => {
    if ((assetsRef.current.length || tracksRef.current.some((track) => track.clips.length)) && !window.confirm('현재 편집 내용을 닫고 새 프로젝트를 만들까요? 저장하지 않은 변경은 현재 화면에서 사라집니다.')) return
    void releaseCurrentProjectLock()
    assetsRef.current.forEach((asset) => {
      releaseObjectUrl(asset.url)
      releaseObjectUrl(asset.proxyUrl)
    })
    const now = new Date().toISOString()
    const nextTracks = createInitialTracks()
    const nextAudioBuses = defaultAudioBuses()
    const mainSequence: ProjectSequence = { id: 'sequence-main', name: '메인 시퀀스', kind: 'main', aspectRatio: '16:9', width: 1920, height: 1080, fps: 30, transitionDefaults: defaultSequenceTransitionDefaults(), tracks: nextTracks, transcript: [], suggestions: [], markers: [], audioBuses: nextAudioBuses, createdAt: now }
    setProjectId(crypto.randomUUID())
    setCreatedAt(now)
    setProjectName('새로운 크리에이터 프로젝트')
    setMediaBins([])
    setSequenceLibrary([mainSequence])
    setActiveSequenceId(mainSequence.id)
    setAspectRatio('16:9')
    setAssets([])
    setTracks(nextTracks)
    setTranscript([])
    setSuggestions([])
    setMarkers([])
    setAudioBuses(nextAudioBuses)
    setCorrectionDictionary({})
    setSpeakerVoiceProfiles([])
    setCreatorLearningProfile(defaultCreatorLearningProfile())
    setMergeSessions([])
    setAiActivityLog([])
    updateAdrCues([])
    setAdrLoopRange(undefined)
    setSequenceWorkArea(undefined)
    setSequenceLoopPlayback(false)
    assetsRef.current = []
    tracksRef.current = nextTracks
    transcriptRef.current = []
    suggestionsRef.current = []
    markersRef.current = []
    audioBusesRef.current = nextAudioBuses
    setPast([])
    setFuture([])
    setSelectedAssetId(undefined)
    setSelectedClipId(undefined)
    clipClipboardRef.current = undefined
    setHasClipClipboard(false)
    setSelectedTranscriptId(undefined)
    setSelectedTrackId(nextTracks[0]?.id)
    setPlayhead(0)
    setIsPlaying(false)
    setSaveState('로컬 자동 저장 준비')
    setToast('빈 새 프로젝트를 만들었습니다.')
  }, [releaseCurrentProjectLock, updateAdrCues])

  const startExport = useCallback(async (request: ExportRequest, retryJobId?: string, sequenceOverride?: ProjectSequence, outputDirectory?: string, sequenceGraphOverride?: ProjectSequence[]) => {
    if (isExporting) return
    if (isMezzanineCodec(request.codec) && !runningInDesktop()) { setExportError('ProRes·DNxHR MOV 마스터는 데스크톱 앱의 내장 코덱 엔진에서 출력할 수 있습니다.'); return }
    const renderCodec = intermediateRenderCodec(request)
    const renderContainer = isMezzanineCodec(request.codec) ? 'mov' as const : 'mp4' as const
    const renderSequence = sequenceOverride ?? captureActiveSequence()
    const renderPreset = { ...(sequencePresets.find((item) => item.ratio === renderSequence.aspectRatio) ?? sequencePresets[0]), width: renderSequence.width, height: renderSequence.height }
    const renderGraph = sequenceGraphOverride ?? graphSequences
    const materializedRenderGraph = renderGraph.some((sequence) => sequence.id === renderSequence.id)
      ? renderGraph.map((sequence) => sequence.id === renderSequence.id ? renderSequence : sequence)
      : [...renderGraph, renderSequence]
    const renderTracks = flattenNestedTracks(renderSequence.tracks, renderGraph)
    const renderAudioBuses = normalizeAudioBuses(renderSequence.audioBuses)
    if (request.includeAudio) {
      const blocker = audioExportBlocker(request, renderTracks, renderAudioBuses)
      if (blocker) { setExportError(blocker); return }
    }
    const renderTimelineEnd = Math.max(1 / request.fps, ...renderTracks.filter((track) => !track.muted).flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)))
    const renderRange = resolveRequestedExportRange(request, renderTimelineEnd, 1 / request.fps, renderSequence.workArea)
    const renderRangeStart = renderRange.start
    const renderRangeEnd = renderRange.end
    const renderDuration = renderRangeEnd - renderRangeStart
    const requestedWidth = Math.max(2, Math.round(request.height * renderPreset.width / renderPreset.height / 2) * 2)
    const renderAssetIds = new Set(renderTracks.flatMap((track) => track.clips.flatMap((clip) => clip.enabled !== false && clip.assetId ? [clip.assetId] : [])))
    const compatibilityRenderAssets = assets.filter((asset) => renderAssetIds.has(asset.id) && (asset.videoDecodable === false || asset.imageDecodable === false || asset.kind === 'video' && Boolean(asset.audioCodec && asset.audioDecodable === false)))
    const undersizedCompatibility = compatibilityRenderAssets.find((asset) => asset.kind !== 'audio' && ((asset.proxyWidth ?? 0) < requestedWidth || (asset.proxyHeight ?? 0) < request.height))
    if (undersizedCompatibility) {
      setExportError(`“${undersizedCompatibility.name}”의 호환 미디어가 출력 ${requestedWidth}×${request.height}보다 작습니다. 미디어 패널에서 기존 프록시를 정리한 뒤 원본 해상도 고품질 호환 미디어를 다시 생성하거나 충분한 해상도의 외부 프록시를 연결해주세요.`)
      return
    }
    if (request.colorMode !== 'sdr') {
      const toneMappedSource = compatibilityRenderAssets.find((asset) => effectiveSourceHdrFormat(asset) === 'pq' || effectiveSourceHdrFormat(asset) === 'hlg')
      if (toneMappedSource) {
        setExportError(`“${toneMappedSource.name}” HDR 원본이 Rec.709 호환 미디어에 의존하고 있어 ${request.colorMode === 'hdr10-pq' ? 'HDR10 PQ' : 'HDR HLG'} 마스터를 만들 수 없습니다. HDR를 직접 디코딩할 수 있는 원본 코덱으로 다시 연결하거나 SDR로 출력해주세요.`)
        return
      }
    }
    const segmentDuration = 30
    const totalSegments = Math.ceil(renderDuration / segmentDuration)
    const renderFingerprint = createRenderFingerprint({ sequence: sequenceFingerprint({ ...renderSequence, tracks: renderTracks }, renderRange), range: renderRange, settings: request, audioBuses: renderAudioBuses })
    const controller = new AbortController()
    const gate = createPauseGate()
    const jobId = retryJobId ?? crypto.randomUUID()
    const now = new Date().toISOString()
    const sequenceName = renderSequence.name
    const priorJob = renderJobs.find((item) => item.id === jobId)
    const jobSequenceSnapshots = priorJob?.sequenceSnapshots ?? createRenderSequenceSnapshots(materializedRenderGraph, [renderSequence.id])
    const renderScratchRoot = priorJob ? ('renderScratchRoot' in priorJob ? priorJob.renderScratchRoot ?? null : null) : scratchRoot('render') ?? null
    const previousRecovery = readRenderRecovery()
    const canResume = runningInDesktop() && previousRecovery?.id === jobId && previousRecovery.projectId === projectId && previousRecovery.sequenceId === renderSequence.id && previousRecovery.mode === 'segmented' && previousRecovery.renderFingerprint === renderFingerprint && Boolean(previousRecovery.outputPath)
    const initialCompleted = canResume ? Math.max(0, Math.min(totalSegments, previousRecovery?.completedSegments ?? 0)) : 0
    const job: RenderQueueJob = { id: jobId, projectId, projectName, sequenceId: renderSequence.id, sequenceName, kind: 'single', settings: request, sequenceSnapshots: jobSequenceSnapshots, renderScratchRoot, progress: initialCompleted / totalSegments * 0.96, stage: canResume ? `완료 체크포인트 ${initialCompleted}/${totalSegments}에서 복구 준비` : '출력 준비', status: 'running', createdAt: priorJob?.createdAt ?? now, updatedAt: now }
    setRenderJobs((jobs) => jobs.some((item) => item.id === jobId) ? jobs.map((item) => item.id === jobId ? job : item) : [...jobs, job].slice(-30))
    let recovery: RenderRecoveryRecord = canResume ? { ...previousRecovery!, status: 'rendering', error: undefined, updatedAt: now } : { id: jobId, projectId, projectName, sequenceId: renderSequence.id, filename: request.filename, codec: request.codec, height: request.height, fps: request.fps, rangeStart: renderRangeStart, rangeEnd: renderRangeEnd, progress: 0, stage: '출력 준비', status: 'rendering', updatedAt: now, mode: runningInDesktop() ? 'segmented' : 'single-file', segmentDuration, completedSegments: 0, totalSegments, renderFingerprint }
    let latestProgress = initialCompleted / totalSegments * 0.96
    writeRenderRecovery(recovery)
    exportAbortRef.current = controller
    exportPauseRef.current = gate
    setActiveRenderJobId(jobId)
    setIsExportPaused(false)
    setIsExporting(true)
    setExportError(undefined)
    setExportProgress(latestProgress)
    setExportStage(canResume ? `완료 체크포인트 ${initialCompleted}/${totalSegments} 복구 준비` : '출력 준비')
    try {
      let path: string | undefined
      let surroundAudioMasterPath: string | undefined
      let codecFallback = recovery.actualCodec && recovery.requiresCodecTranscode ? { actualCodec: recovery.actualCodec, requestedCodec: renderCodec, requiresCodecTranscode: true } : undefined
      if (runningInDesktop()) {
        const useSurroundAudioFallback = request.includeAudio && request.audioChannels === 6
        const useContinuousAudioMaster = request.includeAudio && (request.codec !== 'prores-4444' || useSurroundAudioFallback)
        const useHdrRawFallback = request.colorMode === 'hdr10-pq' || request.colorMode === 'hdr-hlg'
        if (!canResume) await cleanupRenderSegments(jobId, renderScratchRoot).catch(() => undefined)
        const outputPath = canResume ? recovery.outputPath : outputDirectory ? await reserveRenderedVideoPathInDirectory(outputDirectory, request.filename, renderContainer) : await selectRenderedVideoPath(request.filename, renderContainer)
        if (!outputPath) {
          clearRenderRecovery()
          setExportStage('저장이 취소됨')
          updateRenderJob(jobId, { status: 'cancelled', stage: '저장 위치 선택 취소' })
          return
        }
        recovery = { ...recovery, outputPath, mode: 'segmented', segmentDuration, totalSegments, renderFingerprint }
        const available = new Set(await inspectRenderSegments(jobId, renderScratchRoot))
        let completedSegments = canResume ? initialCompleted : 0
        for (let index = 0; index < completedSegments; index++) if (!available.has(index)) { completedSegments = index; break }
        latestProgress = completedSegments / totalSegments * 0.96
        recovery = { ...recovery, completedSegments, progress: latestProgress, stage: completedSegments ? `완료 체크포인트 ${completedSegments}/${totalSegments} 복구` : '구간 렌더 준비' }
        writeRenderRecovery(recovery)
        updateRenderJob(jobId, { outputPath, progress: latestProgress, stage: recovery.stage })
        for (let index = completedSegments; index < totalSegments; index++) {
          const segmentPath = await prepareRenderSegment(jobId, index, renderScratchRoot)
          const rawHdrPath = useHdrRawFallback ? await prepareRenderHdrRawSegment(jobId, index, renderScratchRoot) : undefined
          const destination = await prepareRenderedVideoTargetAtPath(rawHdrPath ?? segmentPath)
          const rangeStart = renderRangeStart + index * segmentDuration
          const rangeEnd = Math.min(renderRangeEnd, rangeStart + segmentDuration)
          const hdrRawReaders = new Map<string, Awaited<ReturnType<typeof openHdrRawSource>>>()
          try {
            if (useHdrRawFallback) {
              const expectedHdr = request.colorMode === 'hdr10-pq' ? 'pq' : 'hlg'
              const sourceWindows = new Map<string, { asset: MediaAsset; start: number; end: number }>()
              for (const track of renderTracks) {
                if (track.muted || track.visible === false || track.kind !== 'video') continue
                for (const clip of track.clips) {
                  const asset = clip.assetId ? assets.find((item) => item.id === clip.assetId) : undefined
                  if (!asset?.sourcePath || asset.kind !== 'video' || clip.enabled === false || effectiveSourceHdrFormat(asset) !== expectedHdr) continue
                  const overlapStart = Math.max(rangeStart, clip.start)
                  const overlapEnd = Math.min(rangeEnd, clip.start + clip.duration)
                  if (overlapEnd <= overlapStart) continue
                  let sourceStart = Number.POSITIVE_INFINITY
                  let sourceEnd = Number.NEGATIVE_INFINITY
                  const sampleCount = Math.max(1, Math.ceil((overlapEnd - overlapStart) * request.fps))
                  for (let frame = 0; frame <= sampleCount; frame++) {
                    const timelineTime = Math.min(overlapEnd, overlapStart + frame / request.fps)
                    const sourceTime = Math.max(0, clipSourceTime(clip, timelineTime))
                    sourceStart = Math.min(sourceStart, sourceTime)
                    sourceEnd = Math.max(sourceEnd, sourceTime)
                  }
                  const current = sourceWindows.get(asset.id)
                  sourceWindows.set(asset.id, { asset, start: Math.min(current?.start ?? sourceStart, sourceStart), end: Math.max(current?.end ?? sourceEnd, sourceEnd) })
                }
              }
              let slot = 0
              for (const { asset, start, end } of sourceWindows.values()) {
                const width = Math.floor(Math.max(16, Math.min(8192, asset.width ?? requestedWidth)) / 4) * 4
                const height = Math.floor(Math.max(16, Math.min(8192, asset.height ?? request.height)) / 2) * 2
                const decodeStart = Math.floor(start * request.fps) / request.fps
                const frames = Math.max(2, Math.ceil((end - decodeStart) * request.fps) + 2)
                const decodedPath = await decodeRenderHdrSource({ jobId, index, slot: slot++, sourcePath: asset.sourcePath!, scratchRootOverride: renderScratchRoot, rangeStart: decodeStart, width, height, fps: request.fps, frames })
                hdrRawReaders.set(asset.id, await openHdrRawSource(decodedPath, { width, height, fps: request.fps, rangeStart: decodeStart, frames }))
              }
            }
            const segmentResult = await exportSequence({
              projectName,
              preset: renderPreset,
              height: request.height,
              fps: request.fps,
              codec: renderCodec,
              preserveAlpha: request.codec === 'prores-4444',
              allowCodecFallback: true,
              colorMode: request.colorMode,
              bitrateMbps: request.bitrateMbps,
              hardwareAcceleration: request.hardwareAcceleration,
              includeAudio: request.includeAudio && !useContinuousAudioMaster,
              audioSampleRate: request.audioSampleRate,
              audioBitrateKbps: request.audioBitrateKbps,
              audioChannels: request.audioChannels,
              assets,
              tracks: renderTracks,
              audioBuses: renderAudioBuses,
              rangeStart,
              rangeEnd,
              hdrRawFrameProvider: hdrRawReaders.size ? async (asset, sourceTime) => hdrRawReaders.get(asset.id)?.frameAt(sourceTime) : undefined,
              ...(rawHdrPath ? { hdrRawOutputStream: destination.writable } : { outputStream: destination.writable }),
              waitWhilePaused: gate.wait,
              signal: controller.signal,
              onProgress: (progress, stage) => {
                latestProgress = (index + progress) / totalSegments * 0.96
                const segmentedStage = `구간 ${index + 1}/${totalSegments} · ${stage}`
                setExportProgress(latestProgress)
                setExportStage(segmentedStage)
                updateRenderJob(jobId, { progress: latestProgress, stage: segmentedStage, status: gate.isPaused() ? 'paused' : 'running' })
                writeRenderRecovery({ ...recovery, progress: latestProgress, stage: segmentedStage, status: 'rendering', updatedAt: new Date().toISOString() })
              },
            })
            if (rawHdrPath) {
              const encodeStage = `구간 ${index + 1}/${totalSegments} · 번들 HEVC Main10 인코딩`
              setExportStage(encodeStage)
              updateRenderJob(jobId, { stage: encodeStage })
              await encodeRenderHdrSegment({ rawPath: rawHdrPath, outputPath: segmentPath, width: segmentResult.width, height: segmentResult.height, fps: request.fps, frames: Math.ceil((rangeEnd - rangeStart) * request.fps), bitrateMbps: request.bitrateMbps, transfer: request.colorMode === 'hdr10-pq' ? 'pq' : 'hlg' })
            }
            codecFallback = segmentResult.requiresCodecTranscode ? segmentResult : codecFallback
            recovery = { ...recovery, actualCodec: segmentResult.actualCodec, requiresCodecTranscode: segmentResult.requiresCodecTranscode }
          } finally {
            await Promise.all([...hdrRawReaders.values()].map((reader) => reader.close().catch(() => undefined)))
          }
          completedSegments = index + 1
          latestProgress = completedSegments / totalSegments * 0.96
          recovery = { ...recovery, completedSegments, progress: latestProgress, stage: `체크포인트 ${completedSegments}/${totalSegments} 저장` }
          writeRenderRecovery(recovery)
          updateRenderJob(jobId, { progress: latestProgress, stage: recovery.stage })
        }
        let continuousAudioPath: string | undefined
        if (useContinuousAudioMaster) {
          continuousAudioPath = await prepareRenderAudioMaster(jobId, renderScratchRoot, useSurroundAudioFallback ? 'wav' : 'm4a')
          const audioDestination = await prepareRenderedVideoTargetAtPath(continuousAudioPath)
          const reportAudioProgress = (progress: number, stage: string) => {
            latestProgress = 0.96 + progress * 0.02
            const audioStage = `연속 오디오 마스터 · ${stage}`
            setExportProgress(latestProgress)
            setExportStage(audioStage)
            updateRenderJob(jobId, { progress: latestProgress, stage: audioStage, status: gate.isPaused() ? 'paused' : 'running' })
            writeRenderRecovery({ ...recovery, progress: latestProgress, stage: audioStage, status: 'rendering', updatedAt: new Date().toISOString() })
          }
          if (useSurroundAudioFallback) {
            await exportAudioStem({ projectName, stemName: 'Continuous-5.1-Mix', roles: audioRoles, sampleRate: request.audioSampleRate, channels: 6, assets, tracks: renderTracks, audioBuses: renderAudioBuses, rangeStart: renderRangeStart, rangeEnd: renderRangeEnd, outputStream: audioDestination.writable, waitWhilePaused: gate.wait, signal: controller.signal, onProgress: reportAudioProgress })
            surroundAudioMasterPath = continuousAudioPath
          } else {
            await exportAudioMaster({ projectName, assets, tracks: renderTracks, audioBuses: renderAudioBuses, sampleRate: request.audioSampleRate, bitrateKbps: request.audioBitrateKbps, channels: request.audioChannels, rangeStart: renderRangeStart, rangeEnd: renderRangeEnd, outputStream: audioDestination.writable, waitWhilePaused: gate.wait, signal: controller.signal, onProgress: reportAudioProgress })
          }
        }
        setExportProgress(0.98)
        setExportStage('완료 구간·연속 오디오 무손실 결합')
        updateRenderJob(jobId, { progress: 0.98, stage: '완료 구간·연속 오디오 무손실 결합' })
        writeRenderRecovery({ ...recovery, progress: 0.98, stage: '완료 구간·연속 오디오 무손실 결합', status: 'rendering', updatedAt: new Date().toISOString() })
        const finalDestination = await prepareRenderedVideoTargetAtPath(outputPath)
        const segmentSources = await Promise.all(Array.from({ length: totalSegments }, async (_, index) => ({ path: await prepareRenderSegment(jobId, index, renderScratchRoot), duration: Math.min(segmentDuration, renderDuration - index * segmentDuration) })))
        await mergeRenderedSegments(segmentSources, finalDestination.writable, (progress) => {
          latestProgress = 0.98 + progress * 0.01
          setExportProgress(latestProgress)
          setExportStage(`완료 구간 무손실 결합 ${Math.round(progress * 100)}%`)
          updateRenderJob(jobId, { progress: latestProgress, stage: `완료 구간 무손실 결합 ${Math.round(progress * 100)}%` })
        }, useSurroundAudioFallback ? undefined : continuousAudioPath)
        path = outputPath
      } else {
        const result = await exportSequence({
          projectName,
          preset: renderPreset,
          height: request.height,
          fps: request.fps,
          codec: renderCodec,
          preserveAlpha: request.codec === 'prores-4444',
          colorMode: request.colorMode,
          bitrateMbps: request.bitrateMbps,
          hardwareAcceleration: request.hardwareAcceleration,
          includeAudio: request.includeAudio,
          audioSampleRate: request.audioSampleRate,
          audioBitrateKbps: request.audioBitrateKbps,
          audioChannels: request.audioChannels,
          assets,
          tracks: renderTracks,
          audioBuses: renderAudioBuses,
          rangeStart: renderRangeStart,
          rangeEnd: renderRangeEnd,
          waitWhilePaused: gate.wait,
          signal: controller.signal,
          onProgress: (progress, stage) => {
            latestProgress = progress
            setExportProgress(progress)
            setExportStage(stage)
            updateRenderJob(jobId, { progress, stage, status: gate.isPaused() ? 'paused' : 'running' })
            writeRenderRecovery({ ...recovery, progress, stage, status: 'rendering', updatedAt: new Date().toISOString() })
          },
        })
        path = result.buffer ? await saveRenderedVideo(result.buffer, request.filename, renderContainer) : undefined
      }
      if (path) {
        if (runningInDesktop() && surroundAudioMasterPath) {
          setExportStage('번들 코덱 엔진으로 AAC 5.1 결합')
          updateRenderJob(jobId, { progress: 0.991, stage: 'AAC 5.1 MP4 오디오 결합' })
          await muxContinuousSurroundAudio(path, surroundAudioMasterPath, request.audioBitrateKbps, request.audioSampleRate)
        }
        if (runningInDesktop() && codecFallback?.requiresCodecTranscode) {
          setExportStage(`앱 코덱 엔진으로 ${renderCodecLabel(renderCodec)} 마무리`)
          updateRenderJob(jobId, { progress: 0.992, stage: `${renderCodecLabel(renderCodec)} 코덱 마무리` })
          await finalizeRequestedCodec(path, codecFallback, request.bitrateMbps)
        }
        if (runningInDesktop() && isMezzanineCodec(request.codec)) {
          const label = renderCodecLabel(request.codec)
          setExportStage(`${label}${request.codec === 'dnxhr-hq' ? ' 8-bit' : ' 10-bit'} MOV 마스터 생성`)
          updateRenderJob(jobId, { progress: 0.994, stage: `${label} MOV 마무리` })
          await finalizeMasterCodec(path, request.codec, request.bitrateMbps, request.audioSampleRate, formatMediaTimecode((renderSequence.timecodeStart ?? 0) + renderRangeStart, request.fps, Boolean(renderSequence.timecodeDropFrame)))
        }
        if (runningInDesktop() && request.colorMode === 'hdr10-pq') {
          setExportStage('HDR10 정적 메타데이터 기록')
          updateRenderJob(jobId, { progress: 0.995, stage: 'HDR10 정적 메타데이터 기록' })
          await applyHdrOutputMetadata(path, collectHdrOutputMetadata(assets, renderTracks))
        }
        const stemOutputs: NonNullable<RenderQueueJob['stemOutputs']> = []
        const requestedStems: AudioDeliverableRole[] = [...new Set<AudioDeliverableRole>([...(request.audioMixdownWav ? ['mix' as const] : []), ...(request.audioStems ?? [])])]
        for (let stemIndex = 0; stemIndex < requestedStems.length; stemIndex++) {
          const role = requestedStems[stemIndex]
          const stemName = audioStemFileLabels[role]
          const stemStage = `WAV 납품 ${stemIndex + 1}/${requestedStems.length} · ${stemName}`
          setExportStage(stemStage)
          updateRenderJob(jobId, { progress: 0.996 + stemIndex / Math.max(1, requestedStems.length) * 0.003, stage: stemStage, stemOutputs })
          const destination = runningInDesktop() ? await prepareAudioStemTarget(path, stemName) : undefined
          const stemResult = await exportAudioStem({
            projectName,
            stemName,
            roles: role === 'mix' ? audioRoles : [role],
            sampleRate: request.audioSampleRate,
            channels: request.audioChannels,
            assets,
            tracks: renderTracks,
            audioBuses: renderAudioBuses,
            rangeStart: renderRangeStart,
            rangeEnd: renderRangeEnd,
            outputStream: destination?.writable,
            waitWhilePaused: gate.wait,
            signal: controller.signal,
            onProgress: (progress, stage) => {
              const overall = 0.996 + (stemIndex + progress) / Math.max(1, requestedStems.length) * 0.003
              setExportProgress(overall)
              setExportStage(stage)
              updateRenderJob(jobId, { progress: overall, stage, stemOutputs })
            },
          })
          const stemPath = destination?.path ?? (stemResult.buffer ? await saveAudioStem(stemResult.buffer, request.filename, stemName) : undefined)
          if (stemPath) {
            if (runningInDesktop()) await applyBroadcastWavMetadata(stemPath, request.audioSampleRate, (renderSequence.timecodeStart ?? 0) + renderRangeStart, `${projectName} · ${renderSequence.name} · ${stemName}`)
            stemOutputs.push({ role, path: stemPath })
            updateRenderJob(jobId, { stemOutputs: [...stemOutputs] })
          }
        }
        if (runningInDesktop()) await cleanupRenderSegments(jobId, renderScratchRoot).catch(() => undefined)
        clearRenderRecovery()
        let loudness: Awaited<ReturnType<typeof measureRenderedLoudness>> = undefined
        let loudnessError: string | undefined
        if (runningInDesktop() && request.includeAudio) {
          setExportStage('완성 파일 EBU R128 실측')
          updateRenderJob(jobId, { stage: '완성 파일 EBU R128 실측' })
          try {
            loudness = await measureRenderedLoudness(path, normalizeAudioDeliveryProfileId(request.audioDeliveryProfile))
          } catch (error) {
            loudnessError = error instanceof Error ? error.message : String(error)
          }
        }
        updateRenderJob(jobId, { progress: 1, stage: loudness ? `완료 · ${loudness.conformance.status === 'pass' ? '오디오 적합' : '오디오 확인 필요'} · ${loudness.integratedLufs.toFixed(1)} LUFS · TP ${loudness.truePeakDbtp.toFixed(1)} dBTP${stemOutputs.length ? ` · WAV ${stemOutputs.length}개` : ''}` : stemOutputs.length ? `완료 · WAV 납품 ${stemOutputs.length}개` : '완료', status: 'completed', outputPath: path, stemOutputs, loudness, loudnessError, error: undefined })
        setExportOpen(false)
        const outputLabel = isMezzanineCodec(request.codec) ? 'MOV 마스터' : 'MP4'
        setToast(loudness ? `${outputLabel} 출력 완료 · ${loudness.conformance.status === 'pass' ? '오디오 적합' : '오디오 기준 확인 필요'} · ${loudness.integratedLufs.toFixed(1)} LUFS · True Peak ${loudness.truePeakDbtp.toFixed(1)} dBTP` : `${outputLabel} 출력을 완료했습니다: ${path}`)
      } else {
        setExportStage('저장이 취소됨')
        updateRenderJob(jobId, { status: 'cancelled', stage: '저장이 취소됨' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '영상 출력에 실패했습니다.'
      writeRenderRecovery({ ...recovery, progress: latestProgress, stage: message, status: error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed', error: message, updatedAt: new Date().toISOString() })
      updateRenderJob(jobId, { progress: latestProgress, stage: message, status: error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed', error: message })
      setExportError(message)
      setExportStage(error instanceof DOMException && error.name === 'AbortError' ? '취소됨' : '오류')
    } finally {
      setIsExporting(false)
      setIsExportPaused(false)
      setActiveRenderJobId(undefined)
      gate.resume()
      exportAbortRef.current = undefined
      exportPauseRef.current = undefined
    }
  }, [assets, captureActiveSequence, graphSequences, isExporting, projectId, projectName, renderJobs, updateRenderJob])

  const startAudioMasterExport = useCallback(async (request: ExportRequest, retryJobId?: string, sequenceOverride?: ProjectSequence, outputDirectory?: string, sequenceGraphOverride?: ProjectSequence[]) => {
    if (isExporting) return
    const renderSequence = sequenceOverride ?? captureActiveSequence()
    const renderGraph = sequenceGraphOverride ?? graphSequences
    const materializedRenderGraph = renderGraph.some((sequence) => sequence.id === renderSequence.id)
      ? renderGraph.map((sequence) => sequence.id === renderSequence.id ? renderSequence : sequence)
      : [...renderGraph, renderSequence]
    const renderTracks = flattenNestedTracks(renderSequence.tracks, renderGraph)
    const sampleRate = request.audioSampleRate
    const audioBlocker = audioExportBlocker(request, renderTracks, normalizeAudioBuses(renderSequence.audioBuses))
    if (audioBlocker) { setExportError(audioBlocker); return }
    const timelineEnd = Math.max(1 / sampleRate, ...renderTracks.filter((track) => !track.muted).flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)))
    const renderRange = resolveRequestedExportRange(request, timelineEnd, 1 / sampleRate, renderSequence.workArea)
    const rangeStart = renderRange.start
    const rangeEnd = renderRange.end
    const controller = new AbortController()
    const gate = createPauseGate()
    const jobId = retryJobId ?? crypto.randomUUID()
    const now = new Date().toISOString()
    const priorJob = renderJobs.find((job) => job.id === jobId)
    const jobSequenceSnapshots = priorJob?.sequenceSnapshots ?? createRenderSequenceSnapshots(materializedRenderGraph, [renderSequence.id])
    const job: RenderQueueJob = { id: jobId, projectId, projectName, sequenceId: renderSequence.id, sequenceName: renderSequence.name, kind: 'audio-only', settings: request, sequenceSnapshots: jobSequenceSnapshots, progress: 0, stage: 'WAV 납품 준비', status: 'running', createdAt: priorJob?.createdAt ?? now, updatedAt: now }
    setRenderJobs((jobs) => jobs.some((item) => item.id === jobId) ? jobs.map((item) => item.id === jobId ? job : item) : [...jobs, job].slice(-30))
    exportAbortRef.current = controller
    exportPauseRef.current = gate
    setActiveRenderJobId(jobId)
    setIsExportPaused(false)
    setIsExporting(true)
    setExportError(undefined)
    setExportProgress(0)
    setExportStage('Full Mix WAV 준비')
    try {
      const selectedPath = runningInDesktop() ? outputDirectory ? await reserveAudioWavPathInDirectory(outputDirectory, request.filename) : await selectAudioWavPath(request.filename) : undefined
      if (runningInDesktop() && !selectedPath) {
        setExportStage('저장이 취소됨')
        updateRenderJob(jobId, { status: 'cancelled', stage: 'WAV 저장 위치 선택 취소' })
        return
      }
      const deliverables: AudioDeliverableRole[] = [...new Set<AudioDeliverableRole>(['mix', ...(request.audioStems ?? [])])]
      const paths: string[] = []
      for (let index = 0; index < deliverables.length; index++) {
        const role = deliverables[index]
        const stemName = audioStemFileLabels[role]
        const destination = selectedPath
          ? role === 'mix'
            ? await prepareRenderedVideoTargetAtPath(selectedPath)
            : await prepareAudioStemTarget(selectedPath, stemName)
          : undefined
        const result = await exportAudioStem({
          projectName,
          stemName,
          roles: role === 'mix' ? audioRoles : [role],
          sampleRate,
          channels: request.audioChannels,
          assets,
          tracks: renderTracks,
          audioBuses: normalizeAudioBuses(renderSequence.audioBuses),
          rangeStart,
          rangeEnd,
          outputStream: destination?.writable,
          waitWhilePaused: gate.wait,
          signal: controller.signal,
          onProgress: (progress, stage) => {
            const overall = (index + progress) / deliverables.length
            const currentStage = `WAV ${index + 1}/${deliverables.length} · ${stage}`
            setExportProgress(overall)
            setExportStage(currentStage)
            updateRenderJob(jobId, { progress: overall, stage: currentStage, status: gate.isPaused() ? 'paused' : 'running' })
          },
        })
        const path = destination?.path ?? (result.buffer ? await saveAudioStem(result.buffer, request.filename, stemName) : undefined)
        if (path) {
          if (runningInDesktop()) await applyBroadcastWavMetadata(path, sampleRate, (renderSequence.timecodeStart ?? 0) + rangeStart, `${projectName} · ${renderSequence.name} · ${stemName}`)
          paths.push(path)
        }
      }
      const path = paths[0]
      if (!path) return
      let loudness: Awaited<ReturnType<typeof measureRenderedLoudness>> = undefined
      if (runningInDesktop()) {
        setExportStage('Full Mix EBU R128 실측')
        updateRenderJob(jobId, { stage: 'Full Mix EBU R128 실측' })
        loudness = await measureRenderedLoudness(path, normalizeAudioDeliveryProfileId(request.audioDeliveryProfile)).catch(() => undefined)
      }
      const stemOutputs = paths.map((outputPath, index) => ({ role: deliverables[index], path: outputPath }))
      setExportProgress(1)
      setExportStage(loudness ? `완료 · WAV ${paths.length}개 · ${loudness.conformance.status === 'pass' ? '적합' : '확인 필요'} · ${loudness.integratedLufs.toFixed(1)} LUFS · TP ${loudness.truePeakDbtp.toFixed(1)} dBTP` : `WAV 납품 ${paths.length}개 완료`)
      updateRenderJob(jobId, { progress: 1, stage: loudness ? `완료 · WAV ${paths.length}개 · ${loudness.integratedLufs.toFixed(1)} LUFS` : `WAV 납품 ${paths.length}개 완료`, status: 'completed', outputPath: path, stemOutputs, loudness, error: undefined })
      setExportOpen(false)
      setToast(loudness ? `WAV 납품 ${paths.length}개 완료 · ${loudness.conformance.status === 'pass' ? '오디오 적합' : '오디오 기준 확인 필요'} · ${sampleRate / 1_000}kHz 24-bit · ${loudness.integratedLufs.toFixed(1)} LUFS · True Peak ${loudness.truePeakDbtp.toFixed(1)} dBTP` : `WAV 납품 ${paths.length}개를 완료했습니다: ${path}`)
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === 'AbortError'
      const message = error instanceof Error ? error.message : 'Full Mix WAV 출력에 실패했습니다.'
      setExportError(cancelled ? undefined : message)
      setExportStage(cancelled ? '취소됨' : '오류')
      updateRenderJob(jobId, { status: cancelled ? 'cancelled' : 'failed', stage: cancelled ? '취소됨' : message, error: cancelled ? undefined : message })
    } finally {
      setIsExporting(false)
      setIsExportPaused(false)
      setActiveRenderJobId(undefined)
      gate.resume()
      exportAbortRef.current = undefined
      exportPauseRef.current = undefined
    }
  }, [assets, captureActiveSequence, graphSequences, isExporting, projectId, projectName, renderJobs, updateRenderJob])

  const startBatchExport = useCallback(async (request: ExportRequest, retryJobId?: string, outputDirectoryOverride?: string, sequenceOverrides?: ProjectSequence[], sequenceGraphOverride?: ProjectSequence[]) => {
    const batchSequences = sequenceOverrides ?? exportableShortsSequences
    if (batchSequences.length < 2 || isExporting) return
    if (isMezzanineCodec(request.codec) && !runningInDesktop()) { setExportError('ProRes·DNxHR MOV 마스터는 데스크톱 앱의 내장 코덱 엔진에서 출력할 수 있습니다.'); return }
    const renderCodec = intermediateRenderCodec(request)
    const renderGraph = sequenceGraphOverride ?? graphSequences
    const materializedRenderGraph = renderGraph.map((sequence) => batchSequences.find((candidate) => candidate.id === sequence.id) ?? sequence)
    batchSequences.forEach((sequence) => { if (!materializedRenderGraph.some((candidate) => candidate.id === sequence.id)) materializedRenderGraph.push(sequence) })
    if (request.includeAudio) {
      const blocker = batchSequences.map((sequence) => audioExportBlocker(request, flattenNestedTracks(sequence.tracks, renderGraph), normalizeAudioBuses(sequence.audioBuses))).find(Boolean)
      if (blocker) { setExportError(blocker); return }
    }
    const renderContainer = isMezzanineCodec(request.codec) ? 'mov' as const : 'mp4' as const
    const batchRangeFor = (sequence: ProjectSequence) => {
      const sequenceTracks = flattenNestedTracks(sequence.tracks, renderGraph)
      const timelineEnd = Math.max(1 / request.fps, ...sequenceTracks.filter((track) => !track.muted).flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)))
      const rangeRequest = request.range === 'selected-clips' ? { ...request, range: 'sequence' as const, rangeStart: undefined, rangeEnd: undefined } : request
      return resolveRequestedExportRange(rangeRequest, timelineEnd, 1 / request.fps, sequence.workArea)
    }
    const renderFingerprint = createRenderFingerprint({ sequences: batchSequences.map((sequence) => { const range = batchRangeFor(sequence); return { id: sequence.id, fingerprint: sequenceFingerprint(sequence, range), range } }), settings: request })
    const controller = new AbortController()
    const gate = createPauseGate()
    const jobId = retryJobId ?? crypto.randomUUID()
    const now = new Date().toISOString()
    const previousRecovery = readRenderRecovery()
    const canResume = runningInDesktop() && previousRecovery?.id === jobId && previousRecovery.projectId === projectId && previousRecovery.sequenceId === 'shorts-batch' && previousRecovery.mode === 'batch' && previousRecovery.renderFingerprint === renderFingerprint && Boolean(previousRecovery.outputPath)
    const initialOutputs = canResume ? previousRecovery?.completedOutputs ?? [] : []
    const priorJob = renderJobs.find((item) => item.id === jobId)
    const jobSequenceSnapshots = priorJob?.sequenceSnapshots ?? createRenderSequenceSnapshots(materializedRenderGraph, batchSequences.map((sequence) => sequence.id))
    const job: RenderQueueJob = { id: jobId, projectId, projectName, sequenceId: 'shorts-batch', sequenceIds: batchSequences.map((sequence) => sequence.id), sequenceName: `쇼츠 ${batchSequences.length}개`, kind: 'shorts-batch', settings: request, sequenceSnapshots: jobSequenceSnapshots, progress: initialOutputs.length / batchSequences.length, stage: canResume ? `완료 쇼츠 ${initialOutputs.length}/${batchSequences.length} 복구 준비` : '쇼츠 일괄 출력 준비', status: 'running', createdAt: priorJob?.createdAt ?? now, updatedAt: now }
    setRenderJobs((jobs) => jobs.some((item) => item.id === jobId) ? jobs.map((item) => item.id === jobId ? job : item) : [...jobs, job].slice(-30))
    let recovery: RenderRecoveryRecord = canResume ? { ...previousRecovery!, status: 'rendering', error: undefined, updatedAt: now } : { id: jobId, projectId, projectName, sequenceId: 'shorts-batch', filename: request.filename, codec: request.codec, height: request.height, fps: request.fps, progress: 0, stage: '쇼츠 일괄 출력 준비', status: 'rendering', updatedAt: now, mode: 'batch', renderFingerprint, completedOutputs: [] }
    let latestProgress = initialOutputs.length / batchSequences.length
    writeRenderRecovery(recovery)
    exportAbortRef.current = controller
    exportPauseRef.current = gate
    setActiveRenderJobId(jobId)
    setIsExportPaused(false)
    setIsExporting(true)
    setExportError(undefined)
    setExportProgress(latestProgress)
    setExportStage(canResume ? `완료 쇼츠 ${initialOutputs.length}/${batchSequences.length} 복구 준비` : '쇼츠 일괄 출력 준비')
    let saved = 0
    const loudnessReports: NonNullable<RenderQueueJob['loudnessReports']> = []
    const loudnessErrors: string[] = []
    const stemOutputs: NonNullable<RenderQueueJob['stemOutputs']> = []
    try {
      const outputDirectory = canResume ? recovery.outputPath : outputDirectoryOverride ?? (runningInDesktop() ? await selectRenderedVideoDirectory() : undefined)
      if (runningInDesktop() && !outputDirectory) {
        clearRenderRecovery()
        setExportStage('저장이 취소됨')
        updateRenderJob(jobId, { status: 'cancelled', stage: '출력 폴더 선택 취소' })
        return
      }
      if (outputDirectory) {
        recovery = { ...recovery, outputPath: outputDirectory, mode: 'batch', renderFingerprint }
        writeRenderRecovery(recovery)
        updateRenderJob(jobId, { outputPath: outputDirectory, stage: '출력 폴더 준비 완료' })
      }
      for (let index = 0; index < batchSequences.length; index++) {
        const sequence = batchSequences[index]
        const sequencePreset = { ...(sequencePresets.find((item) => item.ratio === sequence.aspectRatio) ?? sequencePresets[1]), width: sequence.width, height: sequence.height }
        const prefix = `쇼츠 ${index + 1}/${batchSequences.length}`
        const outputName = `${request.filename}-${String(index + 1).padStart(2, '0')}-${sequence.name}`
        const flattenedTracks = flattenNestedTracks(sequence.tracks, renderGraph)
        const batchRange = batchRangeFor(sequence)
        const requestedStems: AudioDeliverableRole[] = [...new Set<AudioDeliverableRole>([...(request.audioMixdownWav ? ['mix' as const] : []), ...(request.audioStems ?? [])])]
        const videoProgressShare = requestedStems.length ? 0.84 : 1
        const stemProgressShare = 1 - videoProgressShare
        const renderSequenceStems = async (videoPath: string) => {
          for (let stemIndex = 0; stemIndex < requestedStems.length; stemIndex++) {
            const role = requestedStems[stemIndex]
            const stemName = audioStemFileLabels[role]
            const stemStage = `${prefix} · WAV 납품 ${stemIndex + 1}/${requestedStems.length} · ${stemName}`
            setExportStage(stemStage)
            updateRenderJob(jobId, { stage: stemStage, stemOutputs: [...stemOutputs] })
            const stemDestination = runningInDesktop() ? await prepareAudioStemTarget(videoPath, stemName) : undefined
            const stemResult = await exportAudioStem({
              projectName: `${projectName}-${sequence.name}`,
              stemName,
              roles: role === 'mix' ? audioRoles : [role],
              sampleRate: request.audioSampleRate,
              channels: request.audioChannels,
              assets,
              tracks: flattenedTracks,
              audioBuses: normalizeAudioBuses(sequence.audioBuses),
              rangeStart: batchRange.start,
              rangeEnd: batchRange.end,
              outputStream: stemDestination?.writable,
              waitWhilePaused: gate.wait,
              signal: controller.signal,
              onProgress: (progress, stage) => {
                const overall = (index + videoProgressShare + (stemIndex + progress) / requestedStems.length * stemProgressShare) / batchSequences.length
                setExportProgress(overall)
                setExportStage(`${prefix} · ${stage}`)
                updateRenderJob(jobId, { progress: overall, stage: `${prefix} · ${stage}`, stemOutputs: [...stemOutputs] })
              },
            })
            const stemPath = stemDestination?.path ?? (stemResult.buffer ? await saveAudioStem(stemResult.buffer, outputName, stemName) : undefined)
            if (stemPath) {
              if (runningInDesktop()) await applyBroadcastWavMetadata(stemPath, request.audioSampleRate, (sequence.timecodeStart ?? 0) + batchRange.start, `${projectName} · ${sequence.name} · ${stemName}`)
              stemOutputs.push({ role, path: stemPath })
            }
          }
          updateRenderJob(jobId, { stemOutputs: [...stemOutputs] })
        }
        const completedOutput = recovery.completedOutputs?.find((item) => item.sequenceId === sequence.id)
        if (completedOutput && await renderedVideoExists(completedOutput.path)) {
          if (requestedStems.length) await renderSequenceStems(completedOutput.path)
          saved++
          latestProgress = (index + 1) / batchSequences.length
          setExportProgress(latestProgress)
          setExportStage(`${prefix} · 완료 파일 복구`)
          updateRenderJob(jobId, { progress: latestProgress, stage: `${prefix} · 완료 파일 복구` })
          if (request.includeAudio) {
            try {
              const measurement = await measureRenderedLoudness(completedOutput.path, normalizeAudioDeliveryProfileId(request.audioDeliveryProfile))
              if (measurement) loudnessReports.push({ ...measurement, outputPath: completedOutput.path })
            } catch (error) {
              loudnessErrors.push(`${sequence.name}: ${error instanceof Error ? error.message : String(error)}`)
            }
          }
          continue
        }
        const destination = outputDirectory ? await prepareRenderedVideoTargetInDirectory(outputDirectory, outputName, renderContainer) : undefined
        const result = await exportSequence({
          projectName: `${projectName}-${sequence.name}`,
          preset: sequencePreset,
          height: request.height,
          fps: request.fps,
          codec: renderCodec,
          preserveAlpha: request.codec === 'prores-4444',
          allowCodecFallback: runningInDesktop(),
          colorMode: request.colorMode,
          bitrateMbps: request.bitrateMbps,
          hardwareAcceleration: request.hardwareAcceleration,
          includeAudio: request.includeAudio,
          audioSampleRate: request.audioSampleRate,
          audioBitrateKbps: request.audioBitrateKbps,
          audioChannels: request.audioChannels,
          assets,
          tracks: flattenedTracks,
          audioBuses: normalizeAudioBuses(sequence.audioBuses),
          rangeStart: batchRange.start,
          rangeEnd: batchRange.end,
          outputStream: destination?.writable,
          waitWhilePaused: gate.wait,
          signal: controller.signal,
          onProgress: (progress, stage) => {
            latestProgress = (index + progress * videoProgressShare) / batchSequences.length
            setExportProgress(latestProgress)
            setExportStage(`${prefix} · ${stage}`)
            updateRenderJob(jobId, { progress: latestProgress, stage: `${prefix} · ${stage}`, status: gate.isPaused() ? 'paused' : 'running' })
            writeRenderRecovery({ ...recovery, progress: latestProgress, stage: `${prefix} · ${stage}`, status: 'rendering', updatedAt: new Date().toISOString() })
          },
        })
        const path = destination?.path ?? (result.buffer ? await saveRenderedVideo(result.buffer, outputName, renderContainer) : undefined)
        if (path) {
          if (runningInDesktop() && result.requiresCodecTranscode) {
            setExportStage(`${prefix} · 앱 코덱 엔진 마무리`)
            updateRenderJob(jobId, { stage: `${prefix} · ${renderCodecLabel(renderCodec)} 코덱 마무리` })
            await finalizeRequestedCodec(path, result, request.bitrateMbps)
          }
          if (runningInDesktop() && isMezzanineCodec(request.codec)) {
            const label = renderCodecLabel(request.codec)
            setExportStage(`${prefix} · ${label}${request.codec === 'dnxhr-hq' ? ' 8-bit' : ' 10-bit'} MOV 마스터 생성`)
            updateRenderJob(jobId, { stage: `${prefix} · ${label} MOV 마무리` })
            await finalizeMasterCodec(path, request.codec, request.bitrateMbps, request.audioSampleRate, formatMediaTimecode((sequence.timecodeStart ?? 0) + batchRange.start, request.fps, Boolean(sequence.timecodeDropFrame)))
          }
          if (runningInDesktop() && request.colorMode === 'hdr10-pq') {
            setExportStage(`${prefix} · HDR10 정적 메타데이터 기록`)
            updateRenderJob(jobId, { stage: `${prefix} · HDR10 정적 메타데이터 기록` })
            await applyHdrOutputMetadata(path, collectHdrOutputMetadata(assets, flattenedTracks))
          }
          if (requestedStems.length) await renderSequenceStems(path)
          saved++
          recovery = { ...recovery, completedOutputs: [...(recovery.completedOutputs ?? []).filter((item) => item.sequenceId !== sequence.id), { sequenceId: sequence.id, path }], progress: (index + 1) / batchSequences.length, stage: `${prefix} · 완료 체크포인트 저장` }
          writeRenderRecovery(recovery)
          if (runningInDesktop() && request.includeAudio) {
            setExportStage(`${prefix} · 완성 파일 EBU R128 실측`)
            updateRenderJob(jobId, { stage: `${prefix} · 완성 파일 EBU R128 실측` })
            try {
              const measurement = await measureRenderedLoudness(path, normalizeAudioDeliveryProfileId(request.audioDeliveryProfile))
              if (measurement) loudnessReports.push({ ...measurement, outputPath: path })
            } catch (error) {
              loudnessErrors.push(`${sequence.name}: ${error instanceof Error ? error.message : String(error)}`)
            }
          }
        }
      }
      setExportOpen(false)
      clearRenderRecovery()
      const loudnessSummary = loudnessReports.length ? ` · ${Math.min(...loudnessReports.map((report) => report.integratedLufs)).toFixed(1)}~${Math.max(...loudnessReports.map((report) => report.integratedLufs)).toFixed(1)} LUFS` : ''
      updateRenderJob(jobId, { progress: 1, stage: `쇼츠 ${saved}개 완료${stemOutputs.length ? ` · WAV 납품 ${stemOutputs.length}개` : ''}${loudnessSummary}`, status: 'completed', outputPath: outputDirectory, stemOutputs, loudnessReports, loudnessError: loudnessErrors.length ? loudnessErrors.join('\n') : undefined, error: undefined })
      setToast(`쇼츠 ${saved}개 일괄 출력을 완료했습니다.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '쇼츠 일괄 출력에 실패했습니다.'
      writeRenderRecovery({ ...recovery, progress: latestProgress, stage: message, status: error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed', error: message, updatedAt: new Date().toISOString() })
      updateRenderJob(jobId, { progress: latestProgress, stage: message, status: error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed', error: message })
      setExportError(message)
      setExportStage(error instanceof DOMException && error.name === 'AbortError' ? '취소됨' : '오류')
    } finally {
      setIsExporting(false)
      setIsExportPaused(false)
      setActiveRenderJobId(undefined)
      gate.resume()
      exportAbortRef.current = undefined
      exportPauseRef.current = undefined
    }
  }, [assets, exportableShortsSequences, graphSequences, isExporting, projectId, projectName, renderJobs, updateRenderJob])

  const enqueueExport = useCallback((request: ExportRequest) => {
    const sequence = captureActiveSequence()
    const materializedGraph = graphSequences.map((candidate) => candidate.id === sequence.id ? sequence : candidate)
    const sequenceSnapshots = createRenderSequenceSnapshots(materializedGraph, [sequence.id])
    const now = new Date().toISOString()
    setRenderJobs((jobs) => {
      const settings = { ...request, filename: uniqueQueuedFilename(request.filename, sequence.name, jobs, projectId) }
      const job: RenderQueueJob = { id: crypto.randomUUID(), projectId, projectName, sequenceId: sequence.id, sequenceName: sequence.name, kind: 'single', settings, sequenceSnapshots, renderScratchRoot: scratchRoot('render') ?? null, progress: 0, stage: '렌더 큐 시작 대기 · 시퀀스 스냅샷 보존', status: 'queued', createdAt: now, updatedAt: now }
      return [...jobs, job].slice(-30)
    })
    setRenderQueueOpen(true)
    setToast(`“${sequence.name}” 출력을 렌더 큐에 추가했습니다.`)
  }, [captureActiveSequence, graphSequences, projectId, projectName])

  const enqueueAudioExport = useCallback((request: ExportRequest) => {
    const sequence = captureActiveSequence()
    const materializedGraph = graphSequences.map((candidate) => candidate.id === sequence.id ? sequence : candidate)
    const sequenceSnapshots = createRenderSequenceSnapshots(materializedGraph, [sequence.id])
    const now = new Date().toISOString()
    setRenderJobs((jobs) => {
      const settings = { ...request, audioMixdownWav: true, filename: uniqueQueuedFilename(request.filename, `${sequence.name}-audio`, jobs, projectId) }
      const job: RenderQueueJob = { id: crypto.randomUUID(), projectId, projectName, sequenceId: sequence.id, sequenceName: sequence.name, kind: 'audio-only', settings, sequenceSnapshots, progress: 0, stage: 'WAV 납품 큐 시작 대기 · 시퀀스 스냅샷 보존', status: 'queued', createdAt: now, updatedAt: now }
      return [...jobs, job].slice(-30)
    })
    setRenderQueueOpen(true)
    setToast(`“${sequence.name}” WAV 납품을 렌더 큐에 추가했습니다.`)
  }, [captureActiveSequence, graphSequences, projectId, projectName])

  const enqueueBatchExport = useCallback((request: ExportRequest) => {
    if (exportableShortsSequences.length < 2) return
    const rootIds = exportableShortsSequences.map((sequence) => sequence.id)
    const sequenceSnapshots = createRenderSequenceSnapshots(graphSequences, rootIds)
    const now = new Date().toISOString()
    setRenderJobs((jobs) => {
      const settings = { ...request, filename: uniqueQueuedFilename(request.filename, 'shorts', jobs, projectId) }
      const job: RenderQueueJob = { id: crypto.randomUUID(), projectId, projectName, sequenceId: 'shorts-batch', sequenceIds: rootIds, sequenceName: `쇼츠 ${exportableShortsSequences.length}개`, kind: 'shorts-batch', settings, sequenceSnapshots, renderScratchRoot: scratchRoot('render') ?? null, progress: 0, stage: '쇼츠 일괄 렌더 큐 시작 대기 · 시퀀스 스냅샷 보존', status: 'queued', createdAt: now, updatedAt: now }
      return [...jobs, job].slice(-30)
    })
    setRenderQueueOpen(true)
    setToast(`쇼츠 ${exportableShortsSequences.length}개 일괄 출력을 렌더 큐에 추가했습니다.`)
  }, [exportableShortsSequences, graphSequences, projectId, projectName])

  const startRenderQueue = useCallback(async () => {
    if (isExporting || !renderJobs.some((job) => job.status === 'queued' && job.projectId === projectId)) return
    if (runningInDesktop()) {
      const outputDirectory = await selectRenderedVideoDirectory()
      if (!outputDirectory) {
        setToast('렌더 큐 출력 폴더 선택을 취소했습니다.')
        return
      }
      queueOutputDirectoryRef.current = outputDirectory
    }
    setQueueRunnerActive(true)
    setToast('대기 중인 렌더 작업을 순서대로 시작합니다.')
  }, [isExporting, projectId, renderJobs])

  const stopRenderQueue = useCallback(() => {
    setQueueRunnerActive(false)
    queueOutputDirectoryRef.current = undefined
    setToast(isExporting ? '현재 작업까지만 렌더하고 순차 실행을 중지합니다.' : '렌더 큐 순차 실행을 중지했습니다.')
  }, [isExporting])

  useEffect(() => {
    if (!queueRunnerActive || isExporting) return
    const next = renderJobs.find((job) => job.status === 'queued' && job.projectId === projectId)
    if (!next) {
      setQueueRunnerActive(false)
      queueOutputDirectoryRef.current = undefined
      setToast('현재 프로젝트의 렌더 큐 실행을 마쳤습니다.')
      return
    }
    setExportError(undefined)
    setExportOpen(true)
    const queuedGraph = next.sequenceSnapshots?.length ? next.sequenceSnapshots : graphSequences
    if (next.kind === 'audio-only') {
      const sequence = queuedGraph.find((candidate) => candidate.id === next.sequenceId)
      if (!sequence) {
        updateRenderJob(next.id, { status: 'failed', stage: '예약 시퀀스 누락', error: `“${next.sequenceName}” 시퀀스를 현재 프로젝트에서 찾을 수 없습니다.` })
        return
      }
      void startAudioMasterExport(next.settings, next.id, sequence, queueOutputDirectoryRef.current, queuedGraph)
      return
    }
    if (next.kind === 'shorts-batch') {
      const queuedSequences = (next.sequenceIds?.length ? next.sequenceIds.map((id) => queuedGraph.find((sequence) => sequence.id === id)).filter((sequence): sequence is ProjectSequence => Boolean(sequence)) : exportableShortsSequences)
      if (queuedSequences.length < 2) {
        updateRenderJob(next.id, { status: 'failed', stage: '출력 가능한 쇼츠 시퀀스가 2개 미만입니다.', error: '큐에 예약한 쇼츠 구성을 현재 프로젝트에서 찾을 수 없습니다.' })
        return
      }
      void startBatchExport(next.settings, next.id, queueOutputDirectoryRef.current, queuedSequences, queuedGraph)
      return
    }
    const sequence = queuedGraph.find((candidate) => candidate.id === next.sequenceId)
    if (!sequence) {
      updateRenderJob(next.id, { status: 'failed', stage: '예약 시퀀스 누락', error: `“${next.sequenceName}” 시퀀스를 현재 프로젝트에서 찾을 수 없습니다.` })
      return
    }
    void startExport(next.settings, next.id, sequence, queueOutputDirectoryRef.current, queuedGraph)
  }, [exportableShortsSequences, graphSequences, isExporting, projectId, queueRunnerActive, renderJobs, startAudioMasterExport, startBatchExport, startExport, updateRenderJob])

  const pauseActiveRender = useCallback(() => {
    if (!activeRenderJobId || !exportPauseRef.current || !isExporting) return
    exportPauseRef.current.pause()
    setIsExportPaused(true)
    setExportStage('일시정지됨')
    updateRenderJob(activeRenderJobId, { status: 'paused', stage: '사용자가 일시정지함' })
  }, [activeRenderJobId, isExporting, updateRenderJob])

  const resumeActiveRender = useCallback(() => {
    if (!activeRenderJobId || !exportPauseRef.current || !isExporting) return
    exportPauseRef.current.resume()
    setIsExportPaused(false)
    setExportStage('렌더 재개 중')
    updateRenderJob(activeRenderJobId, { status: 'running', stage: '렌더 재개 중' })
  }, [activeRenderJobId, isExporting, updateRenderJob])

  const cancelActiveRender = useCallback(() => {
    setQueueRunnerActive(false)
    queueOutputDirectoryRef.current = undefined
    exportAbortRef.current?.abort()
  }, [])

  const retryRenderJob = useCallback((job: RenderQueueJob) => {
    if (isExporting) {
      setToast('현재 렌더가 끝난 뒤 재시도해주세요.')
      return
    }
    if (job.projectId !== projectId) {
      setToast('이 작업은 다른 프로젝트에서 생성됐습니다. 해당 프로젝트를 먼저 열어주세요.')
      return
    }
    setExportError(undefined)
    setExportOpen(true)
    const queuedGraph = job.sequenceSnapshots?.length ? job.sequenceSnapshots : graphSequences
    if (job.kind === 'audio-only') {
      const sequence = queuedGraph.find((candidate) => candidate.id === job.sequenceId)
      if (!sequence) {
        setToast(`“${job.sequenceName}” 시퀀스를 현재 프로젝트에서 찾을 수 없습니다.`)
        return
      }
      void startAudioMasterExport(job.settings, job.id, sequence, undefined, queuedGraph)
    } else if (job.kind === 'shorts-batch') {
      const sequences = job.sequenceIds?.map((id) => queuedGraph.find((candidate) => candidate.id === id)).filter((sequence): sequence is ProjectSequence => Boolean(sequence)) ?? exportableShortsSequences
      if (sequences.length < 2) {
        setToast('이 작업에 예약된 쇼츠 시퀀스를 현재 프로젝트에서 찾을 수 없습니다.')
        return
      }
      void startBatchExport(job.settings, job.id, undefined, sequences, queuedGraph)
    } else {
      const sequence = queuedGraph.find((candidate) => candidate.id === job.sequenceId)
      if (!sequence) {
        setToast(`“${job.sequenceName}” 시퀀스를 현재 프로젝트에서 찾을 수 없습니다.`)
        return
      }
      void startExport(job.settings, job.id, sequence, undefined, queuedGraph)
    }
  }, [exportableShortsSequences, graphSequences, isExporting, projectId, startAudioMasterExport, startBatchExport, startExport])

  const removeRenderJob = useCallback((id: string) => {
    if (id === activeRenderJobId) return
    const target = renderJobs.find((job) => job.id === id)
    setRenderJobs((jobs) => jobs.filter((job) => job.id !== id))
    void cleanupRenderSegments(id, target ? ('renderScratchRoot' in target ? target.renderScratchRoot ?? null : null) : null).catch(() => undefined)
  }, [activeRenderJobId, renderJobs])

  const moveQueuedRenderJob = useCallback((id: string, direction: -1 | 1) => {
    setRenderJobs((jobs) => {
      const current = jobs.find((job) => job.id === id)
      if (!current || current.status !== 'queued') return jobs
      const queued = jobs.filter((job) => job.status === 'queued' && job.projectId === current.projectId)
      const position = queued.findIndex((job) => job.id === id)
      const target = queued[position + direction]
      if (position < 0 || !target) return jobs
      const sourceIndex = jobs.findIndex((job) => job.id === id)
      const targetIndex = jobs.findIndex((job) => job.id === target.id)
      const next = [...jobs]
      ;[next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]]
      return next
    })
  }, [])

  const refreshRenderJobSnapshot = useCallback((job: RenderQueueJob) => {
    if (job.status !== 'queued' || job.projectId !== projectId) return
    const active = captureActiveSequence()
    const materializedGraph = graphSequences.map((sequence) => sequence.id === active.id ? active : sequence)
    const rootIds = job.kind === 'shorts-batch' ? job.sequenceIds ?? [] : [job.sequenceId]
    const snapshots = createRenderSequenceSnapshots(materializedGraph, rootIds)
    const foundRoots = new Set(snapshots.map((sequence) => sequence.id))
    const missing = rootIds.filter((id) => !foundRoots.has(id))
    if (missing.length) {
      setToast(`큐 스냅샷을 갱신하지 못했습니다. 현재 프로젝트에 없는 시퀀스 ${missing.length}개가 있습니다.`)
      return
    }
    const primary = snapshots.find((sequence) => sequence.id === job.sequenceId)
    const settings = job.settings.range === 'work-area' && primary?.workArea
      ? { ...job.settings, rangeStart: primary.workArea.start, rangeEnd: primary.workArea.end }
      : job.settings
    updateRenderJob(job.id, { sequenceSnapshots: snapshots, settings, stage: `현재 편집 스냅샷 ${snapshots.length}개 반영` })
    setToast(`“${job.sequenceName}” 렌더 작업에 현재 편집 상태와 중첩 시퀀스 ${Math.max(0, snapshots.length - rootIds.length)}개를 반영했습니다.`)
  }, [captureActiveSequence, graphSequences, projectId, updateRenderJob])

  const clearFinishedRenderJobs = useCallback(() => {
    renderJobs.filter((job) => job.id !== activeRenderJobId && (job.status === 'completed' || job.status === 'cancelled')).forEach((job) => { void cleanupRenderSegments(job.id, 'renderScratchRoot' in job ? job.renderScratchRoot ?? null : null).catch(() => undefined) })
    setRenderJobs((jobs) => jobs.filter((job) => job.id === activeRenderJobId || job.status === 'running' || job.status === 'paused' || job.status === 'failed' || job.status === 'interrupted'))
  }, [activeRenderJobId, renderJobs])

  const exportExchange = useCallback(async (format: 'otio' | 'premiere-xml' | 'fcpxml' | 'edl' | 'chapters' | 'markers') => {
    try {
      const contents = format === 'otio' ? createOtio(projectName, tracks, assets, markers, activeSequenceFps, activeSequenceTimecodeStart, preset, activeSequenceTimecodeDropFrame, activeTransitionDefaults) : format === 'premiere-xml' ? createPremiereXml(projectName, preset, tracks, assets, markers, activeSequenceFps, activeSequenceTimecodeStart, activeSequenceTimecodeDropFrame, activeTransitionDefaults) : format === 'fcpxml' ? createFcpxml(projectName, preset, tracks, assets, activeSequenceFps, activeSequenceTimecodeStart, activeSequenceTimecodeDropFrame, activeTransitionDefaults) : format === 'edl' ? createEdl(projectName, tracks, assets, activeSequenceFps, activeSequenceTimecodeStart, activeSequenceTimecodeDropFrame, activeTransitionDefaults) : format === 'chapters' ? createChapterList(projectName, markers) : createMarkerCsv(markers, activeSequenceFps, activeSequenceTimecodeStart, activeSequenceTimecodeDropFrame)
      const path = format === 'otio' || format === 'premiere-xml' || format === 'fcpxml' || format === 'edl' ? await saveExchangeFile(contents, projectName, format) : await saveMarkerDeliveryFile(contents, projectName, format)
      if (path) setToast(`${format === 'chapters' ? '챕터 목록' : format === 'markers' ? '마커 보고서' : `${format.toUpperCase()} 교환 파일`}을 저장했습니다: ${path}`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '편집 교환 파일 저장에 실패했습니다.')
    }
  }, [activeSequenceFps, activeSequenceTimecodeDropFrame, activeSequenceTimecodeStart, activeTransitionDefaults, assets, markers, preset, projectName, tracks])

  const createCurrentDeliveryPackage = useCallback(async () => {
    if (!runningInDesktop()) {
      setToast('납품 패키지는 데스크톱 앱에서 폴더로 만들 수 있습니다.')
      return
    }
    try {
      const completedJobs = renderJobs.filter((job) => job.projectId === projectId && job.status === 'completed')
      const masterPaths = new Map<string, string>()
      completedJobs.forEach((job) => {
        if (job.outputPath?.match(/\.(mp4|mov|mkv|webm|mxf)$/i)) masterPaths.set(job.outputPath, job.sequenceName)
        job.loudnessReports?.forEach((report) => masterPaths.set(report.outputPath, job.sequenceName))
      })
      const sources = [
        ...[...masterPaths].map(([path, sequenceName]) => ({ path, label: `${sequenceName} master` })),
        ...completedJobs.flatMap((job) => (job.stemOutputs ?? []).map((stem) => ({ path: stem.path, label: `${job.sequenceName} ${audioStemFileLabels[stem.role]} ${stem.role === 'mix' ? 'mixdown' : 'stem'}` }))),
      ]
      const captionLanguage = transcript.find((segment) => segment.language)?.language ?? 'ko'
      const documents = [
        { filename: `${projectName}.editweave.json`, contents: JSON.stringify(buildProjectDocument(), null, 2) },
        { filename: `${projectName}.otio`, contents: createOtio(projectName, tracks, assets, markers, activeSequenceFps, activeSequenceTimecodeStart, preset, activeSequenceTimecodeDropFrame, activeTransitionDefaults) },
        { filename: `${projectName}-premiere.xml`, contents: createPremiereXml(projectName, preset, tracks, assets, markers, activeSequenceFps, activeSequenceTimecodeStart, activeSequenceTimecodeDropFrame, activeTransitionDefaults) },
        { filename: `${projectName}.fcpxml`, contents: createFcpxml(projectName, preset, tracks, assets, activeSequenceFps, activeSequenceTimecodeStart, activeSequenceTimecodeDropFrame, activeTransitionDefaults) },
        { filename: `${projectName}.edl`, contents: createEdl(projectName, tracks, assets, activeSequenceFps, activeSequenceTimecodeStart, activeSequenceTimecodeDropFrame, activeTransitionDefaults) },
        { filename: `${projectName}-chapters.txt`, contents: createChapterList(projectName, markers) },
        { filename: `${projectName}-markers.csv`, contents: `\uFEFF${createMarkerCsv(markers, activeSequenceFps, activeSequenceTimecodeStart, activeSequenceTimecodeDropFrame)}` },
        { filename: `${projectName}-media-metadata.csv`, contents: `\uFEFF${createMediaMetadataCsv(assets)}` },
        ...(transcript.length ? [
          { filename: `${projectName}-${captionLanguage}.srt`, contents: transcriptToSrt(transcript) },
          { filename: `${projectName}-${captionLanguage}.vtt`, contents: transcriptToVtt(transcript) },
          { filename: `${projectName}-${captionLanguage}.ttml`, contents: transcriptToTtml(transcript, captionLanguage) },
        ] : []),
      ]
      const result = await createDeliveryPackage(projectName, sources, documents)
      if (result) setToast(`납품 패키지를 만들었습니다: ${result.directory} · 완성 파일 ${result.copiedFiles}개 · 메타데이터 ${result.documentFiles}개${result.failures.length ? ` · 복사 실패 ${result.failures.length}개` : ''}`)
    } catch (error) {
      setToast(error instanceof Error ? `납품 패키지 생성 실패: ${error.message}` : '납품 패키지를 만들지 못했습니다.')
    }
  }, [activeSequenceFps, activeSequenceTimecodeDropFrame, activeSequenceTimecodeStart, activeTransitionDefaults, assets, buildProjectDocument, markers, preset, projectId, projectName, renderJobs, tracks, transcript])

  const updateSequenceWorkArea = useCallback((next: { start: number; end: number } | undefined) => {
    const normalized = next ? {
      start: Math.max(0, Math.min(next.start, timelineDuration - 1 / activeSequenceFps)),
      end: Math.max(Math.max(0, Math.min(next.start, timelineDuration - 1 / activeSequenceFps)) + 1 / activeSequenceFps, Math.min(timelineDuration, next.end)),
    } : undefined
    setSequenceWorkArea(normalized)
    if (!normalized) setSequenceLoopPlayback(false)
    setSequenceLibrary((items) => items.map((sequence) => sequence.id === activeSequenceId ? { ...sequence, workArea: normalized, loopPlayback: normalized ? sequenceLoopPlayback : false } : sequence))
  }, [activeSequenceFps, activeSequenceId, sequenceLoopPlayback, timelineDuration])

  const toggleSequenceLoopPlayback = useCallback(() => {
    if (!sequenceWorkArea) {
      const start = selectedClip?.start ?? playhead
      const end = selectedClip ? selectedClip.start + selectedClip.duration : Math.min(timelineDuration, start + 5)
      updateSequenceWorkArea({ start, end })
    }
    setSequenceLoopPlayback((current) => {
      const next = !current
      setSequenceLibrary((items) => items.map((sequence) => sequence.id === activeSequenceId ? { ...sequence, loopPlayback: next } : sequence))
      return next
    })
  }, [activeSequenceId, playhead, selectedClip, sequenceWorkArea, timelineDuration, updateSequenceWorkArea])

  const markSequenceIn = useCallback(() => {
    const start = Math.max(0, Math.min(playhead, timelineDuration - 1 / activeSequenceFps))
    updateSequenceWorkArea({ start, end: sequenceWorkArea && sequenceWorkArea.end > start ? sequenceWorkArea.end : timelineDuration })
    setToast(`시퀀스 IN: ${formatTimecode(start, true, activeSequenceFps)}`)
  }, [activeSequenceFps, playhead, sequenceWorkArea, timelineDuration, updateSequenceWorkArea])

  const markSequenceOut = useCallback(() => {
    const end = Math.max(1 / activeSequenceFps, Math.min(timelineDuration, playhead))
    updateSequenceWorkArea({ start: sequenceWorkArea && sequenceWorkArea.start < end ? sequenceWorkArea.start : 0, end })
    setToast(`시퀀스 OUT: ${formatTimecode(end, true, activeSequenceFps)}`)
  }, [activeSequenceFps, playhead, sequenceWorkArea, timelineDuration, updateSequenceWorkArea])

  const liftSequenceWorkArea = useCallback(() => {
    if (!sequenceWorkArea) {
      setToast('Lift할 시퀀스 작업 구간을 먼저 지정해주세요.')
      return
    }
    const targetTracks = tracksRef.current.filter((track) => track.editTarget !== false && !track.locked)
    if (!targetTracks.length) {
      setToast('잠금 해제된 소스 대상 트랙이 없습니다.')
      return
    }
    const blocker = targetTracks.flatMap((track) => inspectAdrOverwrite(tracksRef.current, adrCuesRef.current, activeSequenceId, track.id, sequenceWorkArea.start, sequenceWorkArea.end))[0]
    if (blocker) {
      setToast(blocker)
      return
    }
    commitEditor({ tracks: (current) => liftTimelineRange(current, sequenceWorkArea.start, sequenceWorkArea.end, targetTracks.map((track) => track.id)) })
    setPlayhead(sequenceWorkArea.start)
    setSelectedClipId(undefined)
    setSelectedClipIds(new Set())
    setToast(`${targetTracks.map((track) => track.name).join(', ')}의 작업 구간을 Lift했습니다.`)
  }, [activeSequenceId, commitEditor, sequenceWorkArea])

  const extractSequenceWorkArea = useCallback(() => {
    if (!sequenceWorkArea) {
      setToast('Extract할 시퀀스 작업 구간을 먼저 지정해주세요.')
      return
    }
    const targetTracks = tracksRef.current.filter((track) => track.editTarget !== false && !track.locked)
    if (!targetTracks.length) {
      setToast('잠금 해제된 소스 대상 트랙이 없습니다.')
      return
    }
    if (!commitRippleDelete(sequenceWorkArea.start, sequenceWorkArea.end, { addAudioFades: true, forcedTrackIds: targetTracks.map((track) => track.id) })) return
    setPlayhead(sequenceWorkArea.start)
    setSelectedClipId(undefined)
    setSelectedClipIds(new Set())
    setToast(`${formatTimecode(sequenceWorkArea.end - sequenceWorkArea.start, true, activeSequenceFps)} 작업 구간을 Extract했습니다.`)
  }, [activeSequenceFps, commitRippleDelete, sequenceWorkArea])

  const markSourceIn = useCallback(() => {
    if (!selectedAsset) return
    const next = Math.max(0, Math.min(sourcePlayhead, sourceDuration - 1 / 60))
    setSourceInPoint(next)
    if (sourceOutPoint !== undefined && sourceOutPoint <= next) setSourceOutPoint(undefined)
    setToast(`소스 인 점: ${next.toFixed(2)}초`)
  }, [selectedAsset, sourceDuration, sourceOutPoint, sourcePlayhead])

  const markSourceOut = useCallback(() => {
    if (!selectedAsset) return
    const minimum = (sourceInPoint ?? 0) + 1 / 60
    const next = Math.max(minimum, Math.min(sourceDuration, sourcePlayhead))
    setSourceOutPoint(next)
    setToast(`소스 아웃 점: ${next.toFixed(2)}초`)
  }, [selectedAsset, sourceDuration, sourceInPoint, sourcePlayhead])

  const clearInOut = useCallback(() => {
    if (selectedAssetId) {
      setSourceInPoint(undefined)
      setSourceOutPoint(undefined)
      setToast('소스 IN·OUT 점을 지웠습니다.')
      return
    }
    updateSequenceWorkArea(undefined)
    setToast('시퀀스 IN·OUT 점을 지웠습니다.')
  }, [selectedAssetId, updateSequenceWorkArea])

  const matchSelectedClipFrame = useCallback(() => {
    if (!selectedClip?.assetId || selectedClip.adjustmentLayer || selectedClip.nestedSequenceId) {
      setToast('원본 미디어가 연결된 일반 클립을 선택해주세요.')
      return
    }
    const sourceAssetId = selectedClip.subclipId ?? selectedClip.assetId
    const sourceAsset = assets.find((asset) => asset.id === sourceAssetId) ?? assets.find((asset) => asset.id === selectedClip.assetId)
    if (!sourceAsset) {
      setToast('선택 클립의 프로젝트 미디어를 찾지 못했습니다.')
      return
    }
    const sampleTime = Math.max(selectedClip.start, Math.min(selectedClip.start + selectedClip.duration, playhead))
    const absoluteSourceTime = clipSourceTime(selectedClip, sampleTime)
    const rootSource = sourceAsset.parentAssetId ? assets.find((asset) => asset.id === sourceAsset.parentAssetId) ?? sourceAsset : sourceAsset
    const localSourceTime = sourceMediaToTimelineTime(sourceAsset.parentAssetId ? absoluteSourceTime - (sourceAsset.subclipIn ?? 0) : absoluteSourceTime, rootSource)
    setIsPlaying(false)
    playbackClockRef.current = undefined
    setSelectedAssetId(sourceAsset.id)
    setSourcePlayhead(Math.max(0, Math.min(sourceAsset.duration, localSourceTime)))
    setToast(`Match Frame · ${sourceAsset.name} · ${formatTimecode(Math.max(0, localSourceTime), true, sourceAsset.frameRate || activeSequenceFps)}`)
  }, [activeSequenceFps, assets, playhead, selectedClip])

  const reverseMatchSourceFrame = useCallback(() => {
    if (!selectedAsset) return
    const rootAssetId = selectedAsset.parentAssetId ?? selectedAsset.id
    const absoluteSourceTime = (selectedAsset.subclipIn ?? 0) + sourceTimelineToMediaTime(sourcePlayhead, selectedSourceAsset)
    const matches = tracksRef.current.flatMap((track) => track.clips.map((clip) => ({ track, clip }))).flatMap(({ track, clip }) => {
      if (clip.assetId !== rootAssetId || selectedAsset.parentAssetId && clip.subclipId !== selectedAsset.id) return []
      const timelineTime = timelineTimeForClipSource(clip, absoluteSourceTime)
      if (timelineTime === undefined || timelineTime < clip.start - 1 / 120 || timelineTime > clip.start + clip.duration + 1 / 120) return []
      return [{ track, clip, timelineTime }]
    }).sort((left, right) => Math.abs(left.timelineTime - playhead) - Math.abs(right.timelineTime - playhead))
    const match = matches[0]
    if (!match) {
      setToast('현재 소스 프레임을 사용하는 활성 시퀀스 클립이 없습니다.')
      return
    }
    setIsPlaying(false)
    playbackClockRef.current = undefined
    setSelectedAssetId(undefined)
    setSelectedClipId(match.clip.id)
    setSelectedClipIds(new Set([match.clip.id]))
    setSelectedTrackId(match.track.id)
    setPlayhead(Math.max(match.clip.start, Math.min(match.clip.start + match.clip.duration, match.timelineTime)))
    setToast(`Reverse Match Frame · ${match.clip.name} · ${formatTimecode(match.timelineTime, true, activeSequenceFps)}`)
  }, [activeSequenceFps, playhead, selectedAsset, selectedSourceAsset, sourcePlayhead])

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false)
      return
    }
    setShuttleRate(1)
    playbackClockRef.current = undefined
    if (selectedAssetId && sourcePlayhead >= (sourceOutPoint ?? sourceDuration) - 1 / 60) setSourcePlayhead(sourceInPoint ?? 0)
    else if (!selectedAssetId && timelineLoopRange && (playhead < timelineLoopRange.start || playhead >= timelineLoopRange.end - 1 / 60)) setPlayhead(timelineLoopRange.start)
    else if (!selectedAssetId && playhead >= timelineDuration - 1 / 60) setPlayhead(0)
    setIsPlaying(true)
  }, [isPlaying, playhead, selectedAssetId, sourceDuration, sourceInPoint, sourceOutPoint, sourcePlayhead, timelineDuration, timelineLoopRange])

  const shuttle = useCallback((direction: -1 | 1) => {
    playbackClockRef.current = undefined
    setShuttleRate((current) => !isPlaying || current * direction <= 0 ? direction : direction * Math.min(4, Math.abs(current) * 2))
    if (direction < 0 && selectedAssetId && sourcePlayhead <= (sourceInPoint ?? 0) + 1 / 60) setSourcePlayhead(sourceOutPoint ?? sourceDuration)
    else if (direction < 0 && !selectedAssetId && timelineLoopRange && playhead <= timelineLoopRange.start + 1 / 60) setPlayhead(timelineLoopRange.end)
    else if (direction < 0 && !selectedAssetId && playhead <= 1 / 60) setPlayhead(timelineDuration)
    else if (direction > 0 && selectedAssetId && sourcePlayhead >= (sourceOutPoint ?? sourceDuration) - 1 / 60) setSourcePlayhead(sourceInPoint ?? 0)
    else if (direction > 0 && !selectedAssetId && timelineLoopRange && playhead >= timelineLoopRange.end - 1 / 60) setPlayhead(timelineLoopRange.start)
    else if (direction > 0 && !selectedAssetId && playhead >= timelineDuration - 1 / 60) setPlayhead(0)
    setIsPlaying(true)
  }, [isPlaying, playhead, selectedAssetId, sourceDuration, sourceInPoint, sourceOutPoint, sourcePlayhead, timelineDuration, timelineLoopRange])

  const stopShuttle = useCallback(() => {
    playbackClockRef.current = undefined
    setIsPlaying(false)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.matches('input, textarea, select') || target.isContentEditable) return
      const command = commandFromEvent(event, shortcuts)
      if (!command) return
      event.preventDefault()
      if (command === 'undo') undo()
      else if (command === 'redo') redo()
      else if (command === 'save') void saveProject()
      else if (command === 'saveAs') void saveProjectAs()
      else if (command === 'open') void openProject()
      else if (command === 'playPause') togglePlayback()
      else if (command === 'shuttleReverse') shuttle(-1)
      else if (command === 'shuttleStop') stopShuttle()
      else if (command === 'shuttleForward') shuttle(1)
      else if (command === 'markIn') selectedAssetId ? markSourceIn() : markSequenceIn()
      else if (command === 'markOut') selectedAssetId ? markSourceOut() : markSequenceOut()
      else if (command === 'clearInOut') clearInOut()
      else if (command === 'matchFrame' && !selectedAssetId) matchSelectedClipFrame()
      else if (command === 'reverseMatchFrame' && selectedAssetId) reverseMatchSourceFrame()
      else if (command === 'fitToFill' && selectedAssetId) addAssetToTimeline(selectedAssetId, 'overwrite', { fitToWorkArea: true })
      else if (command === 'replaceEdit' && selectedAssetId && selectedClipId) replaceSelectedClipFromSource()
      else if (command === 'addSource' && selectedAssetId) addAssetToTimeline(selectedAssetId)
      else if (command === 'insertSource' && selectedAssetId) addAssetToTimeline(selectedAssetId, 'insert')
      else if (command === 'overwriteSource' && selectedAssetId) addAssetToTimeline(selectedAssetId, 'overwrite')
      else if (command === 'split') splitSelected()
      else if (command === 'addEditTarget') addEditToTargetTracks()
      else if (command === 'addEditAll') addEditToAllTracks()
      else if (command === 'toggleSnap') setSnapEnabled((value) => !value)
      else if (command === 'toggleLinkedSelection') setLinkedSelectionEnabled((value) => !value)
      else if (command === 'groupClips') groupActiveClips()
      else if (command === 'ungroupClips') ungroupSelectedClip()
      else if (command === 'nestClips') nestActiveClips()
      else if (command === 'selectionTool') setActiveTool('selection')
      else if (command === 'razorTool') setActiveTool('razor')
      else if (command === 'handTool') setActiveTool('hand')
      else if (command === 'zoomTool') setActiveTool('zoom')
      else if (command === 'rippleTrimTool') { setActiveTool('selection'); setTrimMode('ripple') }
      else if (command === 'rollTrimTool') { setActiveTool('selection'); setTrimMode('roll') }
      else if (command === 'slipTool') { setActiveTool('selection'); setTrimMode('slip') }
      else if (command === 'slideTool') { setActiveTool('selection'); setTrimMode('slide') }
      else if (command === 'rateStretchTool') { setActiveTool('selection'); setTrimMode('rate-stretch') }
      else if (command === 'trackSelectForward') selectTrackForward()
      else if (command === 'trackSelectBackward') selectTrackBackward()
      else if (command === 'allTracksSelectForward') selectAllTracksForward()
      else if (command === 'allTracksSelectBackward') selectAllTracksBackward()
      else if (command === 'previousEdit') seekPreviousEditPoint()
      else if (command === 'nextEdit') seekNextEditPoint()
      else if (command === 'selectedClipStart') seekSelectedClipStart()
      else if (command === 'selectedClipEnd') seekSelectedClipEnd()
      else if (command === 'selectEditPoint') selectEditPointAtPlayhead()
      else if (command === 'applyDefaultVideoTransition') applyDefaultVideoTransition()
      else if (command === 'applyDefaultAudioTransition') applyDefaultAudioTransition()
      else if (command === 'removeTransitions') removeTransitionsAtEdit()
      else if (command === 'marker') addMarkerAtPlayhead()
      else if (command === 'delete') deleteSelected()
      else if (command === 'toggleClipEnabled') toggleSelectedClipsEnabled()
      else if (command === 'rippleDelete') rippleDeleteSelected()
      else if (command === 'closeGap') closeGapAtPlayhead()
      else if (command === 'liftWorkArea') liftSequenceWorkArea()
      else if (command === 'extractWorkArea') extractSequenceWorkArea()
      else if (command === 'selectAllClips') {
        const ids = tracksRef.current.flatMap((track) => track.clips.map((clip) => clip.id))
        setSelectedClipIds(new Set(ids))
        setSelectedClipId(ids[ids.length - 1])
        setSelectedAssetId(undefined)
      }
      else if (command === 'clearSelection') {
        setSelectedClipIds(new Set())
        setSelectedClipId(undefined)
      }
      else if (command === 'cutClips') cutSelectedClips()
      else if (command === 'copyClips') copySelectedClips()
      else if (command === 'pasteClips') pasteClipClipboard()
      else if (command === 'pasteAttributes') openPasteAttributes()
      else if (command === 'duplicateClips') duplicateSelectedClips()
      else if (command === 'duplicateTrack' && selectedTrackId) duplicateTrack(selectedTrackId)
      else if (command === 'renderAndReplace') void renderAndReplaceSelectedClip()
      else if (command === 'nudgeClipBack') nudgeSelectedClips(-1)
      else if (command === 'nudgeClipForward') nudgeSelectedClips(1)
      else if (command === 'multicam1') switchMulticamAngle(0)
      else if (command === 'multicam2') switchMulticamAngle(1)
      else if (command === 'multicam3') switchMulticamAngle(2)
      else if (command === 'multicam4') switchMulticamAngle(3)
      else if (command === 'multicam5') switchMulticamAngle(4)
      else if (command === 'multicam6') switchMulticamAngle(5)
      else if (command === 'multicam7') switchMulticamAngle(6)
      else if (command === 'multicam8') switchMulticamAngle(7)
      else if (command === 'multicam9') switchMulticamAngle(8)
      else if (command === 'frameBack') {
        if (selectedAssetId) setSourcePlayhead((time) => Math.max(0, time - 1 / activeSequenceFps))
        else setPlayhead((time) => Math.max(0, time - 1 / activeSequenceFps))
      } else if (command === 'frameForward') {
        if (selectedAssetId) setSourcePlayhead((time) => Math.min(sourceDuration, time + 1 / activeSequenceFps))
        else setPlayhead((time) => Math.min(timelineDuration, time + 1 / activeSequenceFps))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeSequenceFps, addAssetToTimeline, addEditToAllTracks, addEditToTargetTracks, addMarkerAtPlayhead, applyDefaultAudioTransition, applyDefaultVideoTransition, clearInOut, closeGapAtPlayhead, copySelectedClips, cutSelectedClips, deleteSelected, duplicateSelectedClips, duplicateTrack, extractSequenceWorkArea, groupActiveClips, liftSequenceWorkArea, markSequenceIn, markSequenceOut, markSourceIn, markSourceOut, matchSelectedClipFrame, nestActiveClips, nudgeSelectedClips, openPasteAttributes, openProject, pasteClipClipboard, redo, removeTransitionsAtEdit, renderAndReplaceSelectedClip, replaceSelectedClipFromSource, reverseMatchSourceFrame, rippleDeleteSelected, saveProject, saveProjectAs, seekNextEditPoint, seekPreviousEditPoint, seekSelectedClipEnd, seekSelectedClipStart, selectAllTracksBackward, selectAllTracksForward, selectEditPointAtPlayhead, selectedAssetId, selectedClipId, selectedTrackId, selectTrackBackward, selectTrackForward, shortcuts, shuttle, sourceDuration, splitSelected, stopShuttle, switchMulticamAngle, timelineDuration, togglePlayback, toggleSelectedClipsEnabled, undo, ungroupSelectedClip])

  return (
    <div className="app-shell">
      <Topbar
        projectName={projectName}
        onProjectNameChange={setProjectName}
        aspectRatio={aspectRatio}
        presets={sequencePresets}
        sequences={sequenceLibrary}
        activeSequenceId={activeSequenceId}
        onSequenceChange={switchSequence}
        onSequenceManager={() => setSequenceManagerOpen(true)}
        onCreateShorts={() => setShortsOpen(true)}
        onAspectRatioChange={(ratio) => {
          const nextPreset = sequencePresets.find((item) => item.ratio === ratio) ?? sequencePresets[0]
          setAspectRatio(ratio)
          setSequenceLibrary((items) => items.map((sequence) => sequence.id === activeSequenceId ? { ...sequence, aspectRatio: ratio, width: nextPreset.width, height: nextPreset.height } : sequence))
          setToast(`${ratio} 캔버스로 변경했습니다.`)
        }}
        onUndo={undo}
        onRedo={redo}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        saveState={`${saveState}${projectLock ? ` · 잠금 ${projectLock.owner.user}@${projectLock.owner.host}` : ''}`}
        onOpenProject={() => void openProject()}
        recentProjects={recentProjects}
        onOpenRecentProject={(path) => void openRecentProject(path)}
        onRemoveRecentProject={(path) => setRecentProjects(forgetRecentProject(path))}
        onNewProject={newProject}
        onSaveProject={() => void saveProject()}
        onSaveProjectAs={() => void saveProjectAs()}
        onArchiveProject={() => setProjectManagerOpen(true)}
        onImportExchange={() => void importExchangeFile()}
        archivingProject={archivingProject}
        onHistory={() => { setAutosaveHistory(readAutosaveHistory()); setHistoryOpen(true) }}
        onCheckUpdate={() => void checkUpdates()}
        checkingUpdate={checkingUpdate}
        renderQueueCount={renderJobs.filter((job) => job.status !== 'completed' && job.status !== 'cancelled').length}
        onRenderQueue={() => setRenderQueueOpen(true)}
        onShortcuts={() => setShortcutsOpen(true)}
        onAudioMixer={() => setAudioMixerOpen(true)}
        onVoiceover={() => { setVoiceoverStart(playhead); setVoiceoverOpen(true) }}
        onReview={() => setReviewOpen(true)}
        onCreatorPacks={() => setCreatorPackOpen(true)}
        onScratchDisks={() => setScratchDiskOpen(true)}
        onAiPrivacy={() => setAiPrivacyOpen(true)}
        onAiActivity={() => setAiActivityOpen(true)}
        aiActivityCount={aiActivityLog.length}
        staleSequenceIds={staleSequenceIds}
        onRefreshDerived={refreshActiveDerivedSequence}
        onSourceGraphBatch={() => setSourceGraphBatchOpen(true)}
        workspace={workspacePreferences}
        onWorkspacePreset={changeWorkspacePreset}
        onWorkspaceResize={resizeWorkspace}
        onSaveCustomWorkspace={saveCustomWorkspace}
        onExport={() => {
          setExportError(undefined)
          setExportOpen(true)
        }}
        isExporting={isExporting}
      />

      <input
        ref={projectInputRef}
        type="file"
        hidden
        accept=".json,.editweave.json,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return
          void releaseCurrentProjectLock()
            .then(() => openProjectFromBrowserFile(file))
            .then(applyProject)
            .catch((error: unknown) => setToast(error instanceof Error ? error.message : '프로젝트를 열지 못했습니다.'))
          event.target.value = ''
        }}
      />

      <input
        ref={exchangeInputRef}
        type="file"
        hidden
        accept=".otio,.xml,.fcpxml,.edl,application/json,application/xml,text/xml,text/plain"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void file.text().then((contents) => importExchangeContents(contents, file.name)).catch((error: unknown) => setToast(error instanceof Error ? error.message : '교환 파일을 읽지 못했습니다.'))
          event.target.value = ''
        }}
      />

      <SequenceTabs sequences={liveSequenceLibrary} activeSequenceId={activeSequenceId} staleSequenceIds={staleSequenceIds} onSelect={switchSequence} onDuplicate={duplicateSequence} onClose={deleteSequence} onReturnToSource={returnToSourceSequence} onManage={() => setSequenceManagerOpen(true)} />

      <ProjectManagerDialog open={projectManagerOpen} running={archivingProject} onClose={() => setProjectManagerOpen(false)} onStart={(options) => void archiveProject(options)} />
      <ScratchDiskDialog open={scratchDiskOpen} preferences={scratchDiskPreferences} onChange={setScratchDiskPreferences} onClose={() => setScratchDiskOpen(false)} onNotice={setToast} onClear={clearScratchDisk} />

      <div className={`workspace workspace-${workspacePreferences.preset}`} style={workspaceStyle}>
        <MediaPanel
          panel={activePanel}
          onPanelChange={setActivePanel}
          assets={assets}
          mediaBins={mediaBins}
          usedAssetIds={projectUsedAssetIds}
          selectedAssetId={selectedAssetId}
          onSelectAsset={setSelectedAssetId}
          onFiles={handleFiles}
          onImageSequenceFiles={handleImageSequenceFiles}
          desktop={runningInDesktop()}
          onBrowseMedia={async () => {
            try {
              return await openMediaFilesNative()
            } catch (error) {
              setToast(error instanceof Error ? `시스템 파일 선택기로 읽지 못해 기본 선택기로 전환합니다: ${error.message}` : '시스템 파일 선택기를 열지 못해 기본 선택기로 전환합니다.')
              return undefined
            }
          }}
          onBrowseMediaFolder={async () => {
            try {
              return await openMediaFolderNative()
            } catch (error) {
              setToast(error instanceof Error ? `미디어 폴더를 읽지 못했습니다: ${error.message}` : '미디어 폴더를 읽지 못했습니다.')
              return undefined
            }
          }}
          onBatchRelink={() => void batchRelinkOfflineMedia()}
          onBatchRelinkProxies={() => void batchRelinkExternalProxies()}
          onReplaceAsset={(assetId, file, preserveProxy) => void replaceMediaAsset(assetId, file, preserveProxy)}
          onAddAsset={addAssetToTimeline}
          sourceIn={sourceInPoint}
          sourceOut={sourceOutPoint}
          onCreateSubclip={createSourceSubclip}
          onCreateProxy={(assetId, maxDimension) => void createProxy(assetId, maxDimension)}
          onAttachProxy={(assetId, file) => void attachProxy(assetId, file)}
          onSelectAudioStream={(assetId, streamIndex) => void selectSourceAudioStream(assetId, streamIndex)}
          onCreateProxies={(assetIds, maxDimension) => void createProxyBatch(assetIds, maxDimension)}
          onCancelProxy={cancelProxy}
          onCancelProxies={cancelProxyBatch}
          onToggleProxy={toggleProxy}
          onSetProxiesEnabled={setProxiesEnabled}
          onDeleteProxy={(assetId) => void deleteProxy(assetId)}
          onDeleteProxies={(assetIds) => void deleteProxyBatch(assetIds)}
          onDeleteAllProxies={() => void deleteAllProxies()}
          onUpdateAsset={updateMediaAsset}
          onCreateMediaBin={(name) => setMediaBins((current) => current.includes(name) ? current : [...current, name])}
          onRenameMediaBin={(from, to) => setMediaBins((current) => [...new Set(current.map((name) => name === from ? to : name))])}
          onRemoveMediaBin={(name) => setMediaBins((current) => current.filter((candidate) => candidate !== name))}
          onExportMetadata={(assetIds) => { const selected = assetsRef.current.filter((asset) => assetIds.includes(asset.id)); void saveMediaMetadataFile(createMediaMetadataCsv(selected), `${projectName}-media-metadata`).then((path) => path && setToast(`미디어 메타데이터 ${selected.length}개를 저장했습니다: ${path}`)).catch((error: unknown) => setToast(error instanceof Error ? error.message : '미디어 메타데이터를 저장하지 못했습니다.')) }}
          onMetadataFile={(file) => { void file.text().then((contents) => {
            const previousAssets = assetsRef.current
            const result = parseMediaMetadataCsv(contents, previousAssets)
            if (result.updates.length) {
              const patches = new Map(result.updates.map((update) => [update.assetId, update.patch]))
              const conformChanges = result.updates.flatMap((update) => {
                if (!Object.prototype.hasOwnProperty.call(update.patch, 'sourceFrameRateOverride')) return []
                const previous = previousAssets.find((asset) => asset.id === update.assetId)
                if (!previous || previous.kind !== 'video') return []
                const next = { ...previous, ...update.patch }
                const previousRate = sourceFrameConformRate(previous)
                const nextRate = sourceFrameConformRate(next)
                return Math.abs(previousRate - nextRate) < .000001 ? [] : [{ assetId: update.assetId, previousRate, nextRate }]
              })
              const nextAssets = previousAssets.map((asset) => patches.has(asset.id) ? { ...asset, ...patches.get(asset.id)! } : asset)
              assetsRef.current = nextAssets
              setAssets(nextAssets)
              if (conformChanges.length) {
                const retimeTracks = (sourceTracks: TimelineTrack[]) => conformChanges.reduce((currentTracks, change) => currentTracks.map((track) => ({ ...track, clips: track.clips.map((clip) => clip.assetId === change.assetId ? retimeClipForSourceConform(clip, change.previousRate, change.nextRate) : clip) })), sourceTracks)
                commitEditor({ tracks: retimeTracks })
                setSequenceLibrary((sequences) => sequences.map((sequence) => sequence.id === activeSequenceId ? sequence : { ...sequence, tracks: retimeTracks(sequence.tracks) }))
              }
            }
            setToast(`미디어 메타데이터 ${result.updates.length}개를 반영했습니다.${result.unmatched.length ? ` 매칭되지 않은 행 ${result.unmatched.length}개.` : ''}`)
          }).catch((error: unknown) => setToast(error instanceof Error ? `메타데이터 CSV 가져오기 실패: ${error.message}` : '메타데이터 CSV를 가져오지 못했습니다.')) }}
          onRemoveAsset={(assetId) => void removeAsset(assetId)}
          onMakeAssetOffline={makeAssetOffline}
          onRemoveAssets={(assetIds) => void removeAssets(assetIds)}
          onRemoveUnusedAssets={removeUnusedAssets}
          onRevealAssetUse={revealAssetUse}
          onRevealMediaPath={revealMediaPath}
          onCopyMediaPath={copyMediaPath}
          onAutomateAssets={automateAssetsToSequence}
          onCreateMulticamSource={createMulticamFromAssets}
          sequenceMarkerCount={markers.filter((marker) => marker.kind !== 'comment' && marker.time >= playhead - 1 / activeSequenceFps).length}
          onRemoveBackground={(assetId) => void removeSelectedImageBackground(assetId)}
          backgroundRemovalRunning={backgroundRemovalRunning}
          backgroundRemovalProgress={backgroundRemovalProgress}
          backgroundRemovalStage={backgroundRemovalStage}
          onOpenComfyUi={(assetId) => {
            setComfyAssetId(assetId)
            setComfyError(undefined)
            setComfyProgress(0)
            setComfyStage('준비')
            setComfyOpen(true)
          }}
          transcript={transcript}
          sequenceFps={activeSequenceFps}
          sequenceTimecodeStart={activeSequenceTimecodeStart}
          sequenceTimecodeDropFrame={activeSequenceTimecodeDropFrame}
          selectedTranscriptId={selectedTranscriptId}
          onSelectTranscript={(segment) => {
            setSelectedTranscriptId(segment.id)
            setSelectedAssetId(undefined)
            setSelectedClipId(undefined)
            setPlayhead(segment.start)
          }}
          onUpdateTranscript={updateTranscriptText}
          onRenameSpeaker={renameTranscriptSpeaker}
          onAssignSegmentSpeaker={assignTranscriptSegmentSpeaker}
          onTranscriptEditStart={beginTranscriptEdit}
          onTranscriptEditCommit={commitTranscriptEdit}
          onRemoveTranscript={setPendingTranscriptCut}
          onSplitTranscript={splitTranscriptCue}
          onMergeTranscript={mergeTranscriptCueWithNext}
          onSubtitleFile={(file) => void importSubtitleFile(file)}
          onExportSubtitles={(format, language) => void exportSubtitles(format, language)}
          onGenerateCaptions={(language) => generateCaptionsFromTranscript(language)}
          onTranscribe={() => void runTranscription()}
          onCancelTranscription={cancelTranscription}
          onClearSpeakerProfiles={clearSpeakerProfiles}
          speakerProfileCount={new Set([...speakerVoiceProfiles.map((profile) => profile.identityId), ...transcript.map((segment) => segment.speakerIdentityId), ...sequenceLibrary.flatMap((sequence) => sequence.id === activeSequenceId ? [] : sequence.transcript.map((segment) => segment.speakerIdentityId))].filter(Boolean)).size}
          canTranscribe={Boolean(transcribableAsset)}
          transcriptionRunning={transcriptionRunning}
          transcriptionProgress={transcriptionProgress}
          transcriptionStage={transcriptionStage}
          correctionDictionary={correctionDictionary}
          onAddCorrection={(source, replacement) => setCorrectionDictionary((current) => ({ ...current, [source]: replacement }))}
          onRemoveCorrection={(source) => setCorrectionDictionary((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== source)))}
          suggestions={suggestions}
          creatorLearningProfile={creatorLearningProfile}
          onResetCreatorLearning={() => { if (window.confirm('이 프로젝트의 초벌 편집 피드백 학습을 초기화할까요? 가져온 YouTube 유지율은 유지됩니다.')) setCreatorLearningProfile((current) => resetCreatorFeedback(current)) }}
          onRetentionFile={(file) => void importAudienceRetention(file)}
          roughCutAnalysisRunning={roughCutAnalysisRunning}
          roughCutAnalysisProgress={roughCutAnalysisProgress}
          roughCutAnalysisStage={roughCutAnalysisStage}
          onAnalyzeSuggestions={() => void analyzeRoughCut()}
          onApplySuggestion={applySuggestion}
          onDismissSuggestion={dismissSuggestion}
        />
        <PreviewPanel
          preset={preset}
          fps={selectedAsset ? selectedSourceAsset?.sourceFrameRateOverride ?? selectedSourceAsset?.frameRate ?? activeSequenceFps : activeSequenceFps}
          timecodeStart={selectedAsset ? selectedAsset.timecodeStart ?? 0 : activeSequenceTimecodeStart}
          timecodeDropFrame={selectedAsset ? Boolean(selectedAsset.timecodeDropFrame) : activeSequenceTimecodeDropFrame}
          asset={effectivePreviewAsset}
          layers={selectedAsset ? [] : activeProgramLayers}
          adjustmentClips={selectedAsset ? [] : activeAdjustmentClips}
          audioLayers={selectedAsset ? [] : activeAudioLayers}
          audioBuses={audioBuses}
          captionClips={selectedAsset ? [] : activeCaptionClips}
          sourceTime={selectedAsset ? (selectedAsset.subclipIn ?? 0) + sourceTimelineToMediaTime(sourcePlayhead, selectedSourceAsset) : sourceTime}
          syncKey={previewSyncKey}
          playhead={selectedAsset ? sourcePlayhead : playhead}
          duration={selectedAsset ? sourceDuration : timelineDuration}
          isPlaying={isPlaying}
          playbackRate={selectedAsset ? shuttleRate * sourceFrameConformRate(selectedSourceAsset) : shuttleRate}
          onProgramFrame={handleProgramFrame}
          referenceFrame={programReferenceFrame?.sequenceId === activeSequenceId ? programReferenceFrame.image : undefined}
          comparisonEnabled={referenceComparisonEnabled && programReferenceFrame?.sequenceId === activeSequenceId}
          comparisonMode={referenceComparisonMode}
          comparisonPosition={referenceComparisonPosition}
          onCaptureReference={captureProgramReference}
          onToggleComparison={() => setReferenceComparisonEnabled((enabled) => !enabled)}
          onComparisonModeChange={setReferenceComparisonMode}
          onComparisonPositionChange={setReferenceComparisonPosition}
          onExportFrame={(format) => void exportProgramFrame(format)}
          multicamAngles={multicamPreviewAngles}
          onSwitchMulticamAngle={switchMulticamAngle}
          multicamAngleCount={selectedMulticamSequence?.tracks.filter((track) => track.kind === 'video').length ?? 0}
          selectedClip={selectedAsset ? undefined : selectedClip}
          selectedClipLocked={Boolean(selectedClip && tracks.some((track) => track.id === selectedClip.trackId && track.locked))}
          onUpdateSelectedClip={updateClip}
          onTogglePlayback={togglePlayback}
          onShuttleReverse={() => shuttle(-1)}
          onShuttleStop={stopShuttle}
          onShuttleForward={() => shuttle(1)}
          onSeek={(time) => {
            if (selectedAsset) setSourcePlayhead(clamp(time, 0, sourceDuration))
            else setPlayhead(clamp(time, 0, timelineDuration))
          }}
          onInsertSource={selectedAssetId ? () => addAssetToTimeline(selectedAssetId, 'insert') : undefined}
          onOverwriteSource={selectedAssetId ? () => addAssetToTimeline(selectedAssetId, 'overwrite') : undefined}
          onReplaceSelectedClip={selectedAssetId && selectedClipId ? replaceSelectedClipFromSource : undefined}
          onFitToFill={selectedAssetId && sequenceWorkArea ? () => addAssetToTimeline(selectedAssetId, 'overwrite', { fitToWorkArea: true }) : undefined}
          sourceIn={sourceInPoint}
          sourceOut={sourceOutPoint}
          onMarkIn={markSourceIn}
          onMarkOut={markSourceOut}
          onClearSourceRange={() => { setSourceInPoint(undefined); setSourceOutPoint(undefined) }}
          onReverseMatchFrame={selectedAsset ? reverseMatchSourceFrame : undefined}
        />
        <InspectorPanel
          clip={selectedClip}
          adrCue={selectedClip?.adrCueId ? adrCues.find((cue) => cue.id === selectedClip.adrCueId && cue.sequenceId === activeSequenceId) : undefined}
          track={tracks.find((track) => track.id === selectedTrackId)}
          tracks={tracks}
          asset={selectedClip?.assetId ? resolvePreviewMediaAsset(assets.find((asset) => asset.id === selectedClip.assetId)) : undefined}
          locked={selectedClipLocked}
          playhead={playhead}
          onSeek={(time) => { setSelectedAssetId(undefined); setPlayhead(clamp(time, 0, timelineDuration)) }}
          selectedClipCount={selectedClipIds.size}
          onApplyAutomationToSelection={applyClipAutomationToSelection}
          onApplyEffectPresetToSelection={applyEffectPresetToSelection}
          onApplyAudioFadesToSelection={applyAudioFadesToSelection}
          onApplyTransitionPreset={applyTransitionPreset}
          onSetDefaultTransition={setDefaultTransitionFromPreset}
          onApplyCaptionStyleToTrack={applyCaptionStyleToTrack}
          programFrame={programScopeFrame}
          referenceFrame={programReferenceFrame?.sequenceId === activeSequenceId ? programReferenceFrame.image : undefined}
          onUpdateClip={updateClip}
          onUpdateTrack={(id, patch) => commitTracks((current) => current.map((track) => track.id === id ? { ...track, ...patch } : track))}
          multicamAngles={selectedMulticamSequence?.tracks.filter((track) => track.kind === 'video').map((track, fallbackIndex) => {
            const index = track.multicamAngleIndex ?? fallbackIndex
            const prefix = `CAM ${index + 1} · `
            return { index, name: track.name.startsWith(prefix) ? track.name.slice(prefix.length) : track.name, hasAudio: selectedMulticamSequence.tracks.some((candidate) => candidate.kind === 'audio' && candidate.multicamAngleIndex === index) }
          }).sort((left, right) => left.index - right.index)}
          onRenameMulticamAngle={(index, name) => {
            if (!selectedClip?.nestedSequenceId) return
            setSequenceLibrary((sequences) => sequences.map((sequence) => sequence.id !== selectedClip.nestedSequenceId ? sequence : { ...sequence, tracks: sequence.tracks.map((track) => track.multicamAngleIndex !== index ? track : { ...track, name: track.kind === 'audio' ? `CAM ${index + 1} AUDIO · ${name}` : `CAM ${index + 1} · ${name}` }) }))
          }}
          onAssignAdrRange={assignAdrCompRange}
          onTrackMotion={(id) => void trackClipFaceMotion(id)}
          motionTracking={motionTrackingClipId === selectedClip?.id}
          onCancelMotion={() => motionTrackingAbortRef.current?.abort()}
          onDetectScenes={(id) => void detectScenesForClip(id)}
          sceneDetecting={sceneDetectionClipId === selectedClip?.id}
          onCancelSceneDetection={() => sceneDetectionAbortRef.current?.abort()}
          onTrackObject={(id) => void trackMaskedObject(id)}
          objectTracking={objectTrackingClipId === selectedClip?.id}
          onCancelObjectTracking={() => objectTrackingAbortRef.current?.abort()}
          onStabilize={(id) => void stabilizeClipMotion(id)}
          stabilizing={stabilizationClipId === selectedClip?.id}
          onCancelStabilization={() => stabilizationAbortRef.current?.abort()}
          onRemoveVideoBackground={(id) => void removeSelectedVideoBackground(id)}
          videoBackgroundRemoval={videoBackgroundRemovalClipId === selectedClip?.id}
          onCancelVideoBackgroundRemoval={() => videoBackgroundRemovalAbortRef.current?.abort()}
        />
        <Timeline
          tracks={tracks}
          assets={assets}
          markers={markers}
          multicamAngleCount={selectedMulticamSequence?.tracks.filter((track) => track.kind === 'video').length ?? 0}
          editMode={editMode}
          activeTool={activeTool}
          trimMode={trimMode}
          snapEnabled={snapEnabled}
          linkedSelectionEnabled={linkedSelectionEnabled}
          selectionFollowsPlayhead={selectionFollowsPlayhead}
          selectedTrackId={selectedTrackId}
          selectedClipId={selectedClipId}
          selectedClipIds={selectedClipIds}
          selectedClipLocked={selectedClipLocked}
          performanceHealth={performanceHealth}
          playhead={playhead}
          duration={timelineDuration}
          fps={activeSequenceFps}
          timecodeStart={activeSequenceTimecodeStart}
          timecodeDropFrame={activeSequenceTimecodeDropFrame}
          workArea={sequenceWorkArea}
          loopWorkArea={sequenceLoopPlayback}
          zoom={zoom}
          onZoomChange={setZoom}
          onMarkWorkAreaIn={markSequenceIn}
          onMarkWorkAreaOut={markSequenceOut}
          onUpdateWorkArea={updateSequenceWorkArea}
          onToggleWorkAreaLoop={toggleSequenceLoopPlayback}
          onLiftWorkArea={liftSequenceWorkArea}
          onExtractWorkArea={extractSequenceWorkArea}
          onSelectClip={(id, additive) => {
            setSelectedAssetId(undefined)
            const clicked = tracksRef.current.flatMap((track) => track.clips).find((clip) => clip.id === id)
            const relatedIds = new Set(tracksRef.current.flatMap((track) => track.clips).filter((clip) => clip.id === id || Boolean(clicked?.groupId && clip.groupId === clicked.groupId) || Boolean(linkedSelectionEnabled && clicked?.linkGroupId && clip.linkGroupId === clicked.linkGroupId)).map((clip) => clip.id))
            if (additive) {
              setSelectedClipIds((current) => {
                const next = new Set(current)
                const remove = [...relatedIds].every((relatedId) => next.has(relatedId))
                relatedIds.forEach((relatedId) => remove ? next.delete(relatedId) : next.add(relatedId))
                const remaining = [...next]
                const nextPrimary = !remove && next.has(id) ? id : remaining[remaining.length - 1]
                setSelectedClipId(nextPrimary)
                return next
              })
            } else {
              setSelectedClipId(id)
              setSelectedClipIds(relatedIds)
            }
            const track = tracks.find((item) => item.clips.some((clip) => clip.id === id))
            if (track) setSelectedTrackId(track.id)
          }}
          onSelectClips={(ids, additive) => {
            setSelectedAssetId(undefined)
            const requested = tracksRef.current.flatMap((track) => track.clips).filter((clip) => ids.includes(clip.id))
            const groupIds = new Set(requested.flatMap((clip) => clip.groupId ? [clip.groupId] : []))
            const linkIds = new Set(requested.flatMap((clip) => linkedSelectionEnabled && clip.linkGroupId ? [clip.linkGroupId] : []))
            const expandedIds = tracksRef.current.flatMap((track) => track.clips).filter((clip) => ids.includes(clip.id) || Boolean(clip.groupId && groupIds.has(clip.groupId)) || Boolean(linkedSelectionEnabled && clip.linkGroupId && linkIds.has(clip.linkGroupId))).map((clip) => clip.id)
            setSelectedClipIds((current) => {
              const next = additive ? new Set(current) : new Set<string>()
              expandedIds.forEach((id) => next.add(id))
              const ordered = [...next]
              const primary = ids[ids.length - 1] ?? ordered[ordered.length - 1]
              setSelectedClipId(primary)
              if (primary) {
                const track = tracks.find((item) => item.clips.some((clip) => clip.id === primary))
                if (track) setSelectedTrackId(track.id)
              }
              return next
            })
          }}
          onSeek={(time) => {
            setSelectedAssetId(undefined)
            setPlayhead(time)
          }}
          onMoveClip={moveTimelineClip}
          onTrimClip={trimClip}
          onUpdateClip={updateClip}
          onSplit={splitSelected}
          onAddEditTarget={addEditToTargetTracks}
          onAddEditAll={addEditToAllTracks}
          onSelectTrackForward={selectTrackForward}
          onSelectTrackBackward={selectTrackBackward}
          onSelectAllTracksForward={selectAllTracksForward}
          onSelectAllTracksBackward={selectAllTracksBackward}
          onSeekPreviousEdit={seekPreviousEditPoint}
          onSeekNextEdit={seekNextEditPoint}
          onDelete={deleteSelected}
          onToggleSelectedClipsEnabled={toggleSelectedClipsEnabled}
          onSetSelectedClipsColor={setSelectedClipsColor}
          onRippleDelete={rippleDeleteSelected}
          onCloseGap={closeGapAtPlayhead}
          onCut={cutSelectedClips}
          onCopy={copySelectedClips}
          onPaste={() => pasteClipClipboard()}
          onPasteAttributes={openPasteAttributes}
          onDuplicate={duplicateSelectedClips}
          onArrangeSelectedClips={arrangeSelectedClips}
          onMatchSelectedLoudness={matchSelectedClipLoudness}
          canPaste={hasClipClipboard}
          canPasteAttributes={Boolean(attributeSourceClipRef.current)}
          onToggleTrackMute={(id) => commitTracks((current) => current.map((track) => track.id === id ? { ...track, muted: !track.muted } : track))}
          onToggleTrackLock={(id) => commitTracks((current) => current.map((track) => track.id === id ? { ...track, locked: !track.locked } : track))}
          onToggleTrackSyncLock={(id) => {
            const target = tracksRef.current.find((track) => track.id === id)
            if (target?.clips.some((clip) => clip.adrCueId)) {
              setToast('ADR 테이크 레인은 대본 큐와 시간 기준을 유지하기 위해 동기화 잠금을 해제할 수 없습니다.')
              return
            }
            commitTracks((current) => current.map((track) => track.id === id ? { ...track, syncLock: track.syncLock === false } : track))
          }}
          onToggleTrackVisibility={(id) => commitTracks((current) => current.map((track) => track.id === id ? { ...track, visible: track.visible === false } : track))}
          onToggleTrackSolo={(id) => commitTracks((current) => current.map((track) => track.id === id ? { ...track, solo: !track.solo } : track))}
          onToggleTrackTarget={toggleTrackSourceTarget}
          onToggleTrackEditTarget={toggleTrackEditTarget}
          onSetAllTrackEditTargets={setAllTrackEditTargets}
          onSetAllTrackSyncLocks={setAllTrackSyncLocks}
          onSetTrackHeight={setTrackHeight}
          onSetAllTrackHeights={setAllTrackHeights}
          onSelectTrack={(id) => { setSelectedTrackId(id); setSelectedClipId(undefined); setSelectedAssetId(undefined) }}
          onUpdateTrack={(id, patch) => commitTracks((current) => current.map((track) => track.id === id ? { ...track, ...patch } : track))}
          onUpdateTrackTransient={updateTrackTransient}
          onUpdateClipTransient={updateClipTransient}
          onEditModeChange={setEditMode}
          onToolChange={setActiveTool}
          onTrimModeChange={(mode) => { setActiveTool('selection'); setTrimMode(mode) }}
          onToggleSnap={() => setSnapEnabled((value) => !value)}
          onToggleLinkedSelection={() => setLinkedSelectionEnabled((value) => !value)}
          onToggleSelectionFollowsPlayhead={() => setSelectionFollowsPlayhead((value) => !value)}
          onSelectEditPoint={selectEditPointAtPlayhead}
          onAddTrack={addTrack}
          onRemoveTrack={removeTrack}
          onMoveTrack={moveTrack}
          onDuplicateTrack={duplicateTrack}
          onAddMarker={addMarkerAtPlayhead}
          onAddClipMarker={addClipMarkerAtPlayhead}
          onMatchFrame={matchSelectedClipFrame}
          onUpdateClipMarker={updateClipMarker}
          onRemoveClipMarker={removeClipMarker}
          onAddRangeMarker={addRangeMarker}
          onUpdateMarker={(id, patch) => commitEditor({ markers: (current) => current.map((marker) => marker.id === id ? { ...marker, ...patch, updatedAt: new Date().toISOString() } : marker).sort((left, right) => left.time - right.time) })}
          onRemoveMarker={(id) => commitEditor({ markers: (current) => current.filter((marker) => marker.id !== id) })}
          onLinkClips={linkActiveClips}
          onUnlinkClip={unlinkSelectedClip}
          onGroupClips={groupActiveClips}
          onUngroupClip={ungroupSelectedClip}
          onAddAdjustmentLayer={addAdjustmentLayer}
          onAddTitle={addTitleAtPlayhead}
          onNestActiveClips={nestActiveClips}
          onOpenNestedSequence={openNestedSequence}
          onDetachAudio={detachSelectedAudio}
          onRenderAndReplace={() => void renderAndReplaceSelectedClip()}
          onCancelRenderAndReplace={cancelRenderAndReplace}
          onRestoreRenderedClip={restoreRenderAndReplaceClip}
          renderReplacing={Boolean(renderReplaceClipId)}
          renderReplaceProgress={renderReplaceProgress}
          renderReplaceStage={renderReplaceStage}
          onCreateMulticam={createMulticamAtPlayhead}
          onSwitchMulticamAngle={switchMulticamAngle}
          onSwitchMulticamAudioAngle={switchMulticamAudioAngle}
          multicamAudioAngles={selectedMulticamSequence ? [...new Set(selectedMulticamSequence.tracks.filter((track) => track.kind === 'audio').map((track, index) => track.multicamAngleIndex ?? index))].sort((left, right) => left - right) : []}
          onSyncByWaveform={syncNearbyClipsByWaveform}
          onSyncByClap={syncNearbyClipsByClap}
          onSyncByTimecode={syncNearbyClipsByTimecode}
          onRazorClip={splitClipAt}
        />
      </div>

      <AudioMixerDialog open={audioMixerOpen} tracks={tracks} assets={assets} audioBuses={audioBuses} adrDefaults={adrDefaults} playhead={playhead} isPlaying={isPlaying} onClose={() => setAudioMixerOpen(false)} onUpdateTrack={(id, patch) => commitTracks((current) => current.map((track) => track.id === id ? { ...track, ...patch } : track))} onUpdateTrackTransient={updateTrackTransient} onUpdateBus={commitAudioBus} onApplyTemplate={(buses, adr) => { commitEditor({ audioBuses: () => normalizeAudioBuses(buses) }); setAdrDefaults(adr) }} onUpdateAdrDefaults={setAdrDefaults} />

      <PasteAttributesDialog open={pasteAttributesOpen} sourceName={attributeSourceClipRef.current?.name ?? ''} sourceKind={attributeSourceClipRef.current?.kind ?? 'video'} targetCount={selectedClipIds.size} onClose={() => setPasteAttributesOpen(false)} onApply={pasteSelectedClipAttributes} />

      <VoiceoverDialog
        open={voiceoverOpen}
        playhead={voiceoverStart}
        activeSequenceId={activeSequenceId}
        cues={adrCues}
        assets={assets}
        defaults={adrDefaults}
        onClose={() => { setVoiceoverOpen(false); setAdrLoopRange(undefined); setIsPlaying(false) }}
        onComplete={completeVoiceover}
        onSelectCueTake={selectAdrTake}
        onSeekCue={(cueId) => { const cue = adrCues.find((item) => item.id === cueId); if (cue) { setPlayhead(cue.start); setSelectedAssetId(undefined) } }}
        onDeleteCue={deleteAdrCue}
        onLoopChange={(range) => { setAdrLoopRange(range); if (range) { setSelectedAssetId(undefined); setPlayhead(range.start); setIsPlaying(true) } else setIsPlaying(false) }}
      />

      <SceneDetectionDialog open={Boolean(sceneReview)} clipName={sceneReview?.clipName ?? ''} points={sceneReview?.points ?? []} onClose={() => setSceneReview(undefined)} onAddMarkers={addSceneMarkers} onSplit={splitAtDetectedScenes} />

      <ReviewDialog
        open={reviewOpen}
        markers={markers}
        playhead={playhead}
        fps={activeSequenceFps}
        timecodeStart={activeSequenceTimecodeStart}
        timecodeDropFrame={activeSequenceTimecodeDropFrame}
        lanSession={lanReviewSession}
        lanBusy={lanReviewBusy}
        lanError={lanReviewError}
        onClose={() => setReviewOpen(false)}
        onStartLan={() => { void startLanReview() }}
        onStopLan={() => { void stopLanReview() }}
        onCopyLan={() => { if (!lanReviewSession) return; void navigator.clipboard.writeText(lanReviewSession.url).then(() => setToast('LAN 검토 링크를 복사했습니다.')).catch(() => setToast('클립보드에 링크를 복사하지 못했습니다.')) }}
        onAdd={(label, author) => { const timestamp = new Date().toISOString(); commitEditor({ markers: (current) => [...current, { id: crypto.randomUUID(), time: playhead, label, color: '#59c9a5', kind: 'comment', status: 'open', author, createdAt: timestamp, updatedAt: timestamp } satisfies TimelineMarker].sort((a, b) => a.time - b.time) }) }}
        onUpdate={(id, patch) => commitEditor({ markers: (current) => current.map((marker) => marker.id === id ? { ...marker, ...patch, updatedAt: new Date().toISOString() } : marker) })}
        onRemove={(id) => { if (lanReviewSession) { lanReviewDeletedIdsRef.current.add(id); void deleteLanReviewComment(lanReviewSession.token, id).catch((error: unknown) => setLanReviewError(error instanceof Error ? error.message : '공유 코멘트를 삭제하지 못했습니다.')) }; commitEditor({ markers: (current) => current.filter((marker) => marker.id !== id) }) }}
        onSeek={(time) => { setSelectedAssetId(undefined); setPlayhead(time) }}
        onExport={() => { const rows = [['timecode','seconds','status','author','comment'], ...markers.filter((marker) => marker.kind === 'comment').map((marker) => [formatMediaTimecode(activeSequenceTimecodeStart + marker.time, activeSequenceFps, activeSequenceTimecodeDropFrame), marker.time.toFixed(3), marker.status ?? 'open', marker.author ?? '', marker.label])]; const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n'); void saveReviewFile(csv, `${projectName}-review`).then((path) => path && setToast(`검토 CSV를 저장했습니다: ${path}`)).catch((error: unknown) => setToast(error instanceof Error ? error.message : '검토 CSV를 저장하지 못했습니다.')) }}
        onExportPackage={() => { const contents = JSON.stringify(createReviewPackage(projectId, projectName, activeSequenceId, markers), null, 2); void saveReviewPackageFile(contents, `${projectName}-review`).then((path) => path && setToast(`검토 패키지를 저장했습니다: ${path}`)).catch((error: unknown) => setToast(error instanceof Error ? error.message : '검토 패키지를 저장하지 못했습니다.')) }}
        onImportPackage={(file) => { void file.text().then(parseReviewPackage).then((reviewPackage) => { if (reviewPackage.projectId !== projectId && !window.confirm(`“${reviewPackage.projectName}”의 다른 프로젝트 검토 패키지입니다. 현재 타임라인 시간에 병합할까요?`)) return; const result = mergeReviewComments(markersRef.current, reviewPackage.comments); commitEditor({ markers: () => result.markers }); setToast(`검토 패키지 병합: ${result.added}개 추가 · ${result.updated}개 갱신`); }).catch((error: unknown) => setToast(error instanceof Error ? error.message : '검토 패키지를 읽지 못했습니다.')) }}
      />

      <CreatorPackDialog open={creatorPackOpen} onClose={() => setCreatorPackOpen(false)} onNotice={setToast} />

      <ExportDialog
        open={exportOpen}
        preset={preset}
        projectName={projectName}
        duration={exportDuration}
        sequenceFps={activeSequenceFps}
        workArea={sequenceWorkArea}
        selectedRange={exportSelectedRange}
        canExport={exportableVideoClips.length > 0 && !deliveryBlocked}
        canExportAudio={exportableAudioClips.length > 0}
        isExporting={isExporting}
        progress={exportProgress}
        stage={exportStage}
        error={exportError}
        onClose={() => setExportOpen(false)}
        onStart={(request) => void startExport(request)}
        onAudioStart={(request) => void startAudioMasterExport(request)}
        onAudioQueue={enqueueAudioExport}
        onQueue={enqueueExport}
        batchCount={exportableShortsSequences.length}
        onBatchStart={(request) => void startBatchExport(request)}
        onBatchQueue={enqueueBatchExport}
        onExportExchange={(format) => void exportExchange(format)}
        onCreateDeliveryPackage={() => void createCurrentDeliveryPackage()}
        onCancel={cancelActiveRender}
        paused={isExportPaused}
        onPause={pauseActiveRender}
        onResume={resumeActiveRender}
        deliveryIssues={deliveryIssues}
      />

      <ShortsDialog
        open={shortsOpen}
        candidates={shortsCandidates}
        onClose={() => setShortsOpen(false)}
        onCreate={createShortsVersions}
      />

      {(() => {
        const derived = derivedSyncRequest ? graphSequences.find((sequence) => sequence.id === derivedSyncRequest.derivedId) : undefined
        const source = derivedSyncRequest ? graphSequences.find((sequence) => sequence.id === derivedSyncRequest.sourceId) : undefined
        const impact = derived ? inspectDerivedSequenceImpact(derived, source) : undefined
        return <DerivedSyncDialog
          open={Boolean(derived && source && impact)}
          sourceName={source?.name ?? '원본 시퀀스'}
          derivedName={derived?.name ?? '파생 시퀀스'}
          changedDomains={impact?.changedDomains ?? []}
          legacySnapshot={impact?.legacySnapshot}
          onClose={() => setDerivedSyncRequest(undefined)}
          onApply={applyDerivedSynchronization}
        />
      })()}

      <SourceGraphBatchDialog
        open={sourceGraphBatchOpen}
        inspection={sourceGraphBatchInspection}
        onClose={() => setSourceGraphBatchOpen(false)}
        onApply={applyBatchDerivedSynchronization}
      />

      <ShortcutDialog open={shortcutsOpen} shortcuts={shortcuts} onChange={setShortcuts} onClose={() => setShortcutsOpen(false)} />

      <SequenceManagerDialog
        open={sequenceManagerOpen}
        sequences={liveSequenceLibrary}
        activeSequenceId={activeSequenceId}
        adrCues={adrCues}
        deleteAssessments={sequenceDeleteAssessments}
        onClose={() => setSequenceManagerOpen(false)}
        onCreate={createBlankSequence}
        onSelect={switchSequence}
        onRename={renameSequence}
        onUpdateSettings={updateSequenceSettings}
        onDuplicate={duplicateSequence}
        onDelete={deleteSequence}
      />

      <TranscriptCutDialog segment={pendingTranscriptCut} affectedClips={pendingTranscriptCut ? tracks.flatMap((track) => track.clips).filter((clip) => clip.start < pendingTranscriptCut.end && clip.start + clip.duration > pendingTranscriptCut.start).length : 0} onClose={() => setPendingTranscriptCut(undefined)} onConfirm={(addAudioFades) => pendingTranscriptCut && removeTranscriptSegment(pendingTranscriptCut, addAudioFades)} />

      <ProjectHistoryDialog open={historyOpen} snapshots={autosaveHistory} currentProject={buildProjectDocument()} mergeSessions={mergeSessions} onResolveConflict={resolveMergeConflict} onLocateConflict={locateMergeConflict} onClose={() => setHistoryOpen(false)} onRestore={(snapshot) => { applyProject(snapshot, { trustStableMediaIds: true }); setHistoryOpen(false); setToast('선택한 자동 저장 버전을 복원했습니다. 정상 원본 연결은 유지됩니다.') }} onBranch={(snapshot, sequenceId) => { try { applyProject(branchSequenceFromVersion(buildProjectDocument(), snapshot, sequenceId), { trustStableMediaIds: true }); setHistoryOpen(false); setToast('선택 버전을 새 시퀀스 분기로 가져왔습니다. 현재 작업과 원본 연결은 보존됩니다.') } catch (error) { setToast(error instanceof Error ? error.message : '버전 분기를 가져오지 못했습니다.') } }} onMerge={(base, file) => { void file.text().then(parseProjectDocument).then((incoming) => { const result = mergeProjectVersions(base, buildProjectDocument(), incoming); const summary = result.conflicts.length ? `클립 ${result.autoMergedClips}개를 자동 반영하고 충돌 ${result.conflicts.length}개를 상대 분기 ${result.conflictBranchIds.length}개와 병합 기록으로 보존합니다.` : `클립 ${result.autoMergedClips}개와 시퀀스 ${result.mergedSequences}개를 충돌 없이 반영합니다.`; if (!window.confirm(`${summary}\n\n선택한 체크포인트가 두 편집자의 실제 공통 기준일 때만 계속하세요. 현재 프로젝트에 병합할까요?`)) return; applyProject(result.project); setHistoryOpen(false); setToast(result.conflicts.length ? `공동 작업 병합: 클립 ${result.autoMergedClips}개 자동 반영 · 충돌 ${result.conflicts.length}개 · 상대 분기 ${result.conflictBranchIds.length}개 · 병합 기록 저장` : `공동 작업 병합: 클립 ${result.autoMergedClips}개 · 시퀀스 ${result.mergedSequences}개를 충돌 없이 반영했습니다.`) }).catch((error: unknown) => setToast(error instanceof Error ? error.message : '상대 프로젝트를 병합하지 못했습니다.')) }} />

      <AiPrivacyDialog open={aiPrivacyOpen} settings={aiPrivacySettings} onChange={(settings) => setAiPrivacySettings(writeAiPrivacySettings(settings))} onClose={() => setAiPrivacyOpen(false)} />

      <AiActivityDialog open={aiActivityOpen} records={aiActivityLog} onClose={() => setAiActivityOpen(false)} />

      <ComfyDialog
        open={comfyOpen}
        asset={assets.find((asset) => asset.id === comfyAssetId)}
        running={comfyRunning}
        progress={comfyProgress}
        stage={comfyStage}
        error={comfyError}
        externalProcessingAllowed={aiPrivacySettings.externalComfyUiAllowed}
        onClose={() => !comfyRunning && setComfyOpen(false)}
        onExternalProcessingAllowedChange={(allowed) => setAiPrivacySettings(writeAiPrivacySettings({ ...aiPrivacySettings, externalComfyUiAllowed: allowed }))}
        onRun={(endpoint, workflow) => void runSelectedComfyWorkflow(endpoint, workflow)}
        onCancel={() => comfyAbortRef.current?.abort()}
      />

      <RenderQueueDialog
        open={renderQueueOpen}
        jobs={renderJobs}
        currentProjectId={projectId}
        activeJobId={activeRenderJobId}
        paused={isExportPaused}
        queueRunning={queueRunnerActive}
        onClose={() => setRenderQueueOpen(false)}
        onPause={pauseActiveRender}
        onResume={resumeActiveRender}
        onCancel={cancelActiveRender}
        onRetry={retryRenderJob}
        onRemove={removeRenderJob}
        onClearFinished={clearFinishedRenderJobs}
        onStartQueue={() => void startRenderQueue()}
        onStopQueue={stopRenderQueue}
        onMoveQueued={moveQueuedRenderJob}
        onRefreshSnapshot={refreshRenderJobSnapshot}
      />

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
