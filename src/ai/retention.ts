import type { AudienceRetentionProfile, AudienceRetentionSample } from '../editor/types'

const timeHeaders = ['time', 'timestamp', 'video time', 'elapsed video time', 'position', 'video position', '시각', '시간', '재생 시간']
const retentionHeaders = ['retention', 'audience retention', 'audience watch ratio', 'watch ratio', 'percentage', 'percent', '시청 지속률', '유지율']

export function parseAudienceRetentionCsv(source: string, sourceName: string, duration: number): AudienceRetentionProfile {
  const rows = parseCsv(source).filter((row) => row.some((cell) => cell.trim()))
  if (rows.length < 4) throw new Error('헤더와 유지율 데이터 3개 이상이 포함된 CSV가 필요합니다.')
  const headers = rows[0].map(normalizeHeader)
  const timeIndex = findHeader(headers, timeHeaders)
  const retentionIndex = findHeader(headers, retentionHeaders)
  if (timeIndex < 0 || retentionIndex < 0) throw new Error('시간(time/timestamp)과 유지율(retention/audienceWatchRatio) 열을 찾지 못했습니다.')
  const proportionalTime = /ratio|비율/.test(headers[timeIndex])
  const percentPosition = /%|percent/.test(headers[timeIndex])
  const samples = rows.slice(1).map((row) => {
    const rawTime = row[timeIndex]?.trim() ?? ''
    const rawRetention = row[retentionIndex]?.trim() ?? ''
    const parsedTime = parseTime(rawTime)
    const parsedRetention = parseNumber(rawRetention)
    if (!Number.isFinite(parsedTime) || !Number.isFinite(parsedRetention)) return undefined
    const time = proportionalTime && parsedTime <= 1 ? parsedTime * duration : percentPosition && parsedTime <= 100 ? parsedTime / 100 * duration : parsedTime
    const retention = /%/.test(rawRetention) || parsedRetention > 2 ? parsedRetention / 100 : parsedRetention
    if (time < 0 || time > duration + 1 || retention < 0) return undefined
    return { time: Math.min(duration, time), retention: Math.min(3, retention) }
  }).filter((sample): sample is AudienceRetentionSample => Boolean(sample))
    .sort((left, right) => left.time - right.time)
  const unique = samples.filter((sample, index) => !index || Math.abs(sample.time - samples[index - 1].time) > 0.001)
  if (unique.length < 3) throw new Error('유효한 유지율 데이터가 3개 미만입니다. 시간과 백분율 형식을 확인하세요.')
  return { sourceName, importedAt: new Date().toISOString(), duration, samples: unique }
}

export function retentionAt(samples: AudienceRetentionSample[], time: number): number | undefined {
  if (!samples.length) return undefined
  if (time <= samples[0].time) return samples[0].retention
  const last = samples[samples.length - 1]
  if (time >= last.time) return last.retention
  let low = 0
  let high = samples.length - 1
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (samples[middle].time <= time) low = middle
    else high = middle
  }
  const span = Math.max(0.000001, samples[high].time - samples[low].time)
  const mix = (time - samples[low].time) / span
  return samples[low].retention + (samples[high].retention - samples[low].retention) * mix
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index++ }
      else if (character === '"') quoted = false
      else field += character
    } else if (character === '"') quoted = true
    else if (character === ',') { row.push(field); field = '' }
    else if (character === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = '' }
    else field += character
  }
  row.push(field.replace(/\r$/, ''))
  rows.push(row)
  return rows
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLocaleLowerCase('en-US').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

function findHeader(headers: string[], candidates: string[]): number {
  const normalized = candidates.map(normalizeHeader)
  const exact = headers.findIndex((header) => normalized.includes(header))
  return exact >= 0 ? exact : headers.findIndex((header) => normalized.some((candidate) => header.includes(candidate)))
}

function parseTime(value: string): number {
  const normalized = value.trim().replace(',', '.')
  if (!normalized.includes(':')) return parseNumber(normalized)
  const parts = normalized.split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return Number.NaN
  return parts.reduce((total, part) => total * 60 + part, 0)
}

function parseNumber(value: string): number {
  const match = value.replace(/\s/g, '').replace(',', '.').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : Number.NaN
}
