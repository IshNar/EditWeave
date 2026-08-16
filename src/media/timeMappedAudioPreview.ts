import { clipNeedsPitchStretch, clipSourceTime, pitchPreservationSourcePadding } from '../editor/effects'
import type { MediaAsset, TimelineClip } from '../editor/types'
import { createMediaSource } from '../platform/mediaSource'
import { downmixAudioBuffer, findDecodedAudioSpan, renderPitchPreservedTimeMap, sampleDecodedAudio, type DecodedAudioSpan } from './audioPcm'

export interface TimeMappedAudioPreviewDecoder {
  renderChunk(clip: TimelineClip, timelineStart: number, timelineEnd: number, sampleRate: number, preservePitch: boolean): Promise<AudioBuffer>
  dispose(): void
}

export async function createTimeMappedAudioPreviewDecoder(asset: MediaAsset): Promise<TimeMappedAudioPreviewDecoder> {
  if (!asset.sourceFile) throw new Error('속도 매핑 오디오에 사용할 로컬 원본 또는 프록시가 없습니다.')
  const { ALL_FORMATS, AudioSampleSink, Input } = await import('mediabunny')
  const attachedPath = (asset.sourceFile as File & { __cutlineSourcePath?: string }).__cutlineSourcePath
  const decodePath = attachedPath ?? (asset.useProxy ? undefined : asset.sourcePath)
  const input = new Input({ source: await createMediaSource(asset.sourceFile, decodePath), formats: ALL_FORMATS })
  const audioTrack = await input.getPrimaryAudioTrack().catch((error) => {
    input.dispose()
    throw error
  })
  if (!audioTrack) {
    input.dispose()
    throw new Error('이 원본에 속도 매핑할 오디오 트랙이 없습니다.')
  }
  const decodable = await audioTrack.canDecode().catch((error) => {
    input.dispose()
    throw error
  })
  if (!decodable) {
    input.dispose()
    throw new Error('이 원본의 오디오를 속도 매핑용으로 부분 디코딩할 수 없습니다.')
  }
  const sink = (() => {
    try { return new AudioSampleSink(audioTrack) }
    catch (error) {
      input.dispose()
      throw error
    }
  })()
  let disposed = false

  return {
    async renderChunk(clip, timelineStart, timelineEnd, sampleRate, preservePitch) {
      if (disposed) throw disposedError()
      const safeStart = Math.max(clip.start, Math.min(clip.start + clip.duration, timelineStart))
      const safeEnd = Math.max(safeStart, Math.min(clip.start + clip.duration, timelineEnd))
      const frameCount = Math.max(1, Math.ceil((safeEnd - safeStart) * sampleRate))
      const sourceAtStart = clipSourceTime(clip, safeStart)
      const sourceAtEnd = clipSourceTime(clip, safeEnd)
      const mediaDuration = Number.isFinite(asset.duration) && asset.duration > 0 ? asset.duration : Math.max(sourceAtStart, sourceAtEnd) + 0.05
      const lastSourceTime = Math.max(0, mediaDuration - 1 / sampleRate)
      const sourcePadding = preservePitch && clipNeedsPitchStretch(clip) ? pitchPreservationSourcePadding(clip) : 0.05
      const sourceStart = Math.max(0, Math.min(lastSourceTime, Math.min(sourceAtStart, sourceAtEnd) - sourcePadding))
      const sourceEnd = Math.min(mediaDuration, Math.max(sourceStart + 1 / sampleRate, Math.max(sourceAtStart, sourceAtEnd) + sourcePadding))
      const decoded: DecodedAudioSpan[] = []
      for await (const sample of sink.samples(sourceStart, sourceEnd + 1 / sampleRate)) {
        try {
          if (disposed) throw disposedError()
          if (sample.timestamp >= sourceEnd || sample.timestamp + sample.duration <= sourceStart) continue
          const buffer = sample.toAudioBuffer()
          decoded.push({ start: sample.timestamp, sampleRate: buffer.sampleRate, ...downmixAudioBuffer(buffer, { centerDb: clip.audioAdjustment?.downmixCenterDb, surroundDb: clip.audioAdjustment?.downmixSurroundDb, lfeDb: clip.audioAdjustment?.downmixLfeDb, layout: asset.sourceAudioLayout }) })
        } finally {
          sample.close()
        }
      }
      if (disposed) throw disposedError()
      decoded.sort((left, right) => left.start - right.start)
      const mono = decoded.length ? decoded.every((span) => span.mono) : asset.channels === 1
      const usePitchStretch = preservePitch && clipNeedsPitchStretch(clip)
      const rendered = usePitchStretch ? renderPitchPreservedTimeMap({
        spans: decoded,
        timelineStart: safeStart,
        frameCount,
        sampleRate,
        clipStart: clip.start,
        clipEnd: clip.start + clip.duration,
        reverse: Boolean(clip.reverse),
        mono,
        sourceTimeAt: (timelineTime) => Math.max(0, Math.min(lastSourceTime, clipSourceTime(clip, timelineTime))),
      }) : (() => {
        const left = new Float32Array(frameCount)
        const right = mono ? left : new Float32Array(frameCount)
        for (let frame = 0; frame < frameCount; frame++) {
          const timelineTime = safeStart + frame / sampleRate
          const sourceTime = Math.max(0, Math.min(lastSourceTime, clipSourceTime(clip, timelineTime)))
          const span = findDecodedAudioSpan(decoded, sourceTime)
          const values = span ? sampleDecodedAudio(span, sourceTime) : undefined
          if (!values) continue
          left[frame] = values.left
          if (!mono) right[frame] = values.right
        }
        return { left, right, mono }
      })()
      const output = new AudioBuffer({ length: frameCount, numberOfChannels: mono ? 1 : 2, sampleRate })
      output.copyToChannel(rendered.left, 0)
      if (!mono) output.copyToChannel(rendered.right, 1)
      return output
    },
    dispose() {
      if (disposed) return
      disposed = true
      input.dispose()
    },
  }
}

function disposedError(): Error {
  const error = new Error('속도 매핑 오디오 디코더가 종료되었습니다.')
  error.name = 'AbortError'
  return error
}
