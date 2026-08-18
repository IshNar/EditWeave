import { clipSourceTime } from '../editor/effects'
import { frameAlignmentError, frameIndexAtTime, timeAtFrame } from '../editor/frameMath'
import { createProjectDocument, getProjectSequences } from '../editor/project'
import type { EditWeaveProjectDocument, MediaAsset, TimelineClip, TimelineTrack, TrackKind } from '../editor/types'

export interface LongFormConformanceOptions {
  minutes: 10 | 30 | 60
  fps: number
  segmentSeconds?: number
}

export interface LongFormConformanceResult {
  minutes: number
  fps: number
  duration: number
  clipCount: number
  linkedPairCount: number
  brokenLinkCount: number
  maxFrameAlignmentError: number
  maxAvDriftFrames: number
  endFrame: number
}

const transform = { positionX: 0, positionY: 0, scale: 100, rotation: 0, opacity: 100 }

export function createLongFormConformanceProject(options: LongFormConformanceOptions): EditWeaveProjectDocument {
  const totalFrames = Math.round(options.minutes * 60 * options.fps)
  const segmentFrames = Math.max(1, Math.round((options.segmentSeconds ?? 5) * options.fps))
  const segments = Math.ceil(totalFrames / segmentFrames)
  const assetDuration = timeAtFrame(totalFrames * 2 + segmentFrames, options.fps)
  const assets: MediaAsset[] = [mediaAsset('long-video', 'Long Camera.mov', 'video', assetDuration, options.fps), mediaAsset('long-audio', 'Long Recorder.wav', 'audio', assetDuration, options.fps)]
  const video: TimelineClip[] = []
  const audio: TimelineClip[] = []
  const captions: TimelineClip[] = []
  const transcript = []
  for (let index = 0; index < segments; index++) {
    const startFrame = index * segmentFrames
    const durationFrames = Math.min(segmentFrames, totalFrames - startFrame)
    const start = timeAtFrame(startFrame, options.fps)
    const duration = timeAtFrame(durationFrames, options.fps)
    const sourceOffset = timeAtFrame(startFrame + index % 3 * 2, options.fps)
    const linkGroupId = `av-${index}`
    video.push(timelineClip(`video-${index}`, 'video-track', 'video', 'long-video', start, duration, sourceOffset, linkGroupId))
    audio.push(timelineClip(`audio-${index}`, 'audio-track', 'audio', 'long-audio', start, duration, sourceOffset, linkGroupId))
    captions.push(timelineClip(`caption-${index}`, 'caption-track', 'caption', undefined, start, duration, 0))
    transcript.push({ id: `transcript-${index}`, start, end: start + duration, text: `장시간 적합성 구간 ${index + 1}`, language: 'ko', speaker: index % 2 ? '화자 2' : '화자 1' })
  }
  const tracks: TimelineTrack[] = [timelineTrack('video-track', 'V1 · Long Camera', 'video', video), timelineTrack('audio-track', 'A1 · Long Recorder', 'audio', audio), timelineTrack('caption-track', 'T1 · Long Captions', 'caption', captions)]
  const project = createProjectDocument({
    id: `long-form-${options.minutes}m-${String(options.fps).replace('.', '_')}`, createdAt: '2026-08-15T00:00:00.000Z', name: `${options.minutes}분 장시간 적합성`, aspectRatio: '16:9', assets, tracks, transcript,
    markers: Array.from({ length: options.minutes + 1 }, (_, minute) => ({ id: `minute-${minute}`, time: Math.min(minute * 60, timeAtFrame(totalFrames, options.fps)), label: `${minute}:00`, color: '#8169e8', kind: 'edit' as const })),
  })
  project.sequence.fps = options.fps
  project.sequences = project.sequences?.map((sequence) => ({ ...sequence, fps: options.fps }))
  return project
}

export function evaluateLongFormConformance(project: EditWeaveProjectDocument): LongFormConformanceResult {
  const sequence = getProjectSequences(project).find((item) => item.id === project.activeSequenceId) ?? getProjectSequences(project)[0]
  const clips = sequence.tracks.flatMap((track) => track.clips)
  const byLink = new Map<string, TimelineClip[]>()
  let maxFrameError = 0
  for (const clip of clips) {
    maxFrameError = Math.max(maxFrameError, frameAlignmentError(clip.start, sequence.fps), frameAlignmentError(clip.duration, sequence.fps), frameAlignmentError(clip.sourceOffset, sequence.fps))
    if (clip.linkGroupId) byLink.set(clip.linkGroupId, [...(byLink.get(clip.linkGroupId) ?? []), clip])
  }
  let brokenLinkCount = 0
  let maxAvDriftFrames = 0
  for (const linked of byLink.values()) {
    const video = linked.find((clip) => clip.kind === 'video')
    const audio = linked.find((clip) => clip.kind === 'audio')
    if (!video || !audio) { brokenLinkCount++; continue }
    for (const progress of [0, 0.5, 1]) {
      const videoTime = video.start + video.duration * progress
      const audioTime = audio.start + audio.duration * progress
      const timelineDrift = Math.abs(frameIndexAtTime(videoTime, sequence.fps) - frameIndexAtTime(audioTime, sequence.fps))
      const sourceDrift = Math.abs(frameIndexAtTime(clipSourceTime(video, videoTime), sequence.fps) - frameIndexAtTime(clipSourceTime(audio, audioTime), sequence.fps))
      maxAvDriftFrames = Math.max(maxAvDriftFrames, timelineDrift, sourceDrift)
    }
  }
  const duration = Math.max(0, ...clips.map((clip) => clip.start + clip.duration))
  return {
    minutes: Math.round(duration / 60), fps: sequence.fps, duration, clipCount: clips.length, linkedPairCount: byLink.size, brokenLinkCount,
    maxFrameAlignmentError: maxFrameError, maxAvDriftFrames, endFrame: frameIndexAtTime(duration, sequence.fps),
  }
}

function mediaAsset(id: string, name: string, kind: MediaAsset['kind'], duration: number, fps: number): MediaAsset {
  return { id, name, kind, url: `memory:${id}`, duration, size: 1_000_000_000, extension: kind === 'audio' ? 'wav' : 'mov', frameRate: fps, sampleRate: kind === 'audio' ? 48_000 : undefined, channels: kind === 'audio' ? 2 : undefined, status: 'ready' }
}

function timelineClip(id: string, trackId: string, kind: TrackKind, assetId: string | undefined, start: number, duration: number, sourceOffset: number, linkGroupId?: string): TimelineClip {
  return { id, trackId, kind, assetId, name: id, start, duration, sourceOffset, linkGroupId, color: '#777777', transform }
}

function timelineTrack(id: string, name: string, kind: TrackKind, clips: TimelineClip[]): TimelineTrack {
  return { id, name, kind, sourceTarget: true, editTarget: true, muted: false, locked: false, syncLock: true, clips }
}
