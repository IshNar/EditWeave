import type { Input as MediaInput, StreamTargetChunk } from 'mediabunny'
import { createMediaSource } from '../platform/mediaSource'
import { DESKTOP_STREAM_CHUNK_BYTES, withWritableCleanup } from '../platform/positionedFileStream'

export interface RenderSegmentSource {
  path: string
  duration: number
}

export async function validateRenderedVideoSegment(segment: RenderSegmentSource, fps: number): Promise<boolean> {
  if (!Number.isFinite(segment.duration) || segment.duration <= 0 || !Number.isFinite(fps) || fps <= 0) return false
  const { ALL_FORMATS, EncodedPacketSink, Input } = await import('mediabunny')
  let input: MediaInput | undefined
  try {
    input = new Input({ source: await createMediaSource(new File([], segment.path.split(/[\\/]/).pop() ?? 'segment.mp4', { type: 'video/mp4' }), segment.path), formats: ALL_FORMATS })
    const videoTrack = await input.getPrimaryVideoTrack()
    if (!videoTrack || !await videoTrack.getCodec() || !await videoTrack.getDecoderConfig()) return false
    const expectedFrames = Math.round(segment.duration * fps)
    let frames = 0
    let endTimestamp = 0
    for await (const packet of new EncodedPacketSink(videoTrack).packets()) {
      frames++
      endTimestamp = Math.max(endTimestamp, packet.timestamp + packet.duration)
      if (frames > expectedFrames) return false
    }
    const frameTolerance = 0.5 / fps
    return frames === expectedFrames && Math.abs(endTimestamp - segment.duration) <= frameTolerance
  } catch {
    return false
  } finally {
    input?.dispose()
  }
}

export async function mergeRenderedSegments(segments: RenderSegmentSource[], outputStream: WritableStream<StreamTargetChunk>, onProgress?: (progress: number) => void, continuousAudioPath?: string): Promise<void> {
  return withWritableCleanup(outputStream, () => mergeRenderedSegmentsInternal(segments, outputStream, onProgress, continuousAudioPath))
}

