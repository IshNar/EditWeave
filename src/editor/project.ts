import { sequencePresets } from './demo'
import { normalizeAudioBuses } from './audioBuses'
import { normalizeSourceTargets } from './trackTargeting'
import { normalizeSequenceTransitionDefaults } from './transitions'
import { assertProjectIntegrity } from './projectIntegrity'
import type { AdrCue, AiActivityRecord, AspectRatio, AudioBusMap, CreatorLearningProfile, CutlineProjectDocument, EditSuggestion, MediaAsset, PersistedMediaAsset, ProjectMergeConflictKind, ProjectMergeSession, ProjectSequence, SpeakerVoiceProfile, TimelineMarker, TimelineTrack, TranscriptSegment } from './types'
import { normalizeAiActivityLog } from '../ai/activity'

export const PROJECT_EXTENSION = 'cutline.json'
export const AUTOSAVE_KEY = 'cutline.autosave.v1'
export const AUTOSAVE_HISTORY_KEY = 'cutline.autosave.history.v1'
const LEGACY_DEMO_CLIP_IDS = new Set(['clip-intro', 'clip-topic', 'clip-demo', 'clip-outro', 'audio-dialogue', 'caption-1', 'caption-2'])
const MERGE_CONFLICT_KINDS = new Set<ProjectMergeConflictKind>(['sequence', 'track', 'clip', 'transcript', 'suggestion', 'marker', 'audio-bus', 'asset', 'adr-cue', 'dictionary'])

interface ProjectSnapshotInput {
  id: string
  createdAt: string
  name: string
  aspectRatio: AspectRatio
  assets: MediaAsset[]
  mediaBins?: string[]
  tracks: TimelineTrack[]
  transcript?: TranscriptSegment[]
  suggestions?: EditSuggestion[]
  markers?: TimelineMarker[]
  audioBuses?: AudioBusMap
  playhead?: number
  activeSequenceId?: string
  sequences?: ProjectSequence[]
  correctionDictionary?: Record<string, string>
  speakerVoiceProfiles?: SpeakerVoiceProfile[]
  adrCues?: AdrCue[]
  creatorLearningProfile?: CreatorLearningProfile
  mergeSessions?: ProjectMergeSession[]
  aiActivityLog?: AiActivityRecord[]
}

