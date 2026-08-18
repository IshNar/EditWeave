import { describe, expect, it } from 'vitest'
import type { MediaAsset } from './types'
import { createProjectDocument, parseProjectDocument, reconcileProjectAssets, restoreAssets } from './project'

const cachedAsset: MediaAsset = {
  id: 'asset-one',
  name: 'sample.mp4',
  kind: 'video',
  url: 'blob:original',
  sourceFile: new File(['original'], 'sample.mp4', { type: 'video/mp4' }),
  duration: 10,
  size: 8,
  extension: 'mp4',
  status: 'ready',
  proxyFile: new File(['proxy'], 'sample.editweave-proxy.mp4', { type: 'video/mp4' }),
  proxyUrl: 'blob:proxy',
  proxySize: 5,
  proxyWidth: 960,
  proxyHeight: 540,
  proxyCachePath: 'proxies/project-one/asset-one.mp4',
  proxyCachedAt: '2026-08-08T12:00:00.000Z',
  proxyStatus: 'ready',
  proxyProgress: 1,
  useProxy: true,
}

describe('project proxy persistence', () => {
  it('persists only reusable proxy cache metadata', () => {
    const document = createProjectDocument({
      id: 'project-one',
      createdAt: '2026-08-08T00:00:00.000Z',
      name: '캐시 테스트',
      aspectRatio: '16:9',
      assets: [cachedAsset],
      tracks: [],
    })

    expect(document.assets[0]).toMatchObject({
      proxyCachePath: 'proxies/project-one/asset-one.mp4',
      proxySize: 5,
      proxyWidth: 960,
      proxyHeight: 540,
    })
    expect(document.assets[0]).not.toHaveProperty('proxyUrl')
    expect(document.assets[0]).not.toHaveProperty('proxyFile')
    expect(document.assets[0]).not.toHaveProperty('useProxy')
    expect(restoreAssets(document)[0]).toMatchObject({ status: 'offline', proxyStatus: 'loading', useProxy: false })
  })

  it('does not persist session-only proxy metadata', () => {
    const document = createProjectDocument({
      id: 'project-one',
      createdAt: '2026-08-08T00:00:00.000Z',
      name: '세션 테스트',
      aspectRatio: '16:9',
      assets: [{ ...cachedAsset, proxyCachePath: undefined, proxyCachedAt: undefined }],
      tracks: [],
    })

    expect(document.assets[0]).not.toHaveProperty('proxySize')
    expect(document.assets[0]).not.toHaveProperty('proxyWidth')
    expect(document.assets[0]).not.toHaveProperty('proxyHeight')
  })

  it('round-trips a project document and keeps connected files only for the same media identity', () => {
    const document = createProjectDocument({
      id: 'project-one', createdAt: '2026-08-08T00:00:00.000Z', name: '왕복 테스트',
      aspectRatio: '16:9', assets: [cachedAsset], tracks: [],
    })
    const parsed = parseProjectDocument(JSON.stringify(document))
    const reconnected = reconcileProjectAssets([cachedAsset], parsed.assets)

    expect(parsed).toMatchObject({ schemaVersion: 1, id: 'project-one', name: '왕복 테스트' })
    expect(reconnected[0]).toMatchObject({ sourceFile: cachedAsset.sourceFile, url: 'blob:original', status: 'ready' })

    const changedIdentity = reconcileProjectAssets([{ ...cachedAsset, size: 999 }], parsed.assets)
    expect(changedIdentity[0]).toMatchObject({ url: '', status: 'offline' })
    expect(changedIdentity[0]).not.toHaveProperty('sourceFile')
  })

  it('rejects unsupported or incomplete project files', () => {
    expect(() => parseProjectDocument(JSON.stringify({ schemaVersion: 2 }))).toThrow(/지원하지 않는/)
    expect(() => parseProjectDocument(JSON.stringify({ schemaVersion: 1, name: 'broken' }))).toThrow(/필수 데이터/)
  })
})
