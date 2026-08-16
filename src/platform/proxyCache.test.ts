import { describe, expect, it } from 'vitest'
import { createProxyCachePath, isProxyCachePath } from './proxyCache'

describe('proxy cache paths', () => {
  it('creates a project-scoped safe MP4 path', () => {
    expect(createProxyCachePath('project:one', 'asset/one')).toBe('proxies/project-one/asset-one.mp4')
  })

  it('rejects paths outside the proxy cache root', () => {
    expect(isProxyCachePath('proxies/project/asset.mp4')).toBe(true)
    expect(isProxyCachePath('../project/asset.mp4')).toBe(false)
    expect(isProxyCachePath('proxies/project/../../asset.mp4')).toBe(false)
  })
})
