import { FileJson2, Network, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { MediaAsset } from '../editor/types'

interface ComfyDialogProps {
  open: boolean
  asset?: MediaAsset
  running: boolean
  progress: number
  stage: string
  error?: string
  externalProcessingAllowed: boolean
  onClose: () => void
  onExternalProcessingAllowedChange: (allowed: boolean) => void
  onRun: (endpoint: string, workflow: string) => void
  onCancel: () => void
}

const ENDPOINT_KEY = 'cutline.comfyui.endpoint'
const WORKFLOW_KEY = 'cutline.comfyui.workflow'

export function ComfyDialog({ open, asset, running, progress, stage, error, externalProcessingAllowed, onClose, onExternalProcessingAllowedChange, onRun, onCancel }: ComfyDialogProps) {
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:8188')
  const [workflow, setWorkflow] = useState('')
  const workflowInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setEndpoint(localStorage.getItem(ENDPOINT_KEY) || 'http://127.0.0.1:8188')
    setWorkflow(localStorage.getItem(WORKFLOW_KEY) || '')
  }, [open])

  if (!open) return null

  return <div className="modal-backdrop" role="presentation">
    <section className="comfy-dialog" role="dialog" aria-modal="true" aria-labelledby="comfy-title">
      <header><div><span className="eyebrow">COMFYUI BRIDGE</span><h2 id="comfy-title">선택 미디어를 ComfyUI로 보내기</h2></div><button className="icon-button" disabled={running} onClick={onClose} aria-label="ComfyUI 닫기"><X size={17} /></button></header>
      <div className="comfy-source"><Sparkles size={18} /><div><strong>{asset?.name ?? '선택 미디어 없음'}</strong><p>원본은 유지되며 마지막 출력 이미지를 새 미디어로 가져옵니다.</p></div></div>
      <div className="comfy-form">
        <label><span>ComfyUI 주소</span><input value={endpoint} disabled={running} onChange={(event) => setEndpoint(event.target.value)} /></label>
        <div className="comfy-workflow-heading"><span>API 형식 워크플로 JSON</span><button type="button" disabled={running} onClick={() => workflowInputRef.current?.click()}><FileJson2 size={12} /> JSON 불러오기</button></div>
        <input ref={workflowInputRef} hidden type="file" accept=".json,application/json" onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void file.text().then(setWorkflow)
          event.target.value = ''
        }} />
        <textarea value={workflow} disabled={running} onChange={(event) => setWorkflow(event.target.value)} placeholder={'ComfyUI에서 “Save (API Format)”으로 저장한 JSON을 붙여 넣으세요.\nLoadImage 노드가 자동으로 Cutline 입력 이미지로 교체됩니다.'} />
        <p className="comfy-note"><Network size={11} /> 선택 이미지와 워크플로가 위 주소의 별도 ComfyUI 프로세스로 전송됩니다. ComfyUI를 `--enable-cors-header` 옵션으로 실행해야 웹뷰에서 연결할 수 있습니다.</p>
        <label className="comfy-consent"><input type="checkbox" checked={externalProcessingAllowed} disabled={running} onChange={(event) => onExternalProcessingAllowedChange(event.target.checked)} /><span>전송 범위와 결과 이미지 보관에 동의합니다.</span></label>
        {error && <p className="export-error">{error}</p>}
        {running && <div className="export-progress"><div><span>{stage}</span><strong>{Math.round(progress * 100)}%</strong></div><progress max="1" value={progress} /></div>}
      </div>
      <footer>{running ? <button className="secondary-button" onClick={onCancel}>작업 취소</button> : <><button className="secondary-button" onClick={onClose}>닫기</button><button className="primary-button" disabled={!asset?.sourceFile || !workflow.trim() || !externalProcessingAllowed} onClick={() => {
        localStorage.setItem(ENDPOINT_KEY, endpoint.trim())
        localStorage.setItem(WORKFLOW_KEY, workflow)
        onRun(endpoint.trim(), workflow)
      }}><Sparkles size={14} /> 워크플로 실행</button></>}</footer>
    </section>
  </div>
}
