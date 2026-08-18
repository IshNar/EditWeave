export type AspectRatio = '16:9' | '9:16' | '4:5' | '1:1'
export type MediaKind = 'video' | 'audio' | 'image'
export type TrackKind = 'video' | 'audio' | 'caption'
export type EditMode = 'append' | 'insert' | 'overwrite'
export type EditorTool = 'selection' | 'razor' | 'hand' | 'zoom'
export type TrimMode = 'normal' | 'ripple' | 'roll' | 'slip' | 'slide' | 'rate-stretch'
export type TransitionType = 'none' | 'crossfade' | 'dip-black' | 'dip-white' | 'wipe-left' | 'wipe-right' | 'wipe-up' | 'wipe-down' | 'slide-left' | 'slide-right' | 'zoom' | 'blur-dissolve'
export type LutPreset = 'none' | 'cinematic' | 'warm' | 'cool' | 'mono'
export type AudioRole = 'dialogue' | 'music' | 'effects' | 'ambient'
export type AudioChannelLayout = 'auto' | 'mono' | 'stereo' | 'dual-mono' | 'quad' | '5.0' | '5.1' | '7.1'
export interface SourceAudioStream { index: number; codec?: string; sampleRate?: number; channels?: number; language?: string; title?: string }
export type TitleTemplate = 'headline' | 'lower-third' | 'quote' | 'subscribe' | 'callout'

export interface SequencePreset {
  ratio: AspectRatio
  width: number
  height: number
  label: string
}

export interface MediaAsset {
  id: string
  name: string
  kind: MediaKind
  url: string
  sourceFile?: File
  sourcePath?: string
  sourceLastModified?: number
  sourceQuickSignature?: string
  streamingSource?: boolean
  imageSequenceFiles?: File[]
  imageSequencePaths?: string[]
  imageSequenceUrls?: string[]
  imageSequenceFrameRate?: number
  duration: number
  size: number
  extension: string
  width?: number
  height?: number
  videoCodec?: string
  videoDecodable?: boolean
  imageDecodable?: boolean
  frameRate?: number
  variableFrameRate?: boolean
  frameRateVariation?: number
  audioCodec?: string
  audioDecodable?: boolean
  sampleRate?: number
  channels?: number
  audioStreams?: SourceAudioStream[]
  sourceAudioStreamIndex?: number
  sourceAudioLayout?: AudioChannelLayout
  audioPeak?: number
  thumbnailUrl?: string
  waveform?: number[]
  status: 'analyzing' | 'ready' | 'offline' | 'error'
  /** Runtime-only timestamp used to prevent a decoder probe from leaving the asset pending forever. */
  analysisStartedAt?: number
  error?: string
  proxyFile?: File
  proxyUrl?: string
  proxySize?: number
  proxyWidth?: number
  proxyHeight?: number
  proxyFrameRate?: number
  proxyCachePath?: string
  /** User-managed proxy file. Unlike proxyCachePath, this path must never be deleted by EditWeave. */
  proxySourcePath?: string
  proxySourceName?: string
  proxyOrigin?: 'generated' | 'attached'
  proxyPurpose?: 'editing' | 'compatibility' | 'external'
  proxyCachedAt?: string
  proxyTimecode?: string
  proxyTimecodeVerified?: boolean
  proxyTimecodeMismatch?: boolean
  proxyStatus?: 'none' | 'loading' | 'queued' | 'creating' | 'ready' | 'error'
  proxyProgress?: number
  proxyError?: string
  /** Persisted user preference. useProxy may be forced true temporarily while the original is offline. */
  proxyEnabled?: boolean
  useProxy?: boolean
  folder?: string
  tags?: string[]
  notes?: string
  rating?: number
  favorite?: boolean
  labelColor?: string
  scene?: string
  take?: string
  camera?: string
  importedAt?: string
  parentAssetId?: string
  subclipIn?: number
  subclipOut?: number
  timecodeStart?: number
  sourceTimecode?: string
  timecodeDropFrame?: boolean
  timecodeSource?: 'container' | 'manual'
  reelName?: string
  colorPrimaries?: string
  colorTransfer?: string
  colorSpace?: string
  colorRange?: string
  hdrFormat?: 'pq' | 'hlg' | 'wide-gamut'
  hdrMasteringDisplay?: HdrMasteringDisplay
  maxContentLightLevel?: number
  maxFrameAverageLightLevel?: number
  faceTrack?: Array<{ time: number; x: number; y: number; confidence: number }>
  masterEffectsEnabled?: boolean
  masterColorAdjustment?: ColorAdjustment
  masterVisualEffects?: VisualEffects
  masterAudioAdjustment?: AudioAdjustment
  sourceRotation?: 0 | 90 | 180 | 270
  sourcePixelAspectRatio?: number
  sourceFieldOrder?: 'progressive' | 'upper-first' | 'lower-first'
  sourceFrameRateOverride?: number
  sourceColorSpaceOverride?: 'auto' | 'rec709' | 'display-p3' | 'rec2020-pq' | 'rec2020-hlg'
  sourceAlphaMode?: 'straight' | 'ignore'
  sourceAlphaBackground?: string
}

