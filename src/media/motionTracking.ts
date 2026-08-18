import type { MediaAsset } from '../editor/types'
import { createMediaSource } from '../platform/mediaSource'
import { detectFaces, type DetectedFace } from './faceDetection'

export interface MotionTrackPoint {
  time: number
  x: number
  y: number
  confidence: number
}

export async function trackFacesInRange(asset: MediaAsset, start: number, end: number, options: { signal?: AbortSignal; onProgress?: (progress: number) => void } = {}): Promise<MotionTrackPoint[]> {
  if (asset.kind !== 'video' || !asset.sourceFile) throw new Error('모션 추적에 사용할 영상 원본이 없습니다.')
  const { ALL_FORMATS, Input, VideoSampleSink } = await import('mediabunny')
  const filePath = (asset.sourceFile as File & { __editweaveSourcePath?: string }).__editweaveSourcePath ?? asset.sourcePath
  const input = new Input({ source: await createMediaSource(asset.sourceFile, filePath), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !await track.canDecode()) throw new Error('이 원본의 영상 프레임을 디코딩할 수 없습니다.')
    const sink = new VideoSampleSink(track)
    const rangeStart = Math.max(0, Math.min(start, end))
    const rangeEnd = Math.max(rangeStart + 0.05, Math.min(asset.duration, Math.max(start, end)))
    const duration = rangeEnd - rangeStart
    const sampleCount = Math.min(120, Math.max(12, Math.ceil(duration / 0.75)))
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('모션 추적 프레임 캔버스를 만들지 못했습니다.')
    const points: MotionTrackPoint[] = []
    let previousCenter: { x: number; y: number } | undefined
    for (let index = 0; index < sampleCount; index++) {
      if (options.signal?.aborted) throw new DOMException('얼굴 모션 추적을 취소했습니다.', 'AbortError')
      const time = rangeStart + duration * (sampleCount === 1 ? 0 : index / (sampleCount - 1))
      const sample = await sink.getSample(time)
      if (sample) {
        try {
          const scale = Math.min(1, 360 / sample.displayWidth)
          canvas.width = Math.max(2, Math.round(sample.displayWidth * scale))
          canvas.height = Math.max(2, Math.round(sample.displayHeight * scale))
          sample.draw(context, 0, 0, canvas.width, canvas.height)
          const faces = await detectFaces(canvas)
          const primary = faces.sort((a, b) => {
            const center = (face: DetectedFace) => ({ x: (face.x + face.width / 2) / canvas.width, y: (face.y + face.height / 2) / canvas.height })
            if (!previousCenter) return b.width * b.height - a.width * a.height
            const aCenter = center(a)
            const bCenter = center(b)
            const aDistance = Math.hypot(aCenter.x - previousCenter.x, aCenter.y - previousCenter.y)
            const bDistance = Math.hypot(bCenter.x - previousCenter.x, bCenter.y - previousCenter.y)
            const aArea = a.width * a.height / (canvas.width * canvas.height)
            const bArea = b.width * b.height / (canvas.width * canvas.height)
            return (aDistance - aArea * 0.18) - (bDistance - bArea * 0.18)
          })[0]
          if (primary) {
            const area = primary.width * primary.height / (canvas.width * canvas.height)
            const x = (primary.x + primary.width / 2) / canvas.width
            const y = (primary.y + primary.height / 2) / canvas.height
            previousCenter = { x, y }
            points.push({
              time,
              x,
              y,
              confidence: Math.max(primary.confidence, Math.max(0.1, Math.min(1, area * 8))),
            })
          }
        } finally {
          sample.close()
        }
      }
      options.onProgress?.((index + 1) / sampleCount)
    }
    return points
  } finally {
    input.dispose()
  }
}
