export interface HistoryTransition<T> {
  value: T
  past: T[]
  future: T[]
}

export function appendHistorySnapshot<T>(past: T[], snapshot: T, limit = 60): T[] {
  return [...past, snapshot].slice(-Math.max(1, limit))
}

export function undoHistorySnapshot<T>(past: T[], current: T, future: T[], limit = 60): HistoryTransition<T> | undefined {
  if (!past.length) return undefined
  return {
    value: past[past.length - 1],
    past: past.slice(0, -1),
    future: [current, ...future].slice(0, Math.max(1, limit)),
  }
}

export function redoHistorySnapshot<T>(past: T[], current: T, future: T[], limit = 60): HistoryTransition<T> | undefined {
  if (!future.length) return undefined
  return {
    value: future[0],
    past: appendHistorySnapshot(past, current, limit),
    future: future.slice(1),
  }
}