export interface HdrMasteringDisplay {
  redX?: number
  redY?: number
  greenX?: number
  greenY?: number
  blueX?: number
  blueY?: number
  whitePointX?: number
  whitePointY?: number
  minLuminance?: number
  maxLuminance?: number
}

export interface ClipTransform {
  positionX: number
  positionY: number
  scale: number
  /** Independent horizontal scale in percent. Negative values mirror the image. */
  scaleX?: number
  /** Independent vertical scale in percent. Negative values mirror the image. */
  scaleY?: number
  /** Transform origin across the fitted source frame, in percent. */
  anchorX?: number
  /** Transform origin down the fitted source frame, in percent. */
  anchorY?: number
  /** Horizontal shear angle in degrees. */
  skewX?: number
  /** Vertical shear angle in degrees. */
  skewY?: number
  rotation: number
  opacity: number
}

export interface TransformKeyframe {
  id: string
  time: number
  easing: 'linear' | 'hold' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'bezier'
  curve?: { x1: number; y1: number; x2: number; y2: number }
  /** Spatial tangent entering this position, relative to the keyframe point. */
  spatialIn?: { x: number; y: number }
  /** Spatial tangent leaving this position, relative to the keyframe point. */
  spatialOut?: { x: number; y: number }
  transform: ClipTransform
}

export interface SpeedKeyframe {
  id: string
  time: number
  rate: number
  easing: 'linear' | 'hold' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'bezier'
  curve?: { x1: number; y1: number; x2: number; y2: number }
}

export interface ClipTransition {
  type: TransitionType
  duration: number
  alignment?: 'start-at-cut' | 'center-on-cut' | 'end-at-cut'
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'bezier'
  curve?: { x1: number; y1: number; x2: number; y2: number }
  audioCurve?: 'linear' | 'equal-power' | 'logarithmic'
}

export interface SequenceTransitionDefaults {
  video: ClipTransition
  audio: ClipTransition
}

export interface TrackMatte {
  sourceTrackId: string
  mode: 'alpha' | 'alpha-inverted' | 'luma' | 'luma-inverted'
  showSource?: boolean
}

export type VideoEffectStackKind = 'chroma-key' | 'color-grade' | 'blur-shadow' | 'crop-mask' | 'corner-pin' | 'face-mosaic' | 'vignette'

export interface VideoEffectStackItem {
  id: string
  kind: VideoEffectStackKind
  name: string
  enabled: boolean
}

export interface ColorAdjustment {
  exposure: number
  contrast: number
  saturation: number
  temperature: number
  tint: number
  highlights: number
  shadows: number
  lut: LutPreset
  lutIntensity: number
  customLut?: import('./lut').EmbeddedColorLut
  hue?: number
  vibrance?: number
  fade?: number
  vignette?: number
  lift?: number
  gamma?: number
  gain?: number
  curveShadows?: number
  curveMidtones?: number
  curveHighlights?: number
  masterCurve?: Array<{ x: number; y: number }>
  redCurve?: Array<{ x: number; y: number }>
  greenCurve?: Array<{ x: number; y: number }>
  blueCurve?: Array<{ x: number; y: number }>
  qualifierEnabled?: boolean
  qualifierHue?: number
  qualifierHueRange?: number
  qualifierSaturationMin?: number
  qualifierSaturationMax?: number
  qualifierLuminanceMin?: number
  qualifierLuminanceMax?: number
  qualifierSoftness?: number
  qualifierExposure?: number
  qualifierSaturation?: number
  qualifierHueShift?: number
  qualifierShowMask?: boolean
  colorNodes?: ColorNode[]
  colorOutputNodeId?: string
}

export type ColorNodeType = 'primary' | 'curves' | 'qualifier' | 'look' | 'tone-map'

