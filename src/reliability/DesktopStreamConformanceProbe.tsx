import { useEffect, useState } from 'react'
import { runDesktopStreamConformance, type DesktopStreamConformanceConfig, type DesktopStreamConformanceReport } from './desktopStreamConformance'

let activeRun: Promise<DesktopStreamConformanceReport> | undefined

export function DesktopStreamConformanceProbe({ config }: { config: DesktopStreamConformanceConfig }) {
  const [report, setReport] = useState<DesktopStreamConformanceReport>()
  useEffect(() => {
    let active = true
    activeRun ??= runDesktopStreamConformance(config, (next) => { if (active) setReport(next) })
    void activeRun.then((next) => { if (active) setReport(next) })
    return () => { active = false }
  }, [config])
  return <main data-testid="desktop-stream-conformance" data-status={report?.status ?? 'running'} style={{ padding: 24, fontFamily: 'ui-monospace, monospace', background: '#101016', color: '#f4f1ff', minHeight: '100vh' }}>
    <h1>EditWeave Tauri Stream Conformance</h1>
    <p>{report?.stage ?? '준비 중'}</p>
    <pre>{JSON.stringify(report ?? { status: 'running' }, null, 2)}</pre>
  </main>
}
