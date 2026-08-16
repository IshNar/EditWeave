import type { TimelineTrack } from './types'

export type TimelinePerformanceLevel = 'ready' | 'warning' | 'heavy'

export interface TimelinePerformanceHealth {
  level: TimelinePerformanceLevel
  label: string
  detail: string
  duration: number
  clipCount: number
}

export function assessTimelinePerformance(tracks: TimelineTrack[]): TimelinePerformanceHealth {
  const clips = tracks.flatMap((track) => track.clips)
  const duration = Math.max(0, ...clips.map((clip) => clip.start + clip.duration))
  const clipCount = clips.length
  if (duration >= 3600 || clipCount >= 5000) {
    return { level: 'heavy', label: '장시간 프로젝트', detail: `${Math.round(duration / 60)}분 · ${clipCount.toLocaleString()}클립. 프록시와 구간별 렌더를 권장합니다.`, duration, clipCount }
  }
  if (duration >= 1800 || clipCount >= 1000) {
    return { level: 'warning', label: '성능 주의', detail: `${Math.round(duration / 60)}분 · ${clipCount.toLocaleString()}클립. 메모리 사용량을 관찰하세요.`, duration, clipCount }
  }
  return { level: 'ready', label: '미디어 엔진 준비됨', detail: `${Math.round(duration)}초 · ${clipCount.toLocaleString()}클립`, duration, clipCount }
}
