import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AUTOSAVE_KEY } from '../editor/project'
import { downloadCrashReports, flushCrashReportsIfConsented, hasCrashConsent, recordCrash, setCrashConsent } from '../platform/crashReport'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error?: Error
  consent: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { consent: hasCrashConsent() }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, consent: hasCrashConsent() }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Cutline UI crash', error, info.componentStack)
    recordCrash(error, info.componentStack ?? undefined)
    void flushCrashReportsIfConsented()
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <main className="crash-screen">
        <div className="brand"><span className="brand-mark">C</span><span>cutline</span></div>
        <span className="eyebrow">RECOVERY MODE</span>
        <h1>편집 화면을 복구하지 못했습니다.</h1>
        <p>자동 저장 프로젝트는 유지되어 있습니다. 먼저 앱을 다시 불러오고, 문제가 반복될 때만 마지막 자동 저장을 초기화하세요.</p>
        <code>{this.state.error.message}</code>
        <label className="crash-consent"><input type="checkbox" checked={this.state.consent} onChange={(event) => { const consent = event.target.checked; setCrashConsent(consent); this.setState({ consent }); if (consent) void flushCrashReportsIfConsented() }} /> 익명 오류 정보 자동 전송에 동의합니다. 미디어와 프로젝트 내용은 포함하지 않습니다.</label>
        <div>
          <button className="primary-button" onClick={() => window.location.reload()}>앱 다시 불러오기</button>
          <button className="secondary-button" onClick={downloadCrashReports}>오류 보고서 저장</button>
          <button className="secondary-button" onClick={() => {
            localStorage.removeItem(AUTOSAVE_KEY)
            window.location.reload()
          }}>마지막 자동 저장 초기화</button>
        </div>
      </main>
    )
  }
}
