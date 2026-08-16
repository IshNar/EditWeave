import { describe, expect, it } from 'vitest'
import {
  createSourceGraphSnapshot,
  inspectDerivedSequenceImpact,
  inspectSourceGraphBatch,
  sequenceFingerprint,
  staleDerivedSequenceIds,
  synchronizeDerivedSequenceDomains,
} from './sourceGraph'
import type { ProjectSequence, TimelineClip, TimelineTrack } from './types'

const transform = { positionX: 0, positionY: 0, scale: 100, rotation: 0, opacity: 100 }

function videoClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-1', trackId: 'video-1', assetId: 'asset-1', name: '인터뷰', start: 0, duration: 10,
    sourceOffset: 0, kind: 'video', color: '#555', transform, audioDisabled: false, ...overrides,
  }
}

function track(clips: TimelineClip[] = [videoClip()]): TimelineTrack {
  return { id: 'video-1', name: 'V1', kind: 'video', muted: false, locked: false, visible: true, clips }
}

function source(overrides: Partial<ProjectSequence> = {}): ProjectSequence {
  return {
    id: 'main', name: '본편', kind: 'main', aspectRatio: '16:9', width: 1920, height: 1080, fps: 30,
    tracks: [track()], transcript: [{ id: 'text-1', start: 0, end: 3, text: '원본 대본' }],
    suggestions: [{ id: 'suggestion-1', type: 'highlight', start: 1, end: 2, label: '핵심', reason: '핵심 발화', score: 0.9, status: 'pending' }],
    markers: [{ id: 'marker-1', time: 2, label: '도입', color: '#fff', kind: 'chapter' }],
    createdAt: '2026-08-14T00:00:00.000Z', ...overrides,
  }
}

function derivedFrom(main: ProjectSequence): ProjectSequence {
  const range = { start: 0, end: 10 }
  return {
    ...main,
    id: 'shorts', name: '쇼츠', kind: 'shorts', aspectRatio: '9:16', width: 1080, height: 1920,
    sourceSequenceId: main.id, sourceRange: range, sourceFingerprint: sequenceFingerprint(main, range),
    sourceGraphSnapshot: createSourceGraphSnapshot(main, range),
    tracks: [track([videoClip({ id: 'derived-clip', sourceClipId: 'clip-1', sourceTrackId: 'video-1', transform: { ...transform, positionX: 220, scale: 315 }, audioDisabled: true })])],
  }
}

