// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'
import { migrateLegacyBrandValue, migrateLegacyBrowserStorage } from './legacyBrandMigration'

describe('legacy Cutline brand migration', () => {
  beforeEach(() => localStorage.clear())

  it('copies legacy preferences without overwriting EditWeave values', () => {
    localStorage.setItem('cutline.shortcuts.v1', JSON.stringify({ version: 'cutline-shortcuts-v1', value: 1 }))
    localStorage.setItem('editweave.shortcuts.v1', JSON.stringify({ version: 'editweave-shortcuts-v1', value: 2 }))
    localStorage.setItem('cutline-recent-projects-v1', JSON.stringify([{ path: 'D:/project.cutline.json' }]))

    expect(migrateLegacyBrowserStorage()).toBe(1)
    expect(JSON.parse(localStorage.getItem('editweave.shortcuts.v1')!).value).toBe(2)
    expect(JSON.parse(localStorage.getItem('editweave-recent-projects-v1')!)[0].path).toBe('D:/project.cutline.json')
  })

  it('migrates only structural brand fields and preserves user text', () => {
    const value = migrateLegacyBrandValue({
      schema: 'cutline-review-v1',
      nested: { version: 'cutline-source-graph-v1', name: 'Cutline 시절 프로젝트' },
      path: 'D:/cutline-media/interview.mov',
    })
    expect(value).toEqual({
      schema: 'editweave-review-v1',
      nested: { version: 'editweave-source-graph-v1', name: 'Cutline 시절 프로젝트' },
      path: 'D:/cutline-media/interview.mov',
    })
  })
})
