import type { SpeakerVoiceProfile, TranscriptSegment } from '../editor/types'
import { createMediaSource } from '../platform/mediaSource'

export interface TranscriptionProgress {
  progress: number
  stage: string
}

interface WhisperChunk {
  text: string
  timestamp: [number | null, number | null]
}

interface WhisperResult {
  text: string
  chunks?: WhisperChunk[]
}

interface SpeakerTensor {
  data?: ArrayLike<number>
  dims?: number[]
  tolist?: () => unknown
}

type SpeakerExtractor = (audio: Float32Array, options?: Record<string, unknown>) => Promise<SpeakerTensor>
let speakerExtractorPromise: Promise<SpeakerExtractor> | undefined

export type LocalTranscriptionQuality = 'fast' | 'balanced' | 'accurate'

export function transcriptionModelForQuality(quality: LocalTranscriptionQuality): string {
  if (quality === 'fast') return 'onnx-community/whisper-tiny'
  if (quality === 'accurate') return 'onnx-community/whisper-small'
  return 'onnx-community/whisper-base'
}

export async function transcribeLocally(
  file: File,
  onProgress: (progress: TranscriptionProgress) => void,
  signal?: AbortSignal,
  quality: LocalTranscriptionQuality = 'balanced',
): Promise<TranscriptSegment[]> {
  throwIfAborted(signal)
  onProgress({ progress: 0.02, stage: '오디오 디코딩' })
  const audio = await decodeToMono16Khz(file, signal)
  throwIfAborted(signal)
  onProgress({ progress: 0.08, stage: 'Whisper 모델 준비' })

  const { pipeline } = await import('@huggingface/transformers')
  const useWebGpu = 'gpu' in navigator
  const model = transcriptionModelForQuality(quality)
  const transcriber = await raceWithAbort(pipeline(
    'automatic-speech-recognition',
    model,
    {
      device: useWebGpu ? 'webgpu' : 'wasm',
      dtype: useWebGpu ? { encoder_model: 'fp16', decoder_model_merged: 'q4' } : 'q8',
      progress_callback: (event: { status?: string; progress?: number }) => {
        if (typeof event.progress === 'number') onProgress({ progress: 0.08 + event.progress / 100 * 0.46, stage: '모델 다운로드·캐시' })
      },
    },
  ), signal)

  onProgress({ progress: 0.56, stage: `한국어 음성 인식 · ${quality === 'fast' ? '빠른 초벌' : quality === 'accurate' ? '정확 우선' : '균형'}` })
  const result = await raceWithAbort(transcriber(audio, {
    language: 'korean',
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: 'word',
    callback_function: () => onProgress({ progress: 0.78, stage: '문장 타임코드 생성' }),
  }) as Promise<WhisperResult>, signal)
  throwIfAborted(signal)

  const chunks = result.chunks ?? []
  if (!chunks.length && result.text.trim()) {
    return assignSpeakerLabelsNeural(audio, [{ id: crypto.randomUUID(), start: 0, end: fileDurationFallback(audio.length), text: result.text.trim() }], onProgress, signal)
  }
  const words = chunks.map((chunk, index) => ({
    start: chunk.timestamp[0] ?? (index ? chunks[index - 1].timestamp[1] ?? 0 : 0),
    end: chunk.timestamp[1] ?? (chunk.timestamp[0] ?? 0) + 0.5,
    text: chunk.text.trim(),
  })).filter((word) => word.text && word.end > word.start)
  onProgress({ progress: 0.92, stage: '로컬 신경망 화자 재식별 준비' })
  const segments = await assignSpeakerLabelsNeural(audio, groupWords(words), onProgress, signal)
  onProgress({ progress: 1, stage: '완료' })
  return segments
}

function groupWords(words: Array<{ start: number; end: number; text: string }>): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []
  let current: typeof words = []
  const flush = () => {
    if (!current.length) return
    segments.push({ id: crypto.randomUUID(), start: current[0].start, end: current[current.length - 1].end, text: current.map((word) => word.text).join(' ').replace(/\s+([,.!?])/g, '$1').trim(), words: current.map((word) => ({ ...word })) })
    current = []
  }
  words.forEach((word, index) => {
    const previous = words[index - 1]
    if (current.length && (current.length >= 9 || (previous && word.start - previous.end > 0.7))) flush()
    current.push(word)
    if (/[.!?。！？]$/.test(word.text) || current[current.length - 1].end - current[0].start >= 5.5) flush()
  })
  flush()
  return segments
}

