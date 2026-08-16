import type { MediaAsset } from '../editor/types'
import { formatMediaTimecode, parseMediaTimecode } from './timecode'

export interface MediaMetadataImportResult {
  updates: Array<{ assetId: string; patch: Partial<MediaAsset> }>
  unmatched: string[]
}

const columns = ['Asset ID', 'Filename', 'Source Path', 'Reel', 'Scene', 'Take', 'Camera', 'Rating', 'Favorite', 'Label Color', 'Folder', 'Tags', 'Notes', 'Start Timecode', 'Source Rotation', 'Pixel Aspect Ratio', 'Assume Frame Rate', 'Field Order', 'Input Color Space', 'Alpha Mode', 'Alpha Background'] as const

export function createMediaMetadataCsv(assets: MediaAsset[]): string {
  const rows = [columns, ...assets.map((asset) => [
    asset.id,
    asset.name,
    asset.sourcePath ?? '',
    asset.reelName ?? '',
    asset.scene ?? '',
    asset.take ?? '',
    asset.camera ?? '',
    asset.rating ?? '',
    asset.favorite ? 'TRUE' : 'FALSE',
    asset.labelColor ?? '',
    asset.folder ?? '',
    (asset.tags ?? []).join('; '),
    asset.notes ?? '',
    asset.timecodeStart === undefined ? '' : formatMediaTimecode(asset.timecodeStart, asset.frameRate || 30, Boolean(asset.timecodeDropFrame)),
    asset.sourceRotation ?? 0,
    asset.sourcePixelAspectRatio ?? 1,
    asset.sourceFrameRateOverride ?? '',
    asset.sourceFieldOrder ?? 'progressive',
    asset.sourceColorSpaceOverride ?? 'auto',
    asset.sourceAlphaMode ?? 'straight',
    asset.sourceAlphaBackground ?? '#000000',
  ])]
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

export function parseMediaMetadataCsv(contents: string, assets: MediaAsset[]): MediaMetadataImportResult {
  const rows = parseCsv(contents.replace(/^\uFEFF/, ''))
  if (rows.length < 2) throw new Error('메타데이터 CSV에 헤더와 데이터 행이 필요합니다.')
  const headers = rows[0].map(normalizeHeader)
  const column = (name: typeof columns[number]) => headers.indexOf(normalizeHeader(name))
  if (column('Asset ID') < 0 && column('Filename') < 0 && column('Source Path') < 0) throw new Error('Asset ID, Filename 또는 Source Path 열이 필요합니다.')
  const byId = new Map(assets.map((asset) => [asset.id, asset]))
  const byPath = new Map(assets.flatMap((asset) => asset.sourcePath ? [[normalizePath(asset.sourcePath), asset] as const] : []))
  const byName = new Map<string, MediaAsset | undefined>()
  for (const asset of assets) {
    const key = asset.name.trim().toLocaleLowerCase('en-US')
    byName.set(key, byName.has(key) ? undefined : asset)
  }
  const updates: MediaMetadataImportResult['updates'] = []
  const unmatched: string[] = []
  for (const row of rows.slice(1)) {
    if (!row.some((value) => value.trim())) continue
    const value = (name: typeof columns[number]) => {
      const index = column(name)
      return index < 0 ? undefined : (row[index] ?? '').trim()
    }
    const asset = byId.get(value('Asset ID') ?? '')
      ?? byPath.get(normalizePath(value('Source Path') ?? ''))
      ?? byName.get((value('Filename') ?? '').toLocaleLowerCase('en-US'))
    if (!asset) {
      unmatched.push(value('Filename') || value('Source Path') || value('Asset ID') || `행 ${updates.length + unmatched.length + 2}`)
      continue
    }
    const patch: Partial<MediaAsset> = {}
    assignText(patch, 'reelName', value('Reel'))
    assignText(patch, 'scene', value('Scene'))
    assignText(patch, 'take', value('Take'))
    assignText(patch, 'camera', value('Camera'))
    assignText(patch, 'labelColor', value('Label Color'))
    assignText(patch, 'folder', value('Folder'))
    assignText(patch, 'notes', value('Notes'))
    const rating = value('Rating')
    if (rating !== undefined) patch.rating = rating ? Math.max(0, Math.min(5, Math.round(Number(rating) || 0))) : 0
    const favorite = value('Favorite')
    if (favorite !== undefined) patch.favorite = /^(true|yes|y|1|예)$/i.test(favorite)
    const tags = value('Tags')
    if (tags !== undefined) patch.tags = tags.split(/[;,]/).map((tag) => tag.trim()).filter(Boolean)
    const timecode = value('Start Timecode')
    if (timecode !== undefined) {
      const parsed = timecode ? parseMediaTimecode(timecode, asset.frameRate || 30) : undefined
      if (timecode && !parsed) throw new Error(`“${asset.name}”의 Start Timecode 값이 올바르지 않습니다: ${timecode}`)
      patch.timecodeStart = parsed?.seconds
      patch.sourceTimecode = parsed?.normalized
      patch.timecodeDropFrame = parsed?.dropFrame
      patch.timecodeSource = parsed ? 'manual' : undefined
    }
    const rotation = value('Source Rotation')
    if (rotation !== undefined) {
      const parsed = Number(rotation || 0)
      if (![0, 90, 180, 270].includes(parsed)) throw new Error(`“${asset.name}”의 Source Rotation은 0, 90, 180, 270 중 하나여야 합니다: ${rotation}`)
      patch.sourceRotation = parsed as MediaAsset['sourceRotation']
    }
    const pixelAspectRatio = value('Pixel Aspect Ratio')
    if (pixelAspectRatio !== undefined) {
      const parsed = Number(pixelAspectRatio || 1)
      if (!Number.isFinite(parsed) || parsed < .1 || parsed > 10) throw new Error(`“${asset.name}”의 Pixel Aspect Ratio는 0.1~10 사이여야 합니다: ${pixelAspectRatio}`)
      patch.sourcePixelAspectRatio = parsed
    }
    const assumeFrameRate = value('Assume Frame Rate')
    if (assumeFrameRate !== undefined) {
      const parsed = assumeFrameRate ? Number(assumeFrameRate) : undefined
      if (parsed !== undefined && (!Number.isFinite(parsed) || parsed < 1 || parsed > 240)) throw new Error(`“${asset.name}”의 Assume Frame Rate는 1~240fps 사이여야 합니다: ${assumeFrameRate}`)
      patch.sourceFrameRateOverride = parsed
    }
    const fieldOrder = value('Field Order')
    if (fieldOrder !== undefined) {
      const parsed = fieldOrder.trim().toLocaleLowerCase('en-US') || 'progressive'
      if (parsed !== 'progressive' && parsed !== 'upper-first' && parsed !== 'lower-first') throw new Error(`“${asset.name}”의 Field Order는 progressive, upper-first, lower-first 중 하나여야 합니다: ${fieldOrder}`)
      patch.sourceFieldOrder = parsed
    }
    const inputColorSpace = value('Input Color Space')
    if (inputColorSpace !== undefined) {
      const parsed = inputColorSpace.trim().toLocaleLowerCase('en-US') || 'auto'
      if (!['auto', 'rec709', 'display-p3', 'rec2020-pq', 'rec2020-hlg'].includes(parsed)) throw new Error(`“${asset.name}”의 Input Color Space 값이 올바르지 않습니다: ${inputColorSpace}`)
      patch.sourceColorSpaceOverride = parsed as MediaAsset['sourceColorSpaceOverride']
    }
    const alphaMode = value('Alpha Mode')
    if (alphaMode !== undefined) {
      const parsed = alphaMode.trim().toLocaleLowerCase('en-US') || 'straight'
      if (parsed !== 'straight' && parsed !== 'ignore') throw new Error(`“${asset.name}”의 Alpha Mode는 straight 또는 ignore여야 합니다: ${alphaMode}`)
      patch.sourceAlphaMode = parsed
    }
    const alphaBackground = value('Alpha Background')
    if (alphaBackground !== undefined) {
      const parsed = alphaBackground || '#000000'
      if (!/^#[0-9a-f]{6}$/i.test(parsed)) throw new Error(`“${asset.name}”의 Alpha Background는 #RRGGBB 형식이어야 합니다: ${alphaBackground}`)
      patch.sourceAlphaBackground = parsed
    }
    updates.push({ assetId: asset.id, patch })
  }
  return { updates, unmatched }
}

function assignText<K extends 'reelName' | 'scene' | 'take' | 'camera' | 'labelColor' | 'folder' | 'notes'>(patch: Partial<MediaAsset>, key: K, value: string | undefined): void {
  if (value !== undefined) patch[key] = value || undefined
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function normalizeHeader(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').replace(/[\s_-]+/g, '')
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').toLocaleLowerCase('en-US')
}

function parseCsv(contents: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < contents.length; index++) {
    const character = contents[index]
    if (quoted) {
      if (character === '"' && contents[index + 1] === '"') { cell += '"'; index++ }
      else if (character === '"') quoted = false
      else cell += character
    } else if (character === '"' && !cell) quoted = true
    else if (character === ',') { row.push(cell); cell = '' }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && contents[index + 1] === '\n') index++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += character
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}
