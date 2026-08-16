import { open, SeekMode } from '@tauri-apps/plugin-fs'
import type { HdrRawInputFrame } from '../media/export'

export interface HdrRawSourceReader {
  frameAt(sourceTime: number): Promise<HdrRawInputFrame>
  close(): Promise<void>
}

export async function openHdrRawSource(path: string, options: { width: number; height: number; fps: number; rangeStart: number; frames: number }): Promise<HdrRawSourceReader> {
  const handle = await open(path, { read: true })
  const frameBytes = options.width * options.height * 3
  const lumaBytes = options.width * options.height * 2
  const chromaBytes = options.width * options.height / 2
  let closed = false
  return {
    async frameAt(sourceTime) {
      if (closed) throw new Error('닫힌 HDR raw 원본에서는 프레임을 읽을 수 없습니다.')
      const index = Math.max(0, Math.min(options.frames - 1, Math.floor((sourceTime - options.rangeStart) * options.fps + 0.000001)))
      await handle.seek(index * frameBytes, SeekMode.Start)
      const data = new Uint8Array(frameBytes)
      let offset = 0
      while (offset < data.byteLength) {
        const read = await handle.read(data.subarray(offset))
        if (!read) throw new Error(`HDR raw 프레임 읽기가 중단되었습니다 (${offset}/${data.byteLength} bytes).`)
        offset += read
      }
      return { data, layout: [{ offset: 0, stride: options.width * 2 }, { offset: lumaBytes, stride: options.width }, { offset: lumaBytes + chromaBytes, stride: options.width }], codedWidth: options.width, codedHeight: options.height, displayWidth: options.width, displayHeight: options.height }
    },
    async close() { if (!closed) { closed = true; await handle.close() } },
  }
}
