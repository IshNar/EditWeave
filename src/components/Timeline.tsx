import { ArrowDown, ArrowUp, Captions, ClipboardPaste, Copy, CopyPlus, Eye, EyeOff, Flag, Hand, Headphones, Layers3, Link2, Lock, Magnet, Minus, MousePointer2, Music2, Plus, Repeat2, Scissors, Search, SlidersHorizontal, Trash2, Type, Unlink, Unlock, Video, Volume2, VolumeX, X, ZoomIn } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { clamp, formatTimecode, parseTimelineTimecode } from '../editor/format'
import { snapTimeToFrame } from '../editor/frameMath'
import { clipPlaybackRate, clipPlaybackRateAtLocal, defaultAudioAdjustment, resolveClipAudioMix, resolveClipTransform, resolveTrackAudioMix } from '../editor/effects'
import type { TimelinePerformanceHealth } from '../editor/performance'
import type { AudioAdjustment, AudioMixKeyframe, ClipMarker, EditMode, EditorTool, MediaAsset, SpeedKeyframe, TimelineClip, TimelineMarker, TimelineTrack, TitleTemplate, TrackKind, TrackMixKeyframe, TransformKeyframe, TrimMode } from '../editor/types'
import { formatMediaTimecode, parseMediaTimecode } from '../media/timecode'

interface TimelineProps {
  tracks: TimelineTrack[]
  assets: MediaAsset[]
  selectedClipId?: string
  selectedClipIds: ReadonlySet<string>
  selectedClipLocked?: boolean
  performanceHealth: TimelinePerformanceHealth
  markers: TimelineMarker[]
  editMode: EditMode
  activeTool: EditorTool
  trimMode: TrimMode
  snapEnabled: boolean
  linkedSelectionEnabled: boolean
  selectionFollowsPlayhead: boolean
  selectedTrackId?: string
  playhead: number
  duration: number
  fps: number
  timecodeStart: number
  timecodeDropFrame: boolean
  workArea?: { start: number; end: number }
  loopWorkArea: boolean
  zoom: number
  onZoomChange: (zoom: number) => void
  onSelectClip: (id: string, additive: boolean) => void
  onSelectClips: (ids: string[], additive: boolean) => void
  onSeek: (time: number) => void
  onMarkWorkAreaIn: () => void
  onMarkWorkAreaOut: () => void
  onUpdateWorkArea: (range: { start: number; end: number } | undefined) => void
  onToggleWorkAreaLoop: () => void
  onLiftWorkArea: () => void
  onExtractWorkArea: () => void
  onMoveClip: (id: string, start: number, targetTrackId?: string) => void
  onTrimClip: (id: string, edge: 'start' | 'end', time: number) => void
  onUpdateClip: (id: string, patch: Partial<TimelineClip>) => void
  onSplit: () => void
  onAddEditTarget: () => void
  onAddEditAll: () => void
  onSelectTrackForward: () => void
  onSelectTrackBackward: () => void
  onSelectAllTracksForward: () => void
  onSelectAllTracksBackward: () => void
  onSeekPreviousEdit: () => void
  onSeekNextEdit: () => void
  onDelete: () => void
  onToggleSelectedClipsEnabled: () => void
  onSetSelectedClipsColor: (color: string) => void
  onRippleDelete: () => void
  onCloseGap: () => void
  onCut: () => void
  onCopy: () => void
  onPaste: () => void
  onPasteAttributes: () => void
  onDuplicate: () => void
  onArrangeSelectedClips: (mode: 'align-start' | 'align-end' | 'align-playhead' | 'distribute' | 'remove-gaps') => void
  onMatchSelectedLoudness: (targetLufs: number) => void
  canPaste: boolean
  canPasteAttributes: boolean
  onToggleTrackMute: (id: string) => void
  onToggleTrackLock: (id: string) => void
  onToggleTrackSyncLock: (id: string) => void
  onToggleTrackVisibility: (id: string) => void
  onToggleTrackSolo: (id: string) => void
  onToggleTrackTarget: (id: string) => void
  onToggleTrackEditTarget: (id: string) => void
  onSetAllTrackEditTargets: (enabled: boolean) => void
  onSetAllTrackSyncLocks: (enabled: boolean) => void
  onSetTrackHeight: (id: string, height: number) => void
  onSetAllTrackHeights: (height: number) => void
  onSelectTrack: (id: string) => void
  onUpdateTrack: (id: string, patch: Partial<TimelineTrack>) => void
  onUpdateTrackTransient: (id: string, patch: Partial<TimelineTrack>) => void
  onUpdateClipTransient: (id: string, patch: Partial<TimelineClip>) => void
  onEditModeChange: (mode: EditMode) => void
  onToolChange: (tool: EditorTool) => void
  onTrimModeChange: (mode: TrimMode) => void
  onToggleSnap: () => void
  onToggleLinkedSelection: () => void
  onToggleSelectionFollowsPlayhead: () => void
  onSelectEditPoint: () => void
  onAddTrack: (kind: TrackKind) => void
  onRemoveTrack: (id: string) => void
  onMoveTrack: (id: string, direction: -1 | 1) => void
  onDuplicateTrack: (id: string) => void
  onAddMarker: () => void
  onAddClipMarker: () => void
  onMatchFrame: () => void
  onUpdateClipMarker: (clipId: string, markerId: string, patch: Partial<ClipMarker>) => void
  onRemoveClipMarker: (clipId: string, markerId: string) => void
  onAddRangeMarker: (start: number, end: number, kind: TimelineMarker['kind']) => void
  onUpdateMarker: (id: string, patch: Partial<TimelineMarker>) => void
  onRemoveMarker: (id: string) => void
  onLinkClips: () => void
  onUnlinkClip: () => void
  onGroupClips: () => void
  onUngroupClip: () => void
  onAddAdjustmentLayer: () => void
  onAddTitle: (template: TitleTemplate) => void
  onNestActiveClips: () => void
  onOpenNestedSequence: (sequenceId: string) => void
  onDetachAudio: () => void
  onRenderAndReplace: () => void
  onCancelRenderAndReplace: () => void
  onRestoreRenderedClip: () => void
  renderReplacing: boolean
  renderReplaceProgress: number
  renderReplaceStage: string
  onCreateMulticam: () => void
  onSwitchMulticamAngle: (angle: number) => void
  multicamAngleCount: number
  onSwitchMulticamAudioAngle: (angle: number) => void
  multicamAudioAngles: number[]
  onSyncByWaveform: () => void
  onSyncByClap: () => void
  onSyncByTimecode: () => void
  onRazorClip: (id: string, time: number) => void
}

const trackIcons = { video: Video, audio: Music2, caption: Captions }

type TrackAutomationView = 'none' | 'volume' | 'pan'
const automationEasings: TransformKeyframe['easing'][] = ['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out', 'bezier']
const nextAutomationEasing = (current: TransformKeyframe['easing']) => automationEasings[(automationEasings.indexOf(current) + 1) % automationEasings.length]
let trackAutomationClipboard: { keyframes: TrackMixKeyframe[]; span: number } | undefined

function scalarKeyframeKeepIds<T extends { id: string; time: number; easing?: string }>(keyframes: T[], value: (keyframe: T) => number, tolerance: number): Set<string> {
  if (keyframes.length <= 2) return new Set(keyframes.map((keyframe) => keyframe.id))
  const kept = new Set<string>([keyframes[0].id, keyframes[keyframes.length - 1].id])
  const visit = (start: number, end: number) => {
    if (end - start <= 1) return
    const first = keyframes[start]
    const last = keyframes[end]
    const span = Math.max(.000001, last.time - first.time)
    let furthestIndex = -1
    let furthestError = tolerance
    for (let index = start + 1; index < end; index += 1) {
      if (keyframes[index].easing === 'hold' || keyframes[index].easing === 'bezier') {
        furthestIndex = index
        furthestError = Number.POSITIVE_INFINITY
        break
      }
      const progress = clamp((keyframes[index].time - first.time) / span, 0, 1)
      const expected = value(first) + (value(last) - value(first)) * progress
      const error = Math.abs(value(keyframes[index]) - expected)
      if (error > furthestError) { furthestError = error; furthestIndex = index }
    }
    if (furthestIndex < 0) return
    kept.add(keyframes[furthestIndex].id)
    visit(start, furthestIndex)
    visit(furthestIndex, end)
  }
  visit(0, keyframes.length - 1)
  return kept
}

function TrackAutomationEnvelope({ track, view, pixelsPerSecond, duration, fps, playhead, snapEnabled, snapTargets, locked, onSnapGuide, onUpdate, onUpdateTransient, onSeek }: {
  track: TimelineTrack
  view: Exclude<TrackAutomationView, 'none'>
  pixelsPerSecond: number
  duration: number
  fps: number
  playhead: number
  snapEnabled: boolean
  snapTargets: number[]
  locked: boolean
  onSnapGuide: (time?: number) => void
  onUpdate: (patch: Partial<TimelineTrack>) => void
  onUpdateTransient: (patch: Partial<TimelineTrack>) => void
  onSeek: (time: number) => void
}) {
  const laneHeight = clamp(track.displayHeight ?? 64, 40, 180)
  const padding = 7
  const [draft, setDraft] = useState(track.mixKeyframes ?? [])
  const draftRef = useRef(track.mixKeyframes ?? [])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [selectionBox, setSelectionBox] = useState<CSSProperties>()
  const [, setClipboardRevision] = useState(0)
  useEffect(() => {
    const next = track.mixKeyframes ?? []
    setDraft(next)
    draftRef.current = next
  }, [track.mixKeyframes])
  useEffect(() => { setSelectedIds(new Set()) }, [track.id, view])
  const selectPoint = (id: string, event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    let next: Set<string>
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      next = new Set(selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
    } else next = selectedIds.has(id) ? new Set(selectedIds) : new Set([id])
    setSelectedIds(next)
    return next.has(id) ? next : new Set([id])
  }
  const valueToY = (keyframe: Pick<TrackMixKeyframe, 'volume' | 'pan'>) => {
    const progress = view === 'volume' ? clamp(keyframe.volume / 200, 0, 1) : clamp((keyframe.pan + 100) / 200, 0, 1)
    return padding + (1 - progress) * Math.max(1, laneHeight - padding * 2)
  }
  const valueFromY = (clientY: number, bounds: DOMRect) => {
    const progress = clamp(1 - (clientY - bounds.top - padding) / Math.max(1, bounds.height - padding * 2), 0, 1)
    return view === 'volume' ? progress * 200 : progress * 200 - 100
  }
  const sorted = useMemo(() => [...draft].sort((left, right) => left.time - right.time), [draft])
  const snapTrackAutomationTime = (proposed: number, temporarilyDisabled: boolean) => {
    const frameTime = clamp(Math.round(proposed * fps) / Math.max(1, fps), 0, duration)
    if (!snapEnabled || temporarilyDisabled) return { time: frameTime, guide: undefined as number | undefined }
    const threshold = 8 / Math.max(1, pixelsPerSecond)
    let time = frameTime
    let guide: number | undefined
    let bestDistance = threshold
    for (const target of snapTargets) {
      const distance = Math.abs(frameTime - target)
      if (distance < bestDistance && target >= 0 && target <= duration) {
        time = Math.round(target * fps) / Math.max(1, fps)
        guide = target
        bestDistance = distance
      }
    }
    return { time, guide }
  }
  const points = useMemo(() => {
    const valueY = (mix: { volume: number; pan: number }) => {
      const progress = view === 'volume' ? clamp(mix.volume / 200, 0, 1) : clamp((mix.pan + 100) / 200, 0, 1)
      return padding + (1 - progress) * Math.max(1, laneHeight - padding * 2)
    }
    const baseMix = resolveTrackAudioMix(track, 0)
    const sampledTrack = { ...track, mixAutomationMode: sorted.length ? 'read' as const : track.mixAutomationMode, mixKeyframes: sorted }
    const sampleCount = Math.min(600, Math.max(2, Math.ceil(duration * pixelsPerSecond / 18)))
    const linePoints = sorted.length
      ? Array.from({ length: sampleCount + 1 }, (_, index) => { const time = duration * index / sampleCount; return { time, ...resolveTrackAudioMix(sampledTrack, time) } })
      : [{ time: 0, ...baseMix }, { time: duration, ...baseMix }]
    return linePoints.map((keyframe) => `${keyframe.time * pixelsPerSecond},${valueY(keyframe)}`).join(' ')
  }, [duration, laneHeight, pixelsPerSecond, sorted, track, view])
  const addPoint = (event: ReactMouseEvent<SVGPolylineElement>) => {
    if (locked) return
    event.preventDefault()
    event.stopPropagation()
    const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
    if (!bounds) return
    const time = snapTrackAutomationTime((event.clientX - bounds.left) / pixelsPerSecond, false).time
    const mix = resolveTrackAudioMix({ ...track, mixAutomationMode: 'read', mixKeyframes: draftRef.current }, time)
    const value = valueFromY(event.clientY, bounds)
    const point: TrackMixKeyframe = { id: crypto.randomUUID(), time, volume: view === 'volume' ? value : mix.volume, pan: view === 'pan' ? value : mix.pan, easing: 'ease-in-out' }
    const next = [...draftRef.current.filter((keyframe) => Math.abs(keyframe.time - time) > 1 / Math.max(1, fps)), point].sort((left, right) => left.time - right.time)
    draftRef.current = next
    setDraft(next)
    onUpdate({ mixAutomationMode: track.mixAutomationMode === 'off' ? 'read' : track.mixAutomationMode ?? 'read', mixKeyframes: next })
    onSeek(time)
  }
  const beginMove = (keyframe: TrackMixKeyframe, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (locked || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const movingIds = selectPoint(keyframe.id, event)
    const origins = new Map(draftRef.current.filter((candidate) => movingIds.has(candidate.id)).map((candidate) => [candidate.id, candidate]))
    const minimumTime = Math.min(...[...origins.values()].map((candidate) => candidate.time))
    const maximumTime = Math.max(...[...origins.values()].map((candidate) => candidate.time))
    const originValues = [...origins.values()].map((candidate) => view === 'volume' ? candidate.volume : candidate.pan)
    const minimumValue = Math.min(...originValues)
    const maximumValue = Math.max(...originValues)
    const lane = event.currentTarget.closest<HTMLElement>('.track-lane')
    if (!lane) return
    const bounds = lane.getBoundingClientRect()
    const pointerId = event.pointerId
    let moved = false
    let committed = false
    event.currentTarget.setPointerCapture(pointerId)
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      moved = true
      const snapped = snapTrackAutomationTime((moveEvent.clientX - bounds.left) / pixelsPerSecond, moveEvent.altKey)
      const requestedDelta = snapped.time - keyframe.time
      const deltaTime = clamp(requestedDelta, -minimumTime, duration - maximumTime)
      onSnapGuide(Math.abs(deltaTime - requestedDelta) < .5 / Math.max(1, fps) ? snapped.guide : undefined)
      const value = valueFromY(moveEvent.clientY, bounds)
      const requestedValueDelta = view === 'volume' ? value - keyframe.volume : value - keyframe.pan
      const valueDelta = view === 'volume' ? clamp(requestedValueDelta, -minimumValue, 200 - maximumValue) : clamp(requestedValueDelta, -100 - minimumValue, 100 - maximumValue)
      const next = draftRef.current.map((candidate) => {
        const origin = origins.get(candidate.id)
        if (!origin) return candidate
        return view === 'volume'
          ? { ...candidate, time: origin.time + deltaTime, volume: clamp(origin.volume + valueDelta, 0, 200) }
          : { ...candidate, time: origin.time + deltaTime, pan: clamp(origin.pan + valueDelta, -100, 100) }
      }).sort((left, right) => left.time - right.time)
      draftRef.current = next
      setDraft(next)
      const mixAutomationMode: TimelineTrack['mixAutomationMode'] = track.mixAutomationMode === 'off' ? 'read' : track.mixAutomationMode ?? 'read'
      const patch = { mixAutomationMode, mixKeyframes: next }
      if (!committed) { committed = true; onUpdate(patch) }
      else onUpdateTransient(patch)
    }
    const stop = (stopEvent: PointerEvent) => {
      if (stopEvent.pointerId !== pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      onSnapGuide(undefined)
      if (event.currentTarget.hasPointerCapture(pointerId)) event.currentTarget.releasePointerCapture(pointerId)
      if (!moved) onSeek(keyframe.time)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }
  const removePoint = (keyframe: TrackMixKeyframe, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (locked) return
    event.preventDefault()
    event.stopPropagation()
    const removeIds = selectedIds.has(keyframe.id) ? selectedIds : new Set([keyframe.id])
    const next = draftRef.current.filter((candidate) => !removeIds.has(candidate.id))
    draftRef.current = next
    setDraft(next)
    setSelectedIds(new Set())
    onUpdate({ mixKeyframes: next.length ? next : undefined, mixAutomationMode: next.length ? track.mixAutomationMode ?? 'read' : 'off' })
  }
  const cyclePointEasing = (keyframe: TrackMixKeyframe, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (locked) return
    event.preventDefault()
    event.stopPropagation()
    const changeIds = selectedIds.has(keyframe.id) ? selectedIds : new Set([keyframe.id])
    const next = draftRef.current.map((candidate) => changeIds.has(candidate.id) ? { ...candidate, easing: nextAutomationEasing(candidate.easing) } : candidate)
    draftRef.current = next
    setDraft(next)
    onUpdate({ mixAutomationMode: track.mixAutomationMode === 'off' ? 'read' : track.mixAutomationMode ?? 'read', mixKeyframes: next })
  }
  const applyTrackAutomationOperation = (operation: 'reverse-time' | 'distribute-time' | 'reverse-values') => {
    const selected = draftRef.current.filter((keyframe) => selectedIds.has(keyframe.id)).sort((left, right) => left.time - right.time)
    if (locked || selected.length < 2) return
    let next: TrackMixKeyframe[]
    if (operation === 'reverse-values') {
      const reversed = [...selected].reverse()
      const payloadById = new Map(selected.map((keyframe, index) => [keyframe.id, { volume: reversed[index].volume, pan: reversed[index].pan }]))
      next = draftRef.current.map((keyframe) => payloadById.has(keyframe.id) ? { ...keyframe, ...payloadById.get(keyframe.id)! } : keyframe)
    } else {
      const firstTime = selected[0].time
      const lastTime = selected[selected.length - 1].time
      const uniqueTimes = [...new Set(selected.map((keyframe) => keyframe.time))]
      const distributed = new Map(uniqueTimes.map((time, index) => [time, uniqueTimes.length < 2 ? time : Math.round((firstTime + (lastTime - firstTime) * index / (uniqueTimes.length - 1)) * fps) / fps]))
      next = draftRef.current.map((keyframe) => {
        if (!selectedIds.has(keyframe.id)) return keyframe
        return { ...keyframe, time: operation === 'reverse-time' ? Math.round((firstTime + lastTime - keyframe.time) * fps) / fps : distributed.get(keyframe.time) ?? keyframe.time }
      }).sort((left, right) => left.time - right.time)
    }
    draftRef.current = next
    setDraft(next)
    onUpdate({ mixAutomationMode: track.mixAutomationMode === 'off' ? 'read' : track.mixAutomationMode ?? 'read', mixKeyframes: next })
  }
  const applyTrackValueOperation = (operation: 'compress' | 'expand' | 'mirror-pan' | 'normalize' | 'flatten') => {
    const selected = draftRef.current.filter((keyframe) => selectedIds.has(keyframe.id))
    if (locked || !selected.length || (operation === 'compress' || operation === 'expand' || operation === 'flatten') && selected.length < 2) return
    const factor = operation === 'compress' ? .8 : 1.25
    const center = view === 'volume'
      ? selected.reduce((sum, keyframe) => sum + keyframe.volume, 0) / selected.length
      : selected.reduce((sum, keyframe) => sum + keyframe.pan, 0) / selected.length
    const normalizationPeak = view === 'volume' ? Math.max(...selected.map((item) => item.volume)) : Math.max(...selected.map((item) => Math.abs(item.pan)))
    const next = draftRef.current.map((keyframe) => {
      if (!selectedIds.has(keyframe.id)) return keyframe
      if (operation === 'mirror-pan') return { ...keyframe, pan: clamp(-keyframe.pan, -100, 100) }
      if (operation === 'flatten') return view === 'volume' ? { ...keyframe, volume: center } : { ...keyframe, pan: center }
      if (operation === 'normalize') {
        if (view === 'volume') {
          return { ...keyframe, volume: normalizationPeak > .0001 ? clamp(keyframe.volume * 100 / normalizationPeak, 0, 200) : keyframe.volume }
        }
        return { ...keyframe, pan: normalizationPeak > .0001 ? clamp(keyframe.pan * 100 / normalizationPeak, -100, 100) : keyframe.pan }
      }
      return view === 'volume'
        ? { ...keyframe, volume: clamp(center + (keyframe.volume - center) * factor, 0, 200) }
        : { ...keyframe, pan: clamp(center + (keyframe.pan - center) * factor, -100, 100) }
    })
    draftRef.current = next
    setDraft(next)
    onUpdate({ mixAutomationMode: track.mixAutomationMode === 'off' ? 'read' : track.mixAutomationMode ?? 'read', mixKeyframes: next })
  }
  const processTrackAutomation = (operation: 'smooth' | 'thin') => {
    const selected = draftRef.current.filter((keyframe) => selectedIds.has(keyframe.id)).sort((left, right) => left.time - right.time)
    if (locked || selected.length < 3) return
    let next: TrackMixKeyframe[]
    let nextSelection = selectedIds
    if (operation === 'thin') {
      const keptIds = scalarKeyframeKeepIds(selected, (keyframe) => view === 'volume' ? keyframe.volume : keyframe.pan, view === 'volume' ? 1 : 1.5)
      next = draftRef.current.filter((keyframe) => !selectedIds.has(keyframe.id) || keptIds.has(keyframe.id))
      nextSelection = keptIds
    } else {
      const values = new Map(selected.map((keyframe, index) => {
        const previous = selected[Math.max(0, index - 1)]
        const following = selected[Math.min(selected.length - 1, index + 1)]
        const value = view === 'volume'
          ? (previous.volume + keyframe.volume * 2 + following.volume) / 4
          : (previous.pan + keyframe.pan * 2 + following.pan) / 4
        return [keyframe.id, value]
      }))
      next = draftRef.current.map((keyframe) => !values.has(keyframe.id) ? keyframe : view === 'volume' ? { ...keyframe, volume: clamp(values.get(keyframe.id)!, 0, 200) } : { ...keyframe, pan: clamp(values.get(keyframe.id)!, -100, 100) })
    }
    draftRef.current = next
    setDraft(next)
    setSelectedIds(new Set(nextSelection))
    onUpdate({ mixAutomationMode: track.mixAutomationMode === 'off' ? 'read' : track.mixAutomationMode ?? 'read', mixKeyframes: next })
  }
  const beginSelectionBox = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (locked || event.button !== 0 || !event.shiftKey) return
    event.preventDefault()
    event.stopPropagation()
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!bounds) return
    const startX = clamp(event.clientX - bounds.left, 0, bounds.width)
    const startY = clamp(event.clientY - bounds.top, 0, bounds.height)
    const additive = event.ctrlKey || event.metaKey
    const timeOnly = event.altKey
    let latest = { left: startX, top: startY, width: 0, height: 0 }
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return
      const x = clamp(moveEvent.clientX - bounds.left, 0, bounds.width)
      const y = clamp(moveEvent.clientY - bounds.top, 0, bounds.height)
      latest = timeOnly
        ? { left: Math.min(startX, x), top: 0, width: Math.abs(x - startX), height: bounds.height }
        : { left: Math.min(startX, x), top: Math.min(startY, y), width: Math.abs(x - startX), height: Math.abs(y - startY) }
      setSelectionBox(latest)
    }
    const stop = (stopEvent: PointerEvent) => {
      if (stopEvent.pointerId !== event.pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      setSelectionBox(undefined)
      const ids = draftRef.current.filter((keyframe) => {
        const x = keyframe.time * pixelsPerSecond
        const y = valueToY(keyframe)
        return x >= latest.left && x <= latest.left + latest.width && (timeOnly || y >= latest.top && y <= latest.top + latest.height)
      }).map((keyframe) => keyframe.id)
      setSelectedIds((current) => new Set([...(additive ? current : []), ...ids]))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }
  const copyTrackAutomation = () => {
    const selected = draftRef.current.filter((keyframe) => selectedIds.has(keyframe.id)).sort((left, right) => left.time - right.time)
    if (!selected.length) return
    const firstTime = selected[0].time
    trackAutomationClipboard = {
      keyframes: selected.map((keyframe) => ({ ...structuredClone(keyframe), time: keyframe.time - firstTime })),
      span: selected[selected.length - 1].time - firstTime,
    }
    setClipboardRevision((revision) => revision + 1)
  }
  const pasteTrackAutomation = () => {
    if (locked || !trackAutomationClipboard?.keyframes.length) return
    const scale = trackAutomationClipboard.span > duration && trackAutomationClipboard.span > 0 ? duration / trackAutomationClipboard.span : 1
    const pastedSpan = trackAutomationClipboard.span * scale
    const start = clamp(Math.round(playhead * fps) / Math.max(1, fps), 0, Math.max(0, duration - pastedSpan))
    const pasted = trackAutomationClipboard.keyframes.map((keyframe) => ({ ...structuredClone(keyframe), id: crypto.randomUUID(), time: Math.round((start + keyframe.time * scale) * fps) / Math.max(1, fps) }))
    const tolerance = .5 / Math.max(1, fps)
    const next = [...draftRef.current.filter((candidate) => !pasted.some((keyframe) => Math.abs(keyframe.time - candidate.time) <= tolerance)), ...pasted].sort((left, right) => left.time - right.time)
    draftRef.current = next
    setDraft(next)
    setSelectedIds(new Set(pasted.map((keyframe) => keyframe.id)))
    onUpdate({ mixAutomationMode: track.mixAutomationMode === 'off' ? 'read' : track.mixAutomationMode ?? 'read', mixKeyframes: next })
    onSeek(start)
  }
  const handlePointKeyDown = (keyframe: TrackMixKeyframe, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (locked || event.altKey) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      event.preventDefault()
      event.stopPropagation()
      copyTrackAutomation()
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
      event.preventDefault()
      event.stopPropagation()
      pasteTrackAutomation()
      return
    }
    if (event.ctrlKey || event.metaKey) return
    const editIds = selectedIds.has(keyframe.id) ? selectedIds : new Set([keyframe.id])
    const isDelete = event.key === 'Delete' || event.key === 'Backspace'
    const isNudge = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
    const isValueNudge = event.key === 'ArrowUp' || event.key === 'ArrowDown'
    const easingByKey: Partial<Record<string, TrackMixKeyframe['easing']>> = { '1': 'linear', '2': 'hold', '3': 'ease-in', '4': 'ease-out', '5': 'ease-in-out', '6': 'bezier' }
    const easing = easingByKey[event.key]
    const cycleEasing = event.key.toLowerCase() === 'e'
    const operation = event.key.toLowerCase() === 'r' ? 'reverse-time' : event.key.toLowerCase() === 'd' ? 'distribute-time' : event.key.toLowerCase() === 'v' ? 'reverse-values' : undefined
    const valueOperation = event.key === '[' ? 'compress' : event.key === ']' ? 'expand' : view === 'pan' && event.key.toLowerCase() === 'm' ? 'mirror-pan' : event.key.toLowerCase() === 'n' ? 'normalize' : event.key.toLowerCase() === 'f' ? 'flatten' : undefined
    const processingOperation = event.key.toLowerCase() === 's' ? 'smooth' : event.key.toLowerCase() === 't' ? 'thin' : undefined
    if (!isDelete && !isNudge && !isValueNudge && !easing && !cycleEasing && !operation && !valueOperation && !processingOperation) return
    event.preventDefault()
    event.stopPropagation()
    if (processingOperation) {
      processTrackAutomation(processingOperation)
      return
    }
    if (valueOperation) {
      applyTrackValueOperation(valueOperation)
      return
    }
    if (operation) {
      applyTrackAutomationOperation(operation)
      return
    }
    if (isDelete) {
      const next = draftRef.current.filter((candidate) => !editIds.has(candidate.id))
      draftRef.current = next
      setDraft(next)
      setSelectedIds(new Set())
      onUpdate({ mixKeyframes: next.length ? next : undefined, mixAutomationMode: next.length ? track.mixAutomationMode ?? 'read' : 'off' })
      return
    }
    if (isValueNudge) {
      const direction = event.key === 'ArrowUp' ? 1 : -1
      const amount = event.shiftKey ? 10 : 1
      const next = draftRef.current.map((candidate) => {
        if (!editIds.has(candidate.id)) return candidate
        return view === 'volume' ? { ...candidate, volume: clamp(candidate.volume + direction * amount, 0, 200) } : { ...candidate, pan: clamp(candidate.pan + direction * amount, -100, 100) }
      })
      draftRef.current = next
      setDraft(next)
      onUpdate({ mixAutomationMode: track.mixAutomationMode === 'off' ? 'read' : track.mixAutomationMode ?? 'read', mixKeyframes: next })
      return
    }
    let next: TrackMixKeyframe[]
    if (isNudge) {
      const selectedTimes = draftRef.current.filter((candidate) => editIds.has(candidate.id)).map((candidate) => candidate.time)
      const requestedDelta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1) / Math.max(1, fps)
      const delta = clamp(requestedDelta, -Math.min(...selectedTimes), duration - Math.max(...selectedTimes))
      next = draftRef.current.map((candidate) => editIds.has(candidate.id) ? { ...candidate, time: Math.round((candidate.time + delta) * fps) / fps } : candidate).sort((left, right) => left.time - right.time)
    } else next = draftRef.current.map((candidate) => editIds.has(candidate.id) ? { ...candidate, easing: easing ?? nextAutomationEasing(candidate.easing) } : candidate)
    draftRef.current = next
    setDraft(next)
    onUpdate({ mixAutomationMode: track.mixAutomationMode === 'off' ? 'read' : track.mixAutomationMode ?? 'read', mixKeyframes: next })
  }
  return <div className={`track-automation-envelope ${view} ${locked ? 'locked' : ''}`} aria-label={`${track.name} ${view === 'volume' ? '볼륨' : '팬'} 자동화`}><span className="track-automation-marquee-surface" onPointerDown={beginSelectionBox} title="Shift+드래그: 자동화 사각형 선택 · Shift+Alt+드래그: 시간 범위 선택 · Ctrl/Cmd 추가 선택">{selectionBox && <i className="track-automation-selection-box" style={selectionBox} />}</span><svg width={Math.max(1, duration * pixelsPerSecond)} height={laneHeight}><polyline className="automation-line-hit" points={points} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={addPoint} /><polyline className="automation-line" points={points} /></svg>{selectedIds.size > 0 && <span className="track-automation-actions" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation() }}><b title="선택된 자동화 포인트 수">{selectedIds.size}</b><button type="button" onClick={(event) => { event.stopPropagation(); copyTrackAutomation() }} title="선택 자동화 복사 (Ctrl/Cmd+C)"><Copy size={10} /></button><button type="button" disabled={!trackAutomationClipboard} onClick={(event) => { event.stopPropagation(); pasteTrackAutomation() }} title="재생 헤드에 자동화 붙여넣기 (Ctrl/Cmd+V)"><ClipboardPaste size={10} /></button><button type="button" onClick={(event) => { event.stopPropagation(); applyTrackValueOperation('normalize') }} title="선택 값 정규화 (N)">N</button>{selectedIds.size > 1 && <button type="button" onClick={(event) => { event.stopPropagation(); applyTrackValueOperation('flatten') }} title="선택 값을 평균으로 평탄화 (F)">F</button>}{selectedIds.size > 1 && <><button type="button" onClick={(event) => { event.stopPropagation(); applyTrackValueOperation('compress') }} title="선택 값 변화폭 축소 ([)">−A</button><button type="button" onClick={(event) => { event.stopPropagation(); applyTrackValueOperation('expand') }} title="선택 값 변화폭 확대 (])">+A</button></>}{selectedIds.size > 2 && <><button type="button" onClick={(event) => { event.stopPropagation(); processTrackAutomation('smooth') }} title="선택 자동화 부드럽게 (S)">≈</button><button type="button" onClick={(event) => { event.stopPropagation(); processTrackAutomation('thin') }} title="불필요한 선택 포인트 줄이기 (T)">▽</button></>}{view === 'pan' && <button type="button" onClick={(event) => { event.stopPropagation(); applyTrackValueOperation('mirror-pan') }} title="선택 팬 좌우 반전 (M)">M</button>}{selectedIds.size > 1 && <><button type="button" onClick={(event) => { event.stopPropagation(); applyTrackAutomationOperation('reverse-time') }} title="선택 포인트 시간 순서 뒤집기 (R)">⇄</button><button type="button" onClick={(event) => { event.stopPropagation(); applyTrackAutomationOperation('distribute-time') }} title="선택 포인트 동일 간격 배치 (D)">≡</button><button type="button" onClick={(event) => { event.stopPropagation(); applyTrackAutomationOperation('reverse-values') }} title="시간을 유지하고 값 순서 뒤집기 (V)">↕</button></>}</span>}{sorted.map((keyframe) => <button type="button" key={keyframe.id} className={`track-automation-point easing-${keyframe.easing} ${selectedIds.has(keyframe.id) ? 'selected' : ''} ${(view === 'volume' ? keyframe.volume <= 0 || keyframe.volume >= 200 : Math.abs(keyframe.pan) >= 100) ? 'value-limited' : ''}`} style={{ left: keyframe.time * pixelsPerSecond, top: valueToY(keyframe) }} onPointerDown={(event) => beginMove(keyframe, event)} onDoubleClick={(event) => cyclePointEasing(keyframe, event)} onContextMenu={(event) => removePoint(keyframe, event)} onKeyDown={(event) => handlePointKeyDown(keyframe, event)} title={`${keyframe.time.toFixed(2)}s · ${view === 'volume' ? `${keyframe.volume.toFixed(0)}%` : `팬 ${keyframe.pan.toFixed(0)}`} · ${keyframe.easing} · Shift/Ctrl 복수 선택 · 드래그 함께 이동 · Ctrl/Cmd+C/V 복사·붙여넣기 · ←/→ 시간 · ↑/↓ 값 · Shift 10배 · N 정규화 · F 평탄화 · [/] 변화폭 · M 팬 반전 · S 부드럽게 · T 포인트 줄이기 · R/D/V 시간·값 편집 · 더블클릭/E 선택 이징 · 우클릭/Delete 선택 삭제`} />)}</div>
}

