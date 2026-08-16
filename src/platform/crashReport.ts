import { isTauri } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'

export interface CrashReport {
  schema: 'cutline-crash-v1'
  id: string
  occurredAt: string
  kind: 'react' | 'window' | 'promise'
  errorName: string
  message: string
  stack?: string
  componentStack?: string
  userAgent: string
  appVersion: string
  runtime: 'desktop' | 'browser'
  attempts: number
  nextAttemptAt?: string
}

type PublicCrashReport = Omit<CrashReport, 'attempts' | 'nextAttemptAt'>

const REPORT_KEY = 'cutline.crash-reports.v1'
const CONSENT_KEY = 'cutline.crash-consent.v1'
let flushing: Promise<void> | undefined
let lastSignature = ''
let lastRecordedAt = 0
let detectedAppVersion = clean((import.meta.env.VITE_CUTLINE_APP_VERSION as string | undefined) ?? '0.1.0', 80)

export function hasCrashConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'yes'
  } catch {
    return false
  }
}

export function setCrashConsent(consent: boolean): void {
  try {
    localStorage.setItem(CONSENT_KEY, consent ? 'yes' : 'no')
  } catch {
    // Consent is not persisted when storage is unavailable.
  }
  if (consent) void flushCrashReportsIfConsented()
}

export function recordCrash(error: Error, componentStack?: string, kind: CrashReport['kind'] = 'react'): CrashReport {
  const now = Date.now()
  const signature = `${kind}|${error.message}|${error.stack?.split('\n').slice(0, 3).join('\n') ?? ''}`
  const duplicate = signature === lastSignature && now - lastRecordedAt < 5_000
  lastSignature = signature
  lastRecordedAt = now
  const report: CrashReport = {
    schema: 'cutline-crash-v1',
    id: crypto.randomUUID(),
    occurredAt: new Date(now).toISOString(),
    kind,
    errorName: redactSensitive(error.name || 'Error', 120),
    message: redactSensitive(error.message || error.name || '알 수 없는 오류', 2_000),
    stack: redactSensitiveOptional(error.stack, 12_000),
    componentStack: redactSensitiveOptional(componentStack, 12_000),
    userAgent: clean(navigator.userAgent, 1_000),
    appVersion: detectedAppVersion,
    runtime: isTauri() ? 'desktop' : 'browser',
    attempts: 0,
  }
  if (!duplicate) writeReports([...readReports(), report].slice(-10))
  return report
}

export async function submitCrashIfConsented(report: CrashReport): Promise<void> {
  if (!hasCrashConsent()) return
  const endpoint = crashEndpoint()
  if (!endpoint) return
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cutline-schema': 'cutline-crash-v1' },
      body: JSON.stringify(publicReport(report)),
      cache: 'no-store',
      credentials: 'omit',
      keepalive: true,
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`충돌 수집 서버 응답 오류 (${response.status})`)
    writeReports(readReports().filter((item) => item.id !== report.id))
  } finally {
    window.clearTimeout(timeout)
  }
}

export function flushCrashReportsIfConsented(): Promise<void> {
  if (flushing) return flushing
  flushing = flushPending().finally(() => { flushing = undefined })
  return flushing
}

async function flushPending(): Promise<void> {
  if (!hasCrashConsent() || !crashEndpoint()) return
  const reports = readReports()
  for (const report of reports) {
    if (report.nextAttemptAt && new Date(report.nextAttemptAt).getTime() > Date.now()) continue
    try {
      await submitCrashIfConsented(report)
    } catch {
      const attempts = Math.min(10, report.attempts + 1)
      const delay = Math.min(24 * 60 * 60_000, 30_000 * 2 ** Math.min(8, attempts - 1))
      const current = readReports()
      writeReports(current.map((item) => item.id === report.id ? { ...item, attempts, nextAttemptAt: new Date(Date.now() + delay).toISOString() } : item))
    }
  }
}

