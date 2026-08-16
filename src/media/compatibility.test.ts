import { describe, expect, it } from 'vitest'
import type { MediaAsset } from '../editor/types'
import { assessMediaHealth } from './compatibility'

const base: MediaAsset = {
  id: 'asset', name: 'sample.mp4', kind: 'video', url: 'blob:test', duration: 10, size: 10,
  extension: 'mp4', width: 1920, height: 1080, videoCodec: 'avc', videoDecodable: true,
  audioCodec: 'aac', audioDecodable: true, status: 'ready',
}

describe('media health', () => {
  it('marks a decodable H.264/AAC asset ready', () => {
    expect(assessMediaHealth(base)).toMatchObject({ level: 'ready', label: '편집 준비' })
  })

  it('warns for long or ultra-high-resolution media', () => {
    expect(assessMediaHealth({ ...base, duration: 1800 }).level).toBe('warning')
    expect(assessMediaHealth({ ...base, width: 7680, height: 4320 }).label).toBe('고해상도')
  })

  it('blocks an unavailable video decoder', () => {
    expect(assessMediaHealth({ ...base, videoCodec: 'hevc', videoDecodable: false })).toMatchObject({ level: 'unsupported', label: '디코더 없음' })
  })

  it('allows cached proxy preview while keeping the original offline', () => {
    expect(assessMediaHealth({ ...base, status: 'offline', proxyStatus: 'ready', useProxy: true })).toMatchObject({ level: 'warning', label: '프록시만' })
  })
})
