import { describe, expect, it } from 'vitest'
import { parseAudienceRetentionCsv, retentionAt } from './retention'

describe('audience retention import', () => {
  it('accepts YouTube-style percentage positions and retention headers', () => {
    const profile = parseAudienceRetentionCsv([
      'Video position (%),Absolute audience retention (%)',
      '0%,100%',
      '50%,72%',
      '100%,45%',
    ].join('\n'), 'retention.csv', 120)

    expect(profile.samples).toEqual([
      { time: 0, retention: 1 },
      { time: 60, retention: 0.72 },
      { time: 120, retention: 0.45 },
    ])
    expect(retentionAt(profile.samples, 30)).toBeCloseTo(0.86)
  })

  it('rejects CSV files without enough valid samples', () => {
    expect(() => parseAudienceRetentionCsv('time,retention\n0,100%\n1,bad\n2,50%', 'broken.csv', 10)).toThrow(/3개/)
  })
})
