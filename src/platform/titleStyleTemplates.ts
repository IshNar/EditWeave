import type { CaptionStyle } from '../editor/types'

const STORAGE_KEY = 'editweave.title-style-templates.v1'

export interface TitleStyleTemplate {
  id: string
  name: string
  version: 'editweave-title-style-v1'
  createdAt: string
  style: CaptionStyle
}

export function readTitleStyleTemplates(): TitleStyleTemplate[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(isTitleStyleTemplate).slice(-200).map((template) => structuredClone(template)) : []
  } catch {
    return []
  }
}

export function writeTitleStyleTemplates(templates: TitleStyleTemplate[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates.slice(-200)))
}

export function createTitleStyleTemplate(name: string, style: CaptionStyle): TitleStyleTemplate {
  return { id: crypto.randomUUID(), name: name.trim() || '타이틀 스타일', version: 'editweave-title-style-v1', createdAt: new Date().toISOString(), style: structuredClone(style) }
}

export function serializeTitleStyleTemplate(template: TitleStyleTemplate): string {
  return JSON.stringify({ format: 'editweave-title-style', version: 1, template }, null, 2)
}

export function parseTitleStyleTemplate(raw: string): TitleStyleTemplate {
  const value: unknown = JSON.parse(raw)
  const candidate = value && typeof value === 'object' && 'template' in value ? (value as { template: unknown }).template : value
  if (!isTitleStyleTemplate(candidate)) throw new Error('지원되는 EditWeave 타이틀 스타일이 아닙니다.')
  return { ...structuredClone(candidate), id: crypto.randomUUID(), createdAt: new Date().toISOString() }
}

function isTitleStyleTemplate(value: unknown): value is TitleStyleTemplate {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<TitleStyleTemplate>
  return candidate.version === 'editweave-title-style-v1' && typeof candidate.id === 'string' && typeof candidate.name === 'string' && typeof candidate.createdAt === 'string' && Boolean(candidate.style && typeof candidate.style === 'object')
}
