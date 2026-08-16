// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  createEdl,
  createFcpxml,
  createOtio,
  createPremiereXml,
  materializeImportedTimeline,
  parseExchangeTimeline,
} from './exchange'
import type { MediaAsset, SequencePreset, TimelineClip, TimelineMarker, TimelineTrack } from './types'

const preset: SequencePreset = { ratio: '16:9', width: 1920, height: 1080, label: 'HD' }
const asset: MediaAsset = {
  id: 'asset-1', name: 'Interview A.mov', kind: 'video', url: 'blob:asset-1', sourcePath: 'C:\\Media\\Interview A.mov',
  duration: 20, size: 1_000, extension: 'mov', width: 1920, height: 1080, frameRate: 30, status: 'ready',
}
const clip: TimelineClip = {
  id: 'clip-1', trackId: 'track-1', assetId: asset.id, name: 'Interview A', kind: 'video', color: '#8169e8',
  start: 1, duration: 2, sourceOffset: 0.5, playbackRate: 1,
  transform: { positionX: 24, positionY: -12, scale: 105, scaleX: 100, scaleY: 98, rotation: 3, opacity: 92 },
  transitionIn: { type: 'crossfade', duration: 0.2, alignment: 'center-on-cut', easing: 'ease-in-out', audioCurve: 'equal-power' },
}
const track: TimelineTrack = {
  id: 'track-1', name: 'V1', kind: 'video', sourceTarget: true, editTarget: true, muted: false, locked: false, syncLock: true, clips: [clip],
}
const marker: TimelineMarker = { id: 'marker-1', time: 1.25, duration: 0.5, label: 'Review', description: 'Check cut', color: '#ff00aa', kind: 'comment', status: 'open' }

describe('timeline exchange conformance', () => {
  it.each([
    ['OTIO', 'project.otio', () => createOtio('Roundtrip', [track], [asset], [marker], 30, 0, preset)],
    ['Premiere Pro XML', 'project.xml', () => createPremiereXml('Roundtrip', preset, [track], [asset], [marker], 30)],
    ['FCPXML', 'project.fcpxml', () => createFcpxml('Roundtrip', preset, [track], [asset], 30)],
    ['CMX 3600 EDL', 'project.edl', () => createEdl('Roundtrip', [track], [asset], 30)],
  ])('%s export is accepted by the matching importer', (_format, filename, create) => {
    const imported = parseExchangeTimeline(create(), filename, 30)
    const importedClip = imported.clips.find((item) => item.kind === 'video')
    expect(imported.name).toBe('Roundtrip')
    expect(imported.fps).toBeCloseTo(30, 3)
    expect(importedClip).toBeDefined()
    expect(importedClip?.mediaName).toBe(asset.name)
    expect(importedClip?.duration).toBeCloseTo(2, 2)
    expect(importedClip?.sourceOffset).toBeCloseTo(0.5, 2)
  })

  it('preserves Cutline-rich metadata through OTIO', () => {
    const imported = parseExchangeTimeline(createOtio('Roundtrip', [track], [asset], [marker], 30, 0, preset), 'project.otio')
    expect(imported).toMatchObject({ width: 1920, height: 1080, markers: [{ label: 'Review', description: 'Check cut', kind: 'comment', status: 'open' }] })
    expect(imported.clips[0]).toMatchObject({ start: 1, transform: clip.transform, transitionIn: clip.transitionIn })
    expect(imported.trackSettings?.[0]).toMatchObject({ name: 'V1', sourceTarget: true, editTarget: true, syncLock: true })
  })

  it('materializes matched media and creates stable offline references for missing media', () => {
    const imported = parseExchangeTimeline(createOtio('Roundtrip', [track], [asset], [], 30, 0, preset), 'project.otio')
    const matched = materializeImportedTimeline(imported, [asset], preset)
    expect(matched).toMatchObject({ matchedMediaCount: 1, offlineMediaCount: 0, width: 1920, height: 1080 })
    expect(matched.tracks.find((item) => item.kind === 'video')?.clips[0].assetId).toBe(asset.id)

    const offline = materializeImportedTimeline({ ...imported, clips: imported.clips.map((item) => ({ ...item, id: crypto.randomUUID(), name: 'Missing', mediaName: 'Missing.mov' })) }, [], preset)
    expect(offline).toMatchObject({ matchedMediaCount: 0, offlineMediaCount: 1 })
    expect(offline.assets[0]).toMatchObject({ name: 'Missing.mov', status: 'offline' })
  })

  it('rejects unknown and malformed exchange documents', () => {
    expect(() => parseExchangeTimeline('not a timeline', 'project.txt')).toThrow(/아닙니다/)
    expect(() => parseExchangeTimeline('{broken', 'project.otio')).toThrow(/JSON/)
    expect(() => parseExchangeTimeline('<fcpxml>', 'project.fcpxml')).toThrow(/문법|시퀀스/)
  })
})