export function assignSpeakerLabels(audio: Float32Array, segments: TranscriptSegment[], maxSpeakers = 4): TranscriptSegment[] {
  if (!segments.length) return []
  const embeddings = segments.map((segment) => createSpeakerEmbedding(audio, segment.start, segment.end))
  return clusterSpeakerEmbeddings(segments, embeddings, maxSpeakers, 0.78, 'acoustic-v1')
}

async function assignSpeakerLabelsNeural(audio: Float32Array, segments: TranscriptSegment[], onProgress: (progress: TranscriptionProgress) => void, signal?: AbortSignal, maxSpeakers = 4): Promise<TranscriptSegment[]> {
  if (!segments.length) return []
  try {
    const extractor = await raceWithAbort(getSpeakerExtractor((progress) => onProgress({ progress: 0.92 + progress * 0.035, stage: '화자 재식별 모델 다운로드·캐시' })), signal)
    const embeddings: number[][] = []
    for (let index = 0; index < segments.length; index++) {
      throwIfAborted(signal)
      const segment = segments[index]
      const from = Math.max(0, Math.floor(segment.start * 16_000))
      const to = Math.min(audio.length, Math.ceil(Math.min(segment.end, segment.start + 12) * 16_000))
      const minimumSamples = 16_000
      const clip = new Float32Array(Math.max(minimumSamples, to - from))
      clip.set(audio.subarray(from, to))
      const tensor = await raceWithAbort(extractor(clip, { pooling: 'mean', normalize: true }), signal)
      embeddings.push(speakerTensorVector(tensor))
      onProgress({ progress: 0.955 + (index + 1) / segments.length * 0.035, stage: `신경망 화자 재식별 ${index + 1}/${segments.length}` })
    }
    return clusterSpeakerEmbeddings(segments, embeddings, maxSpeakers, 0.7, 'wavlm-base-plus-sv')
  } catch (error) {
    if (signal?.aborted || error instanceof DOMException && error.name === 'AbortError') throw error
    onProgress({ progress: 0.985, stage: '신경망 화자 모델 대체 분석' })
    return assignSpeakerLabels(audio, segments, maxSpeakers)
  }
}

async function getSpeakerExtractor(onDownload: (progress: number) => void): Promise<SpeakerExtractor> {
  if (!speakerExtractorPromise) {
    speakerExtractorPromise = import('@huggingface/transformers').then(async ({ pipeline }) => await pipeline('feature-extraction', 'Xenova/wavlm-base-plus-sv', {
      device: typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm',
      dtype: typeof navigator !== 'undefined' && 'gpu' in navigator ? 'fp16' : 'q8',
      progress_callback: (event) => {
        if ('progress' in event && typeof event.progress === 'number') onDownload(Math.max(0, Math.min(1, event.progress / 100)))
      },
    }) as unknown as SpeakerExtractor).catch((error) => {
      speakerExtractorPromise = undefined
      throw error
    })
  }
  return speakerExtractorPromise
}

function speakerTensorVector(tensor: SpeakerTensor): number[] {
  if (tensor.data?.length) {
    const values = Array.from(tensor.data)
    const width = Math.max(1, tensor.dims?.at(-1) ?? values.length)
    if (width === values.length) return normalizeVector(values)
    const rows = Math.max(1, Math.floor(values.length / width))
    const pooled = Array.from({ length: width }, (_, feature) => {
      let sum = 0
      for (let row = 0; row < rows; row++) sum += values[row * width + feature] ?? 0
      return sum / rows
    })
    return normalizeVector(pooled)
  }
  const flatten = (value: unknown): number[] => Array.isArray(value) ? value.flatMap(flatten) : typeof value === 'number' && Number.isFinite(value) ? [value] : []
  return normalizeVector(flatten(tensor.tolist?.()))
}

