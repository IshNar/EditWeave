import { invoke, isTauri } from '@tauri-apps/api/core'
import type { HdrMasteringDisplay, MediaAsset, TimelineTrack } from '../editor/types'
import { effectiveSourceHdrFormat } from '../editor/sourceInterpretation'

export interface HdrOutputMetadata {
  mastering?: Required<HdrMasteringDisplay>
  maxCll?: number
  maxFall?: number
}

export interface HdrMetadataIssue {
  field: string
  message: string
}

const masteringFields: Array<keyof HdrMasteringDisplay> = [
  'redX', 'redY', 'greenX', 'greenY', 'blueX', 'blueY',
  'whitePointX', 'whitePointY', 'minLuminance', 'maxLuminance',
]

const chromaticityFields: Array<keyof HdrMasteringDisplay> = [
  'redX', 'redY', 'greenX', 'greenY', 'blueX', 'blueY', 'whitePointX', 'whitePointY',
]

function completeMasteringDisplay(value?: HdrMasteringDisplay): Required<HdrMasteringDisplay> | undefined {
  if (!value || masteringFields.some((field) => !Number.isFinite(value[field]))) return undefined
  const complete = Object.fromEntries(masteringFields.map((field) => [field, value[field]])) as unknown as Required<HdrMasteringDisplay>
  return inspectHdrOutputMetadata({ mastering: complete }).length ? undefined : complete
}

function contentLightValue(values: Array<number | undefined>): number | undefined {
  const finite = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
  if (!finite.length) return undefined
  return Math.min(65_535, Math.round(Math.max(...finite)))
}

export function collectHdrOutputMetadata(assets: MediaAsset[], tracks: TimelineTrack[]): HdrOutputMetadata {
  const referencedAssetIds = new Set(tracks.flatMap((track) => track.clips.map((clip) => clip.assetId).filter((id): id is string => Boolean(id))))
  const referencedHdrAssets = assets.filter((asset) => referencedAssetIds.has(asset.id) && effectiveSourceHdrFormat(asset) === 'pq')
  const maxFall = contentLightValue(referencedHdrAssets.map((asset) => asset.maxFrameAverageLightLevel))
  const measuredMaxCll = contentLightValue(referencedHdrAssets.map((asset) => asset.maxContentLightLevel))
  // A CLLI box with MaxFALL greater than MaxCLL is contradictory. If a source
  // only reports MaxFALL, use it as the conservative lower bound for MaxCLL.
  const maxCll = maxFall === undefined ? measuredMaxCll : Math.max(measuredMaxCll ?? maxFall, maxFall)
  return {
    mastering: referencedHdrAssets.map((asset) => completeMasteringDisplay(asset.hdrMasteringDisplay)).find(Boolean),
    maxCll,
    maxFall,
  }
}

export function inspectHdrOutputMetadata(metadata: HdrOutputMetadata): HdrMetadataIssue[] {
  const issues: HdrMetadataIssue[] = []
  if (metadata.mastering) {
    for (const field of masteringFields) {
      if (!Number.isFinite(metadata.mastering[field])) issues.push({ field, message: `${field} 값은 유한한 숫자여야 합니다.` })
    }
    for (const field of chromaticityFields) {
      const value = metadata.mastering[field]
      if (Number.isFinite(value) && (value < 0 || value > 1)) issues.push({ field, message: `${field} 색도 좌표는 0~1 범위여야 합니다.` })
    }
    const { minLuminance, maxLuminance } = metadata.mastering
    if (Number.isFinite(minLuminance) && (minLuminance < 0 || minLuminance > 10_000)) issues.push({ field: 'minLuminance', message: '최소 휘도는 0~10,000 nit 범위여야 합니다.' })
    if (Number.isFinite(maxLuminance) && (maxLuminance <= 0 || maxLuminance > 10_000)) issues.push({ field: 'maxLuminance', message: '최대 휘도는 0보다 크고 10,000 nit 이하여야 합니다.' })
    if (Number.isFinite(minLuminance) && Number.isFinite(maxLuminance) && minLuminance >= maxLuminance) issues.push({ field: 'masteringLuminance', message: '최대 휘도는 최소 휘도보다 커야 합니다.' })
  }
  for (const [field, value] of [['maxCll', metadata.maxCll], ['maxFall', metadata.maxFall]] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 65_535 || !Number.isInteger(value))) {
      issues.push({ field, message: `${field} 값은 0~65,535 범위의 정수여야 합니다.` })
    }
  }
  if (metadata.maxCll !== undefined && metadata.maxFall !== undefined && metadata.maxFall > metadata.maxCll) {
    issues.push({ field: 'contentLight', message: 'MaxCLL은 MaxFALL보다 크거나 같아야 합니다.' })
  }
  return issues
}

export async function applyHdrOutputMetadata(outputPath: string, metadata: HdrOutputMetadata): Promise<void> {
  if (!isTauri() || (!metadata.mastering && metadata.maxCll === undefined && metadata.maxFall === undefined)) return
  const issues = inspectHdrOutputMetadata(metadata)
  if (issues.length) throw new Error(`HDR10 메타데이터 적합성 검사 실패: ${issues.map((issue) => issue.message).join(' ')}`)
  await invoke('apply_hdr_output_metadata', {
    outputPath,
    mastering: metadata.mastering,
    maxCll: metadata.maxCll,
    maxFall: metadata.maxFall,
  })
}