function ClipBlock({ clip, pixelsPerSecond, fps, timecodeStart, timecodeDropFrame, selected, locked, activeTool, snapEnabled, snapTargets, audioEnvelopeView, opacityEnvelope, speedEnvelope, onSnapGuide, onSelect, onMove, onDragTargetChange, onTrim, onSeek, onRazor, onOpenNestedSequence, onUpdateAutomation, onUpdateAutomationTransient, onMoveClipMarker, onRemoveClipMarker, asset }: {
  clip: TimelineClip
  pixelsPerSecond: number
  fps: number
  timecodeStart: number
  timecodeDropFrame: boolean
  selected: boolean
  locked: boolean
  activeTool: EditorTool
  snapEnabled: boolean
  snapTargets: number[]
  audioEnvelopeView?: 'gain' | 'pan'
  opacityEnvelope?: boolean
  speedEnvelope?: boolean
  onSnapGuide: (time?: number) => void
  onSelect: (additive: boolean) => void
  onMove: (start: number, targetTrackId?: string) => void
  onDragTargetChange: (trackId?: string) => void
  onTrim: (edge: 'start' | 'end', time: number) => void
  onSeek: (time: number) => void
  onRazor: (time: number) => void
  onOpenNestedSequence: (sequenceId: string) => void
  onUpdateAutomation: (patch: Partial<TimelineClip>) => void
  onUpdateAutomationTransient: (patch: Partial<TimelineClip>) => void
  onMoveClipMarker: (markerId: string, localTime: number) => void
  onRemoveClipMarker: (markerId: string) => void
  asset?: MediaAsset
}) {
  const [draftStart, setDraftStart] = useState(clip.start)
  const draftStartRef = useRef(clip.start)
  const [draftAudioMix, setDraftAudioMix] = useState(clip.audioMixKeyframes ?? [])
  const draftAudioMixRef = useRef(clip.audioMixKeyframes ?? [])
  const [draftTransforms, setDraftTransforms] = useState(clip.keyframes ?? [])
  const draftTransformsRef = useRef(clip.keyframes ?? [])
  const [draftSpeed, setDraftSpeed] = useState(clip.speedKeyframes ?? [])
  const draftSpeedRef = useRef(clip.speedKeyframes ?? [])
  const [draftTransitionIn, setDraftTransitionIn] = useState(clip.transitionIn)
  const [draftTransitionOut, setDraftTransitionOut] = useState(clip.transitionOut)
  const [selectedTransitionEdge, setSelectedTransitionEdge] = useState<'in' | 'out'>()
  const [draftAudioAdjustment, setDraftAudioAdjustment] = useState(() => ({ ...defaultAudioAdjustment(), ...clip.audioAdjustment }))
  const [selectedAutomationIds, setSelectedAutomationIds] = useState<Set<string>>(() => new Set())
  const [automationSelectionBox, setAutomationSelectionBox] = useState<CSSProperties>()

  useEffect(() => {
    setDraftStart(clip.start)
    draftStartRef.current = clip.start
  }, [clip.start])
  useEffect(() => {
    const next = clip.audioMixKeyframes ?? []
    setDraftAudioMix(next)
    draftAudioMixRef.current = next
  }, [clip.audioMixKeyframes])
  useEffect(() => {
    const next = clip.keyframes ?? []
    setDraftTransforms(next)
    draftTransformsRef.current = next
  }, [clip.keyframes])
  useEffect(() => {
    const next = clip.speedKeyframes ?? []
    setDraftSpeed(next)
    draftSpeedRef.current = next
  }, [clip.speedKeyframes])
  useEffect(() => { setDraftTransitionIn(clip.transitionIn) }, [clip.transitionIn])
  useEffect(() => { setDraftTransitionOut(clip.transitionOut) }, [clip.transitionOut])
  useEffect(() => { if (!selected) setSelectedTransitionEdge(undefined) }, [selected])
  useEffect(() => { setDraftAudioAdjustment({ ...defaultAudioAdjustment(), ...clip.audioAdjustment }) }, [clip.audioAdjustment])
  useEffect(() => { setSelectedAutomationIds(new Set()) }, [audioEnvelopeView, opacityEnvelope, speedEnvelope])

  const selectAutomationPoint = (id: string, event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    let next: Set<string>
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      next = new Set(selectedAutomationIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
    } else next = selectedAutomationIds.has(id) ? new Set(selectedAutomationIds) : new Set([id])
    setSelectedAutomationIds(next)
    return next.has(id) ? next : new Set([id])
  }

  const snapDraftTime = (proposed: number, includeClipEnd: boolean, temporarilyDisabled: boolean) => {
    const frameTime = snapTimeToFrame(proposed, fps)
    if (!snapEnabled || temporarilyDisabled) return { time: frameTime, guide: undefined as number | undefined }
    const threshold = 8 / Math.max(1, pixelsPerSecond)
    let time = frameTime
    let guide: number | undefined
    let bestDistance = threshold
    for (const targetTime of snapTargets) {
      const startDistance = Math.abs(frameTime - targetTime)
      if (startDistance < bestDistance) {
        time = snapTimeToFrame(targetTime, fps)
        guide = targetTime
        bestDistance = startDistance
      }
      if (includeClipEnd) {
        const endDistance = Math.abs(frameTime + clip.duration - targetTime)
        if (endDistance < bestDistance) {
          time = snapTimeToFrame(Math.max(0, targetTime - clip.duration), fps)
          guide = targetTime
          bestDistance = endDistance
        }
      }
    }
    return { time, guide }
  }
  const snapAutomationTime = (proposedLocalTime: number, temporarilyDisabled: boolean) => {
    const frameTime = clamp(Math.round(proposedLocalTime * fps) / Math.max(1, fps), 0, clip.duration)
    if (!snapEnabled || temporarilyDisabled) return { time: frameTime, guide: undefined as number | undefined }
    const proposedTimelineTime = clip.start + frameTime
    const threshold = 8 / Math.max(1, pixelsPerSecond)
    let time = frameTime
    let guide: number | undefined
    let bestDistance = threshold
    for (const targetTime of snapTargets) {
      const distance = Math.abs(proposedTimelineTime - targetTime)
      const localTime = targetTime - clip.start
      if (distance < bestDistance && localTime >= 0 && localTime <= clip.duration) {
        time = clamp(Math.round(localTime * fps) / Math.max(1, fps), 0, clip.duration)
        guide = targetTime
        bestDistance = distance
      }
    }
    return { time, guide }
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if ((event.target as HTMLElement).closest('.trim-handle')) return
    event.stopPropagation()
    event.preventDefault()
    if (activeTool === 'razor') {
      if (locked) return
      const bounds = event.currentTarget.getBoundingClientRect()
      const localTime = clamp((event.clientX - bounds.left) / pixelsPerSecond, 0, clip.duration)
      onRazor(snapTimeToFrame(clip.start + localTime, fps))
      return
    }
    onSelect(event.ctrlKey || event.metaKey || event.shiftKey)
    if (locked) return
    const target = event.currentTarget
    const pointerId = event.pointerId
    target.setPointerCapture(pointerId)
    const originX = event.clientX
    const originStart = clip.start
    let draftTrackId = clip.trackId
    let moved = false

    const cleanup = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleCancel)
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
      onSnapGuide(undefined)
    }

    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      const delta = (moveEvent.clientX - originX) / pixelsPerSecond
      const frameTime = snapTimeToFrame(originStart + delta, fps)
      const snapped = snapDraftTime(frameTime, true, moveEvent.altKey)
      const next = snapped.time
      onSnapGuide(snapped.guide)
      const lane = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest<HTMLElement>('.track-lane')
      const candidateTrackId = lane?.dataset.trackId
      const candidateKind = lane?.dataset.trackKind
      const candidateLocked = lane?.dataset.trackLocked === 'true'
      const nextTrackId = candidateTrackId && candidateKind === clip.kind && !candidateLocked ? candidateTrackId : clip.trackId
      moved = moved || Math.abs(delta) > 0.05 || nextTrackId !== clip.trackId
      draftStartRef.current = next
      if (draftTrackId !== nextTrackId) {
        draftTrackId = nextTrackId
        onDragTargetChange(draftTrackId)
      }
      setDraftStart(next)
    }

    const handleUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return
      cleanup()
      onDragTargetChange(undefined)
      if (moved) onMove(draftStartRef.current, draftTrackId)
    }

    const handleCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return
      cleanup()
      onDragTargetChange(undefined)
      draftStartRef.current = clip.start
      setDraftStart(clip.start)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleCancel)
  }

  const beginTrim = (event: ReactPointerEvent<HTMLSpanElement>, edge: 'start' | 'end') => {
    event.stopPropagation()
    event.preventDefault()
    if (locked) return
    onSelect(false)
    const target = event.currentTarget
    const pointerId = event.pointerId
    target.setPointerCapture(pointerId)
    const originX = event.clientX
    const originTime = edge === 'start' ? clip.start : clip.start + clip.duration
    let draftTime = originTime
    const cleanup = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleCancel)
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
      onSnapGuide(undefined)
    }
    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      const frameTime = snapTimeToFrame(originTime + (moveEvent.clientX - originX) / pixelsPerSecond, fps)
      const snapped = snapDraftTime(frameTime, false, moveEvent.altKey)
      draftTime = snapped.time
      onSnapGuide(snapped.guide)
    }
    const handleUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return
      cleanup()
      onTrim(edge, draftTime)
    }
    const handleCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return
      cleanup()
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleCancel)
  }

  const opacityValueToPercent = (opacity: number) => 12 + (1 - clamp(opacity / 100, 0, 1)) * 76
  const opacityFromPointer = (clientY: number, bounds: DOMRect) => clamp(1 - (clientY - bounds.top - bounds.height * .12) / Math.max(1, bounds.height * .76), 0, 1) * 100
  const sortedTransforms = useMemo(() => [...draftTransforms].sort((left, right) => left.time - right.time), [draftTransforms])
  const opacityEnvelopePoints = useMemo(() => {
    const manualClip = { ...clip, keyframes: sortedTransforms, motionPathAutoOrient: false, transitionIn: undefined, transitionOut: undefined }
    const sampleCount = Math.min(160, Math.max(2, Math.ceil(clip.duration * pixelsPerSecond / 14)))
    return Array.from({ length: sampleCount + 1 }, (_, index) => {
      const time = clip.duration * index / sampleCount
      const transform = sortedTransforms.length ? resolveClipTransform(manualClip, clip.start + time) : clip.transform
      return `${time / Math.max(.001, clip.duration) * 100},${opacityValueToPercent(transform.opacity)}`
    }).join(' ')
  }, [clip, pixelsPerSecond, sortedTransforms])
  const addOpacityPoint = (event: ReactMouseEvent<SVGPolylineElement>) => {
    if (locked || !opacityEnvelope) return
    event.preventDefault()
    event.stopPropagation()
    const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
    if (!bounds) return
    const time = snapAutomationTime((event.clientX - bounds.left) / Math.max(1, bounds.width) * clip.duration, false).time
    const source = draftTransformsRef.current
    const manualClip = { ...clip, keyframes: source, motionPathAutoOrient: false, transitionIn: undefined, transitionOut: undefined }
    const transform = { ...(source.length ? resolveClipTransform(manualClip, clip.start + time) : clip.transform), opacity: opacityFromPointer(event.clientY, bounds) }
    const point: TransformKeyframe = { id: crypto.randomUUID(), time, transform, easing: 'ease-in-out' }
    const tolerance = 1 / Math.max(1, fps)
    const baselines: TransformKeyframe[] = source.length ? source : [
      ...(time > tolerance ? [{ id: crypto.randomUUID(), time: 0, transform: { ...clip.transform }, easing: 'linear' as const }] : []),
      ...(time < clip.duration - tolerance ? [{ id: crypto.randomUUID(), time: clip.duration, transform: { ...clip.transform }, easing: 'linear' as const }] : []),
    ]
    const next = [...baselines.filter((keyframe) => Math.abs(keyframe.time - time) > tolerance), point].sort((left, right) => left.time - right.time)
    draftTransformsRef.current = next
    setDraftTransforms(next)
    onUpdateAutomation({ keyframes: next })
    onSeek(clip.start + time)
  }
  const beginOpacityPointMove = (keyframe: TransformKeyframe, event: ReactPointerEvent<HTMLSpanElement>) => {
    if (locked || !opacityEnvelope || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.closest<HTMLButtonElement>('.timeline-clip')?.focus()
    onSelect(false)
    const movingIds = selectAutomationPoint(keyframe.id, event)
    const origins = new Map(draftTransformsRef.current.filter((candidate) => movingIds.has(candidate.id)).map((candidate) => [candidate.id, candidate]))
    const minimumTime = Math.min(...[...origins.values()].map((candidate) => candidate.time))
    const maximumTime = Math.max(...[...origins.values()].map((candidate) => candidate.time))
    const minimumOpacity = Math.min(...[...origins.values()].map((candidate) => candidate.transform.opacity))
    const maximumOpacity = Math.max(...[...origins.values()].map((candidate) => candidate.transform.opacity))
    const bounds = event.currentTarget.closest<HTMLElement>('.timeline-clip')?.getBoundingClientRect()
    if (!bounds) return
    let committed = false
    let moved = false
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return
      moved = true
      const snapped = snapAutomationTime((moveEvent.clientX - bounds.left) / Math.max(1, bounds.width) * clip.duration, moveEvent.altKey)
      const requestedDelta = snapped.time - keyframe.time
      const deltaTime = clamp(requestedDelta, -minimumTime, clip.duration - maximumTime)
      onSnapGuide(Math.abs(deltaTime - requestedDelta) < .5 / Math.max(1, fps) ? snapped.guide : undefined)
      const opacity = opacityFromPointer(moveEvent.clientY, bounds)
      const opacityDelta = clamp(opacity - keyframe.transform.opacity, -minimumOpacity, 100 - maximumOpacity)
      const next = draftTransformsRef.current.map((candidate) => { const origin = origins.get(candidate.id); return origin ? { ...candidate, time: origin.time + deltaTime, transform: { ...candidate.transform, opacity: clamp(origin.transform.opacity + opacityDelta, 0, 100) } } : candidate }).sort((left, right) => left.time - right.time)
      draftTransformsRef.current = next
      setDraftTransforms(next)
      if (!committed) { committed = true; onUpdateAutomation({ keyframes: next }) }
      else onUpdateAutomationTransient({ keyframes: next })
    }
    const stop = (stopEvent: PointerEvent) => {
      if (stopEvent.pointerId !== event.pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      onSnapGuide(undefined)
      if (!moved) onSeek(clip.start + keyframe.time)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }
  const removeOpacityPoint = (keyframe: TransformKeyframe, event: ReactMouseEvent<HTMLSpanElement>) => {
    if (locked) return
    event.preventDefault()
    event.stopPropagation()
    const removeIds = selectedAutomationIds.has(keyframe.id) ? selectedAutomationIds : new Set([keyframe.id])
    const next = draftTransformsRef.current.filter((candidate) => !removeIds.has(candidate.id))
    draftTransformsRef.current = next
    setDraftTransforms(next)
    setSelectedAutomationIds(new Set())
    onUpdateAutomation({ keyframes: next.length ? next : undefined })
  }
  const cycleOpacityPointEasing = (keyframe: TransformKeyframe, event: ReactMouseEvent<HTMLSpanElement>) => {
    if (locked) return
    event.preventDefault()
    event.stopPropagation()
    const changeIds = selectedAutomationIds.has(keyframe.id) ? selectedAutomationIds : new Set([keyframe.id])
    const next = draftTransformsRef.current.map((candidate) => changeIds.has(candidate.id) ? { ...candidate, easing: nextAutomationEasing(candidate.easing) } : candidate)
    draftTransformsRef.current = next
    setDraftTransforms(next)
    onUpdateAutomation({ keyframes: next })
  }
  const speedRateToPercent = (rate: number) => {
    const minimum = Math.log(0.05)
    const progress = (Math.log(clamp(rate, 0.05, 16)) - minimum) / (Math.log(16) - minimum)
    return 12 + (1 - progress) * 76
  }
  const speedRateFromPointer = (clientY: number, bounds: DOMRect) => {
    const progress = clamp(1 - (clientY - bounds.top - bounds.height * .12) / Math.max(1, bounds.height * .76), 0, 1)
    return Math.exp(Math.log(0.05) + progress * (Math.log(16) - Math.log(0.05)))
  }
  const sortedSpeed = useMemo(() => [...draftSpeed].sort((left, right) => left.time - right.time), [draftSpeed])
  const speedEnvelopePoints = useMemo(() => {
    const sampledClip = { ...clip, speedKeyframes: sortedSpeed }
    const sampleCount = Math.min(160, Math.max(2, Math.ceil(clip.duration * pixelsPerSecond / 14)))
    return Array.from({ length: sampleCount + 1 }, (_, index) => {
      const time = clip.duration * index / sampleCount
      return `${time / Math.max(.001, clip.duration) * 100},${speedRateToPercent(clipPlaybackRateAtLocal(sampledClip, time))}`
    }).join(' ')
  }, [clip, pixelsPerSecond, sortedSpeed])
  const addSpeedPoint = (event: ReactMouseEvent<SVGPolylineElement>) => {
    if (locked || !speedEnvelope || clip.freezeFrame) return
    event.preventDefault()
    event.stopPropagation()
    const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
    if (!bounds) return
    const time = snapAutomationTime((event.clientX - bounds.left) / Math.max(1, bounds.width) * clip.duration, false).time
    const rate = speedRateFromPointer(event.clientY, bounds)
    const point: SpeedKeyframe = { id: crypto.randomUUID(), time, rate, easing: 'ease-in-out' }
    const source = draftSpeedRef.current
    const tolerance = 1 / Math.max(1, fps)
    const baseRate = clipPlaybackRate(clip)
    const baselines: SpeedKeyframe[] = source.length ? source : [
      ...(time > tolerance ? [{ id: crypto.randomUUID(), time: 0, rate: baseRate, easing: 'linear' as const }] : []),
      ...(time < clip.duration - tolerance ? [{ id: crypto.randomUUID(), time: clip.duration, rate: baseRate, easing: 'linear' as const }] : []),
    ]
    const next = [...baselines.filter((keyframe) => Math.abs(keyframe.time - time) > tolerance), point].sort((left, right) => left.time - right.time)
    draftSpeedRef.current = next
    setDraftSpeed(next)
    onUpdateAutomation({ speedKeyframes: next })
    onSeek(clip.start + time)
  }
  const beginSpeedPointMove = (keyframe: SpeedKeyframe, event: ReactPointerEvent<HTMLSpanElement>) => {
    if (locked || !speedEnvelope || clip.freezeFrame || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.closest<HTMLButtonElement>('.timeline-clip')?.focus()
    onSelect(false)
    const movingIds = selectAutomationPoint(keyframe.id, event)
    const origins = new Map(draftSpeedRef.current.filter((candidate) => movingIds.has(candidate.id)).map((candidate) => [candidate.id, candidate]))
    const minimumTime = Math.min(...[...origins.values()].map((candidate) => candidate.time))
    const maximumTime = Math.max(...[...origins.values()].map((candidate) => candidate.time))
    const minimumRate = Math.min(...[...origins.values()].map((candidate) => candidate.rate))
    const maximumRate = Math.max(...[...origins.values()].map((candidate) => candidate.rate))
    const bounds = event.currentTarget.closest<HTMLElement>('.timeline-clip')?.getBoundingClientRect()
    if (!bounds) return
    let committed = false
    let moved = false
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return
      moved = true
      const snapped = snapAutomationTime((moveEvent.clientX - bounds.left) / Math.max(1, bounds.width) * clip.duration, moveEvent.altKey)
      const requestedDelta = snapped.time - keyframe.time
      const deltaTime = clamp(requestedDelta, -minimumTime, clip.duration - maximumTime)
      onSnapGuide(Math.abs(deltaTime - requestedDelta) < .5 / Math.max(1, fps) ? snapped.guide : undefined)
      const rate = speedRateFromPointer(moveEvent.clientY, bounds)
      const rateFactor = clamp(rate / Math.max(.05, keyframe.rate), .05 / Math.max(.05, minimumRate), 16 / Math.max(.05, maximumRate))
      const next = draftSpeedRef.current.map((candidate) => { const origin = origins.get(candidate.id); return origin ? { ...candidate, time: origin.time + deltaTime, rate: clamp(origin.rate * rateFactor, .05, 16) } : candidate }).sort((left, right) => left.time - right.time)
      draftSpeedRef.current = next
      setDraftSpeed(next)
      if (!committed) { committed = true; onUpdateAutomation({ speedKeyframes: next }) }
      else onUpdateAutomationTransient({ speedKeyframes: next })
    }
    const stop = (stopEvent: PointerEvent) => {
      if (stopEvent.pointerId !== event.pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      onSnapGuide(undefined)
      if (!moved) onSeek(clip.start + keyframe.time)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }
  const removeSpeedPoint = (keyframe: SpeedKeyframe, event: ReactMouseEvent<HTMLSpanElement>) => {
    if (locked || clip.freezeFrame) return
    event.preventDefault()
    event.stopPropagation()
    const removeIds = selectedAutomationIds.has(keyframe.id) ? selectedAutomationIds : new Set([keyframe.id])
    const next = draftSpeedRef.current.filter((candidate) => !removeIds.has(candidate.id))
    draftSpeedRef.current = next
    setDraftSpeed(next)
    setSelectedAutomationIds(new Set())
    onUpdateAutomation({ speedKeyframes: next.length ? next : undefined })
  }
  const cycleSpeedPointEasing = (keyframe: SpeedKeyframe, event: ReactMouseEvent<HTMLSpanElement>) => {
    if (locked || clip.freezeFrame) return
    event.preventDefault()
    event.stopPropagation()
    const changeIds = selectedAutomationIds.has(keyframe.id) ? selectedAutomationIds : new Set([keyframe.id])
    const next = draftSpeedRef.current.map((candidate) => changeIds.has(candidate.id) ? { ...candidate, easing: nextAutomationEasing(candidate.easing) } : candidate)
    draftSpeedRef.current = next
    setDraftSpeed(next)
    onUpdateAutomation({ speedKeyframes: next })
  }
  const audioValueToPercent = (keyframe: Pick<AudioMixKeyframe, 'gainDb' | 'pan'>) => {
    const progress = audioEnvelopeView === 'gain' ? clamp((keyframe.gainDb + 60) / 84, 0, 1) : clamp((keyframe.pan + 100) / 200, 0, 1)
    return 12 + (1 - progress) * 76
  }
  const audioValueFromPointer = (clientY: number, bounds: DOMRect) => {
    const progress = clamp(1 - (clientY - bounds.top - bounds.height * .12) / Math.max(1, bounds.height * .76), 0, 1)
    return audioEnvelopeView === 'gain' ? progress * 84 - 60 : progress * 200 - 100
  }
  const sortedAudioMix = useMemo(() => [...draftAudioMix].sort((left, right) => left.time - right.time), [draftAudioMix])
  const audioEnvelopePoints = useMemo(() => {
    const valueY = (mix: { gainDb: number; pan: number }) => {
      const progress = audioEnvelopeView === 'gain' ? clamp((mix.gainDb + 60) / 84, 0, 1) : clamp((mix.pan + 100) / 200, 0, 1)
      return 12 + (1 - progress) * 76
    }
    const baseAudioMix = resolveClipAudioMix({ ...clip, audioMixKeyframes: undefined }, clip.start)
    const sampledClip = { ...clip, audioMixKeyframes: sortedAudioMix }
    const audioSampleCount = Math.min(160, Math.max(2, Math.ceil(clip.duration * pixelsPerSecond / 14)))
    const linePoints = sortedAudioMix.length
      ? Array.from({ length: audioSampleCount + 1 }, (_, index) => { const time = clip.duration * index / audioSampleCount; return { time, ...resolveClipAudioMix(sampledClip, clip.start + time) } })
      : [{ time: 0, ...baseAudioMix }, { time: clip.duration, ...baseAudioMix }]
    return linePoints.map((keyframe) => `${keyframe.time / Math.max(.001, clip.duration) * 100},${valueY(keyframe)}`).join(' ')
  }, [audioEnvelopeView, clip, pixelsPerSecond, sortedAudioMix])
  const addAudioMixPoint = (event: ReactMouseEvent<SVGPolylineElement>) => {
    if (locked || !audioEnvelopeView) return
    event.preventDefault()
    event.stopPropagation()
    const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
    if (!bounds) return
    const time = snapAutomationTime((event.clientX - bounds.left) / Math.max(1, bounds.width) * clip.duration, false).time
    const mix = resolveClipAudioMix({ ...clip, audioMixKeyframes: draftAudioMixRef.current }, clip.start + time)
    const value = audioValueFromPointer(event.clientY, bounds)
    const point: AudioMixKeyframe = { id: crypto.randomUUID(), time, gainDb: audioEnvelopeView === 'gain' ? value : mix.gainDb, pan: audioEnvelopeView === 'pan' ? value : mix.pan, easing: 'ease-in-out' }
    const next = [...draftAudioMixRef.current.filter((keyframe) => Math.abs(keyframe.time - time) > 1 / Math.max(1, fps)), point].sort((left, right) => left.time - right.time)
    draftAudioMixRef.current = next
    setDraftAudioMix(next)
    onUpdateAutomation({ audioMixKeyframes: next })
    onSeek(clip.start + time)
  }
  const beginAudioMixPointMove = (keyframe: AudioMixKeyframe, event: ReactPointerEvent<HTMLSpanElement>) => {
    if (locked || !audioEnvelopeView || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.closest<HTMLButtonElement>('.timeline-clip')?.focus()
    onSelect(false)
    const movingIds = selectAutomationPoint(keyframe.id, event)
    const origins = new Map(draftAudioMixRef.current.filter((candidate) => movingIds.has(candidate.id)).map((candidate) => [candidate.id, candidate]))
    const minimumTime = Math.min(...[...origins.values()].map((candidate) => candidate.time))
    const maximumTime = Math.max(...[...origins.values()].map((candidate) => candidate.time))
    const originValues = [...origins.values()].map((candidate) => audioEnvelopeView === 'gain' ? candidate.gainDb : candidate.pan)
    const minimumValue = Math.min(...originValues)
    const maximumValue = Math.max(...originValues)
    const bounds = event.currentTarget.closest<HTMLElement>('.timeline-clip')?.getBoundingClientRect()
    if (!bounds) return
    let committed = false
    let moved = false
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return
      moved = true
      const snapped = snapAutomationTime((moveEvent.clientX - bounds.left) / Math.max(1, bounds.width) * clip.duration, moveEvent.altKey)
      const requestedDelta = snapped.time - keyframe.time
      const deltaTime = clamp(requestedDelta, -minimumTime, clip.duration - maximumTime)
      onSnapGuide(Math.abs(deltaTime - requestedDelta) < .5 / Math.max(1, fps) ? snapped.guide : undefined)
      const value = audioValueFromPointer(moveEvent.clientY, bounds)
      const requestedValueDelta = audioEnvelopeView === 'gain' ? value - keyframe.gainDb : value - keyframe.pan
      const valueDelta = audioEnvelopeView === 'gain' ? clamp(requestedValueDelta, -60 - minimumValue, 24 - maximumValue) : clamp(requestedValueDelta, -100 - minimumValue, 100 - maximumValue)
      const next = draftAudioMixRef.current.map((candidate) => { const origin = origins.get(candidate.id); if (!origin) return candidate; return audioEnvelopeView === 'gain' ? { ...candidate, time: origin.time + deltaTime, gainDb: clamp(origin.gainDb + valueDelta, -60, 24) } : { ...candidate, time: origin.time + deltaTime, pan: clamp(origin.pan + valueDelta, -100, 100) } }).sort((left, right) => left.time - right.time)
      draftAudioMixRef.current = next
      setDraftAudioMix(next)
      if (!committed) { committed = true; onUpdateAutomation({ audioMixKeyframes: next }) }
      else onUpdateAutomationTransient({ audioMixKeyframes: next })
    }
    const stop = (stopEvent: PointerEvent) => {
      if (stopEvent.pointerId !== event.pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      onSnapGuide(undefined)
      if (!moved) onSeek(clip.start + keyframe.time)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }
  const removeAudioMixPoint = (keyframe: AudioMixKeyframe, event: ReactMouseEvent<HTMLSpanElement>) => {
    if (locked) return
    event.preventDefault()
    event.stopPropagation()
    const removeIds = selectedAutomationIds.has(keyframe.id) ? selectedAutomationIds : new Set([keyframe.id])
    const next = draftAudioMixRef.current.filter((candidate) => !removeIds.has(candidate.id))
    draftAudioMixRef.current = next
    setDraftAudioMix(next)
    setSelectedAutomationIds(new Set())
    onUpdateAutomation({ audioMixKeyframes: next.length ? next : undefined })
  }
  const cycleAudioMixPointEasing = (keyframe: AudioMixKeyframe, event: ReactMouseEvent<HTMLSpanElement>) => {
    if (locked) return
    event.preventDefault()
    event.stopPropagation()
    const changeIds = selectedAutomationIds.has(keyframe.id) ? selectedAutomationIds : new Set([keyframe.id])
    const next = draftAudioMixRef.current.map((candidate) => changeIds.has(candidate.id) ? { ...candidate, easing: nextAutomationEasing(candidate.easing) } : candidate)
    draftAudioMixRef.current = next
    setDraftAudioMix(next)
    onUpdateAutomation({ audioMixKeyframes: next })
  }
  const beginTransitionResize = (edge: 'in' | 'out', event: ReactPointerEvent<HTMLSpanElement>) => {
    if (locked || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    onSelect(false)
    setSelectedTransitionEdge(edge)
    event.currentTarget.focus()
    const bounds = event.currentTarget.closest<HTMLElement>('.timeline-clip')?.getBoundingClientRect()
    if (!bounds) return
    let committed = false
    let moved = false
    const originX = event.clientX
    const source = edge === 'in' ? draftTransitionIn : draftTransitionOut
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return
      moved = true
      const alignment = source?.alignment ?? (edge === 'in' ? 'start-at-cut' : 'end-at-cut')
      const insideDuration = edge === 'in'
        ? (moveEvent.clientX - bounds.left) / Math.max(1, bounds.width) * clip.duration
        : (bounds.right - moveEvent.clientX) / Math.max(1, bounds.width) * clip.duration
      const rawDuration = alignment === 'center-on-cut' ? insideDuration * 2
        : edge === 'in' && alignment === 'end-at-cut' ? (source?.duration ?? 0) + (originX - moveEvent.clientX) / pixelsPerSecond
          : edge === 'out' && alignment === 'start-at-cut' ? (source?.duration ?? 0) + (moveEvent.clientX - originX) / pixelsPerSecond
            : insideDuration
      const maximumDuration = alignment === 'center-on-cut' ? clip.duration * 2 : clip.duration
      const duration = clamp(Math.round(rawDuration * fps) / fps, 0, maximumDuration)
      const transition: NonNullable<TimelineClip['transitionIn']> = {
        ...(source ?? { type: 'crossfade', duration: 0 }),
        type: duration < 1 / Math.max(1, fps) ? 'none' : source?.type && source.type !== 'none' ? source.type : 'crossfade',
        duration,
        alignment,
        easing: source?.easing ?? 'ease-in-out',
        audioCurve: source?.audioCurve ?? 'equal-power',
      }
      if (edge === 'in') setDraftTransitionIn(transition)
      else setDraftTransitionOut(transition)
      const patch = edge === 'in' ? { transitionIn: transition } : { transitionOut: transition }
      if (!committed) { committed = true; onUpdateAutomation(patch) }
      else onUpdateAutomationTransient(patch)
    }
    const stop = (stopEvent: PointerEvent) => {
      if (stopEvent.pointerId !== event.pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      if (!moved) onSeek(edge === 'in' ? clip.start : clip.start + clip.duration)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }
  const cycleTransitionType = (edge: 'in' | 'out', event: ReactMouseEvent<HTMLSpanElement>) => {
    if (locked) return
    event.preventDefault()
    event.stopPropagation()
    const source = edge === 'in' ? draftTransitionIn : draftTransitionOut
    const types: Array<NonNullable<TimelineClip['transitionIn']>['type']> = clip.kind === 'audio'
      ? ['none', 'crossfade']
      : ['none', 'crossfade', 'dip-black', 'dip-white', 'blur-dissolve', 'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'slide-left', 'slide-right', 'zoom']
    const type = types[(types.indexOf(source?.type ?? 'none') + 1) % types.length]
    const transition = { ...(source ?? { duration: .5 }), type, duration: type === 'none' ? 0 : source?.type && source.type !== 'none' && source.duration > 0 ? source.duration : .5, alignment: source?.alignment ?? (edge === 'in' ? 'start-at-cut' : 'end-at-cut'), easing: source?.easing ?? 'ease-in-out', audioCurve: source?.audioCurve ?? 'equal-power' }
    if (edge === 'in') setDraftTransitionIn(transition)
    else setDraftTransitionOut(transition)
    onUpdateAutomation(edge === 'in' ? { transitionIn: transition } : { transitionOut: transition })
  }
  const clearTransition = (edge: 'in' | 'out') => {
    if (locked) return
    if (edge === 'in') setDraftTransitionIn(undefined)
    else setDraftTransitionOut(undefined)
    onUpdateAutomation(edge === 'in' ? { transitionIn: undefined } : { transitionOut: undefined })
    setSelectedTransitionEdge(undefined)
  }
  const cycleTransitionAlignment = (edge: 'in' | 'out') => {
    if (locked) return
    const source = edge === 'in' ? draftTransitionIn : draftTransitionOut
    if (!source || source.type === 'none') return
    const alignments: Array<NonNullable<TimelineClip['transitionIn']>['alignment']> = ['start-at-cut', 'center-on-cut', 'end-at-cut']
    const fallback = edge === 'in' ? 'start-at-cut' : 'end-at-cut'
    const alignment = alignments[(alignments.indexOf(source.alignment ?? fallback) + 1) % alignments.length]
    const transition = { ...source, alignment, duration: Math.min(alignment === 'center-on-cut' ? clip.duration * 2 : clip.duration, source.duration) }
    if (edge === 'in') setDraftTransitionIn(transition)
    else setDraftTransitionOut(transition)
    onUpdateAutomation(edge === 'in' ? { transitionIn: transition } : { transitionOut: transition })
  }
  const cycleTransitionEasingValue = (edge: 'in' | 'out') => {
    if (locked) return
    const source = edge === 'in' ? draftTransitionIn : draftTransitionOut
    if (!source || source.type === 'none') return
    const easings: Array<NonNullable<TimelineClip['transitionIn']>['easing']> = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'bezier']
    const easing = easings[(easings.indexOf(source.easing ?? 'ease-in-out') + 1) % easings.length]
    const transition = { ...source, easing }
    if (edge === 'in') setDraftTransitionIn(transition)
    else setDraftTransitionOut(transition)
    onUpdateAutomation(edge === 'in' ? { transitionIn: transition } : { transitionOut: transition })
  }
  const cycleTransitionEasing = (edge: 'in' | 'out', event: ReactMouseEvent<HTMLSpanElement>) => {
    if (locked) return
    event.preventDefault()
    event.stopPropagation()
    if (event.shiftKey) {
      cycleTransitionAlignment(edge)
      return
    }
    cycleTransitionEasingValue(edge)
  }
  const handleTransitionKeyDown = (edge: 'in' | 'out', event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (locked) return
    const source = edge === 'in' ? draftTransitionIn : draftTransitionOut
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      event.stopPropagation()
      clearTransition(edge)
      return
    }
    if (event.key.toLocaleLowerCase() === 'a') {
      event.preventDefault()
      event.stopPropagation()
      cycleTransitionAlignment(edge)
      return
    }
    if (event.key.toLocaleLowerCase() === 'e') {
      event.preventDefault()
      event.stopPropagation()
      cycleTransitionEasingValue(edge)
      return
    }
    if (!source || source.type === 'none' || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
    event.preventDefault()
    event.stopPropagation()
    const maximumDuration = (source.alignment ?? (edge === 'in' ? 'start-at-cut' : 'end-at-cut')) === 'center-on-cut' ? clip.duration * 2 : clip.duration
    const frameDelta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1) / Math.max(1, fps)
    const transition = { ...source, duration: clamp(Math.round((source.duration + frameDelta) * fps) / fps, 1 / Math.max(1, fps), maximumDuration) }
    if (edge === 'in') setDraftTransitionIn(transition)
    else setDraftTransitionOut(transition)
    onUpdateAutomation(edge === 'in' ? { transitionIn: transition } : { transitionOut: transition })
  }
  const supportsAudioFade = !clip.audioDisabled && (clip.kind === 'audio' || Boolean(asset?.audioCodec || asset?.channels))
  const beginAudioFadeResize = (edge: 'in' | 'out', event: ReactPointerEvent<HTMLSpanElement>) => {
    if (locked || !supportsAudioFade || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    focusClip(event.currentTarget)
    onSelect(false)
    const bounds = event.currentTarget.closest<HTMLElement>('.timeline-clip')?.getBoundingClientRect()
    if (!bounds) return
    let committed = false
    let moved = false
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return
      moved = true
      const pointerLocal = (moveEvent.clientX - bounds.left) / Math.max(1, bounds.width) * clip.duration
      const snapped = snapAutomationTime(pointerLocal, moveEvent.altKey)
      const duration = edge === 'in' ? snapped.time : clip.duration - snapped.time
      onSnapGuide(snapped.guide)
      const audioAdjustment = { ...draftAudioAdjustment, [edge === 'in' ? 'fadeIn' : 'fadeOut']: clamp(duration, 0, clip.duration) }
      setDraftAudioAdjustment(audioAdjustment)
      const patch = { audioAdjustment }
      if (!committed) { committed = true; onUpdateAutomation(patch) }
      else onUpdateAutomationTransient(patch)
    }
    const stop = (stopEvent: PointerEvent) => {
      if (stopEvent.pointerId !== event.pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      onSnapGuide(undefined)
      if (!moved) onSeek(edge === 'in' ? clip.start + draftAudioAdjustment.fadeIn : clip.start + clip.duration - draftAudioAdjustment.fadeOut)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }
  const cycleAudioFadeCurve = (edge: 'in' | 'out', event: ReactMouseEvent<HTMLSpanElement>) => {
    if (locked || !supportsAudioFade) return
    event.preventDefault()
    event.stopPropagation()
    const curves: Array<NonNullable<AudioAdjustment['fadeInCurve']>> = ['linear', 'equal-power', 'logarithmic']
    const key = edge === 'in' ? 'fadeInCurve' : 'fadeOutCurve'
    const curve = curves[(curves.indexOf(draftAudioAdjustment[key] ?? 'linear') + 1) % curves.length]
    const audioAdjustment = { ...draftAudioAdjustment, [key]: curve }
    setDraftAudioAdjustment(audioAdjustment)
    onUpdateAutomation({ audioAdjustment })
  }
  const clearAudioFade = (edge: 'in' | 'out', event: ReactMouseEvent<HTMLSpanElement>) => {
    if (locked || !supportsAudioFade) return
    event.preventDefault()
    event.stopPropagation()
    const audioAdjustment = { ...draftAudioAdjustment, [edge === 'in' ? 'fadeIn' : 'fadeOut']: 0 }
    setDraftAudioAdjustment(audioAdjustment)
    onUpdateAutomation({ audioAdjustment })
  }
  const automationMarkers = [
    ...(opacityEnvelope ? [] : (clip.keyframes ?? []).map((keyframe) => ({ id: keyframe.id, time: keyframe.time, kind: 'transform' as const, label: '변형' }))),
    ...(speedEnvelope ? [] : (clip.speedKeyframes ?? []).map((keyframe) => ({ id: keyframe.id, time: keyframe.time, kind: 'speed' as const, label: '속도' }))),
    ...(clip.visualKeyframes ?? []).map((keyframe) => ({ id: keyframe.id, time: keyframe.time, kind: 'visual' as const, label: '효과' })),
    ...(audioEnvelopeView ? [] : (clip.audioMixKeyframes ?? []).map((keyframe) => ({ id: keyframe.id, time: keyframe.time, kind: 'audio' as const, label: '오디오' }))),
  ]
  const focusClip = (target: HTMLElement) => target.closest<HTMLButtonElement>('.timeline-clip')?.focus()
  const applyAutomationPatch = (patch: Partial<TimelineClip>) => {
    if ('keyframes' in patch) { draftTransformsRef.current = patch.keyframes ?? []; setDraftTransforms(patch.keyframes ?? []) }
    if ('speedKeyframes' in patch) { draftSpeedRef.current = patch.speedKeyframes ?? []; setDraftSpeed(patch.speedKeyframes ?? []) }
    if ('audioMixKeyframes' in patch) { draftAudioMixRef.current = patch.audioMixKeyframes ?? []; setDraftAudioMix(patch.audioMixKeyframes ?? []) }
    onUpdateAutomation(patch)
  }
  const deleteSelectedAutomation = () => {
    if (locked || !selectedAutomationIds.size) return
    const keyframes = draftTransformsRef.current.filter((keyframe) => !selectedAutomationIds.has(keyframe.id))
    const speedKeyframes = draftSpeedRef.current.filter((keyframe) => !selectedAutomationIds.has(keyframe.id))
    const visualKeyframes = clip.visualKeyframes?.filter((keyframe) => !selectedAutomationIds.has(keyframe.id)) ?? []
    const audioMixKeyframes = draftAudioMixRef.current.filter((keyframe) => !selectedAutomationIds.has(keyframe.id))
    applyAutomationPatch({
      keyframes: keyframes.length ? keyframes : undefined,
      speedKeyframes: speedKeyframes.length ? speedKeyframes : undefined,
      visualKeyframes: visualKeyframes.length ? visualKeyframes : undefined,
      audioMixKeyframes: audioMixKeyframes.length ? audioMixKeyframes : undefined,
    })
    setSelectedAutomationIds(new Set())
  }
  const applySelectedAutomationOperation = (operation: 'reverse-time' | 'distribute-time' | 'reverse-values') => {
    if (locked || selectedAutomationIds.size < 2) return
    const allSelectedTimes = [
      ...draftTransformsRef.current, ...draftSpeedRef.current, ...(clip.visualKeyframes ?? []), ...draftAudioMixRef.current,
    ].filter((keyframe) => selectedAutomationIds.has(keyframe.id)).map((keyframe) => keyframe.time)
    if (allSelectedTimes.length < 2) return
    const firstTime = Math.min(...allSelectedTimes)
    const lastTime = Math.max(...allSelectedTimes)
    if (operation === 'reverse-values') {
      const reverseSelectedPayloads = <T extends { id: string; time: number }, K extends keyof T>(items: T[], keys: K[]) => {
        const ordered = items.filter((item) => selectedAutomationIds.has(item.id)).sort((left, right) => left.time - right.time)
        const reversedPayloads = [...ordered].reverse().map((item) => Object.fromEntries(keys.map((key) => [key, item[key]])) as Pick<T, K>)
        const payloadById = new Map(ordered.map((item, index) => [item.id, reversedPayloads[index]]))
        return items.map((item) => payloadById.has(item.id) ? { ...item, ...payloadById.get(item.id)! } : item)
      }
      applyAutomationPatch({
        keyframes: reverseSelectedPayloads(draftTransformsRef.current, ['transform']),
        speedKeyframes: reverseSelectedPayloads(draftSpeedRef.current, ['rate']),
        visualKeyframes: reverseSelectedPayloads(clip.visualKeyframes ?? [], ['effects']),
        audioMixKeyframes: reverseSelectedPayloads(draftAudioMixRef.current, ['gainDb', 'pan']),
      })
      return
    }
    const uniqueTimes = [...new Set(allSelectedTimes)].sort((left, right) => left - right)
    const distributedTimes = new Map(uniqueTimes.map((time, index) => [time, uniqueTimes.length < 2 ? time : Math.round((firstTime + (lastTime - firstTime) * index / (uniqueTimes.length - 1)) * fps) / fps]))
    const retime = <T extends { id: string; time: number }>(items: T[]) => items.map((keyframe) => {
      if (!selectedAutomationIds.has(keyframe.id)) return keyframe
      const time = operation === 'reverse-time' ? Math.round((firstTime + lastTime - keyframe.time) * fps) / fps : distributedTimes.get(keyframe.time) ?? keyframe.time
      return { ...keyframe, time }
    }).sort((left, right) => left.time - right.time)
    applyAutomationPatch({
      keyframes: retime(draftTransformsRef.current),
      speedKeyframes: retime(draftSpeedRef.current),
      visualKeyframes: retime(clip.visualKeyframes ?? []),
      audioMixKeyframes: retime(draftAudioMixRef.current),
    })
  }
  const applySelectedAudioValueOperation = (operation: 'compress' | 'expand' | 'mirror-pan' | 'normalize' | 'flatten') => {
    const selected = draftAudioMixRef.current.filter((keyframe) => selectedAutomationIds.has(keyframe.id))
    if (locked || !audioEnvelopeView || !selected.length || (operation === 'compress' || operation === 'expand' || operation === 'flatten') && selected.length < 2) return
    const factor = operation === 'compress' ? .8 : 1.25
    const center = audioEnvelopeView === 'gain'
      ? selected.reduce((sum, keyframe) => sum + keyframe.gainDb, 0) / selected.length
      : selected.reduce((sum, keyframe) => sum + keyframe.pan, 0) / selected.length
    const normalizationPeak = audioEnvelopeView === 'gain' ? Math.max(...selected.map((item) => item.gainDb)) : Math.max(...selected.map((item) => Math.abs(item.pan)))
    const audioMixKeyframes = draftAudioMixRef.current.map((keyframe) => {
      if (!selectedAutomationIds.has(keyframe.id)) return keyframe
      if (operation === 'mirror-pan') return { ...keyframe, pan: clamp(-keyframe.pan, -100, 100) }
      if (operation === 'flatten') return audioEnvelopeView === 'gain' ? { ...keyframe, gainDb: center } : { ...keyframe, pan: center }
      if (operation === 'normalize') {
        if (audioEnvelopeView === 'gain') {
          return { ...keyframe, gainDb: clamp(keyframe.gainDb - normalizationPeak, -60, 24) }
        }
        return { ...keyframe, pan: normalizationPeak > .0001 ? clamp(keyframe.pan * 100 / normalizationPeak, -100, 100) : keyframe.pan }
      }
      return audioEnvelopeView === 'gain'
        ? { ...keyframe, gainDb: clamp(center + (keyframe.gainDb - center) * factor, -60, 24) }
        : { ...keyframe, pan: clamp(center + (keyframe.pan - center) * factor, -100, 100) }
    })
    applyAutomationPatch({ audioMixKeyframes })
  }
  const processSelectedAudioAutomation = (operation: 'smooth' | 'thin') => {
    const selected = draftAudioMixRef.current.filter((keyframe) => selectedAutomationIds.has(keyframe.id)).sort((left, right) => left.time - right.time)
    if (locked || !audioEnvelopeView || selected.length < 3) return
    if (operation === 'thin') {
      const keptIds = scalarKeyframeKeepIds(selected, (keyframe) => audioEnvelopeView === 'gain' ? keyframe.gainDb : keyframe.pan, audioEnvelopeView === 'gain' ? .25 : 1.5)
      const audioMixKeyframes = draftAudioMixRef.current.filter((keyframe) => !selectedAutomationIds.has(keyframe.id) || keptIds.has(keyframe.id))
      applyAutomationPatch({ audioMixKeyframes })
      setSelectedAutomationIds(keptIds)
      return
    }
    const values = new Map(selected.map((keyframe, index) => {
      const previous = selected[Math.max(0, index - 1)]
      const following = selected[Math.min(selected.length - 1, index + 1)]
      const value = audioEnvelopeView === 'gain'
        ? (previous.gainDb + keyframe.gainDb * 2 + following.gainDb) / 4
        : (previous.pan + keyframe.pan * 2 + following.pan) / 4
      return [keyframe.id, value]
    }))
    const audioMixKeyframes = draftAudioMixRef.current.map((keyframe) => !values.has(keyframe.id) ? keyframe : audioEnvelopeView === 'gain' ? { ...keyframe, gainDb: clamp(values.get(keyframe.id)!, -60, 24) } : { ...keyframe, pan: clamp(values.get(keyframe.id)!, -100, 100) })
    applyAutomationPatch({ audioMixKeyframes })
  }
  const handleAutomationKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (locked || !selectedAutomationIds.size || event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target as HTMLElement
    if (target.matches('input, textarea, select, [contenteditable="true"]')) return
    const isDelete = event.key === 'Delete' || event.key === 'Backspace'
    const isNudge = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
    const isValueNudge = (event.key === 'ArrowUp' || event.key === 'ArrowDown') && Boolean(opacityEnvelope || speedEnvelope || audioEnvelopeView)
    const easingByKey: Partial<Record<string, TransformKeyframe['easing']>> = {
      '1': 'linear', '2': 'hold', '3': 'ease-in', '4': 'ease-out', '5': 'ease-in-out', '6': 'bezier',
    }
    const fixedEasing = easingByKey[event.key]
    const cycleEasing = event.key.toLowerCase() === 'e'
    const operation = event.key.toLowerCase() === 'r' ? 'reverse-time' : event.key.toLowerCase() === 'd' ? 'distribute-time' : event.key.toLowerCase() === 'v' ? 'reverse-values' : undefined
    const audioValueOperation = !audioEnvelopeView ? undefined : event.key === '[' ? 'compress' : event.key === ']' ? 'expand' : audioEnvelopeView === 'pan' && event.key.toLowerCase() === 'm' ? 'mirror-pan' : event.key.toLowerCase() === 'n' ? 'normalize' : event.key.toLowerCase() === 'f' ? 'flatten' : undefined
    const audioProcessingOperation = !audioEnvelopeView ? undefined : event.key.toLowerCase() === 's' ? 'smooth' : event.key.toLowerCase() === 't' ? 'thin' : undefined
    if (!isDelete && !isNudge && !isValueNudge && !fixedEasing && !cycleEasing && !operation && !audioValueOperation && !audioProcessingOperation) return
    event.preventDefault()
    event.stopPropagation()
    if (audioProcessingOperation) {
      processSelectedAudioAutomation(audioProcessingOperation)
      return
    }
    if (audioValueOperation) {
      applySelectedAudioValueOperation(audioValueOperation)
      return
    }
    if (operation) {
      applySelectedAutomationOperation(operation)
      return
    }
    if (isDelete) {
      deleteSelectedAutomation()
      return
    }
    if (isValueNudge) {
      const direction = event.key === 'ArrowUp' ? 1 : -1
      const keyframes = opacityEnvelope ? draftTransformsRef.current.map((keyframe) => selectedAutomationIds.has(keyframe.id) ? { ...keyframe, transform: { ...keyframe.transform, opacity: clamp(keyframe.transform.opacity + direction * (event.shiftKey ? 10 : 1), 0, 100) } } : keyframe) : draftTransformsRef.current
      const speedKeyframes = speedEnvelope ? draftSpeedRef.current.map((keyframe) => selectedAutomationIds.has(keyframe.id) ? { ...keyframe, rate: clamp(keyframe.rate + direction * (event.shiftKey ? .25 : .05), .05, 16) } : keyframe) : draftSpeedRef.current
      const audioMixKeyframes = audioEnvelopeView ? draftAudioMixRef.current.map((keyframe) => {
        if (!selectedAutomationIds.has(keyframe.id)) return keyframe
        return audioEnvelopeView === 'gain' ? { ...keyframe, gainDb: clamp(keyframe.gainDb + direction * (event.shiftKey ? 3 : .5), -60, 24) } : { ...keyframe, pan: clamp(keyframe.pan + direction * (event.shiftKey ? 10 : 1), -100, 100) }
      }) : draftAudioMixRef.current
      applyAutomationPatch({ keyframes, speedKeyframes, audioMixKeyframes })
      return
    }
    if (isNudge) {
      const selectedTimes = [
        ...draftTransformsRef.current, ...draftSpeedRef.current, ...(clip.visualKeyframes ?? []), ...draftAudioMixRef.current,
      ].filter((keyframe) => selectedAutomationIds.has(keyframe.id)).map((keyframe) => keyframe.time)
      if (!selectedTimes.length) return
      const requestedDelta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1) / Math.max(1, fps)
      const delta = clamp(requestedDelta, -Math.min(...selectedTimes), clip.duration - Math.max(...selectedTimes))
      const nudge = <T extends { id: string; time: number }>(items: T[]) => items.map((keyframe) => selectedAutomationIds.has(keyframe.id) ? { ...keyframe, time: Math.round((keyframe.time + delta) * fps) / fps } : keyframe).sort((left, right) => left.time - right.time)
      applyAutomationPatch({
        keyframes: nudge(draftTransformsRef.current),
        speedKeyframes: nudge(draftSpeedRef.current),
        visualKeyframes: nudge(clip.visualKeyframes ?? []),
        audioMixKeyframes: nudge(draftAudioMixRef.current),
      })
      return
    }
    const withEasing = <T extends { id: string; easing: TransformKeyframe['easing'] }>(items: T[]) => items.map((keyframe) => selectedAutomationIds.has(keyframe.id) ? { ...keyframe, easing: fixedEasing ?? nextAutomationEasing(keyframe.easing) } : keyframe)
    applyAutomationPatch({
      keyframes: withEasing(draftTransformsRef.current),
      speedKeyframes: withEasing(draftSpeedRef.current),
      visualKeyframes: withEasing(clip.visualKeyframes ?? []),
      audioMixKeyframes: withEasing(draftAudioMixRef.current),
    })
  }
  const beginKeyframeMove = (event: ReactPointerEvent<HTMLSpanElement>, marker: typeof automationMarkers[number]) => {
    event.stopPropagation()
    event.preventDefault()
    focusClip(event.currentTarget)
    onSelect(false)
    const movingIds = selectAutomationPoint(marker.id, event)
    const allTimes = [
      ...(clip.keyframes ?? []), ...(clip.speedKeyframes ?? []), ...(clip.visualKeyframes ?? []), ...(clip.audioMixKeyframes ?? []),
    ].filter((keyframe) => movingIds.has(keyframe.id)).map((keyframe) => keyframe.time)
    const minimumTime = Math.min(...allTimes)
    const maximumTime = Math.max(...allTimes)
    const originX = event.clientX
    let draftDelta = 0
    let draftTargetTime = marker.time
    let moved = false
    let committed = false
    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId || locked) return
      moved = moved || Math.abs(moveEvent.clientX - originX) > 2
      const proposedDelta = Math.round((moveEvent.clientX - originX) / pixelsPerSecond * fps) / fps
      let timeTransform = (time: number) => time
      if (moveEvent.altKey && allTimes.length > 1) {
        onSnapGuide(undefined)
        const anchor = marker.time - minimumTime <= maximumTime - marker.time ? maximumTime : minimumTime
        const denominator = marker.time - anchor
        const rawFactor = Math.abs(denominator) > 1 / Math.max(1, fps) ? (marker.time + proposedDelta - anchor) / denominator : 1
        const factorLimit = anchor === minimumTime ? (clip.duration - anchor) / Math.max(1 / Math.max(1, fps), maximumTime - anchor) : anchor / Math.max(1 / Math.max(1, fps), anchor - minimumTime)
        const factor = clamp(rawFactor, .05, Math.max(.05, factorLimit))
        timeTransform = (time) => Math.round((anchor + (time - anchor) * factor) * fps) / fps
        draftTargetTime = timeTransform(marker.time)
      } else {
        const snapped = snapAutomationTime(marker.time + proposedDelta, false)
        const requestedDelta = snapped.time - marker.time
        draftDelta = clamp(requestedDelta, -minimumTime, clip.duration - maximumTime)
        onSnapGuide(Math.abs(draftDelta - requestedDelta) < .5 / Math.max(1, fps) ? snapped.guide : undefined)
        timeTransform = (time) => time + draftDelta
        draftTargetTime = marker.time + draftDelta
      }
      const shift = <T extends { id: string; time: number }>(items: T[] | undefined) => items?.map((keyframe) => movingIds.has(keyframe.id) ? { ...keyframe, time: timeTransform(keyframe.time) } : keyframe).sort((left, right) => left.time - right.time)
      const patch: Partial<TimelineClip> = { keyframes: shift(clip.keyframes), speedKeyframes: shift(clip.speedKeyframes), visualKeyframes: shift(clip.visualKeyframes), audioMixKeyframes: shift(clip.audioMixKeyframes) }
      if (patch.keyframes) { draftTransformsRef.current = patch.keyframes; setDraftTransforms(patch.keyframes) }
      if (patch.speedKeyframes) { draftSpeedRef.current = patch.speedKeyframes; setDraftSpeed(patch.speedKeyframes) }
      if (patch.audioMixKeyframes) { draftAudioMixRef.current = patch.audioMixKeyframes; setDraftAudioMix(patch.audioMixKeyframes) }
      if (!committed) { committed = true; onUpdateAutomation(patch) }
      else onUpdateAutomationTransient(patch)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', cleanup)
      onSnapGuide(undefined)
    }
    const handleUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== event.pointerId) return
      cleanup()
      onSeek(clip.start + draftTargetTime)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', cleanup)
  }
  const removeAutomationMarkers = (marker: typeof automationMarkers[number], event: ReactMouseEvent<HTMLSpanElement>) => {
    if (locked) return
    event.preventDefault()
    event.stopPropagation()
    const removeIds = selectedAutomationIds.has(marker.id) ? selectedAutomationIds : new Set([marker.id])
    const keyframes = clip.keyframes?.filter((keyframe) => !removeIds.has(keyframe.id))
    const speedKeyframes = clip.speedKeyframes?.filter((keyframe) => !removeIds.has(keyframe.id))
    const visualKeyframes = clip.visualKeyframes?.filter((keyframe) => !removeIds.has(keyframe.id))
    const audioMixKeyframes = clip.audioMixKeyframes?.filter((keyframe) => !removeIds.has(keyframe.id))
    draftTransformsRef.current = keyframes ?? []; setDraftTransforms(keyframes ?? [])
    draftSpeedRef.current = speedKeyframes ?? []; setDraftSpeed(speedKeyframes ?? [])
    draftAudioMixRef.current = audioMixKeyframes ?? []; setDraftAudioMix(audioMixKeyframes ?? [])
    setSelectedAutomationIds(new Set())
    onUpdateAutomation({ keyframes: keyframes?.length ? keyframes : undefined, speedKeyframes: speedKeyframes?.length ? speedKeyframes : undefined, visualKeyframes: visualKeyframes?.length ? visualKeyframes : undefined, audioMixKeyframes: audioMixKeyframes?.length ? audioMixKeyframes : undefined })
  }
  const cycleAutomationMarkersEasing = (marker: typeof automationMarkers[number], event: ReactMouseEvent<HTMLSpanElement>) => {
    if (locked) return
    event.preventDefault()
    event.stopPropagation()
    const changeIds = selectedAutomationIds.has(marker.id) ? selectedAutomationIds : new Set([marker.id])
    const cycle = <T extends { id: string; easing: TransformKeyframe['easing'] }>(items: T[] | undefined) => items?.map((keyframe) => changeIds.has(keyframe.id) ? { ...keyframe, easing: nextAutomationEasing(keyframe.easing) } : keyframe)
    applyAutomationPatch({ keyframes: cycle(draftTransformsRef.current), speedKeyframes: cycle(draftSpeedRef.current), visualKeyframes: cycle(clip.visualKeyframes), audioMixKeyframes: cycle(draftAudioMixRef.current) })
  }
  const beginClipMarkerMove = (event: ReactPointerEvent<HTMLSpanElement>, marker: ClipMarker) => {
    event.stopPropagation()
    event.preventDefault()
    onSelect(false)
    const originX = event.clientX
    let draftTime = marker.time
    let moved = false
    const cleanup = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', cleanup)
      onSnapGuide(undefined)
    }
    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId || locked) return
      moved = moved || Math.abs(moveEvent.clientX - originX) > 2
      const snapped = snapAutomationTime(marker.time + (moveEvent.clientX - originX) / pixelsPerSecond, moveEvent.altKey)
      draftTime = snapped.time
      onSnapGuide(snapped.guide)
    }
    const handleUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== event.pointerId) return
      cleanup()
      if (moved && !locked) onMoveClipMarker(marker.id, draftTime)
      onSeek(clip.start + draftTime)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', cleanup)
  }
  const transitionInsideDuration = (edge: 'in' | 'out', transition?: TimelineClip['transitionIn']) => {
    if (!transition || transition.type === 'none') return 0
    const alignment = transition.alignment ?? (edge === 'in' ? 'start-at-cut' : 'end-at-cut')
    if (alignment === 'center-on-cut') return transition.duration / 2
    if (edge === 'in') return alignment === 'start-at-cut' ? transition.duration : 0
    return alignment === 'end-at-cut' ? transition.duration : 0
  }
  const transitionAlignmentLabel = (edge: 'in' | 'out', transition?: TimelineClip['transitionIn']) => {
    const alignment = transition?.alignment ?? (edge === 'in' ? 'start-at-cut' : 'end-at-cut')
    return alignment === 'center-on-cut' ? '컷 중앙' : alignment === 'start-at-cut' ? '컷에서 시작' : '컷에서 종료'
  }
  const beginAutomationMarquee = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (locked || event.button !== 0 || !event.shiftKey) return
    event.preventDefault()
    event.stopPropagation()
    focusClip(event.currentTarget)
    const bounds = event.currentTarget.closest<HTMLElement>('.timeline-clip')?.getBoundingClientRect()
    if (!bounds) return
    const startX = clamp(event.clientX - bounds.left, 0, bounds.width)
    const startY = clamp(event.clientY - bounds.top, 0, bounds.height)
    const additive = event.ctrlKey || event.metaKey
    const timeOnly = event.altKey
    let latest = { left: startX, top: startY, width: 0, height: 0 }
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return
      const x = clamp(moveEvent.clientX - bounds.left, 0, bounds.width)
      const y = clamp(moveEvent.clientY - bounds.top, 0, bounds.height)
      latest = timeOnly
        ? { left: Math.min(startX, x), top: 0, width: Math.abs(x - startX), height: bounds.height }
        : { left: Math.min(startX, x), top: Math.min(startY, y), width: Math.abs(x - startX), height: Math.abs(y - startY) }
      setAutomationSelectionBox({ left: `${latest.left / bounds.width * 100}%`, top: `${latest.top / bounds.height * 100}%`, width: `${latest.width / bounds.width * 100}%`, height: `${latest.height / bounds.height * 100}%` })
    }
    const stop = (stopEvent: PointerEvent) => {
      if (stopEvent.pointerId !== event.pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      setAutomationSelectionBox(undefined)
      const inside = (x: number, y: number) => x >= latest.left && x <= latest.left + latest.width && (timeOnly || y >= latest.top && y <= latest.top + latest.height)
      const pointX = (time: number) => time / Math.max(.001, clip.duration) * bounds.width
      const ids = opacityEnvelope ? sortedTransforms.filter((keyframe) => inside(pointX(keyframe.time), opacityValueToPercent(keyframe.transform.opacity) / 100 * bounds.height)).map((keyframe) => keyframe.id)
        : speedEnvelope ? sortedSpeed.filter((keyframe) => inside(pointX(keyframe.time), speedRateToPercent(keyframe.rate) / 100 * bounds.height)).map((keyframe) => keyframe.id)
          : audioEnvelopeView ? sortedAudioMix.filter((keyframe) => inside(pointX(keyframe.time), audioValueToPercent(keyframe) / 100 * bounds.height)).map((keyframe) => keyframe.id)
            : automationMarkers.filter((marker) => inside(pointX(marker.time), marker.kind === 'transform' ? 12 : marker.kind === 'speed' ? 19 : marker.kind === 'visual' ? 26 : 33)).map((marker) => marker.id)
      setSelectedAutomationIds((current) => new Set([...(additive ? current : []), ...ids]))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  return (
    <button
      data-clip-id={clip.id}
      className={`timeline-clip ${clip.kind} ${clip.enabled === false ? 'disabled-clip' : ''} ${clip.nestedSequenceId ? 'nested' : ''} ${clip.adrCueId ? 'adr-take' : ''} ${clip.adrCueId && clip.audioDisabled ? 'inactive-take' : ''} ${selected ? 'selected' : ''}`}
      style={{ left: draftStart * pixelsPerSecond, width: Math.max(32, clip.duration * pixelsPerSecond), '--clip-color': clip.color } as CSSProperties}
      onPointerDown={handlePointerDown}
      onKeyDown={handleAutomationKeyDown}
      onDoubleClick={(event) => { if (!clip.nestedSequenceId) return; event.stopPropagation(); onOpenNestedSequence(clip.nestedSequenceId) }}
      aria-label={`${clip.name}, ${formatMediaTimecode(timecodeStart + clip.start, fps, timecodeDropFrame)}부터 ${clip.duration.toFixed(1)}초${selectedAutomationIds.size ? `, 키프레임 ${selectedAutomationIds.size}개 선택됨` : ''}`}
      title={selectedAutomationIds.size ? `키프레임 ${selectedAutomationIds.size}개 · ←/→ 시간 · ↑/↓ 값 · Shift 10배 · N 정규화 · F 평탄화 · [/] 변화폭 · M 팬 반전 · S 부드럽게 · T 포인트 줄이기 · Delete 삭제 · 1~6 보간 · E 보간 순환 · R 시간 반전 · D 균등 배치 · V 값 반전` : `${clip.name} · ${clip.duration.toFixed(1)}초`}
    >
      <span className="clip-accent" />
      <span className="trim-handle start" onPointerDown={(event) => beginTrim(event, 'start')} />
      <span className="trim-handle end" onPointerDown={(event) => beginTrim(event, 'end')} />
      {draftTransitionIn && draftTransitionIn.type !== 'none' && draftTransitionIn.duration > 0 && <span className={`clip-transition-region in easing-${draftTransitionIn.easing ?? 'ease-in-out'} ${selectedTransitionEdge === 'in' ? 'selected' : ''}`} style={{ width: `${Math.min(100, transitionInsideDuration('in', draftTransitionIn) / Math.max(0.001, clip.duration) * 100)}%` }} title={`시작 전환 · ${draftTransitionIn.type} · ${draftTransitionIn.duration.toFixed(2)}s · ${transitionAlignmentLabel('in', draftTransitionIn)} · ${draftTransitionIn.easing ?? 'ease-in-out'} · ${draftTransitionIn.audioCurve ?? 'equal-power'}`} />}
      {draftTransitionOut && draftTransitionOut.type !== 'none' && draftTransitionOut.duration > 0 && <span className={`clip-transition-region out easing-${draftTransitionOut.easing ?? 'ease-in-out'} ${selectedTransitionEdge === 'out' ? 'selected' : ''}`} style={{ width: `${Math.min(100, transitionInsideDuration('out', draftTransitionOut) / Math.max(0.001, clip.duration) * 100)}%` }} title={`끝 전환 · ${draftTransitionOut.type} · ${draftTransitionOut.duration.toFixed(2)}s · ${transitionAlignmentLabel('out', draftTransitionOut)} · ${draftTransitionOut.easing ?? 'ease-in-out'} · ${draftTransitionOut.audioCurve ?? 'equal-power'}`} />}
      {supportsAudioFade && draftAudioAdjustment.fadeIn > 0 && <span className={`clip-audio-fade-region in curve-${draftAudioAdjustment.fadeInCurve ?? 'linear'}`} style={{ width: `${Math.min(100, draftAudioAdjustment.fadeIn / Math.max(.001, clip.duration) * 100)}%` }} />}
      {supportsAudioFade && draftAudioAdjustment.fadeOut > 0 && <span className={`clip-audio-fade-region out curve-${draftAudioAdjustment.fadeOutCurve ?? 'linear'}`} style={{ width: `${Math.min(100, draftAudioAdjustment.fadeOut / Math.max(.001, clip.duration) * 100)}%` }} />}
      {selected && supportsAudioFade && <span className="clip-audio-fade-controls"><span role="button" tabIndex={-1} className="clip-audio-fade-handle in" style={{ left: `${Math.min(100, draftAudioAdjustment.fadeIn / Math.max(.001, clip.duration) * 100)}%` }} onPointerDown={(event) => beginAudioFadeResize('in', event)} onDoubleClick={(event) => cycleAudioFadeCurve('in', event)} onContextMenu={(event) => clearAudioFade('in', event)} title={`페이드 인 ${draftAudioAdjustment.fadeIn.toFixed(2)}s · ${draftAudioAdjustment.fadeInCurve ?? 'linear'} · 드래그 길이 · 더블클릭 곡선 · 우클릭 제거`} /><span role="button" tabIndex={-1} className="clip-audio-fade-handle out" style={{ right: `${Math.min(100, draftAudioAdjustment.fadeOut / Math.max(.001, clip.duration) * 100)}%` }} onPointerDown={(event) => beginAudioFadeResize('out', event)} onDoubleClick={(event) => cycleAudioFadeCurve('out', event)} onContextMenu={(event) => clearAudioFade('out', event)} title={`페이드 아웃 ${draftAudioAdjustment.fadeOut.toFixed(2)}s · ${draftAudioAdjustment.fadeOutCurve ?? 'linear'} · 드래그 길이 · 더블클릭 곡선 · 우클릭 제거`} /></span>}
      <span className="clip-keyframe-marquee-surface" onPointerDown={beginAutomationMarquee} title="Shift+드래그: 키프레임 사각형 선택 · Shift+Alt+드래그: 시간 범위의 모든 키프레임 선택 · Ctrl/Cmd 추가 선택">{automationSelectionBox && <i className="clip-keyframe-selection-box" style={automationSelectionBox} />}</span>
      {selectedAutomationIds.size > 0 && <span className="clip-keyframe-actions" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); focusClip(event.currentTarget) }}><b title="선택된 키프레임 수">{selectedAutomationIds.size}</b><span role="button" tabIndex={-1} onClick={deleteSelectedAutomation} title="선택 키프레임 삭제 (Delete)">×</span>{audioEnvelopeView && <span role="button" tabIndex={-1} onClick={() => applySelectedAudioValueOperation('normalize')} title="선택 오디오 값 정규화 (N)">N</span>}{audioEnvelopeView && selectedAutomationIds.size > 1 && <span role="button" tabIndex={-1} onClick={() => applySelectedAudioValueOperation('flatten')} title="선택 오디오 값을 평균으로 평탄화 (F)">F</span>}{audioEnvelopeView && selectedAutomationIds.size > 1 && <><span role="button" tabIndex={-1} onClick={() => applySelectedAudioValueOperation('compress')} title="선택 오디오 변화폭 축소 ([)">−A</span><span role="button" tabIndex={-1} onClick={() => applySelectedAudioValueOperation('expand')} title="선택 오디오 변화폭 확대 (])">+A</span></>}{audioEnvelopeView && selectedAutomationIds.size > 2 && <><span role="button" tabIndex={-1} onClick={() => processSelectedAudioAutomation('smooth')} title="선택 오디오 자동화 부드럽게 (S)">≈</span><span role="button" tabIndex={-1} onClick={() => processSelectedAudioAutomation('thin')} title="불필요한 선택 포인트 줄이기 (T)">▽</span></>}{audioEnvelopeView === 'pan' && <span role="button" tabIndex={-1} onClick={() => applySelectedAudioValueOperation('mirror-pan')} title="선택 팬 좌우 반전 (M)">M</span>}{selectedAutomationIds.size > 1 && <><span role="button" tabIndex={-1} onClick={() => applySelectedAutomationOperation('reverse-time')} title="선택 키프레임 시간 순서 뒤집기 (R)">⇄</span><span role="button" tabIndex={-1} onClick={() => applySelectedAutomationOperation('distribute-time')} title="선택 키프레임 동일 간격 배치 (D)">≡</span><span role="button" tabIndex={-1} onClick={() => applySelectedAutomationOperation('reverse-values')} title="시간을 유지하고 선택 키프레임 값 순서 뒤집기 (V)">↕</span></>}</span>}
      {selected && <span className="clip-transition-controls"><span role="button" tabIndex={0} className={`clip-transition-handle in ${draftTransitionIn?.type && draftTransitionIn.type !== 'none' ? 'active' : ''} ${selectedTransitionEdge === 'in' ? 'selected' : ''}`} style={{ left: `${Math.min(100, transitionInsideDuration('in', draftTransitionIn) / Math.max(.001, clip.duration) * 100)}%` }} onFocus={() => setSelectedTransitionEdge('in')} onPointerDown={(event) => beginTransitionResize('in', event)} onKeyDown={(event) => handleTransitionKeyDown('in', event)} onDoubleClick={(event) => cycleTransitionType('in', event)} onContextMenu={(event) => cycleTransitionEasing('in', event)} title={`시작 전환 선택 · 드래그 길이 · ←/→ 1프레임 · Shift+←/→ 10프레임 · A 컷 정렬 · E 곡선 · Delete 제거 · 더블클릭 종류${draftTransitionIn?.type && draftTransitionIn.type !== 'none' ? ` · ${draftTransitionIn.type} ${(draftTransitionIn.duration ?? 0).toFixed(2)}s · ${transitionAlignmentLabel('in', draftTransitionIn)} · ${draftTransitionIn.easing ?? 'ease-in-out'}` : ''}`} /><span role="button" tabIndex={0} className={`clip-transition-handle out ${draftTransitionOut?.type && draftTransitionOut.type !== 'none' ? 'active' : ''} ${selectedTransitionEdge === 'out' ? 'selected' : ''}`} style={{ right: `${Math.min(100, transitionInsideDuration('out', draftTransitionOut) / Math.max(.001, clip.duration) * 100)}%` }} onFocus={() => setSelectedTransitionEdge('out')} onPointerDown={(event) => beginTransitionResize('out', event)} onKeyDown={(event) => handleTransitionKeyDown('out', event)} onDoubleClick={(event) => cycleTransitionType('out', event)} onContextMenu={(event) => cycleTransitionEasing('out', event)} title={`끝 전환 선택 · 드래그 길이 · ←/→ 1프레임 · Shift+←/→ 10프레임 · A 컷 정렬 · E 곡선 · Delete 제거 · 더블클릭 종류${draftTransitionOut?.type && draftTransitionOut.type !== 'none' ? ` · ${draftTransitionOut.type} ${(draftTransitionOut.duration ?? 0).toFixed(2)}s · ${transitionAlignmentLabel('out', draftTransitionOut)} · ${draftTransitionOut.easing ?? 'ease-in-out'}` : ''}`} /></span>}
      {clip.adrCompRanges?.map((range, index) => <span key={`${range.start}-${range.end}-${index}`} className="adr-comp-range" style={{ left: `${Math.max(0, (range.start - clip.start) / clip.duration * 100)}%`, width: `${Math.max(0, Math.min(100, (range.end - range.start) / clip.duration * 100))}%` }} />)}
      {opacityEnvelope && <span className="clip-opacity-envelope"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline className="clip-opacity-line-hit" points={opacityEnvelopePoints} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={addOpacityPoint} /><polyline className="clip-opacity-line" points={opacityEnvelopePoints} /></svg>{sortedTransforms.map((keyframe) => <span role="button" tabIndex={-1} key={keyframe.id} className={`clip-opacity-point easing-${keyframe.easing} ${selectedAutomationIds.has(keyframe.id) ? 'selected' : ''}`} style={{ left: `${keyframe.time / Math.max(.001, clip.duration) * 100}%`, top: `${opacityValueToPercent(keyframe.transform.opacity)}%` }} onPointerDown={(event) => beginOpacityPointMove(keyframe, event)} onDoubleClick={(event) => cycleOpacityPointEasing(keyframe, event)} onContextMenu={(event) => removeOpacityPoint(keyframe, event)} title={`${keyframe.time.toFixed(2)}s · 불투명도 ${keyframe.transform.opacity.toFixed(1)}% · ${keyframe.easing} · Shift/Ctrl 복수 선택 · 드래그 이동 · 더블클릭 이징 · 우클릭 삭제`} />)}</span>}
      {speedEnvelope && <span className="clip-speed-envelope"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline className="clip-speed-line-hit" points={speedEnvelopePoints} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={addSpeedPoint} /><polyline className="clip-speed-line" points={speedEnvelopePoints} /></svg>{sortedSpeed.map((keyframe) => <span role="button" tabIndex={-1} key={keyframe.id} className={`clip-speed-point easing-${keyframe.easing} ${selectedAutomationIds.has(keyframe.id) ? 'selected' : ''}`} style={{ left: `${keyframe.time / Math.max(.001, clip.duration) * 100}%`, top: `${speedRateToPercent(keyframe.rate)}%` }} onPointerDown={(event) => beginSpeedPointMove(keyframe, event)} onDoubleClick={(event) => cycleSpeedPointEasing(keyframe, event)} onContextMenu={(event) => removeSpeedPoint(keyframe, event)} title={`${keyframe.time.toFixed(2)}s · 속도 ${(keyframe.rate * 100).toFixed(0)}% · ${keyframe.easing} · Shift/Ctrl 복수 선택 · 드래그 이동 · 더블클릭 이징 · 우클릭 삭제`} />)}</span>}
      {audioEnvelopeView && <span className={`clip-audio-envelope ${audioEnvelopeView}`}><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline className="clip-audio-line-hit" points={audioEnvelopePoints} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={addAudioMixPoint} /><polyline className="clip-audio-line" points={audioEnvelopePoints} /></svg>{sortedAudioMix.map((keyframe) => <span role="button" tabIndex={-1} key={keyframe.id} className={`clip-audio-point easing-${keyframe.easing} ${selectedAutomationIds.has(keyframe.id) ? 'selected' : ''} ${(audioEnvelopeView === 'gain' ? keyframe.gainDb <= -60 || keyframe.gainDb >= 24 : Math.abs(keyframe.pan) >= 100) ? 'value-limited' : ''}`} style={{ left: `${keyframe.time / Math.max(.001, clip.duration) * 100}%`, top: `${audioValueToPercent(keyframe)}%` }} onPointerDown={(event) => beginAudioMixPointMove(keyframe, event)} onDoubleClick={(event) => cycleAudioMixPointEasing(keyframe, event)} onContextMenu={(event) => removeAudioMixPoint(keyframe, event)} title={`${keyframe.time.toFixed(2)}s · ${audioEnvelopeView === 'gain' ? `${keyframe.gainDb.toFixed(1)} dB` : `팬 ${keyframe.pan.toFixed(0)}`} · ${keyframe.easing} · Shift/Ctrl 복수 선택 · 드래그 이동 · 더블클릭 이징 · 우클릭 삭제`} />)}</span>}
      <span className="clip-keyframe-overlay">{automationMarkers.map((marker) => <span role="button" tabIndex={-1} key={`${marker.kind}-${marker.id}`} className={`clip-keyframe-marker ${marker.kind} ${selectedAutomationIds.has(marker.id) ? 'selected' : ''}`} style={{ left: `${Math.max(0, Math.min(100, marker.time / Math.max(0.001, clip.duration) * 100))}%` }} title={`${marker.label} 키프레임 · ${marker.time.toFixed(2)}s · Shift/Ctrl 복수 선택 · 드래그 함께 이동 · Alt+드래그 간격 비례 조절 · 더블클릭 선택 보간 · 우클릭 삭제`} onPointerDown={(event) => beginKeyframeMove(event, marker)} onDoubleClick={(event) => cycleAutomationMarkersEasing(marker, event)} onContextMenu={(event) => removeAutomationMarkers(marker, event)} />)}</span>
      <span className="clip-marker-overlay">{(clip.clipMarkers ?? []).map((marker) => <span role="button" tabIndex={-1} key={marker.id} className="clip-source-marker" style={{ left: `${Math.max(0, Math.min(100, marker.time / Math.max(0.001, clip.duration) * 100))}%`, '--clip-marker-color': marker.color } as CSSProperties} title={`${marker.label} · ${marker.time.toFixed(2)}s · 드래그 이동 · 더블 클릭 삭제`} onPointerDown={(event) => beginClipMarkerMove(event, marker)} onDoubleClick={(event) => { event.stopPropagation(); if (!locked) onRemoveClipMarker(marker.id) }} />)}</span>
      <strong>{clip.name}</strong>
      {clip.enabled === false && <span className="clip-disabled-badge">비활성</span>}
      <small>{clip.duration.toFixed(1)}s</small>
      {(clip.groupId || clip.linkGroupId) && <span className="clip-link-badge"><Link2 size={8} /></span>}
      {clip.adrTake !== undefined && <span className="clip-adr-badge">ADR T{clip.adrTake}{clip.audioDisabled ? ' · 대기' : clip.adrCompRanges && (clip.adrCompRanges.length > 1 || clip.adrCompRanges.some((range) => range.start > clip.start + 0.02 || range.end < clip.start + clip.duration - 0.02)) ? ' · 컴프' : ' · 채택'}</span>}
      {automationMarkers.length ? <span className="clip-keyframe-badge">◆ {automationMarkers.length}</span> : null}
      {clip.kind === 'video' && asset?.thumbnailUrl && <span className="thumbnail-strip" style={{ backgroundImage: `url(${asset.thumbnailUrl})` }} />}
      {clip.kind === 'audio' && asset?.waveform ? (
        <span className="waveform-bars">
          {asset.waveform.filter((_, index) => index % 4 === 0).map((level, index) => <i key={index} style={{ height: `${Math.max(5, level * 100)}%` }} />)}
        </span>
      ) : clip.kind === 'audio' ? <span className="wave-pattern" /> : null}
    </button>
  )
}

