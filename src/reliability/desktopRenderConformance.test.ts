// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { classifyDesktopRenderCases, desktopRenderCapabilityBlockers, desktopRenderConformanceCases, desktopRenderThresholds, detectDesktopRenderCapabilities, isDesktopRenderCapabilityBlock } from './desktopRenderConformance'

describe('desktop render conformance capability gate', () => {
  it('requires the complete WebCodecs and Canvas contract', () => {
    const capabilities = { videoEncoder: true, videoDecoder: true, audioEncoder: true, audioDecoder: true, videoFrame: true, audioData: true, canvas2d: true }
    expect(desktopRenderCapabilityBlockers(capabilities)).toEqual([])
  })

  it('reports every missing primitive instead of attempting a partial render', () => {
    expect(desktopRenderCapabilityBlockers({ videoEncoder: false, videoDecoder: true, audioEncoder: false, audioDecoder: true, videoFrame: false, audioData: false, canvas2d: true })).toEqual(['videoEncoder', 'audioEncoder', 'videoFrame', 'audioData'])
  })

  it('detects the current DOM runtime without throwing', () => {
    const capabilities = detectDesktopRenderCapabilities()
    expect(typeof capabilities.canvas2d).toBe('boolean')
    expect(Object.keys(capabilities)).toEqual(['videoEncoder', 'videoDecoder', 'audioEncoder', 'audioDecoder', 'videoFrame', 'audioData', 'canvas2d'])
  })

  it('covers landscape, portrait, fractional, standard, and high frame-rate profiles', () => {
    expect(desktopRenderConformanceCases.map((item) => item.id)).toEqual(['baseline-30-landscape', 'creator-29.97-landscape', 'shorts-23.976-portrait', 'high-rate-59.94-landscape', 'speed-cut-30-landscape', 'full-hd-30-landscape', 'uhd-4k-30-landscape', 'hevc-sdr-30-landscape', 'hdr10-pq-main10', 'hdr-hlg-main10', 'aac-5.1-dialogue-center', 'wav-5.1-dialogue-center', 'long-30s-30-landscape', 'long-10m-30-landscape'])
    expect(new Set(desktopRenderConformanceCases.map((item) => item.fps))).toEqual(new Set([23.976, 29.97, 30, 59.94]))
    expect(desktopRenderConformanceCases.some((item) => item.width < item.height)).toBe(true)
    expect(desktopRenderConformanceCases.filter((item) => item.decorated)).toHaveLength(1)
    expect(desktopRenderConformanceCases.find((item) => item.scenario === 'speed-cut')).toMatchObject({ fps: 30, duration: 2 })
    expect(desktopRenderConformanceCases.find((item) => item.scenario === 'high-resolution')).toMatchObject({ width: 1920, height: 1080, comparisonFrames: 6 })
    expect(desktopRenderConformanceCases.find((item) => item.scenario === 'ultra-high-resolution')).toMatchObject({ width: 3840, height: 2160, comparisonFrames: 3, bitrateMbps: 20 })
    expect(desktopRenderConformanceCases.find((item) => item.scenario === 'hevc-sdr')).toMatchObject({ codec: 'hevc', comparisonFrames: 15 })
    expect(desktopRenderConformanceCases.find((item) => item.scenario === 'hdr10-pq')).toMatchObject({ codec: 'hevc', colorMode: 'hdr10-pq', comparisonFrames: 3 })
    expect(desktopRenderConformanceCases.find((item) => item.scenario === 'hdr-hlg')).toMatchObject({ codec: 'hevc', colorMode: 'hdr-hlg', comparisonFrames: 3 })
    expect(desktopRenderConformanceCases.find((item) => item.scenario === 'surround-5.1')).toMatchObject({ audioChannels: 6, audioBitrateKbps: 320, comparisonFrames: 15 })
    expect(desktopRenderConformanceCases.find((item) => item.scenario === 'surround-5.1-wav')).toMatchObject({ audioChannels: 6, comparisonFrames: 0 })
    expect(desktopRenderConformanceCases.find((item) => item.scenario === 'long-duration')).toMatchObject({ duration: 30, fps: 30, comparisonFrames: 12, referenceUrl: '/e2e/render-conformance-long.mp4', maximumRenderMilliseconds: 120_000 })
    expect(desktopRenderConformanceCases.find((item) => item.id === 'long-10m-30-landscape')).toMatchObject({ duration: 600, fps: 30, comparisonFrames: 16, referenceUrl: '/e2e/render-conformance-10m.mp4', maximumRenderMilliseconds: 600_000, audioEdgeSeconds: 2 })
  })

  it('keeps distinct RGB24 quality floors while sharing one strict audio contract', () => {
    const byId = Object.fromEntries(desktopRenderConformanceCases.map((item) => [item.id, desktopRenderThresholds(item)]))
    expect(byId['creator-29.97-landscape']).toMatchObject({ minimumStructuralSimilarity: 0.96, minimumPsnrDb: 22.8, maximumMeanAbsoluteError: 6.5 })
    expect(byId['shorts-23.976-portrait']).toMatchObject({ minimumStructuralSimilarity: 0.969, minimumPsnrDb: 21.8, maximumMeanAbsoluteError: 6.1 })
    expect(byId['high-rate-59.94-landscape']).toMatchObject({ minimumStructuralSimilarity: 0.99, minimumPsnrDb: 27.8, maximumMeanAbsoluteError: 3 })
    expect(byId['full-hd-30-landscape']).toMatchObject({ minimumStructuralSimilarity: 0.99, minimumPsnrDb: 35, maximumMeanAbsoluteError: 3 })
    expect(byId['uhd-4k-30-landscape']).toMatchObject({ minimumStructuralSimilarity: 0.99, minimumPsnrDb: 35, maximumMeanAbsoluteError: 3 })
    expect(new Set(Object.values(byId).map((threshold) => threshold.minimumPcmCorrelation))).toEqual(new Set([0.96]))
    expect(new Set(Object.values(byId).map((threshold) => threshold.maximumAudioLagSamples))).toEqual(new Set([48]))
  })

  it('reports unsupported Main10 as blocked without hiding ordinary render failures', () => {
    expect(isDesktopRenderCapabilityBlock('이 환경의 영상 인코더가 HEVC Main10 10-bit 출력을 지원하지 않습니다.')).toBe(true)
    expect(classifyDesktopRenderCases([{ id: 'avc', label: 'AVC', width: 1, height: 1, fps: 30, duration: 1, passed: true }, { id: 'pq', label: 'PQ', width: 1, height: 1, fps: 30, duration: 1, passed: false, blocked: true }])).toBe('blocked')
    expect(classifyDesktopRenderCases([{ id: 'avc', label: 'AVC', width: 1, height: 1, fps: 30, duration: 1, passed: false, error: '픽셀 오류' }, { id: 'pq', label: 'PQ', width: 1, height: 1, fps: 30, duration: 1, passed: false, blocked: true }])).toBe('failed')
  })
})