export function createProjectDocument(input: ProjectSnapshotInput): CutlineProjectDocument {
  const preset = sequencePresets.find((item) => item.ratio === input.aspectRatio) ?? sequencePresets[0]
  const now = new Date().toISOString()
  const activeSequenceId = input.activeSequenceId ?? 'sequence-main'
  const existingActive = input.sequences?.find((sequence) => sequence.id === activeSequenceId)
  const activeSequence: ProjectSequence = {
    ...existingActive,
    id: activeSequenceId,
    name: existingActive?.name ?? '메인 시퀀스',
    kind: existingActive?.kind ?? 'main',
    aspectRatio: preset.ratio,
    width: preset.width,
    height: preset.height,
    fps: existingActive?.fps ?? 30,
    transitionDefaults: normalizeSequenceTransitionDefaults(existingActive?.transitionDefaults),
    tracks: normalizeSourceTargets(input.tracks),
    transcript: input.transcript ?? [],
    suggestions: input.suggestions ?? [],
    markers: input.markers ?? existingActive?.markers ?? [],
    audioBuses: normalizeAudioBuses(input.audioBuses ?? existingActive?.audioBuses),
    playhead: input.playhead ?? existingActive?.playhead,
    createdAt: existingActive?.createdAt ?? input.createdAt,
  }
  const sequences = input.sequences?.length
    ? input.sequences.some((sequence) => sequence.id === activeSequenceId)
      ? input.sequences.map((sequence) => sequence.id === activeSequenceId ? activeSequence : { ...sequence, transitionDefaults: normalizeSequenceTransitionDefaults(sequence.transitionDefaults), tracks: normalizeSourceTargets(sequence.tracks) })
      : [...input.sequences.map((sequence) => ({ ...sequence, transitionDefaults: normalizeSequenceTransitionDefaults(sequence.transitionDefaults), tracks: normalizeSourceTargets(sequence.tracks) })), activeSequence]
    : [activeSequence]

  return {
    schemaVersion: 1,
    id: input.id,
    name: input.name.trim() || '제목 없는 프로젝트',
    createdAt: input.createdAt,
    updatedAt: now,
    sequence: {
      id: activeSequence.id,
      name: activeSequence.name,
      aspectRatio: activeSequence.aspectRatio,
      width: activeSequence.width,
      height: activeSequence.height,
      fps: activeSequence.fps,
      timecodeStart: activeSequence.timecodeStart,
      timecodeDropFrame: activeSequence.timecodeDropFrame,
    },
    assets: input.assets.map(({ url: _url, sourceFile: _sourceFile, imageSequenceFiles: _imageSequenceFiles, imageSequenceUrls: _imageSequenceUrls, thumbnailUrl: _thumbnailUrl, waveform: _waveform, analysisStartedAt: _analysisStartedAt, proxyFile: _proxyFile, proxyUrl: _proxyUrl, proxyStatus: _proxyStatus, proxyProgress: _proxyProgress, proxyError: _proxyError, useProxy, proxyEnabled, proxyCachePath, proxySourcePath, proxySourceName, proxyOrigin, proxyCachedAt, proxySize, proxyWidth, proxyHeight, proxyFrameRate, status, ...asset }) => ({
      ...asset,
      ...(proxyCachePath ? { proxyCachePath, proxyCachedAt, proxySize, proxyWidth, proxyHeight, proxyFrameRate } : {}),
      ...(proxySourcePath ? { proxySourcePath, proxySourceName, proxyOrigin: proxyOrigin ?? 'attached', proxySize, proxyWidth, proxyHeight, proxyFrameRate } : {}),
      ...(proxyCachePath || proxySourcePath ? { proxyEnabled: proxyEnabled ?? Boolean(useProxy) } : {}),
      status: status === 'error' ? 'error' : status === 'offline' ? 'offline' : 'ready',
    })),
    mediaBins: [...new Set([...(input.mediaBins ?? []), ...input.assets.map((asset) => asset.folder ?? '')].map((name) => name.trim()).filter(Boolean))],
    tracks: activeSequence.tracks,
    transcript: input.transcript ?? [],
    suggestions: input.suggestions ?? [],
    markers: input.markers ?? [],
    audioBuses: normalizeAudioBuses(input.audioBuses),
    activeSequenceId,
    sequences,
    correctionDictionary: input.correctionDictionary ?? {},
    speakerVoiceProfiles: input.speakerVoiceProfiles ?? [],
    adrCues: input.adrCues ?? [],
    creatorLearningProfile: input.creatorLearningProfile,
    mergeSessions: input.mergeSessions ?? [],
    aiActivityLog: normalizeAiActivityLog(input.aiActivityLog),
  }
}

export function getProjectSequences(project: CutlineProjectDocument): ProjectSequence[] {
  if (project.sequences?.length) return project.sequences.map((sequence) => ({ ...sequence, transitionDefaults: normalizeSequenceTransitionDefaults(sequence.transitionDefaults), tracks: normalizeSourceTargets(sequence.tracks), audioBuses: normalizeAudioBuses(sequence.audioBuses) }))
  return [{
    id: project.sequence.id,
    name: project.sequence.name,
    kind: 'main',
    aspectRatio: project.sequence.aspectRatio,
    width: project.sequence.width,
    height: project.sequence.height,
    fps: project.sequence.fps,
    timecodeStart: project.sequence.timecodeStart,
    timecodeDropFrame: project.sequence.timecodeDropFrame,
    transitionDefaults: normalizeSequenceTransitionDefaults(),
    tracks: normalizeSourceTargets(project.tracks),
    transcript: project.transcript ?? [],
    suggestions: project.suggestions ?? [],
    markers: project.markers ?? [],
    audioBuses: normalizeAudioBuses(project.audioBuses),
    createdAt: project.createdAt,
  }]
}

export function saveAutosave(project: CutlineProjectDocument): boolean {
  try {
    const history = readAutosaveHistory()
    const latest = history[history.length - 1]
    const replaceLatest = latest && new Date(project.updatedAt).getTime() - new Date(latest.updatedAt).getTime() < 30_000
    const nextHistory = (replaceLatest ? [...history.slice(0, -1), project] : [...history, project]).slice(-5)
    localStorage.setItem(AUTOSAVE_HISTORY_KEY, JSON.stringify(nextHistory))
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project))
    return true
  } catch {
    return false
  }
}

