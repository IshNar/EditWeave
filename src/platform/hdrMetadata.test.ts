import { describe, expect, it } from 'vitest'
import type { HdrMasteringDisplay, MediaAsset, TimelineClip, TimelineTrack } from '../editor/types'
import { collectHdrOutputMetadata, inspectHdrOutputMetadata } from './hdrMetadata'

const transform = { positionX: 0, positionY: 0, scale: 100, rotation: 0, opacity: 100 }
const mastering: Required<HdrMasteringDisplay> = {
  redX: 0.708, redY: 0.292, greenX: 0.17, greenY: 0.797,
  blueX: 0.131, blueY: 0.046, whitePointX: 0.3127, whitePointY: 0.329,
  minLuminance: 0.005, maxLuminance: 1000,
}

function asset(id: string, values: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id, name: `${id}.mov`, kind: 'video', url: `blob:${id}`, duration: 10,
    size: 1, extension: 'mov', status: 'ready', hdrFormat: 'pq', ...values,
  }
}

function clip(id: string, assetId: string): TimelineClip {
  return { id, trackId: 'v1', assetId, name: id, start: 0, duration: 10, sourceOffset: 0, kind: 'video', color: '#000', transform }
}

function track(...assetIds: string[]): TimelineTrack {
  return { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false, clips: assetIds.map((id, index) => clip(`clip-${index}`, id)) }
}

describe('HDR10 static metadata conformance', () => {
  it('uses only referenced PQ sources and preserves valid mastering data', () => {
    const selected = asset('selected', { hdrMasteringDisplay: mastering, maxContentLightLevel: 1000, maxFrameAverageLightLevel: 400 })
    const unreferenced = asset('unused', { maxContentLightLevel: 4000, maxFrameAverageLightLevel: 1000 })
    const hlg = asset('hlg', { hdrFormat: 'hlg', maxContentLightLevel: 2000, maxFrameAverageLightLevel: 800 })
    expect(collectHdrOutputMetadata([selected, unreferenced, hlg], [track('selected', 'hlg')])).toEqual({ mastering, maxCll: 1000, maxFall: 400 })
  })

  it('ignores invalid mastering data and selects the next valid referenced source', () => {
    const invalid = asset('invalid', { hdrMasteringDisplay: { ...mastering, redX: 1.2 } })
    const valid = asset('valid', { hdrMasteringDisplay: mastering })
    expect(collectHdrOutputMetadata([invalid, valid], [track('invalid', 'valid')]).mastering).toEqual(mastering)
  })

  it('clamps content-light values and maintains MaxCLL at or above MaxFALL', () => {
    const metadata = collectHdrOutputMetadata([
      asset('a', { maxContentLightLevel: 1000, maxFrameAverageLightLevel: 2000 }),
      asset('b', { maxContentLightLevel: 70_000 }),
    ], [track('a', 'b')])
    expect(metadata).toMatchObject({ maxCll: 65_535, maxFall: 2000 })
    expect(inspectHdrOutputMetadata(metadata)).toEqual([])
    expect(collectHdrOutputMetadata([asset('fall-only', { maxFrameAverageLightLevel: 600 })], [track('fall-only')]))
      .toMatchObject({ maxCll: 600, maxFall: 600 })
  })

  it('reports invalid coordinate, luminance, integer, and content-light relations', () => {
    const issues = inspectHdrOutputMetadata({
      mastering: { ...mastering, whitePointY: -0.1, minLuminance: 1200, maxLuminance: 1000 },
      maxCll: 999.5,
      maxFall: 1200,
    })
    expect(issues.map((issue) => issue.field)).toEqual(expect.arrayContaining(['whitePointY', 'masteringLuminance', 'maxCll', 'contentLight']))
  })
})
