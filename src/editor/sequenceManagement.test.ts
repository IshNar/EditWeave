import { describe, expect, it } from 'vitest'
import { duplicateProjectSequence, inspectSequenceDeletion, removeAssetClipsFromSequences, renameProjectSequence } from './sequenceManagement'
import type { ProjectSequence, TimelineClip, TimelineTrack } from './types'

const transform = { positionX: 0, positionY: 0, scale: 100, rotation: 0, opacity: 100 }

function clip(id: string, trackId = 'v1', overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id, trackId, assetId: 'asset-1', name: id, start: 0, duration: 2, sourceOffset: 0,
    kind: 'video', color: '#000', transform, ...overrides,
  }
}

function track(id = 'v1', clips: TimelineClip[] = []): TimelineTrack {
  return { id, name: id, kind: 'video', sourceTarget: true, muted: false, locked: false, clips }
}

function sequence(id: string, name: string, overrides: Partial<ProjectSequence> = {}): ProjectSequence {
  return {
    id, name, kind: 'main', aspectRatio: '16:9', width: 1920, height: 1080, fps: 30,
    tracks: [track()], transcript: [], suggestions: [], markers: [], createdAt: '2026-08-09T00:00:00.000Z',
    ...overrides,
  }
}

describe('sequence lifecycle integrity', () => {
  it('removes every clip that references an asset across all sequences', () => {
    const first = sequence('main', '메인', { tracks: [track('v1', [
      clip('remove-a'),
      clip('keep-a', 'v1', { assetId: 'asset-2', start: 2 }),
    ])] })
    const second = sequence('cut', '편집본', { tracks: [track('v2', [
      clip('remove-b', 'v2'),
    ])] })

    const result = removeAssetClipsFromSequences([first, second], 'asset-1')

    expect(result[0].tracks[0].clips.map((item) => item.id)).toEqual(['keep-a'])
    expect(result[1].tracks[0].clips).toEqual([])
    expect(first.tracks[0].clips).toHaveLength(2)
  })

  it('duplicates internal IDs while preserving shared media and clip relationships', () => {
    const clips = [
      clip('clip-a', 'v1', { groupId: 'group-1', linkGroupId: 'link-1' }),
      clip('clip-b', 'v1', { start: 2, groupId: 'group-1', linkGroupId: 'link-1' }),
    ]
    const source = sequence('main', '메인', { tracks: [track('v1', clips)] })
    const result = duplicateProjectSequence({
      sourceSequenceId: 'main', sequences: [source], adrCues: [], availableAssetIds: new Set(['asset-1']),
    })
    const copied = result.sequence.tracks[0].clips

    expect(result.sequence.id).not.toBe(source.id)
    expect(result.sequence.tracks[0].id).not.toBe('v1')
    expect(copied.map((item) => item.id)).not.toEqual(['clip-a', 'clip-b'])
    expect(copied.every((item) => item.assetId === 'asset-1')).toBe(true)
    expect(copied[0].groupId).toBe(copied[1].groupId)
    expect(copied[0].groupId).not.toBe('group-1')
    expect(copied[0].linkGroupId).toBe(copied[1].linkGroupId)
  })

  it('refuses duplication when a clip points to missing project media', () => {
    const source = sequence('main', '메인', { tracks: [track('v1', [clip('orphan')])] })
    expect(() => duplicateProjectSequence({
      sourceSequenceId: 'main', sequences: [source], adrCues: [], availableAssetIds: new Set(),
    })).toThrow(/프로젝트에 없는 미디어/)
  })

  it('blocks deletion while nested and derived sequences reference the target', () => {
    const target = sequence('main', '메인')
    const nestedUser = sequence('edit', '편집본', {
      tracks: [track('v1', [clip('nested', 'v1', { assetId: undefined, nestedSequenceId: 'main', name: '메인' })])],
    })
    const derived = sequence('shorts', '쇼츠', { kind: 'shorts', sourceSequenceId: 'main' })
    const assessment = inspectSequenceDeletion({
      sequences: [target, nestedUser, derived], adrCues: [], mergeSessions: [], targetSequenceId: 'main',
    })

    expect(assessment.canDelete).toBe(false)
    expect(assessment.nestedReferences).toMatchObject([{ sequenceId: 'edit', count: 1 }])
    expect(assessment.derivedReferences).toMatchObject([{ sequenceId: 'shorts', count: 1 }])
  })

  it('renames matching nested clip labels without altering unrelated labels', () => {
    const target = sequence('main', '메인')
    const user = sequence('edit', '편집본', { tracks: [track('v1', [
      clip('match', 'v1', { assetId: undefined, nestedSequenceId: 'main', name: '메인' }),
      clip('custom', 'v1', { start: 2, assetId: undefined, nestedSequenceId: 'main', name: '사용자 라벨' }),
    ])] })

    const renamed = renameProjectSequence([target, user], 'main', '  최종   마스터  ')
    expect(renamed[0].name).toBe('최종 마스터')
    expect(renamed[1].tracks[0].clips.map((item) => item.name)).toEqual(['최종 마스터', '사용자 라벨'])
  })
})