export function readAutosaveHistory(): CutlineProjectDocument[] {
  const raw = localStorage.getItem(AUTOSAVE_HISTORY_KEY)
  if (!raw) return []
  try {
    const values: unknown = JSON.parse(raw)
    if (!Array.isArray(values)) return []
    return values.flatMap((value) => {
      try {
        return [parseProjectDocument(JSON.stringify(value))]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

export function readAutosave(): CutlineProjectDocument | undefined {
  const raw = localStorage.getItem(AUTOSAVE_KEY)
  if (!raw) return undefined
  try {
    return parseProjectDocument(raw)
  } catch {
    return undefined
  }
}

export function parseProjectDocument(raw: string): CutlineProjectDocument {
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object') throw new Error('프로젝트 파일 형식이 올바르지 않습니다.')
  const candidate = value as Partial<CutlineProjectDocument>
  if (candidate.schemaVersion !== 1) throw new Error('지원하지 않는 프로젝트 파일 버전입니다.')
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || !candidate.sequence || !Array.isArray(candidate.tracks) || !Array.isArray(candidate.assets)) {
    throw new Error('프로젝트에 필수 데이터가 없습니다.')
  }
  const validTrackShape = (track: unknown): track is TimelineTrack => Boolean(track && typeof track === 'object' && typeof (track as TimelineTrack).id === 'string' && Array.isArray((track as TimelineTrack).clips))
  if (!candidate.tracks.every(validTrackShape) || candidate.assets.some((asset) => !asset || typeof asset !== 'object' || typeof asset.id !== 'string')) throw new Error('프로젝트의 미디어 또는 트랙 데이터가 손상됐습니다.')
  if (candidate.sequences !== undefined && (!Array.isArray(candidate.sequences) || candidate.sequences.some((sequence) => !sequence || typeof sequence !== 'object' || typeof sequence.id !== 'string' || !Array.isArray(sequence.tracks) || !sequence.tracks.every(validTrackShape) || !Array.isArray(sequence.transcript) || !Array.isArray(sequence.suggestions)))) throw new Error('프로젝트의 시퀀스 데이터가 손상됐습니다.')
  const project = candidate as CutlineProjectDocument
  const normalized: CutlineProjectDocument = {
    ...project,
    mediaBins: [...new Set([...(Array.isArray(project.mediaBins) ? project.mediaBins : []), ...project.assets.map((asset) => asset.folder ?? '')].filter((name): name is string => typeof name === 'string').map((name) => name.trim()).filter(Boolean))],
    assets: project.assets.map((asset) => ({ ...asset, audioPeak: normalizePersistedAudioPeak(asset.audioPeak) })),
    adrCues: Array.isArray(project.adrCues) ? project.adrCues : [],
    speakerVoiceProfiles: Array.isArray(project.speakerVoiceProfiles) ? project.speakerVoiceProfiles.filter((profile) => profile && typeof profile.identityId === 'string' && typeof profile.speaker === 'string' && typeof profile.embeddingVersion === 'string' && Array.isArray(profile.centroid) && profile.centroid.every(Number.isFinite) && Number.isFinite(profile.sampleWeight)) : [],
    tracks: removeLegacyDemoClips(project.tracks),
    audioBuses: normalizeAudioBuses(project.audioBuses),
    sequences: project.sequences?.map((sequence) => ({ ...sequence, transitionDefaults: normalizeSequenceTransitionDefaults(sequence.transitionDefaults), audioBuses: normalizeAudioBuses(sequence.audioBuses), tracks: removeLegacyDemoClips(sequence.tracks) })),
    mergeSessions: normalizeMergeSessions(project.mergeSessions),
  }
  assertProjectIntegrity(normalized)
  return normalized
}

function normalizeMergeSessions(value: ProjectMergeSession[] | undefined): ProjectMergeSession[] {
  if (!Array.isArray(value)) return []
  return value.slice(-20).flatMap((session) => {
    if (!session || typeof session.id !== 'string' || !Array.isArray(session.conflicts)) return []
    const conflicts = session.conflicts.flatMap((conflict) => conflict && MERGE_CONFLICT_KINDS.has(conflict.kind) && typeof conflict.id === 'string' && typeof conflict.entityId === 'string' && typeof conflict.label === 'string' ? [{
      ...conflict,
      status: conflict.status === 'resolved' ? 'resolved' as const : 'open' as const,
      resolution: conflict.resolution === 'incoming' ? 'incoming' as const : conflict.resolution === 'current' ? 'current' as const : undefined,
      canApplyIncoming: conflict.kind === 'asset' && (conflict.incomingDeleted || conflict.incomingSnapshot !== undefined)
        ? true
        : typeof conflict.canApplyIncoming === 'boolean'
          ? conflict.canApplyIncoming
          : conflict.kind === 'clip' && Boolean(conflict.branchEntityId || conflict.incomingDeleted),
    }] : [])
    return [{ ...session, status: conflicts.length > 0 && conflicts.every((conflict) => conflict.status === 'resolved') ? 'resolved' as const : 'open' as const, conflicts }]
  })
}

function normalizePersistedAudioPeak(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 64 ? value : undefined
}

function removeLegacyDemoClips(tracks: TimelineTrack[]): TimelineTrack[] {
  return normalizeSourceTargets(tracks.map((track) => ({
    ...track,
    clips: track.clips.filter((clip) => !LEGACY_DEMO_CLIP_IDS.has(clip.id)).map((clip) => clip.audioAdjustment ? {
      ...clip,
      audioAdjustment: { ...clip.audioAdjustment, preservePitch: typeof clip.audioAdjustment.preservePitch === 'boolean' ? clip.audioAdjustment.preservePitch : true },
    } : clip),
  })))
}

function restorePersistedAsset(asset: PersistedMediaAsset): MediaAsset {
  return {
    ...asset,
    url: '',
    status: 'offline',
    proxyStatus: asset.proxyCachePath || asset.proxySourcePath ? 'loading' : 'none',
    useProxy: false,
  }
}

export function restoreAssets(project: CutlineProjectDocument): MediaAsset[] {
  return project.assets.map(restorePersistedAsset)
}

function sameMediaIdentity(current: MediaAsset, persisted: PersistedMediaAsset): boolean {
  const hasComparableSignatures = current.sourceQuickSignature !== undefined && persisted.sourceQuickSignature !== undefined
  const sourceRevisionMatches = hasComparableSignatures
    ? current.sourceQuickSignature === persisted.sourceQuickSignature
    : current.sourceLastModified === undefined || persisted.sourceLastModified === undefined || Math.abs(current.sourceLastModified - persisted.sourceLastModified) < 2_000
  return current.name === persisted.name
    && current.kind === persisted.kind
    && current.extension.toLowerCase() === persisted.extension.toLowerCase()
    && current.size === persisted.size
    && sourceRevisionMatches
    && Math.abs(current.duration - persisted.duration) <= 0.05
}

/**
 * Applies persisted collaboration metadata without discarding a valid File/ObjectURL
 * already connected on this machine. Source and proxy paths are machine-local, so the
 * current live handles win only when the media identity is unchanged.
 */
export function reconcileProjectAssets(currentAssets: MediaAsset[], persistedAssets: PersistedMediaAsset[], options: { trustStableIds?: boolean } = {}): MediaAsset[] {
  const currentById = new Map(currentAssets.map((asset) => [asset.id, asset]))
  return persistedAssets.map((persisted) => {
    const current = currentById.get(persisted.id)
    if (!current || (!options.trustStableIds && !sameMediaIdentity(current, persisted))) return restorePersistedAsset(persisted)
    return {
      ...persisted,
      url: current.url,
      sourceFile: current.sourceFile,
      sourcePath: current.sourcePath ?? persisted.sourcePath,
      streamingSource: current.streamingSource,
      thumbnailUrl: current.thumbnailUrl,
      waveform: current.waveform,
      status: current.status,
      error: current.error,
      proxyFile: current.proxyFile,
      proxyUrl: current.proxyUrl,
      proxyCachePath: current.proxyCachePath ?? persisted.proxyCachePath,
      proxySourcePath: current.proxySourcePath ?? persisted.proxySourcePath,
      proxySourceName: current.proxySourceName ?? persisted.proxySourceName,
      proxyOrigin: current.proxyOrigin ?? persisted.proxyOrigin,
      proxyPurpose: current.proxyPurpose ?? persisted.proxyPurpose,
      proxyEnabled: current.proxyEnabled ?? persisted.proxyEnabled,
      proxyCachedAt: current.proxyCachedAt ?? persisted.proxyCachedAt,
      proxySize: current.proxySize ?? persisted.proxySize,
      proxyWidth: current.proxyWidth ?? persisted.proxyWidth,
      proxyHeight: current.proxyHeight ?? persisted.proxyHeight,
      proxyFrameRate: current.proxyFrameRate ?? persisted.proxyFrameRate,
      proxyTimecode: current.proxyTimecode ?? persisted.proxyTimecode,
      proxyTimecodeVerified: current.proxyTimecodeVerified ?? persisted.proxyTimecodeVerified,
      proxyTimecodeMismatch: current.proxyTimecodeMismatch ?? persisted.proxyTimecodeMismatch,
      proxyStatus: current.proxyStatus ?? (persisted.proxyCachePath || persisted.proxySourcePath ? 'loading' : 'none'),
      proxyProgress: current.proxyProgress,
      proxyError: current.proxyError,
      useProxy: Boolean((current.proxyEnabled ?? current.useProxy) && (current.proxyFile || current.proxyUrl)),
    }
  })
}
