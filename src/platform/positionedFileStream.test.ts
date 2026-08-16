import { describe, expect, it, vi } from 'vitest'
import type { StreamTargetChunk } from 'mediabunny'
import { createPositionedFileStream, DESKTOP_STREAM_CHUNK_BYTES, type PositionedFileHandle, withWritableCleanup } from './positionedFileStream'

function chunk(position: number, data: number[]): StreamTargetChunk {
  return { type: 'write', position, data: new Uint8Array(data) }
}

function fakeHandle(writeImpl?: (data: Uint8Array) => Promise<number>) {
  const bytes = new Uint8Array(16)
  let position = 0
  const handle: PositionedFileHandle = {
    seek: vi.fn(async (next: number) => { position = next }),
    write: vi.fn(async (data: Uint8Array) => {
      if (writeImpl) return writeImpl(data)
      bytes.set(data, position)
      position += data.byteLength
      return data.byteLength
    }),
    close: vi.fn(async () => undefined),
  }
  return { bytes, handle }
}

describe('positioned desktop file stream', () => {
  it('writes seekable chunks without accumulating the complete output', async () => {
    const { bytes, handle } = fakeHandle()
    const removeIncomplete = vi.fn(async () => undefined)
    const writer = createPositionedFileStream(handle, { removeIncomplete }).getWriter()

    await writer.write(chunk(8, [8, 9]))
    await writer.write(chunk(0, [1, 2, 3]))
    await writer.close()

    expect([...bytes.slice(0, 3)]).toEqual([1, 2, 3])
    expect([...bytes.slice(8, 10)]).toEqual([8, 9])
    expect(handle.seek).toHaveBeenCalledTimes(2)
    expect(handle.close).toHaveBeenCalledTimes(1)
    expect(removeIncomplete).not.toHaveBeenCalled()
  })

  it('removes an incomplete file when a write is short', async () => {
    const { handle } = fakeHandle(async (data) => data.byteLength - 1)
    const removeIncomplete = vi.fn(async () => undefined)
    const writer = createPositionedFileStream(handle, { removeIncomplete }).getWriter()

    await expect(writer.write(chunk(0, [1, 2, 3]))).rejects.toThrow('2/3 bytes')
    expect(handle.close).toHaveBeenCalledTimes(1)
    expect(removeIncomplete).toHaveBeenCalledTimes(1)
  })

  it('closes and removes the destination when rendering is aborted', async () => {
    const { handle } = fakeHandle()
    const removeIncomplete = vi.fn(async () => undefined)
    const writer = createPositionedFileStream(handle, { removeIncomplete }).getWriter()

    await writer.abort('cancelled')

    expect(handle.close).toHaveBeenCalledTimes(1)
    expect(removeIncomplete).toHaveBeenCalledTimes(1)
  })

  it('rejects unsafe positions and removes the partial file', async () => {
    const { handle } = fakeHandle()
    const removeIncomplete = vi.fn(async () => undefined)
    const writer = createPositionedFileStream(handle, { removeIncomplete }).getWriter()

    await expect(writer.write(chunk(-1, [1]))).rejects.toThrow('위치가 올바르지 않습니다')
    expect(handle.write).not.toHaveBeenCalled()
    expect(removeIncomplete).toHaveBeenCalledTimes(1)
  })

  it('bounds Mediabunny stream buffering to eight MiB', () => {
    expect(DESKTOP_STREAM_CHUNK_BYTES).toBe(8 * 1024 * 1024)
  })

  it('aborts a destination when export setup fails before the encoder owns it', async () => {
    const abort = vi.fn(async () => undefined)
    const writable = new WritableStream<StreamTargetChunk>({ abort })
    const failure = new Error('encoder setup failed')

    await expect(withWritableCleanup(writable, async () => { throw failure })).rejects.toBe(failure)
    expect(abort).toHaveBeenCalledWith(failure)
  })
})
