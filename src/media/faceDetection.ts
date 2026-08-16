export interface DetectedFace {
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

interface BrowserFaceDetector {
  detect(source: CanvasImageSource): Promise<Array<{ boundingBox: DOMRectReadOnly }>>
}

let browserDetector: BrowserFaceDetector | undefined
let mediaPipeDetector: Promise<import('@mediapipe/tasks-vision').FaceDetector> | undefined

async function loadMediaPipeDetector(): Promise<import('@mediapipe/tasks-vision').FaceDetector> {
  mediaPipeDetector ??= (async () => {
    const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision')
    const wasmPath = new URL('vision/wasm', document.baseURI).href.replace(/\/$/, '')
    const modelPath = new URL('vision/models/blaze_face_short_range.tflite', document.baseURI).href
    const fileset = await FilesetResolver.forVisionTasks(wasmPath)
    return FaceDetector.createFromModelPath(fileset, modelPath)
  })()
  return mediaPipeDetector
}

export async function detectFaces(source: HTMLCanvasElement): Promise<DetectedFace[]> {
  const NativeDetector = (globalThis as typeof globalThis & {
    FaceDetector?: new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => BrowserFaceDetector
  }).FaceDetector
  if (NativeDetector) {
    browserDetector ??= new NativeDetector({ fastMode: true, maxDetectedFaces: 8 })
    const faces = await browserDetector.detect(source)
    return faces.map(({ boundingBox }) => ({
      x: boundingBox.x,
      y: boundingBox.y,
      width: boundingBox.width,
      height: boundingBox.height,
      confidence: Math.max(0.1, Math.min(1, boundingBox.width * boundingBox.height / (source.width * source.height) * 8)),
    }))
  }
  const detector = await loadMediaPipeDetector()
  return detector.detect(source).detections.flatMap((detection) => {
    const box = detection.boundingBox
    if (!box) return []
    return [{
      x: box.originX,
      y: box.originY,
      width: box.width,
      height: box.height,
      confidence: detection.categories[0]?.score ?? Math.max(0.1, Math.min(1, box.width * box.height / (source.width * source.height) * 8)),
    }]
  })
}
