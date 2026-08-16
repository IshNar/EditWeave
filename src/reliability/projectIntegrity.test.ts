import { describe, expect, it } from 'vitest'
import { createProjectDocument, parseProjectDocument } from '../editor/project'
import { inspectProjectIntegrity } from '../editor/projectIntegrity'
import { sequenceFingerprint } from '../editor/sourceGraph'
import { finishAiActivity, startAiActivity } from '../ai/activity'
import type { MediaAsset, ProjectSequence, TimelineClip, TimelineTrack } from '../editor/types'

const transform = { positionX: 0, positionY: 0, scale: 100, rotation: 0, opacity: 100 }
const createdAt = '2026-08-14T00:00:00.000Z'
const asset: MediaAsset = { id: 'media-1', name: 'interview.mov', kind: 'video', url: 'blob:media', duration: 90, size: 1024, extension: 'mov', status: 'ready' }

function clip(id: string, trackId: string, overrides: Partial<TimelineClip> = {}): TimelineClip {
  return { id, trackId, assetId: 'media-1', name: id, start: 0, duration: 30, sourceOffset: 0, kind: 'video', color: '#345', transform, ...overrides }
}

function track(id: string, clips: TimelineClip[]): TimelineTrack {
  return { id, name: id, kind: 'video', sourceTarget: true, muted: false, locked: false, clips }
}

function sequence(id: string, name: string, overrides: Partial<ProjectSequence> = {}): ProjectSequence {
  return { id, name, kind: 'main', aspectRatio: '16:9', width: 1920, height: 1080, fps: 30, tracks: [], transcript: [], suggestions: [], markers: [], createdAt, ...overrides }
}

describe('release reliability project integrity', () => {
  it('round-trips a main and derived sequence without losing source graph references', () => {
    const mainTrack = track('main-v1', [clip('main-clip', 'main-v1')])
    const main = sequence('main', '메인', {
      tracks: [mainTrack],
      transcript: [{ id: 'line-1', start: 1, end: 4, text: '검증 가능한 프로젝트입니다.' }],
      suggestions: [{ id: 'highlight-1', type: 'highlight', start: 1, end: 4, label: '하이라이트', reason: '테스트', score: 0.8, status: 'pending' }],
      markers: [{ id: 'marker-1', time: 2, label: '검토', color: '#fff', kind: 'comment' }],
    })
    const range = { start: 0, end: 30 }
    const shorts = sequence('shorts', '쇼츠', {
      kind: 'shorts', sourceSequenceId: 'main', sourceRange: range, sourceFingerprint: sequenceFingerprint(main, range),
      aspectRatio: '9:16', width: 1080, height: 1920, tracks: [track('shorts-v1', [clip('shorts-clip', 'shorts-v1', { duration: 15 })])],
    })
    const document = createProjectDocument({
      id: 'reliability-project', createdAt, name: 'E1 왕복', aspectRatio: '16:9', assets: [asset],
      tracks: main.tracks, transcript: main.transcript, suggestions: main.suggestions, markers: main.markers,
      activeSequenceId: 'main', sequences: [main, shorts], mediaBins: ['인터뷰'],
      aiActivityLog: [finishAiActivity(startAiActivity({
        operation: 'rough-cut-analysis', label: '로컬 초벌 분석', processing: { location: 'local-device', processor: 'multilingual-e5-small' },
        input: { sequenceId: 'main', dataCategories: ['대본'], summary: '대본 1개' }, reason: '검토 후보 생성', approval: 'analysis-only',
        undo: { available: true, method: 'editor-history', description: '제안 목록 복원' },
      }, createdAt, 'ai-1'), { status: 'completed', changes: { summary: '제안 1개', suggestions: 1 } }, createdAt)],
    })

    const parsed = parseProjectDocument(JSON.stringify(document))
    expect(inspectProjectIntegrity(parsed).filter((issue) => issue.level === 'blocker')).toEqual([])
    expect(parsed.sequences?.find((item) => item.id === 'shorts')).toMatchObject({ sourceSequenceId: 'main', sourceRange: range, sourceFingerprint: shorts.sourceFingerprint })
    expect(JSON.parse(JSON.stringify(parsed))).toMatchObject({ id: 'reliability-project', activeSequenceId: 'main', mediaBins: ['인터뷰'] })
    expect(parsed.aiActivityLog?.[0]).toMatchObject({ id: 'ai-1', status: 'completed', processing: { location: 'local-device' }, changes: { suggestions: 1 } })
  })

  it('blocks orphan media, invalid clip time, and missing derived sources before the editor opens', () => {
    const broken = createProjectDocument({
      id: 'broken', createdAt, name: '손상', aspectRatio: '16:9', assets: [asset],
      tracks: [track('v1', [clip('bad', 'v1', { assetId: 'missing', duration: Number.NaN })])],
      activeSequenceId: 'main',
      sequences: [sequence('main', '메인'), sequence('shorts', '쇼츠', { kind: 'shorts', sourceSequenceId: 'missing-source', sourceRange: { start: 0, end: 10 } })],
    })
    const raw = JSON.stringify(broken, (_key, value) => typeof value === 'number' && Number.isNaN(value) ? 'NaN' : value)
    expect(() => parseProjectDocument(raw)).toThrow(/무결성 검사 실패/)
  })

  it('blocks nested sequence cycles', () => {
    const nestedA = sequence('a', 'A', { kind: 'nested', tracks: [track('a-v1', [clip('a-to-b', 'a-v1', { assetId: undefined, nestedSequenceId: 'b' })])] })
    const nestedB = sequence('b', 'B', { kind: 'nested', tracks: [track('b-v1', [clip('b-to-a', 'b-v1', { assetId: undefined, nestedSequenceId: 'a' })])] })
    const document = createProjectDocument({ id: 'cycle', createdAt, name: '순환', aspectRatio: '16:9', assets: [asset], tracks: nestedA.tracks, activeSequenceId: 'a', sequences: [nestedA, nestedB] })
    expect(() => parseProjectDocument(JSON.stringify(document))).toThrow(/순환 참조/)
  })

  it('blocks external AI activity without an explicit transfer approval record', () => {
    const unapproved = startAiActivity({ operation: 'rough-cut-analysis', label: '분석', processing: { location: 'local-device', processor: 'local' }, input: { dataCategories: ['대본'], summary: '대본' }, reason: '후보 생성', approval: 'analysis-only', undo: { available: false, method: 'none', description: '변경 없음' } }, createdAt, 'ai-unapproved')
    const document = createProjectDocument({ id: 'external', createdAt, name: '외부 승인', aspectRatio: '16:9', assets: [asset], tracks: [], aiActivityLog: [{ ...unapproved, processing: { location: 'external-user-service', processor: 'unknown' } }] })
    expect(inspectProjectIntegrity(document).some((issue) => issue.id === 'ai-external-approval-ai-unapproved' && issue.level === 'blocker')).toBe(true)
  })
})