function clusterSpeakerEmbeddings(segments: TranscriptSegment[], embeddings: number[][], maxSpeakers: number, similarityThreshold: number, version: string): TranscriptSegment[] {
  const clusters: Array<{ centroid: number[]; count: number }> = []
  const clusterIdentityIds: string[] = []
  const assignments: Array<{ cluster: number; confidence: number }> = []
  embeddings.forEach((embedding, index) => {
    if (!embedding.length) {
      const fallback = assignments[index - 1]?.cluster ?? 0
      assignments.push({ cluster: fallback, confidence: 0 })
      return
    }
    const similarities = clusters.map((cluster) => cluster.centroid.length ? cosineSimilarity(embedding, cluster.centroid) : -1)
    const best = similarities.length ? similarities.reduce((winner, value, candidate) => value > similarities[winner] ? candidate : winner, 0) : -1
    const bestSimilarity = best >= 0 ? similarities[best] : -1
    const longEnoughForNewSpeaker = segments[index].end - segments[index].start >= 0.65
    if (best < 0 || (bestSimilarity < similarityThreshold && clusters.length < Math.max(1, maxSpeakers) && longEnoughForNewSpeaker)) {
      clusters.push({ centroid: embedding.slice(), count: 1 })
      clusterIdentityIds.push(crypto.randomUUID())
      assignments.push({ cluster: clusters.length - 1, confidence: 0.72 })
    } else {
      const cluster = clusters[Math.max(0, best)]
      const nextCount = cluster.count + 1
      cluster.centroid = normalizeVector(cluster.centroid.map((value, feature) => (value * cluster.count + embedding[feature]) / nextCount))
      cluster.count = nextCount
      assignments.push({ cluster: Math.max(0, best), confidence: Math.max(0, Math.min(1, (bestSimilarity + 1) / 2)) })
    }
  })
  for (let index = 1; index < assignments.length - 1; index++) {
    const previous = assignments[index - 1].cluster
    const next = assignments[index + 1].cluster
    if (clusters[previous]?.centroid.length && previous === next && assignments[index].cluster !== previous && segments[index].end - segments[index].start < 1.1) {
      assignments[index] = { cluster: previous, confidence: Math.max(0.5, cosineSimilarity(embeddings[index], clusters[previous].centroid)) }
    }
  }
  return segments.map((segment, index) => ({
    ...segment,
    speaker: `화자 ${assignments[index].cluster + 1}`,
    speakerConfidence: assignments[index].confidence,
    speakerEmbeddingVersion: version,
    speakerEmbedding: embeddings[index]?.length ? embeddings[index].map((value) => Math.round(value * 1_000_000) / 1_000_000) : undefined,
    speakerIdentityId: clusterIdentityIds[assignments[index].cluster],
  }))
}

export function createSpeakerVoiceProfiles(segments: TranscriptSegment[], existing: SpeakerVoiceProfile[] = []): SpeakerVoiceProfile[] {
  type Accumulator = { identityId: string; speaker: string; embeddingVersion: string; sum: number[]; weight: number; manualName: boolean; updatedAt: string }
  const profiles = new Map<string, Accumulator>()
  for (const profile of existing) {
    if (!profile.identityId || !profile.embeddingVersion || !profile.centroid.length || !Number.isFinite(profile.sampleWeight) || profile.sampleWeight <= 0) continue
    const key = `${profile.identityId}:${profile.embeddingVersion}:${profile.centroid.length}`
    profiles.set(key, { identityId: profile.identityId, speaker: profile.speaker || '화자 1', embeddingVersion: profile.embeddingVersion, sum: profile.centroid.map((value) => value * profile.sampleWeight), weight: profile.sampleWeight, manualName: true, updatedAt: profile.updatedAt })
  }
  const now = new Date().toISOString()
  for (const segment of segments) {
    if (!segment.speakerIdentityId || !segment.speakerEmbeddingVersion || !segment.speakerEmbedding?.length || segment.speakerEmbeddingVersion === 'manual') continue
    const key = `${segment.speakerIdentityId}:${segment.speakerEmbeddingVersion}:${segment.speakerEmbedding.length}`
    const weight = Math.max(.25, Math.min(12, segment.end - segment.start)) * Math.max(.25, segment.speakerConfidence ?? .75)
    const existingProfile = profiles.get(key)
    if (!existingProfile) {
      profiles.set(key, { identityId: segment.speakerIdentityId, speaker: segment.speaker ?? '화자 1', embeddingVersion: segment.speakerEmbeddingVersion, sum: segment.speakerEmbedding.map((value) => value * weight), weight, manualName: Boolean(segment.speakerAssignedManually), updatedAt: now })
      continue
    }
    existingProfile.sum = existingProfile.sum.map((value, index) => value + (segment.speakerEmbedding?.[index] ?? 0) * weight)
    existingProfile.weight += weight
    if (segment.speakerAssignedManually || !existingProfile.manualName) existingProfile.speaker = segment.speaker ?? existingProfile.speaker
    existingProfile.manualName ||= Boolean(segment.speakerAssignedManually)
    existingProfile.updatedAt = now
  }
  return [...profiles.values()].map((profile) => ({
    identityId: profile.identityId,
    speaker: profile.speaker,
    embeddingVersion: profile.embeddingVersion,
    centroid: normalizeVector(profile.sum.map((value) => value / Math.max(.0001, profile.weight))).map((value) => Math.round(value * 1_000_000) / 1_000_000),
    sampleWeight: Math.round(profile.weight * 1_000) / 1_000,
    updatedAt: profile.updatedAt || now,
  }))
}

