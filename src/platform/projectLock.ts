import { invoke, isTauri } from '@tauri-apps/api/core'

export interface ProjectLockOwner {
  instanceId: string
  user: string
  host: string
  processId: number
  acquiredAtMs: number
  heartbeatAtMs: number
}

export interface ProjectLockResult {
  acquired: boolean
  stale?: boolean
  lockPath: string
  owner: ProjectLockOwner
}

export async function acquireProjectLock(projectPath: string, instanceId: string, force = false): Promise<ProjectLockResult> {
  if (!isTauri()) throw new Error('공유 프로젝트 잠금은 데스크톱 앱에서만 사용할 수 있습니다.')
  return invoke<ProjectLockResult>('acquire_project_lock', { projectPath, instanceId, nowMs: Date.now(), force })
}

export async function heartbeatProjectLock(projectPath: string, instanceId: string): Promise<boolean> {
  if (!isTauri()) return false
  return invoke<boolean>('heartbeat_project_lock', { projectPath, instanceId, nowMs: Date.now() })
}

export async function releaseProjectLock(projectPath: string, instanceId: string): Promise<void> {
  if (!isTauri()) return
  await invoke('release_project_lock', { projectPath, instanceId })
}
