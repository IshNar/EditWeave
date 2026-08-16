import { invoke, isTauri } from '@tauri-apps/api/core'
import type { TimelineMarker } from '../editor/types'

export interface LanReviewSession {
  token: string
  url: string
  port: number
  sequenceId: string
}

interface NativeLanReviewSession {
  token: string
  url: string
  port: number
}

export async function startLanReviewSession(options: { token: string; projectName: string; sequenceId: string; videoPath: string; comments: TimelineMarker[] }): Promise<LanReviewSession> {
  if (!isTauri()) throw new Error('LAN 검토 링크는 데스크톱 앱에서만 열 수 있습니다.')
  const session = await invoke<NativeLanReviewSession>('start_lan_review', options)
  return { ...session, sequenceId: options.sequenceId }
}

export async function syncLanReviewSession(token: string, comments: TimelineMarker[], deletedIds: string[] = []): Promise<TimelineMarker[]> {
  if (!isTauri()) return comments
  return invoke<TimelineMarker[]>('sync_lan_review', { token, comments, deletedIds })
}

export async function deleteLanReviewComment(token: string, commentId: string): Promise<void> {
  if (!isTauri()) return
  await invoke('delete_lan_review_comment', { token, commentId })
}

export async function stopLanReviewSession(token: string): Promise<void> {
  if (!isTauri()) return
  await invoke('stop_lan_review', { token })
}