export function reidentifyTranscriptSpeakers(segments: TranscriptSegment[], knownSegments: TranscriptSegment[], storedProfiles: SpeakerVoiceProfile[] = []): TranscriptSegment[] {
  type Profile = { identityId: string; speaker: string; version: string; centroid: number[]; weight: number }
  const profiles = new Map<string, Profile>()
  for (const profile of storedProfiles) {
    if (!profile.identityId || !profile.embeddingVersion || !profile.centroid.length) continue
    const weight = Math.max(.25, profile.sampleWeight)
    profiles.set(`${profile.identityId}:${profile.embeddingVersion}:${profile.centroid.length}`, { identityId: profile.identityId, speaker: profile.speaker || '화자 1', version: profile.embeddingVersion, centroid: profile.centroid.map((value) => value * weight), weight })
  }
  for (const segment of knownSegments) {
    const embedding = segment.speakerEmbedding
    const version = segment.speakerEmbeddingVersion
    if (!embedding?.length || !version || version === 'manual') continue
    const identityId = segment.speakerIdentityId ?? `legacy:${version}:${segment.speaker ?? '화자 1'}`
    const key = `${identityId}:${version}:${embedding.length}`
    const weight = Math.max(.25, Math.min(12, segment.end - segment.start)) * Math.max(.25, segment.speakerConfidence ?? .75)
    const existing = profiles.get(key)
    if (!existing) profiles.set(key, { identityId, speaker: segment.speaker ?? '화자 1', version, centroid: embedding.map((value) => value * weight), weight })
    else {
      existing.centroid = existing.centroid.map((value, index) => value + (embedding[index] ?? 0) * weight)
      existing.weight += weight
      if (segment.speakerAssignedManually) existing.speaker = segment.speaker ?? existing.speaker
    }
  }
  const normalizedProfiles = [...profiles.values()].map((profile) => ({ ...profile, centroid: normalizeVector(profile.centroid.map((value) => value / Math.max(.0001, profile.weight))) }))
  if (!normalizedProfiles.length) return segments

  const incoming = new Map<string, Profile>()
  for (const segment of segments) {
    const embedding = segment.speakerEmbedding
    const version = segment.speakerEmbeddingVersion
    if (!embedding?.length || !version || !segment.speakerIdentityId) continue
    const key = `${segment.speakerIdentityId}:${version}:${embedding.length}`
    const weight = Math.max(.25, Math.min(12, segment.end - segment.start)) * Math.max(.25, segment.speakerConfidence ?? .75)
    const existing = incoming.get(key)
    if (!existing) incoming.set(key, { identityId: segment.speakerIdentityId, speaker: segment.speaker ?? '화자 1', version, centroid: embedding.map((value) => value * weight), weight })
    else {
      existing.centroid = existing.centroid.map((value, index) => value + (embedding[index] ?? 0) * weight)
      existing.weight += weight
    }
  }
  const incomingProfiles = [...incoming.values()].map((profile) => ({ ...profile, centroid: normalizeVector(profile.centroid.map((value) => value / Math.max(.0001, profile.weight))) }))
  const candidates = incomingProfiles.flatMap((source) => normalizedProfiles.flatMap((known) => {
    if (source.version !== known.version || source.centroid.length !== known.centroid.length) return []
    const similarity = cosineSimilarity(source.centroid, known.centroid)
    const threshold = source.version.startsWith('wavlm') ? .72 : .82
    return similarity >= threshold ? [{ source, known, similarity }] : []
  })).sort((left, right) => right.similarity - left.similarity)
  const matchedIncoming = new Set<string>()
  const matchedKnown = new Set<string>()
  const assignments = new Map<string, { identityId: string; speaker: string; similarity: number }>()
  for (const candidate of candidates) {
    if (matchedIncoming.has(candidate.source.identityId) || matchedKnown.has(candidate.known.identityId)) continue
    matchedIncoming.add(candidate.source.identityId)
    matchedKnown.add(candidate.known.identityId)
    assignments.set(candidate.source.identityId, { identityId: candidate.known.identityId, speaker: candidate.known.speaker, similarity: candidate.similarity })
  }
  const usedNames = new Set(normalizedProfiles.map((profile) => profile.speaker))
  let nextSpeaker = 1
  const freshNames = new Map<string, string>()
  const uniqueName = () => {
    while (usedNames.has(`화자 ${nextSpeaker}`)) nextSpeaker++
    const name = `화자 ${nextSpeaker++}`
    usedNames.add(name)
    return name
  }
  return segments.map((segment) => {
    const identityId = segment.speakerIdentityId
    if (!identityId) return segment
    const matched = assignments.get(identityId)
    if (matched) return { ...segment, speaker: matched.speaker, speakerIdentityId: matched.identityId, speakerConfidence: Math.max(segment.speakerConfidence ?? 0, Math.max(0, Math.min(1, (matched.similarity + 1) / 2))) }
    let speaker = freshNames.get(identityId)
    if (!speaker) { speaker = uniqueName(); freshNames.set(identityId, speaker) }
    return { ...segment, speaker }
  })
}

