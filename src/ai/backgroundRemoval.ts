type BackgroundRemovalProgress = (progress: number, stage: string) => void

export interface VideoForegroundMaskFrame {
  sourceTime: number
  points: Array<{ x: number; y: number }>
  confidence: number
}

let removerPromise: Promise<Awaited<ReturnType<typeof createRemover>>> | undefined

async function createRemover(onProgress?: BackgroundRemovalProgress) {
  const { pipeline } = await import('@huggingface/transformers')
  return pipeline('background-removal', 'Xenova/modnet', {
    device: 'gpu' in navigator ? 'webgpu' : 'wasm',
    progress_callback: (event) => {
      if ('progress' in event && typeof event.progress === 'number') onProgress?.(0.05 + event.progress / 100 * 0.55, '배경 제거 모델 다운로드·준비')
    },
  })
}

export async function removeImageBackground(file: File, onProgress?: BackgroundRemovalProgress): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error('배경 제거는 현재 이미지 미디어에서 사용할 수 있습니다.')
  onProgress?.(0.02, '배경 제거 준비')
  removerPromise ??= createRemover(onProgress)
  const remover = await removerPromise
  onProgress?.(0.64, '전경 마스크 추론')
  const output = await remover(file)
  onProgress?.(0.93, '투명 PNG 생성')
  const blob = await output.toBlob('image/png') as Blob
  const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*]+/g, '-') || 'cutout'
  onProgress?.(1, '완료')
  return new File([blob], `${baseName}-background-removed.png`, { type: 'image/png' })
}

export async function createVideoForegroundMasks(file: File, sourcePath: string | undefined, start: number, end: number, options: { signal?: AbortSignal; onProgress?: BackgroundRemovalProgress } = {}): Promise<VideoForegroundMaskFrame[]> {
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|mkv|webm|m4v|avi|mxf)$/i.test(file.name)) throw new Error('영상 배경 제거에 사용할 비디오 원본이 아닙니다.')
  options.onProgress?.(0.01, '영상 전경 모델 준비')
  removerPromise ??= createRemover(options.onProgress)
  const remover = await removerPromise
  const { ALL_FORMATS, Input, VideoSampleSink } = await import('mediabunny')
  const { createMediaSource } = await import('../platform/mediaSource')
  const input = new Input({ source: await createMediaSource(file, sourcePath), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !await track.canDecode()) throw new Error('이 영상의 프레임을 디코딩할 수 없습니다.')
    const sink = new VideoSampleSink(track)
    const rangeStart = Math.max(0, Math.min(start, end))
    const rangeEnd = Math.max(rangeStart + 0.05, Math.max(start, end))
    const reverse = start > end
    const count = Math.max(8, Math.min(60, Math.ceil((rangeEnd - rangeStart) / 0.5) + 1))
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const alphaCanvas = document.createElement('canvas')
    const alphaContext = alphaCanvas.getContext('2d', { willReadFrequently: true })
    if (!context || !alphaContext) throw new Error('영상 전경 마스크 캔버스를 만들지 못했습니다.')
    const frames: VideoForegroundMaskFrame[] = []
    let previous: Array<{ x: number; y: number }> | undefined
    for (let index = 0; index < count; index++) {
      if (options.signal?.aborted) throw new DOMException('영상 배경 제거를 취소했습니다.', 'AbortError')
      const progress = count === 1 ? 0 : index / (count - 1)
      const sourceTime = reverse ? rangeEnd - (rangeEnd - rangeStart) * progress : rangeStart + (rangeEnd - rangeStart) * progress
      const sample = await sink.getSample(sourceTime)
      if (!sample) continue
      try {
        const width = 256
        const height = Math.max(72, Math.round(width * sample.displayHeight / Math.max(1, sample.displayWidth)))
        canvas.width = width
        canvas.height = height
        sample.draw(context, 0, 0, width, height)
        const frameBlob = await canvasBlob(canvas, 'image/jpeg', 0.88)
        const frameFile = new File([frameBlob], `cutline-mask-${index}.jpg`, { type: 'image/jpeg' })
        const output = await remover(frameFile)
        const outputBlob = await output.toBlob('image/png') as Blob
        const bitmap = await createImageBitmap(outputBlob)
        alphaCanvas.width = width
        alphaCanvas.height = height
        alphaContext.clearRect(0, 0, width, height)
        alphaContext.drawImage(bitmap, 0, 0, width, height)
        bitmap.close()
        const alpha = alphaContext.getImageData(0, 0, width, height).data
        const silhouette = alphaSilhouette(alpha, width, height)
        if (silhouette) {
          const stabilized = previous?.length === silhouette.points.length
            ? silhouette.points.map((point, pointIndex) => ({ x: previous![pointIndex].x * 0.28 + point.x * 0.72, y: previous![pointIndex].y * 0.28 + point.y * 0.72 }))
            : silhouette.points
          previous = stabilized
          frames.push({ sourceTime, points: stabilized, confidence: silhouette.confidence })
        }
      } finally {
        sample.close()
      }
      options.onProgress?.(0.08 + (index + 1) / count * 0.9, `영상 전경 마스크 ${index + 1}/${count}`)
    }
    if (frames.length < 2) throw new Error('안정적인 전경 마스크를 두 프레임 이상 만들지 못했습니다.')
    options.onProgress?.(1, '영상 전경 마스크 완료')
    return frames.sort((left, right) => left.sourceTime - right.sourceTime)
  } finally {
    input.dispose()
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('분석 프레임 이미지를 만들지 못했습니다.')), type, quality))
}

function alphaSilhouette(data: Uint8ClampedArray, width: number, height: number): { points: Array<{ x: number; y: number }>; confidence: number } | undefined {
  const threshold = 72
  let minY = height
  let maxY = -1
  let foreground = 0
  let alphaSum = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = data[(y * width + x) * 4 + 3]
    if (alpha >= threshold) {
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      foreground++
      alphaSum += alpha / 255
    }
  }
  if (maxY <= minY || foreground < width * height * 0.01) return undefined
  const left: Array<{ x: number; y: number }> = []
  const right: Array<{ x: number; y: number }> = []
  const rows = 12
  const rowBounds = Array.from({ length: height }, (_, y) => {
    let rowLeft = width
    let rowRight = -1
    for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] >= threshold) {
      rowLeft = Math.min(rowLeft, x)
      rowRight = Math.max(rowRight, x)
    }
    return rowRight >= rowLeft ? { left: rowLeft, right: rowRight } : undefined
  })
  for (let index = 0; index < rows; index++) {
    const targetY = Math.round(minY + (maxY - minY) * index / (rows - 1))
    let bestY = targetY
    let bounds = rowBounds[targetY]
    for (let delta = 1; !bounds && (targetY - delta >= minY || targetY + delta <= maxY); delta++) {
      const above = targetY - delta
      const below = targetY + delta
      if (above >= minY && rowBounds[above]) { bestY = above; bounds = rowBounds[above]; break }
      if (below <= maxY && rowBounds[below]) { bestY = below; bounds = rowBounds[below]; break }
    }
    if (!bounds) return undefined
    left.push({ x: bounds.left / width * 100, y: bestY / height * 100 })
    right.push({ x: bounds.right / width * 100, y: bestY / height * 100 })
  }
  return { points: [...left, ...right.reverse()], confidence: Math.max(0, Math.min(1, alphaSum / foreground)) }
}
