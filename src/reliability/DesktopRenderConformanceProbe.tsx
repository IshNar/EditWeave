import { useEffect, useState } from 'react'
import { runDesktopRenderConformance, type DesktopRenderConformanceReport } from './desktopRenderConformance'

export function DesktopRenderConformanceProbe() {
  const [report, setReport] = useState<DesktopRenderConformanceReport | undefined>()
  useEffect(() => {
    let active = true
    void runDesktopRenderConformance().then((next) => { if (active) setReport(next) })
    return () => { active = false }
  }, [])
  const status = report?.status ?? 'running'
  return <main data-testid="desktop-render-conformance" data-status={status} style={{ padding: 24, fontFamily: 'ui-monospace, monospace', background: '#101016', color: '#f4f1ff', minHeight: '100vh' }}>
    <h1>EditWeave Desktop Render Conformance</h1>
    <p>{status === 'running' ? '실제 미리보기·출력 적합성을 측정하고 있습니다.' : status === 'passed' ? '통과' : status === 'blocked' ? '현재 WebView 기능으로 실행할 수 없습니다.' : '실패'}</p>
    <pre data-testid="desktop-render-conformance-report">{report ? JSON.stringify(report, null, 2) : JSON.stringify({ status: 'running' }, null, 2)}</pre>
  </main>
}
