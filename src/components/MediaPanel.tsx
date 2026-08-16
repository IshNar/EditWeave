import { AlertCircle, Captions, Check, Copy, Download, FileAudio2, FileText, Film, FolderOpen, FolderPen, FolderPlus, FolderX, Grid2X2, Image, List, ListVideo, LoaderCircle, Mic2, RefreshCw, Search, Sparkles, Star, Tag, Trash2, Upload, Video, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react'
import { formatDuration, formatFileSize, formatTimecode } from '../editor/format'
import { defaultAudioAdjustment, defaultColorAdjustment, defaultVisualEffects } from '../editor/effects'
import type { CreatorLearningProfile, EditSuggestion, EditorPanel, MediaAsset, TranscriptSegment } from '../editor/types'
import { assessMediaHealth } from '../media/compatibility'
import { IMAGE_FILE_ACCEPT, MEDIA_FILE_ACCEPT } from '../media/extensions'
import { formatMediaTimecode, parseMediaTimecode } from '../media/timecode'
import { effectiveSourceColorLabel, interpretedSourceDuration } from '../editor/sourceInterpretation'
import { parseCubeLut } from '../editor/lut'
import type { MediaFileReadFailure, MediaFileReadResult } from '../platform/projectFiles'
import { AutomateSequenceDialog, type AutomateSequenceOptions } from './AutomateSequenceDialog'
import { MulticamSourceDialog, type MulticamSourceOptions } from './MulticamSourceDialog'

interface MediaPanelProps {
  panel: EditorPanel
  onPanelChange: (panel: EditorPanel) => void
  assets: MediaAsset[]
  mediaBins: string[]
  usedAssetIds: Set<string>
  selectedAssetId?: string
  onSelectAsset: (assetId?: string) => void
  onFiles: (files: FileList | File[], failures?: MediaFileReadFailure[], bins?: string[]) => void
  onImageSequenceFiles: (files: FileList | File[], frameRate: number) => void
  desktop: boolean
  onBrowseMedia: () => Promise<MediaFileReadResult | undefined>
  onBrowseMediaFolder: () => Promise<MediaFileReadResult | undefined>
  onBatchRelink: () => void
  onBatchRelinkProxies: () => void
  onReplaceAsset: (assetId: string, file: File, preserveProxy?: boolean) => void
  onAddAsset: (assetId: string) => void
  sourceIn?: number
  sourceOut?: number
  onCreateSubclip: (assetId: string) => void
  onCreateProxy: (assetId: string, maxDimension?: number) => void
  onAttachProxy: (assetId: string, file: File) => void
  onSelectAudioStream: (assetId: string, streamIndex: number) => void
  onCreateProxies: (assetIds: string[], maxDimension?: number) => void
  onCancelProxy: (assetId: string) => void
  onCancelProxies: (assetIds: string[]) => void
  onToggleProxy: (assetId: string) => void
  onSetProxiesEnabled: (assetIds: string[], enabled: boolean) => void
  onDeleteProxy: (assetId: string) => void
  onDeleteProxies: (assetIds: string[]) => void
  onDeleteAllProxies: () => void
  onUpdateAsset: (assetId: string, patch: Partial<MediaAsset>) => void
  onCreateMediaBin: (name: string) => void
  onRenameMediaBin: (from: string, to: string) => void
  onRemoveMediaBin: (name: string) => void
  onExportMetadata: (assetIds: string[]) => void
  onMetadataFile: (file: File) => void
  onRemoveAsset: (assetId: string) => void
  onMakeAssetOffline: (assetId: string) => void
  onRemoveAssets: (assetIds: string[]) => void
  onRemoveUnusedAssets: () => void
  onRevealAssetUse: (assetId: string) => void
  onRevealMediaPath: (path: string) => void
  onCopyMediaPath: (path: string) => void
  onAutomateAssets: (assetIds: string[], options: AutomateSequenceOptions) => void
  onCreateMulticamSource: (assetIds: string[], options: MulticamSourceOptions) => void
  sequenceMarkerCount: number
  onRemoveBackground: (assetId: string) => void
  backgroundRemovalRunning: boolean
  backgroundRemovalProgress: number
  backgroundRemovalStage: string
  onOpenComfyUi: (assetId: string) => void
  transcript: TranscriptSegment[]
  sequenceFps: number
  sequenceTimecodeStart: number
  sequenceTimecodeDropFrame: boolean
  selectedTranscriptId?: string
  onSelectTranscript: (segment: TranscriptSegment) => void
  onUpdateTranscript: (id: string, patch: Partial<TranscriptSegment>) => void
  onRenameSpeaker: (segmentId: string, from: string, to: string) => void
  onAssignSegmentSpeaker: (id: string, speaker?: string) => void
  onTranscriptEditStart: () => void
  onTranscriptEditCommit: () => void
  onRemoveTranscript: (segment: TranscriptSegment) => void
  onSplitTranscript: (segmentId: string) => void
  onMergeTranscript: (segmentId: string) => void
  onSubtitleFile: (file: File) => void
  onExportSubtitles: (format: 'srt' | 'vtt' | 'ttml', language?: string) => void
  onGenerateCaptions: (language?: string) => void
  onTranscribe: () => void
  onCancelTranscription: () => void
  onClearSpeakerProfiles: () => void
  speakerProfileCount: number
  canTranscribe: boolean
  transcriptionRunning: boolean
  transcriptionProgress: number
  transcriptionStage: string
  correctionDictionary: Record<string, string>
  onAddCorrection: (source: string, replacement: string) => void
  onRemoveCorrection: (source: string) => void
  suggestions: EditSuggestion[]
  creatorLearningProfile: CreatorLearningProfile
  onResetCreatorLearning: () => void
  onRetentionFile: (file: File) => void
  roughCutAnalysisRunning: boolean
  roughCutAnalysisProgress: number
  roughCutAnalysisStage: string
  onAnalyzeSuggestions: () => void
  onApplySuggestion: (suggestion: EditSuggestion) => void
  onDismissSuggestion: (id: string) => void
}

const tabs = [
  { id: 'media' as const, label: '미디어', icon: Film },
  { id: 'transcript' as const, label: '대본', icon: Captions },
  { id: 'ai' as const, label: 'AI 초벌', icon: Sparkles },
]

function searchableAssetText(asset: MediaAsset): string {
  const orientation = (asset.width ?? 0) < (asset.height ?? 0) ? '세로 포트레이트 쇼츠' : '가로 랜드스케이프 롱폼'
  const resolution = (asset.width ?? 0) >= 3840 ? '4k uhd 고해상도' : (asset.width ?? 0) >= 1920 ? 'fhd 1080p' : 'hd'
  const diagnostics = [asset.variableFrameRate ? 'vfr 가변 프레임' : 'cfr', asset.faceTrack?.length ? '얼굴 인물 사람' : '', asset.proxyStatus === 'ready' ? '프록시' : '', (asset.sourceRotation ?? 0) !== 0 ? `소스 회전 ${asset.sourceRotation}도 footage interpret` : '', Math.abs((asset.sourcePixelAspectRatio ?? 1) - 1) > .0001 ? `픽셀 종횡비 par ${asset.sourcePixelAspectRatio}` : '', asset.sourceFrameRateOverride ? `프레임레이트 가정 conform ${asset.sourceFrameRateOverride}fps` : '', asset.sourceFieldOrder === 'upper-first' ? '인터레이스 위 필드 우선 디인터레이스' : asset.sourceFieldOrder === 'lower-first' ? '인터레이스 아래 필드 우선 디인터레이스' : '', asset.sourceColorSpaceOverride && asset.sourceColorSpaceOverride !== 'auto' ? `입력 색공간 ${asset.sourceColorSpaceOverride}` : '', asset.sourceAlphaMode === 'ignore' ? '알파 무시 불투명' : '', asset.status].join(' ')
  return `${asset.name} ${asset.folder ?? ''} ${(asset.tags ?? []).join(' ')} ${asset.notes ?? ''} ${asset.scene ?? ''} ${asset.take ?? ''} ${asset.camera ?? ''} ${asset.favorite ? '즐겨찾기 favorite' : ''} ${asset.rating ? `${asset.rating}점 star` : ''} ${asset.kind} ${asset.extension} ${asset.videoCodec ?? ''} ${asset.audioCodec ?? ''} ${asset.sourceTimecode ?? ''} ${asset.reelName ?? ''} ${asset.colorPrimaries ?? ''} ${asset.colorTransfer ?? ''} ${asset.colorSpace ?? ''} ${asset.hdrFormat ?? ''} ${asset.maxContentLightLevel ? `maxcll ${asset.maxContentLightLevel}` : ''} ${asset.maxFrameAverageLightLevel ? `maxfall ${asset.maxFrameAverageLightLevel}` : ''} ${orientation} ${resolution} ${diagnostics}`.toLocaleLowerCase('ko-KR')
}

export function MediaPanel({
  panel,
  onPanelChange,
  assets,
  mediaBins,
  usedAssetIds,
  selectedAssetId,
  onSelectAsset,
  onFiles,
  onImageSequenceFiles,
  desktop,
  onBrowseMedia,
  onBrowseMediaFolder,
  onBatchRelink,
  onBatchRelinkProxies,
  onReplaceAsset,
  onAddAsset,
  sourceIn,
  sourceOut,
  onCreateSubclip,
  onCreateProxy,
  onAttachProxy,
  onSelectAudioStream,
  onCreateProxies,
  onCancelProxy,
  onCancelProxies,
  onToggleProxy,
  onSetProxiesEnabled,
  onDeleteProxy,
  onDeleteProxies,
  onDeleteAllProxies,
  onUpdateAsset,
  onCreateMediaBin,
  onRenameMediaBin,
  onRemoveMediaBin,
  onExportMetadata,
  onMetadataFile,
  onRemoveAsset,
  onMakeAssetOffline,
  onRemoveAssets,
  onRemoveUnusedAssets,
  onRevealAssetUse,
  onRevealMediaPath,
  onCopyMediaPath,
  onAutomateAssets,
  onCreateMulticamSource,
  sequenceMarkerCount,
  onRemoveBackground,
  backgroundRemovalRunning,
  backgroundRemovalProgress,
  backgroundRemovalStage,
  onOpenComfyUi,
  transcript,
  sequenceFps,
  sequenceTimecodeStart,
  sequenceTimecodeDropFrame,
  selectedTranscriptId,
  onSelectTranscript,
  onUpdateTranscript,
  onRenameSpeaker,
  onAssignSegmentSpeaker,
  onTranscriptEditStart,
  onTranscriptEditCommit,
  onRemoveTranscript,
  onSplitTranscript,
  onMergeTranscript,
  onSubtitleFile,
  onExportSubtitles,
  onGenerateCaptions,
  onTranscribe,
  onCancelTranscription,
  onClearSpeakerProfiles,
  speakerProfileCount,
  canTranscribe,
  transcriptionRunning,
  transcriptionProgress,
  transcriptionStage,
  correctionDictionary,
  onAddCorrection,
  onRemoveCorrection,
  suggestions,
  creatorLearningProfile,
  onResetCreatorLearning,
  onRetentionFile,
  roughCutAnalysisRunning,
  roughCutAnalysisProgress,
  roughCutAnalysisStage,
  onAnalyzeSuggestions,
  onApplySuggestion,
  onDismissSuggestion,
}: MediaPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageSequenceInputRef = useRef<HTMLInputElement>(null)
  const speakerEditOriginRef = useRef(new Map<string, string>())
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const preserveProxyOnReplaceRef = useRef(false)
  const proxyInputRef = useRef<HTMLInputElement>(null)
  const subtitleInputRef = useRef<HTMLInputElement>(null)
  const retentionInputRef = useRef<HTMLInputElement>(null)
  const metadataInputRef = useRef<HTMLInputElement>(null)
  const [mediaQuery, setMediaQuery] = useState('')
  const [folderFilter, setFolderFilter] = useState('all')
  const [smartFilter, setSmartFilter] = useState<'all' | 'unused' | 'favorite' | 'rated' | 'offline' | 'video' | 'audio' | 'image' | '4k' | 'vertical'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'newest' | 'duration' | 'size' | 'rating'>('name')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [subtitleLanguage, setSubtitleLanguage] = useState('ko')
  const [imageSequenceFrameRate, setImageSequenceFrameRate] = useState(sequenceFps)
  const [masterLutError, setMasterLutError] = useState('')
  const unusedAssetCount = assets.filter((asset) => !usedAssetIds.has(asset.id) && !asset.parentAssetId).length
  const transcriptSpeakers = useMemo(() => [...new Set(transcript.map((segment) => segment.speaker ?? '화자 1'))].sort((left, right) => left.localeCompare(right, 'ko-KR', { numeric: true })), [transcript])
  const captionQc = useMemo(() => {
    const ordered = [...transcript].sort((left, right) => left.start - right.start)
    const issues = new Map<string, string[]>()
    ordered.forEach((segment, index) => {
      const cueIssues: string[] = []
      const duration = Math.max(.001, segment.end - segment.start)
      const longestLine = segment.text.split(/\n/).reduce((longest, line) => Math.max(longest, [...line].length), 0)
      const charactersPerSecond = [...segment.text.replace(/\s/g, '')].length / duration
      if (ordered[index + 1] && segment.end > ordered[index + 1].start + .001) cueIssues.push('겹침')
      if (charactersPerSecond > 20) cueIssues.push(`${charactersPerSecond.toFixed(1)} CPS`)
      if (longestLine > 42) cueIssues.push(`한 줄 ${longestLine}자`)
      if (duration < .8) cueIssues.push(`${duration.toFixed(2)}초`)
      if (cueIssues.length) issues.set(segment.id, cueIssues)
    })
    return { issues, affected: issues.size, total: ordered.length, lastId: ordered.at(-1)?.id }
  }, [transcript])
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(() => new Set(selectedAssetId ? [selectedAssetId] : []))
  const [draggedAssetIds, setDraggedAssetIds] = useState<string[]>([])
  const [batchFolder, setBatchFolder] = useState('')
  const [batchTag, setBatchTag] = useState('')
  const [batchRating, setBatchRating] = useState('')
  const [batchLabelColor, setBatchLabelColor] = useState('#7c5cff')
  const [batchScene, setBatchScene] = useState('')
  const [batchTake, setBatchTake] = useState('')
  const [batchCamera, setBatchCamera] = useState('')
  const [batchReel, setBatchReel] = useState('')
  const [automateOpen, setAutomateOpen] = useState(false)
  const [multicamSourceOpen, setMulticamSourceOpen] = useState(false)
  const [proxyResolution, setProxyResolution] = useState<'540p' | '720p' | '1080p'>(() => {
    const saved = localStorage.getItem('cutline.proxy-resolution')
    return saved === '720p' || saved === '1080p' ? saved : '540p'
  })
  const selectionAnchorRef = useRef<string | undefined>(undefined)
  const [dictionarySource, setDictionarySource] = useState('')
  const [dictionaryReplacement, setDictionaryReplacement] = useState('')
  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId)
  const masterAsset = selectedAsset?.parentAssetId ? assets.find((asset) => asset.id === selectedAsset.parentAssetId) ?? selectedAsset : selectedAsset
  const masterColor = { ...defaultColorAdjustment(), ...masterAsset?.masterColorAdjustment }
  const masterVisual = { ...defaultVisualEffects(), ...masterAsset?.masterVisualEffects }
  const masterAudio = { ...defaultAudioAdjustment(), ...masterAsset?.masterAudioAdjustment }
  const updateMasterColor = (patch: Partial<typeof masterColor>) => masterAsset && onUpdateAsset(masterAsset.id, { masterColorAdjustment: { ...masterColor, ...patch } })
  const updateMasterVisual = (patch: Partial<typeof masterVisual>) => masterAsset && onUpdateAsset(masterAsset.id, { masterVisualEffects: { ...masterVisual, ...patch } })
  const updateMasterAudio = (patch: Partial<typeof masterAudio>) => masterAsset && onUpdateAsset(masterAsset.id, { masterAudioAdjustment: { ...masterAudio, ...patch, fadeIn: 0, fadeOut: 0, ducking: false, auxSends: undefined } })
  const selectedRootVideoIds = useMemo(() => [...new Set([...selectedAssetIds].flatMap((assetId) => {
    const asset = assets.find((candidate) => candidate.id === assetId)
    if (!asset) return []
    const root = asset.parentAssetId ? assets.find((candidate) => candidate.id === asset.parentAssetId) : asset
    return root?.kind === 'video' ? [root.id] : []
  }))], [assets, selectedAssetIds])
  const selectedProxyReadyIds = selectedRootVideoIds.filter((assetId) => assets.find((asset) => asset.id === assetId)?.proxyStatus === 'ready')
  const selectedProxyCreatingIds = selectedRootVideoIds.filter((assetId) => ['queued', 'creating'].includes(assets.find((asset) => asset.id === assetId)?.proxyStatus ?? ''))
  const allProxyReadyIds = assets.filter((asset) => !asset.parentAssetId && asset.proxyStatus === 'ready').map((asset) => asset.id)
  const allProxyCreatingIds = assets.filter((asset) => !asset.parentAssetId && (asset.proxyStatus === 'queued' || asset.proxyStatus === 'creating')).map((asset) => asset.id)
  const selectedProxyCreatableIds = selectedRootVideoIds.filter((assetId) => {
    const asset = assets.find((candidate) => candidate.id === assetId)
    return asset?.status === 'ready' && asset.proxyStatus !== 'ready' && asset.proxyStatus !== 'creating'
  })
  const proxyMaxDimension = proxyResolution === '1080p' ? 1920 : proxyResolution === '720p' ? 1280 : 960

  useEffect(() => {
    localStorage.setItem('cutline.proxy-resolution', proxyResolution)
  }, [proxyResolution])
  const resolveAssetState = (asset: MediaAsset): MediaAsset => {
    const source = asset.parentAssetId ? assets.find((candidate) => candidate.id === asset.parentAssetId) : undefined
    return source ? { ...asset, status: source.status, error: source.error, proxyStatus: source.proxyStatus, useProxy: source.useProxy } : asset
  }
  const selectedAssetState = selectedAsset ? resolveAssetState(selectedAsset) : undefined
  const cueTimecode = (time: number) => formatMediaTimecode(sequenceTimecodeStart + time, sequenceFps, sequenceTimecodeDropFrame)
  const commitCueTimecode = (segment: TranscriptSegment, edge: 'start' | 'end', value: string, reset: (value: string) => void) => {
    const parsed = parseMediaTimecode(value, sequenceFps)
    if (!parsed) { reset(cueTimecode(segment[edge])); onTranscriptEditCommit(); return }
    const timelineTime = Math.round((parsed.seconds - sequenceTimecodeStart) * sequenceFps) / sequenceFps
    const frame = 1 / sequenceFps
    const next = edge === 'start' ? Math.max(0, Math.min(segment.end - frame, timelineTime)) : Math.max(segment.start + frame, timelineTime)
    onUpdateTranscript(segment.id, { [edge]: next })
    reset(cueTimecode(next))
    onTranscriptEditCommit()
  }
  const folders = useMemo(() => [...new Set([...mediaBins, ...assets.map((asset) => asset.folder ?? '')].map((name) => name.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'ko-KR', { numeric: true })), [assets, mediaBins])
  const filteredAssets = useMemo(() => assets.filter((asset) => {
    const resolvedAsset = resolveAssetState(asset)
    const query = mediaQuery.trim().toLocaleLowerCase('ko-KR')
    const searchable = searchableAssetText(asset)
    const smartMatch = smartFilter === 'all'
      || smartFilter === 'unused' && !usedAssetIds.has(asset.id)
      || smartFilter === 'favorite' && asset.favorite
      || smartFilter === 'rated' && (asset.rating ?? 0) >= 4
      || smartFilter === 'offline' && (resolvedAsset.status === 'offline' || resolvedAsset.status === 'error')
      || smartFilter === asset.kind
      || smartFilter === '4k' && (asset.width ?? 0) >= 3840
      || smartFilter === 'vertical' && (asset.width ?? 0) < (asset.height ?? 0)
    const inSelectedFolder = folderFilter === 'all' || asset.folder === folderFilter || asset.folder?.startsWith(`${folderFilter}/`)
    return (!query || searchable.includes(query)) && inSelectedFolder && smartMatch
  }).sort((left, right) => sortBy === 'newest' ? (right.importedAt ?? '').localeCompare(left.importedAt ?? '') : sortBy === 'duration' ? right.duration - left.duration : sortBy === 'size' ? right.size - left.size : sortBy === 'rating' ? (right.rating ?? 0) - (left.rating ?? 0) : left.name.localeCompare(right.name, 'ko-KR')), [assets, folderFilter, mediaQuery, smartFilter, sortBy, usedAssetIds])

  useEffect(() => {
    setSelectedAssetIds((current) => {
      if (selectedAssetId && current.has(selectedAssetId)) return current
      return new Set(selectedAssetId ? [selectedAssetId] : [])
    })
  }, [selectedAssetId])

  useEffect(() => {
    const available = new Set(assets.map((asset) => asset.id))
    setSelectedAssetIds((current) => {
      const retained = new Set([...current].filter((id) => available.has(id)))
      if (retained.size === current.size && [...retained].every((id) => current.has(id))) return current
      return retained
    })
  }, [assets])

  useEffect(() => {
    const importedLanguage = transcript.find((segment) => segment.language)?.language
    if (importedLanguage) setSubtitleLanguage(importedLanguage)
  }, [transcript])

  const selectAsset = (event: MouseEvent<HTMLButtonElement>, assetId: string) => {
    if (event.shiftKey && selectionAnchorRef.current) {
      const anchorIndex = filteredAssets.findIndex((asset) => asset.id === selectionAnchorRef.current)
      const targetIndex = filteredAssets.findIndex((asset) => asset.id === assetId)
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [from, to] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
        setSelectedAssetIds(new Set(filteredAssets.slice(from, to + 1).map((asset) => asset.id)))
        onSelectAsset(assetId)
        return
      }
    }
    selectionAnchorRef.current = assetId
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selectedAssetIds)
      if (next.has(assetId)) next.delete(assetId)
      else next.add(assetId)
      setSelectedAssetIds(next)
      const activeId = next.has(assetId) ? assetId : [...next][next.size - 1]
      onSelectAsset(activeId)
      return
    }
    setSelectedAssetIds(new Set([assetId]))
    onSelectAsset(assetId)
  }

  const moveDraggedAsset = (folder: string | undefined, event?: DragEvent<HTMLButtonElement>) => {
    event?.preventDefault()
    event?.stopPropagation()
    let transferredIds: string[] = []
    try {
      const raw = event?.dataTransfer.getData('application/x-cutline-assets')
      const parsed: unknown = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) transferredIds = parsed.filter((id): id is string => typeof id === 'string')
    } catch { transferredIds = [] }
    const ids = transferredIds.length ? transferredIds : draggedAssetIds
    if (!ids.length) return
    ids.forEach((assetId) => onUpdateAsset(assetId, { folder }))
    setSelectedAssetIds(new Set(ids))
    setDraggedAssetIds([])
  }

  const moveSelectedAssets = (folder: string | undefined) => {
    const ids = selectedAssetIds.size ? [...selectedAssetIds] : selectedAssetId ? [selectedAssetId] : []
    if (!ids.length) return
    ids.forEach((assetId) => onUpdateAsset(assetId, { folder }))
    if (folder) onCreateMediaBin(folder)
  }

  const createFolder = () => {
    const leafName = window.prompt(folderFilter === 'all' ? '새 미디어 빈(Bin) 이름을 입력하세요.' : `'${folderFilter}' 아래에 만들 빈 이름을 입력하세요.`)?.trim().replace(/^\/+|\/+$/g, '')
    if (!leafName) return
    const name = folderFilter === 'all' ? leafName : `${folderFilter}/${leafName}`
    onCreateMediaBin(name)
    const targets = selectedAssetIds.size ? [...selectedAssetIds] : selectedAssetId ? [selectedAssetId] : []
    targets.forEach((assetId) => onUpdateAsset(assetId, { folder: name }))
    setFolderFilter(name)
  }

  const renameFolder = () => {
    if (folderFilter === 'all') return
    const separatorIndex = folderFilter.lastIndexOf('/')
    const parent = separatorIndex >= 0 ? folderFilter.slice(0, separatorIndex) : ''
    const currentLeaf = separatorIndex >= 0 ? folderFilter.slice(separatorIndex + 1) : folderFilter
    const nextLeaf = window.prompt('빈(Bin)의 새 이름을 입력하세요.', currentLeaf)?.trim().replace(/^\/+|\/+$/g, '')
    if (!nextLeaf) return
    const name = parent ? `${parent}/${nextLeaf}` : nextLeaf
    if (name === folderFilter) return
    const childPrefix = `${folderFilter}/`
    assets.filter((asset) => asset.folder === folderFilter || asset.folder?.startsWith(childPrefix)).forEach((asset) => onUpdateAsset(asset.id, { folder: `${name}${asset.folder!.slice(folderFilter.length)}` }))
    folders.filter((folder) => folder === folderFilter || folder.startsWith(childPrefix)).forEach((folder) => onRenameMediaBin(folder, `${name}${folder.slice(folderFilter.length)}`))
    setFolderFilter(name)
  }

  const removeFolder = () => {
    if (folderFilter === 'all') return
    const separatorIndex = folderFilter.lastIndexOf('/')
    const parent = separatorIndex >= 0 ? folderFilter.slice(0, separatorIndex) : undefined
    if (!window.confirm(`'${folderFilter}' 빈과 하위 빈을 없애고 미디어를 ${parent ? `'${parent}'` : '전체 목록'}으로 이동할까요? 원본 파일은 삭제되지 않습니다.`)) return
    const childPrefix = `${folderFilter}/`
    assets.filter((asset) => asset.folder === folderFilter || asset.folder?.startsWith(childPrefix)).forEach((asset) => onUpdateAsset(asset.id, { folder: parent }))
    folders.filter((folder) => folder === folderFilter || folder.startsWith(childPrefix)).forEach(onRemoveMediaBin)
    setFolderFilter(parent ?? 'all')
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (event.dataTransfer.files.length) onFiles(event.dataTransfer.files)
  }

  const browseMedia = () => {
    if (!desktop) {
      fileInputRef.current?.click()
      return
    }
    void onBrowseMedia().then((result) => {
      if (result === undefined) fileInputRef.current?.click()
      else if (result.files.length || result.failures.length) onFiles(result.files, result.failures)
    })
  }

  const browseMediaFolder = () => {
    void onBrowseMediaFolder().then((result) => {
      if (result && (result.files.length || result.failures.length || result.bins?.length)) onFiles(result.files, result.failures, result.bins)
    })
  }

  const browseImageSequence = () => {
    if (!desktop) {
      imageSequenceInputRef.current?.click()
      return
    }
    void onBrowseMedia().then((result) => {
      if (result === undefined) imageSequenceInputRef.current?.click()
      else if (result.files.length) onImageSequenceFiles(result.files, imageSequenceFrameRate)
    })
  }

  const replaceSelectedAsset = (preserveProxy = false) => {
    if (!selectedAsset || selectedAsset.parentAssetId) return
    preserveProxyOnReplaceRef.current = preserveProxy
    if (!desktop) {
      replaceInputRef.current?.click()
      return
    }
    void onBrowseMedia().then((result) => {
      const file = result?.files[0]
      if (file) onReplaceAsset(selectedAsset.id, file, preserveProxy)
      else if (result === undefined) replaceInputRef.current?.click()
    })
  }

  const attachSelectedProxy = () => {
    if (!selectedAsset || selectedAsset.parentAssetId) return
    if (!desktop) {
      proxyInputRef.current?.click()
      return
    }
    void onBrowseMedia().then((result) => {
      const file = result?.files[0]
      if (file) onAttachProxy(selectedAsset.id, file)
      else if (result === undefined) proxyInputRef.current?.click()
    })
  }

  return (
    <aside className="media-panel panel-surface">
      <nav className="panel-tabs" aria-label="소스 도구">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} className={panel === id ? 'active' : ''} onClick={() => onPanelChange(id)}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </nav>

      {panel === 'media' && (
        <div
          className="panel-content media-content"
          tabIndex={0}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          onKeyDown={(event) => {
            if (event.key !== 'Delete' && event.key !== 'Backspace') return
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
            const ids = selectedAssetIds.size ? [...selectedAssetIds] : selectedAssetId ? [selectedAssetId] : []
            if (!ids.length) return
            event.preventDefault()
            onRemoveAssets(ids)
          }}
        >
          <div className="panel-heading">
            <div><span className="eyebrow">PROJECT ASSETS</span><h2>내 미디어</h2></div>
            <div className="media-heading-actions">
              {assets.some((asset) => asset.status === 'offline' || asset.status === 'error') && desktop && <button className="small-button reconnect" onClick={onBatchRelink}><RefreshCw size={13} /> 폴더 Relink</button>}
              {assets.some((asset) => asset.proxySourcePath && asset.proxyStatus === 'error') && desktop && <button className="small-button reconnect" onClick={onBatchRelinkProxies}><RefreshCw size={13} /> 프록시 Relink</button>}
              {assets.some((asset) => asset.status === 'offline' || asset.status === 'error') && <button className="small-button reconnect" onClick={browseMedia}><AlertCircle size={13} /> 파일 연결</button>}
              {desktop && <button className="small-button" onClick={browseMediaFolder}><FolderOpen size={14} /> 폴더 가져오기</button>}
              <button className="small-button" onClick={browseImageSequence}><Film size={14} /> 이미지 시퀀스</button>
              <select aria-label="이미지 시퀀스 프레임레이트" value={imageSequenceFrameRate} onChange={(event) => setImageSequenceFrameRate(Number(event.target.value))}><option value={23.976}>23.976</option><option value={24}>24</option><option value={25}>25</option><option value={29.97}>29.97</option><option value={30}>30</option><option value={50}>50</option><option value={59.94}>59.94</option><option value={60}>60</option></select>
              <button className="small-button" onClick={browseMedia}><Upload size={14} /> 가져오기</button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              multiple
              accept={MEDIA_FILE_ACCEPT}
              onChange={(event) => {
                if (event.target.files?.length) onFiles(event.target.files)
                event.target.value = ''
              }}
            />
            <input
              ref={imageSequenceInputRef}
              type="file"
              hidden
              multiple
              accept={IMAGE_FILE_ACCEPT}
              onChange={(event) => {
                if (event.target.files?.length) onImageSequenceFiles(event.target.files, imageSequenceFrameRate)
                event.target.value = ''
              }}
            />
            <input
              ref={replaceInputRef}
              type="file"
              hidden
              accept={MEDIA_FILE_ACCEPT}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file && selectedAsset) onReplaceAsset(selectedAsset.id, file, preserveProxyOnReplaceRef.current)
                preserveProxyOnReplaceRef.current = false
                event.target.value = ''
              }}
            />
            <input
              ref={proxyInputRef}
              type="file"
              hidden
              accept={MEDIA_FILE_ACCEPT}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file && selectedAsset) onAttachProxy(selectedAsset.id, file)
                event.target.value = ''
              }}
            />
          </div>

          <div className="media-filter-row">
            <label><Search size={12} /><input value={mediaQuery} onChange={(event) => setMediaQuery(event.target.value)} placeholder="이름·태그·4K·세로·얼굴 검색" /></label>
            <select value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)}><option value="all">모든 폴더</option>{folders.map((folder) => { const depth = folder.split('/').length - 1; return <option key={folder} value={folder}>{`${'　'.repeat(depth)}${depth ? '└ ' : ''}${folder.split('/').pop()}`}</option> })}</select>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}><option value="name">이름순</option><option value="newest">최근 가져온 순</option><option value="duration">길이순</option><option value="size">용량순</option><option value="rating">평점순</option></select>
            <span className="asset-view-switch" aria-label="미디어 보기 방식"><button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')} title="목록 보기"><List size={12} /></button><button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')} title="썸네일 보기"><Grid2X2 size={12} /></button></span>
          </div>
          <div className="smart-bin-strip" aria-label="스마트 빈">{([['all', '전체'], ['unused', '미사용'], ['favorite', '즐겨찾기'], ['rated', '★ 4+'], ['offline', '오프라인'], ['video', '영상'], ['audio', '오디오'], ['image', '이미지'], ['4k', '4K+'], ['vertical', '세로']] as const).map(([id, label]) => <button key={id} className={smartFilter === id ? 'active' : ''} onClick={() => setSmartFilter(id)}>{label}<small>{id === 'all' ? assets.length : assets.filter((asset) => id === 'unused' ? !usedAssetIds.has(asset.id) : id === 'favorite' ? asset.favorite : id === 'rated' ? (asset.rating ?? 0) >= 4 : id === 'offline' ? ['offline', 'error'].includes(resolveAssetState(asset).status) : id === '4k' ? (asset.width ?? 0) >= 3840 : id === 'vertical' ? (asset.width ?? 0) < (asset.height ?? 0) : asset.kind === id).length}</small></button>)}</div>
          <div className="asset-bin-strip" aria-label="미디어 폴더 이동 대상">
            <button
              className={folderFilter === 'all' ? 'active' : ''}
              onClick={() => setFolderFilter('all')}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => moveDraggedAsset(undefined, event)}
              title="여기에 놓으면 폴더에서 꺼냅니다"
            >전체</button>
            {folders.map((folder) => (
              <button
                key={folder}
                className={folderFilter === folder ? 'active' : ''}
                style={{ marginLeft: `${(folder.split('/').length - 1) * 8}px` }}
                onClick={() => setFolderFilter(folder)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => moveDraggedAsset(folder, event)}
                title={`선택 미디어를 ${folder} 폴더로 이동`}
              >{folder.split('/').length > 1 ? `└ ${folder.split('/').pop()}` : folder}</button>
            ))}
            <span className="asset-bin-actions"><button onClick={createFolder} title="선택 미디어로 새 빈 만들기"><FolderPlus size={11} /> 새 빈</button><button disabled={folderFilter === 'all'} onClick={renameFolder} title="현재 빈 이름 변경"><FolderPen size={11} /></button><button disabled={folderFilter === 'all'} onClick={removeFolder} title="현재 빈 해제"><FolderX size={11} /></button></span>
          </div>
          {filteredAssets.length > 0 && <div className="asset-selection-toolbar"><span>{filteredAssets.length}개 표시 · {selectedAssetIds.size}개 선택</span><button onClick={() => { setSelectedAssetIds(new Set(filteredAssets.map((asset) => asset.id))); onSelectAsset(filteredAssets[filteredAssets.length - 1].id) }}>표시 항목 전체 선택</button>{selectedAssetIds.size > 0 && <button onClick={() => { setSelectedAssetIds(new Set()); onSelectAsset(undefined) }}>선택 해제</button>}<select aria-label="선택 미디어 빠른 이동" value="" disabled={!selectedAssetIds.size} onChange={(event) => { const value = event.target.value; if (!value) return; moveSelectedAssets(value === '__root__' ? undefined : value); event.currentTarget.value = '' }}><option value="">선택 항목 이동…</option><option value="__root__">전체 · 빈에서 꺼내기</option>{folders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}</select><button onClick={() => metadataInputRef.current?.click()}><Upload size={10} /> 메타데이터 CSV</button><button onClick={() => onExportMetadata(selectedAssetIds.size ? [...selectedAssetIds] : filteredAssets.map((asset) => asset.id))}><Download size={10} /> CSV 내보내기</button><input ref={metadataInputRef} hidden type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) onMetadataFile(file); event.target.value = '' }} /></div>}
          {unusedAssetCount > 0 && <div className="project-cleanup-summary"><span>전체 시퀀스에서 사용하지 않는 원본 {unusedAssetCount}개</span><button onClick={onRemoveUnusedAssets}><Trash2 size={10} /> 미사용 정리</button></div>}
          {assets.some((asset) => asset.proxyCachePath || asset.proxySourcePath || asset.proxyStatus === 'creating') && <div className="proxy-cache-summary"><span>프로젝트 프록시 · {formatFileSize(assets.reduce((sum, asset) => sum + (asset.proxySize ?? 0), 0))}{allProxyCreatingIds.length ? ` · 생성 중 ${allProxyCreatingIds.length}` : ''}</span>{allProxyCreatingIds.length > 0 && <button onClick={() => onCancelProxies(allProxyCreatingIds)}>생성 모두 취소</button>}<button disabled={!allProxyReadyIds.length} onClick={() => onSetProxiesEnabled(allProxyReadyIds, true)}>모두 프록시</button><button disabled={!allProxyReadyIds.length} onClick={() => onSetProxiesEnabled(allProxyReadyIds, false)}>모두 원본</button><button onClick={onDeleteAllProxies}>모두 정리</button></div>}

          <div className={`asset-list ${viewMode}`}>
            {filteredAssets.map((asset) => {
              const resolvedAsset = resolveAssetState(asset)
              const sourceAsset = asset.parentAssetId ? assets.find((candidate) => candidate.id === asset.parentAssetId) : asset
              const sourceMasterEnabled = Boolean(sourceAsset?.masterEffectsEnabled)
              const sourceInterpretationEnabled = Boolean(sourceAsset && ((sourceAsset.sourceRotation ?? 0) !== 0 || Math.abs((sourceAsset.sourcePixelAspectRatio ?? 1) - 1) > .0001 || Boolean(sourceAsset.sourceFrameRateOverride) || (sourceAsset.sourceFieldOrder ?? 'progressive') !== 'progressive' || Boolean(sourceAsset.sourceColorSpaceOverride && sourceAsset.sourceColorSpaceOverride !== 'auto') || sourceAsset.sourceAlphaMode === 'ignore'))
              const KindIcon = asset.kind === 'video' ? Video : asset.kind === 'audio' ? FileAudio2 : Image
              const health = assessMediaHealth(resolvedAsset)
              return (
                <button
                  key={asset.id}
                  draggable
                  className={`asset-card ${selectedAssetIds.has(asset.id) ? 'selected' : ''} ${asset.favorite ? 'favorite' : ''}`}
                  style={{ '--asset-label': asset.labelColor ?? 'transparent' } as CSSProperties}
                  onClick={(event) => selectAsset(event, asset.id)}
                  onDoubleClick={() => onAddAsset(asset.id)}
                  onDragStart={(event) => {
                    const ids = selectedAssetIds.has(asset.id) ? [...selectedAssetIds] : [asset.id]
                    setDraggedAssetIds(ids)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/x-cutline-asset', asset.id)
                    event.dataTransfer.setData('application/x-cutline-assets', JSON.stringify(ids))
                  }}
                  onDragEnd={() => setDraggedAssetIds([])}
                  title="더블 클릭하여 타임라인에 추가"
                >
                  <span
                    className={`asset-thumb ${asset.kind}`}
                    style={asset.thumbnailUrl ? { backgroundImage: `linear-gradient(rgba(7,7,10,.12), rgba(7,7,10,.42)), url(${asset.thumbnailUrl})` } : undefined}
                  >
                    {!asset.thumbnailUrl && <KindIcon size={22} />}
                    {resolvedAsset.status === 'analyzing' && <LoaderCircle className="spin" size={15} />}
                    {(resolvedAsset.status === 'offline' || resolvedAsset.status === 'error') && <AlertCircle size={15} />}
                  </span>
                  <span className="asset-copy">
                    <strong>{asset.name}</strong>
                    <small>
                      {resolvedAsset.status === 'offline'
                        ? '오프라인 · 같은 파일을 다시 가져오세요'
                        : resolvedAsset.status === 'analyzing'
                          ? '미디어 분석 중…'
                          : resolvedAsset.status === 'error'
                            ? `분석 실패 · ${resolvedAsset.error ?? '지원 형식을 확인하세요'}`
                            : asset.proxyStatus === 'queued' || asset.proxyStatus === 'creating'
                              ? `기본 분석 완료 · 호환 미디어 생성 중${asset.proxyProgress === undefined ? '' : ` ${Math.round(asset.proxyProgress * 100)}%`}`
                            : asset.imageSequencePaths?.length || asset.imageSequenceFiles?.length
                              ? `이미지 시퀀스 · ${asset.imageSequencePaths?.length ?? asset.imageSequenceFiles?.length ?? 0} frames · ${(asset.sourceFrameRateOverride ?? asset.imageSequenceFrameRate ?? asset.frameRate ?? 30).toFixed(3)} fps · ${asset.width ?? '?'}×${asset.height ?? '?'}`
                              : `${asset.extension.toUpperCase()} · ${asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ''}${asset.frameRate ? `${asset.frameRate.toFixed(2)} fps${asset.variableFrameRate ? ' VFR' : ''} · ` : ''}${asset.kind === 'image' ? formatFileSize(asset.size) : formatDuration(asset.duration)}`}
                    </small>
                  </span>
                  {asset.favorite && <span className="asset-favorite"><Star size={9} fill="currentColor" /></span>}
                  <span className="asset-card-footer">
                    <span className="asset-duration">{asset.kind === 'image' ? '5s' : formatDuration(asset.duration)}</span>
                    <span className="asset-card-badges">
                      {(asset.rating ?? 0) > 0 && <span className="asset-rating">{'★'.repeat(Math.max(1, Math.min(5, asset.rating ?? 0)))}</span>}
                      {asset.parentAssetId && <span className="asset-subclip">서브클립</span>}
                      {(asset.imageSequencePaths?.length || asset.imageSequenceFiles?.length) && <span className="asset-subclip">SEQ</span>}
                      {asset.proxyStatus === 'ready' && <span className="asset-subclip">{asset.proxyPurpose === 'compatibility' ? 'HQ COMPAT' : asset.proxyPurpose === 'external' || asset.proxySourcePath ? 'EXT PROXY' : 'PROXY'}</span>}
                      {sourceMasterEnabled && <span className="asset-master-effects">MASTER FX</span>}
                      {sourceInterpretationEnabled && <span className="asset-source-interpreted">INTERPRET</span>}
                      {usedAssetIds.has(asset.id) && <span className="asset-used">사용됨</span>}
                      <span className={`asset-health ${health.level}`} title={health.detail}>{health.label}</span>
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          {assets.length === 0 && (
            <div className="drop-zone">
              <span className="drop-icon"><Upload size={22} /></span>
              <strong>첫 미디어를 가져오세요</strong>
              <p>영상, 오디오, 이미지를 놓거나<br />가져오기 버튼을 누르세요.</p>
              <small>파일은 브라우저 밖으로 업로드되지 않습니다.</small>
            </div>
          )}

          {assets.length > 0 && (
            <div className="media-actions-stack">
              {selectedAssetIds.size > 1 && <div className="asset-batch-editor">
                <strong>미디어 {selectedAssetIds.size}개 · 대량 메타데이터</strong>
                <label><span>폴더 일괄 이동</span><input value={batchFolder} placeholder="폴더 이름" onChange={(event) => setBatchFolder(event.target.value)} /></label><button disabled={!batchFolder.trim()} onClick={() => { const folder = batchFolder.trim().replace(/^\/+|\/+$/g, ''); if (!folder) return; moveSelectedAssets(folder); setBatchFolder('') }}>새 빈으로 이동</button>
                <label><span>태그 일괄 추가</span><input value={batchTag} placeholder="쉼표로 여러 태그" onChange={(event) => setBatchTag(event.target.value)} /></label><button disabled={!batchTag.trim()} onClick={() => { const tags = batchTag.split(',').map((tag) => tag.trim()).filter(Boolean); selectedAssetIds.forEach((assetId) => { const target = assets.find((asset) => asset.id === assetId); onUpdateAsset(assetId, { tags: [...new Set([...(target?.tags ?? []), ...tags])] }) }); setBatchTag('') }}>태그 추가</button>
                <label><span>평점</span><select value={batchRating} onChange={(event) => setBatchRating(event.target.value)}><option value="">변경 안 함</option><option value="0">평점 지우기</option>{[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{'★'.repeat(rating)}</option>)}</select></label><button disabled={batchRating === ''} onClick={() => selectedAssetIds.forEach((assetId) => onUpdateAsset(assetId, { rating: Number(batchRating) }))}>평점 적용</button>
                <label><span>라벨 색상</span><input type="color" value={batchLabelColor} onChange={(event) => setBatchLabelColor(event.target.value)} /></label><button onClick={() => selectedAssetIds.forEach((assetId) => onUpdateAsset(assetId, { labelColor: batchLabelColor }))}>라벨 적용</button>
                <div className="asset-batch-production">
                  <label><span>씬</span><input value={batchScene} placeholder="12A" onChange={(event) => setBatchScene(event.target.value)} /></label>
                  <label><span>테이크</span><input value={batchTake} placeholder="3" onChange={(event) => setBatchTake(event.target.value)} /></label>
                  <label><span>카메라</span><input value={batchCamera} placeholder="A CAM" onChange={(event) => setBatchCamera(event.target.value)} /></label>
                  <label><span>릴/테이프</span><input value={batchReel} placeholder="A001" onChange={(event) => setBatchReel(event.target.value)} /></label>
                </div><button disabled={!batchScene.trim() && !batchTake.trim() && !batchCamera.trim() && !batchReel.trim()} onClick={() => { const patch: Partial<MediaAsset> = {}; if (batchScene.trim()) patch.scene = batchScene.trim(); if (batchTake.trim()) patch.take = batchTake.trim(); if (batchCamera.trim()) patch.camera = batchCamera.trim(); if (batchReel.trim()) patch.reelName = batchReel.trim(); selectedAssetIds.forEach((assetId) => onUpdateAsset(assetId, patch)) }}>촬영 정보 적용</button>
                <span className="asset-batch-toggle"><button onClick={() => selectedAssetIds.forEach((assetId) => onUpdateAsset(assetId, { favorite: true }))}><Star size={11} /> 즐겨찾기 설정</button><button onClick={() => selectedAssetIds.forEach((assetId) => onUpdateAsset(assetId, { favorite: false }))}>즐겨찾기 해제</button></span>
                {selectedRootVideoIds.length > 0 && <span className="asset-batch-toggle"><select value={proxyResolution} title="프록시 해상도" onChange={(event) => setProxyResolution(event.target.value as typeof proxyResolution)}><option value="540p">540p 프록시</option><option value="720p">720p 프록시</option><option value="1080p">1080p 프록시</option></select><button disabled={!selectedProxyCreatableIds.length} onClick={() => onCreateProxies(selectedProxyCreatableIds, proxyMaxDimension)}><Download size={11} /> 프록시 {selectedProxyCreatableIds.length ? `${selectedProxyCreatableIds.length}개 생성` : '준비됨'}</button>{selectedProxyCreatingIds.length > 0 && <button onClick={() => onCancelProxies(selectedProxyCreatingIds)}>생성 취소</button>}<button disabled={!selectedProxyReadyIds.length} onClick={() => onSetProxiesEnabled(selectedProxyReadyIds, true)}>프록시 보기</button><button disabled={!selectedProxyReadyIds.length} onClick={() => onSetProxiesEnabled(selectedProxyReadyIds, false)}>원본 보기</button><button className="danger" disabled={!selectedProxyReadyIds.length} onClick={() => onDeleteProxies(selectedProxyReadyIds)}>프록시 삭제</button></span>}
                <span className="asset-batch-toggle"><button onClick={() => setAutomateOpen(true)}><ListVideo size={11} /> 시퀀스 자동 배치</button>{selectedRootVideoIds.length > 1 && <button onClick={() => setMulticamSourceOpen(true)}><Film size={11} /> 멀티캠 소스</button>}<button className="danger" onClick={() => onRemoveAssets([...selectedAssetIds])}><Trash2 size={11} /> 선택 제거</button></span>
              </div>}
              {(selectedAsset?.kind === 'video' || selectedAsset?.kind === 'audio' || selectedAsset?.kind === 'image') && !selectedAsset.parentAssetId && (selectedAsset.status === 'ready' || selectedAsset.status === 'offline' || selectedAsset.proxyStatus === 'ready' || selectedAsset.proxyStatus === 'loading' || selectedAsset.proxyStatus === 'queued' || selectedAsset.proxyStatus === 'error') && (
                <div className={`proxy-control ${selectedAsset.proxyStatus ?? 'none'}`}>
                  <div>
                    <strong>{selectedAsset.proxyStatus === 'ready' ? selectedAsset.kind === 'audio' ? '오디오 호환 미디어' : selectedAsset.kind === 'image' ? '이미지 호환 미디어' : selectedAsset.proxyPurpose === 'compatibility' ? `고품질 호환 미디어 ${selectedAsset.proxyWidth}×${selectedAsset.proxyHeight}` : selectedAsset.proxyPurpose === 'external' ? `외부 프록시 ${selectedAsset.proxyWidth}×${selectedAsset.proxyHeight}` : `편집 프록시 ${selectedAsset.proxyWidth}×${selectedAsset.proxyHeight}` : selectedAsset.proxyStatus === 'loading' ? '연결된 프록시 복원 중' : selectedAsset.proxyStatus === 'queued' ? '프록시 생성 대기 중' : selectedAsset.proxyStatus === 'creating' ? selectedAsset.proxyPurpose === 'compatibility' ? '고품질 호환 미디어 생성 중' : '프록시 생성 중' : selectedAsset.proxyStatus === 'error' ? '프록시 연결·생성 오류' : selectedAsset.kind === 'audio' ? '오디오 호환 미디어' : selectedAsset.kind === 'image' ? '이미지 호환 미디어' : selectedAsset.videoDecodable === false || selectedAsset.audioDecodable === false ? '원본 해상도 고품질 호환 미디어' : '편집 프록시'}</strong>
                    <small>{selectedAsset.proxyStatus === 'ready' ? selectedAsset.kind === 'audio' ? `${formatFileSize(selectedAsset.proxySize ?? 0)} · 48kHz PCM WAV · 원본 채널 구성 유지 · ${selectedAsset.proxySourcePath ? `외부 연결 · ${selectedAsset.proxySourceName ?? '파일'}` : selectedAsset.proxyCachePath ? '디스크 캐시' : '세션 전용'}` : selectedAsset.kind === 'image' ? `${formatFileSize(selectedAsset.proxySize ?? 0)} · PNG · 알파 채널 유지 · ${selectedAsset.proxySourcePath ? `외부 연결 · ${selectedAsset.proxySourceName ?? '파일'}` : selectedAsset.proxyCachePath ? '디스크 캐시' : '세션 전용'}` : `${formatFileSize(selectedAsset.proxySize ?? 0)} · ${(selectedAsset.proxyFrameRate ?? selectedAsset.frameRate ?? 30).toFixed(3).replace(/\.0+$/, '')}fps · ${selectedAsset.proxyPurpose === 'compatibility' ? '원본 해상도·고품질 납품 호환' : selectedAsset.proxySourcePath ? `외부 연결 · ${selectedAsset.proxySourceName ?? '파일'}` : selectedAsset.proxyCachePath ? '디스크 캐시' : '세션 전용'} · ${selectedAsset.proxyTimecodeMismatch ? 'TC 불일치' : selectedAsset.proxyTimecodeVerified ? 'TC 일치 확인' : '논리 TC 유지'} · ${selectedAsset.proxyPurpose === 'compatibility' ? '디코더 미지원 시 출력에도 사용' : '원본 출력 유지'}` : selectedAsset.proxyStatus === 'loading' ? '연결된 프록시를 불러오고 있습니다.' : selectedAsset.proxyStatus === 'queued' ? '앞선 프록시 변환이 끝나면 자동으로 시작합니다.' : selectedAsset.proxyStatus === 'creating' ? `${Math.round((selectedAsset.proxyProgress ?? 0) * 100)}%` : selectedAsset.proxyStatus === 'error' ? selectedAsset.proxyError : selectedAsset.kind === 'audio' ? '48kHz · 24-bit PCM WAV · 원본 채널 구성 유지' : selectedAsset.kind === 'image' ? 'PNG · 원본 해상도 · 알파 채널 유지' : selectedAsset.videoDecodable === false || selectedAsset.audioDecodable === false ? '원본 해상도 · H.264/AAC 고품질 · 원본 fps·TC 유지' : `${proxyResolution} · H.264/AAC · 원본 fps 유지`}</small>
                  </div>
                  {selectedAsset.proxyStatus === 'ready' ? (
                    <span className="proxy-buttons">
                      <button disabled={selectedAsset.status === 'offline' || selectedAsset.videoDecodable === false || selectedAsset.audioDecodable === false || selectedAsset.imageDecodable === false} onClick={() => onToggleProxy(selectedAsset.id)}>{selectedAsset.status === 'offline' ? '프록시 전용 편집' : selectedAsset.videoDecodable === false || selectedAsset.audioDecodable === false || selectedAsset.imageDecodable === false ? '호환 프록시 필수' : selectedAsset.useProxy ? '원본 보기' : '프록시 사용'}</button>
                      <button onClick={attachSelectedProxy}>다른 프록시 연결</button>
                      <button className="danger" onClick={() => onDeleteProxy(selectedAsset.id)}>{selectedAsset.proxySourcePath ? '연결 분리' : '삭제'}</button>
                    </span>
                  ) : selectedAsset.proxyStatus === 'loading' ? (
                    <button disabled>복원 중…</button>
                  ) : selectedAsset.proxyStatus === 'queued' || selectedAsset.proxyStatus === 'creating' ? (
                    <button onClick={() => onCancelProxy(selectedAsset.id)}>취소</button>
                  ) : (
                    <span className="proxy-buttons">{selectedAsset.kind === 'video' && selectedAsset.videoDecodable !== false && selectedAsset.audioDecodable !== false && <select value={proxyResolution} aria-label="프록시 해상도" onChange={(event) => setProxyResolution(event.target.value as typeof proxyResolution)}><option value="540p">540p</option><option value="720p">720p</option><option value="1080p">1080p</option></select>}<button disabled={selectedAsset.status === 'offline'} onClick={() => onCreateProxy(selectedAsset.id, proxyMaxDimension)}>{selectedAsset.status === 'offline' ? '원본 연결 필요' : selectedAsset.videoDecodable === false || selectedAsset.audioDecodable === false ? '고품질 호환 미디어 생성' : '프록시 생성'}</button><button onClick={attachSelectedProxy}>외부 프록시 연결</button>{selectedAsset.proxySourcePath && <button className="danger" onClick={() => onDeleteProxy(selectedAsset.id)}>끊어진 연결 제거</button>}</span>
                  )}
                  {(selectedAsset.proxyStatus === 'queued' || selectedAsset.proxyStatus === 'creating') && <progress max="1" value={selectedAsset.proxyProgress ?? 0} />}
                </div>
              )}
              {selectedAsset && <div className="asset-metadata-editor">
                <label><span>프로젝트 클립 이름</span><input key={`${selectedAsset.id}-${selectedAsset.name}`} defaultValue={selectedAsset.name} onBlur={(event) => { const name = event.currentTarget.value.trim(); if (!name) event.currentTarget.value = selectedAsset.name; else if (name !== selectedAsset.name) onUpdateAsset(selectedAsset.id, { name }) }} /></label>
                <label><span>폴더</span><input value={selectedAsset.folder ?? ''} placeholder="예: A-roll" onChange={(event) => onUpdateAsset(selectedAsset.id, { folder: event.target.value })} /></label>
                <label><span><Tag size={10} /> 태그</span><input value={(selectedAsset.tags ?? []).join(', ')} placeholder="인터뷰, 제품, B-roll" onChange={(event) => onUpdateAsset(selectedAsset.id, { tags: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} /></label>
                <div className="asset-rating-editor"><button className={selectedAsset.favorite ? 'active' : ''} onClick={() => onUpdateAsset(selectedAsset.id, { favorite: !selectedAsset.favorite })}><Star size={11} fill={selectedAsset.favorite ? 'currentColor' : 'none'} /> 즐겨찾기</button><span>{[1, 2, 3, 4, 5].map((rating) => <button key={rating} className={(selectedAsset.rating ?? 0) >= rating ? 'active' : ''} onClick={() => onUpdateAsset(selectedAsset.id, { rating: selectedAsset.rating === rating ? 0 : rating })}>★</button>)}</span><label><span>라벨</span><input type="color" value={selectedAsset.labelColor ?? '#7c5cff'} onChange={(event) => onUpdateAsset(selectedAsset.id, { labelColor: event.target.value })} /></label></div>
                <div className="asset-production-meta"><label><span>씬</span><input value={selectedAsset.scene ?? ''} placeholder="12A" onChange={(event) => onUpdateAsset(selectedAsset.id, { scene: event.target.value })} /></label><label><span>테이크</span><input value={selectedAsset.take ?? ''} placeholder="3" onChange={(event) => onUpdateAsset(selectedAsset.id, { take: event.target.value })} /></label><label><span>카메라</span><input value={selectedAsset.camera ?? ''} placeholder="A CAM" onChange={(event) => onUpdateAsset(selectedAsset.id, { camera: event.target.value })} /></label></div>
                {(selectedAsset.kind === 'video' || selectedAsset.kind === 'audio') && <label><span>소스 시작 TC {selectedAsset.timecodeSource === 'container' && <small>컨테이너</small>}</span><input key={`${selectedAsset.id}-${selectedAsset.timecodeStart ?? 'none'}-${selectedAsset.timecodeDropFrame ?? false}`} defaultValue={selectedAsset.timecodeStart === undefined ? '' : formatMediaTimecode(selectedAsset.timecodeStart, selectedAsset.frameRate || 30, selectedAsset.timecodeDropFrame)} placeholder="00:00:00:00 / 00:00:00;00" onBlur={(event) => { const parsed = parseMediaTimecode(event.target.value, selectedAsset.frameRate || 30); if (event.target.value.trim() && !parsed) event.target.value = selectedAsset.timecodeStart === undefined ? '' : formatMediaTimecode(selectedAsset.timecodeStart, selectedAsset.frameRate || 30, selectedAsset.timecodeDropFrame); else onUpdateAsset(selectedAsset.id, { timecodeStart: parsed?.seconds, sourceTimecode: parsed?.normalized, timecodeDropFrame: parsed?.dropFrame, timecodeSource: parsed ? 'manual' : undefined }) }} /></label>}
                {selectedAsset.reelName && <label><span>릴 메타데이터</span><input value={selectedAsset.reelName} onChange={(event) => onUpdateAsset(selectedAsset.id, { reelName: event.target.value })} /></label>}
                {(selectedAsset.kind === 'video' || selectedAsset.kind === 'image') && <label><span>유효 입력 색공간</span><input readOnly value={effectiveSourceColorLabel(masterAsset ?? selectedAsset)} /></label>}
                {(selectedAsset.kind === 'video' || selectedAsset.kind === 'image') && <label><span>HDR 정적 메타데이터</span><input readOnly value={[selectedAsset.hdrMasteringDisplay?.maxLuminance ? `Master ${selectedAsset.hdrMasteringDisplay.maxLuminance} nit` : undefined, selectedAsset.hdrMasteringDisplay?.minLuminance !== undefined ? `Black ${selectedAsset.hdrMasteringDisplay.minLuminance} nit` : undefined, selectedAsset.maxContentLightLevel ? `MaxCLL ${selectedAsset.maxContentLightLevel}` : undefined, selectedAsset.maxFrameAverageLightLevel ? `MaxFALL ${selectedAsset.maxFrameAverageLightLevel}` : undefined].filter(Boolean).join(' · ') || '없음'} /></label>}
                <label className="asset-notes"><span>메모 · 검색 문맥</span><textarea value={selectedAsset.notes ?? ''} placeholder="예: 오프닝에 쓸 제품 클로즈업" onChange={(event) => onUpdateAsset(selectedAsset.id, { notes: event.target.value })} /></label>
              </div>}
              {selectedAsset && masterAsset && masterAsset.kind !== 'audio' && <details className="source-interpret-editor">
                <summary><span><strong>푸티지 해석</strong><small>{selectedAsset.parentAssetId ? '상위 원본과 모든 서브클립에 공유' : '디코딩 직후, 마스터 효과보다 먼저 적용'}</small></span><span>{masterAsset.sourceRotation ?? 0}° · PAR {(masterAsset.sourcePixelAspectRatio ?? 1).toFixed(3)} · {masterAsset.sourceFrameRateOverride ? `${masterAsset.sourceFrameRateOverride}fps 가정 · ` : ''}{effectiveSourceColorLabel(masterAsset)}</span></summary>
                <div className="source-master-grid">
                  <label><span>소스 회전</span><select value={masterAsset.sourceRotation ?? 0} onChange={(event) => onUpdateAsset(masterAsset.id, { sourceRotation: Number(event.target.value) as MediaAsset['sourceRotation'] })}><option value="0">회전 없음</option><option value="90">시계 방향 90°</option><option value="180">180°</option><option value="270">시계 방향 270°</option></select></label>
                  <label><span>픽셀 종횡비 (PAR)</span><input type="number" min="0.1" max="10" step="0.001" value={masterAsset.sourcePixelAspectRatio ?? 1} list="source-par-options" onChange={(event) => onUpdateAsset(masterAsset.id, { sourcePixelAspectRatio: Math.max(.1, Math.min(10, Number(event.target.value) || 1)) })} /><datalist id="source-par-options"><option value="1" label="Square" /><option value="0.9091" label="D1/DV NTSC" /><option value="1.2121" label="D1/DV NTSC Widescreen" /><option value="1.094" label="D1/DV PAL" /><option value="1.4587" label="D1/DV PAL Widescreen" /><option value="1.333" label="HD Anamorphic" /><option value="2" label="2x Anamorphic" /></datalist></label>
                  <label><span>프레임레이트 가정</span><input type="number" min={Math.max(1, (masterAsset.frameRate ?? 30) * .05)} max={Math.min(240, (masterAsset.frameRate ?? 30) * 16)} step="0.001" value={masterAsset.sourceFrameRateOverride ?? ''} placeholder={`자동 · ${masterAsset.frameRate?.toFixed(3) ?? '원본'} fps`} onChange={(event) => { const value = event.target.value.trim(); onUpdateAsset(masterAsset.id, { sourceFrameRateOverride: value ? Math.max(1, Math.min(240, Number(value) || masterAsset.frameRate || 30)) : undefined }) }} /></label>
                  <label><span>필드 순서</span><select value={masterAsset.sourceFieldOrder ?? 'progressive'} onChange={(event) => onUpdateAsset(masterAsset.id, { sourceFieldOrder: event.target.value as MediaAsset['sourceFieldOrder'] })}><option value="progressive">프로그레시브</option><option value="upper-first">위 필드 우선 · Bob</option><option value="lower-first">아래 필드 우선 · Bob</option></select></label>
                  <label><span>입력 색공간</span><select value={masterAsset.sourceColorSpaceOverride ?? 'auto'} onChange={(event) => onUpdateAsset(masterAsset.id, { sourceColorSpaceOverride: event.target.value as MediaAsset['sourceColorSpaceOverride'] })}><option value="auto">파일 메타데이터 자동</option><option value="rec709">Rec.709 SDR</option><option value="display-p3">Display P3</option><option value="rec2020-pq">Rec.2020 PQ</option><option value="rec2020-hlg">Rec.2020 HLG</option></select></label>
                  <label><span>알파 채널</span><select value={masterAsset.sourceAlphaMode ?? 'straight'} onChange={(event) => onUpdateAsset(masterAsset.id, { sourceAlphaMode: event.target.value as MediaAsset['sourceAlphaMode'] })}><option value="straight">알파 사용</option><option value="ignore">알파 무시 · 불투명 배경</option></select></label>
                  <label><span>알파 무시 배경</span><input type="color" value={masterAsset.sourceAlphaBackground ?? '#000000'} disabled={masterAsset.sourceAlphaMode !== 'ignore'} onChange={(event) => onUpdateAsset(masterAsset.id, { sourceAlphaBackground: event.target.value })} /></label>
                </div><button className="source-master-reset" onClick={() => onUpdateAsset(masterAsset.id, { sourceRotation: undefined, sourcePixelAspectRatio: undefined, sourceFrameRateOverride: undefined, sourceFieldOrder: undefined, sourceColorSpaceOverride: undefined, sourceAlphaMode: undefined, sourceAlphaBackground: undefined })}>푸티지 해석 초기화</button>
              </details>}
              {selectedAsset && masterAsset && <details className={`source-master-editor ${masterAsset.masterEffectsEnabled ? 'enabled' : ''}`}>
                <summary><span><strong>소스 클립 마스터</strong><small>{selectedAsset.parentAssetId ? '상위 원본과 모든 서브클립·시퀀스 사용처에 먼저 적용' : '이 원본을 사용한 모든 시퀀스 클립에 먼저 적용'}</small></span><label onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={Boolean(masterAsset.masterEffectsEnabled)} onChange={(event) => onUpdateAsset(masterAsset.id, { masterEffectsEnabled: event.target.checked })} /> 활성</label></summary>
                {selectedAsset.kind !== 'audio' && <section><h4>마스터 색보정 · 영상 효과</h4><div className="source-master-grid">
                  <label><span>노출</span><input type="number" min="-5" max="5" step="0.1" value={masterColor.exposure} onChange={(event) => updateMasterColor({ exposure: Number(event.target.value) })} /></label>
                  <label><span>대비</span><input type="number" min="-100" max="100" value={masterColor.contrast} onChange={(event) => updateMasterColor({ contrast: Number(event.target.value) })} /></label>
                  <label><span>채도</span><input type="number" min="-100" max="200" value={masterColor.saturation} onChange={(event) => updateMasterColor({ saturation: Number(event.target.value) })} /></label>
                  <label><span>색온도</span><input type="number" min="-100" max="100" value={masterColor.temperature} onChange={(event) => updateMasterColor({ temperature: Number(event.target.value) })} /></label>
                  <label><span>틴트</span><input type="number" min="-100" max="100" value={masterColor.tint} onChange={(event) => updateMasterColor({ tint: Number(event.target.value) })} /></label>
                  <label><span>하이라이트</span><input type="number" min="-100" max="100" value={masterColor.highlights} onChange={(event) => updateMasterColor({ highlights: Number(event.target.value) })} /></label>
                  <label><span>섀도</span><input type="number" min="-100" max="100" value={masterColor.shadows} onChange={(event) => updateMasterColor({ shadows: Number(event.target.value) })} /></label>
                  <label><span>바이브런스</span><input type="number" min="-100" max="100" value={masterColor.vibrance ?? 0} onChange={(event) => updateMasterColor({ vibrance: Number(event.target.value) })} /></label>
                  <label><span>블러</span><input type="number" min="0" max="80" step="0.5" value={masterVisual.blur} onChange={(event) => updateMasterVisual({ blur: Number(event.target.value) })} /></label>
                  <label><span>LUT</span><select value={masterColor.lut} onChange={(event) => updateMasterColor({ lut: event.target.value as typeof masterColor.lut })}><option value="none">없음</option><option value="cinematic">시네마틱</option><option value="warm">웜</option><option value="cool">쿨</option><option value="mono">모노</option></select></label>
                  <label><span>LUT 강도</span><input type="number" min="0" max="100" value={masterColor.lutIntensity} onChange={(event) => updateMasterColor({ lutIntensity: Number(event.target.value) })} /></label>
                </div><div className="source-master-lut"><label><Upload size={11} /> {masterColor.customLut ? '다른 .cube LUT' : '사용자 .cube LUT'}<input type="file" hidden accept=".cube,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then((contents) => parseCubeLut(contents, file.name)).then((customLut) => { updateMasterColor({ customLut, lut: 'none' }); setMasterLutError('') }).catch((error: unknown) => setMasterLutError(error instanceof Error ? error.message : 'LUT를 가져오지 못했습니다.')); event.target.value = '' }} /></label>{masterColor.customLut && <><span>{masterColor.customLut.name} · {masterColor.customLut.dimension}D {masterColor.customLut.size}</span><button onClick={() => updateMasterColor({ customLut: undefined })}><Trash2 size={10} /> 제거</button></>}{masterLutError && <small>{masterLutError}</small>}</div><div className="source-master-chroma"><label><input type="checkbox" checked={Boolean(masterVisual.chromaKeyEnabled)} onChange={(event) => updateMasterVisual({ chromaKeyEnabled: event.target.checked })} /> 크로마키</label><input aria-label="마스터 크로마키 색상" type="color" value={masterVisual.chromaKeyColor ?? '#00ff00'} disabled={!masterVisual.chromaKeyEnabled} onChange={(event) => updateMasterVisual({ chromaKeyColor: event.target.value })} /><label><span>허용</span><input type="number" min="0" max="100" value={masterVisual.chromaKeyTolerance ?? 32} disabled={!masterVisual.chromaKeyEnabled} onChange={(event) => updateMasterVisual({ chromaKeyTolerance: Number(event.target.value) })} /></label></div></section>}
                {selectedAsset.kind !== 'image' && <section><h4>마스터 오디오 처리</h4><div className="source-master-grid">
                  {(masterAsset.audioStreams?.length ?? 0) > 1 && <label><span>소스 오디오 스트림</span><select value={masterAsset.sourceAudioStreamIndex ?? 0} disabled={masterAsset.status === 'offline' || masterAsset.proxyStatus === 'creating'} onChange={(event) => onSelectAudioStream(masterAsset.id, Number(event.target.value))}>{masterAsset.audioStreams!.map((stream) => <option key={stream.index} value={stream.index}>{stream.index + 1} · {stream.title || stream.language || stream.codec || '오디오'} · {stream.channels ?? '?'}ch · {(stream.sampleRate ?? 0) / 1000 || '?'}kHz</option>)}</select><small>선택한 스트림으로 재생·파형·믹싱·출력 프록시를 다시 만듭니다.</small></label>}
                  <label><span>소스 채널 레이아웃</span><select value={masterAsset.sourceAudioLayout ?? 'auto'} onChange={(event) => onUpdateAsset(masterAsset.id, { sourceAudioLayout: event.target.value as MediaAsset['sourceAudioLayout'] })}><option value="auto">자동 · {masterAsset.channels ?? 2}채널</option><option value="mono">모노</option><option value="stereo">스테레오</option><option value="dual-mono">듀얼 모노</option><option value="quad">Quad · L R Ls Rs</option><option value="5.0">5.0 · L R C Ls Rs</option><option value="5.1">5.1 · L R C LFE Ls Rs</option><option value="7.1">7.1 · L R C LFE Lrs Rrs Lss Rss</option></select></label>
                  <label><span>입력 게인</span><input type="number" min="-48" max="24" step="0.5" value={masterAudio.gainDb} onChange={(event) => updateMasterAudio({ gainDb: Number(event.target.value) })} /></label>
                  <label><span>팬</span><input type="number" min="-100" max="100" value={masterAudio.pan} onChange={(event) => updateMasterAudio({ pan: Number(event.target.value) })} /></label>
                  <label><span>채널 해석</span><select value={masterAudio.channelMode ?? 'stereo'} onChange={(event) => updateMasterAudio({ channelMode: event.target.value as typeof masterAudio.channelMode })}><option value="stereo">스테레오 유지</option><option value="mono-left">L → 모노</option><option value="mono-right">R → 모노</option><option value="swap">L/R 교환</option><option value="mid">Mid</option><option value="side">Side</option></select></label>
                  <label><span>스테레오 폭 %</span><input type="number" min="0" max="200" step="1" value={masterAudio.stereoWidth ?? 100} onChange={(event) => updateMasterAudio({ stereoWidth: Math.max(0, Math.min(200, Number(event.target.value))) })} /></label>
                  <label><span>위상 반전</span><select value={masterAudio.phaseInvertLeft && masterAudio.phaseInvertRight ? 'both' : masterAudio.phaseInvertLeft ? 'left' : masterAudio.phaseInvertRight ? 'right' : 'none'} onChange={(event) => updateMasterAudio({ phaseInvertLeft: event.target.value === 'left' || event.target.value === 'both', phaseInvertRight: event.target.value === 'right' || event.target.value === 'both' })}><option value="none">없음</option><option value="left">L 반전</option><option value="right">R 반전</option><option value="both">L/R 반전</option></select></label>
                  <label><span>노이즈 감소</span><input type="number" min="0" max="100" value={masterAudio.noiseReduction} onChange={(event) => updateMasterAudio({ noiseReduction: Number(event.target.value) })} /></label>
                  <label><span>치찰음 감소</span><input type="number" min="0" max="100" value={masterAudio.deEsser ?? 0} onChange={(event) => updateMasterAudio({ deEsser: Number(event.target.value) })} /></label>
                  <label><span>전원 험 제거</span><select value={masterAudio.humRemoval ?? 'off'} onChange={(event) => updateMasterAudio({ humRemoval: event.target.value as typeof masterAudio.humRemoval })}><option value="off">끄기</option><option value="50hz">50Hz</option><option value="60hz">60Hz</option></select></label>
                  <label><span>하이패스 Hz</span><input type="number" min="20" max="1000" step="10" value={masterAudio.highpassHz ?? 20} onChange={(event) => updateMasterAudio({ highpassHz: Number(event.target.value) })} /></label>
                  <label><span>EQ Low</span><input type="number" min="-24" max="24" step="0.5" value={masterAudio.eqLowDb ?? 0} onChange={(event) => updateMasterAudio({ eqLowDb: Number(event.target.value) })} /></label>
                  <label><span>EQ Mid</span><input type="number" min="-24" max="24" step="0.5" value={masterAudio.eqMidDb ?? 0} onChange={(event) => updateMasterAudio({ eqMidDb: Number(event.target.value) })} /></label>
                  <label><span>EQ High</span><input type="number" min="-24" max="24" step="0.5" value={masterAudio.eqHighDb ?? 0} onChange={(event) => updateMasterAudio({ eqHighDb: Number(event.target.value) })} /></label>
                  <label><span>컴프 기준 dB</span><input type="number" min="-60" max="0" step="0.5" value={masterAudio.compressorThresholdDb ?? -12} onChange={(event) => updateMasterAudio({ compressorThresholdDb: Number(event.target.value) })} /></label>
                  <label><span>컴프 비율</span><input type="number" min="1" max="20" step="0.1" value={masterAudio.compressorRatio ?? 1} onChange={(event) => updateMasterAudio({ compressorRatio: Number(event.target.value) })} /></label>
                  <label><span>리미터 dB</span><input type="number" min="-12" max="0" step="0.5" value={masterAudio.limiterDb ?? -1} onChange={(event) => updateMasterAudio({ limiterDb: Number(event.target.value) })} /></label>
                </div><div className="source-master-audio-toggles"><label><input type="checkbox" checked={masterAudio.normalize} onChange={(event) => updateMasterAudio({ normalize: event.target.checked })} /> 피크 정규화</label><label><input type="checkbox" checked={masterAudio.voiceEnhance} onChange={(event) => updateMasterAudio({ voiceEnhance: event.target.checked })} /> 음성 선명도</label></div></section>}
                <button className="source-master-reset" onClick={() => onUpdateAsset(masterAsset.id, { masterEffectsEnabled: false, masterColorAdjustment: undefined, masterVisualEffects: undefined, masterAudioAdjustment: undefined })}>마스터 설정 초기화</button>
              </details>}
              {selectedAsset?.kind === 'image' && <button className="background-remove-button" disabled={backgroundRemovalRunning || selectedAsset.status !== 'ready'} onClick={() => onRemoveBackground(selectedAsset.id)}>{backgroundRemovalRunning ? <LoaderCircle className="spin" size={12} /> : <Sparkles size={12} />} {backgroundRemovalRunning ? `${backgroundRemovalStage} · ${Math.round(backgroundRemovalProgress * 100)}%` : '로컬 AI 배경 제거 → 새 PNG'}</button>}
              {selectedAsset?.kind === 'image' && <details className="optional-integration"><summary>선택적 외부 연동</summary><button className="comfy-open-button" disabled={selectedAsset.status !== 'ready'} onClick={() => onOpenComfyUi(selectedAsset.id)}><Sparkles size={12} /> ComfyUI 워크플로로 보내기</button><small>일반 편집에는 필요하지 않으며 로컬 ComfyUI를 사용하는 경우에만 엽니다.</small></details>}
              {selectedAsset && selectedAsset.kind !== 'image' && <button className="create-subclip-button" disabled={(sourceOut ?? interpretedSourceDuration(selectedAsset.duration, masterAsset)) - (sourceIn ?? 0) < 1 / 60} onClick={() => onCreateSubclip(selectedAsset.id)}>현재 소스 IN/OUT을 서브클립으로 저장</button>}
              {selectedAsset && !selectedAsset.parentAssetId && (selectedAsset.status === 'offline' || selectedAsset.proxyStatus === 'ready') && <button className="create-subclip-button" disabled={selectedAsset.status === 'analyzing'} onClick={() => replaceSelectedAsset(true)}><RefreshCw size={12} /> 전체 해상도 원본 재연결 · 프록시 유지</button>}
              {selectedAsset && !selectedAsset.parentAssetId && <button className="create-subclip-button" disabled={selectedAsset.status === 'analyzing'} onClick={() => replaceSelectedAsset(false)}><RefreshCw size={12} /> 원본 교체 · 편집 유지</button>}
              <button className="add-selected-button" disabled={!selectedAssetId || selectedAssetState?.status !== 'ready'} onClick={() => selectedAssetId && onAddAsset(selectedAssetId)}>
                선택 미디어를 타임라인에 추가
              </button>
              {selectedAsset && <button className="create-subclip-button" disabled={!usedAssetIds.has(selectedAsset.id) && !assets.some((asset) => asset.parentAssetId === selectedAsset.id && usedAssetIds.has(asset.id))} onClick={() => onRevealAssetUse(selectedAsset.id)}>사용 중인 시퀀스 클립으로 이동</button>}
              {desktop && masterAsset?.sourcePath && <span className="asset-batch-toggle"><button title={masterAsset.sourcePath} onClick={() => onRevealMediaPath(masterAsset.sourcePath!)}><FolderOpen size={11} /> 원본 위치</button><button title={masterAsset.sourcePath} onClick={() => onCopyMediaPath(masterAsset.sourcePath!)}><Copy size={11} /> 원본 경로</button></span>}
              {desktop && masterAsset?.proxySourcePath && <span className="asset-batch-toggle"><button title={masterAsset.proxySourcePath} onClick={() => onRevealMediaPath(masterAsset.proxySourcePath!)}><FolderOpen size={11} /> 외부 프록시 위치</button><button title={masterAsset.proxySourcePath} onClick={() => onCopyMediaPath(masterAsset.proxySourcePath!)}><Copy size={11} /> 프록시 경로</button></span>}
              {selectedAsset && !selectedAsset.parentAssetId && selectedAsset.status === 'ready' && <button className="create-subclip-button" onClick={() => onMakeAssetOffline(selectedAsset.id)}><AlertCircle size={12} /> 원본만 오프라인 · 편집 유지</button>}
              {selectedAsset && selectedAssetIds.size <= 1 && <button className="remove-asset-button" onClick={() => onRemoveAsset(selectedAsset.id)}><Trash2 size={12} /> 프로젝트에서 미디어 제거</button>}
            </div>
          )}
        </div>
      )}

      {panel === 'transcript' && (
        <div className="panel-content transcript-content">
          <div className="panel-heading transcript-heading">
            <div><span className="eyebrow">TEXT-BASED EDIT</span><h2>대본으로 편집</h2></div>
            <div className="subtitle-actions">
              <input className="subtitle-language" value={subtitleLanguage} maxLength={12} aria-label="자막 언어 코드" title="BCP 47 언어 코드" onChange={(event) => setSubtitleLanguage(event.target.value.trim())} />
              <button className="small-button" onClick={() => subtitleInputRef.current?.click()}><FileText size={13} /> 자막 가져오기</button>
              <button className="small-button" onClick={() => onExportSubtitles('srt')} disabled={!transcript.length}><Download size={13} /> SRT</button>
              <button className="small-button" onClick={() => onExportSubtitles('vtt')} disabled={!transcript.length}><Download size={13} /> VTT</button>
              <button className="small-button" onClick={() => onExportSubtitles('ttml', subtitleLanguage || 'und')} disabled={!transcript.length}><Download size={13} /> TTML</button>
            </div>
            <input
              ref={subtitleInputRef}
              type="file"
              hidden
              accept=".srt,.vtt,.ttml,.dfxp,text/vtt,application/x-subrip,application/ttml+xml,application/xml,text/xml,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) onSubtitleFile(file)
                event.target.value = ''
              }}
            />
          </div>

          <div className="transcription-run-control"><button className="transcribe-button" title={canTranscribe ? '선택 미디어를 우선 사용하고, 없으면 첫 번째 음성 포함 미디어를 전사합니다.' : '먼저 음성이 포함된 영상 또는 오디오를 가져오세요.'} onClick={onTranscribe} disabled={!canTranscribe || transcriptionRunning}>
            {transcriptionRunning ? <LoaderCircle className="spin" size={15} /> : <Mic2 size={15} />}
            <span><strong>{transcriptionRunning ? transcriptionStage : '로컬 Whisper · 화자 재식별'}</strong><small>{transcriptionRunning ? `${Math.round(transcriptionProgress * 100)}%` : '첫 실행 시 음성 인식·화자 모델을 이 기기에 캐시합니다.'}</small></span>
          </button>{transcriptionRunning && <button className="small-button danger" onClick={onCancelTranscription}><X size={12} /> 취소</button>}{!transcriptionRunning && speakerProfileCount > 0 && <button className="small-button danger" onClick={onClearSpeakerProfiles}>화자 특징 {speakerProfileCount}개 삭제</button>}</div>
          {transcriptionRunning && <progress className="transcription-progress" max="1" value={transcriptionProgress} />}

          {transcript.length > 0 && <div className={`caption-qc-summary ${captionQc.affected ? 'warning' : 'clear'}`}><Check size={12} /><span><strong>캡션 QC · {captionQc.affected ? `${captionQc.affected}/${captionQc.total}개 확인 필요` : `${captionQc.total}개 통과`}</strong><small>겹침 · 20 CPS 초과 · 한 줄 42자 초과 · 0.8초 미만 큐</small></span></div>}

          <details className="correction-dictionary"><summary>고유명사 · 교정 사전 ({Object.keys(correctionDictionary).length})</summary><form onSubmit={(event) => { event.preventDefault(); if (!dictionarySource.trim() || !dictionaryReplacement.trim()) return; onAddCorrection(dictionarySource.trim(), dictionaryReplacement.trim()); setDictionarySource(''); setDictionaryReplacement('') }}><input value={dictionarySource} onChange={(event) => setDictionarySource(event.target.value)} placeholder="인식된 표현" /><span>→</span><input value={dictionaryReplacement} onChange={(event) => setDictionaryReplacement(event.target.value)} placeholder="바꿀 표현" /><button>추가</button></form><div>{Object.entries(correctionDictionary).map(([source, replacement]) => <button key={source} onClick={() => onRemoveCorrection(source)} title="눌러서 삭제"><s>{source}</s> → {replacement} <X size={9} /></button>)}</div></details>

          <div className="transcript-list">
            {transcript.map((segment) => {
              const issues = captionQc.issues.get(segment.id) ?? []
              return <article key={segment.id} className={`transcript-segment ${issues.length ? 'qc-warning' : ''} ${selectedTranscriptId === segment.id ? 'selected' : ''}`} onClick={() => onSelectTranscript(segment)}>
                <div className="segment-meta"><span>{cueTimecode(segment.start)}</span>{issues.length > 0 && <em className="caption-qc-badge" title="캡션 QC 확인 필요">{issues.join(' · ')}</em>}<input aria-label="화자 이름" title="이름을 바꾸면 프로젝트에서 재식별된 동일 화자 전체에 반영됩니다." value={segment.speaker ?? '화자 1'} onChange={(event) => onUpdateTranscript(segment.id, { speaker: event.target.value })} onFocus={() => { speakerEditOriginRef.current.set(segment.id, segment.speaker ?? '화자 1'); onTranscriptEditStart() }} onBlur={(event) => { onRenameSpeaker(segment.id, speakerEditOriginRef.current.get(segment.id) ?? segment.speaker ?? '화자 1', event.currentTarget.value); speakerEditOriginRef.current.delete(segment.id); onTranscriptEditCommit() }} /><select className="speaker-assign" aria-label="이 발화만 화자 재지정" title="이 발화만 기존 화자에 재지정" value={segment.speaker ?? '화자 1'} onClick={(event) => event.stopPropagation()} onChange={(event) => onAssignSegmentSpeaker(segment.id, event.target.value)}>{transcriptSpeakers.map((speaker) => <option key={speaker} value={speaker}>{speaker}</option>)}</select><button className="speaker-split" onClick={(event) => { event.stopPropagation(); onAssignSegmentSpeaker(segment.id) }} title="이 발화만 새 화자로 분리">+ 화자</button>{segment.speakerEmbeddingVersion && <i className="speaker-confidence" title={`${segment.speakerEmbeddingVersion} 유사도 신뢰도`}>{segment.speakerAssignedManually ? '수동' : `${Math.round((segment.speakerConfidence ?? 0) * 100)}%`}</i>}<button onClick={(event) => { event.stopPropagation(); onRemoveTranscript(segment) }} aria-label={`${segment.text} 구간 삭제`}><Trash2 size={12} /></button></div>
                <textarea value={segment.text} rows={Math.max(2, Math.ceil(segment.text.length / 24))} onChange={(event) => onUpdateTranscript(segment.id, { text: event.target.value })} onFocus={() => { onTranscriptEditStart(); onSelectTranscript(segment) }} onBlur={onTranscriptEditCommit} />
                <div className="caption-cue-timing" onClick={(event) => event.stopPropagation()}><label><span>IN</span><input key={`${segment.id}-in-${segment.start}`} defaultValue={cueTimecode(segment.start)} onFocus={() => onTranscriptEditStart()} onBlur={(event) => commitCueTimecode(segment, 'start', event.currentTarget.value, (value) => { event.currentTarget.value = value })} /></label><label><span>OUT</span><input key={`${segment.id}-out-${segment.end}`} defaultValue={cueTimecode(segment.end)} onFocus={() => onTranscriptEditStart()} onBlur={(event) => commitCueTimecode(segment, 'end', event.currentTarget.value, (value) => { event.currentTarget.value = value })} /></label><button onClick={() => onSplitTranscript(segment.id)}>중간 분할</button><button disabled={captionQc.lastId === segment.id} onClick={() => onMergeTranscript(segment.id)}>다음 큐 병합</button></div>
                {segment.words?.length ? <div className="word-timing-strip">{segment.words.map((word, index) => <span key={`${word.start}-${index}`} title={`${formatTimecode(word.start, true)}–${formatTimecode(word.end, true)}`}>{word.text}</span>)}</div> : null}
              </article>
            })}
          </div>

          {!transcript.length && (
            <div className="transcript-empty"><Captions size={22} /><strong>아직 대본이 없습니다</strong><p>SRT/VTT를 가져오거나 선택한 미디어를 로컬에서 음성 인식하세요.</p></div>
          )}
          <button className="add-selected-button" disabled={!transcript.length} onClick={() => onGenerateCaptions(subtitleLanguage || 'und')}>대본을 {subtitleLanguage || 'und'} 자막 트랙에 반영</button>
          <p className="feature-note">문장 삭제는 같은 시간 범위를 모든 트랙에서 제거하고 뒤 클립을 자동으로 당깁니다.</p>
        </div>
      )}

      {panel === 'ai' && (
        <div className="panel-content ai-content">
          <span className="eyebrow">ROUGH CUT ASSISTANT</span>
          <h2>AI 초벌 편집</h2>
          <div className="ai-card"><Sparkles size={18} /><div><strong>침묵·군더더기·반복 찾기</strong><p>파형과 대본을 분석하고 적용 전 후보로 보여줍니다.</p></div></div>
          <p className="creator-learning-summary">이 프로젝트 채널 피드백 {Object.values(creatorLearningProfile.suggestionStats).reduce((sum, stat) => sum + stat.applied + stat.dismissed, 0)}건 · 적용/유지 선택으로 유형별 추천 기준을 조정합니다. <button onClick={onResetCreatorLearning}>학습 초기화</button></p>
          <div className="retention-import">
            <div><strong>YouTube 유지율</strong><small>{creatorLearningProfile.audienceRetention ? `${creatorLearningProfile.audienceRetention.sourceName} · ${creatorLearningProfile.audienceRetention.samples.length}개 지점` : 'Analytics CSV를 가져오면 실제 이탈·유지 구간의 의미 패턴을 학습합니다.'}</small></div>
            <button onClick={() => retentionInputRef.current?.click()}><Upload size={12} /> {creatorLearningProfile.audienceRetention ? '교체' : 'CSV'}</button>
            <input ref={retentionInputRef} type="file" hidden accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) onRetentionFile(file); event.target.value = '' }} />
          </div>
          <button className="primary-button wide" title={!transcript.length && !assets.some((asset) => asset.waveform?.length) ? '대본을 가져오거나 미디어 파형 분석이 끝난 뒤 사용할 수 있습니다.' : '파형과 대본에서 침묵·군더더기·반복·하이라이트 후보를 찾습니다.'} onClick={onAnalyzeSuggestions} disabled={roughCutAnalysisRunning || (!transcript.length && !assets.some((asset) => asset.waveform?.length))}>{roughCutAnalysisRunning ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />} {roughCutAnalysisRunning ? roughCutAnalysisStage : '채널 맞춤 초벌 편집 분석'}</button>
          {roughCutAnalysisRunning && <progress className="transcription-progress" max="1" value={roughCutAnalysisProgress} />}

          <div className="suggestion-list">
            {suggestions.filter((suggestion) => suggestion.status === 'pending').map((suggestion) => (
              <article className={`suggestion-card ${suggestion.type}`} key={suggestion.id}>
                <div className="suggestion-title"><span>{suggestion.type}</span><time>{formatTimecode(suggestion.start)}–{formatTimecode(suggestion.end)} · {Math.round(suggestion.score * 100)}%</time></div>
                <strong>{suggestion.label}</strong>
                <p>{suggestion.reason}</p>
                <footer>
                  <button onClick={() => onDismissSuggestion(suggestion.id)}><X size={12} /> 유지</button>
                  <button className="apply" onClick={() => onApplySuggestion(suggestion)}><Check size={12} /> {suggestion.type === 'highlight' ? '챕터 마커 적용' : '제거 적용'}</button>
                </footer>
              </article>
            ))}
          </div>

          {!suggestions.some((suggestion) => suggestion.status === 'pending') && <p className="privacy-note">화자 음성 특징과 분석 결과는 이 프로젝트에만 저장되며 외부로 전송되지 않습니다. 적용한 편집은 실행 취소할 수 있습니다.</p>}
        </div>
      )}
      <AutomateSequenceDialog open={automateOpen} assetNames={filteredAssets.filter((asset) => selectedAssetIds.has(asset.id)).map((asset) => asset.name)} markerCount={sequenceMarkerCount} onClose={() => setAutomateOpen(false)} onApply={(options) => { onAutomateAssets(filteredAssets.filter((asset) => selectedAssetIds.has(asset.id)).map((asset) => asset.id), options); setAutomateOpen(false) }} />
      <MulticamSourceDialog open={multicamSourceOpen} assets={selectedRootVideoIds.map((id) => assets.find((asset) => asset.id === id)).filter((asset): asset is MediaAsset => Boolean(asset))} suggestedName={`멀티캠 소스 ${assets.filter((asset) => asset.tags?.includes('멀티캠')).length + 1}`} onClose={() => setMulticamSourceOpen(false)} onCreate={(options) => { onCreateMulticamSource(selectedRootVideoIds, options); setMulticamSourceOpen(false) }} />
    </aside>
  )
}