export function installGlobalCrashCapture(): () => void {
  if (isTauri()) void getVersion().then((version) => { detectedAppVersion = clean(version, 80) }).catch(() => {})
  const onError = (event: ErrorEvent) => {
    const error = event.error instanceof Error ? event.error : new Error(event.message || '전역 스크립트 오류')
    recordCrash(error, undefined, 'window')
    void flushCrashReportsIfConsented()
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    const error = event.reason instanceof Error ? event.reason : new Error(typeof event.reason === 'string' ? event.reason : '처리되지 않은 Promise 오류')
    recordCrash(error, undefined, 'promise')
    void flushCrashReportsIfConsented()
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  void flushCrashReportsIfConsented()
  return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection) }
}

export function downloadCrashReports(): void {
  const contents = JSON.stringify(readReports(), null, 2)
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `cutline-crash-report-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function crashEndpoint(): string | undefined {
  const value = import.meta.env.VITE_CUTLINE_CRASH_ENDPOINT as string | undefined
  if (!value) return undefined
  try {
    const url = new URL(value, window.location.href)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !local) return undefined
    if (url.username || url.password || url.search || url.hash) return undefined
    return url.href
  } catch {
    return undefined
  }
}

function readReports(): CrashReport[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(REPORT_KEY) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.filter((item): item is CrashReport => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.occurredAt === 'string' && typeof item.message === 'string')).map((item) => ({
      ...item,
      schema: 'cutline-crash-v1' as const,
      errorName: typeof item.errorName === 'string' ? clean(item.errorName, 120) : 'Error',
      kind: (['react', 'window', 'promise'].includes(item.kind) ? item.kind : 'react') as CrashReport['kind'],
      runtime: (item.runtime === 'desktop' ? 'desktop' : 'browser') as CrashReport['runtime'],
      attempts: Math.max(0, Math.min(10, Number(item.attempts) || 0)),
    })).slice(-10)
  } catch {
    return []
  }
}

function writeReports(reports: CrashReport[]): void {
  try {
    localStorage.setItem(REPORT_KEY, JSON.stringify(reports.slice(-10)))
  } catch {
    // Crash persistence must never replace the original application error.
  }
}

function publicReport(report: CrashReport): PublicCrashReport {
  return {
    schema: 'cutline-crash-v1',
    id: report.id,
    occurredAt: report.occurredAt,
    kind: report.kind,
    errorName: redactSensitive(report.errorName, 120),
    message: redactSensitive(report.message, 2_000),
    stack: redactSensitiveOptional(report.stack, 12_000),
    componentStack: redactSensitiveOptional(report.componentStack, 12_000),
    userAgent: clean(report.userAgent, 1_000),
    appVersion: clean(report.appVersion, 80),
    runtime: report.runtime,
  }
}

function clean(value: string, maximum: number): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, maximum)
}

function cleanOptional(value: string | undefined, maximum: number): string | undefined {
  return value ? clean(value, maximum) : undefined
}

function redactSensitive(value: string, maximum: number): string {
  return clean(value, maximum)
    .replace(/file:\/\/\/?[^\s)'"<>]+/gi, '<local-file>')
    .replace(/\\\\[^\\/\s]+\\[^\s)'"<>]+/g, '<network-path>')
    .replace(/\b[A-Za-z]:[\\/][^\s)'"<>]+/g, '<local-path>')
    .replace(/\/(Users|home)\/[^/\s]+/g, '/$1/<user>')
    .replace(/https?:\/\/[^\s)'"<>]+/gi, (match) => safePublicUrl(match))
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<email>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/(["'])(?:(?!\1).){2,240}\1/g, '$1<value>$1')
    .slice(0, maximum)
}

function redactSensitiveOptional(value: string | undefined, maximum: number): string | undefined {
  return value ? redactSensitive(value, maximum) : undefined
}

function safePublicUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return '<url>'
  }
}