function createSpeakerEmbedding(audio: Float32Array, start: number, end: number): number[] {
  const sampleRate = 16_000
  const from = Math.max(0, Math.floor(start * sampleRate))
  const to = Math.min(audio.length, Math.ceil(end * sampleRate))
  const frameSize = 400
  if (to - from < frameSize) return []
  const frequencies = [120, 180, 260, 380, 550, 800, 1_150, 1_650, 2_350, 3_300, 4_600, 6_200]
  const means = new Float64Array(frequencies.length + 4)
  const squares = new Float64Array(means.length)
  const availableFrames = Math.max(1, Math.floor((to - from - frameSize) / 320) + 1)
  const stride = 320 * Math.max(1, Math.ceil(availableFrames / 96))
  let frames = 0
  for (let offset = from; offset + frameSize <= to; offset += stride) {
    let mean = 0
    for (let index = 0; index < frameSize; index++) mean += audio[offset + index]
    mean /= frameSize
    let energy = 0
    let crossings = 0
    const windowed = new Float32Array(frameSize)
    for (let index = 0; index < frameSize; index++) {
      const value = (audio[offset + index] - mean) * (0.5 - 0.5 * Math.cos(2 * Math.PI * index / (frameSize - 1)))
      windowed[index] = value
      energy += value * value
      if (index && (value >= 0) !== (windowed[index - 1] >= 0)) crossings++
    }
    const rms = Math.sqrt(energy / frameSize)
    if (rms < 0.004) continue
    const [pitch, periodicity] = estimatePitch(windowed, sampleRate)
    const bandLogs = frequencies.map((frequency) => Math.log(1e-8 + goertzelEnergy(windowed, frequency, sampleRate)))
    const bandMean = bandLogs.reduce((sum, value) => sum + value, 0) / bandLogs.length
    const features = [...bandLogs.map((value) => (value - bandMean) / 8), Math.log(rms + 1e-6) / 8, crossings / frameSize * 4, Math.log(Math.max(55, pitch)) / 6, periodicity]
    features.forEach((value, index) => {
      means[index] += value
      squares[index] += value * value
    })
    frames++
  }
  if (!frames) return []
  const embedding: number[] = []
  for (let index = 0; index < means.length; index++) {
    const average = means[index] / frames
    embedding.push(average, Math.sqrt(Math.max(0, squares[index] / frames - average * average)))
  }
  return normalizeVector(embedding)
}

