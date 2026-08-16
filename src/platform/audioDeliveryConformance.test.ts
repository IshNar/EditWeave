import { describe, expect, it } from 'vitest'
import benchmark from '../../benchmarks/audio-delivery-conformance.synthetic.json'
import type { AdrCue, MediaAsset, ProjectSequence, TimelineTrack } from '../editor/types'
import { defaultAudioBuses } from '../editor/audioBuses'
import { extractSurroundAudioBuffer } from '../media/audioPcm'
import {
  audioChannelLabels,
  evaluateAudioDeliveryBenchmark,
  evaluateLoudnessConformance,
  inspectAdrApprovalCoverage,
  inspectAudioOutputSettings,
  inspectAudioProjectRouting,
} from './audioDeliveryConformance'
import { normalizeLoudnessMeasurement } from './loudness'

const sequence: ProjectSequence = {
  id: 'sequence', name: 'Main', kind: 'main', aspectRatio: '16:9', width: 1920, height: 1080, fps: 30,
  tracks: [], transcript: [], suggestions: [], createdAt: '2026-08-15T00:00:00.000Z',
}
const recording: MediaAsset = {
  id: 'recording', name: 'take.wav', kind: 'audio', url: 'blob:take', sourceFile: new File(['audio'], 'take.wav'),
  duration: 4, size: 5, extension: 'wav', status: 'ready', sampleRate: 48_000, channels: 1,
}

function cue(patch: Partial<AdrCue> = {}): AdrCue {
  return {
    id: 'cue', sequenceId: 'sequence', start: 10, end: 14, text: '대사', status: 'approved', selectedTakeId: 'take',
    takes: [{ id: 'take', assetId: 'recording', clipId: 'clip', trackId: 'adr', takeNumber: 1, duration: 4, createdAt: '2026-08-15T00:00:00.000Z' }],
    compSegments: [{ id: 'comp', start: 10, end: 14, takeId: 'take' }], createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z', ...patch,
  }
}

describe('audio delivery numerical conformance', () => {
  it('passes every expected result in the versioned delivery benchmark', () => {
    expect(evaluateAudioDeliveryBenchmark(benchmark)).toEqual({ cases: 5, passed: 5, mismatches: [] })
  })

  it('reports loudness and true-peak failures independently', () => {
    const result = evaluateLoudnessConformance({ integratedLufs: -10, truePeakDbtp: -0.2 }, 'web-video')
    expect(result.status).toBe('fail')
    expect(result.issues.map((issue) => issue.id)).toEqual(['loudness-out-of-range', 'true-peak-over'])
  })

  it('migrates legacy dBFS-named render measurements to measured dBTP', () => {
    expect(normalizeLoudnessMeasurement({ integratedLufs: -14, loudnessRangeLu: 3, truePeakDbfs: -1.2, measuredAt: '2026-01-01' }))
      .toMatchObject({ truePeakDbtp: -1.2, conformance: { status: 'pass', profileId: 'web-video' } })
  })
})

describe('audio delivery configuration and routing', () => {
  it('enforces EBU R128 sample rate, 24-bit mix, channels, and role stems', () => {
    const invalid = inspectAudioOutputSettings({ profileId: 'broadcast-ebu-r128', sampleRate: 44_100, channels: 1, bitDepth: 16, mixdownWav: false, stemRoles: ['dialogue'] })
    expect(invalid.map((issue) => issue.id)).toEqual(['audio-sample-rate', 'audio-channel-count', 'audio-master-wav', 'audio-required-stems'])
    expect(inspectAudioOutputSettings({ profileId: 'broadcast-ebu-r128', sampleRate: 48_000, channels: 6, bitDepth: 24, mixdownWav: true, stemRoles: ['dialogue', 'music', 'effects', 'ambient'] })).toEqual([])
  })

  it('blocks track or bus solos and warns when 5.1 direct routing is downmixed', () => {
    const track: TimelineTrack = { id: 'a1', name: 'ADR', kind: 'audio', muted: false, locked: false, solo: true, audioOutputChannel: 'center', clips: [] }
    const buses = defaultAudioBuses()
    buses.dialogue.solo = true
    expect(inspectAudioProjectRouting([track], buses, 2).map((issue) => issue.id)).toEqual(['audio-bus-solo', 'audio-track-solo', 'audio-surround-downmix'])
  })

  it('uses the canonical mono, stereo, and 5.1 channel order', () => {
    expect(audioChannelLabels(1)).toEqual(['M'])
    expect(audioChannelLabels(2)).toEqual(['L', 'R'])
    expect(audioChannelLabels(6)).toEqual(['L', 'R', 'C', 'LFE', 'Ls', 'Rs'])
  })

  it('preserves isolated 5.1 channel samples in canonical order', () => {
    const channels = Array.from({ length: 6 }, (_, channel) => new Float32Array([channel + 1]))
    const buffer = { numberOfChannels: 6, length: 1, getChannelData: (channel: number) => channels[channel] } as unknown as AudioBuffer
    expect(extractSurroundAudioBuffer(buffer, '5.1')?.map((channel) => channel[0])).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('ADR delivery conformance', () => {
  it('accepts an approved comp that covers the full cue exactly once', () => {
    expect(inspectAdrApprovalCoverage([cue()], [sequence], [recording])).toEqual([])
  })

  it('blocks approved comps with gaps, overlap, missing approval data, or short takes', () => {
    const broken = cue({
      compSegments: [
        { id: 'first', start: 10, end: 12, takeId: 'take' },
        { id: 'second', start: 11.5, end: 14, takeId: 'take' },
      ],
      takes: [{ ...cue().takes[0], duration: 1 }],
    })
    expect(inspectAdrApprovalCoverage([broken], [sequence], [recording]).map((issue) => issue.id))
      .toEqual(expect.arrayContaining(['adr-coverage-cue-second', 'adr-duration-cue-first', 'adr-duration-cue-second']))
    expect(inspectAdrApprovalCoverage([cue({ selectedTakeId: undefined, compSegments: [] })], [sequence], [recording])[0].id).toBe('adr-approval-cue')
  })
})
