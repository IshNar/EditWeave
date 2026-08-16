export function formatTimecode(seconds: number, withFrames = false, fps = 30): string {
  const safeSeconds = Math.max(0, seconds)
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const wholeSeconds = Math.floor(safeSeconds % 60)
  const nominalFps = Math.max(1, Math.round(fps))
  const frames = Math.min(nominalFps - 1, Math.floor((safeSeconds % 1) * nominalFps))
  const base = [hours, minutes, wholeSeconds].map((value) => String(value).padStart(2, '0')).join(':')
  return withFrames ? `${base}:${String(frames).padStart(2, '0')}` : base
}

export function parseTimelineTimecode(value: string, fps = 30, currentTime = 0): number | undefined {
  const input = value.trim()
  if (!input) return undefined
  const nominalFps = Math.max(1, Math.round(fps))
  const relative = input.startsWith('+') || input.startsWith('-')
  const sign = input.startsWith('-') ? -1 : 1
  const unsigned = relative ? input.slice(1).trim() : input
  if (!unsigned) return undefined

  let seconds: number
  const frameOnly = unsigned.match(/^(\d+(?:\.\d+)?)f$/i)
  if (frameOnly) {
    seconds = Number(frameOnly[1]) / nominalFps
  } else if (/^\d+$/.test(unsigned) && unsigned.length > 2) {
    const compact = unsigned.padStart(8, '0').slice(-8)
    const hours = Number(compact.slice(0, 2))
    const minutes = Number(compact.slice(2, 4))
    const wholeSeconds = Number(compact.slice(4, 6))
    const frames = Number(compact.slice(6, 8))
    seconds = hours * 3600 + minutes * 60 + wholeSeconds + frames / nominalFps
  } else if (unsigned.includes(':') || unsigned.includes(';')) {
    const parts = unsigned.replace(';', ':').split(':')
    if (parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part)) || parts.length > 4) return undefined
    const numbers = parts.map(Number)
    if (parts.length === 4) seconds = numbers[0] * 3600 + numbers[1] * 60 + numbers[2] + numbers[3] / nominalFps
    else if (parts.length === 3) seconds = numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
    else if (parts.length === 2) seconds = numbers[0] * 60 + numbers[1]
    else seconds = numbers[0]
  } else {
    seconds = Number(unsigned)
  }
  if (!Number.isFinite(seconds)) return undefined
  const resolved = relative ? currentTime + sign * seconds : seconds
  return Math.round(Math.max(0, resolved) * nominalFps) / nominalFps
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:10'
  const minutes = Math.floor(seconds / 60)
  const remaining = Math.floor(seconds % 60)
  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
