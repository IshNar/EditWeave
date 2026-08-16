import type { Source } from 'mediabunny'
import { runningInDesktop } from './projectFiles'

export async function createMediaSource(file: File, sourcePath?: string): Promise<Source> {
  const { BlobSource, CustomSource } = await import('mediabunny')
  if (!sourcePath || !runningInDesktop()) return new BlobSource(file)
  const { open, stat, SeekMode } = await import('@tauri-apps/plugin-fs')
  type NativeFileHandle = Awaited<ReturnType<typeof open>>
  let handlePromise: Promise<NativeFileHandle> | undefined
  let readQueue: Promise<void> = Promise.resolve()
  let disposed = false
  const sizePromise = stat(sourcePath).then((metadata) => metadata.size)
  const getHandle = () => {
    if (disposed) throw new Error('이미 닫힌 미디어 원본입니다.')
    handlePromise ??= open(sourcePath, { read: true })
    return handlePromise
  }
  const resetHandle = async () => {
    const current = handlePromise
    handlePromise = undefined
    if (current) await current.then((handle) => handle.close()).catch(() => undefined)
  }
  return new CustomSource({
    maxCacheSize: 64 * 1024 * 1024,
    prefetchProfile: 'fileSystem',
    getSize: () => sizePromise,
    read: (start, end) => {
      const readOperation = readQueue.then(async () => {
        const handle = await getHandle()
        await handle.seek(start, SeekMode.Start)
        const output = new Uint8Array(Math.max(0, end - start))
        let offset = 0
        while (offset < output.length) {
          const count = await handle.read(output.subarray(offset))
          if (count === null || count === 0) break
          offset += count
        }
        return offset === output.length ? output : output.slice(0, offset)
      })
      readQueue = readOperation.then(() => undefined, async () => { await resetHandle() })
      return readOperation
    },
    dispose: () => {
      disposed = true
      readQueue = readQueue.finally(() => resetHandle())
    },
  })
}
