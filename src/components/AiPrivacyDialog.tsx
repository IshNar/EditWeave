import { Cpu, HardDrive, Network, ShieldCheck, X } from 'lucide-react'
import type { AiPrivacySettings } from '../platform/aiPrivacy'

interface AiPrivacyDialogProps {
  open: boolean
  settings: AiPrivacySettings
  onChange: (settings: AiPrivacySettings) => void
  onClose: () => void
}

const localFeatures = [
  ['전사·자막', '선택한 영상/오디오', '로컬 Whisper 모델 · 결과는 프로젝트에 저장'],
  ['장면 감지·초벌 제안', '축소 프레임·대본·선택한 유지율 CSV', '로컬 다국어 의미 모델과 앱 메모리에서 분석 · 임베딩/피드백은 프로젝트에 저장 · 제안은 승인 전 미적용'],
  ['배경 제거·얼굴/물체 추적', '선택 이미지 또는 선택 클립 프레임', '로컬 모델/브라우저 연산 · 결과 마스크와 새 PNG만 저장'],
  ['쇼츠 자동 리프레임', '원본 구간과 얼굴 표본', '로컬 분석 · 파생 시퀀스에 참조와 결과 저장'],
] as const

export function AiPrivacyDialog({ open, settings, onChange, onClose }: AiPrivacyDialogProps) {
  if (!open) return null
  return <div className="modal-backdrop"><section className="ai-privacy-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-privacy-title">
    <header><div><span className="eyebrow">AI DATA CONTROL</span><h2 id="ai-privacy-title">AI 처리 위치와 데이터 보관</h2></div><button className="icon-button" onClick={onClose} aria-label="AI 데이터 설정 닫기"><X size={17} /></button></header>
    <div className="ai-privacy-summary"><ShieldCheck size={22} /><div><strong>EditWeave AI는 기본적으로 로컬 처리입니다.</strong><p>외부 전송 기능은 별도 동의가 없으면 실행되지 않습니다.</p></div></div>
    <div className="ai-feature-list">{localFeatures.map(([name, input, retention]) => <article key={name}><Cpu size={15} /><div><strong>{name}</strong><span>입력: {input}</span><small><HardDrive size={11} /> {retention}</small></div><b>LOCAL</b></article>)}</div>
    <p className="privacy-note">각 AI 실행의 입력 범주, 처리 위치, 추천 이유, 변경 결과와 복구 방법은 최대 250건까지 프로젝트의 AI 활동 기록에 저장됩니다. 원본 미디어 내용이나 외부 서버 주소는 기록에 복제하지 않습니다.</p>
    <section className="ai-external-consent"><div><Cpu size={17} /><div><strong>한국어 전사 품질</strong><p>모든 모델은 기기에서 실행되고 첫 사용 후 로컬 캐시에 보관됩니다. 정확 우선은 다운로드·메모리·처리 시간이 가장 큽니다.</p></div></div><label><span>로컬 Whisper 모델</span><select value={settings.transcriptionQuality} onChange={(event) => onChange({ ...settings, transcriptionQuality: event.target.value as AiPrivacySettings['transcriptionQuality'] })}><option value="fast">빠른 초벌 · Whisper Tiny</option><option value="balanced">균형 · Whisper Base</option><option value="accurate">정확 우선 · Whisper Small</option></select></label></section>
    <section className="ai-external-consent"><div><Network size={17} /><div><strong>선택적 ComfyUI 브리지</strong><p>선택 이미지와 사용자가 입력한 워크플로 JSON을 설정한 ComfyUI 주소로 전송합니다. 주소가 127.0.0.1이어도 EditWeave 밖의 별도 프로세스이며, ComfyUI의 노드가 외부 API를 호출할 수 있습니다. 마지막 결과 이미지는 새 프로젝트 미디어로 보관됩니다.</p></div></div><label><input type="checkbox" checked={settings.externalComfyUiAllowed} onChange={(event) => onChange({ ...settings, externalComfyUiAllowed: event.target.checked })} /><span>위 범위의 ComfyUI 전송을 허용합니다.</span></label></section>
    {settings.updatedAt && <small className="ai-consent-time">마지막 동의 변경: {new Date(settings.updatedAt).toLocaleString('ko-KR')}</small>}
    <footer><button className="primary-button" onClick={onClose}>설정 저장</button></footer>
  </section></div>
}
