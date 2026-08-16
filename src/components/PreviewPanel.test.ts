import { describe, expect, it, vi } from 'vitest'
import { getOrCreateMediaElementAudioSource } from './PreviewPanel'

describe('preview media element audio source lifecycle', () => {
  it('reuses the source node when React effects restart for the same element and context', () => {
    const source = {}
    const createMediaElementSource = vi.fn(() => source)
    const context = { createMediaElementSource } as unknown as AudioContext
    const element = {} as HTMLMediaElement

    expect(getOrCreateMediaElementAudioSource(context, element)).toBe(source)
    expect(getOrCreateMediaElementAudioSource(context, element)).toBe(source)
    expect(createMediaElementSource).toHaveBeenCalledTimes(1)
  })

  it('rejects reconnecting the same element to another audio context', () => {
    const element = {} as HTMLMediaElement
    const first = { createMediaElementSource: vi.fn(() => ({})) } as unknown as AudioContext
    const second = { createMediaElementSource: vi.fn(() => ({})) } as unknown as AudioContext

    getOrCreateMediaElementAudioSource(first, element)
    expect(() => getOrCreateMediaElementAudioSource(second, element)).toThrow(/이전 오디오 엔진/)
  })
})
