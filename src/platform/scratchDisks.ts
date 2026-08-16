import { invoke, isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

export type ScratchDiskKind = 'proxy' | 'recording' | 'render'

export interface ScratchDiskPreferences {
  proxyRoot?: string
  recordingRoot?: string
  renderRoot?: string
  knownRoots: string[]
}

const KEY = 'cutline.scratch-disks.v1'
const EMPTY: ScratchDiskPreferences = { knownRoots: [] }
const subdirectories: Record<ScratchDiskKind, string> = { proxy: 'Proxies', recording: 'Recordings', render: 'Render-Cache' }

export function readScratchDiskPreferences(): ScratchDiskPreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ScratchDiskPreferences>
    return {
      proxyRoot: cleanRoot(parsed.proxyRoot), recordingRoot: cleanRoot(parsed.recordingRoot), renderRoot: cleanRoot(parsed.renderRoot),
      knownRoots: [...new Set((parsed.knownRoots ?? []).map(cleanRoot).filter((root): root is string => Boolean(root)))].slice(-20),
    }
  } catch { return EMPTY }
}

export function writeScratchDiskPreferences(value: ScratchDiskPreferences): void {
  localStorage.setItem(KEY, JSON.stringify({ ...value, knownRoots: [...new Set(value.knownRoots.map(cleanRoot).filter((root): root is string => Boolean(root)))].slice(-20) }))
}

export function scratchRoot(kind: ScratchDiskKind, preferences = readScratchDiskPreferences()): string | undefined {
  return kind === 'proxy' ? preferences.proxyRoot : kind === 'recording' ? preferences.recordingRoot : preferences.renderRoot
}

export function scratchManagedDirectory(kind: ScratchDiskKind, preferences = readScratchDiskPreferences()): string | undefined {
  const root = scratchRoot(kind, preferences)
  return root ? joinPath(root, 'Cutline', subdirectories[kind]) : undefined
}

export function scratchManagedPath(kind: ScratchDiskKind, parts: string[], preferences = readScratchDiskPreferences()): string | undefined {
  const directory = scratchManagedDirectory(kind, preferences)
  return directory ? joinPath(directory, ...parts.map((part) => safePart(part))) : undefined
}

export function isKnownScratchPath(kind: ScratchDiskKind, path: string, preferences = readScratchDiskPreferences()): boolean {
  const normalized = normalizePath(path)
  return preferences.knownRoots.some((root) => normalized.startsWith(`${normalizePath(joinPath(root, 'Cutline', subdirectories[kind]))}/`))
}

export function isCurrentScratchPath(kind: ScratchDiskKind, path: string, preferences = readScratchDiskPreferences()): boolean {
  const root = scratchRoot(kind, preferences)
  if (!root) return kind === 'proxy' ? /^proxies\//.test(path) : false
  const directory = scratchManagedDirectory(kind, preferences)
  return Boolean(directory && normalizePath(path).startsWith(`${normalizePath(directory)}/`))
}

export interface ScratchDiskUsage { bytes: number; files: number }

export async function readScratchDiskUsage(kind: ScratchDiskKind, preferences = readScratchDiskPreferences()): Promise<ScratchDiskUsage> {
  if (!isTauri()) return { bytes: 0, files: 0 }
  return invoke<ScratchDiskUsage>('scratch_disk_usage', { kind, scratchRoot: scratchRoot(kind, preferences) })
}

export async function clearScratchDiskArea(kind: Exclude<ScratchDiskKind, 'recording'>, preferences = readScratchDiskPreferences()): Promise<ScratchDiskUsage> {
  if (!isTauri()) return { bytes: 0, files: 0 }
  return invoke<ScratchDiskUsage>('clear_scratch_area', { kind, scratchRoot: scratchRoot(kind, preferences) })
}

export async function chooseScratchRoot(kind: ScratchDiskKind, current: ScratchDiskPreferences): Promise<ScratchDiskPreferences | undefined> {
  if (!isTauri()) return undefined
  const selected = await open({ title: `${scratchKindLabel(kind)} 저장 루트 선택`, multiple: false, directory: true })
  if (typeof selected !== 'string') return undefined
  await invoke('authorize_scratch_directory', { directory: selected })
  const root = cleanRoot(selected)!
  const next = { ...current, [`${kind}Root`]: root, knownRoots: [...new Set([...current.knownRoots, root])].slice(-20) } as ScratchDiskPreferences
  writeScratchDiskPreferences(next)
  return next
}

export async function authorizeKnownScratchRoots(preferences = readScratchDiskPreferences()): Promise<void> {
  if (!isTauri()) return
  await Promise.allSettled(preferences.knownRoots.map((directory) => invoke('authorize_scratch_directory', { directory })))
}

export function resetScratchRoot(kind: ScratchDiskKind, current: ScratchDiskPreferences): ScratchDiskPreferences {
  const next = { ...current, [`${kind}Root`]: undefined } as ScratchDiskPreferences
  writeScratchDiskPreferences(next)
  return next
}

export function scratchKindLabel(kind: ScratchDiskKind): string {
  return kind === 'proxy' ? '프록시 캐시' : kind === 'recording' ? 'ADR·보이스오버 녹음' : '렌더 복구 캐시'
}

function cleanRoot(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^(?:[A-Za-z]:[\\/]|\/)/.test(value)) return undefined
  return value.replace(/[\\/]+$/, '')
}

function joinPath(...parts: string[]): string {
  const separator = parts[0]?.includes('\\') ? '\\' : '/'
  return parts.filter(Boolean).map((part, index) => index ? part.replace(/^[\\/]+|[\\/]+$/g, '') : part.replace(/[\\/]+$/g, '')).join(separator)
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase()
}

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^\.+$/, '-') || 'item'
}