describe('creator source graph', () => {
  it('classifies video, audio, transcript and marker changes independently', () => {
    const main = source()
    const derived = derivedFrom(main)

    expect(inspectDerivedSequenceImpact(derived, source({ tracks: [track([videoClip({ transform: { ...transform, scale: 105 } })])] })).changedDomains).toEqual(['video'])
    expect(inspectDerivedSequenceImpact(derived, source({ tracks: [track([videoClip({ audioDisabled: true })])] })).changedDomains).toEqual(['audio'])
    expect(inspectDerivedSequenceImpact(derived, source({ transcript: [{ id: 'text-1', start: 0, end: 3, text: '수정 대본' }] })).changedDomains).toEqual(['transcript'])
    expect(inspectDerivedSequenceImpact(derived, source({ markers: [{ id: 'marker-1', time: 2, label: '새 도입', color: '#fff', kind: 'chapter' }] })).changedDomains).toEqual(['markers'])
  })

  it('keeps unselected source changes stale after a selective transcript update', () => {
    const main = source()
    const derived = derivedFrom(main)
    const changed = source({
      tracks: [track([videoClip({ transform: { ...transform, scale: 110 } })])],
      transcript: [{ id: 'text-1', start: 0, end: 3, text: '최신 대본' }],
    })
    const regenerated: ProjectSequence = {
      ...derivedFrom(changed),
      tracks: [track([videoClip({ id: 'new-derived', sourceClipId: 'clip-1', transform: { ...transform, scale: 340 } })])],
      transcript: [{ id: 'derived-text', start: 0, end: 3, text: '최신 대본' }],
    }

    const result = synchronizeDerivedSequenceDomains({ derived, regenerated, source: changed, domains: ['transcript'] })

    expect(result.transcript[0].text).toBe('최신 대본')
    expect(result.tracks[0].clips[0].transform.positionX).toBe(220)
    expect(inspectDerivedSequenceImpact(result, changed).changedDomains).toEqual(['video'])
  })

  it('updates source timing while retaining local visual and mix adjustments by lineage', () => {
    const main = source()
    const derived = derivedFrom(main)
    const changed = source({ tracks: [track([videoClip({ sourceOffset: 2, duration: 8, audioDisabled: false })])] })
    const regenerated: ProjectSequence = {
      ...derivedFrom(changed),
      tracks: [track([videoClip({ id: 'regenerated', sourceClipId: 'clip-1', sourceOffset: 2, duration: 8, transform: { ...transform, scale: 350 }, audioDisabled: false })])],
    }

    const result = synchronizeDerivedSequenceDomains({ derived, regenerated, source: changed, domains: ['video', 'audio'], preserveLocalEdits: true })
    const clip = result.tracks[0].clips[0]

    expect(clip).toMatchObject({ sourceOffset: 2, duration: 8, audioDisabled: true })
    expect(clip.transform).toMatchObject({ positionX: 220, scale: 315 })
    expect(inspectDerivedSequenceImpact(result, changed).changedDomains).toEqual([])
  })

  it('can accept source audio values without replacing derived visual work', () => {
    const main = source()
    const derived = derivedFrom(main)
    const changed = source({ tracks: [track([videoClip({ audioDisabled: true })])] })
    const regenerated = derivedFrom(changed)
    regenerated.tracks = [track([videoClip({ id: 'regenerated', sourceClipId: 'clip-1', audioDisabled: true })])]

    const result = synchronizeDerivedSequenceDomains({ derived: { ...derived, tracks: [track([videoClip({ id: 'derived-clip', sourceClipId: 'clip-1', transform: { ...transform, positionX: 220 }, audioDisabled: false })])] }, regenerated, source: changed, domains: ['audio'], preserveLocalEdits: false })

    expect(result.tracks[0].clips[0].audioDisabled).toBe(true)
    expect(result.tracks[0].clips[0].transform.positionX).toBe(220)
  })

  it('supports legacy fingerprints and missing-source stale detection', () => {
    const main = source()
    const legacy = { ...derivedFrom(main), sourceGraphSnapshot: undefined }
    expect(inspectDerivedSequenceImpact(legacy, main).changedDomains).toEqual([])
    expect(staleDerivedSequenceIds([legacy])).toEqual(new Set(['shorts']))
  })

  it('reinspects 100 derived sequences and aggregates impacts in one batch', () => {
    const main = source()
    const derived = Array.from({ length: 100 }, (_, index) => ({
      ...derivedFrom(main),
      id: `shorts-${index}`,
      name: `쇼츠 ${index + 1}`,
    }))
    const changed = source({
      transcript: [{ id: 'text-1', start: 0, end: 3, text: '일괄 변경된 대본' }],
      markers: [{ id: 'marker-1', time: 2, label: '일괄 변경된 도입', color: '#fff', kind: 'chapter' }],
    })

    const startedAt = performance.now()
    const inspection = inspectSourceGraphBatch([changed, ...derived])
    const elapsed = performance.now() - startedAt

    expect(inspection.entries).toHaveLength(100)
    expect(inspection.domainCounts).toMatchObject({ transcript: 100, markers: 100, video: 0, audio: 0 })
    expect(inspection.missingSourceCount).toBe(0)
    expect(elapsed).toBeLessThan(500)
  })

  it('synchronizes 100 derived sequences and clears the batch impact set', () => {
    const main = source()
    const derived = Array.from({ length: 100 }, (_, index) => ({ ...derivedFrom(main), id: `shorts-${index}`, name: `쇼츠 ${index + 1}` }))
    const changed = source({ transcript: [{ id: 'text-1', start: 0, end: 3, text: '최신 대본' }] })
    const regenerated = { ...derivedFrom(changed), transcript: [{ id: 'derived-text', start: 0, end: 3, text: '최신 대본' }] }

    const synchronized = derived.map((item) => synchronizeDerivedSequenceDomains({
      derived: item,
      regenerated: { ...regenerated, id: item.id, name: item.name },
      source: changed,
      domains: ['transcript'],
    }))

    expect(inspectSourceGraphBatch([changed, ...synchronized]).entries).toHaveLength(0)
    expect(synchronized.every((item) => item.transcript[0].text === '최신 대본')).toBe(true)
  })
})