export interface ColorNode {
  id: string
  name: string
  type: ColorNodeType
  enabled: boolean
  mix: number
  inputIds: string[]
  blendMode: 'normal' | 'add' | 'multiply' | 'screen'
  adjustment: Partial<Omit<ColorAdjustment, 'colorNodes' | 'colorOutputNodeId'>> & {
    toneMapMethod?: 'hable' | 'reinhard' | 'mobius'
    sourcePeakNits?: number
    targetPeakNits?: number
  }
}

export interface VisualEffects {
  cropTop: number
  cropRight: number
  cropBottom: number
  cropLeft: number
  blur: number
  shadowOpacity: number
  shadowBlur: number
  shadowX: number
  shadowY: number
  mask: 'none' | 'ellipse' | 'rounded' | 'polygon'
  maskPoints?: Array<{ x: number; y: number }>
  maskFeather?: number
  maskInvert?: boolean
  masks?: EffectMask[]
  faceMosaic: boolean
  mosaicSize: number
  blendMode?: 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'color-dodge' | 'color-burn'
  chromaKeyEnabled?: boolean
  chromaKeyColor?: string
  chromaKeyTolerance?: number
  chromaKeySoftness?: number
  chromaSpill?: number
  cornerPinEnabled?: boolean
  cornerPinPoints?: Array<{ x: number; y: number }>
}

export interface MaskPoint {
  x: number
  y: number
  inHandle?: { x: number; y: number }
  outHandle?: { x: number; y: number }
}

export interface EffectMask {
  id: string
  name: string
  shape: 'ellipse' | 'rounded' | 'polygon' | 'bezier'
  points: MaskPoint[]
  feather: number
  opacity: number
  invert: boolean
  operation: 'add' | 'subtract' | 'intersect'
  enabled: boolean
}

export interface VisualEffectKeyframe {
  id: string
  time: number
  easing: TransformKeyframe['easing']
  curve?: TransformKeyframe['curve']
  effects: VisualEffects
}

export interface AudioAdjustment {
  gainDb: number
  pan: number
  channelMode?: 'stereo' | 'mono-left' | 'mono-right' | 'swap' | 'mid' | 'side'
  stereoWidth?: number
  phaseInvertLeft?: boolean
  phaseInvertRight?: boolean
  downmixCenterDb?: number
  downmixSurroundDb?: number
  downmixLfeDb?: number
  lfeSendDb?: number
  lfeLowpassHz?: number
  surroundPan?: number
  surroundSpread?: number
  fadeIn: number
  fadeOut: number
  fadeInCurve?: 'linear' | 'equal-power' | 'logarithmic'
  fadeOutCurve?: 'linear' | 'equal-power' | 'logarithmic'
  normalize: boolean
  preservePitch: boolean
  noiseReduction: number
  voiceEnhance: boolean
  deEsser?: number
  humRemoval?: 'off' | '50hz' | '60hz'
  ducking: boolean
  duckingAmountDb?: number
  duckingAttackMs?: number
  duckingReleaseMs?: number
  role: AudioRole
  sendBus?: AudioRole
  sendLevelDb?: number
  auxSends?: AudioAuxSend[]
  highpassHz?: number
  eqLowDb?: number
  eqMidDb?: number
  eqHighDb?: number
  compressorThresholdDb?: number
  compressorRatio?: number
  limiterDb?: number
}

export interface AudioAuxSend {
  id: string
  bus: AudioRole
  levelDb: number
  position: 'pre' | 'post'
  enabled: boolean
}

export interface AudioBusSettings {
  gainDb: number
  muted: boolean
  solo: boolean
  limiterDb: number
  inserts: AudioBusInsert[]
}

export type AudioBusInsertType = 'highpass' | 'equalizer' | 'de-esser' | 'hum-removal' | 'compressor' | 'delay' | 'limiter'

export interface AudioBusInsert {
  id: string
  type: AudioBusInsertType
  enabled: boolean
  frequencyHz?: number
  lowDb?: number
  midDb?: number
  highDb?: number
  thresholdDb?: number
  ratio?: number
  makeupDb?: number
  ceilingDb?: number
  amount?: number
  humFrequencyHz?: 50 | 60
  delayMs?: number
  feedback?: number
  mix?: number
}

export type AudioBusMap = Record<AudioRole, AudioBusSettings>