export function Timeline({
  tracks,
  assets,
  selectedClipId,
  selectedClipIds,
  selectedClipLocked = false,
  performanceHealth,
  markers,
  editMode,
  activeTool,
  trimMode,
  snapEnabled,
  linkedSelectionEnabled,
  selectionFollowsPlayhead,
  selectedTrackId,
  playhead,
  duration,
  fps,
  timecodeStart,
  timecodeDropFrame,
  workArea,
  loopWorkArea,
  zoom,
  onZoomChange,
  onSelectClip,
  onSelectClips,
  onSeek,
  onMarkWorkAreaIn,
  onMarkWorkAreaOut,
  onUpdateWorkArea,
  onToggleWorkAreaLoop,
  onLiftWorkArea,
  onExtractWorkArea,
  onMoveClip,
  onTrimClip,
  onUpdateClip,
  onSplit,
  onAddEditTarget,
  onAddEditAll,
  onSelectTrackForward,
  onSelectTrackBackward,
  onSelectAllTracksForward,
  onSelectAllTracksBackward,
  onSeekPreviousEdit,
  onSeekNextEdit,
  onDelete,
  onToggleSelectedClipsEnabled,
  onSetSelectedClipsColor,
  onRippleDelete,
  onCloseGap,
  onCut,
  onCopy,
  onPaste,
  onPasteAttributes,
  onDuplicate,
  onArrangeSelectedClips,
  onMatchSelectedLoudness,
  canPaste,
  canPasteAttributes,
  onToggleTrackMute,
  onToggleTrackLock,
  onToggleTrackSyncLock,
  onToggleTrackVisibility,
  onToggleTrackSolo,
  onToggleTrackTarget,
  onToggleTrackEditTarget,
  onSetAllTrackEditTargets,
  onSetAllTrackSyncLocks,
  onSetTrackHeight,
  onSetAllTrackHeights,
  onSelectTrack,
  onUpdateTrack,
  onUpdateTrackTransient,
  onUpdateClipTransient,
  onEditModeChange,
  onToolChange,
  onTrimModeChange,
  onToggleSnap,
  onToggleLinkedSelection,
  onToggleSelectionFollowsPlayhead,
  onSelectEditPoint,
  onAddTrack,
  onRemoveTrack,
  onMoveTrack,
  onDuplicateTrack,
  onAddMarker,
  onAddClipMarker,
  onMatchFrame,
  onUpdateClipMarker,
  onRemoveClipMarker,
  onAddRangeMarker,
  onUpdateMarker,
  onRemoveMarker,
  onLinkClips,
  onUnlinkClip,
  onGroupClips,
  onUngroupClip,
  onAddAdjustmentLayer,
  onAddTitle,
  onNestActiveClips,
  onOpenNestedSequence,
  onDetachAudio,
  onRenderAndReplace,
  onCancelRenderAndReplace,
  onRestoreRenderedClip,
  renderReplacing,
  renderReplaceProgress,
  renderReplaceStage,
  onCreateMulticam,
  onSwitchMulticamAngle,
  multicamAngleCount,
  onSwitchMulticamAudioAngle,
  multicamAudioAngles,
  onSyncByWaveform,
  onSyncByClap,
  onSyncByTimecode,
  onRazorClip,
}: TimelineProps) {
  const [titleTemplate, setTitleTemplate] = useState<TitleTemplate>('headline')
  const [selectionBox, setSelectionBox] = useState<{ left: number; top: number; width: number; height: number }>()
  const [editPointEdge, setEditPointEdge] = useState<'start' | 'end'>('end')
  const [editPointDraft, setEditPointDraft] = useState(0)
  const [editPointTimecodeDraft, setEditPointTimecodeDraft] = useState('00:00:00:00')
  const [clipStartTimecodeDraft, setClipStartTimecodeDraft] = useState('00:00:00:00')
  const [markerWorkspaceOpen, setMarkerWorkspaceOpen] = useState(false)
  const [clipMarkerWorkspaceOpen, setClipMarkerWorkspaceOpen] = useState(false)
  const [selectedMarkerId, setSelectedMarkerId] = useState<string>()
  const [selectedClipMarkerId, setSelectedClipMarkerId] = useState<string>()
  const [playheadDraft, setPlayheadDraft] = useState(formatMediaTimecode(timecodeStart + playhead, fps, timecodeDropFrame))
  const [dragTargetTrackId, setDragTargetTrackId] = useState<string>()
  const [snapGuideTime, setSnapGuideTime] = useState<number>()
  const [markerFilter, setMarkerFilter] = useState<'all' | TimelineMarker['kind']>('all')
  const [arrangeMode, setArrangeMode] = useState<'align-start' | 'align-end' | 'align-playhead' | 'distribute' | 'remove-gaps'>('align-start')
  const [loudnessTarget, setLoudnessTarget] = useState(-16)
  const [searchOpen, setSearchOpen] = useState(false)
  const [timelineQuery, setTimelineQuery] = useState('')
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1)
  const [automationViews, setAutomationViews] = useState<Record<string, TrackAutomationView>>({})
  const [clipAudioEnvelopeView, setClipAudioEnvelopeView] = useState<'none' | 'gain' | 'pan'>('gain')
  const [clipVideoEnvelopeView, setClipVideoEnvelopeView] = useState<'none' | 'opacity' | 'speed'>('none')
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackHeadersRef = useRef<HTMLDivElement>(null)
  const pixelsPerSecond = zoom
  const contentWidth = duration * pixelsPerSecond
  const trackRowTemplate = `28px ${tracks.map((track) => `${clamp(track.displayHeight ?? 64, 40, 180)}px`).join(' ')}`
  const marks = useMemo(() => Array.from({ length: Math.floor(duration / 5) + 1 }, (_, index) => index * 5), [duration])
  const selectedClip = useMemo(() => tracks.flatMap((track) => track.clips).find((clip) => clip.id === selectedClipId), [selectedClipId, tracks])
  const selectedClips = useMemo(() => tracks.flatMap((track) => track.clips).filter((clip) => selectedClipIds.has(clip.id)), [selectedClipIds, tracks])
  const selectedClipsEnabled = selectedClips.every((clip) => clip.enabled !== false)
  const filteredMarkers = useMemo(() => markers.filter((marker) => markerFilter === 'all' || marker.kind === markerFilter).sort((left, right) => left.time - right.time), [markerFilter, markers])
  const timelineSearchResults = useMemo(() => {
    const query = timelineQuery.trim().toLocaleLowerCase('ko-KR')
    if (!query) return []
    const clipResults = tracks.flatMap((track) => track.clips.flatMap((clip) => {
      const asset = clip.assetId ? assets.find((candidate) => candidate.id === clip.assetId) : undefined
      const searchable = `${clip.name} ${track.name} ${clip.speaker ?? ''} ${asset?.name ?? ''} ${(asset?.tags ?? []).join(' ')} ${asset?.notes ?? ''}`.toLocaleLowerCase('ko-KR')
      if (!searchable.includes(query)) return []
      return [{ id: `clip-${clip.id}`, type: 'clip' as const, time: clip.start, end: clip.start + clip.duration, label: clip.name, detail: `${track.name} · ${clip.kind === 'caption' ? '자막' : clip.kind === 'audio' ? '오디오' : '영상'}`, clipId: clip.id }]
    }))
    const clipMarkerResults = tracks.flatMap((track) => track.clips.flatMap((clip) => (clip.clipMarkers ?? []).flatMap((marker) => `${marker.label} ${marker.description ?? ''}`.toLocaleLowerCase('ko-KR').includes(query) ? [{ id: `clip-marker-${clip.id}-${marker.id}`, type: 'clip-marker' as const, time: clip.start + marker.time, end: clip.start + marker.time + (marker.duration ?? 0), label: marker.label, detail: `${clip.name} · 클립 마커`, clipId: clip.id }] : [])))
    const markerResults = markers.flatMap((marker) => `${marker.label} ${marker.description ?? ''} ${marker.author ?? ''}`.toLocaleLowerCase('ko-KR').includes(query) ? [{ id: `marker-${marker.id}`, type: 'marker' as const, time: marker.time, end: marker.time + (marker.duration ?? 0), label: marker.label, detail: marker.kind === 'chapter' ? '챕터 마커' : marker.kind === 'comment' ? '검토 코멘트' : '편집 마커', markerId: marker.id }] : [])
    return [...clipResults, ...clipMarkerResults, ...markerResults].sort((left, right) => left.time - right.time || left.label.localeCompare(right.label, 'ko-KR'))
  }, [assets, markers, timelineQuery, tracks])
  const timelineSnapTargets = useMemo(() => [
    0,
    playhead,
    ...(workArea ? [workArea.start, workArea.end] : []),
    ...markers.flatMap((marker) => [marker.time, ...(marker.duration ? [marker.time + marker.duration] : [])]),
    ...tracks.flatMap((track) => track.clips.flatMap((clip) => [clip.start, clip.start + clip.duration])),
  ], [markers, playhead, tracks, workArea])
  const selectedMarker = markers.find((marker) => marker.id === selectedMarkerId)
  const selectedClipMarker = selectedClip?.clipMarkers?.find((marker) => marker.id === selectedClipMarkerId)
  const selectedEditPointTime = selectedClip ? editPointEdge === 'start' ? selectedClip.start : selectedClip.start + selectedClip.duration : 0
  const formatSequenceTimecode = (time: number) => formatMediaTimecode(timecodeStart + Math.max(0, time), fps, timecodeDropFrame)
  const parseSequenceTimecode = (value: string, currentTime: number): number | undefined => {
    const input = value.trim()
    if (!input) return undefined
    if (input.startsWith('+') || input.startsWith('-')) return parseTimelineTimecode(input, fps, currentTime)
    const compact = /^\d{3,8}$/.test(input) ? input.padStart(8, '0') : undefined
    const absolute = compact
      ? `${compact.slice(0, 2)}:${compact.slice(2, 4)}:${compact.slice(4, 6)}${timecodeDropFrame ? ';' : ':'}${compact.slice(6, 8)}`
      : input.includes(':') || input.includes(';') ? input : undefined
    if (absolute) {
      const parsed = parseMediaTimecode(absolute, fps)
      return parsed ? Math.round((parsed.seconds - timecodeStart) * fps) / fps : undefined
    }
    return parseTimelineTimecode(input, fps, currentTime)
  }
  useEffect(() => { setEditPointDraft(selectedEditPointTime); setEditPointTimecodeDraft(formatSequenceTimecode(selectedEditPointTime)) }, [fps, selectedEditPointTime, timecodeDropFrame, timecodeStart])
  useEffect(() => setClipStartTimecodeDraft(formatSequenceTimecode(selectedClip?.start ?? 0)), [fps, selectedClip?.start, timecodeDropFrame, timecodeStart])
  useEffect(() => setSelectedClipMarkerId(undefined), [selectedClipId])
  useEffect(() => setPlayheadDraft(formatSequenceTimecode(playhead)), [fps, playhead, timecodeDropFrame, timecodeStart])
  useEffect(() => setActiveSearchIndex(-1), [timelineQuery])
  useEffect(() => {
    const openTimelineSearch = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return
      event.preventDefault()
      setSearchOpen(true)
    }
    window.addEventListener('keydown', openTimelineSearch)
    return () => window.removeEventListener('keydown', openTimelineSearch)
  }, [])
  const revealSearchResult = (index: number) => {
    if (!timelineSearchResults.length) return
    const nextIndex = (index + timelineSearchResults.length) % timelineSearchResults.length
    const result = timelineSearchResults[nextIndex]
    setActiveSearchIndex(nextIndex)
    onSeek(result.time)
    if ('clipId' in result) onSelectClip(result.clipId, false)
    if ('markerId' in result) { setSelectedMarkerId(result.markerId); setMarkerWorkspaceOpen(true) }
  }
  const commitPlayheadDraft = () => {
    const parsed = parseSequenceTimecode(playheadDraft, playhead)
    if (parsed === undefined) {
      setPlayheadDraft(formatSequenceTimecode(playhead))
      return
    }
    const next = clamp(parsed, 0, duration)
    onSeek(next)
    setPlayheadDraft(formatSequenceTimecode(next))
  }
  const commitEditPoint = (time: number) => {
    if (!selectedClip || selectedClipLocked) return
    const minimum = editPointEdge === 'start' ? 0 : selectedClip.start + 1 / fps
    const maximum = editPointEdge === 'start' ? selectedClip.start + selectedClip.duration - 1 / fps : duration
    const snapped = Math.round(clamp(time, minimum, maximum) * fps) / fps
    setEditPointDraft(snapped)
    onTrimClip(selectedClip.id, editPointEdge, snapped)
    onSeek(snapped)
  }
  const nudgeEditPoint = (frames: number) => commitEditPoint(selectedEditPointTime + frames / fps)
  const commitEditPointTimecode = () => {
    const parsed = parseSequenceTimecode(editPointTimecodeDraft, selectedEditPointTime)
    if (parsed === undefined) {
      setEditPointTimecodeDraft(formatSequenceTimecode(selectedEditPointTime))
      return
    }
    commitEditPoint(parsed)
  }
  const commitClipStartTimecode = () => {
    if (!selectedClip || selectedClipLocked) return
    const parsed = parseSequenceTimecode(clipStartTimecodeDraft, selectedClip.start)
    if (parsed === undefined) {
      setClipStartTimecodeDraft(formatSequenceTimecode(selectedClip.start))
      return
    }
    const next = clamp(parsed, 0, duration)
    onMoveClip(selectedClip.id, next)
    onSeek(next)
  }

  const seekFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activeTool === 'hand') {
      event.preventDefault()
      const viewport = scrollRef.current
      if (!viewport) return
      const canvas = event.currentTarget
      const pointerId = event.pointerId
      const originX = event.clientX
      const originY = event.clientY
      const originLeft = viewport.scrollLeft
      const originTop = viewport.scrollTop
      canvas.setPointerCapture(pointerId)
      const cleanup = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', stop)
        window.removeEventListener('pointercancel', stop)
        if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId)
      }
      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        viewport.scrollLeft = originLeft - (moveEvent.clientX - originX)
        viewport.scrollTop = originTop - (moveEvent.clientY - originY)
      }
      const stop = (stopEvent: PointerEvent) => { if (stopEvent.pointerId === pointerId) cleanup() }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', stop)
      window.addEventListener('pointercancel', stop)
      return
    }
    if (activeTool === 'zoom') {
      event.preventDefault()
      const viewport = scrollRef.current
      if (!viewport) return
      const rect = event.currentTarget.getBoundingClientRect()
      const focusTime = clamp((event.clientX - rect.left) / pixelsPerSecond, 0, duration)
      const viewportRect = viewport.getBoundingClientRect()
      const focusOffset = event.clientX - viewportRect.left
      const nextZoom = clamp(event.altKey ? pixelsPerSecond / 1.5 : pixelsPerSecond * 1.5, 6, 80)
      onZoomChange(nextZoom)
      requestAnimationFrame(() => { viewport.scrollLeft = Math.max(0, focusTime * nextZoom - focusOffset) })
      return
    }
    if ((event.target as HTMLElement).closest('.timeline-clip')) return
    const rect = event.currentTarget.getBoundingClientRect()
    onSeek(clamp((event.clientX - rect.left) / pixelsPerSecond, 0, duration))
    if (event.button !== 0 || (event.target as HTMLElement).closest('.timeline-marker')) return
    const canvas = event.currentTarget
    const pointerId = event.pointerId
    const originX = event.clientX
    const originY = event.clientY
    const additive = event.ctrlKey || event.metaKey || event.shiftKey
    let moved = false
    canvas.setPointerCapture(pointerId)
    const cleanup = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleCancel)
      if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId)
    }
    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      const left = Math.min(originX, moveEvent.clientX) - rect.left
      const top = Math.min(originY, moveEvent.clientY) - rect.top
      const width = Math.abs(moveEvent.clientX - originX)
      const height = Math.abs(moveEvent.clientY - originY)
      moved = moved || width > 4 || height > 4
      if (moved) setSelectionBox({ left, top, width, height })
    }
    const handleUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return
      cleanup()
      if (!moved) {
        onSelectClips([], additive)
        setSelectionBox(undefined)
        return
      }
      const box = {
        left: Math.min(originX, upEvent.clientX),
        right: Math.max(originX, upEvent.clientX),
        top: Math.min(originY, upEvent.clientY),
        bottom: Math.max(originY, upEvent.clientY),
      }
      const ids = [...canvas.querySelectorAll<HTMLElement>('[data-clip-id]')].flatMap((element) => {
        const bounds = element.getBoundingClientRect()
        const intersects = bounds.right >= box.left && bounds.left <= box.right && bounds.bottom >= box.top && bounds.top <= box.bottom
        return intersects && element.dataset.clipId ? [element.dataset.clipId] : []
      })
      onSelectClips(ids, additive)
      setSelectionBox(undefined)
    }
    const handleCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return
      cleanup()
      setSelectionBox(undefined)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleCancel)
  }

  useEffect(() => {
    const viewport = scrollRef.current
    if (!viewport) return
    const x = playhead * pixelsPerSecond
    if (x < viewport.scrollLeft || x > viewport.scrollLeft + viewport.clientWidth - 40) {
      viewport.scrollLeft = Math.max(0, x - viewport.clientWidth * 0.25)
    }
  }, [playhead, pixelsPerSecond])

  return (
    <section className={`timeline-panel panel-surface tool-${activeTool}`}>
      <div className="timeline-toolbar">
        <div className="timeline-tools">
          <button className={`tool-button ${activeTool === 'selection' ? 'active' : ''}`} onClick={() => onToolChange('selection')} title="선택 도구 (V)"><MousePointer2 size={14} /> 선택</button>
          <button className={`tool-button ${activeTool === 'razor' ? 'active' : ''}`} onClick={() => onToolChange('razor')} title="면도날 도구 · 클립을 클릭한 프레임에서 분할 (C)"><Scissors size={14} /> 면도날</button>
          <button className={`tool-button ${activeTool === 'hand' ? 'active' : ''}`} onClick={() => onToolChange('hand')} title="손바닥 도구 · 타임라인 끌어 이동 (H)"><Hand size={14} /></button>
          <button className={`tool-button ${activeTool === 'zoom' ? 'active' : ''}`} onClick={() => onToolChange('zoom')} title="확대 도구 · Alt 클릭은 축소 (Z)"><ZoomIn size={14} /></button>
          <button className={`tool-button ${snapEnabled ? 'active' : ''}`} onClick={onToggleSnap} title="스냅"><Magnet size={15} /> 스냅</button>
          <button className={`tool-button ${linkedSelectionEnabled ? 'active' : ''}`} onClick={onToggleLinkedSelection} title="연결된 영상·오디오를 함께 선택·이동·분할"><Link2 size={14} /> 연결 선택</button>
          <button className={`tool-button ${selectionFollowsPlayhead ? 'active' : ''}`} onClick={onToggleSelectionFollowsPlayhead} title="재생 헤드 아래의 편집 대상 클립 자동 선택">헤드 추종</button>
          <span className="edit-mode-group" aria-label="타임라인 추가 방식">
            {(['append', 'insert', 'overwrite'] as const).map((mode) => <button key={mode} className={editMode === mode ? 'active' : ''} onClick={() => onEditModeChange(mode)}>{mode === 'append' ? '뒤에' : mode === 'insert' ? '삽입' : '덮어쓰기'}</button>)}
          </span>
          <select className="trim-mode-select" value={trimMode} onChange={(event) => onTrimModeChange(event.target.value as TrimMode)} title="트림 도구"><option value="normal">일반 트림</option><option value="ripple">리플 트림</option><option value="roll">롤 트림</option><option value="slip">슬립</option><option value="slide">슬라이드</option><option value="rate-stretch">속도 늘이기 (R)</option></select>
          <button className="tool-button" onClick={onSplit} disabled={!selectedClipId || selectedClipLocked} title="재생 헤드에서 분할 (S)"><Scissors size={15} /> 분할</button>
          <button className="tool-button" onClick={onAddEditTarget} title="소스 대상 트랙에 편집점 추가 (Ctrl/Cmd+K)">편집점</button>
          <button className="tool-button" onClick={onAddEditAll} title="모든 잠금 해제 트랙에 편집점 추가 (Ctrl/Cmd+Shift+K)">전체 편집점</button>
          <button className="tool-button" onClick={onSelectTrackForward} title="선택 트랙에서 재생 헤드부터 앞으로 선택 (A)">트랙 →</button>
          <button className="tool-button" onClick={onSelectTrackBackward} title="선택 트랙에서 재생 헤드까지 뒤로 선택 (Shift+A)">← 트랙</button>
          <button className="tool-button" onClick={onSelectAllTracksForward} title="모든 트랙에서 재생 헤드부터 앞으로 선택 (Alt+A)">전체 →</button>
          <button className="tool-button" onClick={onSelectAllTracksBackward} title="모든 트랙에서 재생 헤드까지 뒤로 선택 (Alt+Shift+A)">← 전체</button>
          <button className="tool-button" onClick={onSeekPreviousEdit} title="소스 대상 트랙의 이전 편집점으로 이동 (↑)">이전 컷</button>
          <button className="tool-button" onClick={onSeekNextEdit} title="소스 대상 트랙의 다음 편집점으로 이동 (↓)">다음 컷</button>
          <button className="tool-button" onClick={onSelectEditPoint} title="현재 컷의 양쪽 클립 선택 (Shift+E)">컷 선택</button>
          <button className="tool-button danger" onClick={onDelete} disabled={!selectedClipId || selectedClipLocked} title="선택 삭제"><Trash2 size={15} /> 삭제</button>
          <button className={`tool-button ${selectedClipsEnabled ? 'active' : ''}`} onClick={onToggleSelectedClipsEnabled} disabled={!selectedClips.length} title="선택한 모든 클립 활성화/비활성화 (Ctrl/Cmd+Shift+E)">{selectedClipsEnabled ? <Eye size={14} /> : <EyeOff size={14} />} 클립</button>
          <label className="clip-label-control" title="선택한 모든 클립의 라벨 색상 변경"><span>라벨</span><input type="color" value={selectedClip?.color ?? '#7862d6'} disabled={!selectedClips.length} onChange={(event) => onSetSelectedClipsColor(event.target.value)} /></label>
          <button className="tool-button danger" onClick={onRippleDelete} disabled={!selectedClipId || selectedClipLocked} title="선택 구간 리플 삭제 (Shift+Delete)">리플 삭제</button>
          <button className="tool-button" onClick={onCloseGap} title="재생 헤드가 놓인 공통 빈 구간을 닫고 뒤 타임라인 당기기 (Ctrl/Cmd+Backspace)">간격 닫기</button>
          <button className="tool-button" onClick={onCut} disabled={!selectedClipId || selectedClipLocked} title="선택 클립 잘라내기 (Ctrl/Cmd+X)">잘라내기</button>
          <button className="tool-button" onClick={onCopy} disabled={!selectedClipId} title="선택 클립·연결 그룹 복사 (Ctrl/Cmd+C)"><Copy size={14} /> 복사</button>
          <button className="tool-button" onClick={onPaste} disabled={!canPaste} title="재생 헤드에 붙여넣기 (Ctrl/Cmd+V)"><ClipboardPaste size={14} /> 붙여넣기</button>
          <button className="tool-button" onClick={onPasteAttributes} disabled={!canPasteAttributes || !selectedClips.length || selectedClipLocked} title="복사한 클립의 선택 속성을 대상 클립에 적용 (Ctrl/Cmd+Alt+V)"><SlidersHorizontal size={14} /> 속성</button>
          <button className="tool-button" onClick={onDuplicate} disabled={!selectedClipId || selectedClipLocked} title="선택 클립·연결 그룹 복제 (Ctrl/Cmd+D)"><CopyPlus size={14} /> 복제</button>
          <span className="clip-arrange-control"><select value={arrangeMode} onChange={(event) => setArrangeMode(event.target.value as typeof arrangeMode)} aria-label="선택 클립 정렬 방식"><option value="align-start">시작점 정렬</option><option value="align-end">끝점 정렬</option><option value="align-playhead">재생 헤드에 정렬</option><option value="distribute">동일 간격 배치</option><option value="remove-gaps">선택 간격 제거</option></select><button className="tool-button" disabled={selectedClips.length < 2 || selectedClipLocked} onClick={() => onArrangeSelectedClips(arrangeMode)}>정렬</button></span>
          <span className="clip-arrange-control"><select value={loudnessTarget} onChange={(event) => setLoudnessTarget(Number(event.target.value))} aria-label="선택 클립 목표 러드니스"><option value="-14">-14 LUFS</option><option value="-16">-16 LUFS</option><option value="-18">-18 LUFS</option><option value="-23">-23 LUFS</option></select><button className="tool-button" disabled={!selectedClips.some((clip) => !clip.audioDisabled && (clip.kind === 'audio' || clip.kind === 'video')) || selectedClipLocked} onClick={() => onMatchSelectedLoudness(loudnessTarget)}>음량 맞춤</button></span>
          <button className={`tool-button ${clipAudioEnvelopeView !== 'none' ? 'active' : ''}`} disabled={!selectedClip || selectedClip.audioDisabled || (selectedClip.kind !== 'audio' && selectedClip.kind !== 'video')} onClick={() => { setClipVideoEnvelopeView('none'); setClipAudioEnvelopeView((view) => view === 'none' ? 'gain' : view === 'gain' ? 'pan' : 'none') }} title="선택 클립 오디오 엔벌로프 · 클릭: 게인 → 팬 → 숨김">{clipAudioEnvelopeView === 'gain' ? '클립 게인' : clipAudioEnvelopeView === 'pan' ? '클립 팬' : '클립 엔벌로프'}</button>
          <button className={`tool-button ${clipVideoEnvelopeView !== 'none' ? 'active' : ''}`} disabled={!selectedClip || selectedClip.kind === 'audio'} onClick={() => { setClipAudioEnvelopeView('none'); setClipVideoEnvelopeView((view) => selectedClip?.kind === 'caption' ? view === 'opacity' ? 'none' : 'opacity' : view === 'none' ? 'opacity' : view === 'opacity' ? 'speed' : 'none') }} title={selectedClip?.kind === 'caption' ? '선택 자막 불투명도 엔벌로프 표시/숨김' : '선택 클립 비디오 엔벌로프 · 클릭: 불투명도 → 속도 → 숨김'}>{clipVideoEnvelopeView === 'opacity' ? '클립 불투명도' : clipVideoEnvelopeView === 'speed' ? '클립 속도' : '비디오 엔벌로프'}</button>
          <button className="tool-button" onClick={onAddMarker} title="현재 위치에 마커 (M)"><Flag size={14} /> 마커</button>
          <button className={`tool-button ${clipMarkerWorkspaceOpen ? 'active' : ''}`} disabled={!selectedClip} onClick={() => setClipMarkerWorkspaceOpen((open) => !open)} title="선택 클립 내부 마커"><Flag size={13} /> 클립 마커</button>
          <button className="tool-button" disabled={!selectedClip?.assetId || Boolean(selectedClip.nestedSequenceId || selectedClip.adjustmentLayer)} onClick={onMatchFrame} title="재생 헤드의 원본 프레임을 소스 모니터에서 열기 (F)">Match Frame</button>
          <span className="work-area-tools" aria-label="시퀀스 작업 구간"><button className="tool-button" onClick={onMarkWorkAreaIn} title="재생 헤드를 시퀀스 IN으로 지정 (I)">[ IN</button><button className="tool-button" onClick={onMarkWorkAreaOut} title="재생 헤드를 시퀀스 OUT으로 지정 (O)">OUT ]</button><button className="tool-button" disabled={!workArea} onClick={onLiftWorkArea} title="소스 대상 트랙의 작업 구간을 지우고 공백 유지 (;)">Lift</button><button className="tool-button danger" disabled={!workArea} onClick={onExtractWorkArea} title="작업 구간을 리플 삭제하고 뒤 내용을 당김 (')">Extract</button><button className={`tool-button ${loopWorkArea ? 'active' : ''}`} onClick={onToggleWorkAreaLoop} title="작업 구간 반복 재생"><Repeat2 size={13} /> 반복</button>{workArea && <button className="tool-button" onClick={() => onUpdateWorkArea(undefined)} title="작업 구간 해제">범위 해제</button>}</span>
          <button className={`tool-button ${markerWorkspaceOpen ? 'active' : ''}`} onClick={() => setMarkerWorkspaceOpen((open) => !open)} title="마커 작업공간">마커 목록</button>
          <button className={`tool-button ${searchOpen ? 'active' : ''}`} onClick={() => setSearchOpen((open) => !open)} title="클립·자막·마커 검색"><Search size={13} /> 찾기</button>
          <button className="tool-button" onClick={onLinkClips} title="재생 헤드의 클립 연결"><Link2 size={14} /></button>
          <button className="tool-button" onClick={onUnlinkClip} disabled={!selectedClipId} title="선택 클립 연결 해제"><Unlink size={14} /></button>
          <button className="tool-button" onClick={onGroupClips} title="선택 클립 그룹 · 선택이 없으면 재생 헤드 기준 (Ctrl/Cmd+G)">G</button>
          <button className="tool-button" onClick={onUngroupClip} disabled={!selectedClipId} title="선택된 모든 그룹 해제 (Ctrl/Cmd+Shift+G)">G−</button>
          <button className="tool-button" onClick={onAddAdjustmentLayer} title="현재 위치에 5초 조정 레이어 추가">조정 레이어</button>
          <span className="title-template-control"><select value={titleTemplate} onChange={(event) => setTitleTemplate(event.target.value as TitleTemplate)} aria-label="모션 텍스트 템플릿"><option value="headline">헤드라인</option><option value="lower-third">로어 서드</option><option value="quote">인용문</option><option value="subscribe">구독 CTA</option><option value="callout">포인트</option></select><button className="tool-button" onClick={() => onAddTitle(titleTemplate)} title="현재 위치에 선택한 모션 텍스트 추가"><Type size={14} /> 텍스트</button></span>
          <button className="tool-button" onClick={onDetachAudio} disabled={!selectedClipId || selectedClipLocked || selectedClip?.kind !== 'video' || selectedClip.audioDisabled === true} title="선택 영상의 내장 오디오를 연결된 클립으로 분리"><Music2 size={14} /> 오디오 분리</button>
          <button className="tool-button" onClick={onRenderAndReplace} disabled={renderReplacing || !selectedClip || selectedClipLocked || selectedClip.kind !== 'video' || Boolean(selectedClip.renderReplacement)} title={renderReplacing ? `${renderReplaceStage} ${Math.round(renderReplaceProgress * 100)}%` : '선택 영상의 효과와 연결 오디오를 중간 파일로 렌더해 교체'} aria-live="polite">{renderReplacing ? `${renderReplaceStage} ${Math.round(renderReplaceProgress * 100)}%` : 'Render & Replace'}</button>
          {renderReplacing && <button className="tool-button danger" onClick={onCancelRenderAndReplace} title="진행 중인 Render and Replace 취소"><X size={14} /> 렌더 취소</button>}
          <button className="tool-button" onClick={onRestoreRenderedClip} disabled={renderReplacing || !selectedClip?.renderReplacement} title="렌더 교체 전 원본 클립과 효과 복원">원본 복원</button>
          <button className="tool-button" onClick={onCreateMulticam} title="재생 헤드의 비디오 각도를 멀티캠으로 묶기">MC</button>
          <button className="tool-button" onClick={onSyncByWaveform} disabled={!selectedClipId || selectedClipLocked} title="선택 클립을 기준으로 가까운 트랙 클립을 파형 동기화">파형 동기화</button>
          <button className="tool-button" onClick={onSyncByClap} disabled={!selectedClipId || selectedClipLocked} title="선택 클립의 가장 뚜렷한 클랩 피크를 기준으로 동기화">클랩 동기화</button>
          <button className="tool-button" onClick={onSyncByTimecode} disabled={!selectedClipId || selectedClipLocked} title="미디어에 입력한 시작 타임코드를 기준으로 동기화">TC 동기화</button>
          <span className="multicam-angle-buttons" title="선택 멀티캠을 재생 헤드에서 전환">{Array.from({ length: Math.min(9, multicamAngleCount) }, (_, index) => index + 1).map((angle) => <button key={angle} className={selectedClip?.multicamAngle === angle - 1 ? 'active' : ''} onClick={() => onSwitchMulticamAngle(angle - 1)}>{angle}</button>)}</span>
          <span className="multicam-angle-buttons multicam-audio-buttons" title="영상 각도는 유지하고 오디오만 재생 헤드에서 전환">{multicamAudioAngles.slice(0, 9).map((angle) => <button key={angle} className={selectedClip?.multicamAudioMode === 'selected-angle' && selectedClip.multicamAudioAngle === angle ? 'active' : ''} onClick={() => onSwitchMulticamAudioAngle(angle)}>A{angle + 1}</button>)}</span>
          <button className="tool-button" onClick={onNestActiveClips} title="선택 클립을 중첩 시퀀스로 만들기 · 선택이 없으면 재생 헤드 기준 (Ctrl/Cmd+Alt+G)"><Layers3 size={14} /> 중첩</button>
        </div>
        <div className={`timeline-summary ${performanceHealth.level}`} title={performanceHealth.detail}><span className="status-dot" /> {performanceHealth.label} <input className="timeline-timecode-input" aria-label="재생 헤드 타임코드" value={playheadDraft} onChange={(event) => setPlayheadDraft(event.target.value)} onFocus={(event) => event.currentTarget.select()} onBlur={commitPlayheadDraft} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitPlayheadDraft(); event.currentTarget.blur() } else if (event.key === 'Escape') { setPlayheadDraft(formatSequenceTimecode(playhead)); event.currentTarget.blur() } }} title="시퀀스 절대 TC, +/− 상대 TC, 프레임(예: +10f) 입력" /></div>
        <div className="zoom-control">
          <Minus size={14} />
          <input aria-label="타임라인 확대" type="range" min="6" max="80" step="1" value={zoom} onChange={(event) => onZoomChange(Number(event.target.value))} />
          <Plus size={14} />
        </div>
      </div>

      {searchOpen && <div className="timeline-search-workspace">
        <label><Search size={13} /><input autoFocus value={timelineQuery} onChange={(event) => setTimelineQuery(event.target.value)} placeholder="클립 이름, 자막, 미디어 태그, 마커 검색" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); revealSearchResult(activeSearchIndex < 0 ? event.shiftKey ? -1 : 0 : activeSearchIndex + (event.shiftKey ? -1 : 1)) } else if (event.key === 'Escape') setSearchOpen(false) }} /></label>
        <span>{timelineQuery.trim() ? `${timelineSearchResults.length}개 결과${timelineSearchResults.length && activeSearchIndex >= 0 ? ` · ${activeSearchIndex + 1}/${timelineSearchResults.length}` : ''}` : '검색어를 입력하세요'}</span>
        <button disabled={!timelineSearchResults.length} onClick={() => revealSearchResult(activeSearchIndex < 0 ? -1 : activeSearchIndex - 1)}>이전</button><button disabled={!timelineSearchResults.length} onClick={() => revealSearchResult(activeSearchIndex < 0 ? 0 : activeSearchIndex + 1)}>다음</button>
        <button className="close" onClick={() => setSearchOpen(false)} aria-label="타임라인 검색 닫기"><X size={12} /></button>
        {timelineSearchResults.length > 0 && <div className="timeline-search-results">{timelineSearchResults.slice(0, 80).map((result, index) => <button key={result.id} className={index === activeSearchIndex ? 'active' : ''} onClick={() => revealSearchResult(index)}><i className={result.type} /><span><strong>{result.label}</strong><small>{result.detail} · {formatSequenceTimecode(result.time)}</small></span></button>)}</div>}
      </div>}

      {workArea && <div className="work-area-workspace"><strong>시퀀스 작업 구간</strong><label><span>IN</span><input type="number" min="0" max={workArea.end - 1 / fps} step={1 / fps} value={Math.round(workArea.start * fps) / fps} onChange={(event) => onUpdateWorkArea({ start: Number(event.target.value), end: workArea.end })} /><small>{formatSequenceTimecode(workArea.start)}</small></label><label><span>OUT</span><input type="number" min={workArea.start + 1 / fps} max={duration} step={1 / fps} value={Math.round(workArea.end * fps) / fps} onChange={(event) => onUpdateWorkArea({ start: workArea.start, end: Number(event.target.value) })} /><small>{formatSequenceTimecode(workArea.end)}</small></label><b>{formatTimecode(workArea.end - workArea.start, true, fps)}</b>{selectedClip && <button onClick={() => onUpdateWorkArea({ start: selectedClip.start, end: selectedClip.start + selectedClip.duration })}>선택 클립 범위</button>}</div>}

      {clipMarkerWorkspaceOpen && selectedClip && <div className="clip-marker-workspace"><div className="clip-marker-toolbar"><strong>{selectedClip.name} · 소스 마커</strong><button disabled={selectedClipLocked} onClick={onAddClipMarker}>재생 헤드에 추가</button><small>{selectedClip.clipMarkers?.length ?? 0}개 · 클립 이동·트림·분할에 종속</small></div><div className="clip-marker-list">{(selectedClip.clipMarkers ?? []).map((marker) => <button key={marker.id} className={marker.id === selectedClipMarkerId ? 'selected' : ''} style={{ '--clip-marker-color': marker.color } as CSSProperties} onClick={() => { setSelectedClipMarkerId(marker.id); onSeek(selectedClip.start + marker.time) }}><i /><span>{marker.label}</span><small>{formatTimecode(marker.time, true, fps)}</small></button>)}{!selectedClip.clipMarkers?.length && <small>현재 클립 안에 종속되는 마커를 추가할 수 있습니다.</small>}</div>{selectedClipMarker && <div className="clip-marker-editor"><input value={selectedClipMarker.label} disabled={selectedClipLocked} onChange={(event) => onUpdateClipMarker(selectedClip.id, selectedClipMarker.id, { label: event.target.value })} /><label><span>클립 내부 시간</span><input type="number" min="0" max={selectedClip.duration} step={1 / fps} value={Math.round(selectedClipMarker.time * fps) / fps} disabled={selectedClipLocked} onChange={(event) => { const time = clamp(Number(event.target.value), 0, selectedClip.duration); onUpdateClipMarker(selectedClip.id, selectedClipMarker.id, { time }); onSeek(selectedClip.start + time) }} /></label><input type="color" value={selectedClipMarker.color} disabled={selectedClipLocked} onChange={(event) => onUpdateClipMarker(selectedClip.id, selectedClipMarker.id, { color: event.target.value })} /><textarea value={selectedClipMarker.description ?? ''} disabled={selectedClipLocked} placeholder="클립 마커 설명" onChange={(event) => onUpdateClipMarker(selectedClip.id, selectedClipMarker.id, { description: event.target.value })} /><button className="danger" disabled={selectedClipLocked} onClick={() => { onRemoveClipMarker(selectedClip.id, selectedClipMarker.id); setSelectedClipMarkerId(undefined) }}>삭제</button></div>}</div>}

      {selectedClip && <div className="edit-point-workspace">
        <div className="edit-point-identity"><strong>편집점</strong><span>{selectedClip.name}</span><b>{trimMode === 'normal' ? '일반' : trimMode === 'ripple' ? '리플' : trimMode === 'roll' ? '롤' : trimMode === 'slip' ? '슬립' : trimMode === 'slide' ? '슬라이드' : '속도 늘이기'}</b></div>
        <div className="edit-point-edge"><button className={editPointEdge === 'start' ? 'active' : ''} onClick={() => setEditPointEdge('start')}>IN</button><button className={editPointEdge === 'end' ? 'active' : ''} onClick={() => setEditPointEdge('end')}>OUT</button></div>
        <div className="edit-point-nudge"><button disabled={selectedClipLocked} onClick={() => nudgeEditPoint(-10)}>−10f</button><button disabled={selectedClipLocked} onClick={() => nudgeEditPoint(-1)}>−1f</button><label><input aria-label="선택 편집점 타임코드" value={editPointTimecodeDraft} disabled={selectedClipLocked} onChange={(event) => setEditPointTimecodeDraft(event.target.value)} onFocus={(event) => event.currentTarget.select()} onBlur={commitEditPointTimecode} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitEditPointTimecode(); event.currentTarget.blur() } else if (event.key === 'Escape') { setEditPointTimecodeDraft(formatSequenceTimecode(selectedEditPointTime)); event.currentTarget.blur() } }} /><span>{editPointDraft.toFixed(3)}s</span></label><button disabled={selectedClipLocked} onClick={() => nudgeEditPoint(1)}>+1f</button><button disabled={selectedClipLocked} onClick={() => nudgeEditPoint(10)}>+10f</button></div>
        <label className="clip-start-timecode"><span>클립 시작</span><input aria-label="선택 클립 시작 타임코드" value={clipStartTimecodeDraft} disabled={selectedClipLocked} onChange={(event) => setClipStartTimecodeDraft(event.target.value)} onFocus={(event) => event.currentTarget.select()} onBlur={commitClipStartTimecode} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitClipStartTimecode(); event.currentTarget.blur() } else if (event.key === 'Escape') { setClipStartTimecodeDraft(formatSequenceTimecode(selectedClip.start)); event.currentTarget.blur() } }} /></label>
        <button className="edit-point-playhead" disabled={selectedClipLocked} onClick={() => commitEditPoint(playhead)}>재생 헤드에 맞춤</button>
      </div>}

      {markerWorkspaceOpen && <div className="marker-workspace">
        <div className="marker-workspace-toolbar"><strong>마커</strong><select value={markerFilter} onChange={(event) => setMarkerFilter(event.target.value as typeof markerFilter)}><option value="all">전체 {markers.length}</option><option value="chapter">챕터</option><option value="edit">편집</option><option value="comment">코멘트</option></select><button disabled={!filteredMarkers.length} onClick={() => { const index = Math.max(0, filteredMarkers.findIndex((marker) => marker.id === selectedMarkerId)); const marker = filteredMarkers[(index - 1 + filteredMarkers.length) % filteredMarkers.length]; setSelectedMarkerId(marker.id); onSeek(marker.time) }}>이전</button><button disabled={!filteredMarkers.length} onClick={() => { const index = filteredMarkers.findIndex((marker) => marker.id === selectedMarkerId); const marker = filteredMarkers[(index + 1 + filteredMarkers.length) % filteredMarkers.length]; setSelectedMarkerId(marker.id); onSeek(marker.time) }}>다음</button><button onClick={() => onAddRangeMarker(selectedClip?.start ?? playhead, selectedClip ? selectedClip.start + selectedClip.duration : Math.min(duration, playhead + 5), 'edit')}>선택 범위 추가</button></div>
        <div className="marker-chip-list">{filteredMarkers.map((marker) => <button key={marker.id} className={`${marker.id === selectedMarkerId ? 'selected' : ''} ${marker.kind}`} style={{ '--marker-color': marker.color } as CSSProperties} onClick={() => { setSelectedMarkerId(marker.id); onSeek(marker.time) }}><i /><span>{marker.label}</span><small>{formatSequenceTimecode(marker.time)}{(marker.duration ?? 0) > 0 ? ` +${formatTimecode(marker.duration!, true, fps)}` : ''}</small></button>)}</div>
        {selectedMarker && <div className="marker-editor"><input className="marker-label-input" value={selectedMarker.label} onChange={(event) => onUpdateMarker(selectedMarker.id, { label: event.target.value })} /><select value={selectedMarker.kind} onChange={(event) => { const kind = event.target.value as TimelineMarker['kind']; onUpdateMarker(selectedMarker.id, { kind, status: kind === 'comment' ? selectedMarker.status ?? 'open' : undefined }) }}><option value="chapter">챕터</option><option value="edit">편집</option><option value="comment">코멘트</option></select><label><span>시작</span><input type="number" min="0" max={duration} step={1 / fps} value={Math.round(selectedMarker.time * fps) / fps} onChange={(event) => { const time = clamp(Number(event.target.value), 0, duration); onUpdateMarker(selectedMarker.id, { time }); onSeek(time) }} /></label><label><span>길이</span><input type="number" min="0" max={Math.max(0, duration - selectedMarker.time)} step={1 / fps} value={Math.round((selectedMarker.duration ?? 0) * fps) / fps} onChange={(event) => onUpdateMarker(selectedMarker.id, { duration: Math.max(0, Math.min(duration - selectedMarker.time, Number(event.target.value))) || undefined })} /></label><input type="color" value={selectedMarker.color} onChange={(event) => onUpdateMarker(selectedMarker.id, { color: event.target.value })} />{selectedMarker.kind === 'comment' && <button className={selectedMarker.status === 'resolved' ? 'resolved' : ''} onClick={() => onUpdateMarker(selectedMarker.id, { status: selectedMarker.status === 'resolved' ? 'open' : 'resolved' })}>{selectedMarker.status === 'resolved' ? '해결됨' : '열림'}</button>}<button className="danger" onClick={() => { onRemoveMarker(selectedMarker.id); setSelectedMarkerId(undefined) }}>삭제</button><textarea value={selectedMarker.description ?? ''} placeholder="마커 설명" onChange={(event) => onUpdateMarker(selectedMarker.id, { description: event.target.value })} /></div>}
      </div>}

      <div className="timeline-body">
        <div className="track-headers" ref={trackHeadersRef} style={{ gridTemplateRows: trackRowTemplate }}>
          <div className="ruler-spacer"><span>TRACKS</span><span className="track-bulk-buttons"><button title="모든 트랙을 편집 대상으로 지정" onClick={() => onSetAllTrackEditTargets(true)}>T●</button><button title="모든 트랙의 편집 대상 해제" onClick={() => onSetAllTrackEditTargets(false)}>T○</button><button title="모든 트랙 동기화 잠금" onClick={() => onSetAllTrackSyncLocks(true)}>S●</button><button title="일반 트랙 동기화 잠금 해제" onClick={() => onSetAllTrackSyncLocks(false)}>S○</button><button title="모든 트랙 축소" onClick={() => onSetAllTrackHeights(44)}>H−</button><button title="모든 트랙 기본 높이" onClick={() => onSetAllTrackHeights(64)}>H</button><button title="모든 트랙 확대" onClick={() => onSetAllTrackHeights(104)}>H+</button></span><span className="track-add-buttons"><button title="비디오 트랙 추가" onClick={() => onAddTrack('video')}>V+</button><button title="오디오 트랙 추가" onClick={() => onAddTrack('audio')}>A+</button><button title="자막 트랙 추가" onClick={() => onAddTrack('caption')}>T+</button></span></div>
          {tracks.map((track) => {
            const TrackIcon = trackIcons[track.kind]
            const kindNumber = tracks.filter((candidate) => candidate.kind === track.kind).findIndex((candidate) => candidate.id === track.id) + 1
            const targetLabel = `${track.kind === 'video' ? 'V' : track.kind === 'audio' ? 'A' : 'T'}${kindNumber}`
            const automationView = automationViews[track.id] ?? (track.mixKeyframes?.length ? 'volume' : 'none')
            const automationMode = track.mixAutomationMode ?? (track.mixKeyframes?.length ? 'read' : 'off')
            return (
              <div className={`track-header ${track.kind} ${selectedTrackId === track.id ? 'selected' : ''}`} key={track.id} style={{ '--track-color': track.labelColor ?? (track.kind === 'video' ? '#7862d6' : track.kind === 'audio' ? '#3fb993' : '#c79243') } as CSSProperties} onClick={() => onSelectTrack(track.id)}>
                <div className="track-header-primary">
                  <button className={`source-target-button ${track.sourceTarget ? 'active' : ''}`} onClick={(event) => { event.stopPropagation(); onToggleTrackTarget(track.id) }} aria-pressed={Boolean(track.sourceTarget)} aria-label={`${track.name} ${track.sourceTarget ? '소스 대상 해제' : '소스 대상으로 지정'}`} title={`${targetLabel} 소스 패치 대상`}>{targetLabel}</button>
                  <button className={`edit-target-button ${track.editTarget !== false ? 'active' : ''}`} onClick={(event) => { event.stopPropagation(); onToggleTrackEditTarget(track.id) }} aria-pressed={track.editTarget !== false} aria-label={`${track.name} ${track.editTarget !== false ? '편집 대상 해제' : '편집 대상으로 지정'}`} title="Lift·Extract·Add Edit·편집점 탐색 대상">●</button>
                  <TrackIcon size={14} />
                  <span title={track.name}>{track.name}</span>
                  {track.kind === 'caption' && track.captionLanguage && <b className="caption-track-language" title={`${track.captionFormat === 'closed-caption' ? '폐쇄 자막' : '자막'} 언어`}>{track.captionLanguage}</b>}
                  {(track.kind === 'audio' || track.kind === 'video') && <button className={`track-automation-view-button mode-${automationMode} ${automationView !== 'none' ? 'active' : ''}`} aria-label={`${track.name} 자동화 레인 ${automationView === 'none' ? '표시' : automationView === 'volume' ? '팬으로 전환' : '숨기기'}`} title={`${automationMode.toUpperCase()} · ${track.mixKeyframes?.length ?? 0}개 · 클릭: 볼륨 → 팬 → 숨김 · 우클릭: 자동화 모드 전환`} onClick={(event) => { event.stopPropagation(); setAutomationViews((views) => ({ ...views, [track.id]: automationView === 'none' ? 'volume' : automationView === 'volume' ? 'pan' : 'none' })) }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); const modes: Array<NonNullable<TimelineTrack['mixAutomationMode']>> = ['off', 'read', 'write', 'touch', 'latch']; onUpdateTrack(track.id, { mixAutomationMode: modes[(modes.indexOf(automationMode) + 1) % modes.length] }) }}>{automationMode === 'write' ? 'W' : automationMode === 'touch' ? 'T' : automationMode === 'latch' ? 'L' : automationMode === 'read' ? 'R' : 'O'}{automationView === 'volume' ? 'V' : automationView === 'pan' ? 'P' : '—'}</button>}
                  {track.kind !== 'caption' && track.audioOutputChannel && track.audioOutputChannel !== 'auto' && <b className="track-automation-badge" title={`5.1 직접 출력 · ${track.audioOutputChannel}`}>{track.audioOutputChannel === 'left-surround' ? 'Ls' : track.audioOutputChannel === 'right-surround' ? 'Rs' : track.audioOutputChannel === 'surround-pan' ? '5.1' : track.audioOutputChannel.toUpperCase()}</b>}
                </div>
                <div className="track-header-actions">
                  <span className="track-order-buttons"><button onClick={(event) => { event.stopPropagation(); onMoveTrack(track.id, -1) }} aria-label={`${track.name} 위로 이동`} title="트랙 위로 이동"><ArrowUp size={10} /></button><button onClick={(event) => { event.stopPropagation(); onMoveTrack(track.id, 1) }} aria-label={`${track.name} 아래로 이동`} title="트랙 아래로 이동"><ArrowDown size={10} /></button></span>
                  {(track.kind === 'video' || track.kind === 'caption') && <button onClick={(event) => { event.stopPropagation(); onToggleTrackVisibility(track.id) }} aria-label={`${track.name} ${track.visible === false ? '표시' : '숨기기'}`} title={track.visible === false ? '트랙 표시' : '트랙 숨기기'}>{track.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}</button>}
                  <button onClick={(event) => { event.stopPropagation(); onToggleTrackMute(track.id) }} aria-label={`${track.name} ${track.muted ? '음소거 해제' : '음소거'}`} title={track.muted ? '음소거 해제' : '음소거'}>{track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>
                  {(track.kind === 'audio' || track.kind === 'video') && <button className={track.solo ? 'active' : ''} onClick={(event) => { event.stopPropagation(); onToggleTrackSolo(track.id) }} aria-label={`${track.name} ${track.solo ? '솔로 해제' : '솔로'}`} title={track.solo ? '솔로 해제' : '솔로'}><Headphones size={13} /></button>}
                  <button onClick={(event) => { event.stopPropagation(); onToggleTrackLock(track.id) }} aria-label={`${track.name} ${track.locked ? '잠금 해제' : '잠금'}`} title={track.locked ? '트랙 잠금 해제' : '트랙 잠금'}>{track.locked ? <Lock size={13} /> : <Unlock size={13} />}</button>
                  <button className={track.syncLock !== false ? 'active' : ''} onClick={(event) => { event.stopPropagation(); onToggleTrackSyncLock(track.id) }} aria-pressed={track.syncLock !== false} aria-label={`${track.name} ${track.syncLock !== false ? '동기화 잠금 해제' : '동기화 잠금'}`} title="삽입·리플 삭제 시 다른 트랙과 함께 이동"><Link2 size={12} /></button>
                  <button onClick={(event) => { event.stopPropagation(); const heights = [44, 64, 96, 132]; const current = track.displayHeight ?? 64; onSetTrackHeight(track.id, heights.find((height) => height > current) ?? heights[0]) }} aria-label={`${track.name} 높이 변경`} title={`트랙 높이 ${track.displayHeight ?? 64}px · 클릭해 순환`}>↕</button>
                  <button onClick={(event) => { event.stopPropagation(); onDuplicateTrack(track.id) }} aria-label={`${track.name} 복제`} title="트랙과 모든 클립·효과·자동화 복제"><CopyPlus size={12} /></button>
                  <button className="remove-track" onClick={(event) => { event.stopPropagation(); onRemoveTrack(track.id) }} aria-label={`${track.name} 삭제`} title="트랙 삭제"><X size={12} /></button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="timeline-scroll" ref={scrollRef} onScroll={(event) => { if (trackHeadersRef.current) trackHeadersRef.current.scrollTop = event.currentTarget.scrollTop }}>
          <div className="timeline-canvas" style={{ width: contentWidth, gridTemplateRows: trackRowTemplate }} onPointerDown={seekFromPointer}>
            <div className="ruler">
              {workArea && <div className={`timeline-work-area ${loopWorkArea ? 'looping' : ''}`} style={{ left: workArea.start * pixelsPerSecond, width: Math.max(2, (workArea.end - workArea.start) * pixelsPerSecond) }}><i /><i /></div>}
              {marks.map((second) => (
                <span key={second} className="ruler-mark" style={{ left: second * pixelsPerSecond }}>
                  <i />{second % 10 === 0 && <b>{formatSequenceTimecode(second).slice(0, 8)}</b>}
                </span>
              ))}
              {markers.map((marker) => <button key={marker.id} className={`timeline-marker ${(marker.duration ?? 0) > 0 ? 'range' : ''} ${marker.id === selectedMarkerId ? 'selected' : ''}`} style={{ left: marker.time * pixelsPerSecond, width: (marker.duration ?? 0) > 0 ? Math.max(14, marker.duration! * pixelsPerSecond) : 14, '--marker-color': marker.color } as CSSProperties} title={`${marker.label} · ${formatSequenceTimecode(marker.time)}${(marker.duration ?? 0) > 0 ? `–${formatSequenceTimecode(marker.time + marker.duration!)}` : ''}`} onClick={(event) => { event.stopPropagation(); setSelectedMarkerId(marker.id); onSeek(marker.time) }} onDoubleClick={(event) => { event.stopPropagation(); onRemoveMarker(marker.id); setSelectedMarkerId(undefined) }}><Flag size={10} />{(marker.duration ?? 0) > 0 && <span />}</button>)}
            </div>

            {tracks.map((track) => {
              const automationView = automationViews[track.id] ?? (track.mixKeyframes?.length ? 'volume' : 'none')
              return <div className={`track-lane ${track.kind} ${track.locked ? 'locked' : ''} ${dragTargetTrackId === track.id ? 'drag-target' : ''}`} data-track-id={track.id} data-track-kind={track.kind} data-track-locked={track.locked} key={track.id}>
                {track.clips.map((clip) => (
                  <ClipBlock
                    key={clip.id}
                    clip={clip}
                    pixelsPerSecond={pixelsPerSecond}
                    fps={fps}
                    timecodeStart={timecodeStart}
                    timecodeDropFrame={timecodeDropFrame}
                    selected={selectedClipIds.has(clip.id)}
                    locked={track.locked}
                    activeTool={activeTool}
                    snapEnabled={snapEnabled}
                    snapTargets={timelineSnapTargets}
                    audioEnvelopeView={selectedClipIds.has(clip.id) && clipAudioEnvelopeView !== 'none' && !clip.audioDisabled && (clip.kind === 'audio' || clip.kind === 'video') ? clipAudioEnvelopeView : undefined}
                    opacityEnvelope={selectedClipIds.has(clip.id) && clipVideoEnvelopeView === 'opacity' && clip.kind !== 'audio'}
                    speedEnvelope={selectedClipIds.has(clip.id) && clipVideoEnvelopeView === 'speed' && clip.kind === 'video' && !clip.adjustmentLayer && !clip.nestedSequenceId && !clip.freezeFrame}
                    onSnapGuide={setSnapGuideTime}
                    asset={assets.find((asset) => asset.id === clip.assetId)}
                    onSelect={(additive) => onSelectClip(clip.id, additive)}
                    onMove={(start, targetTrackId) => onMoveClip(clip.id, start, targetTrackId)}
                    onDragTargetChange={setDragTargetTrackId}
                    onTrim={(edge, time) => onTrimClip(clip.id, edge, time)}
                    onSeek={onSeek}
                    onRazor={(time) => onRazorClip(clip.id, time)}
                    onOpenNestedSequence={onOpenNestedSequence}
                    onUpdateAutomation={(patch) => onUpdateClip(clip.id, patch)}
                    onUpdateAutomationTransient={(patch) => onUpdateClipTransient(clip.id, patch)}
                    onMoveClipMarker={(markerId, localTime) => onUpdateClipMarker(clip.id, markerId, { time: localTime })}
                    onRemoveClipMarker={(markerId) => onRemoveClipMarker(clip.id, markerId)}
                  />
                ))}
                {automationView !== 'none' && track.kind !== 'caption' && <TrackAutomationEnvelope track={track} view={automationView} pixelsPerSecond={pixelsPerSecond} duration={duration} fps={fps} playhead={playhead} snapEnabled={snapEnabled} snapTargets={timelineSnapTargets} locked={track.locked} onSnapGuide={setSnapGuideTime} onUpdate={(patch) => onUpdateTrack(track.id, patch)} onUpdateTransient={(patch) => onUpdateTrackTransient(track.id, patch)} onSeek={onSeek} />}
              </div>
            })}

            {selectionBox && <div className="timeline-selection-box" style={selectionBox} />}

            {snapGuideTime !== undefined && <div className="timeline-snap-guide" style={{ left: snapGuideTime * pixelsPerSecond }}><span>{formatSequenceTimecode(snapGuideTime)}</span></div>}

            <div className="playhead" style={{ left: playhead * pixelsPerSecond }}>
              <span />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
