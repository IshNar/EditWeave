import type { StreamTargetChunk } from 'mediabunny'

export const DESKTOP_STREAM_CHUNK_BYTES = 8 * 1024 * 1024

export interface PositionedFileHandle {
  seek(position: number): Promise<unknown>
  write(data: Uint8Array): Promise<number>
  close(): Promise<void>
}

export async function withWritableCleanup<T>(writable: WritableStream<StreamTargetChunk> | undefined, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    await writable?.abort(error).catch(() => undefined)
    throw error
  }
}

interface PositionedFileStreamOptions {
  removeIncomplete: () => Promise<void>
}

/**
 * Adapts Mediabunny's positioned chunks to a desktop file handle. The stream
 * owns the handle and removes the incomplete destination on abort or I/O error.
 */
export function createPositionedFileStream(handle: PositionedFileHandle, options: PositionedFileStreamOptions): WritableStream<StreamTargetChunk> {
  let closed = false
  let removed = false

  const closeHandle = async () => {
    if (closed) return
    closed = true
    await handle.close()
  }
  const removeIncomplete = async () => {
    if (removed) return
    removed = true
    await options.removeIncomplete()
  }
  const discard = async () => {
    await closeHandle().catch(() => undefined)
    await removeIncomplete().catch(() => undefined)
  }

  return new WritableStream<StreamTargetChunk>({
    async write(chunk) {
      try {
        if (closed) throw new Error('닫힌 출력 파일에는 쓸 수 없습니다.')
        if (!Number.isSafeInteger(chunk.position) || chunk.position < 0) throw new Error('출력 파일 위치가 올바르지 않습니다.')
        await handle.seek(chunk.position)
        const written = await handle.write(chunk.data)
        if (written !== chunk.data.byteLength) throw new Error(`출력 파일 쓰기가 중단되었습니다 (${written}/${chunk.data.byteLength} bytes).`)
      } catch (error) {
        await discard()
        throw error
      }
    },
    async close() {
      try {
        await closeHandle()
      } catch (error) {
        await removeIncomplete().catch(() => undefined)
        throw error
      }
    },
    async abort() {
      await discard()
    },
  })
}