export interface AudioMixKeyframe {
  id: string
  time: number
  gainDb: number
  pan: number
  easing: TransformKeyframe['easing']
  curve?: TransformKeyframe['curve']
}

export interface TrackMixKeyframe {
  id: string
  time: number
  volume: number
  pan: number
  easing: TransformKeyframe['easing']
  curve?: TransformKeyframe['curve']
}

export interface CaptionStyle {
  preset: 'default' | 'bold' | 'minimal' | 'karaoke'
  fontSize: number
  textColor: string
  backgroundColor: string
  position: 'top' | 'middle' | 'bottom'
  highlightColor: string
  fontFamily?: 'sans' | 'serif' | 'mono'
  fontWeight?: number
  strokeColor?: string
  strokeWidth?: number
  textAlign?: 'left' | 'center' | 'right'
  positionX?: number
  positionY?: number
  lineHeight?: number
  letterSpacing?: number
  maxWidth?: number
  backgroundEnabled?: boolean
  backgroundPaddingX?: number
  backgroundPaddingY?: number
  backgroundRadius?: number
  shadowColor?: string
  shadowBlur?: number
  shadowX?: number
  shadowY?: number
  rotation?: number
  safeArea?: 'none' | 'action' | 'title'
  uppercase?: boolean
  animation?: 'none' | 'fade' | 'pop' | 'slide-up'
  animationOut?: 'none' | 'fade' | 'pop' | 'slide-down'
  animationDuration?: number
  template?: TitleTemplate
}

export interface TimelineClip {
  id: string
  trackId: string
  /** Original clip identity retained by derived sequences for selective source updates. */
  sourceClipId?: string
  /** Original track identity retained by derived sequences for selective source updates. */
  sourceTrackId?: string
  assetId?: string
  subclipId?: string
  name: string
  start: number
  duration: number
  sourceOffset: number
  kind: TrackKind
  color: string
  enabled?: boolean
  transform: ClipTransform
  playbackRate?: number
  speedKeyframes?: SpeedKeyframe[]
  frameInterpolation?: 'sampling' | 'blend' | 'optical-flow'
  reverse?: boolean
  freezeFrame?: boolean
  freezeFrameSourceTime?: number
  compositePriority?: number
  multicamAngleIndex?: number
  trackMatte?: TrackMatte
  effectStack?: VideoEffectStackItem[]
  groupId?: string
  linkGroupId?: string
  transitionIn?: ClipTransition
  transitionOut?: ClipTransition
  keyframes?: TransformKeyframe[]
  motionPathAutoOrient?: boolean
  motionPathOrientationOffset?: number
  motionBlur?: {
    enabled: boolean
    shutterAngle: number
    samples: number
  }
  stabilization?: {
    method: 'four-point'
    strength: number
    autoScale: number
    sampleCount: number
    analyzedAt: string
    originalTransform: ClipTransform
    originalKeyframes?: TransformKeyframe[]
  }
  colorAdjustment?: ColorAdjustment
  visualEffects?: VisualEffects
  visualKeyframes?: VisualEffectKeyframe[]
  audioAdjustment?: AudioAdjustment
  audioMixKeyframes?: AudioMixKeyframe[]
  audioDisabled?: boolean
  captionStyle?: CaptionStyle
  captionWords?: Array<{ start: number; end: number; text: string; confidence?: number }>
  captionLanguage?: string
  speaker?: string
  adjustmentLayer?: boolean
  nestedSequenceId?: string
  multicamAngle?: number
  multicamAudioMode?: 'camera-1' | 'follow-video' | 'selected-angle' | 'all'
  multicamAudioAngle?: number
  adrCue?: string
  adrTake?: number
  adrCueId?: string
  adrTakeId?: string
  adrCompRanges?: Array<{ start: number; end: number }>
  clipMarkers?: ClipMarker[]
  renderReplacement?: {
    originalClipsJson: string
    originalAssetIds?: string[]
    renderedAssetId: string
    createdAt: string
  }
}

export interface ClipMarker {
  id: string
  time: number
  duration?: number
  label: string
  description?: string
  color: string
}

