import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installGlobalCrashCapture } from './platform/crashReport'
import { DesktopRenderConformanceProbe } from './reliability/DesktopRenderConformanceProbe'
import { DesktopStreamConformanceProbe } from './reliability/DesktopStreamConformanceProbe'
import type { DesktopStreamConformanceConfig } from './reliability/desktopStreamConformance'
import { invoke, isTauri } from '@tauri-apps/api/core'
import './styles.css'

installGlobalCrashCapture()

const queryMode = new URLSearchParams(window.location.search).get('cutline-conformance')
let desktopStreamConfig: DesktopStreamConformanceConfig | null = null
if (isTauri()) desktopStreamConfig = await invoke<DesktopStreamConformanceConfig | null>('desktop_stream_conformance_config').catch(() => null)
const rootView = queryMode === 'desktop-render' ? <DesktopRenderConformanceProbe /> : desktopStreamConfig ? <DesktopStreamConformanceProbe config={desktopStreamConfig} /> : <App />

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>{rootView}</ErrorBoundary>
  </StrictMode>,
)