function goertzelEnergy(samples: Float32Array, frequency: number, sampleRate: number): number {
  const coefficient = 2 * Math.cos(2 * Math.PI * frequency / sampleRate)
  let previous = 0
  let previousPrevious = 0
  for (const sample of samples) {
    const current = sample + coefficient * previous - previousPrevious
    previousPrevious = previous
    previous = current
  }
  return Math.max(0, previousPrevious * previousPrevious + previous * previous - coefficient * previous * previousPrevious)
}

function estimatePitch(samples: Float32Array, sampleRate: number): [number, number] {
  let energy = 0
  for (const sample of samples) energy += sample * sample
  if (energy <= 1e-8) return [120, 0]
  let bestLag = Math.floor(sampleRate / 120)
  let bestCorrelation = -1
  for (let lag = Math.floor(sampleRate / 320); lag <= Math.min(samples.length - 2, Math.ceil(sampleRate / 70)); lag += 2) {
    let correlation = 0
    let lagEnergy = 0
    for (let index = lag; index < samples.length; index++) {
      correlation += samples[index] * samples[index - lag]
      lagEnergy += samples[index - lag] * samples[index - lag]
    }
    const normalized = correlation / Math.sqrt(Math.max(1e-8, energy * lagEnergy))
    if (normalized > bestCorrelation) { bestCorrelation = normalized; bestLag = lag }
  }
  return [sampleRate / bestLag, Math.max(0, bestCorrelation)]
}

function normalizeVector(values: number[]): number[] {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0))
  return magnitude > 1e-8 ? values.map((value) => value / magnitude) : values.map(() => 0)
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return -1
  return left.reduce((sum, value, index) => sum + value * right[index], 0)
}

async function decodeToMono16Khz(file: File, signal?: AbortSignal): Promise<Float32Array> {
  throwIfAborted(signal)
  const { ALL_FORMATS, AudioSampleSink, Input } = await import('mediabunny')
  const sourcePath = (file as File & { __editweaveSourcePath?: string }).__editweaveSourcePath
  const input = new Input({ source: await createMediaSource(file, sourcePath), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) throw new Error('음성 인식에 사용할 오디오 트랙이 없습니다.')
    if (!await track.canDecode()) throw new Error('이 미디어의 오디오 코덱을 로컬에서 디코딩할 수 없습니다.')
    const metadataDuration = await track.getDurationFromMetadata().catch(() => null)
    let output = new Float32Array(Math.max(16_000, Math.ceil((metadataDuration ?? 60) * 16_000)))
    let written = 0
    const ensureCapacity = (required: number) => {
      if (required <= output.length) return
      const expanded = new Float32Array(Math.max(required, output.length * 2))
      expanded.set(output)
      output = expanded
    }
    const sink = new AudioSampleSink(track)
    for await (const sample of sink.samples()) {
      try {
        throwIfAborted(signal)
        const buffer = sample.toAudioBuffer()
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))
        const outputStart = Math.max(0, Math.round(sample.timestamp * 16_000))
        const outputFrames = Math.max(1, Math.round(sample.duration * 16_000))
        ensureCapacity(outputStart + outputFrames)
        for (let frame = 0; frame < outputFrames; frame++) {
          const sourcePosition = Math.min(buffer.length - 1, frame * buffer.sampleRate / 16_000)
          const left = Math.floor(sourcePosition)
          const right = Math.min(buffer.length - 1, left + 1)
          const blend = sourcePosition - left
          let mono = 0
          for (const channel of channels) mono += channel[left] + (channel[right] - channel[left]) * blend
          output[outputStart + frame] = mono / Math.max(1, channels.length)
        }
        written = Math.max(written, outputStart + outputFrames)
      } finally {
        sample.close()
      }
    }
    return output.slice(0, written)
  } finally {
    input.dispose()
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Transcription cancelled', 'AbortError')
}

function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  throwIfAborted(signal)
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Transcription cancelled', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    promise.then((value) => { signal.removeEventListener('abort', abort); resolve(value) }, (error) => { signal.removeEventListener('abort', abort); reject(error) })
  })
}

function fileDurationFallback(samples: number): number {
  return Math.max(0.1, samples / 16_000)
}
