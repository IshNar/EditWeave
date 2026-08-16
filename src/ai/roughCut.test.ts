import { describe, expect, it } from 'vitest'
import type { EditSuggestion } from '../editor/types'
import { createRoughCutSuggestions, defaultCreatorLearningProfile, recordSuggestionFeedback, resetCreatorFeedback } from './roughCut'

describe('rough cut assistant', () => {
  it('finds filler, highlight, and adjacent repetition candidates', () => {
    const suggestions = createRoughCutSuggestions([
      { id: 'a', start: 0, end: 1, text: '음 이게 정말 중요한 첫 번째 방법입니다!' },
      { id: 'b', start: 1, end: 2, text: '이게 정말 중요한 첫 번째 방법입니다!' },
    ], [], [])

    expect(suggestions.some((item) => item.type === 'filler')).toBe(true)
    expect(suggestions.some((item) => item.type === 'highlight')).toBe(true)
    expect(suggestions.some((item) => item.type === 'repetition')).toBe(true)
  })

  it('resets suggestion feedback without deleting imported retention data', () => {
    const suggestion: EditSuggestion = {
      id: 'candidate',
      type: 'silence',
      start: 1,
      end: 3,
      label: '2초 무음',
      reason: '테스트',
      score: 0.9,
      status: 'pending',
    }
    const retention = {
      sourceName: 'retention.csv',
      importedAt: '2026-08-10T00:00:00.000Z',
      duration: 10,
      samples: [{ time: 0, retention: 1 }, { time: 5, retention: 0.8 }, { time: 10, retention: 0.6 }],
    }
    const learned = recordSuggestionFeedback({ ...defaultCreatorLearningProfile(), audienceRetention: retention }, suggestion, 'applied')
    const reset = resetCreatorFeedback(learned)

    expect(reset.suggestionStats.silence.applied).toBe(0)
    expect(reset.audienceRetention).toEqual(retention)
  })
})
