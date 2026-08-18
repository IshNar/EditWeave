import type { MediaAsset } from '../editor/types'
import { createMediaSource } from '../platform/mediaSource'

export interface ObjectTrackPoint {
  time: number
  offsetX: number
  offsetY: number
  confidence: number
  scale: number
  rotation: number
  cornerOffsets: Array<{ x: number; y: number }>
  reacquired: boolean
}

export async function trackObjectInRange(asset: MediaAsset, start: number, end: number, region: { x: number; y: number; width: number; height: number }, options: { signal?: AbortSignal; onProgress?: (progress: number) => void } = {}): Promise<ObjectTrackPoint[]> {
  if (asset.kind !== 'video' || !asset.sourceFile) throw new Error('물체 추적에 사용할 영상 원본이 없습니다.')
  if (region.width < 0.03 || region.height < 0.03) throw new Error('추적할 다각형 마스크 영역이 너무 작습니다.')
  const { ALL_FORMATS, Input, VideoSampleSink } = await import('mediabunny')
  const filePath = (asset.sourceFile as File & { __editweaveSourcePath?: string }).__editweaveSourcePath ?? asset.sourcePath
  const input = new Input({ source: await createMediaSource(asset.sourceFile, filePath), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !await track.canDecode()) throw new Error('이 원본의 영상 프레임을 디코딩할 수 없습니다.')
    const sink = new VideoSampleSink(track)
    const rangeStart = Math.max(0, Math.min(start, end))
    const rangeEnd = Math.max(rangeStart + 0.05, Math.min(asset.duration, Math.max(start, end)))
    const reverse = start > end
    const duration = rangeEnd - rangeStart
    const sampleCount = Math.min(180, Math.max(12, Math.ceil(duration / 0.35)))
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('물체 추적 프레임 캔버스를 만들지 못했습니다.')
    const width = 256
    let height = 144
    let anchors: TrackingAnchor[] | undefined
    let identityTemplate: TemplatePatch | undefined
    let identityScale = 1
    let lostFrames = 0
    const points: ObjectTrackPoint[] = []

    for (let index = 0; index < sampleCount; index++) {
      if (options.signal?.aborted) throw new DOMException('일반 물체 모션 추적을 취소했습니다.', 'AbortError')
      const progress = sampleCount === 1 ? 0 : index / (sampleCount - 1)
      const time = reverse ? rangeEnd - duration * progress : rangeStart + duration * progress
      const sample = await sink.getSample(time)
      if (sample) {
        try {
          height = Math.max(72, Math.round(width * sample.displayHeight / Math.max(1, sample.displayWidth)))
          canvas.width = width
          canvas.height = height
          sample.draw(context, 0, 0, width, height)
          const gray = grayscale(context.getImageData(0, 0, width, height).data)
          if (!anchors) {
            const patchWidth = Math.max(10, Math.min(46, Math.round(region.width * width * 0.36)))
            const patchHeight = Math.max(10, Math.min(46, Math.round(region.height * height * 0.36)))
            const positions = [[0.18, 0.18], [0.82, 0.18], [0.82, 0.82], [0.18, 0.82]].map(([u, v]) => ({ x: Math.round((region.x + region.width * u) * width), y: Math.round((region.y + region.height * v) * height) }))
            anchors = positions.map((position) => { const template = extractPatch(gray, width, height, position.x, position.y, patchWidth, patchHeight); return { ...position, initialX: position.x, initialY: position.y, template, identityTemplate: clonePatch(template) } })
            identityTemplate = extractPatch(gray, width, height, (region.x + region.width / 2) * width, (region.y + region.height / 2) * height, Math.max(18, Math.min(120, Math.round(region.width * width))), Math.max(18, Math.min(90, Math.round(region.height * height))))
            points.push({ time, offsetX: 0, offsetY: 0, confidence: 1, scale: 1, rotation: 0, cornerOffsets: positions.map(() => ({ x: 0, y: 0 })), reacquired: false })
          } else {
            let matches = anchors.map((anchor) => findBestMatch(gray, width, height, anchor.template, anchor.x, anchor.y))
            let reacquired = false
            const localError = matches.reduce((sum, match) => sum + match.error, 0) / matches.length
            if ((localError > 0.19 || lostFrames >= 2) && identityTemplate) {
              const previousCenter = averagePoint(anchors.map((anchor) => ({ x: anchor.x, y: anchor.y })))
              const candidate = findReidentificationMatch(gray, width, height, identityTemplate)
              if (candidate.error < 0.175) {
                const ratio = candidate.scale / Math.max(0.01, identityScale)
                anchors.forEach((anchor) => {
                  anchor.x = candidate.x + (anchor.x - previousCenter.x) * ratio
                  anchor.y = candidate.y + (anchor.y - previousCenter.y) * ratio
                })
                identityScale = candidate.scale
                matches = anchors.map((anchor) => findBestMatch(gray, width, height, anchor.identityTemplate, anchor.x, anchor.y, Math.max(16, Math.round(Math.max(anchor.template.width, anchor.template.height) * 0.7))))
                reacquired = true
                lostFrames = 0
              } else lostFrames += 1
            } else if (localError > 0.19) lostFrames += 1
            else lostFrames = 0
            anchors.forEach((anchor, anchorIndex) => {
              const match = matches[anchorIndex]
              if (match.error < 0.24) {
                anchor.x = match.x
                anchor.y = match.y
              }
              if (match.error < 0.14 && !reacquired) updateTemplate(anchor.template, extractPatch(gray, width, height, anchor.x, anchor.y, anchor.template.width, anchor.template.height), 0.04)
            })
            const initialCenter = averagePoint(anchors.map((anchor) => ({ x: anchor.initialX, y: anchor.initialY })))
            const currentCenter = averagePoint(anchors.map((anchor) => ({ x: anchor.x, y: anchor.y })))
            const initialTopAngle = Math.atan2(anchors[1].initialY - anchors[0].initialY, anchors[1].initialX - anchors[0].initialX)
            const currentTopAngle = Math.atan2(anchors[1].y - anchors[0].y, anchors[1].x - anchors[0].x)
            const initialDiagonal = Math.hypot(anchors[2].initialX - anchors[0].initialX, anchors[2].initialY - anchors[0].initialY)
            const currentDiagonal = Math.hypot(anchors[2].x - anchors[0].x, anchors[2].y - anchors[0].y)
            if (!reacquired && localError <= 0.19) identityScale = Math.max(0.7, Math.min(1.3, currentDiagonal / Math.max(1, initialDiagonal)))
            points.push({
              time,
              offsetX: (currentCenter.x - initialCenter.x) / width,
              offsetY: (currentCenter.y - initialCenter.y) / height,
              confidence: matches.reduce((sum, match) => sum + Math.max(0.05, Math.min(1, 1 - match.error * 2.2)), 0) / matches.length,
              scale: Math.max(0.25, Math.min(4, currentDiagonal / Math.max(1, initialDiagonal))),
              rotation: (currentTopAngle - initialTopAngle) * 180 / Math.PI,
              cornerOffsets: anchors.map((anchor) => ({ x: (anchor.x - anchor.initialX) / width, y: (anchor.y - anchor.initialY) / height })),
              reacquired,
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

interface TemplatePatch {
  width: number
  height: number
  values: Float32Array
}

interface TrackingAnchor {
  x: number
  y: number
  initialX: number
  initialY: number
  template: TemplatePatch
  identityTemplate: TemplatePatch
}

function averagePoint(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  return { x: points.reduce((sum, point) => sum + point.x, 0) / Math.max(1, points.length), y: points.reduce((sum, point) => sum + point.y, 0) / Math.max(1, points.length) }
}

function grayscale(data: Uint8ClampedArray): Float32Array {
  const output = new Float32Array(data.length / 4)
  for (let source = 0, destination = 0; source < data.length; source += 4, destination++) output[destination] = (data[source] * 0.2126 + data[source + 1] * 0.7152 + data[source + 2] * 0.0722) / 255
  return output
}

function extractPatch(gray: Float32Array, frameWidth: number, frameHeight: number, centerX: number, centerY: number, patchWidth: number, patchHeight: number): TemplatePatch {
  const width = Math.max(4, Math.min(frameWidth, patchWidth))
  const height = Math.max(4, Math.min(frameHeight, patchHeight))
  const startX = Math.max(0, Math.min(frameWidth - width, Math.round(centerX - width / 2)))
  const startY = Math.max(0, Math.min(frameHeight - height, Math.round(centerY - height / 2)))
  const values = new Float32Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) values[y * width + x] = gray[(startY + y) * frameWidth + startX + x]
  return { width, height, values }
}

function findBestMatch(gray: Float32Array, frameWidth: number, frameHeight: number, template: TemplatePatch, centerX: number, centerY: number, requestedRadius?: number): { x: number; y: number; error: number } {
  const radius = requestedRadius ?? Math.max(10, Math.min(28, Math.round(Math.max(template.width, template.height) * 0.45)))
  let best = { x: centerX, y: centerY, error: Number.POSITIVE_INFINITY }
  for (let y = centerY - radius; y <= centerY + radius; y += 2) {
    for (let x = centerX - radius; x <= centerX + radius; x += 2) {
      if (x - template.width / 2 < 0 || y - template.height / 2 < 0 || x + template.width / 2 >= frameWidth || y + template.height / 2 >= frameHeight) continue
      let error = 0
      let count = 0
      const startX = Math.round(x - template.width / 2)
      const startY = Math.round(y - template.height / 2)
      for (let patchY = 0; patchY < template.height; patchY += 2) {
        for (let patchX = 0; patchX < template.width; patchX += 2) {
          const templateIndex = patchY * template.width + patchX
          const frameIndex = (startY + patchY) * frameWidth + startX + patchX
          error += Math.abs(gray[frameIndex] - template.values[templateIndex])
          count++
        }
      }
      error /= Math.max(1, count)
      if (error < best.error) best = { x, y, error }
    }
  }
  return Number.isFinite(best.error) ? best : { x: centerX, y: centerY, error: 1 }
}

function findReidentificationMatch(gray: Float32Array, frameWidth: number, frameHeight: number, identity: TemplatePatch): { x: number; y: number; error: number; scale: number } {
  let best = { x: frameWidth / 2, y: frameHeight / 2, error: Number.POSITIVE_INFINITY, scale: 1 }
  for (const scale of [0.7, 0.85, 1, 1.15, 1.3]) {
    const template = resizePatch(identity, scale)
    const halfWidth = template.width / 2
    const halfHeight = template.height / 2
    for (let y = Math.ceil(halfHeight); y < frameHeight - halfHeight; y += 4) {
      for (let x = Math.ceil(halfWidth); x < frameWidth - halfWidth; x += 4) {
        const error = patchError(gray, frameWidth, template, x, y, 3)
        if (error < best.error) best = { x, y, error, scale }
      }
    }
  }
  if (!Number.isFinite(best.error)) return { ...best, error: 1 }
  const refined = findBestMatch(gray, frameWidth, frameHeight, resizePatch(identity, best.scale), best.x, best.y, 8)
  return { ...refined, scale: best.scale }
}

function patchError(gray: Float32Array, frameWidth: number, template: TemplatePatch, centerX: number, centerY: number, step: number): number {
  const startX = Math.round(centerX - template.width / 2)
  const startY = Math.round(centerY - template.height / 2)
  let error = 0
  let count = 0
  for (let patchY = 0; patchY < template.height; patchY += step) {
    for (let patchX = 0; patchX < template.width; patchX += step) {
      error += Math.abs(gray[(startY + patchY) * frameWidth + startX + patchX] - template.values[patchY * template.width + patchX])
      count++
    }
  }
  return error / Math.max(1, count)
}

function resizePatch(source: TemplatePatch, scale: number): TemplatePatch {
  const width = Math.max(4, Math.round(source.width * scale))
  const height = Math.max(4, Math.round(source.height * scale))
  const values = new Float32Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sourceX = Math.max(0, Math.min(source.width - 1, Math.round((x + 0.5) / scale - 0.5)))
    const sourceY = Math.max(0, Math.min(source.height - 1, Math.round((y + 0.5) / scale - 0.5)))
    values[y * width + x] = source.values[sourceY * source.width + sourceX]
  }
  return { width, height, values }
}

function clonePatch(source: TemplatePatch): TemplatePatch {
  return { width: source.width, height: source.height, values: new Float32Array(source.values) }
}

function updateTemplate(template: TemplatePatch, current: TemplatePatch, amount: number): void {
  if (template.values.length !== current.values.length) return
  for (let index = 0; index < template.values.length; index++) template.values[index] = template.values[index] * (1 - amount) + current.values[index] * amount
}