export interface TimelineTrack {
  id: string
  name: string
  kind: TrackKind
  /** Stable camera-angle identity shared by paired multicam video/audio tracks. */
  multicamAngleIndex?: number
  sourceTarget?: boolean
  editTarget?: boolean
  muted: boolean
  locked: boolean
  syncLock?: boolean
  volume?: number
  pan?: number
  visible?: boolean
  solo?: boolean
  mixAutomationMode?: 'off' | 'read' | 'write' | 'touch' | 'latch'
  mixKeyframes?: TrackMixKeyframe[]
  compositePriority?: number
  displayHeight?: number
  labelColor?: string
  audioRole?: AudioRole
  audioOutputChannel?: 'auto' | 'left' | 'right' | 'center' | 'lfe' | 'left-surround' | 'right-surround' | 'surround-pan'
  surroundPan?: number
  surroundSpread?: number
  lfeSendDb?: number
  lfeLowpassHz?: number
  captionLanguage?: string
  captionFormat?: 'subtitle' | 'closed-caption'
  captionStyle?: CaptionStyle
  clips: TimelineClip[]
}

export interface TimelineMarker {
  id: string
  time: number
  duration?: number
  label: string
  description?: string
  color: string
  kind: 'chapter' | 'edit' | 'comment'
  status?: 'open' | 'resolved'
  author?: string
  createdAt?: string
  updatedAt?: string
}

export type EditorPanel = 'media' | 'transcript' | 'ai'

export interface SequenceSettings {
  id: string
  name: string
  aspectRatio: AspectRatio
  width: number
  height: number
  fps: number
  timecodeStart?: number
  timecodeDropFrame?: boolean
}

export interface TranscriptSegment {
  id: string
  start: number
  end: number
  text: string
  language?: string
  speaker?: string
  speakerConfidence?: number
  speakerEmbeddingVersion?: string
  speakerEmbedding?: number[]
  speakerIdentityId?: string
  speakerAssignedManually?: boolean
  confidence?: number
  words?: Array<{ start: number; end: number; text: string; confidence?: number }>
}

export interface SpeakerVoiceProfile {
  identityId: string
  speaker: string
  embeddingVersion: string
  centroid: number[]
  sampleWeight: number
  updatedAt: string
}

export type EditSuggestionType = 'silence' | 'filler' | 'repetition' | 'highlight'

export interface EditSuggestion {
  id: string
  type: EditSuggestionType
  start: number
  end: number
  label: string
  reason: string
  score: number
  status: 'pending' | 'applied' | 'dismissed'
  semanticVector?: number[]
}

export interface CreatorLearningStat {
  applied: number
  dismissed: number
  appliedDuration: number
  dismissedDuration: number
}

export interface AudienceRetentionSample {
  time: number
  retention: number
}

export interface AudienceRetentionProfile {
  sourceName: string
  importedAt: string
  duration: number
  samples: AudienceRetentionSample[]
}

export interface SemanticFeedbackProfile {
  model: 'Xenova/multilingual-e5-small'
  dimensions: number
  positiveCentroid?: number[]
  positiveCount: number
  negativeCentroid?: number[]
  negativeCount: number
}

export interface CreatorLearningProfile {
  version: 'creator-feedback-v1'
  suggestionStats: Record<EditSuggestionType, CreatorLearningStat>
  audienceRetention?: AudienceRetentionProfile
  semanticFeedback?: SemanticFeedbackProfile
  updatedAt?: string
}

export interface AdrTake {
  id: string
  assetId: string
  clipId: string
  trackId: string
  takeNumber: number
  duration: number
  createdAt: string
}

export interface AdrCue {
  id: string
  sequenceId: string
  start: number
  end: number
  text: string
  status: 'open' | 'recorded' | 'approved'
  selectedTakeId?: string
  takes: AdrTake[]
  compSegments?: AdrCompSegment[]
  createdAt: string
  updatedAt: string
}

export interface AdrCompSegment {
  id: string
  start: number
  end: number
  takeId: string
}

export interface ProjectSequence {
  id: string
  name: string
  kind: 'main' | 'shorts' | 'nested' | 'multicam'
  sourceSequenceId?: string
  sourceRange?: { start: number; end: number }
  sourceFingerprint?: string
  sourceGraphSnapshot?: SourceGraphSnapshot
  playhead?: number
  workArea?: { start: number; end: number }
  loopPlayback?: boolean
  aspectRatio: AspectRatio
  width: number
  height: number
  fps: number
  timecodeStart?: number
  timecodeDropFrame?: boolean
  transitionDefaults?: SequenceTransitionDefaults
  tracks: TimelineTrack[]
  transcript: TranscriptSegment[]
  suggestions: EditSuggestion[]
  markers?: TimelineMarker[]
  audioBuses?: AudioBusMap
  createdAt: string
}

