export interface ParsedMediaTimecode {
  seconds: number
  dropFrame: boolean
  normalized: string
}

export function parseMediaTimecode(value: string, fps = 30): ParsedMediaTimecode | undefined {
  const input = value.trim()
  if (!input) return undefined
  if (/^\d+(?:\.\d+)?$/.test(input)) {
    const seconds = Number(input)
    return Number.isFinite(seconds) && seconds >= 0 ? { seconds, dropFrame: false, normalized: input } : undefined
  }
  const match = input.match(/^(\d{1,2}):(\d{2}):(\d{2})([:;])(\d{2})$/)
  if (!match) return undefined
  const [, hourText, minuteText, secondText, separator, frameText] = match
  const hours = Number(hourText)
  const minutes = Number(minuteText)
  const seconds = Number(secondText)
  const frames = Number(frameText)
  const nominalFps = Math.max(1, Math.round(fps))
  if (minutes >= 60 || seconds >= 60 || frames >= nominalFps) return undefined
  const dropFrame = separator === ';' && isDropFrameRate(fps)
  const droppedPerMinute = nominalFps === 60 ? 4 : 2
  if (dropFrame && minutes % 10 !== 0 && seconds === 0 && frames < droppedPerMinute) return undefined
  const totalMinutes = hours * 60 + minutes
  const dropCount = dropFrame ? droppedPerMinute * (totalMinutes - Math.floor(totalMinutes / 10)) : 0
  const frameNumber = ((hours * 3600 + minutes * 60 + seconds) * nominalFps + frames) - dropCount
  return {
    seconds: frameNumber / Math.max(1, fps),
    dropFrame,
    normalized: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${dropFrame ? ';' : ':'}${pad(frames)}`,
  }
}

export function formatMediaTimecode(seconds: number, fps = 30, dropFrame = false): string {
  const safeSeconds = Math.max(0, seconds)
  const nominalFps = Math.max(1, Math.round(fps))
  if (dropFrame && isDropFrameRate(fps)) {
    const dropCount = nominalFps === 60 ? 4 : 2
    const framesPerHour = Math.round(fps * 3600)
    const framesPer24Hours = framesPerHour * 24
    const framesPer10Minutes = Math.round(fps * 600)
    const framesPerMinute = nominalFps * 60 - dropCount
    let frameNumber = Math.round(safeSeconds * fps) % framesPer24Hours
    const tenMinuteBlocks = Math.floor(frameNumber / framesPer10Minutes)
    const remainder = frameNumber % framesPer10Minutes
    frameNumber += dropCount * 9 * tenMinuteBlocks
    if (remainder >= dropCount) frameNumber += dropCount * Math.floor((remainder - dropCount) / framesPerMinute)
    const hours = Math.floor(frameNumber / (nominalFps * 3600))
    const minutes = Math.floor(frameNumber / (nominalFps * 60)) % 60
    const wholeSeconds = Math.floor(frameNumber / nominalFps) % 60
    const frames = frameNumber % nominalFps
    return `${pad(hours)}:${pad(minutes)}:${pad(wholeSeconds)};${pad(frames)}`
  }
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const wholeSeconds = Math.floor(safeSeconds % 60)
  const frames = Math.min(nominalFps - 1, Math.floor((safeSeconds % 1) * nominalFps))
  return `${pad(hours)}:${pad(minutes)}:${pad(wholeSeconds)}:${pad(frames)}`
}

function isDropFrameRate(fps: number): boolean {
  return Math.abs(fps - 29.97) < 0.02 || Math.abs(fps - 59.94) < 0.02
}

function pad(value: number): string {
  return String(Math.max(0, Math.floor(value))).padStart(2, '0')
}
