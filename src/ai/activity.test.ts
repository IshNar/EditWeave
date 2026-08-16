import { describe, expect, it } from 'vitest'
import { appendAiActivity, finishAiActivity, normalizeAiActivityLog, startAiActivity, updateAiActivity } from './activity'

const base = {
  operation: 'transcription' as const,
  label: '로컬 전사',
  processing: { location: 'local-device' as const, processor: 'Whisper Base' },
  input: { dataCategories: ['audio'], summary: '선택 미디어 음성' },
  reason: '편집 가능한 대본 생성',
  approval: 'user-confirmed-change' as const,
  undo: { available: true, method: 'editor-history' as const, description: '한 번의 실행 취소' },
}

describe('explainable AI activity contract', () => {
  it('records processing, input, reason, changes and undo in one immutable lifecycle', () => {
    const running = startAiActivity(base, '2026-08-15T00:00:00.000Z', 'activity-1')
    const completed = finishAiActivity(running, { status: 'completed', changes: { summary: '대본 12개 생성', transcriptSegments: 12 } }, '2026-08-15T00:00:02.000Z')
    expect(completed).toMatchObject({ id: 'activity-1', status: 'completed', processing: { location: 'local-device' }, changes: { transcriptSegments: 12 }, undo: { available: true } })
    expect(running.status).toBe('running')
  })

  it('rejects an external processor without explicit transfer approval', () => {
    expect(() => startAiActivity({ ...base, processing: { location: 'external-user-service', processor: 'ComfyUI' } })).toThrow(/외부 전송 승인/)
  })

  it('updates by id and keeps only the latest 250 valid records', () => {
    const records = Array.from({ length: 260 }, (_, index) => startAiActivity(base, `2026-08-15T00:${String(index).padStart(3, '0')}:00.000Z`, `activity-${index}`))
    const bounded = records.reduce((log, record) => appendAiActivity(log, record), [] as typeof records)
    const completed = updateAiActivity(bounded, 'activity-259', (record) => finishAiActivity(record, { status: 'cancelled' }))
    expect(bounded).toHaveLength(250)
    expect(completed.find((record) => record.id === 'activity-259')?.status).toBe('cancelled')
    expect(normalizeAiActivityLog([...completed, { broken: true } as never])).toHaveLength(250)
    expect(normalizeAiActivityLog([startAiActivity(base, '2026-08-15T01:00:00.000Z', 'interrupted')])[0]).toMatchObject({ status: 'cancelled', error: expect.stringMatching(/프로젝트가 닫혀/) })
  })
})
