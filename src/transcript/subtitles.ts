import type { TranscriptSegment } from '../editor/types'

export function parseSubtitleFile(contents: string): TranscriptSegment[] {
  if (/<(?:\w+:)?tt[\s>]/i.test(contents)) return parseTtml(contents)
  const normalized = contents.replace(/^WEBVTT[^\n]*\n+/i, '').replace(/\r/g, '').trim()
  if (!normalized) return []

  const blocks = normalized.split(/\n{2,}/)
  const segments: TranscriptSegment[] = []
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
    const timingIndex = lines.findIndex((line) => line.includes('-->'))
    if (timingIndex < 0) continue
    const [startRaw, endRaw] = lines[timingIndex].split('-->').map((value) => value.trim().split(/\s+/)[0])
    const start = parseTimestamp(startRaw)
    const end = parseTimestamp(endRaw)
    const text = lines.slice(timingIndex + 1).join(' ').replace(/<[^>]+>/g, '').trim()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) continue
    segments.push({ id: crypto.randomUUID(), start, end, text })
  }
  return segments.sort((a, b) => a.start - b.start)
}

export function transcriptToSrt(segments: TranscriptSegment[]): string {
  return [...segments]
    .sort((a, b) => a.start - b.start)
    .map((segment, index) => `${index + 1}\n${formatSrtTimestamp(segment.start)} --> ${formatSrtTimestamp(segment.end)}\n${segment.text}`)
    .join('\n\n')
}

export function transcriptToVtt(segments: TranscriptSegment[]): string {
  const cues = [...segments]
    .sort((a, b) => a.start - b.start)
    .map((segment) => `${formatVttTimestamp(segment.start)} --> ${formatVttTimestamp(segment.end)}\n${segment.text}`)
    .join('\n\n')
  return `WEBVTT\n\n${cues}\n`
}

export function transcriptToTtml(segments: TranscriptSegment[], language = 'ko'): string {
  const body = [...segments]
    .sort((a, b) => a.start - b.start)
    .map((segment) => `      <p begin="${formatVttTimestamp(segment.start)}" end="${formatVttTimestamp(segment.end)}"${segment.language && segment.language !== language ? ` xml:lang="${escapeXml(segment.language)}"` : ''}>${escapeXml(segment.text)}</p>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="${escapeXml(language)}">\n  <head><metadata xmlns="http://www.w3.org/ns/ttml#metadata"><title>EditWeave Captions</title></metadata></head>\n  <body><div>\n${body}\n  </div></body>\n</tt>\n`
}

function parseTtml(contents: string): TranscriptSegment[] {
  const document = new DOMParser().parseFromString(contents, 'application/xml')
  if (document.querySelector('parsererror')) throw new Error('TTML XML을 읽을 수 없습니다.')
  const root = document.documentElement
  const rootLanguage = languageAttribute(root)
  const frameRate = Number(root.getAttribute('ttp:frameRate') ?? root.getAttributeNS('http://www.w3.org/ns/ttml#parameter', 'frameRate') ?? 30) || 30
  const frameRateMultiplier = (root.getAttribute('ttp:frameRateMultiplier') ?? root.getAttributeNS('http://www.w3.org/ns/ttml#parameter', 'frameRateMultiplier') ?? '').trim().split(/\s+/).map(Number)
  const effectiveFrameRate = frameRateMultiplier.length === 2 && frameRateMultiplier.every(Number.isFinite) && frameRateMultiplier[1] ? frameRate * frameRateMultiplier[0] / frameRateMultiplier[1] : frameRate
  const tickRate = Number(root.getAttribute('ttp:tickRate') ?? root.getAttributeNS('http://www.w3.org/ns/ttml#parameter', 'tickRate') ?? 1) || 1
  return [...document.getElementsByTagNameNS('*', 'p')].flatMap((node) => {
    const start = parseTtmlTimestamp(node.getAttribute('begin') ?? '', effectiveFrameRate, tickRate)
    const explicitEnd = parseTtmlTimestamp(node.getAttribute('end') ?? '', effectiveFrameRate, tickRate)
    const duration = parseTtmlTimestamp(node.getAttribute('dur') ?? '', effectiveFrameRate, tickRate)
    const end = Number.isFinite(explicitEnd) ? explicitEnd : start + duration
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) return []
    return [{ id: crypto.randomUUID(), start, end, text, language: languageAttribute(node) ?? rootLanguage } satisfies TranscriptSegment]
  }).sort((a, b) => a.start - b.start)
}

function parseTtmlTimestamp(value: string, frameRate = 30, tickRate = 1): number {
  const input = value.trim()
  if (!input) return Number.NaN
  const clockFrames = input.match(/^(\d{1,2}):(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/)
  if (clockFrames) return Number(clockFrames[1]) * 3600 + Number(clockFrames[2]) * 60 + Number(clockFrames[3]) + Number(clockFrames[4]) / frameRate + Number(`0.${clockFrames[5] ?? 0}`) / frameRate
  const unit = input.match(/^([\d.]+)(h|m|s|ms|f|t)$/i)
  if (unit) {
    const amount = Number(unit[1])
    const suffix = unit[2].toLowerCase()
    return suffix === 'h' ? amount * 3600 : suffix === 'm' ? amount * 60 : suffix === 'ms' ? amount / 1000 : suffix === 'f' ? amount / frameRate : suffix === 't' ? amount / tickRate : amount
  }
  return parseTimestamp(input)
}

function languageAttribute(element: Element): string | undefined {
  return element.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang') ?? element.getAttribute('xml:lang') ?? element.getAttribute('lang') ?? undefined
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function parseTimestamp(value: string): number {
  const parts = value.replace(',', '.').split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return Number.NaN
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return Number.NaN
}

function formatSrtTimestamp(seconds: number): string {
  const milliseconds = Math.round(Math.max(0, seconds) * 1000)
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const secs = Math.floor((milliseconds % 60_000) / 1000)
  const millis = milliseconds % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

function formatVttTimestamp(seconds: number): string {
  return formatSrtTimestamp(seconds).replace(',', '.')
}
