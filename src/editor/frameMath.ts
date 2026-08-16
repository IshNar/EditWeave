export type FrameRounding = 'nearest' | 'floor' | 'ceil'

export function safeFrameRate(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? fps : 30
}

export function frameIndexAtTime(time: number, fps: number, rounding: FrameRounding = 'nearest'): number {
  const frames = Math.max(0, Number.isFinite(time) ? time : 0) * safeFrameRate(fps)
  if (rounding === 'floor') return Math.floor(frames + Number.EPSILON)
  if (rounding === 'ceil') return Math.ceil(frames - Number.EPSILON)
  return Math.round(frames)
}

export function timeAtFrame(frame: number, fps: number): number {
  return Math.max(0, Math.round(Number.isFinite(frame) ? frame : 0)) / safeFrameRate(fps)
}

export function snapTimeToFrame(time: number, fps: number, rounding: FrameRounding = 'nearest'): number {
  return timeAtFrame(frameIndexAtTime(time, fps, rounding), fps)
}

export function frameAlignmentError(time: number, fps: number): number {
  const frames = Math.max(0, Number.isFinite(time) ? time : 0) * safeFrameRate(fps)
  return Math.abs(frames - Math.round(frames))
}

export function sameTimelineFrame(left: number, right: number, fps: number): boolean {
  return frameIndexAtTime(left, fps) === frameIndexAtTime(right, fps)
}