async function mergeRenderedSegmentsInternal(segments: RenderSegmentSource[], outputStream: WritableStream<StreamTargetChunk>, onProgress?: (progress: number) => void, continuousAudioPath?: string): Promise<void> {
  if (!segments.length) throw new Error('결합할 완료 렌더 구간이 없습니다.')
  const { ALL_FORMATS, EncodedAudioPacketSource, EncodedPacketSink, EncodedVideoPacketSource, Input, Mp4OutputFormat, Output, StreamTarget, WebMOutputFormat } = await import('mediabunny')
  const openSegment = async (path: string) => new Input({ source: await createMediaSource(new File([], path.split(/[\\/]/).pop() ?? 'segment.mp4', { type: 'video/mp4' }), path), formats: ALL_FORMATS })
  const firstInput = await openSegment(segments[0].path)
  const firstVideoTrack = await firstInput.getPrimaryVideoTrack()
  if (!firstVideoTrack) { firstInput.dispose(); throw new Error('완료 렌더 구간에 영상 트랙이 없습니다.') }
  const videoCodec = await firstVideoTrack.getCodec()
  if (!videoCodec) { firstInput.dispose(); throw new Error('완료 렌더 구간의 영상 코덱을 판독하지 못했습니다.') }
  const audioConfigInput = continuousAudioPath ? await openSegment(continuousAudioPath) : firstInput
  const firstAudioTrack = await audioConfigInput.getPrimaryAudioTrack()
  const audioCodec = await firstAudioTrack?.getCodec() ?? null
  const videoConfig = await firstVideoTrack.getDecoderConfig()
  const audioConfig = await firstAudioTrack?.getDecoderConfig() ?? null
  if (audioConfigInput !== firstInput) audioConfigInput.dispose()
  firstInput.dispose()
  if (!videoConfig) throw new Error('완료 렌더 구간의 영상 디코더 구성을 판독하지 못했습니다.')
  if (audioCodec && !audioConfig) throw new Error('완료 렌더 구간의 오디오 디코더 구성을 판독하지 못했습니다.')

  const target = new StreamTarget(outputStream, { chunked: true, chunkSize: DESKTOP_STREAM_CHUNK_BYTES })
  const output = new Output({ format: videoCodec === 'vp9' ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: false }), target })
  const videoSource = new EncodedVideoPacketSource(videoCodec)
  const audioSource = audioCodec ? new EncodedAudioPacketSource(audioCodec) : undefined
  output.addVideoTrack(videoSource, { name: 'Cutline Program' })
  if (audioSource) output.addAudioTrack(audioSource, { name: 'Cutline Mix' })
  output.setMetadataTags({ comment: 'Created with Cutline · checkpoint merge' })
  await output.start()
  let videoSequence = 0
  let audioSequence = 0
  let videoFirst = true
  let audioFirst = true
  let offset = 0
  try {
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index]
      const input = await openSegment(segment.path)
      try {
        const [videoTrack, audioTrack] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()])
        if (!videoTrack || await videoTrack.getCodec() !== videoCodec) throw new Error(`렌더 구간 ${index + 1}의 영상 코덱 구성이 다릅니다.`)
        if (!continuousAudioPath && (Boolean(audioTrack) !== Boolean(audioSource) || (audioTrack && await audioTrack.getCodec() !== audioCodec))) throw new Error(`렌더 구간 ${index + 1}의 오디오 코덱 구성이 다릅니다.`)
        const segmentVideoConfig = await videoTrack.getDecoderConfig()
        const segmentAudioConfig = continuousAudioPath ? null : await audioTrack?.getDecoderConfig() ?? null
        if (!sameDecoderConfig(videoConfig, segmentVideoConfig)) throw new Error(`렌더 구간 ${index + 1}의 영상 인코더 초기화 데이터가 달라 안전하게 결합할 수 없습니다.`)
        if (!continuousAudioPath && audioConfig && !sameDecoderConfig(audioConfig, segmentAudioConfig)) throw new Error(`렌더 구간 ${index + 1}의 오디오 인코더 초기화 데이터가 달라 안전하게 결합할 수 없습니다.`)
        const videoSink = new EncodedPacketSink(videoTrack)
        const audioSink = !continuousAudioPath && audioTrack && audioSource ? new EncodedPacketSink(audioTrack) : undefined
        await Promise.all([
          (async () => {
            for await (const packet of videoSink.packets()) {
              await videoSource.add(packet.clone({ timestamp: offset + packet.timestamp, sequenceNumber: videoSequence++ }), videoFirst && videoConfig ? { decoderConfig: videoConfig } : undefined)
              videoFirst = false
            }
          })(),
          (async () => {
            if (!audioSink || !audioSource) return
            for await (const packet of audioSink.packets()) {
              await audioSource.add(packet.clone({ timestamp: offset + packet.timestamp, sequenceNumber: audioSequence++ }), audioFirst && audioConfig ? { decoderConfig: audioConfig } : undefined)
              audioFirst = false
            }
          })(),
        ])
      } finally {
        input.dispose()
      }
      offset += segment.duration
      onProgress?.((index + 1) / segments.length * (continuousAudioPath ? 0.9 : 1))
    }
    if (continuousAudioPath && audioSource) {
      const audioInput = await openSegment(continuousAudioPath)
      try {
        const audioTrack = await audioInput.getPrimaryAudioTrack()
        if (!audioTrack || await audioTrack.getCodec() !== audioCodec) throw new Error('연속 오디오 마스터의 코덱 구성이 변경되었습니다.')
        const currentConfig = await audioTrack.getDecoderConfig()
        if (!audioConfig || !sameDecoderConfig(audioConfig, currentConfig)) throw new Error('연속 오디오 마스터의 인코더 초기화 데이터가 변경되었습니다.')
        const audioSink = new EncodedPacketSink(audioTrack)
        for await (const packet of audioSink.packets()) {
          await audioSource.add(packet.clone({ sequenceNumber: audioSequence++ }), audioFirst ? { decoderConfig: audioConfig } : undefined)
          audioFirst = false
        }
      } finally {
        audioInput.dispose()
      }
      onProgress?.(1)
    }
    await output.finalize()
  } catch (error) {
    if (output.state === 'started') await output.cancel().catch(() => undefined)
    throw error
  }
}

function sameDecoderConfig(first: VideoDecoderConfig | AudioDecoderConfig, second: VideoDecoderConfig | AudioDecoderConfig | null): boolean {
  if (!second || first.codec !== second.codec) return false
  if ('codedWidth' in first && ('codedWidth' in second ? first.codedWidth !== second.codedWidth || first.codedHeight !== second.codedHeight : true)) return false
  if ('sampleRate' in first && ('sampleRate' in second ? first.sampleRate !== second.sampleRate || first.numberOfChannels !== second.numberOfChannels : true)) return false
  const firstDescription = bytes(first.description)
  const secondDescription = bytes(second.description)
  return firstDescription.length === secondDescription.length && firstDescription.every((value, index) => value === secondDescription[index])
}

function bytes(value?: AllowSharedBufferSource): Uint8Array {
  if (!value) return new Uint8Array()
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return new Uint8Array(value)
}
