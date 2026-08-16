import type { SequencePreset, TimelineTrack } from './types'

export const sequencePresets: SequencePreset[] = [
  { ratio: '16:9', width: 1920, height: 1080, label: 'YouTube' },
  { ratio: '9:16', width: 1080, height: 1920, label: 'Shorts' },
  { ratio: '4:5', width: 1080, height: 1350, label: 'Feed' },
  { ratio: '1:1', width: 1080, height: 1080, label: 'Square' },
]

export const initialTracks: TimelineTrack[] = [
  {
    id: 'video-main',
    name: 'V1 · 메인 영상',
    kind: 'video',
    sourceTarget: true,
    editTarget: true,
    muted: false,
    locked: false,
    syncLock: true,
    clips: [],
  },
  {
    id: 'audio-main',
    name: 'A1 · 원본 음성',
    kind: 'audio',
    sourceTarget: true,
    editTarget: true,
    muted: false,
    locked: false,
    syncLock: true,
    clips: [],
  },
  {
    id: 'caption-main',
    name: 'T1 · 자막',
    kind: 'caption',
    sourceTarget: true,
    editTarget: true,
    muted: false,
    locked: false,
    syncLock: true,
    clips: [],
  },
]

export function createInitialTracks(): TimelineTrack[] {
  return initialTracks.map((track) => ({ ...track, clips: [] }))
}
