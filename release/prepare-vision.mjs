import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = join(root, 'node_modules', '@mediapipe', 'tasks-vision')
const outputRoot = join(root, 'public', 'vision')
const wasmOutput = join(outputRoot, 'wasm')
const modelOutput = join(outputRoot, 'models', 'blaze_face_short_range.tflite')
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'
const wasmFiles = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_module_internal.js',
  'vision_wasm_module_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
]

await mkdir(wasmOutput, { recursive: true })
await Promise.all(wasmFiles.map((name) => copyFile(join(packageRoot, 'wasm', name), join(wasmOutput, name))))

const modelReady = await stat(modelOutput).then((entry) => entry.isFile() && entry.size > 100_000).catch(() => false)
if (!modelReady) {
  const response = await fetch(modelUrl)
  if (!response.ok) throw new Error(`MediaPipe 얼굴 감지 모델을 준비하지 못했습니다: HTTP ${response.status}`)
  const model = new Uint8Array(await response.arrayBuffer())
  if (model.byteLength < 100_000) throw new Error('MediaPipe 얼굴 감지 모델 파일이 올바르지 않습니다.')
  await mkdir(dirname(modelOutput), { recursive: true })
  await writeFile(modelOutput, model)
}

console.log(`Prepared offline vision runtime in ${outputRoot}`)
