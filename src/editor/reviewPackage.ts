import type { TimelineMarker } from './types'

export interface ReviewPackage {
  schema: 'cutline-review-v1'
  projectId: string
  projectName: string
  sequenceId: string
  exportedAt: string
  comments: TimelineMarker[]
}

export function createReviewPackage(projectId: string, projectName: string, sequenceId: string, markers: TimelineMarker[]): ReviewPackage {
  return {
    schema: 'cutline-review-v1',
    projectId,
    projectName,
    sequenceId,
    exportedAt: new Date().toISOString(),
    comments: markers.filter((marker) => marker.kind === 'comment').map((marker) => ({ ...marker })),
  }
}

export function parseReviewPackage(raw: string): ReviewPackage {
  const value = JSON.parse(raw) as Partial<ReviewPackage>
  if (value.schema !== 'cutline-review-v1' || !value.projectId || !value.sequenceId || !Array.isArray(value.comments)) throw new Error('지원되는 Cutline 검토 패키지가 아닙니다.')
  if (value.comments.length > 10_000) throw new Error('검토 패키지 코멘트 수가 안전 제한(10,000개)을 넘습니다.')
  const comments = value.comments.filter((marker): marker is TimelineMarker => Boolean(marker && marker.kind === 'comment' && typeof marker.id === 'string' && typeof marker.time === 'number' && Number.isFinite(marker.time) && typeof marker.label === 'string')).map((marker) => ({ ...marker, id: marker.id.slice(0, 160), label: marker.label.slice(0, 2_000), author: marker.author?.slice(0, 120), time: Math.max(0, marker.time), status: marker.status === 'resolved' ? 'resolved' as const : 'open' as const }))
  return { schema: 'cutline-review-v1', projectId: value.projectId, projectName: value.projectName ?? '공유 프로젝트', sequenceId: value.sequenceId, exportedAt: value.exportedAt ?? new Date(0).toISOString(), comments }
}

export function mergeReviewComments(existing: TimelineMarker[], incoming: TimelineMarker[]): { markers: TimelineMarker[]; added: number; updated: number } {
  const byId = new Map(existing.map((marker) => [marker.id, marker]))
  const contentKeys = new Set(existing.filter((marker) => marker.kind === 'comment').map(commentKey))
  let added = 0
  let updated = 0
  for (const comment of incoming) {
    const current = byId.get(comment.id)
    if (current) {
      if (current.kind === 'comment' && (current.label !== comment.label || current.status !== comment.status || current.time !== comment.time || current.author !== comment.author)) {
        byId.set(comment.id, { ...current, ...comment, kind: 'comment' })
        updated++
      }
      continue
    }
    const key = commentKey(comment)
    if (contentKeys.has(key)) continue
    byId.set(comment.id, { ...comment, kind: 'comment' })
    contentKeys.add(key)
    added++
  }
  return { markers: [...byId.values()].sort((left, right) => left.time - right.time), added, updated }
}

function commentKey(marker: TimelineMarker): string {
  return `${marker.time.toFixed(3)}|${marker.author ?? ''}|${marker.label.trim()}|${marker.status ?? 'open'}`
}