export type SourceGraphDomain = 'video' | 'audio' | 'transcript' | 'suggestions' | 'markers' | 'settings'

export interface SourceGraphSnapshot {
  version: 'editweave-source-graph-v1'
  fingerprints: Record<SourceGraphDomain, string>
}

export type ProjectMergeConflictKind = 'sequence' | 'track' | 'clip' | 'transcript' | 'suggestion' | 'marker' | 'audio-bus' | 'asset' | 'adr-cue' | 'dictionary'

export interface ProjectMergeConflictRecord {
  id: string
  kind: ProjectMergeConflictKind
  sequenceId?: string
  trackId?: string
  entityId: string
  label: string
  detail: string
  markerId?: string
  branchSequenceId?: string
  branchEntityId?: string
  incomingTrackId?: string
  incomingDeleted?: boolean
  currentTrackId?: string
  currentTrackSnapshot?: Omit<TimelineTrack, 'clips'>
  currentClipSnapshot?: TimelineClip
  currentDeleted?: boolean
  currentSnapshot?: unknown
  incomingSnapshot?: unknown
  canApplyIncoming?: boolean
  status: 'open' | 'resolved'
  resolution?: 'current' | 'incoming'
  createdAt: string
  resolvedAt?: string
}

export interface ProjectMergeSession {
  id: string
  baseUpdatedAt: string
  incomingUpdatedAt: string
  incomingProjectName: string
  createdAt: string
  status: 'open' | 'resolved'
  conflicts: ProjectMergeConflictRecord[]
}

export interface ShortsCandidate {
  id: string
  targetDuration: 15 | 30 | 60
  start: number
  end: number
  title: string
  hook: string
  score: number
  reason?: string
  signals?: { transcript: number; highlight: number; audio: number; face: number; scene: number; cleanupPenalty: number }
}

export interface PersistedMediaAsset extends Omit<MediaAsset, 'url' | 'sourceFile' | 'imageSequenceFiles' | 'imageSequenceUrls' | 'thumbnailUrl' | 'waveform' | 'status' | 'analysisStartedAt' | 'proxyFile' | 'proxyUrl' | 'proxyStatus' | 'proxyProgress' | 'proxyError' | 'useProxy'> {
  status: 'ready' | 'offline' | 'error'
}

export interface EditWeaveProjectDocument {
  schemaVersion: 1
  id: string
  name: string
  createdAt: string
  updatedAt: string
  sequence: SequenceSettings
  assets: PersistedMediaAsset[]
  mediaBins?: string[]
  tracks: TimelineTrack[]
  transcript?: TranscriptSegment[]
  suggestions?: EditSuggestion[]
  markers?: TimelineMarker[]
  audioBuses?: AudioBusMap
  activeSequenceId?: string
  sequences?: ProjectSequence[]
  correctionDictionary?: Record<string, string>
  speakerVoiceProfiles?: SpeakerVoiceProfile[]
  adrCues?: AdrCue[]
  creatorLearningProfile?: CreatorLearningProfile
  mergeSessions?: ProjectMergeSession[]
  aiActivityLog?: AiActivityRecord[]
}

export type AiActivityOperation = 'transcription' | 'rough-cut-analysis' | 'suggestion-apply' | 'suggestion-dismiss' | 'shorts-generation' | 'image-background-removal' | 'video-background-removal' | 'face-tracking' | 'object-tracking' | 'stabilization' | 'scene-detection' | 'scene-detection-apply' | 'external-comfy-workflow'
export type AiActivityStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface AiActivityRecord {
  version: 'editweave-ai-activity-v1'
  id: string
  operation: AiActivityOperation
  label: string
  status: AiActivityStatus
  processing: {
    location: 'local-device' | 'external-user-service'
    processor: string
  }
  input: {
    sequenceId?: string
    assetIds?: string[]
    clipIds?: string[]
    timeRange?: { start: number; end: number }
    dataCategories: string[]
    summary: string
  }
  reason: string
  approval: 'analysis-only' | 'user-confirmed-change' | 'user-confirmed-external-transfer'
  changes?: {
    summary: string
    transcriptSegments?: number
    suggestions?: number
    markers?: number
    sequences?: number
    assets?: number
    clips?: number
  }
  undo: {
    available: boolean
    method: 'editor-history' | 'delete-created-asset' | 'delete-created-sequence' | 'none'
    description: string
  }
  createdAt: string
  completedAt?: string
  error?: string
}
