import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { describeMediaReadFailure } from './projectFiles'

describe('desktop media file access', () => {
  it('permits every filesystem command used by native media import', async () => {
    const raw = await readFile(new URL('../../src-tauri/capabilities/default.json', import.meta.url), 'utf8')
    const capability = JSON.parse(raw) as { permissions: Array<string | { identifier: string }> }
    const identifiers = capability.permissions.map((permission) => typeof permission === 'string' ? permission : permission.identifier)

    expect(identifiers).toEqual(expect.arrayContaining([
      'dialog:allow-open',
      'fs:allow-stat',
      'fs:allow-open',
      'fs:allow-read-file',
    ]))
  })

  it('preserves Tauri string rejections instead of hiding the real cause', () => {
    expect(describeMediaReadFailure('path not allowed on the filesystem scope')).toBe('path not allowed on the filesystem scope')
    expect(describeMediaReadFailure({ message: 'access denied' })).toBe('access denied')
    expect(describeMediaReadFailure(undefined)).toBe('선택한 미디어 파일을 읽지 못했습니다.')
  })
})
