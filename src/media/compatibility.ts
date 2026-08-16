import type { MediaAsset } from '../editor/types'

export type MediaHealthLevel = 'ready' | 'warning' | 'unsupported' | 'offline'

export interface MediaHealth {
  level: MediaHealthLevel
  label: string
  detail: string
}

export function assessMediaHealth(asset: MediaAsset): MediaHealth {
  if (asset.status === 'offline' && asset.proxyStatus === 'ready') return { level: 'warning', label: '프록시만', detail: '미리보기는 가능하지만 최종 출력에는 원본 재연결이 필요합니다.' }
  if (asset.status === 'offline') return { level: 'offline', label: '오프라인', detail: '같은 원본 파일을 다시 연결해야 합니다.' }
  if (asset.status === 'error') return { level: 'unsupported', label: '분석 실패', detail: asset.error ?? '지원 형식인지 확인하세요.' }
  if (asset.status === 'analyzing') return { level: 'warning', label: '분석 중', detail: '코덱과 편집 적합성을 확인하고 있습니다.' }
  if (asset.proxyStatus === 'queued' || asset.proxyStatus === 'creating') return { level: 'warning', label: '호환 변환 중', detail: `원본 기본 분석을 마쳤고 편집용 호환 미디어를 생성하고 있습니다${asset.proxyProgress === undefined ? '.' : ` · ${Math.round(asset.proxyProgress * 100)}%`}` }
  if (asset.proxyStatus === 'ready' && (asset.videoDecodable === false || asset.imageDecodable === false || Boolean(asset.audioCodec && asset.audioDecodable === false))) {
    return { level: 'warning', label: '호환 프록시', detail: `${asset.videoCodec ?? asset.audioCodec ?? '원본 코덱'}을 앱 코덱 엔진으로 변환한 프록시로 편집합니다. 최종 출력은 프록시 오디오·영상을 사용하며 원본 메타데이터는 프로젝트에 유지됩니다.` }
  }
  if (asset.kind === 'video' && asset.videoDecodable === false) {
    return { level: 'unsupported', label: '디코더 없음', detail: `${asset.videoCodec ?? '알 수 없는'} 영상 코덱을 이 기기에서 디코딩할 수 없습니다.` }
  }
  if (asset.kind === 'image' && asset.imageDecodable === false) {
    return { level: 'unsupported', label: '이미지 디코더 없음', detail: `${asset.extension?.toUpperCase() || asset.videoCodec || '전문 이미지'} 원본을 직접 표시할 수 없습니다. PNG 호환 프록시를 생성하세요.` }
  }
  if ((asset.kind === 'video' || asset.kind === 'audio') && asset.audioCodec && asset.audioDecodable === false) {
    return { level: 'warning', label: '오디오 제한', detail: `${asset.audioCodec} 오디오를 디코딩할 수 없어 무음으로 처리될 수 있습니다.` }
  }
  if (asset.kind === 'video' && asset.proxyTimecodeMismatch) {
    return { level: 'warning', label: '프록시 TC 불일치', detail: `원본 ${asset.sourceTimecode ?? '알 수 없음'} · 프록시 ${asset.proxyTimecode ?? '알 수 없음'}. 프록시를 다시 만들거나 원본으로 편집하세요.` }
  }
  if (asset.kind === 'video' && asset.variableFrameRate) {
    return { level: 'warning', label: 'VFR 감지', detail: `${asset.frameRate?.toFixed(2) ?? '?'} fps 평균 · 프레임 타이밍 편차 ${Math.round((asset.frameRateVariation ?? 0) * 100)}%. 30fps 프록시가 권장됩니다.` }
  }
  if ((asset.width ?? 0) > 3840 || (asset.height ?? 0) > 2160) {
    return { level: 'warning', label: '고해상도', detail: '4K를 넘는 원본입니다. 프록시 생성이 권장됩니다.' }
  }
  if (asset.duration >= 1800) {
    return { level: 'warning', label: '장시간', detail: '30분 이상 원본입니다. 안정적인 탐색과 편집을 위해 프록시 사용이 권장됩니다.' }
  }
  const codecs = [asset.videoCodec, asset.audioCodec].filter(Boolean).join(' / ')
  return { level: 'ready', label: '편집 준비', detail: codecs ? `${codecs} 디코딩 가능` : '이 기기에서 편집할 수 있습니다.' }
}
