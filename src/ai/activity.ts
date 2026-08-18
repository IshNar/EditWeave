import type { AiActivityRecord } from '../editor/types'

export const AI_ACTIVITY_LIMIT = 250

type NewAiActivity = Omit<AiActivityRecord, 'version' | 'id' | 'status' | 'createdAt' | 'completedAt' | 'error' | 'changes'>

export function startAiActivity(input: NewAiActivity, now = new Date().toISOString(), id: string = crypto.randomUUID()): AiActivityRecord {
  if (input.processing.location === 'external-user-service' && input.approval !== 'user-confirmed-external-transfer') {
    throw new Error('외부 AI 처리는 명시적인 외부 전송 승인이 필요합니다.')
  }
  return { version: 'editweave-ai-activity-v1', id, status: 'running', createdAt: now, ...input }
}

export function finishAiActivity(record: AiActivityRecord, update: Pick<AiActivityRecord, 'status'> & Partial<Pick<AiActivityRecord, 'changes' | 'error'>>, now = new Date().toISOString()): AiActivityRecord {
  if (update.status === 'running') return record
  return { ...record, ...update, completedAt: now }
}

export function appendAiActivity(log: AiActivityRecord[], record: AiActivityRecord, limit = AI_ACTIVITY_LIMIT): AiActivityRecord[] {
  const next = [...log.filter((item) => item.id !== record.id), record].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  return next.slice(-Math.max(1, limit))
}

export function updateAiActivity(log: AiActivityRecord[], id: string, update: (record: AiActivityRecord) => AiActivityRecord): AiActivityRecord[] {
  return log.map((record) => record.id === id ? update(record) : record)
}

export function normalizeAiActivityLog(value: AiActivityRecord[] | undefined): AiActivityRecord[] {
  return (value ?? []).filter((record) => record?.version === 'editweave-ai-activity-v1'
    && typeof record.id === 'string'
    && typeof record.label === 'string'
    && Array.isArray(record.input?.dataCategories)
    && (record.processing?.location === 'local-device' || record.processing?.location === 'external-user-service'))
    .map((record) => record.status === 'running' ? { ...record, status: 'cancelled' as const, completedAt: record.completedAt ?? record.createdAt, error: record.error ?? '프로젝트가 닫혀 실행 완료 여부를 확인할 수 없습니다.' } : record)
    .slice(-AI_ACTIVITY_LIMIT)
}
