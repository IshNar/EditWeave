const STORAGE_KEY = 'cutline-recent-projects-v1'
const MAX_RECENT_PROJECTS = 10

export interface RecentProjectEntry {
  path: string
  name: string
  openedAt: string
}

export function readRecentProjects(): RecentProjectEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry): RecentProjectEntry[] => {
      if (!entry || typeof entry !== 'object') return []
      const candidate = entry as Partial<RecentProjectEntry>
      return typeof candidate.path === 'string' && candidate.path.trim() && typeof candidate.name === 'string'
        ? [{ path: candidate.path, name: candidate.name.trim() || projectNameFromPath(candidate.path), openedAt: typeof candidate.openedAt === 'string' ? candidate.openedAt : new Date(0).toISOString() }]
        : []
    }).slice(0, MAX_RECENT_PROJECTS)
  } catch {
    return []
  }
}

export function rememberRecentProject(path: string, name: string): RecentProjectEntry[] {
  const normalized = path.trim()
  if (!normalized) return readRecentProjects()
  const next = [
    { path: normalized, name: name.trim() || projectNameFromPath(normalized), openedAt: new Date().toISOString() },
    ...readRecentProjects().filter((entry) => entry.path.toLocaleLowerCase() !== normalized.toLocaleLowerCase()),
  ].slice(0, MAX_RECENT_PROJECTS)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function forgetRecentProject(path: string): RecentProjectEntry[] {
  const normalized = path.trim().toLocaleLowerCase()
  const next = readRecentProjects().filter((entry) => entry.path.toLocaleLowerCase() !== normalized)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

function projectNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop()?.replace(/\.cutline\.json$/i, '').replace(/\.json$/i, '') || 'Cutline 프로젝트'
}
