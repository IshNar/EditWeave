import { ChevronLeft, ChevronRight, ClipboardPaste, Copy, Diamond, Plus, SlidersHorizontal, Star, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { clipNeedsPitchStretch, clipPlaybackRateAtLocal, clipSourceTime, defaultAudioAdjustment, defaultCaptionStyle, defaultColorAdjustment, noiseGateThreshold, peakNormalizationGainDb, resolveClipAudioMix, resolveClipTransform, resolveTrackAudioMix, resolveVisualEffects } from '../editor/effects'
import { normalizeColorCurve, type ColorCurveChannel } from '../editor/colorCurves'
import type { AdrCue, AudioAdjustment, CaptionStyle, ClipTransform, ClipTransition, ColorAdjustment, ColorNode, ColorNodeType, EffectMask, MaskPoint, MediaAsset, SpeedKeyframe, TimelineClip, TimelineTrack, VideoEffectStackKind, VisualEffects } from '../editor/types'
import { ColorScopes } from './ColorScopes'
import { applyMotionTemplate, createMotionTemplate, parseMotionTemplate, readMotionTemplates, serializeMotionTemplate, writeMotionTemplates } from '../platform/motionTemplates'
import { audioRoles, resolveAudioAuxSends } from '../editor/audioBuses'
import { createEffectMask, resolveEffectMasks } from '../editor/mask'
import { colorNodeLabels, createColorNode } from '../editor/colorNodes'
import { applySpeedTemplate, createSpeedTemplate, parseSpeedTemplate, readSpeedTemplates, serializeSpeedTemplate, writeSpeedTemplates } from '../platform/speedTemplates'
import { CREATOR_PACK_CHANGED_EVENT } from '../platform/creatorPacks'
import { applyEffectPreset, createEffectPreset, parseEffectPreset, readEffectPresets, serializeEffectPreset, writeEffectPresets } from '../platform/effectPresets'
import { createTitleStyleTemplate, parseTitleStyleTemplate, readTitleStyleTemplates, serializeTitleStyleTemplate, writeTitleStyleTemplates } from '../platform/titleStyleTemplates'
import { parseCubeLut } from '../editor/lut'
import { analyzeFrameColor, appendGeneratedColorNodes, createAutoWhiteBalanceNodes, createReferenceMatchNodes } from '../editor/colorMatch'
import { createTransitionPreset, parseTransitionPreset, readTransitionPresets, serializeTransitionPreset, writeTransitionPresets } from '../platform/transitionPresets'

interface InspectorPanelProps {
  clip?: TimelineClip
  adrCue?: AdrCue
  track?: TimelineTrack
  tracks?: TimelineTrack[]
  asset?: MediaAsset
  locked?: boolean
  playhead: number
  onSeek?: (time: number) => void
  selectedClipCount?: number
  onApplyAutomationToSelection?: (sourceClipId: string) => void
  onApplyEffectPresetToSelection?: (sourceClipId: string, patch: Partial<TimelineClip>) => void
  onApplyAudioFadesToSelection?: (sourceClipId: string) => void
  onApplyTransitionPreset?: (sourceClipId: string, edge: 'in' | 'out', transition: ClipTransition | undefined, scope: 'selection' | 'linked') => void
  onSetDefaultTransition?: (mediaKind: 'video' | 'audio', transition: ClipTransition) => void
  onApplyCaptionStyleToTrack?: (sourceClipId: string) => void
  programFrame?: { canvas: HTMLCanvasElement; revision: number }
  referenceFrame?: ImageData
  onUpdateClip: (id: string, patch: Partial<TimelineClip>) => void
  onUpdateTrack: (id: string, patch: Partial<TimelineTrack>) => void
  multicamAngles?: Array<{ index: number; name: string; hasAudio: boolean }>
  onRenameMulticamAngle?: (index: number, name: string) => void
  onAssignAdrRange?: (cueId: string, takeId: string, start: number, end: number) => void
  onTrackMotion?: (id: string) => void
  motionTracking?: boolean
  onCancelMotion?: () => void
  onDetectScenes?: (id: string) => void
  sceneDetecting?: boolean
  onCancelSceneDetection?: () => void
  onTrackObject?: (id: string) => void
  objectTracking?: boolean
  onCancelObjectTracking?: () => void
  onStabilize?: (id: string) => void
  stabilizing?: boolean
  onCancelStabilization?: () => void
  onRemoveVideoBackground?: (id: string) => void
  videoBackgroundRemoval?: boolean
  onCancelVideoBackgroundRemoval?: () => void
}

interface ClipAutomationClipboard {
  sourceKind: TimelineClip['kind']
  sourceDuration: number
  transform: TimelineClip['transform']
  keyframes?: NonNullable<TimelineClip['keyframes']>
  motionPathAutoOrient?: boolean
  motionPathOrientationOffset?: number
  motionBlur?: TimelineClip['motionBlur']
  playbackRate?: number
  speedKeyframes?: NonNullable<TimelineClip['speedKeyframes']>
  colorAdjustment?: TimelineClip['colorAdjustment']
  visualEffects?: TimelineClip['visualEffects']
  effectStack?: TimelineClip['effectStack']
  visualKeyframes?: NonNullable<TimelineClip['visualKeyframes']>
  audioAdjustment?: TimelineClip['audioAdjustment']
  audioMixKeyframes?: NonNullable<TimelineClip['audioMixKeyframes']>
}

let clipAutomationClipboard: ClipAutomationClipboard | undefined
let transitionClipboard: { edge: 'in' | 'out'; transition: ClipTransition } | undefined

type KeyframeRangeScope = 'all' | 'transform' | 'speed' | 'visual' | 'audio'
interface KeyframeRangeClipboard {
  sourceKind: TimelineClip['kind']
  scope: KeyframeRangeScope
  duration: number
  keyframes?: NonNullable<TimelineClip['keyframes']>
  speedKeyframes?: NonNullable<TimelineClip['speedKeyframes']>
  visualKeyframes?: NonNullable<TimelineClip['visualKeyframes']>
  audioMixKeyframes?: NonNullable<TimelineClip['audioMixKeyframes']>
}
let keyframeRangeClipboard: KeyframeRangeClipboard | undefined

function cloneAutomationValue<T>(value: T): T {
  return structuredClone(value)
}

const videoEffectStackKinds: Array<{ kind: VideoEffectStackKind; name: string }> = [
  { kind: 'chroma-key', name: '크로마키' },
  { kind: 'color-grade', name: '색보정 · LUT · 노드' },
  { kind: 'blur-shadow', name: '블러 · 그림자' },
  { kind: 'crop-mask', name: '크롭 · 마스크' },
  { kind: 'corner-pin', name: '4점 코너 핀' },
  { kind: 'face-mosaic', name: '얼굴 모자이크' },
  { kind: 'vignette', name: '비네트' },
]

function createDefaultVideoEffectStack() {
  return videoEffectStackKinds.map((item) => ({ ...item, id: crypto.randomUUID(), enabled: true }))
}

function NumberField({ label, value, suffix, disabled, min, max, step = 0.1, onChange }: { label: string; value: number; suffix?: string; disabled?: boolean; min?: number; max?: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <div><input type="number" value={Math.round(value * 100) / 100} min={min} max={max} step={step} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} /><small>{suffix}</small></div>
    </label>
  )
}

function CornerPinEditor({ points, disabled, onChange }: { points?: Array<{ x: number; y: number }>; disabled?: boolean; onChange: (points: Array<{ x: number; y: number }>) => void }) {
  const value = points?.length === 4 ? points : [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
  const labels = ['좌상', '우상', '우하', '좌하']
  const update = (index: number, patch: Partial<{ x: number; y: number }>) => onChange(value.map((point, pointIndex) => pointIndex === index ? { ...point, ...patch } : { ...point }))
  return <div className="corner-pin-editor"><header><strong>4점 코너 핀 좌표</strong><button type="button" disabled={disabled} onClick={() => onChange([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }])}>초기화</button></header>{value.map((point, index) => <div key={labels[index]}><span>{labels[index]}</span><NumberField label="X" value={point.x} suffix="%" min={-200} max={300} disabled={disabled} onChange={(x) => update(index, { x })} /><NumberField label="Y" value={point.y} suffix="%" min={-200} max={300} disabled={disabled} onChange={(y) => update(index, { y })} /></div>)}</div>
}

function SelectField({ label, value, disabled, children, onChange }: { label: string; value: string; disabled?: boolean; children: ReactNode; onChange: (value: string) => void }) {
  return <label className="select-field"><span>{label}</span><select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{children}</select></label>
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className="toggle-field"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>
}

function PolygonMaskEditor({ points, disabled, onChange }: { points: Array<{ x: number; y: number }>; disabled?: boolean; onChange: (points: Array<{ x: number; y: number }>) => void }) {
  return <div className="polygon-mask-editor"><svg viewBox="0 0 100 100" onClick={(event) => {
    if (disabled || points.length >= 12) return
    const bounds = event.currentTarget.getBoundingClientRect()
    onChange([...points, { x: (event.clientX - bounds.left) / bounds.width * 100, y: (event.clientY - bounds.top) / bounds.height * 100 }])
  }}><rect x="0" y="0" width="100" height="100" /><polygon points={points.map((point) => `${point.x},${point.y}`).join(' ')} />{points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="2.2" onClick={(event) => { event.stopPropagation(); if (!disabled && points.length > 3) onChange(points.filter((_, pointIndex) => pointIndex !== index)) }} />)}</svg><footer><span>빈 곳을 눌러 점 추가 · 점을 눌러 삭제</span><button disabled={disabled} onClick={() => onChange([{ x: 12, y: 12 }, { x: 88, y: 12 }, { x: 88, y: 88 }, { x: 12, y: 88 }])}>초기화</button></footer></div>
}

function MultiMaskEditor({ masks, disabled, onChange }: { masks: EffectMask[]; disabled?: boolean; onChange: (masks: EffectMask[]) => void }) {
  const [selectedId, setSelectedId] = useState(masks[0]?.id ?? '')
  const selected = masks.find((mask) => mask.id === selectedId) ?? masks[0]
  useEffect(() => {
    if (!masks.some((mask) => mask.id === selectedId)) setSelectedId(masks[0]?.id ?? '')
  }, [masks, selectedId])
  const update = (id: string, patch: Partial<EffectMask>) => onChange(masks.map((mask) => mask.id === id ? { ...mask, ...patch } : mask))
  const move = (id: string, direction: -1 | 1) => {
    const next = [...masks]
    const index = next.findIndex((mask) => mask.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }
  return <div className="multi-mask-editor">
    <div className="multi-mask-add"><span>다중 마스크 · 최대 8개</span>{(['ellipse', 'rounded', 'polygon', 'bezier'] as const).map((shape) => <button key={shape} disabled={disabled || masks.length >= 8} onClick={() => { const mask = createEffectMask(shape, masks.length); onChange([...masks, mask]); setSelectedId(mask.id) }}>+ {shape === 'ellipse' ? '타원' : shape === 'rounded' ? '사각형' : shape === 'polygon' ? '다각형' : '베지어'}</button>)}</div>
    {masks.map((mask, index) => <article className={`mask-layer-row ${mask.id === selected?.id ? 'selected' : ''}`} key={mask.id} onClick={() => setSelectedId(mask.id)}>
      <button className={mask.enabled ? 'active' : ''} disabled={disabled} onClick={(event) => { event.stopPropagation(); update(mask.id, { enabled: !mask.enabled }) }}>{index + 1}</button>
      <input value={mask.name} disabled={disabled} onChange={(event) => update(mask.id, { name: event.target.value })} />
      <select value={mask.operation} disabled={disabled || index === 0} onChange={(event) => update(mask.id, { operation: event.target.value as EffectMask['operation'] })}><option value="add">더하기</option><option value="subtract">빼기</option><option value="intersect">교차</option></select>
      <button disabled={disabled || index === 0} onClick={(event) => { event.stopPropagation(); move(mask.id, -1) }}>↑</button><button disabled={disabled || index === masks.length - 1} onClick={(event) => { event.stopPropagation(); move(mask.id, 1) }}>↓</button><button disabled={disabled} onClick={(event) => { event.stopPropagation(); onChange(masks.filter((item) => item.id !== mask.id)) }}><Trash2 size={10} /></button>
    </article>)}
    {selected && <div className="selected-mask-controls"><div className="field-grid"><NumberField label="페더" value={selected.feather} suffix="%" min={0} max={25} disabled={disabled} onChange={(feather) => update(selected.id, { feather })} /><NumberField label="불투명도" value={selected.opacity} suffix="%" min={0} max={100} disabled={disabled} onChange={(opacity) => update(selected.id, { opacity })} /></div><Toggle label="선택 마스크 반전" checked={selected.invert} disabled={disabled} onChange={(invert) => update(selected.id, { invert })} /><MaskShapeEditor mask={selected} disabled={disabled} onChange={(patch) => update(selected.id, patch)} /></div>}
  </div>
}

function MaskShapeEditor({ mask, disabled, onChange }: { mask: EffectMask; disabled?: boolean; onChange: (patch: Partial<EffectMask>) => void }) {
  const editablePoints = mask.points.length >= 3 ? mask.points : [{ x: 12, y: 12 }, { x: 88, y: 12 }, { x: 88, y: 88 }, { x: 12, y: 88 }]
  const pointer = (event: { clientX: number; clientY: number; currentTarget: SVGSVGElement }) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - bounds.top) / bounds.height * 100)) }
  }
  const movePoint = (event: ReactPointerEvent<SVGCircleElement>, index: number) => {
    if (disabled || event.buttons !== 1) return
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const bounds = svg.getBoundingClientRect()
    const value = { x: Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - bounds.top) / bounds.height * 100)) }
    onChange({ points: editablePoints.map((point, pointIndex) => pointIndex === index ? { ...point, ...value } : point) })
  }
  const moveHandle = (event: ReactPointerEvent<SVGCircleElement>, index: number, side: 'inHandle' | 'outHandle') => {
    if (disabled || event.buttons !== 1) return
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const bounds = svg.getBoundingClientRect()
    const value = { x: Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - bounds.top) / bounds.height * 100)) }
    const anchor = editablePoints[index]
    onChange({ points: editablePoints.map((point, pointIndex) => pointIndex === index ? { ...point, [side]: { x: value.x - anchor.x, y: value.y - anchor.y } } : point) })
  }
  const path = editablePoints.map((point, index) => {
    if (!index) return `M ${point.x} ${point.y}`
    const previous = editablePoints[index - 1]
    return mask.shape === 'bezier' ? `C ${previous.x + (previous.outHandle?.x ?? 0)} ${previous.y + (previous.outHandle?.y ?? 0)}, ${point.x + (point.inHandle?.x ?? 0)} ${point.y + (point.inHandle?.y ?? 0)}, ${point.x} ${point.y}` : `L ${point.x} ${point.y}`
  }).join(' ')
  const closing = editablePoints.length ? mask.shape === 'bezier' ? (() => { const last = editablePoints[editablePoints.length - 1]; const first = editablePoints[0]; return ` C ${last.x + (last.outHandle?.x ?? 0)} ${last.y + (last.outHandle?.y ?? 0)}, ${first.x + (first.inHandle?.x ?? 0)} ${first.y + (first.inHandle?.y ?? 0)}, ${first.x} ${first.y} Z` })() : ' Z' : ''
  const xs = editablePoints.map((point) => point.x)
  const ys = editablePoints.map((point) => point.y)
  const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(1, Math.max(...xs) - Math.min(...xs)), height: Math.max(1, Math.max(...ys) - Math.min(...ys)) }
  return <div className="mask-shape-editor"><svg viewBox="0 0 100 100" onDoubleClick={(event) => {
    if (disabled || (mask.shape !== 'polygon' && mask.shape !== 'bezier') || editablePoints.length >= 16 || (event.target as SVGElement).tagName === 'circle') return
    const value = pointer(event)
    const point: MaskPoint = mask.shape === 'bezier' ? { ...value, inHandle: { x: -4, y: 0 }, outHandle: { x: 4, y: 0 } } : value
    onChange({ points: [...editablePoints, point] })
  }}>{mask.shape === 'ellipse' ? <ellipse cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} /> : mask.shape === 'rounded' ? <rect x={box.x} y={box.y} width={box.width} height={box.height} rx={Math.min(box.width, box.height) * 0.09} /> : <path d={`${path}${closing}`} />}{mask.shape === 'bezier' && editablePoints.flatMap((point, index) => (['inHandle', 'outHandle'] as const).map((side) => { const handle = point[side] ?? { x: side === 'inHandle' ? -4 : 4, y: 0 }; return <g key={`${index}-${side}`}><line x1={point.x} y1={point.y} x2={point.x + handle.x} y2={point.y + handle.y} /><circle className="mask-handle" cx={point.x + handle.x} cy={point.y + handle.y} r="1.7" onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={(event) => moveHandle(event, index, side)} /></g> }))}{editablePoints.map((point, index) => <circle className="mask-anchor" key={index} cx={point.x} cy={point.y} r="2.5" onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={(event) => movePoint(event, index)} onDoubleClick={(event) => { event.stopPropagation(); if (!disabled && editablePoints.length > 3) onChange({ points: editablePoints.filter((_, pointIndex) => pointIndex !== index) }) }} />)}</svg><small>점을 끌어 이동 · 빈 곳을 두 번 눌러 추가 · 점을 두 번 눌러 삭제{mask.shape === 'bezier' ? ' · 작은 핸들로 곡률 조절' : ''}</small></div>
}

function SpeedRampGraph({ clip, disabled, onChange }: { clip: TimelineClip; disabled?: boolean; onChange: (keyframes: NonNullable<TimelineClip['speedKeyframes']>) => void }) {
  const width = 260
  const height = 82
  const minimumRate = 0.05
  const maximumRate = 16
  const rateY = (rate: number) => height - Math.log(Math.max(minimumRate, Math.min(maximumRate, rate)) / minimumRate) / Math.log(maximumRate / minimumRate) * height
  const yRate = (y: number) => minimumRate * (maximumRate / minimumRate) ** (1 - Math.max(0, Math.min(height, y)) / height)
  const samples = Array.from({ length: 65 }, (_, index) => {
    const time = clip.duration * index / 64
    return { x: time / Math.max(0.001, clip.duration) * width, y: rateY(clipPlaybackRateAtLocal(clip, time)) }
  })
  const pointerValue = (event: { clientX: number; clientY: number; currentTarget: SVGSVGElement }) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      time: Math.max(0, Math.min(clip.duration, (event.clientX - bounds.left) / bounds.width * clip.duration)),
      rate: yRate((event.clientY - bounds.top) / bounds.height * height),
    }
  }
  const updatePoint = (event: ReactPointerEvent<SVGCircleElement>, id: string) => {
    if (disabled || event.buttons !== 1) return
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const bounds = svg.getBoundingClientRect()
    const time = Math.max(0, Math.min(clip.duration, (event.clientX - bounds.left) / bounds.width * clip.duration))
    const rate = yRate((event.clientY - bounds.top) / bounds.height * height)
    onChange((clip.speedKeyframes ?? []).map((item) => item.id === id ? { ...item, time, rate } : item).sort((a, b) => a.time - b.time))
  }
  return <div className="speed-ramp-graph"><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" onDoubleClick={(event) => {
    if (disabled || (event.target as SVGElement).tagName === 'circle') return
    const value = pointerValue(event)
    onChange([...(clip.speedKeyframes ?? []), { id: crypto.randomUUID(), time: value.time, rate: value.rate, easing: 'ease-in-out' as const }].sort((a, b) => a.time - b.time))
  }}>
    <line x1="0" y1={rateY(1)} x2={width} y2={rateY(1)} className="speed-one-line" />
    <polyline points={samples.map((point) => `${point.x},${point.y}`).join(' ')} />
    {(clip.speedKeyframes ?? []).map((keyframe) => <circle key={keyframe.id} cx={keyframe.time / Math.max(0.001, clip.duration) * width} cy={rateY(keyframe.rate)} r="4" onPointerDown={(event) => { if (!disabled) event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={(event) => updatePoint(event, keyframe.id)} onDoubleClick={(event) => { event.stopPropagation(); if (!disabled) onChange((clip.speedKeyframes ?? []).filter((item) => item.id !== keyframe.id)) }} />)}
  </svg><footer><span>50%</span><span>100% 기준</span><span>400%+</span></footer><small>빈 그래프를 두 번 눌러 지점 추가 · 점을 끌어 조절 · 점을 두 번 눌러 삭제</small></div>
}

function SpeedBezierEditor({ curve, disabled, onChange }: { curve?: SpeedKeyframe['curve']; disabled?: boolean; onChange: (curve: NonNullable<SpeedKeyframe['curve']>) => void }) {
  const width = 220
  const height = 72
  const value = { x1: curve?.x1 ?? 0.33, y1: curve?.y1 ?? 0, x2: curve?.x2 ?? 0.67, y2: curve?.y2 ?? 1 }
  const point = (x: number, y: number) => ({ x: x * width, y: (1 - y) * height })
  const first = point(value.x1, value.y1)
  const second = point(value.x2, value.y2)
  const move = (event: ReactPointerEvent<SVGCircleElement>, handle: 'first' | 'second') => {
    if (disabled || event.buttons !== 1) return
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const bounds = svg.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
    const y = Math.max(0, Math.min(1, 1 - (event.clientY - bounds.top) / bounds.height))
    onChange(handle === 'first' ? { ...value, x1: x, y1: y } : { ...value, x2: x, y2: y })
  }
  return <div className="speed-bezier-editor"><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"><path d={`M 0 ${height} C ${first.x} ${first.y}, ${second.x} ${second.y}, ${width} 0`} /><line x1="0" y1={height} x2={first.x} y2={first.y} /><line x1={width} y1="0" x2={second.x} y2={second.y} /><circle cx={first.x} cy={first.y} r="4" onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={(event) => move(event, 'first')} /><circle cx={second.x} cy={second.y} r="4" onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={(event) => move(event, 'second')} /></svg><small>두 핸들을 끌어 이 구간의 가속 곡률을 직접 조절합니다.</small></div>
}

type MotionGraphProperty = 'positionX' | 'positionY' | 'scale' | 'scaleX' | 'scaleY' | 'anchorX' | 'anchorY' | 'skewX' | 'skewY' | 'rotation' | 'opacity'

const motionGraphProperties: Array<{ id: MotionGraphProperty; label: string; min: number; max: number }> = [
  { id: 'positionX', label: 'X', min: -1000, max: 1000 },
  { id: 'positionY', label: 'Y', min: -1000, max: 1000 },
  { id: 'scale', label: '크기', min: 1, max: 400 },
  { id: 'scaleX', label: '가로', min: -400, max: 400 },
  { id: 'scaleY', label: '세로', min: -400, max: 400 },
  { id: 'anchorX', label: '앵커 X', min: -100, max: 200 },
  { id: 'anchorY', label: '앵커 Y', min: -100, max: 200 },
  { id: 'skewX', label: '기울기 X', min: -85, max: 85 },
  { id: 'skewY', label: '기울기 Y', min: -85, max: 85 },
  { id: 'rotation', label: '회전', min: -360, max: 360 },
  { id: 'opacity', label: '불투명도', min: 0, max: 100 },
]

function MotionValueGraph({ clip, disabled, onChange }: { clip: TimelineClip; disabled?: boolean; onChange: (keyframes: NonNullable<TimelineClip['keyframes']>) => void }) {
  const [property, setProperty] = useState<MotionGraphProperty>('positionX')
  const width = 260
  const height = 96
  const config = motionGraphProperties.find((item) => item.id === property) ?? motionGraphProperties[0]
  const transformValue = (transform: ClipTransform) => transform[property] ?? (property === 'scaleX' || property === 'scaleY' ? 100 : property === 'anchorX' || property === 'anchorY' ? 50 : 0)
  const valueY = (value: number) => height - (Math.max(config.min, Math.min(config.max, value)) - config.min) / (config.max - config.min) * height
  const yValue = (y: number) => config.min + (1 - Math.max(0, Math.min(height, y)) / height) * (config.max - config.min)
  const samples = Array.from({ length: 65 }, (_, index) => {
    const time = clip.duration * index / 64
    const transform = resolveClipTransform(clip, clip.start + time)
    return { x: time / Math.max(0.001, clip.duration) * width, y: valueY(transformValue(transform)) }
  })
  const pointFromEvent = (event: { clientX: number; clientY: number; currentTarget: SVGSVGElement }) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      time: Math.max(0, Math.min(clip.duration, (event.clientX - bounds.left) / bounds.width * clip.duration)),
      value: yValue((event.clientY - bounds.top) / bounds.height * height),
    }
  }
  const updatePoint = (event: ReactPointerEvent<SVGCircleElement>, id: string) => {
    if (disabled || event.buttons !== 1) return
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const bounds = svg.getBoundingClientRect()
    const time = Math.max(0, Math.min(clip.duration, (event.clientX - bounds.left) / bounds.width * clip.duration))
    const value = yValue((event.clientY - bounds.top) / bounds.height * height)
    onChange((clip.keyframes ?? []).map((item) => item.id === id ? { ...item, time, transform: { ...item.transform, [property]: value } } : item).sort((a, b) => a.time - b.time))
  }
  return <div className="motion-value-graph"><header>{motionGraphProperties.map((item) => <button key={item.id} className={property === item.id ? 'active' : ''} onClick={() => setProperty(item.id)}>{item.label}</button>)}</header><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" onDoubleClick={(event) => {
    if (disabled || (event.target as SVGElement).tagName === 'circle') return
    const point = pointFromEvent(event)
    const transform = resolveClipTransform(clip, clip.start + point.time)
    const matching = (clip.keyframes ?? []).find((keyframe) => Math.abs(keyframe.time - point.time) <= 1 / 60)
    const next = matching
      ? (clip.keyframes ?? []).map((keyframe) => keyframe.id === matching.id ? { ...keyframe, transform: { ...keyframe.transform, [property]: point.value } } : keyframe)
      : [...(clip.keyframes ?? []), { id: crypto.randomUUID(), time: point.time, easing: 'ease-in-out' as const, transform: { ...transform, [property]: point.value } }]
    onChange(next.sort((left, right) => left.time - right.time))
  }}><line x1="0" y1={valueY(property === 'scale' || property === 'scaleX' || property === 'scaleY' || property === 'opacity' ? 100 : property === 'anchorX' || property === 'anchorY' ? 50 : 0)} x2={width} y2={valueY(property === 'scale' || property === 'scaleX' || property === 'scaleY' || property === 'opacity' ? 100 : property === 'anchorX' || property === 'anchorY' ? 50 : 0)} className="motion-reference-line" /><polyline points={samples.map((point) => `${point.x},${point.y}`).join(' ')} />{(clip.keyframes ?? []).map((keyframe) => <circle key={keyframe.id} cx={keyframe.time / Math.max(0.001, clip.duration) * width} cy={valueY(transformValue(keyframe.transform))} r="4" onPointerDown={(event) => { if (!disabled) event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={(event) => updatePoint(event, keyframe.id)} onDoubleClick={(event) => { event.stopPropagation(); if (!disabled) onChange((clip.keyframes ?? []).filter((item) => item.id !== keyframe.id)) }} />)}</svg><footer><span>{config.min}</span><span>{config.label} 값 그래프</span><span>{config.max}</span></footer><small>빈 곳을 두 번 눌러 지점 추가 · 점을 끌어 시간/값 조절 · 두 번 눌러 삭제</small></div>
}

function MotionPathEditor({ keyframes, disabled, onChange }: { keyframes: NonNullable<TimelineClip['keyframes']>; disabled?: boolean; onChange: (keyframes: NonNullable<TimelineClip['keyframes']>) => void }) {
  const sorted = [...keyframes].sort((left, right) => left.time - right.time)
  const coordinates = sorted.flatMap((keyframe) => [
    keyframe.transform.positionX, keyframe.transform.positionY,
    keyframe.transform.positionX + (keyframe.spatialIn?.x ?? 0), keyframe.transform.positionY + (keyframe.spatialIn?.y ?? 0),
    keyframe.transform.positionX + (keyframe.spatialOut?.x ?? 0), keyframe.transform.positionY + (keyframe.spatialOut?.y ?? 0),
  ])
  const range = Math.max(500, ...coordinates.map((value) => Math.abs(value) * 1.2))
  const radius = Math.max(10, range * 0.025)
  const path = sorted.map((keyframe, index) => {
    if (!index) return `M ${keyframe.transform.positionX} ${keyframe.transform.positionY}`
    const previous = sorted[index - 1]
    if (!previous.spatialOut && !keyframe.spatialIn) return `L ${keyframe.transform.positionX} ${keyframe.transform.positionY}`
    const firstX = previous.transform.positionX + (previous.spatialOut?.x ?? (keyframe.transform.positionX - previous.transform.positionX) / 3)
    const firstY = previous.transform.positionY + (previous.spatialOut?.y ?? (keyframe.transform.positionY - previous.transform.positionY) / 3)
    const secondX = keyframe.transform.positionX + (keyframe.spatialIn?.x ?? -(keyframe.transform.positionX - previous.transform.positionX) / 3)
    const secondY = keyframe.transform.positionY + (keyframe.spatialIn?.y ?? -(keyframe.transform.positionY - previous.transform.positionY) / 3)
    return `C ${firstX} ${firstY}, ${secondX} ${secondY}, ${keyframe.transform.positionX} ${keyframe.transform.positionY}`
  }).join(' ')
  const pointerPosition = (event: ReactPointerEvent<SVGElement>) => {
    const svg = (event.currentTarget.ownerSVGElement ?? event.currentTarget) as SVGSVGElement
    const bounds = svg.getBoundingClientRect()
    return { x: -range + (event.clientX - bounds.left) / Math.max(1, bounds.width) * range * 2, y: -range + (event.clientY - bounds.top) / Math.max(1, bounds.height) * range * 2 }
  }
  const movePoint = (event: ReactPointerEvent<SVGCircleElement>, id: string) => {
    if (disabled || event.buttons !== 1) return
    const point = pointerPosition(event)
    onChange(keyframes.map((keyframe) => keyframe.id === id ? { ...keyframe, transform: { ...keyframe.transform, positionX: point.x, positionY: point.y } } : keyframe))
  }
  const moveHandle = (event: ReactPointerEvent<SVGCircleElement>, id: string, side: 'spatialIn' | 'spatialOut') => {
    if (disabled || event.buttons !== 1) return
    const point = pointerPosition(event)
    onChange(keyframes.map((keyframe) => keyframe.id === id ? { ...keyframe, [side]: { x: point.x - keyframe.transform.positionX, y: point.y - keyframe.transform.positionY } } : keyframe))
  }
  const smooth = () => onChange(keyframes.map((keyframe) => {
    const index = sorted.findIndex((item) => item.id === keyframe.id)
    const previous = sorted[index - 1]
    const next = sorted[index + 1]
    const tangentX = previous && next ? (next.transform.positionX - previous.transform.positionX) / 6 : next ? (next.transform.positionX - keyframe.transform.positionX) / 3 : previous ? (keyframe.transform.positionX - previous.transform.positionX) / 3 : 0
    const tangentY = previous && next ? (next.transform.positionY - previous.transform.positionY) / 6 : next ? (next.transform.positionY - keyframe.transform.positionY) / 3 : previous ? (keyframe.transform.positionY - previous.transform.positionY) / 3 : 0
    return { ...keyframe, spatialIn: previous ? { x: -tangentX, y: -tangentY } : undefined, spatialOut: next ? { x: tangentX, y: tangentY } : undefined }
  }))
  return <div className="motion-path-editor"><header><strong>공간 모션 경로</strong><span><button disabled={disabled} onClick={smooth}>자동 곡선</button><button disabled={disabled} onClick={() => onChange(keyframes.map((keyframe) => ({ ...keyframe, spatialIn: undefined, spatialOut: undefined })))}>직선</button></span></header><svg viewBox={`${-range} ${-range} ${range * 2} ${range * 2}`} preserveAspectRatio="none"><line className="motion-path-axis" x1={-range} y1="0" x2={range} y2="0" /><line className="motion-path-axis" x1="0" y1={-range} x2="0" y2={range} /><path className="motion-path-curve" d={path} />{sorted.flatMap((keyframe) => (['spatialIn', 'spatialOut'] as const).flatMap((side) => { const handle = keyframe[side]; if (!handle) return []; const x = keyframe.transform.positionX + handle.x; const y = keyframe.transform.positionY + handle.y; return [<g key={`${keyframe.id}-${side}`}><line className="motion-path-handle-line" x1={keyframe.transform.positionX} y1={keyframe.transform.positionY} x2={x} y2={y} /><circle className="motion-path-handle" cx={x} cy={y} r={radius * 0.72} onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={(event) => moveHandle(event, keyframe.id, side)} /></g>] }))}{sorted.map((keyframe) => <circle className="motion-path-point" key={keyframe.id} cx={keyframe.transform.positionX} cy={keyframe.transform.positionY} r={radius} onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={(event) => movePoint(event, keyframe.id)} />)}</svg><small>노란 점은 위치 키프레임, 보라색 점은 공간 베지어 핸들입니다.</small></div>
}

function ColorCurveEditor({ color, disabled, onChange }: { color: ColorAdjustment; disabled?: boolean; onChange: (patch: Partial<ColorAdjustment>) => void }) {
  const [channel, setChannel] = useState<ColorCurveChannel>('masterCurve')
  const width = 240
  const height = 120
  const points = normalizeColorCurve(color[channel])
  const channelClass = channel === 'masterCurve' ? 'master' : channel === 'redCurve' ? 'red' : channel === 'greenCurve' ? 'green' : 'blue'
  const updatePoint = (event: ReactPointerEvent<SVGCircleElement>, index: number) => {
    if (disabled || event.buttons !== 1) return
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const bounds = svg.getBoundingClientRect()
    const x = index === 0 ? 0 : index === points.length - 1 ? 1 : Math.max(0.01, Math.min(0.99, (event.clientX - bounds.left) / bounds.width))
    const y = Math.max(0, Math.min(1, 1 - (event.clientY - bounds.top) / bounds.height))
    onChange({ [channel]: points.map((point, pointIndex) => pointIndex === index ? { x, y } : point).sort((a, b) => a.x - b.x) })
  }
  return <div className={`color-curve-editor ${channelClass}`}>
    <header>{([['masterCurve', 'Master'], ['redCurve', 'Red'], ['greenCurve', 'Green'], ['blueCurve', 'Blue']] as Array<[ColorCurveChannel, string]>).map(([value, label]) => <button key={value} className={channel === value ? 'active' : ''} onClick={() => setChannel(value)}>{label}</button>)}<button className="curve-reset" disabled={disabled} onClick={() => onChange({ [channel]: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })}>초기화</button></header>
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" onDoubleClick={(event) => {
      if (disabled || (event.target as SVGElement).tagName === 'circle') return
      const bounds = event.currentTarget.getBoundingClientRect()
      const point = { x: Math.max(0.01, Math.min(0.99, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, 1 - (event.clientY - bounds.top) / bounds.height)) }
      onChange({ [channel]: [...points, point].sort((a, b) => a.x - b.x) })
    }}>
      <line x1="0" y1={height} x2={width} y2="0" className="curve-identity" />
      <polyline points={points.map((point) => `${point.x * width},${(1 - point.y) * height}`).join(' ')} />
      {points.map((point, index) => <circle key={`${point.x}-${index}`} cx={point.x * width} cy={(1 - point.y) * height} r="4" onPointerDown={(event) => { if (!disabled) event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={(event) => updatePoint(event, index)} onDoubleClick={(event) => { event.stopPropagation(); if (!disabled && index > 0 && index < points.length - 1) onChange({ [channel]: points.filter((_, pointIndex) => pointIndex !== index) }) }} />)}
    </svg><small>빈 곳을 두 번 눌러 점 추가 · 드래그로 조절 · 중간점을 두 번 눌러 삭제</small>
  </div>
}

function ColorNodeGraphEditor({ color, disabled, onChange }: { color: ColorAdjustment; disabled?: boolean; onChange: (patch: Partial<ColorAdjustment>) => void }) {
  const nodes = color.colorNodes ?? []
  const [selectedId, setSelectedId] = useState(nodes[0]?.id ?? '')
  const selected = nodes.find((node) => node.id === selectedId) ?? nodes[0]
  useEffect(() => {
    if (!nodes.some((node) => node.id === selectedId)) setSelectedId(nodes[0]?.id ?? '')
  }, [nodes, selectedId])
  const normalizeNodes = (next: ColorNode[]) => {
    const available = new Set<string>(['source'])
    let previousId = 'source'
    return next.map((node) => {
      const inputIds = node.inputIds.filter((inputId) => available.has(inputId))
      const normalized = { ...node, inputIds: inputIds.length ? inputIds : [previousId] }
      available.add(node.id)
      previousId = node.id
      return normalized
    })
  }
  const commit = (nextRaw: ColorNode[], output = color.colorOutputNodeId) => {
    const next = normalizeNodes(nextRaw)
    const fallbackOutput = next.length ? next[next.length - 1].id : undefined
    onChange({ colorNodes: next, colorOutputNodeId: output && next.some((node) => node.id === output) ? output : fallbackOutput })
  }
  const update = (id: string, patch: Partial<ColorNode>) => commit(nodes.map((node) => node.id === id ? { ...node, ...patch } : node))
  const updateAdjustment = (patch: Partial<ColorNode['adjustment']>) => selected && update(selected.id, { adjustment: { ...selected.adjustment, ...patch } })
  const move = (id: string, direction: -1 | 1) => {
    const next = [...nodes]
    const index = next.findIndex((node) => node.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    commit(next)
  }
  const add = (type: ColorNodeType) => {
    const node = createColorNode(type, nodes.length ? nodes[nodes.length - 1].id : 'source', nodes.length)
    commit([...nodes, node], node.id)
    setSelectedId(node.id)
  }
  return <div className="color-node-editor">
    <div className="color-node-toolbar"><strong>색상 노드 그래프</strong>{(['primary', 'curves', 'qualifier', 'look', 'tone-map'] as ColorNodeType[]).map((type) => <button key={type} disabled={disabled || nodes.length >= 16} onClick={() => add(type)}>+ {colorNodeLabels[type]}</button>)}</div>
    <div className="color-node-source">SOURCE</div>
    {nodes.map((node, index) => {
      const inputs = ['source', ...nodes.slice(0, index).map((candidate) => candidate.id)]
      return <article className={`color-node ${node.id === selected?.id ? 'selected' : ''} ${node.enabled ? '' : 'disabled'}`} key={node.id} onClick={() => setSelectedId(node.id)}>
        <header><button className={node.enabled ? 'active' : ''} disabled={disabled} onClick={(event) => { event.stopPropagation(); update(node.id, { enabled: !node.enabled }) }}>{index + 1}</button><input value={node.name} disabled={disabled} onChange={(event) => update(node.id, { name: event.target.value })} /><small>{colorNodeLabels[node.type]}</small><button disabled={disabled || index === 0} onClick={(event) => { event.stopPropagation(); move(node.id, -1) }}>↑</button><button disabled={disabled || index === nodes.length - 1} onClick={(event) => { event.stopPropagation(); move(node.id, 1) }}>↓</button><button disabled={disabled} onClick={(event) => { event.stopPropagation(); commit(nodes.filter((item) => item.id !== node.id)) }}><Trash2 size={10} /></button></header>
        <div><label><span>입력</span><select multiple value={node.inputIds} disabled={disabled} onChange={(event) => update(node.id, { inputIds: Array.from(event.currentTarget.selectedOptions).map((option) => option.value) })}>{inputs.map((id) => <option key={id} value={id}>{id === 'source' ? 'SOURCE' : nodes.find((item) => item.id === id)?.name ?? id}</option>)}</select></label><label><span>합성</span><select value={node.blendMode} disabled={disabled || node.inputIds.length < 2} onChange={(event) => update(node.id, { blendMode: event.target.value as ColorNode['blendMode'] })}><option value="normal">평균</option><option value="add">더하기</option><option value="multiply">곱하기</option><option value="screen">스크린</option></select></label><label><span>Mix</span><input type="range" min="0" max="100" value={node.mix} disabled={disabled} onChange={(event) => update(node.id, { mix: Number(event.target.value) })} /><b>{Math.round(node.mix)}%</b></label></div>
      </article>
    })}
    {nodes.length > 0 && <label className="color-node-output"><span>PROGRAM OUTPUT</span><select value={color.colorOutputNodeId ?? nodes[nodes.length - 1].id} disabled={disabled} onChange={(event) => onChange({ colorOutputNodeId: event.target.value })}>{nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>}
    {selected && <div className="color-node-properties"><strong>{selected.name} 속성</strong>{selected.type === 'primary' && <div className="field-grid"><NumberField label="노출" value={selected.adjustment.exposure ?? 0} min={-5} max={5} disabled={disabled} onChange={(exposure) => updateAdjustment({ exposure })} /><NumberField label="대비" value={selected.adjustment.contrast ?? 0} suffix="%" min={-100} max={100} disabled={disabled} onChange={(contrast) => updateAdjustment({ contrast })} /><NumberField label="채도" value={selected.adjustment.saturation ?? 0} suffix="%" min={-100} max={200} disabled={disabled} onChange={(saturation) => updateAdjustment({ saturation })} /><NumberField label="색온도" value={selected.adjustment.temperature ?? 0} min={-100} max={100} disabled={disabled} onChange={(temperature) => updateAdjustment({ temperature })} /><NumberField label="틴트" value={selected.adjustment.tint ?? 0} min={-100} max={100} disabled={disabled} onChange={(tint) => updateAdjustment({ tint })} /><NumberField label="하이라이트" value={selected.adjustment.highlights ?? 0} min={-100} max={100} disabled={disabled} onChange={(highlights) => updateAdjustment({ highlights })} /></div>}{selected.type === 'curves' && <ColorCurveEditor color={{ ...defaultColorAdjustment(), ...selected.adjustment }} disabled={disabled} onChange={updateAdjustment} />}{selected.type === 'qualifier' && <div className="field-grid"><NumberField label="선택 색상" value={selected.adjustment.qualifierHue ?? 120} suffix="°" min={0} max={360} disabled={disabled} onChange={(qualifierHue) => updateAdjustment({ qualifierHue })} /><NumberField label="색 범위" value={selected.adjustment.qualifierHueRange ?? 30} suffix="°" min={0} max={180} disabled={disabled} onChange={(qualifierHueRange) => updateAdjustment({ qualifierHueRange })} /><NumberField label="노출" value={selected.adjustment.qualifierExposure ?? 0} min={-3} max={3} disabled={disabled} onChange={(qualifierExposure) => updateAdjustment({ qualifierExposure })} /><NumberField label="채도" value={selected.adjustment.qualifierSaturation ?? 0} suffix="%" min={-100} max={200} disabled={disabled} onChange={(qualifierSaturation) => updateAdjustment({ qualifierSaturation })} /></div>}{selected.type === 'look' && <div className="field-grid"><SelectField label="Look" value={selected.adjustment.lut ?? 'cinematic'} disabled={disabled} onChange={(lut) => updateAdjustment({ lut: lut as ColorAdjustment['lut'] })}><option value="cinematic">시네마틱</option><option value="warm">웜</option><option value="cool">쿨</option><option value="mono">모노</option></SelectField><NumberField label="강도" value={selected.adjustment.lutIntensity ?? 50} suffix="%" min={0} max={100} disabled={disabled} onChange={(lutIntensity) => updateAdjustment({ lutIntensity })} /></div>}{selected.type === 'tone-map' && <div className="field-grid"><SelectField label="방법" value={selected.adjustment.toneMapMethod ?? 'hable'} disabled={disabled} onChange={(toneMapMethod) => updateAdjustment({ toneMapMethod: toneMapMethod as 'hable' | 'reinhard' | 'mobius' })}><option value="hable">Hable</option><option value="reinhard">Reinhard</option><option value="mobius">Mobius</option></SelectField><NumberField label="원본 피크" value={selected.adjustment.sourcePeakNits ?? 1000} suffix="nit" min={100} max={10000} step={50} disabled={disabled} onChange={(sourcePeakNits) => updateAdjustment({ sourcePeakNits })} /><NumberField label="대상 피크" value={selected.adjustment.targetPeakNits ?? 100} suffix="nit" min={48} max={1000} step={10} disabled={disabled} onChange={(targetPeakNits) => updateAdjustment({ targetPeakNits })} /></div>}</div>}
  </div>
}

export function InspectorPanel({ clip, adrCue, track, tracks = [], asset, locked = false, playhead, onSeek, selectedClipCount = 0, onApplyAutomationToSelection, onApplyEffectPresetToSelection, onApplyAudioFadesToSelection, onApplyTransitionPreset, onSetDefaultTransition, onApplyCaptionStyleToTrack, programFrame, referenceFrame, onUpdateClip, onUpdateTrack, multicamAngles = [], onRenameMulticamAngle, onAssignAdrRange, onTrackMotion, motionTracking = false, onCancelMotion, onDetectScenes, sceneDetecting = false, onCancelSceneDetection, onTrackObject, objectTracking = false, onCancelObjectTracking, onStabilize, stabilizing = false, onCancelStabilization, onRemoveVideoBackground, videoBackgroundRemoval = false, onCancelVideoBackgroundRemoval }: InspectorPanelProps) {
  const [motionTemplates, setMotionTemplates] = useState(() => readMotionTemplates())
  const [selectedMotionTemplateId, setSelectedMotionTemplateId] = useState('')
  const [speedTemplates, setSpeedTemplates] = useState(() => readSpeedTemplates())
  const [effectPresets, setEffectPresets] = useState(() => readEffectPresets())
  const [selectedEffectPresetId, setSelectedEffectPresetId] = useState('')
  const [titleStyleTemplates, setTitleStyleTemplates] = useState(() => readTitleStyleTemplates())
  const [selectedTitleStyleId, setSelectedTitleStyleId] = useState('')
  const [transitionPresets, setTransitionPresets] = useState(() => readTransitionPresets())
  const [selectedTransitionPresetId, setSelectedTransitionPresetId] = useState('')
  const [transitionPresetQuery, setTransitionPresetQuery] = useState('')
  const [lutImportError, setLutImportError] = useState('')
  const [colorMatchError, setColorMatchError] = useState('')
  useEffect(() => {
    const refresh = () => { setMotionTemplates(readMotionTemplates()); setSpeedTemplates(readSpeedTemplates()); setEffectPresets(readEffectPresets()); setTitleStyleTemplates(readTitleStyleTemplates()); setTransitionPresets(readTransitionPresets()) }
    window.addEventListener(CREATOR_PACK_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(CREATOR_PACK_CHANGED_EVENT, refresh)
  }, [])
  useEffect(() => { setLutImportError(''); setColorMatchError('') }, [clip?.id])
  const [selectedSpeedTemplateId, setSelectedSpeedTemplateId] = useState('')
  const [adrCompIn, setAdrCompIn] = useState(0)
  const [adrCompOut, setAdrCompOut] = useState(0)
  const [automationClipboardRevision, setAutomationClipboardRevision] = useState(0)
  const [transitionClipboardRevision, setTransitionClipboardRevision] = useState(0)
  const [keyframeRangeScope, setKeyframeRangeScope] = useState<KeyframeRangeScope>('all')
  const [keyframeRangeIn, setKeyframeRangeIn] = useState(0)
  const [keyframeRangeOut, setKeyframeRangeOut] = useState(0)
  const [keyframePasteTiming, setKeyframePasteTiming] = useState<'original' | 'fit'>('original')
  const [keyframeClipboardMessage, setKeyframeClipboardMessage] = useState('')
  const motionImportRef = useRef<HTMLInputElement>(null)
  const speedImportRef = useRef<HTMLInputElement>(null)
  const effectImportRef = useRef<HTMLInputElement>(null)
  const titleStyleImportRef = useRef<HTMLInputElement>(null)
  const transitionImportRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!adrCue) return
    setAdrCompIn(adrCue.start)
    setAdrCompOut(adrCue.end)
  }, [adrCue?.id])
  useEffect(() => {
    setKeyframeRangeIn(0)
    setKeyframeRangeOut(clip?.duration ?? 0)
    setKeyframeClipboardMessage('')
  }, [clip?.id, clip?.duration])
  if (!clip) {
    if (track) {
      const mix = resolveTrackAudioMix(track, playhead)
      const mixAutomationMode = track.mixAutomationMode ?? (track.mixKeyframes?.length ? 'read' : 'off')
      const updateMix = (patch: Partial<Pick<NonNullable<TimelineTrack['mixKeyframes']>[number], 'volume' | 'pan'>>) => {
        if (track.kind === 'caption') return
        const keyframes = track.mixKeyframes ?? []
        if (mixAutomationMode === 'off') {
          onUpdateTrack(track.id, patch)
          return
        }
        const matching = keyframes.find((keyframe) => Math.abs(keyframe.time - playhead) <= 1 / 60)
        const next = matching
          ? keyframes.map((keyframe) => keyframe.id === matching.id ? { ...keyframe, ...patch } : keyframe)
          : [...keyframes, { id: crypto.randomUUID(), time: playhead, volume: mix.volume, pan: mix.pan, easing: 'ease-in-out' as const, ...patch }]
        onUpdateTrack(track.id, { mixKeyframes: next.sort((a, b) => a.time - b.time) })
      }
      const addMixKeyframe = () => {
        const next = [...(track.mixKeyframes ?? [])].filter((keyframe) => Math.abs(keyframe.time - playhead) > 1 / 60)
        next.push({ id: crypto.randomUUID(), time: playhead, volume: mix.volume, pan: mix.pan, easing: 'ease-in-out' })
        onUpdateTrack(track.id, { mixAutomationMode: mixAutomationMode === 'off' ? 'read' : mixAutomationMode, mixKeyframes: next.sort((a, b) => a.time - b.time) })
      }
      return (
        <aside className="inspector-panel panel-surface">
          <div className="inspector-title"><div><span className="eyebrow">TRACK MIXER</span><h2>트랙 속성</h2></div><span className={`kind-badge ${track.kind}`}>{track.kind}</span></div>
          <label className="text-field"><span>트랙 이름</span><input value={track.name} disabled={track.locked} onChange={(event) => onUpdateTrack(track.id, { name: event.target.value })} /></label>
          <div className="track-identity-properties">
            <label className="color-field"><span>트랙 식별 색상</span><input type="color" value={track.labelColor ?? (track.kind === 'video' ? '#7862d6' : track.kind === 'audio' ? '#3fb993' : '#c79243')} disabled={track.locked} onChange={(event) => onUpdateTrack(track.id, { labelColor: event.target.value })} /></label>
            <NumberField label="표시 높이" value={track.displayHeight ?? 64} suffix="px" min={40} max={180} step={4} disabled={track.locked} onChange={(displayHeight) => onUpdateTrack(track.id, { displayHeight })} />
            {track.kind !== 'caption' && <label className="text-field"><span>기본 출력 버스</span><select value={track.audioRole ?? ''} disabled={track.locked} onChange={(event) => onUpdateTrack(track.id, { audioRole: event.target.value ? event.target.value as AudioAdjustment['role'] : undefined })}><option value="">클립 설정 사용</option>{audioRoles.map((role) => <option key={role} value={role}>{role === 'dialogue' ? '대화' : role === 'music' ? '음악' : role === 'effects' ? '효과음' : '환경음'}</option>)}</select></label>}
          </div>
          {track.kind !== 'caption' && <section className="property-section">
            <h3>5.1 트랙 출력</h3>
            <div className="field-grid">
              <SelectField label="출력 채널" value={track.audioOutputChannel ?? 'auto'} disabled={track.locked} onChange={(audioOutputChannel) => onUpdateTrack(track.id, { audioOutputChannel: audioOutputChannel as TimelineTrack['audioOutputChannel'] })}><option value="auto">자동 · 역할/클립 설정</option><option value="left">L · 왼쪽</option><option value="right">R · 오른쪽</option><option value="center">C · 센터</option><option value="lfe">LFE · 저역 효과</option><option value="left-surround">Ls · 왼쪽 서라운드</option><option value="right-surround">Rs · 오른쪽 서라운드</option><option value="surround-pan">공간 패너</option></SelectField>
              {track.audioOutputChannel === 'surround-pan' && <><NumberField label="공간 위치" value={track.surroundPan ?? 0} suffix="°" min={-180} max={180} disabled={track.locked} onChange={(surroundPan) => onUpdateTrack(track.id, { surroundPan })} /><NumberField label="스테레오 펼침" value={track.surroundSpread ?? 60} suffix="°" min={0} max={180} disabled={track.locked} onChange={(surroundSpread) => onUpdateTrack(track.id, { surroundSpread })} /></>}
              <NumberField label="LFE 센드" value={track.lfeSendDb ?? -60} suffix="dB" min={-60} max={12} step={0.5} disabled={track.locked} onChange={(lfeSendDb) => onUpdateTrack(track.id, { lfeSendDb })} />
              {(track.lfeSendDb ?? -60) > -60 && <NumberField label="LFE 로우패스" value={track.lfeLowpassHz ?? 120} suffix="Hz" min={80} max={200} step={5} disabled={track.locked} onChange={(lfeLowpassHz) => onUpdateTrack(track.id, { lfeLowpassHz })} />}
            </div>
            <p className="feature-note">자동은 역할별 기본 배치를 사용합니다. 지정 채널과 공간 패너는 5.1 납품에서 해당 트랙을 한 번만 직접 라우팅합니다.</p>
          </section>}
          <section className="property-section">
            <div className="property-heading"><h3>믹서 · 자동화</h3>{track.kind !== 'caption' && <button className="mini-action" disabled={track.locked} onClick={addMixKeyframe}><Plus size={12} /> {playhead.toFixed(2)}s</button>}</div>
            <div className="field-grid">{track.kind !== 'caption' && <SelectField label="자동화 모드" value={mixAutomationMode} disabled={track.locked} onChange={(mixAutomationMode) => onUpdateTrack(track.id, { mixAutomationMode: mixAutomationMode as TimelineTrack['mixAutomationMode'] })}><option value="off">Off · 기본값</option><option value="read">Read · 재생</option><option value="write">Write · 덮어쓰기</option><option value="touch">Touch · 놓으면 복귀</option><option value="latch">Latch · 값 유지</option></SelectField>}<NumberField label="음량" value={mix.volume} suffix="%" min={0} max={200} disabled={track.locked || track.kind === 'caption' || mixAutomationMode === 'read'} onChange={(volume) => updateMix({ volume })} /><NumberField label="팬" value={mix.pan} min={-100} max={100} disabled={track.locked || track.kind === 'caption' || mixAutomationMode === 'read'} onChange={(pan) => updateMix({ pan })} />{track.kind === 'video' && <NumberField label="합성 우선순위" value={track.compositePriority ?? 0} min={-10000} max={10000} step={100} disabled={track.locked} onChange={(compositePriority) => onUpdateTrack(track.id, { compositePriority: Math.round(compositePriority) })} />}</div>
            <div className="toggle-row"><Toggle label="음소거" checked={track.muted} disabled={track.locked} onChange={(muted) => onUpdateTrack(track.id, { muted })} /><Toggle label="솔로" checked={Boolean(track.solo)} disabled={track.locked || track.kind === 'caption'} onChange={(solo) => onUpdateTrack(track.id, { solo })} /><Toggle label="표시" checked={track.visible !== false} disabled={track.locked || track.kind === 'audio'} onChange={(visible) => onUpdateTrack(track.id, { visible })} /></div>
            {track.kind !== 'caption' && <div className="keyframe-list">{(track.mixKeyframes ?? []).map((keyframe) => <div key={keyframe.id}><Diamond size={10} fill="currentColor" /><span>{keyframe.time.toFixed(2)}s · {keyframe.volume.toFixed(0)}% · 팬 {keyframe.pan.toFixed(0)}</span><select value={keyframe.easing} disabled={track.locked} onChange={(event) => onUpdateTrack(track.id, { mixKeyframes: track.mixKeyframes?.map((item) => item.id === keyframe.id ? { ...item, easing: event.target.value as typeof item.easing } : item) })}><option value="linear">선형</option><option value="hold">홀드</option><option value="ease-in">가속</option><option value="ease-out">감속</option><option value="ease-in-out">부드럽게</option></select><button aria-label="트랙 믹스 키프레임 삭제" disabled={track.locked} onClick={() => onUpdateTrack(track.id, { mixKeyframes: track.mixKeyframes?.filter((item) => item.id !== keyframe.id) })}><Trash2 size={11} /></button></div>)}{!track.mixKeyframes?.length && <small>재생 헤드 위치에 트랙 음량·팬을 기록합니다. 자동화는 타임라인 절대 시간에 고정됩니다.</small>}</div>}
          </section>
        </aside>
      )
    }
    return (
      <aside className="inspector-panel panel-surface empty-inspector">
        <SlidersHorizontal size={21} />
        <strong>속성</strong>
        <p>타임라인에서 클립을 선택하면 세부 속성이 표시됩니다.</p>
      </aside>
    )
  }

  const color = { ...defaultColorAdjustment(), ...clip.colorAdjustment }
  const audio = { ...defaultAudioAdjustment(), ...clip.audioAdjustment }
  const effectiveAudioRole = track?.audioRole ?? audio.role
  const analyzedPeakDbfs = asset?.audioPeak !== undefined && asset.audioPeak > 1e-6 ? 20 * Math.log10(asset.audioPeak) : undefined
  const normalizationGainDb = peakNormalizationGainDb(asset?.audioPeak)
  const normalizedPeakDbfs = analyzedPeakDbfs !== undefined ? analyzedPeakDbfs + normalizationGainDb : undefined
  const noiseGateDbfs = audio.noiseReduction > 0 ? 20 * Math.log10(noiseGateThreshold(audio.noiseReduction)) : undefined
  const auxSends = resolveAudioAuxSends(audio)
  const audioMix = resolveClipAudioMix(clip, playhead)
  const caption = { ...defaultCaptionStyle(), ...clip.captionStyle }
  const visual = resolveVisualEffects(clip, playhead)
  const updateTransform = (patch: Partial<TimelineClip['transform']>) => onUpdateClip(clip.id, { transform: { ...clip.transform, ...patch } })
  const updateColor = (patch: Partial<ColorAdjustment>) => onUpdateClip(clip.id, { colorAdjustment: { ...color, ...patch } })
  const currentProgramImage = () => {
    const canvas = programFrame?.canvas
    const context = canvas?.getContext('2d', { willReadFrequently: true })
    if (!canvas || !context || !canvas.width || !canvas.height) throw new Error('현재 프로그램 프레임을 읽을 수 없습니다.')
    return context.getImageData(0, 0, canvas.width, canvas.height)
  }
  const applyAutoWhiteBalance = () => {
    try {
      const statistics = analyzeFrameColor(currentProgramImage())
      onUpdateClip(clip.id, { colorAdjustment: appendGeneratedColorNodes(color, createAutoWhiteBalanceNodes(statistics)) })
      setColorMatchError('')
    } catch (error) {
      setColorMatchError(error instanceof Error ? error.message : '자동 화이트 밸런스를 계산하지 못했습니다.')
    }
  }
  const applyReferenceColorMatch = () => {
    try {
      if (!referenceFrame) throw new Error('먼저 프로그램 모니터에서 기준 프레임을 저장해주세요.')
      const source = analyzeFrameColor(currentProgramImage())
      const target = analyzeFrameColor(referenceFrame)
      onUpdateClip(clip.id, { colorAdjustment: appendGeneratedColorNodes(color, createReferenceMatchNodes(source, target)) })
      setColorMatchError('')
    } catch (error) {
      setColorMatchError(error instanceof Error ? error.message : '기준 프레임 색상 매칭을 계산하지 못했습니다.')
    }
  }
  const removeGeneratedColorMatch = () => {
    const colorNodes = (color.colorNodes ?? []).filter((node) => !node.name.endsWith('· Generated'))
    onUpdateClip(clip.id, { colorAdjustment: { ...color, colorNodes, colorOutputNodeId: colorNodes.some((node) => node.id === color.colorOutputNodeId) ? color.colorOutputNodeId : colorNodes.at(-1)?.id } })
    setColorMatchError('')
  }
  const updateAudio = (patch: Partial<AudioAdjustment>) => onUpdateClip(clip.id, { audioAdjustment: { ...audio, ...patch } })
  const applyAudioFadePreset = (fadeIn: number, fadeOut: number, curve: NonNullable<AudioAdjustment['fadeInCurve']>) => updateAudio({
    fadeIn: Math.min(clip.duration, fadeIn),
    fadeOut: Math.min(clip.duration, fadeOut),
    fadeInCurve: curve,
    fadeOutCurve: curve,
  })
  const updateAuxSends = (next: AudioAdjustment['auxSends']) => updateAudio({ auxSends: next, sendBus: undefined, sendLevelDb: undefined })
  const updateCaption = (patch: Partial<CaptionStyle>) => onUpdateClip(clip.id, { captionStyle: { ...caption, ...patch } })
  const localTime = Math.max(0, Math.min(clip.duration, playhead - clip.start))
  const transitionDurationLimit = (edge: 'in' | 'out') => {
    const transition = edge === 'in' ? clip.transitionIn : clip.transitionOut
    const alignment = transition?.alignment ?? (edge === 'in' ? 'start-at-cut' : 'end-at-cut')
    return alignment === 'center-on-cut' ? clip.duration * 2 : clip.duration
  }
  const transitionInsideDuration = (edge: 'in' | 'out', transition: TimelineClip['transitionIn']) => {
    if (!transition || transition.type === 'none') return 0
    const alignment = transition.alignment ?? (edge === 'in' ? 'start-at-cut' : 'end-at-cut')
    if (alignment === 'center-on-cut') return transition.duration / 2
    if (edge === 'in') return alignment === 'start-at-cut' ? transition.duration : 0
    return alignment === 'end-at-cut' ? transition.duration : 0
  }
  const convertAudioTransitionsToFades = () => onUpdateClip(clip.id, {
    audioAdjustment: {
      ...audio,
      fadeIn: Math.min(clip.duration, transitionInsideDuration('in', clip.transitionIn)),
      fadeOut: Math.min(clip.duration, transitionInsideDuration('out', clip.transitionOut)),
      fadeInCurve: clip.transitionIn?.audioCurve ?? audio.fadeInCurve ?? 'equal-power',
      fadeOutCurve: clip.transitionOut?.audioCurve ?? audio.fadeOutCurve ?? 'equal-power',
    },
    transitionIn: clip.transitionIn ? { ...clip.transitionIn, type: 'none', duration: 0 } : undefined,
    transitionOut: clip.transitionOut ? { ...clip.transitionOut, type: 'none', duration: 0 } : undefined,
  })
  const convertAudioFadesToTransitions = () => onUpdateClip(clip.id, {
    audioAdjustment: { ...audio, fadeIn: 0, fadeOut: 0 },
    transitionIn: audio.fadeIn > 0 ? { type: 'crossfade', duration: Math.min(clip.duration, audio.fadeIn), alignment: 'start-at-cut', easing: 'linear', audioCurve: audio.fadeInCurve ?? 'linear' } : clip.transitionIn,
    transitionOut: audio.fadeOut > 0 ? { type: 'crossfade', duration: Math.min(clip.duration, audio.fadeOut), alignment: 'end-at-cut', easing: 'linear', audioCurve: audio.fadeOutCurve ?? 'linear' } : clip.transitionOut,
  })
  const matteSourceTracks = tracks.filter((candidate) => candidate.kind === 'video' && candidate.id !== clip.trackId)
  const keyframeTimes = [...new Set([
    ...(clip.keyframes ?? []).map((keyframe) => keyframe.time),
    ...(clip.speedKeyframes ?? []).map((keyframe) => keyframe.time),
    ...(clip.visualKeyframes ?? []).map((keyframe) => keyframe.time),
    ...(clip.audioMixKeyframes ?? []).map((keyframe) => keyframe.time),
  ])].sort((a, b) => a - b)
  const previousKeyframeTime = [...keyframeTimes].reverse().find((time) => time < localTime - 1 / 240)
  const nextKeyframeTime = keyframeTimes.find((time) => time > localTime + 1 / 240)
  const copyAutomation = () => {
    clipAutomationClipboard = cloneAutomationValue({
      sourceKind: clip.kind,
      sourceDuration: clip.duration,
      transform: clip.transform,
      keyframes: clip.keyframes,
      motionPathAutoOrient: clip.motionPathAutoOrient,
      motionPathOrientationOffset: clip.motionPathOrientationOffset,
      motionBlur: clip.motionBlur,
      playbackRate: clip.playbackRate,
      speedKeyframes: clip.speedKeyframes,
      colorAdjustment: clip.colorAdjustment,
      visualEffects: clip.visualEffects,
      effectStack: clip.effectStack,
      visualKeyframes: clip.visualKeyframes,
      audioAdjustment: clip.audioAdjustment,
      audioMixKeyframes: clip.audioMixKeyframes,
    })
    setAutomationClipboardRevision((revision) => revision + 1)
  }
  const pasteAutomation = () => {
    const copied = clipAutomationClipboard
    if (!copied) return
    const scaleTime = (time: number) => Math.max(0, Math.min(clip.duration, time * clip.duration / Math.max(0.001, copied.sourceDuration)))
    const patch: Partial<TimelineClip> = {}
    if (copied.sourceKind !== 'audio' && clip.kind !== 'audio') {
      patch.transform = cloneAutomationValue(copied.transform)
      patch.keyframes = copied.keyframes?.map((keyframe) => ({ ...cloneAutomationValue(keyframe), id: crypto.randomUUID(), time: scaleTime(keyframe.time) }))
      patch.motionPathAutoOrient = copied.motionPathAutoOrient
      patch.motionPathOrientationOffset = copied.motionPathOrientationOffset
      patch.motionBlur = cloneAutomationValue(copied.motionBlur)
    }
    if (copied.sourceKind !== 'caption' && clip.kind !== 'caption') {
      patch.playbackRate = copied.playbackRate
      patch.speedKeyframes = copied.speedKeyframes?.map((keyframe) => ({ ...cloneAutomationValue(keyframe), id: crypto.randomUUID(), time: scaleTime(keyframe.time) }))
    }
    if (copied.sourceKind === 'video' && clip.kind === 'video') {
      patch.colorAdjustment = cloneAutomationValue(copied.colorAdjustment)
      patch.visualEffects = cloneAutomationValue(copied.visualEffects)
      patch.effectStack = copied.effectStack?.map((item) => ({ ...cloneAutomationValue(item), id: crypto.randomUUID() }))
      patch.visualKeyframes = copied.visualKeyframes?.map((keyframe) => ({ ...cloneAutomationValue(keyframe), id: crypto.randomUUID(), time: scaleTime(keyframe.time) }))
    }
    if (copied.sourceKind !== 'caption' && clip.kind !== 'caption') {
      patch.audioAdjustment = cloneAutomationValue(copied.audioAdjustment)
      patch.audioMixKeyframes = copied.audioMixKeyframes?.map((keyframe) => ({ ...cloneAutomationValue(keyframe), id: crypto.randomUUID(), time: scaleTime(keyframe.time) }))
    }
    onUpdateClip(clip.id, patch)
  }
  const copyKeyframeRange = () => {
    const rangeStart = Math.max(0, Math.min(clip.duration, Math.min(keyframeRangeIn, keyframeRangeOut)))
    const rangeEnd = Math.max(rangeStart, Math.min(clip.duration, Math.max(keyframeRangeIn, keyframeRangeOut)))
    const relative = <T extends { time: number }>(items: T[] | undefined) => items?.filter((item) => item.time >= rangeStart - 1 / 240 && item.time <= rangeEnd + 1 / 240).map((item) => ({ ...cloneAutomationValue(item), time: item.time - rangeStart }))
    const copied: KeyframeRangeClipboard = {
      sourceKind: clip.kind,
      scope: keyframeRangeScope,
      duration: rangeEnd - rangeStart,
      keyframes: keyframeRangeScope === 'all' || keyframeRangeScope === 'transform' ? relative(clip.keyframes) : undefined,
      speedKeyframes: keyframeRangeScope === 'all' || keyframeRangeScope === 'speed' ? relative(clip.speedKeyframes) : undefined,
      visualKeyframes: keyframeRangeScope === 'all' || keyframeRangeScope === 'visual' ? relative(clip.visualKeyframes) : undefined,
      audioMixKeyframes: keyframeRangeScope === 'all' || keyframeRangeScope === 'audio' ? relative(clip.audioMixKeyframes) : undefined,
    }
    const count = (copied.keyframes?.length ?? 0) + (copied.speedKeyframes?.length ?? 0) + (copied.visualKeyframes?.length ?? 0) + (copied.audioMixKeyframes?.length ?? 0)
    if (!count) { setKeyframeClipboardMessage('선택 구간에 복사할 키프레임이 없습니다.'); return }
    keyframeRangeClipboard = copied
    setAutomationClipboardRevision((revision) => revision + 1)
    setKeyframeClipboardMessage(`${count}개 키프레임을 ${rangeStart.toFixed(2)}–${rangeEnd.toFixed(2)}s 구간에서 복사했습니다.`)
  }
  const pasteKeyframeRange = () => {
    const copied = keyframeRangeClipboard
    if (!copied) return
    const available = Math.max(0, clip.duration - localTime)
    const scale = keyframePasteTiming === 'fit' && copied.duration > 1 / 1000 ? available / copied.duration : 1
    const tolerance = 1 / 240
    const place = <T extends { id: string; time: number }>(items: T[] | undefined) => (items ?? []).flatMap((item) => {
      const time = localTime + item.time * scale
      return time <= clip.duration + tolerance ? [{ ...cloneAutomationValue(item), id: crypto.randomUUID(), time: Math.max(0, Math.min(clip.duration, time)) }] : []
    })
    const merge = <T extends { id: string; time: number }>(current: T[] | undefined, incoming: T[]) => [...(current ?? []).filter((item) => !incoming.some((candidate) => Math.abs(candidate.time - item.time) <= tolerance)), ...incoming].sort((left, right) => left.time - right.time)
    const patch: Partial<TimelineClip> = {}
    let count = 0
    if (copied.sourceKind !== 'audio' && clip.kind !== 'audio') {
      const incoming = place(copied.keyframes)
      if (incoming.length) { patch.keyframes = merge(clip.keyframes, incoming); count += incoming.length }
    }
    if (copied.sourceKind !== 'caption' && clip.kind !== 'caption' && !clip.adjustmentLayer && !clip.nestedSequenceId) {
      const incoming = place(copied.speedKeyframes)
      if (incoming.length) { patch.speedKeyframes = merge(clip.speedKeyframes, incoming); count += incoming.length }
    }
    if (copied.sourceKind === 'video' && clip.kind === 'video') {
      const incoming = place(copied.visualKeyframes)
      if (incoming.length) { patch.visualKeyframes = merge(clip.visualKeyframes, incoming); count += incoming.length }
    }
    if (copied.sourceKind !== 'caption' && clip.kind !== 'caption') {
      const incoming = place(copied.audioMixKeyframes)
      if (incoming.length) { patch.audioMixKeyframes = merge(clip.audioMixKeyframes, incoming); count += incoming.length }
    }
    if (!count) { setKeyframeClipboardMessage('대상 클립과 호환되는 키프레임이 없습니다.'); return }
    onUpdateClip(clip.id, patch)
    setKeyframeClipboardMessage(`${count}개 키프레임을 ${localTime.toFixed(2)}s부터 ${keyframePasteTiming === 'fit' ? '남은 길이에 맞춰' : '원래 간격으로'} 배치했습니다.`)
  }
  const updateVisual = (patch: Partial<VisualEffects>) => {
    const visualKeyframes = clip.visualKeyframes ?? []
    if (!visualKeyframes.length) {
      onUpdateClip(clip.id, { visualEffects: { ...visual, ...patch } })
      return
    }
    const matching = visualKeyframes.find((item) => Math.abs(item.time - localTime) <= 1 / 60)
    const next = matching
      ? visualKeyframes.map((item) => item.id === matching.id ? { ...item, effects: { ...visual, ...patch } } : item)
      : [...visualKeyframes, { id: crypto.randomUUID(), time: localTime, easing: 'ease-in-out' as const, effects: { ...visual, ...patch } }]
    onUpdateClip(clip.id, { visualKeyframes: next.sort((a, b) => a.time - b.time) })
  }
  const moveEffectStackItem = (id: string, direction: -1 | 1) => {
    const next = [...(clip.effectStack ?? createDefaultVideoEffectStack())]
    const index = next.findIndex((item) => item.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onUpdateClip(clip.id, { effectStack: next })
  }
  const addEffectStackItem = (kind: VideoEffectStackKind) => {
    const config = videoEffectStackKinds.find((item) => item.kind === kind)
    if (!config || clip.effectStack?.some((item) => item.kind === kind)) return
    onUpdateClip(clip.id, { effectStack: [...(clip.effectStack ?? []), { ...config, id: crypto.randomUUID(), enabled: true }] })
  }

  const addKeyframe = () => {
    const keyframes = [...(clip.keyframes ?? [])].filter((item) => Math.abs(item.time - localTime) > 1 / 60)
    keyframes.push({ id: crypto.randomUUID(), time: localTime, easing: 'ease-in-out', transform: { ...clip.transform } })
    keyframes.sort((a, b) => a.time - b.time)
    onUpdateClip(clip.id, { keyframes })
  }

  const addVisualKeyframe = () => {
    const visualKeyframes = [...(clip.visualKeyframes ?? [])].filter((item) => Math.abs(item.time - localTime) > 1 / 60)
    visualKeyframes.push({ id: crypto.randomUUID(), time: localTime, easing: 'ease-in-out', effects: { ...visual, maskPoints: visual.maskPoints?.map((point) => ({ ...point })), cornerPinPoints: visual.cornerPinPoints?.map((point) => ({ ...point })), masks: visual.masks?.map((mask) => ({ ...mask, points: mask.points.map((point) => ({ ...point, inHandle: point.inHandle ? { ...point.inHandle } : undefined, outHandle: point.outHandle ? { ...point.outHandle } : undefined })) })) } })
    visualKeyframes.sort((a, b) => a.time - b.time)
    onUpdateClip(clip.id, { visualKeyframes })
  }

  const addSpeedKeyframe = () => {
    const speedKeyframes = [...(clip.speedKeyframes ?? [])].filter((item) => Math.abs(item.time - localTime) > 1 / 60)
    speedKeyframes.push({ id: crypto.randomUUID(), time: localTime, rate: Math.max(0.05, clipPlaybackRateAtLocal(clip, localTime)), easing: 'ease-in-out' })
    speedKeyframes.sort((a, b) => a.time - b.time)
    onUpdateClip(clip.id, { speedKeyframes })
  }

  const saveSpeedTemplate = () => {
    const name = window.prompt('속도 템플릿 이름', `${clip.name} 속도`)
    if (!name) return
    const template = createSpeedTemplate(name, clip)
    const next = [...speedTemplates, template]
    try {
      writeSpeedTemplates(next)
      setSpeedTemplates(next)
      setSelectedSpeedTemplateId(template.id)
    } catch {
      window.alert('속도 템플릿 저장 공간이 부족합니다.')
    }
  }

  const applySelectedSpeedTemplate = () => {
    const template = speedTemplates.find((candidate) => candidate.id === selectedSpeedTemplateId)
    if (template) onUpdateClip(clip.id, applySpeedTemplate(template, clip.duration))
  }

  const deleteSelectedSpeedTemplate = () => {
    const next = speedTemplates.filter((candidate) => candidate.id !== selectedSpeedTemplateId)
    try {
      writeSpeedTemplates(next)
      setSpeedTemplates(next)
      setSelectedSpeedTemplateId('')
    } catch {
      window.alert('속도 템플릿 저장소를 갱신하지 못했습니다.')
    }
  }

  const exportSelectedSpeedTemplate = () => {
    const template = speedTemplates.find((candidate) => candidate.id === selectedSpeedTemplateId)
    if (!template) return
    const url = URL.createObjectURL(new Blob([serializeSpeedTemplate(template)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${template.name.replace(/[\\/:*?"<>|]/g, '-')}.editweave-speed.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const importSpeedTemplate = async (file?: File) => {
    if (!file) return
    try {
      const template = parseSpeedTemplate(await file.text())
      const next = [...speedTemplates, template]
      writeSpeedTemplates(next)
      setSpeedTemplates(next)
      setSelectedSpeedTemplateId(template.id)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '속도 템플릿을 가져오지 못했습니다.')
    } finally {
      if (speedImportRef.current) speedImportRef.current.value = ''
    }
  }

  const updateAudioMix = (patch: Partial<typeof audioMix>) => {
    if (!clip.audioMixKeyframes?.length) {
      updateAudio(patch)
      return
    }
    const matching = clip.audioMixKeyframes.find((item) => Math.abs(item.time - localTime) <= 1 / 60)
    const next = matching
      ? clip.audioMixKeyframes.map((item) => item.id === matching.id ? { ...item, ...audioMix, ...patch } : item)
      : [...clip.audioMixKeyframes, { id: crypto.randomUUID(), time: localTime, easing: 'ease-in-out' as const, ...audioMix, ...patch }]
    onUpdateClip(clip.id, { audioMixKeyframes: next.sort((a, b) => a.time - b.time) })
  }

  const addAudioMixKeyframe = () => {
    const audioMixKeyframes = [...(clip.audioMixKeyframes ?? [])].filter((item) => Math.abs(item.time - localTime) > 1 / 60)
    audioMixKeyframes.push({ id: crypto.randomUUID(), time: localTime, easing: 'ease-in-out', ...audioMix })
    audioMixKeyframes.sort((a, b) => a.time - b.time)
    onUpdateClip(clip.id, { audioMixKeyframes })
  }

  const saveMotionTemplate = () => {
    const name = window.prompt('모션 템플릿 이름', `${clip.name} 모션`)
    if (!name) return
    const template = createMotionTemplate(name, {
      sourceDuration: clip.duration,
      transform: { ...clip.transform },
      keyframes: clip.keyframes ?? [],
      motionPathAutoOrient: clip.motionPathAutoOrient,
      motionPathOrientationOffset: clip.motionPathOrientationOffset,
      motionBlur: clip.motionBlur,
      visualEffects: clip.visualEffects,
      visualKeyframes: clip.visualKeyframes,
    })
    const next = [...motionTemplates, template]
    try {
      writeMotionTemplates(next)
    } catch {
      window.alert('모션 템플릿 저장 공간이 부족합니다. 기존 템플릿을 내보낸 뒤 삭제해주세요.')
      return
    }
    setMotionTemplates(next)
    setSelectedMotionTemplateId(template.id)
  }

  const applySelectedMotionTemplate = () => {
    const template = motionTemplates.find((candidate) => candidate.id === selectedMotionTemplateId)
    if (!template) return
    const applied = applyMotionTemplate(template, clip.duration)
    onUpdateClip(clip.id, {
      transform: applied.transform,
      keyframes: applied.keyframes,
      motionPathAutoOrient: applied.motionPathAutoOrient,
      motionPathOrientationOffset: applied.motionPathOrientationOffset,
      motionBlur: applied.motionBlur,
      ...(applied.visualEffects ? { visualEffects: applied.visualEffects } : {}),
      ...(applied.visualKeyframes ? { visualKeyframes: applied.visualKeyframes } : {}),
    })
  }

  const deleteSelectedMotionTemplate = () => {
    if (!selectedMotionTemplateId) return
    const next = motionTemplates.filter((candidate) => candidate.id !== selectedMotionTemplateId)
    try {
      writeMotionTemplates(next)
    } catch {
      window.alert('모션 템플릿 저장소를 갱신하지 못했습니다.')
      return
    }
    setMotionTemplates(next)
    setSelectedMotionTemplateId('')
  }

  const exportSelectedMotionTemplate = () => {
    const template = motionTemplates.find((candidate) => candidate.id === selectedMotionTemplateId)
    if (!template) return
    const url = URL.createObjectURL(new Blob([serializeMotionTemplate(template)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${template.name.replace(/[\\/:*?"<>|]/g, '-')}.editweave-motion.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const importMotionTemplate = async (file?: File) => {
    if (!file) return
    try {
      const template = parseMotionTemplate(await file.text())
      const next = [...motionTemplates, template]
      writeMotionTemplates(next)
      setMotionTemplates(next)
      setSelectedMotionTemplateId(template.id)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '모션 템플릿을 가져오지 못했습니다.')
    } finally {
      if (motionImportRef.current) motionImportRef.current.value = ''
    }
  }

  const saveEffectPreset = () => {
    const name = window.prompt('효과 프리셋 이름', `${clip.name} 효과`)
    if (!name) return
    const preset = createEffectPreset(name, {
      ...clip,
      colorAdjustment: color,
      visualEffects: visual,
      audioAdjustment: audio,
    })
    const next = [...effectPresets, preset]
    try {
      writeEffectPresets(next)
      setEffectPresets(next)
      setSelectedEffectPresetId(preset.id)
    } catch {
      window.alert('효과 프리셋 저장 공간이 부족합니다.')
    }
  }

  const applySelectedEffectPreset = (toSelection = false) => {
    const preset = effectPresets.find((candidate) => candidate.id === selectedEffectPresetId)
    if (!preset) return
    const patch = applyEffectPreset(preset, clip.kind)
    onUpdateClip(clip.id, patch)
    if (toSelection) onApplyEffectPresetToSelection?.(clip.id, patch)
  }

  const deleteSelectedEffectPreset = () => {
    const next = effectPresets.filter((candidate) => candidate.id !== selectedEffectPresetId)
    try {
      writeEffectPresets(next)
      setEffectPresets(next)
      setSelectedEffectPresetId('')
    } catch {
      window.alert('효과 프리셋 저장소를 갱신하지 못했습니다.')
    }
  }

  const exportSelectedEffectPreset = () => {
    const preset = effectPresets.find((candidate) => candidate.id === selectedEffectPresetId)
    if (!preset) return
    const url = URL.createObjectURL(new Blob([serializeEffectPreset(preset)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${preset.name.replace(/[\\/:*?"<>|]/g, '-')}.editweave-effect.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const importEffectPreset = async (file?: File) => {
    if (!file) return
    try {
      const preset = parseEffectPreset(await file.text())
      const next = [...effectPresets, preset]
      writeEffectPresets(next)
      setEffectPresets(next)
      setSelectedEffectPresetId(preset.id)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '효과 프리셋을 가져오지 못했습니다.')
    } finally {
      if (effectImportRef.current) effectImportRef.current.value = ''
    }
  }

  const transitionPresetKind = clip.kind === 'audio' ? 'audio' as const : 'video' as const
  const transitionPresetNeedle = transitionPresetQuery.trim().toLocaleLowerCase('ko-KR')
  const compatibleTransitionPresets = transitionPresets
    .filter((preset) => preset.mediaKind === transitionPresetKind && (!transitionPresetNeedle || preset.name.toLocaleLowerCase('ko-KR').includes(transitionPresetNeedle)))
    .sort((left, right) => Number(Boolean(right.favorite)) - Number(Boolean(left.favorite)) || right.createdAt.localeCompare(left.createdAt) || left.name.localeCompare(right.name, 'ko-KR'))
  const selectedTransitionPreset = transitionPresets.find((preset) => preset.id === selectedTransitionPresetId)
  const saveTransitionPreset = (edge: 'in' | 'out') => {
    const transition = edge === 'in' ? clip.transitionIn : clip.transitionOut
    if (!transition || transition.type === 'none' || transition.duration <= 0) {
      window.alert(`${edge === 'in' ? '시작' : '끝'} 전환을 먼저 설정해주세요.`)
      return
    }
    const name = window.prompt('전환 프리셋 이름', `${transition.type} ${transition.duration.toFixed(2)}초`)
    if (!name) return
    const preset = createTransitionPreset(name, transitionPresetKind, transition)
    const next = [...transitionPresets, preset]
    try {
      writeTransitionPresets(next)
      setTransitionPresets(next)
      setSelectedTransitionPresetId(preset.id)
    } catch {
      window.alert('전환 프리셋 저장 공간이 부족합니다.')
    }
  }
  const applySelectedTransitionPreset = (edge: 'in' | 'out', scope: 'clip' | 'selection' | 'linked' = 'clip') => {
    const preset = transitionPresets.find((candidate) => candidate.id === selectedTransitionPresetId && candidate.mediaKind === transitionPresetKind)
    if (!preset) return
    const transition = structuredClone(preset.transition)
    transition.duration = Math.min(transition.duration, (transition.alignment ?? 'center-on-cut') === 'center-on-cut' ? clip.duration * 2 : clip.duration)
    if (scope === 'clip') onUpdateClip(clip.id, edge === 'in' ? { transitionIn: transition } : { transitionOut: transition })
    else onApplyTransitionPreset?.(clip.id, edge, transition, scope)
  }
  const applyCurrentTransitionToSelection = (edge: 'in' | 'out') => {
    const transition = edge === 'in' ? clip.transitionIn : clip.transitionOut
    if (!transition || transition.type === 'none' || transition.duration <= 0) return
    onApplyTransitionPreset?.(clip.id, edge, structuredClone(transition), 'selection')
  }
  const copyTransition = (edge: 'in' | 'out') => {
    const transition = edge === 'in' ? clip.transitionIn : clip.transitionOut
    if (!transition || transition.type === 'none' || transition.duration <= 0) return
    transitionClipboard = { edge, transition: structuredClone(transition) }
    setTransitionClipboardRevision((revision) => revision + 1)
  }
  const pasteTransition = (edge: 'in' | 'out', toSelection = false) => {
    if (!transitionClipboard) return
    const transition = structuredClone(transitionClipboard.transition)
    if (transitionClipboard.edge !== edge) {
      if (transition.alignment === 'start-at-cut') transition.alignment = 'end-at-cut'
      else if (transition.alignment === 'end-at-cut') transition.alignment = 'start-at-cut'
    }
    transition.duration = Math.min(transition.duration, (transition.alignment ?? 'center-on-cut') === 'center-on-cut' ? clip.duration * 2 : clip.duration)
    if (toSelection) onApplyTransitionPreset?.(clip.id, edge, transition, 'selection')
    else onUpdateClip(clip.id, edge === 'in' ? { transitionIn: transition } : { transitionOut: transition })
  }
  const deleteSelectedTransitionPreset = () => {
    const next = transitionPresets.filter((candidate) => candidate.id !== selectedTransitionPresetId)
    try {
      writeTransitionPresets(next)
      setTransitionPresets(next)
      setSelectedTransitionPresetId('')
    } catch {
      window.alert('전환 프리셋 저장소를 갱신하지 못했습니다.')
    }
  }
  const toggleSelectedTransitionPresetFavorite = () => {
    if (!selectedTransitionPreset) return
    const next = transitionPresets.map((preset) => preset.id === selectedTransitionPreset.id ? { ...preset, favorite: !preset.favorite } : preset)
    try {
      writeTransitionPresets(next)
      setTransitionPresets(next)
    } catch {
      window.alert('전환 프리셋 즐겨찾기를 저장하지 못했습니다.')
    }
  }
  const renameSelectedTransitionPreset = () => {
    if (!selectedTransitionPreset) return
    const name = window.prompt('전환 프리셋 새 이름', selectedTransitionPreset.name)?.trim()
    if (!name || name === selectedTransitionPreset.name) return
    const next = transitionPresets.map((preset) => preset.id === selectedTransitionPreset.id ? { ...preset, name } : preset)
    try {
      writeTransitionPresets(next)
      setTransitionPresets(next)
    } catch {
      window.alert('전환 프리셋 이름을 저장하지 못했습니다.')
    }
  }
  const duplicateSelectedTransitionPreset = () => {
    if (!selectedTransitionPreset) return
    const duplicate = { ...createTransitionPreset(`${selectedTransitionPreset.name} 복사본`, selectedTransitionPreset.mediaKind, selectedTransitionPreset.transition), favorite: selectedTransitionPreset.favorite }
    const next = [...transitionPresets, duplicate]
    try {
      writeTransitionPresets(next)
      setTransitionPresets(next)
      setSelectedTransitionPresetId(duplicate.id)
    } catch {
      window.alert('전환 프리셋 복사본을 저장하지 못했습니다.')
    }
  }
  const exportSelectedTransitionPreset = () => {
    const preset = transitionPresets.find((candidate) => candidate.id === selectedTransitionPresetId)
    if (!preset) return
    const url = URL.createObjectURL(new Blob([serializeTransitionPreset(preset)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${preset.name.replace(/[\\/:*?"<>|]/g, '-')}.editweave-transition.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  const importTransitionPreset = async (file?: File) => {
    if (!file) return
    try {
      const preset = parseTransitionPreset(await file.text())
      const next = [...transitionPresets, preset]
      writeTransitionPresets(next)
      setTransitionPresets(next)
      setSelectedTransitionPresetId(preset.id)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '전환 프리셋을 가져오지 못했습니다.')
    } finally {
      if (transitionImportRef.current) transitionImportRef.current.value = ''
    }
  }

  const saveTitleStyleTemplate = () => {
    const name = window.prompt('타이틀 스타일 이름', `${clip.name} 스타일`)
    if (!name) return
    const template = createTitleStyleTemplate(name, caption)
    const next = [...titleStyleTemplates, template]
    try {
      writeTitleStyleTemplates(next)
      setTitleStyleTemplates(next)
      setSelectedTitleStyleId(template.id)
    } catch {
      window.alert('타이틀 스타일 저장 공간이 부족합니다.')
    }
  }
  const applySelectedTitleStyle = () => {
    const template = titleStyleTemplates.find((candidate) => candidate.id === selectedTitleStyleId)
    if (template) onUpdateClip(clip.id, { captionStyle: structuredClone(template.style) })
  }
  const deleteSelectedTitleStyle = () => {
    const next = titleStyleTemplates.filter((candidate) => candidate.id !== selectedTitleStyleId)
    writeTitleStyleTemplates(next)
    setTitleStyleTemplates(next)
    setSelectedTitleStyleId('')
  }
  const exportSelectedTitleStyle = () => {
    const template = titleStyleTemplates.find((candidate) => candidate.id === selectedTitleStyleId)
    if (!template) return
    const url = URL.createObjectURL(new Blob([serializeTitleStyleTemplate(template)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${template.name.replace(/[\\/:*?"<>|]/g, '-')}.editweave-title.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  const importTitleStyle = async (file?: File) => {
    if (!file) return
    try {
      const template = parseTitleStyleTemplate(await file.text())
      const next = [...titleStyleTemplates, template]
      writeTitleStyleTemplates(next)
      setTitleStyleTemplates(next)
      setSelectedTitleStyleId(template.id)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '타이틀 스타일을 가져오지 못했습니다.')
    } finally {
      if (titleStyleImportRef.current) titleStyleImportRef.current.value = ''
    }
  }

  return (
    <aside className="inspector-panel panel-surface">
      <div className="inspector-title">
        <div><span className="eyebrow">INSPECTOR</span><h2>클립 속성</h2></div>
        <span className={`kind-badge ${clip.kind}`}>{clip.multicamAngle !== undefined ? `multicam ${clip.multicamAngle + 1}` : clip.nestedSequenceId ? 'nested' : clip.adjustmentLayer ? 'adjustment' : clip.kind}</span>
      </div>

      <label className="text-field"><span>이름</span><input value={clip.name} disabled={locked} onChange={(event) => onUpdateClip(clip.id, { name: event.target.value })} /></label>
      <div className="clip-state-controls"><Toggle label="클립 활성화" checked={clip.enabled !== false} disabled={locked} onChange={(enabled) => onUpdateClip(clip.id, { enabled })} /><label><span>라벨 색상</span><input type="color" value={clip.color} disabled={locked} onChange={(event) => onUpdateClip(clip.id, { color: event.target.value })} /></label></div>

      <section className="property-section keyframe-workspace">
        <div className="property-heading"><h3>키프레임 작업공간</h3><small>{keyframeTimes.length}개 지점</small></div>
        <div className="keyframe-workspace-toolbar">
          <button aria-label="이전 키프레임" disabled={previousKeyframeTime === undefined || !onSeek} onClick={() => previousKeyframeTime !== undefined && onSeek?.(clip.start + previousKeyframeTime)}><ChevronLeft size={13} /> 이전</button>
          <button aria-label="다음 키프레임" disabled={nextKeyframeTime === undefined || !onSeek} onClick={() => nextKeyframeTime !== undefined && onSeek?.(clip.start + nextKeyframeTime)}>다음 <ChevronRight size={13} /></button>
          <button onClick={copyAutomation}><Copy size={13} /> 전체 복사</button>
          <button disabled={locked || !clipAutomationClipboard} data-revision={automationClipboardRevision} onClick={pasteAutomation}><ClipboardPaste size={13} /> 전체 붙여넣기</button>
          <button className="apply-selection" disabled={locked || selectedClipCount < 2 || !onApplyAutomationToSelection} onClick={() => onApplyAutomationToSelection?.(clip.id)}>선택 {selectedClipCount}개에 일괄 적용</button>
        </div>
        <p className="feature-note">붙여넣은 자동화는 대상 클립 길이에 맞춰 시간 비율을 유지합니다. 영상·오디오 종류가 다른 속성은 자동으로 제외됩니다.</p>
        <div className="keyframe-range-workspace">
          <div className="field-grid"><NumberField label="구간 IN" value={keyframeRangeIn} suffix="s" min={0} max={clip.duration} disabled={locked} onChange={(value) => setKeyframeRangeIn(Math.max(0, Math.min(clip.duration, value)))} /><NumberField label="구간 OUT" value={keyframeRangeOut} suffix="s" min={0} max={clip.duration} disabled={locked} onChange={(value) => setKeyframeRangeOut(Math.max(0, Math.min(clip.duration, value)))} /><SelectField label="종류" value={keyframeRangeScope} disabled={locked} onChange={(value) => setKeyframeRangeScope(value as KeyframeRangeScope)}><option value="all">전체 키프레임</option><option value="transform">변형</option><option value="speed">속도</option><option value="visual">시각 효과</option><option value="audio">클립 오디오</option></SelectField><SelectField label="붙여넣기 시간" value={keyframePasteTiming} disabled={locked} onChange={(value) => setKeyframePasteTiming(value as typeof keyframePasteTiming)}><option value="original">원래 간격</option><option value="fit">남은 길이에 맞춤</option></SelectField></div>
          <div className="button-row"><button disabled={locked} onClick={() => setKeyframeRangeIn(localTime)}>현재 → IN</button><button disabled={locked} onClick={() => setKeyframeRangeOut(localTime)}>현재 → OUT</button><button disabled={locked} onClick={copyKeyframeRange}><Copy size={12} /> 구간 복사</button><button disabled={locked || !keyframeRangeClipboard} data-revision={automationClipboardRevision} onClick={pasteKeyframeRange}><ClipboardPaste size={12} /> 재생 헤드에 붙이기</button></div>
          {keyframeClipboardMessage && <p className="feature-note">{keyframeClipboardMessage}</p>}
        </div>
      </section>

      {clip.kind !== 'caption' && <section className="property-section effect-preset-workspace">
        <div className="property-heading"><h3>효과 프리셋</h3><small>{effectPresets.length}개</small></div>
        <div className="effect-preset-tools">
          <select aria-label="사용자 효과 프리셋" value={selectedEffectPresetId} onChange={(event) => setSelectedEffectPresetId(event.target.value)}><option value="">효과 프리셋 선택</option>{effectPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select>
          <button disabled={locked || !selectedEffectPresetId} onClick={() => applySelectedEffectPreset(false)}>현재 클립</button>
          <button disabled={locked || selectedClipCount < 2 || !selectedEffectPresetId || !onApplyEffectPresetToSelection} onClick={() => applySelectedEffectPreset(true)}>선택 전체</button>
          <button disabled={locked} onClick={saveEffectPreset}>현재값 저장</button>
          <button disabled={!selectedEffectPresetId} onClick={exportSelectedEffectPreset}>공유</button>
          <button onClick={() => effectImportRef.current?.click()}>가져오기</button>
          <button disabled={!selectedEffectPresetId} onClick={deleteSelectedEffectPreset}>삭제</button>
          <input ref={effectImportRef} hidden type="file" accept=".json,.editweave-effect.json,application/json" onChange={(event) => void importEffectPreset(event.target.files?.[0])} />
        </div>
        <p className="feature-note">영상·이미지는 색보정·마스크·코너 핀·시각 효과를, 오디오 클립은 오디오 효과를 저장하고 적용합니다.</p>
      </section>}

      <section className="property-section">
        <h3>시간 · 속도</h3>
        <div className="field-grid">
          <NumberField label="시작" value={clip.start} suffix="s" min={0} disabled={locked} onChange={(start) => onUpdateClip(clip.id, { start: Math.max(0, start) })} />
          <NumberField label="길이" value={clip.duration} suffix="s" min={0.05} disabled={locked} onChange={(duration) => onUpdateClip(clip.id, { duration: Math.max(0.05, duration) })} />
          {clip.kind !== 'caption' && !clip.adjustmentLayer && !clip.nestedSequenceId && <NumberField label="속도" value={(clip.playbackRate ?? 1) * 100} suffix="%" min={5} max={1600} step={5} disabled={locked || clip.freezeFrame} onChange={(value) => onUpdateClip(clip.id, { playbackRate: Math.max(0.05, value / 100) })} />}
          {clip.kind === 'video' && !clip.adjustmentLayer && !clip.nestedSequenceId && <SelectField label="프레임 보간" value={clip.frameInterpolation ?? 'sampling'} disabled={locked || clip.freezeFrame} onChange={(frameInterpolation) => onUpdateClip(clip.id, { frameInterpolation: frameInterpolation as TimelineClip['frameInterpolation'] })}><option value="sampling">프레임 샘플링</option><option value="blend">프레임 블렌드</option><option value="optical-flow">모션 보정 (Optical Flow)</option></SelectField>}
        </div>
        {clip.kind !== 'caption' && !clip.adjustmentLayer && !clip.nestedSequenceId && <div className="toggle-row"><Toggle label="역재생" checked={Boolean(clip.reverse)} disabled={locked || clip.freezeFrame} onChange={(reverse) => onUpdateClip(clip.id, { reverse })} /><Toggle label="현재 프레임 홀드" checked={Boolean(clip.freezeFrame)} disabled={locked} onChange={(freezeFrame) => onUpdateClip(clip.id, freezeFrame ? { freezeFrame: true, freezeFrameSourceTime: clipSourceTime({ ...clip, freezeFrame: false }, playhead) } : { freezeFrame: false, freezeFrameSourceTime: undefined })} /></div>}
        {clip.freezeFrame && clip.kind !== 'caption' && !clip.adjustmentLayer && !clip.nestedSequenceId && <div className="frame-hold-editor"><NumberField label="고정 소스 시간" value={clip.freezeFrameSourceTime ?? clip.sourceOffset} suffix="s" min={0} max={asset?.duration ?? Math.max(clip.sourceOffset, clip.duration)} step={1 / Math.max(1, asset?.frameRate ?? 30)} disabled={locked} onChange={(freezeFrameSourceTime) => onUpdateClip(clip.id, { freezeFrameSourceTime: Math.max(0, Math.min(asset?.duration ?? Number.POSITIVE_INFINITY, freezeFrameSourceTime)) })} /><button disabled={locked} onClick={() => onUpdateClip(clip.id, { freezeFrameSourceTime: Math.max(0, (clip.freezeFrameSourceTime ?? clip.sourceOffset) - 1 / Math.max(1, asset?.frameRate ?? 30)) })}>−1f</button><button disabled={locked} onClick={() => onUpdateClip(clip.id, { freezeFrameSourceTime: Math.min(asset?.duration ?? Number.POSITIVE_INFINITY, (clip.freezeFrameSourceTime ?? clip.sourceOffset) + 1 / Math.max(1, asset?.frameRate ?? 30)) })}>+1f</button><button disabled={locked} onClick={() => onUpdateClip(clip.id, { freezeFrameSourceTime: clipSourceTime({ ...clip, freezeFrame: false }, playhead) })}>현재 재생 헤드</button></div>}
        {clip.kind !== 'caption' && !clip.adjustmentLayer && !clip.nestedSequenceId && !clip.freezeFrame && <>
          <div className="property-heading"><h3>속도 램프</h3><button className="mini-action" disabled={locked} onClick={addSpeedKeyframe}><Plus size={12} /> {localTime.toFixed(2)}s 지점</button></div>
          <SpeedRampGraph clip={clip} disabled={locked} onChange={(speedKeyframes) => onUpdateClip(clip.id, { speedKeyframes })} />
          <div className="speed-template-tools"><select aria-label="사용자 속도 템플릿" value={selectedSpeedTemplateId} onChange={(event) => setSelectedSpeedTemplateId(event.target.value)}><option value="">사용자 속도 선택</option>{speedTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select><button disabled={locked || !selectedSpeedTemplateId} onClick={applySelectedSpeedTemplate}>적용</button><button disabled={locked} onClick={saveSpeedTemplate}>현재값 저장</button><button disabled={!selectedSpeedTemplateId} onClick={exportSelectedSpeedTemplate}>공유</button><button onClick={() => speedImportRef.current?.click()}>가져오기</button><button disabled={!selectedSpeedTemplateId} onClick={deleteSelectedSpeedTemplate}>삭제</button><input ref={speedImportRef} hidden type="file" accept=".json,.editweave-speed.json,application/json" onChange={(event) => void importSpeedTemplate(event.target.files?.[0])} /></div>
          <div className="keyframe-list speed-keyframe-list">
            {(clip.speedKeyframes ?? []).map((keyframe) => <div className="speed-keyframe-group" key={keyframe.id}><div><Diamond size={10} fill="currentColor" /><span>{keyframe.time.toFixed(2)}s</span><input aria-label={`${keyframe.time.toFixed(2)}초 속도`} type="number" min="5" max="1600" step="5" value={Math.round(keyframe.rate * 100)} disabled={locked} onChange={(event) => onUpdateClip(clip.id, { speedKeyframes: clip.speedKeyframes?.map((item) => item.id === keyframe.id ? { ...item, rate: Math.max(0.05, Math.min(16, Number(event.target.value) / 100)) } : item) })} /><small>%</small><select value={keyframe.easing} disabled={locked} onChange={(event) => { const easing = event.target.value as typeof keyframe.easing; onUpdateClip(clip.id, { speedKeyframes: clip.speedKeyframes?.map((item) => item.id === keyframe.id ? { ...item, easing, curve: easing === 'bezier' ? item.curve ?? { x1: 0.33, y1: 0, x2: 0.67, y2: 1 } : item.curve } : item) }) }}><option value="linear">선형</option><option value="hold">홀드</option><option value="ease-in">가속</option><option value="ease-out">감속</option><option value="ease-in-out">부드럽게</option><option value="bezier">자유 곡선</option></select><button aria-label="속도 지점 삭제" disabled={locked} onClick={() => onUpdateClip(clip.id, { speedKeyframes: clip.speedKeyframes?.filter((item) => item.id !== keyframe.id) })}><Trash2 size={11} /></button></div>{keyframe.easing === 'bezier' && <SpeedBezierEditor curve={keyframe.curve} disabled={locked} onChange={(curve) => onUpdateClip(clip.id, { speedKeyframes: clip.speedKeyframes?.map((item) => item.id === keyframe.id ? { ...item, curve } : item) })} />}</div>)}
            {!clip.speedKeyframes?.length && <small>재생 헤드에 속도 지점을 추가하면 구간 사이가 자연스럽게 가속·감속됩니다.</small>}
          </div>
        </>}
      </section>

      {clip.kind === 'video' && !clip.nestedSequenceId && <section className="property-section">
        <h3>합성 · 트랙 매트</h3>
        <div className="field-grid">
          <NumberField label="합성 우선순위" value={clip.compositePriority ?? 0} min={-1000} max={1000} step={1} disabled={locked} onChange={(compositePriority) => onUpdateClip(clip.id, { compositePriority: Math.max(-1000, Math.min(1000, Math.round(compositePriority))) })} />
          <SelectField label="매트 소스" value={clip.trackMatte?.sourceTrackId ?? ''} disabled={locked} onChange={(sourceTrackId) => onUpdateClip(clip.id, { trackMatte: sourceTrackId ? { sourceTrackId, mode: clip.trackMatte?.mode ?? 'alpha' } : undefined })}><option value="">사용 안 함</option>{matteSourceTracks.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</SelectField>
          <SelectField label="매트 방식" value={clip.trackMatte?.mode ?? 'alpha'} disabled={locked || !clip.trackMatte} onChange={(mode) => clip.trackMatte && onUpdateClip(clip.id, { trackMatte: { ...clip.trackMatte, mode: mode as NonNullable<TimelineClip['trackMatte']>['mode'] } })}><option value="alpha">알파</option><option value="alpha-inverted">알파 반전</option><option value="luma">루마</option><option value="luma-inverted">루마 반전</option></SelectField>
        </div>
        <Toggle label="매트 소스 트랙도 최종 화면에 표시" checked={Boolean(clip.trackMatte?.showSource)} disabled={locked || !clip.trackMatte} onChange={(showSource) => clip.trackMatte && onUpdateClip(clip.id, { trackMatte: { ...clip.trackMatte, showSource } })} />
        <p className="feature-note">선택한 비디오 트랙의 현재 프레임을 매트로 사용합니다. 알파는 투명도, 루마는 밝기를 기준으로 이 클립의 표시 영역을 제한합니다.</p>
      </section>}

      {clip.nestedSequenceId && <section className="property-section">
        <h3>{clip.multicamAngle !== undefined ? '멀티캠 시퀀스' : '중첩 시퀀스'}</h3>
        <NumberField label="합성 우선순위" value={clip.compositePriority ?? 0} min={-1000} max={1000} step={1} disabled={locked} onChange={(compositePriority) => onUpdateClip(clip.id, { compositePriority: Math.max(-1000, Math.min(1000, Math.round(compositePriority))) })} />
        {clip.multicamAngle !== undefined && <SelectField label="멀티캠 오디오" value={clip.multicamAudioMode ?? 'camera-1'} disabled={locked} onChange={(multicamAudioMode) => onUpdateClip(clip.id, { multicamAudioMode: multicamAudioMode as TimelineClip['multicamAudioMode'] })}><option value="camera-1">CAM 1 오디오 고정</option><option value="follow-video">영상 각도 따라 전환</option><option value="selected-angle">지정 카메라 오디오 고정</option><option value="all">모든 카메라 오디오 믹스</option></SelectField>}
        {clip.multicamAngle !== undefined && clip.multicamAudioMode === 'selected-angle' && <SelectField label="고정 오디오 각도" value={String(clip.multicamAudioAngle ?? 0)} disabled={locked} onChange={(value) => onUpdateClip(clip.id, { multicamAudioAngle: Number(value) })}>{multicamAngles.filter((angle) => angle.hasAudio).map((angle) => <option key={angle.index} value={angle.index}>CAM {angle.index + 1} · {angle.name}</option>)}</SelectField>}
        {clip.multicamAngle !== undefined && multicamAngles.length > 0 && <div className="multicam-angle-editor"><strong>각도 이름</strong>{multicamAngles.map((angle) => <label key={angle.index}><span>CAM {angle.index + 1}{angle.hasAudio ? ' · A' : ''}</span><input key={`${angle.index}-${angle.name}`} defaultValue={angle.name} disabled={locked} onBlur={(event) => { const name = event.currentTarget.value.trim(); if (!name) event.currentTarget.value = angle.name; else if (name !== angle.name) onRenameMulticamAngle?.(angle.index, name) }} /></label>)}</div>}
        <p className="feature-note">{clip.multicamAngle !== undefined ? `현재 각도 ${clip.multicamAngle + 1}을 사용합니다. 타임라인의 각도 버튼을 누르면 재생 헤드에 컷이 생기고 이후 각도가 바뀝니다.` : '여러 트랙을 하나의 시퀀스로 묶은 클립입니다. 상단 시퀀스 선택기에서 내부 시퀀스를 열어 원본 클립을 편집할 수 있습니다.'}</p>
        <p className="feature-note">우선순위가 높을수록 같은 시간의 다른 영상 트랙보다 나중에 합성되어 위에 보입니다. 100 단위는 기본 트랙 한 단계에 해당합니다.</p>
      </section>}

      {clip.kind !== 'audio' && !clip.adjustmentLayer && <section className="property-section">
        <div className="property-heading"><h3>변형 · 키프레임</h3><button className="mini-action" disabled={locked} onClick={addKeyframe}><Plus size={12} /> {localTime.toFixed(2)}s</button></div>
        <div className="field-grid">
          <NumberField label="위치 X" value={clip.transform.positionX} disabled={locked} onChange={(positionX) => updateTransform({ positionX })} />
          <NumberField label="위치 Y" value={clip.transform.positionY} disabled={locked} onChange={(positionY) => updateTransform({ positionY })} />
          <NumberField label="크기" value={clip.transform.scale} suffix="%" min={1} disabled={locked} onChange={(scale) => updateTransform({ scale })} />
          <NumberField label="가로 스케일" value={clip.transform.scaleX ?? 100} suffix="%" min={-1000} max={1000} disabled={locked} onChange={(scaleX) => updateTransform({ scaleX: Math.abs(scaleX) < 0.01 ? 0.01 : scaleX })} />
          <NumberField label="세로 스케일" value={clip.transform.scaleY ?? 100} suffix="%" min={-1000} max={1000} disabled={locked} onChange={(scaleY) => updateTransform({ scaleY: Math.abs(scaleY) < 0.01 ? 0.01 : scaleY })} />
          <NumberField label="앵커 X" value={clip.transform.anchorX ?? 50} suffix="%" min={-500} max={500} disabled={locked} onChange={(anchorX) => updateTransform({ anchorX })} />
          <NumberField label="앵커 Y" value={clip.transform.anchorY ?? 50} suffix="%" min={-500} max={500} disabled={locked} onChange={(anchorY) => updateTransform({ anchorY })} />
          <NumberField label="가로 기울기" value={clip.transform.skewX ?? 0} suffix="°" min={-85} max={85} disabled={locked} onChange={(skewX) => updateTransform({ skewX: Math.max(-85, Math.min(85, skewX)) })} />
          <NumberField label="세로 기울기" value={clip.transform.skewY ?? 0} suffix="°" min={-85} max={85} disabled={locked} onChange={(skewY) => updateTransform({ skewY: Math.max(-85, Math.min(85, skewY)) })} />
          <NumberField label="회전" value={clip.transform.rotation} suffix="°" disabled={locked} onChange={(rotation) => updateTransform({ rotation })} />
        </div>
        <div className="button-row"><button disabled={locked} onClick={() => updateTransform({ scaleX: -(clip.transform.scaleX ?? 100) })}>좌우 뒤집기</button><button disabled={locked} onClick={() => updateTransform({ scaleY: -(clip.transform.scaleY ?? 100) })}>상하 뒤집기</button><button disabled={locked} onClick={() => updateTransform({ anchorX: 50, anchorY: 50 })}>앵커 중앙</button></div>
        <div className="field-grid motion-blur-controls">
          <SelectField label="모션 블러" value={clip.motionBlur?.enabled ? 'on' : 'off'} disabled={locked} onChange={(value) => onUpdateClip(clip.id, { motionBlur: { enabled: value === 'on', shutterAngle: clip.motionBlur?.shutterAngle ?? 180, samples: clip.motionBlur?.samples ?? 8 } })}><option value="off">끄기</option><option value="on">켜기</option></SelectField>
          <NumberField label="셔터 각도" value={clip.motionBlur?.shutterAngle ?? 180} suffix="°" min={0} max={720} step={15} disabled={locked || !clip.motionBlur?.enabled} onChange={(shutterAngle) => onUpdateClip(clip.id, { motionBlur: { enabled: true, shutterAngle: Math.max(0, Math.min(720, shutterAngle)), samples: clip.motionBlur?.samples ?? 8 } })} />
          <NumberField label="블러 표본" value={clip.motionBlur?.samples ?? 8} min={2} max={16} step={1} disabled={locked || !clip.motionBlur?.enabled} onChange={(samples) => onUpdateClip(clip.id, { motionBlur: { enabled: true, shutterAngle: clip.motionBlur?.shutterAngle ?? 180, samples: Math.max(2, Math.min(16, Math.round(samples))) } })} />
        </div>
        <label className="range-field"><span>불투명도 <strong>{clip.transform.opacity}%</strong></span><input type="range" min="0" max="100" value={clip.transform.opacity} disabled={locked} onChange={(event) => updateTransform({ opacity: Number(event.target.value) })} /></label>
        <MotionValueGraph clip={clip} disabled={locked} onChange={(keyframes) => onUpdateClip(clip.id, { keyframes })} />
        {(clip.keyframes?.length ?? 0) >= 2 && <MotionPathEditor keyframes={clip.keyframes!} disabled={locked} onChange={(keyframes) => onUpdateClip(clip.id, { keyframes })} />}
        <div className="field-grid motion-path-controls">
          <SelectField label="경로 방향 정렬" value={clip.motionPathAutoOrient ? 'on' : 'off'} disabled={locked || (clip.keyframes?.length ?? 0) < 2} onChange={(value) => onUpdateClip(clip.id, { motionPathAutoOrient: value === 'on' })}><option value="off">끄기</option><option value="on">켜기</option></SelectField>
          <NumberField label="방향 오프셋" value={clip.motionPathOrientationOffset ?? 0} suffix="°" min={-720} max={720} disabled={locked || !clip.motionPathAutoOrient} onChange={(motionPathOrientationOffset) => onUpdateClip(clip.id, { motionPathOrientationOffset })} />
        </div>
        <div className="motion-template-tools"><select aria-label="사용자 모션 템플릿" value={selectedMotionTemplateId} onChange={(event) => setSelectedMotionTemplateId(event.target.value)}><option value="">사용자 모션 선택</option>{motionTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select><button disabled={locked || !selectedMotionTemplateId} onClick={applySelectedMotionTemplate}>적용</button><button disabled={locked} onClick={saveMotionTemplate}>현재값 저장</button><button disabled={!selectedMotionTemplateId} onClick={exportSelectedMotionTemplate}>공유</button><button onClick={() => motionImportRef.current?.click()}>가져오기</button><button disabled={!selectedMotionTemplateId} onClick={deleteSelectedMotionTemplate}>삭제</button><input ref={motionImportRef} hidden type="file" accept=".json,.editweave-motion.json,application/json" onChange={(event) => void importMotionTemplate(event.target.files?.[0])} /></div>
        <div className="keyframe-list">
          {(clip.keyframes ?? []).map((keyframe) => <div className="automation-keyframe-group" key={keyframe.id}><div className="automation-keyframe-row"><Diamond size={10} fill="currentColor" /><span>{keyframe.time.toFixed(2)}s</span><select value={keyframe.easing} disabled={locked} onChange={(event) => { const easing = event.target.value as typeof keyframe.easing; onUpdateClip(clip.id, { keyframes: clip.keyframes?.map((item) => item.id === keyframe.id ? { ...item, easing, curve: easing === 'bezier' ? item.curve ?? { x1: 0.33, y1: 0, x2: 0.67, y2: 1 } : item.curve } : item) }) }}><option value="linear">선형</option><option value="hold">홀드</option><option value="ease-in">가속</option><option value="ease-out">감속</option><option value="ease-in-out">부드럽게</option><option value="bezier">자유 곡선</option></select><button aria-label="키프레임 삭제" disabled={locked} onClick={() => onUpdateClip(clip.id, { keyframes: clip.keyframes?.filter((item) => item.id !== keyframe.id) })}><Trash2 size={11} /></button></div>{keyframe.easing === 'bezier' && <SpeedBezierEditor curve={keyframe.curve} disabled={locked} onChange={(curve) => onUpdateClip(clip.id, { keyframes: clip.keyframes?.map((item) => item.id === keyframe.id ? { ...item, curve } : item) })} />}</div>)}
          {!clip.keyframes?.length && <small>재생 헤드 위치에 현재 변형 값을 기록합니다.</small>}
        </div>
        {asset?.kind === 'video' ? <><button className="inspector-wide-action" disabled={locked || sceneDetecting || objectTracking || stabilizing} onClick={() => motionTracking ? onCancelMotion?.() : onTrackMotion?.(clip.id)}>{motionTracking ? '얼굴 모션 추적 취소' : '얼굴 모션 추적 → 위치 키프레임'}</button><button className="inspector-wide-action" disabled={locked || motionTracking || objectTracking || stabilizing} onClick={() => sceneDetecting ? onCancelSceneDetection?.() : onDetectScenes?.(clip.id)}>{sceneDetecting ? '장면 전환 감지 취소' : '장면 전환 감지 → 검토'}</button><button className="inspector-wide-action" disabled={locked || motionTracking || sceneDetecting || objectTracking} onClick={() => stabilizing ? onCancelStabilization?.() : onStabilize?.(clip.id)}>{stabilizing ? '영상 안정화 분석 취소' : clip.stabilization ? '영상 안정화 다시 분석' : '영상 안정화 · 4점 모션 보정'}</button>{clip.stabilization && <div className="stabilization-summary"><span>표본 {clip.stabilization.sampleCount} · 강도 {Math.round(clip.stabilization.strength * 100)}% · 자동 크롭 {(clip.stabilization.autoScale * 100).toFixed(1)}%</span><button disabled={locked || stabilizing} onClick={() => onUpdateClip(clip.id, { transform: structuredClone(clip.stabilization!.originalTransform), keyframes: structuredClone(clip.stabilization!.originalKeyframes), stabilization: undefined })}>안정화 제거</button></div>}</> : null}
      </section>}

      {(clip.kind === 'video' || clip.kind === 'audio') && !clip.adjustmentLayer && !clip.nestedSequenceId && <section className="property-section">
        <h3>{clip.kind === 'audio' ? '오디오 전환' : '전환'}</h3>
        <div className="field-grid">
          <SelectField label="시작" value={clip.transitionIn?.type ?? 'none'} disabled={locked} onChange={(type) => onUpdateClip(clip.id, { transitionIn: { ...clip.transitionIn, type: type as NonNullable<TimelineClip['transitionIn']>['type'], duration: clip.transitionIn?.duration ?? 0.5, alignment: clip.transitionIn?.alignment ?? 'start-at-cut' } })}><option value="none">없음</option><option value="crossfade">{clip.kind === 'audio' ? '오디오 크로스페이드' : '크로스페이드'}</option>{clip.kind !== 'audio' && <><option value="dip-black">검정 디졸브</option><option value="dip-white">흰색 디졸브</option><option value="blur-dissolve">블러 디졸브</option><option value="wipe-left">왼쪽 와이프</option><option value="wipe-right">오른쪽 와이프</option><option value="wipe-up">위쪽 와이프</option><option value="wipe-down">아래쪽 와이프</option><option value="slide-left">왼쪽 슬라이드</option><option value="slide-right">오른쪽 슬라이드</option><option value="zoom">줌</option></>}</SelectField>
          <NumberField label="시작 길이" value={clip.transitionIn?.duration ?? 0.5} suffix="s" min={0} max={transitionDurationLimit('in')} disabled={locked} onChange={(duration) => onUpdateClip(clip.id, { transitionIn: { ...clip.transitionIn, type: clip.transitionIn?.type ?? 'crossfade', duration: Math.max(0, Math.min(transitionDurationLimit('in'), duration)) } })} />
          <SelectField label="컷 정렬" value={clip.transitionIn?.alignment ?? 'start-at-cut'} disabled={locked || !clip.transitionIn || clip.transitionIn.type === 'none'} onChange={(alignment) => onUpdateClip(clip.id, { transitionIn: { ...clip.transitionIn!, alignment: alignment as NonNullable<TimelineClip['transitionIn']>['alignment'], duration: Math.min(alignment === 'center-on-cut' ? clip.duration * 2 : clip.duration, clip.transitionIn!.duration) } })}><option value="start-at-cut">컷에서 시작</option><option value="center-on-cut">컷 중앙</option><option value="end-at-cut">컷에서 종료</option></SelectField>
          <SelectField label="시작 곡선" value={clip.transitionIn?.easing ?? 'ease-in-out'} disabled={locked || !clip.transitionIn || clip.transitionIn.type === 'none'} onChange={(easing) => onUpdateClip(clip.id, { transitionIn: { ...clip.transitionIn!, easing: easing as NonNullable<TimelineClip['transitionIn']>['easing'] } })}><option value="linear">선형</option><option value="ease-in">가속</option><option value="ease-out">감속</option><option value="ease-in-out">부드럽게</option><option value="bezier">자유 곡선</option></SelectField>
          <SelectField label="시작 오디오" value={clip.transitionIn?.audioCurve ?? 'equal-power'} disabled={locked || !clip.transitionIn || clip.transitionIn.type === 'none'} onChange={(audioCurve) => onUpdateClip(clip.id, { transitionIn: { ...clip.transitionIn!, audioCurve: audioCurve as NonNullable<TimelineClip['transitionIn']>['audioCurve'] } })}><option value="equal-power">Equal Power</option><option value="linear">선형</option><option value="logarithmic">로그</option></SelectField>
          <SelectField label="끝" value={clip.transitionOut?.type ?? 'none'} disabled={locked} onChange={(type) => onUpdateClip(clip.id, { transitionOut: { ...clip.transitionOut, type: type as NonNullable<TimelineClip['transitionOut']>['type'], duration: clip.transitionOut?.duration ?? 0.5, alignment: clip.transitionOut?.alignment ?? 'end-at-cut' } })}><option value="none">없음</option><option value="crossfade">{clip.kind === 'audio' ? '오디오 크로스페이드' : '크로스페이드'}</option>{clip.kind !== 'audio' && <><option value="dip-black">검정 디졸브</option><option value="dip-white">흰색 디졸브</option><option value="blur-dissolve">블러 디졸브</option><option value="wipe-left">왼쪽 와이프</option><option value="wipe-right">오른쪽 와이프</option><option value="wipe-up">위쪽 와이프</option><option value="wipe-down">아래쪽 와이프</option><option value="slide-left">왼쪽 슬라이드</option><option value="slide-right">오른쪽 슬라이드</option><option value="zoom">줌</option></>}</SelectField>
          <NumberField label="끝 길이" value={clip.transitionOut?.duration ?? 0.5} suffix="s" min={0} max={transitionDurationLimit('out')} disabled={locked} onChange={(duration) => onUpdateClip(clip.id, { transitionOut: { ...clip.transitionOut, type: clip.transitionOut?.type ?? 'crossfade', duration: Math.max(0, Math.min(transitionDurationLimit('out'), duration)) } })} />
          <SelectField label="끝 정렬" value={clip.transitionOut?.alignment ?? 'end-at-cut'} disabled={locked || !clip.transitionOut || clip.transitionOut.type === 'none'} onChange={(alignment) => onUpdateClip(clip.id, { transitionOut: { ...clip.transitionOut!, alignment: alignment as NonNullable<TimelineClip['transitionOut']>['alignment'], duration: Math.min(alignment === 'center-on-cut' ? clip.duration * 2 : clip.duration, clip.transitionOut!.duration) } })}><option value="end-at-cut">컷에서 종료</option><option value="center-on-cut">컷 중앙</option><option value="start-at-cut">컷에서 시작</option></SelectField>
          <SelectField label="끝 곡선" value={clip.transitionOut?.easing ?? 'ease-in-out'} disabled={locked || !clip.transitionOut || clip.transitionOut.type === 'none'} onChange={(easing) => onUpdateClip(clip.id, { transitionOut: { ...clip.transitionOut!, easing: easing as NonNullable<TimelineClip['transitionOut']>['easing'] } })}><option value="linear">선형</option><option value="ease-in">가속</option><option value="ease-out">감속</option><option value="ease-in-out">부드럽게</option><option value="bezier">자유 곡선</option></SelectField>
          <SelectField label="끝 오디오" value={clip.transitionOut?.audioCurve ?? 'equal-power'} disabled={locked || !clip.transitionOut || clip.transitionOut.type === 'none'} onChange={(audioCurve) => onUpdateClip(clip.id, { transitionOut: { ...clip.transitionOut!, audioCurve: audioCurve as NonNullable<TimelineClip['transitionOut']>['audioCurve'] } })}><option value="equal-power">Equal Power</option><option value="linear">선형</option><option value="logarithmic">로그</option></SelectField>
        </div>
        <div className="button-row transition-clipboard-actions"><button disabled={locked || !clip.transitionIn || clip.transitionIn.type === 'none'} onClick={() => copyTransition('in')}><Copy size={11} /> 시작 복사</button><button disabled={locked || !clip.transitionOut || clip.transitionOut.type === 'none'} onClick={() => copyTransition('out')}><Copy size={11} /> 끝 복사</button><button disabled={locked || !transitionClipboard} data-revision={transitionClipboardRevision} onClick={() => pasteTransition('in')}><ClipboardPaste size={11} /> 시작 붙이기</button><button disabled={locked || !transitionClipboard} data-revision={transitionClipboardRevision} onClick={() => pasteTransition('out')}><ClipboardPaste size={11} /> 끝 붙이기</button>{selectedClipCount > 1 && <><button disabled={locked || !transitionClipboard || !onApplyTransitionPreset} data-revision={transitionClipboardRevision} onClick={() => pasteTransition('in', true)}>선택 시작 붙이기</button><button disabled={locked || !transitionClipboard || !onApplyTransitionPreset} data-revision={transitionClipboardRevision} onClick={() => pasteTransition('out', true)}>선택 끝 붙이기</button></>}</div>
        {selectedClipCount > 1 && <div className="button-row transition-batch-actions"><button disabled={locked || !clip.transitionIn || clip.transitionIn.type === 'none' || !onApplyTransitionPreset} onClick={() => applyCurrentTransitionToSelection('in')}>현재 시작 → 선택 {selectedClipCount}개</button><button disabled={locked || !clip.transitionOut || clip.transitionOut.type === 'none' || !onApplyTransitionPreset} onClick={() => applyCurrentTransitionToSelection('out')}>현재 끝 → 선택 {selectedClipCount}개</button><button disabled={locked || !onApplyTransitionPreset} onClick={() => onApplyTransitionPreset?.(clip.id, 'in', undefined, 'selection')}>선택 시작 제거</button><button disabled={locked || !onApplyTransitionPreset} onClick={() => onApplyTransitionPreset?.(clip.id, 'out', undefined, 'selection')}>선택 끝 제거</button></div>}
        <div className="effect-preset-tools transition-preset-tools">
          <input aria-label="전환 프리셋 검색" value={transitionPresetQuery} placeholder="전환 프리셋 검색" onChange={(event) => setTransitionPresetQuery(event.target.value)} />
          <select aria-label="전환 프리셋" value={selectedTransitionPresetId} onChange={(event) => setSelectedTransitionPresetId(event.target.value)}><option value="">{transitionPresetKind === 'audio' ? '오디오' : '영상'} 전환 프리셋 선택 · {compatibleTransitionPresets.length}개</option>{compatibleTransitionPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.favorite ? '★ ' : ''}{preset.mediaKind === 'audio' ? 'A' : 'V'} · {preset.name}</option>)}</select>
          <button disabled={locked || selectedTransitionPreset?.mediaKind !== transitionPresetKind} onClick={() => applySelectedTransitionPreset('in')}>시작 적용</button>
          <button disabled={locked || selectedTransitionPreset?.mediaKind !== transitionPresetKind} onClick={() => applySelectedTransitionPreset('out')}>끝 적용</button>
          <button disabled={locked || selectedClipCount < 2 || selectedTransitionPreset?.mediaKind !== transitionPresetKind || !onApplyTransitionPreset} onClick={() => applySelectedTransitionPreset('in', 'selection')}>선택 시작</button>
          <button disabled={locked || selectedClipCount < 2 || selectedTransitionPreset?.mediaKind !== transitionPresetKind || !onApplyTransitionPreset} onClick={() => applySelectedTransitionPreset('out', 'selection')}>선택 끝</button>
          <button disabled={locked || (!clip.linkGroupId && !clip.groupId) || selectedTransitionPreset?.mediaKind !== transitionPresetKind || !onApplyTransitionPreset} onClick={() => applySelectedTransitionPreset('in', 'linked')}>링크 시작</button>
          <button disabled={locked || (!clip.linkGroupId && !clip.groupId) || selectedTransitionPreset?.mediaKind !== transitionPresetKind || !onApplyTransitionPreset} onClick={() => applySelectedTransitionPreset('out', 'linked')}>링크 끝</button>
          <button disabled={locked || !clip.transitionIn || clip.transitionIn.type === 'none'} onClick={() => saveTransitionPreset('in')}>시작 저장</button>
          <button disabled={locked || !clip.transitionOut || clip.transitionOut.type === 'none'} onClick={() => saveTransitionPreset('out')}>끝 저장</button>
          <button className={selectedTransitionPreset?.favorite ? 'active' : ''} disabled={!selectedTransitionPresetId} onClick={toggleSelectedTransitionPresetFavorite}><Star size={11} fill={selectedTransitionPreset?.favorite ? 'currentColor' : 'none'} /> 즐겨찾기</button>
          <button disabled={!selectedTransitionPreset || !onSetDefaultTransition} onClick={() => selectedTransitionPreset && onSetDefaultTransition?.(selectedTransitionPreset.mediaKind, structuredClone(selectedTransitionPreset.transition))}>시퀀스 기본</button>
          <button disabled={!selectedTransitionPresetId} onClick={renameSelectedTransitionPreset}>이름 변경</button>
          <button disabled={!selectedTransitionPresetId} onClick={duplicateSelectedTransitionPreset}>복제</button>
          <button disabled={!selectedTransitionPresetId} onClick={exportSelectedTransitionPreset}>공유</button>
          <button onClick={() => transitionImportRef.current?.click()}><Upload size={11} /> 가져오기</button>
          <button className="danger" disabled={!selectedTransitionPresetId} onClick={deleteSelectedTransitionPreset}>삭제</button>
          <input ref={transitionImportRef} hidden type="file" accept=".json,.editweave-transition.json,application/json" onChange={(event) => void importTransitionPreset(event.target.files?.[0])} />
        </div>
        {clip.transitionIn?.easing === 'bezier' && clip.transitionIn.type !== 'none' && <div className="transition-curve-editor"><span>시작 자유 곡선</span><SpeedBezierEditor curve={clip.transitionIn.curve} disabled={locked} onChange={(curve) => onUpdateClip(clip.id, { transitionIn: { ...clip.transitionIn!, curve } })} /></div>}
        {clip.transitionOut?.easing === 'bezier' && clip.transitionOut.type !== 'none' && <div className="transition-curve-editor"><span>끝 자유 곡선</span><SpeedBezierEditor curve={clip.transitionOut.curve} disabled={locked} onChange={(curve) => onUpdateClip(clip.id, { transitionOut: { ...clip.transitionOut!, curve } })} /></div>}
        {clip.kind === 'audio' && <div className="button-row"><button disabled={locked || ((!clip.transitionIn || clip.transitionIn.type === 'none') && (!clip.transitionOut || clip.transitionOut.type === 'none'))} onClick={convertAudioTransitionsToFades}>전환 → 클립 페이드</button><button disabled={locked || (audio.fadeIn <= 0 && audio.fadeOut <= 0)} onClick={convertAudioFadesToTransitions}>클립 페이드 → 전환</button></div>}
      </section>}

      {clip.kind === 'video' && !clip.nestedSequenceId && <section className="property-section">
        <h3>색보정 · LUT</h3>
        <div className="field-grid">
          <NumberField label="노출" value={color.exposure} min={-5} max={5} disabled={locked} onChange={(exposure) => updateColor({ exposure })} />
          <NumberField label="대비" value={color.contrast} suffix="%" min={-100} max={100} disabled={locked} onChange={(contrast) => updateColor({ contrast })} />
          <NumberField label="채도" value={color.saturation} suffix="%" min={-100} max={200} disabled={locked} onChange={(saturation) => updateColor({ saturation })} />
          <NumberField label="색온도" value={color.temperature} min={-100} max={100} disabled={locked} onChange={(temperature) => updateColor({ temperature })} />
          <NumberField label="틴트" value={color.tint} min={-100} max={100} disabled={locked} onChange={(tint) => updateColor({ tint })} />
          <NumberField label="하이라이트" value={color.highlights} min={-100} max={100} disabled={locked} onChange={(highlights) => updateColor({ highlights })} />
          <NumberField label="그림자" value={color.shadows} min={-100} max={100} disabled={locked} onChange={(shadows) => updateColor({ shadows })} />
          <SelectField label="LUT" value={color.lut} disabled={locked} onChange={(lut) => updateColor({ lut: lut as ColorAdjustment['lut'] })}><option value="none">없음</option><option value="cinematic">시네마틱</option><option value="warm">웜</option><option value="cool">쿨</option><option value="mono">모노</option></SelectField>
          <NumberField label="LUT 강도" value={color.lutIntensity} suffix="%" min={0} max={100} disabled={locked} onChange={(lutIntensity) => updateColor({ lutIntensity })} />
          <NumberField label="색상 회전" value={color.hue ?? 0} suffix="°" min={-180} max={180} disabled={locked} onChange={(hue) => updateColor({ hue })} />
          <NumberField label="비브런스" value={color.vibrance ?? 0} suffix="%" min={-100} max={100} disabled={locked} onChange={(vibrance) => updateColor({ vibrance })} />
          <NumberField label="페이드" value={color.fade ?? 0} suffix="%" min={0} max={100} disabled={locked} onChange={(fade) => updateColor({ fade })} />
          <NumberField label="비네트" value={color.vignette ?? 0} suffix="%" min={0} max={100} disabled={locked} onChange={(vignette) => updateColor({ vignette })} />
          <NumberField label="Lift" value={color.lift ?? 0} min={-100} max={100} disabled={locked} onChange={(lift) => updateColor({ lift })} />
          <NumberField label="Gamma" value={color.gamma ?? 0} min={-100} max={100} disabled={locked} onChange={(gamma) => updateColor({ gamma })} />
          <NumberField label="Gain" value={color.gain ?? 0} min={-100} max={100} disabled={locked} onChange={(gain) => updateColor({ gain })} />
          <NumberField label="커브 암부" value={color.curveShadows ?? 0} min={-100} max={100} disabled={locked} onChange={(curveShadows) => updateColor({ curveShadows })} />
          <NumberField label="커브 중간톤" value={color.curveMidtones ?? 0} min={-100} max={100} disabled={locked} onChange={(curveMidtones) => updateColor({ curveMidtones })} />
          <NumberField label="커브 명부" value={color.curveHighlights ?? 0} min={-100} max={100} disabled={locked} onChange={(curveHighlights) => updateColor({ curveHighlights })} />
        </div>
        {!clip.adjustmentLayer && <div className="color-match-actions"><button disabled={locked || !programFrame} onClick={applyAutoWhiteBalance}>자동 화이트 밸런스</button><button disabled={locked || !programFrame || !referenceFrame} onClick={applyReferenceColorMatch}>기준 프레임과 샷 매칭</button>{color.colorNodes?.some((node) => node.name.endsWith('· Generated')) && <button className="remove-generated" disabled={locked} onClick={removeGeneratedColorMatch}>자동 매칭 노드 제거</button>}<small>분석 결과는 편집 가능한 생성 노드로 추가되며 기존 수동 그레이드는 유지됩니다.</small>{colorMatchError && <p>{colorMatchError}</p>}</div>}
        <div className="custom-lut-import">
          <label className={locked ? 'disabled' : ''}><Upload size={12} /><span>{color.customLut ? '다른 .cube LUT 가져오기' : '.cube LUT 가져오기'}</span><input type="file" hidden accept=".cube,text/plain" disabled={locked} onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then((contents) => parseCubeLut(contents, file.name)).then((customLut) => { updateColor({ customLut, lut: 'none' }); setLutImportError('') }).catch((error: unknown) => setLutImportError(error instanceof Error ? error.message : '.cube LUT를 가져오지 못했습니다.')); event.target.value = '' }} /></label>
          {color.customLut && <><span><strong>{color.customLut.name}</strong><small>{color.customLut.dimension}D · {color.customLut.size}{color.customLut.dimension === 3 ? '³' : ''} · 프로젝트에 포함됨</small></span><button disabled={locked} onClick={() => updateColor({ customLut: undefined })}><Trash2 size={11} /> 제거</button></>}
          {lutImportError && <p>{lutImportError}</p>}
        </div>
        <ColorCurveEditor color={color} disabled={locked} onChange={updateColor} />
        <ColorNodeGraphEditor color={color} disabled={locked} onChange={updateColor} />
        {!clip.adjustmentLayer && <div className="qualifier-controls">
          <div className="toggle-row"><Toggle label="HSL 선택 색 보정" checked={Boolean(color.qualifierEnabled)} disabled={locked} onChange={(qualifierEnabled) => updateColor({ qualifierEnabled })} />{color.qualifierEnabled && <Toggle label="선택 매트 보기" checked={Boolean(color.qualifierShowMask)} disabled={locked} onChange={(qualifierShowMask) => updateColor({ qualifierShowMask })} />}</div>
          {color.qualifierEnabled && <><div className="qualifier-hue-strip" style={{ '--qualifier-position': `${(color.qualifierHue ?? 120) / 3.6}%` } as CSSProperties}><i /></div><div className="field-grid">
            <NumberField label="선택 색상" value={color.qualifierHue ?? 120} suffix="°" min={0} max={360} disabled={locked} onChange={(qualifierHue) => updateColor({ qualifierHue })} />
            <NumberField label="색상 범위" value={color.qualifierHueRange ?? 30} suffix="°" min={0} max={180} disabled={locked} onChange={(qualifierHueRange) => updateColor({ qualifierHueRange })} />
            <NumberField label="채도 최소" value={color.qualifierSaturationMin ?? 20} suffix="%" min={0} max={100} disabled={locked} onChange={(qualifierSaturationMin) => updateColor({ qualifierSaturationMin })} />
            <NumberField label="채도 최대" value={color.qualifierSaturationMax ?? 100} suffix="%" min={0} max={100} disabled={locked} onChange={(qualifierSaturationMax) => updateColor({ qualifierSaturationMax })} />
            <NumberField label="명도 최소" value={color.qualifierLuminanceMin ?? 10} suffix="%" min={0} max={100} disabled={locked} onChange={(qualifierLuminanceMin) => updateColor({ qualifierLuminanceMin })} />
            <NumberField label="명도 최대" value={color.qualifierLuminanceMax ?? 95} suffix="%" min={0} max={100} disabled={locked} onChange={(qualifierLuminanceMax) => updateColor({ qualifierLuminanceMax })} />
            <NumberField label="선택 부드러움" value={color.qualifierSoftness ?? 20} suffix="%" min={0} max={100} disabled={locked} onChange={(qualifierSoftness) => updateColor({ qualifierSoftness })} />
            <NumberField label="선택 노출" value={color.qualifierExposure ?? 0} min={-3} max={3} disabled={locked} onChange={(qualifierExposure) => updateColor({ qualifierExposure })} />
            <NumberField label="선택 채도" value={color.qualifierSaturation ?? 0} suffix="%" min={-100} max={200} disabled={locked} onChange={(qualifierSaturation) => updateColor({ qualifierSaturation })} />
            <NumberField label="선택 색 이동" value={color.qualifierHueShift ?? 0} suffix="°" min={-180} max={180} disabled={locked} onChange={(qualifierHueShift) => updateColor({ qualifierHueShift })} />
          </div></>}
        </div>}
        {(asset || programFrame) && <ColorScopes asset={asset} time={programFrame ? playhead : clipSourceTime(clip, playhead)} programFrame={programFrame} />}
      </section>}

      {clip.kind === 'video' && !clip.adjustmentLayer && !clip.nestedSequenceId && <section className="property-section">
        <div className="property-heading"><h3>크롭 · 마스크 · 시각 효과</h3><button className="mini-action" disabled={locked} onClick={addVisualKeyframe}><Plus size={12} /> 효과 {localTime.toFixed(2)}s</button></div>
        <div className="effect-stack-editor">
          <div className="property-heading"><strong>효과 스택 순서</strong>{clip.effectStack ? <button disabled={locked} onClick={() => onUpdateClip(clip.id, { effectStack: undefined })}>고정 파이프라인</button> : <button disabled={locked} onClick={() => onUpdateClip(clip.id, { effectStack: createDefaultVideoEffectStack() })}>순서 편집 시작</button>}</div>
          {(clip.effectStack ?? []).map((item, index) => <div className={`effect-stack-row ${item.enabled ? '' : 'disabled'}`} key={item.id}><button className={item.enabled ? 'active' : ''} disabled={locked} onClick={() => onUpdateClip(clip.id, { effectStack: clip.effectStack?.map((candidate) => candidate.id === item.id ? { ...candidate, enabled: !candidate.enabled } : candidate) })}>{index + 1}</button><span>{item.name}</span><button disabled={locked || index === 0} onClick={() => moveEffectStackItem(item.id, -1)}>↑</button><button disabled={locked || index === clip.effectStack!.length - 1} onClick={() => moveEffectStackItem(item.id, 1)}>↓</button><button disabled={locked} onClick={() => onUpdateClip(clip.id, { effectStack: clip.effectStack?.filter((candidate) => candidate.id !== item.id) })}><Trash2 size={10} /></button></div>)}
          {clip.effectStack && videoEffectStackKinds.some((config) => !clip.effectStack?.some((item) => item.kind === config.kind)) && <div className="effect-stack-add">{videoEffectStackKinds.filter((config) => !clip.effectStack?.some((item) => item.kind === config.kind)).map((config) => <button key={config.kind} disabled={locked} onClick={() => addEffectStackItem(config.kind)}>+ {config.name}</button>)}</div>}
          {!clip.effectStack && <small>순서 편집을 시작하면 각 처리 단계를 켜고 끄거나 재정렬할 수 있습니다.</small>}
        </div>
        <div className="field-grid">
          <NumberField label="크롭 위" value={visual.cropTop} suffix="%" min={0} max={49} disabled={locked} onChange={(cropTop) => updateVisual({ cropTop })} />
          <NumberField label="크롭 오른쪽" value={visual.cropRight} suffix="%" min={0} max={49} disabled={locked} onChange={(cropRight) => updateVisual({ cropRight })} />
          <NumberField label="크롭 아래" value={visual.cropBottom} suffix="%" min={0} max={49} disabled={locked} onChange={(cropBottom) => updateVisual({ cropBottom })} />
          <NumberField label="크롭 왼쪽" value={visual.cropLeft} suffix="%" min={0} max={49} disabled={locked} onChange={(cropLeft) => updateVisual({ cropLeft })} />
          <SelectField label="빠른 단일 마스크" value={visual.masks?.length ? 'none' : visual.mask} disabled={locked} onChange={(mask) => updateVisual({ mask: mask as VisualEffects['mask'], masks: undefined })}><option value="none">없음</option><option value="rounded">둥근 사각형</option><option value="ellipse">타원</option><option value="polygon">자유 다각형</option></SelectField>
          <NumberField label="단일 마스크 페더" value={visual.maskFeather ?? 0} suffix="%" min={0} max={25} disabled={locked || Boolean(visual.masks?.length)} onChange={(maskFeather) => updateVisual({ maskFeather })} />
          <NumberField label="블러" value={visual.blur} suffix="px" min={0} max={40} disabled={locked} onChange={(blur) => updateVisual({ blur })} />
          <NumberField label="그림자 농도" value={visual.shadowOpacity} suffix="%" min={0} max={100} disabled={locked} onChange={(shadowOpacity) => updateVisual({ shadowOpacity })} />
          <NumberField label="그림자 흐림" value={visual.shadowBlur} suffix="px" min={0} max={80} disabled={locked} onChange={(shadowBlur) => updateVisual({ shadowBlur })} />
          <NumberField label="그림자 X" value={visual.shadowX} suffix="px" min={-200} max={200} disabled={locked} onChange={(shadowX) => updateVisual({ shadowX })} />
          <NumberField label="그림자 Y" value={visual.shadowY} suffix="px" min={-200} max={200} disabled={locked} onChange={(shadowY) => updateVisual({ shadowY })} />
          <NumberField label="얼굴 모자이크" value={visual.mosaicSize} suffix="%" min={5} max={45} disabled={locked || !visual.faceMosaic} onChange={(mosaicSize) => updateVisual({ mosaicSize })} />
          <SelectField label="합성 모드" value={visual.blendMode ?? 'normal'} disabled={locked} onChange={(blendMode) => updateVisual({ blendMode: blendMode as VisualEffects['blendMode'] })}><option value="normal">일반</option><option value="multiply">곱하기</option><option value="screen">스크린</option><option value="overlay">오버레이</option><option value="darken">어둡게</option><option value="lighten">밝게</option><option value="hard-light">하드 라이트</option><option value="soft-light">소프트 라이트</option><option value="difference">차이</option><option value="exclusion">제외</option><option value="color-dodge">컬러 닷지</option><option value="color-burn">컬러 번</option></SelectField>
          <NumberField label="크로마 허용값" value={visual.chromaKeyTolerance ?? 32} suffix="%" min={0} max={100} disabled={locked || !visual.chromaKeyEnabled} onChange={(chromaKeyTolerance) => updateVisual({ chromaKeyTolerance })} />
          <NumberField label="크로마 부드러움" value={visual.chromaKeySoftness ?? 18} suffix="%" min={1} max={100} disabled={locked || !visual.chromaKeyEnabled} onChange={(chromaKeySoftness) => updateVisual({ chromaKeySoftness })} />
          <NumberField label="그린 스필 제거" value={visual.chromaSpill ?? 45} suffix="%" min={0} max={100} disabled={locked || !visual.chromaKeyEnabled} onChange={(chromaSpill) => updateVisual({ chromaSpill })} />
        </div>
        <div className="toggle-row"><Toggle label="단일 마스크 반전" checked={Boolean(visual.maskInvert)} disabled={locked || Boolean(visual.masks?.length)} onChange={(maskInvert) => updateVisual({ maskInvert })} /><Toggle label="감지 얼굴 모자이크" checked={visual.faceMosaic} disabled={locked || clip.kind !== 'video'} onChange={(faceMosaic) => updateVisual({ faceMosaic })} /><Toggle label="크로마키" checked={Boolean(visual.chromaKeyEnabled)} disabled={locked} onChange={(chromaKeyEnabled) => updateVisual({ chromaKeyEnabled })} /><Toggle label="4점 코너 핀" checked={Boolean(visual.cornerPinEnabled)} disabled={locked} onChange={(cornerPinEnabled) => updateVisual({ cornerPinEnabled })} /></div>
        {visual.chromaKeyEnabled && <label className="color-field"><span>키 색상</span><input type="color" value={visual.chromaKeyColor ?? '#00ff00'} disabled={locked} onChange={(event) => updateVisual({ chromaKeyColor: event.target.value })} /></label>}
        {visual.cornerPinEnabled && <CornerPinEditor points={visual.cornerPinPoints} disabled={locked} onChange={(cornerPinPoints) => updateVisual({ cornerPinPoints })} />}
        {visual.mask === 'polygon' && <PolygonMaskEditor points={visual.maskPoints ?? []} disabled={locked} onChange={(maskPoints) => updateVisual({ maskPoints })} />}
        <MultiMaskEditor masks={visual.masks ?? resolveEffectMasks(visual)} disabled={locked} onChange={(masks) => updateVisual({ masks, mask: 'none', maskPoints: undefined, maskFeather: 0, maskInvert: false })} />
        {resolveEffectMasks(visual).some((mask) => mask.shape === 'polygon' || mask.shape === 'bezier') && asset?.kind === 'video' && <button className="inspector-wide-action" disabled={locked || motionTracking || sceneDetecting} onClick={() => objectTracking ? onCancelObjectTracking?.() : onTrackObject?.(clip.id)}>{objectTracking ? '일반 물체 추적 취소' : clip.visualKeyframes?.length ? '현재 마스크 교정점부터 다시 추적' : '첫 자유형 마스크 물체 추적 → 마스크 키프레임'}</button>}
        {asset?.kind === 'video' && <button className="inspector-wide-action" disabled={locked || motionTracking || sceneDetecting || objectTracking} onClick={() => videoBackgroundRemoval ? onCancelVideoBackgroundRemoval?.() : onRemoveVideoBackground?.(clip.id)}>{videoBackgroundRemoval ? '영상 배경 제거 취소' : '로컬 AI 영상 배경 제거 → 시간축 전경 마스크'}</button>}
        <div className="keyframe-list">
          {(clip.visualKeyframes ?? []).map((keyframe) => <div className="automation-keyframe-group" key={keyframe.id}><div className="automation-keyframe-row"><Diamond size={10} fill="currentColor" /><span>{keyframe.time.toFixed(2)}s</span><select value={keyframe.easing} disabled={locked} onChange={(event) => { const easing = event.target.value as typeof keyframe.easing; onUpdateClip(clip.id, { visualKeyframes: clip.visualKeyframes?.map((item) => item.id === keyframe.id ? { ...item, easing, curve: easing === 'bezier' ? item.curve ?? { x1: 0.33, y1: 0, x2: 0.67, y2: 1 } : item.curve } : item) }) }}><option value="linear">선형</option><option value="hold">홀드</option><option value="ease-in">가속</option><option value="ease-out">감속</option><option value="ease-in-out">부드럽게</option><option value="bezier">자유 곡선</option></select><button aria-label="효과 키프레임 삭제" disabled={locked} onClick={() => onUpdateClip(clip.id, { visualKeyframes: clip.visualKeyframes?.filter((item) => item.id !== keyframe.id) })}><Trash2 size={11} /></button></div>{keyframe.easing === 'bezier' && <SpeedBezierEditor curve={keyframe.curve} disabled={locked} onChange={(curve) => onUpdateClip(clip.id, { visualKeyframes: clip.visualKeyframes?.map((item) => item.id === keyframe.id ? { ...item, curve } : item) })} />}</div>)}
          {!clip.visualKeyframes?.length && <small>크롭·마스크·블러·크로마키·코너 핀 값을 재생 헤드 위치에 기록합니다.</small>}
        </div>
      </section>}

      {clip.adjustmentLayer && !clip.nestedSequenceId && <section className="property-section">
        <h3>조정 레이어 합성 효과</h3>
        <div className="field-grid"><NumberField label="합성 블러" value={visual.blur} suffix="px" min={0} max={40} disabled={locked} onChange={(blur) => updateVisual({ blur })} /></div>
        <p className="feature-note">색보정·LUT와 블러가 조정 레이어가 활성화된 시간의 합성 화면 전체에 적용됩니다.</p>
      </section>}

      {(clip.kind === 'video' || clip.kind === 'audio') && !clip.adjustmentLayer && !clip.nestedSequenceId && <section className="property-section">
        <div className="property-heading"><h3>오디오</h3><button className="mini-action" disabled={locked} onClick={addAudioMixKeyframe}><Plus size={12} /> 믹스 {localTime.toFixed(2)}s</button></div>
        {clip.adrTake !== undefined && <div className="adr-clip-meta"><strong>ADR Take {clip.adrTake}</strong><label className="text-field"><span>대사 큐</span><textarea value={clip.adrCue ?? ''} disabled={locked} onChange={(event) => onUpdateClip(clip.id, { adrCue: event.target.value })} /></label>{adrCue && clip.adrTakeId && <div className="adr-comp-editor"><div className="property-heading"><h3>구간별 테이크 컴핑</h3><small>{adrCue.compSegments?.length ?? 1} 구간</small></div><div className="field-grid"><NumberField label="인" value={adrCompIn} suffix="s" min={adrCue.start} max={adrCue.end} disabled={locked} onChange={(value) => setAdrCompIn(Math.max(adrCue.start, Math.min(value, adrCompOut - 0.02)))} /><NumberField label="아웃" value={adrCompOut} suffix="s" min={adrCue.start} max={adrCue.end} disabled={locked} onChange={(value) => setAdrCompOut(Math.min(adrCue.end, Math.max(value, adrCompIn + 0.02)))} /></div><div className="adr-comp-actions"><button disabled={locked || playhead < adrCue.start || playhead >= adrCue.end} onClick={() => setAdrCompIn(Math.min(playhead, adrCompOut - 0.02))}>재생 헤드 → 인</button><button disabled={locked || playhead <= adrCue.start || playhead > adrCue.end} onClick={() => setAdrCompOut(Math.max(playhead, adrCompIn + 0.02))}>재생 헤드 → 아웃</button><button className="primary" disabled={locked || adrCompOut - adrCompIn < 0.02} onClick={() => onAssignAdrRange?.(adrCue.id, clip.adrTakeId!, adrCompIn, adrCompOut)}>이 구간에 Take {clip.adrTake} 채택</button></div><div className="adr-comp-segments">{(adrCue.compSegments ?? []).map((segment) => { const take = adrCue.takes.find((item) => item.id === segment.takeId); return <span className={segment.takeId === clip.adrTakeId ? 'selected' : ''} key={segment.id}>{(segment.start - adrCue.start).toFixed(2)}–{(segment.end - adrCue.start).toFixed(2)}s · T{take?.takeNumber ?? '?'}</span> })}</div></div>}</div>}
        {clip.kind === 'video' && <div className="toggle-row"><Toggle label="내장 오디오 사용" checked={!clip.audioDisabled} disabled={locked} onChange={(enabled) => onUpdateClip(clip.id, { audioDisabled: !enabled })} /></div>}
        <div className="field-grid">
          <NumberField label="게인" value={audioMix.gainDb} suffix="dB" min={-60} max={24} disabled={locked} onChange={(gainDb) => updateAudioMix({ gainDb })} />
          <NumberField label="팬" value={audioMix.pan} min={-100} max={100} disabled={locked} onChange={(pan) => updateAudioMix({ pan })} />
          <SelectField label="채널 매핑" value={audio.channelMode ?? 'stereo'} disabled={locked} onChange={(channelMode) => updateAudio({ channelMode: channelMode as AudioAdjustment['channelMode'] })}><option value="stereo">스테레오 유지</option><option value="mono-left">왼쪽 → 모노</option><option value="mono-right">오른쪽 → 모노</option><option value="swap">좌우 교환</option><option value="mid">Mid (L+R)</option><option value="side">Side (L-R)</option></SelectField>
          <NumberField label="스테레오 폭" value={audio.stereoWidth ?? 100} suffix="%" min={0} max={200} step={1} disabled={locked} onChange={(stereoWidth) => updateAudio({ stereoWidth: Math.max(0, Math.min(200, stereoWidth)) })} />
          <div className="toggle-row"><Toggle label="L 위상 반전" checked={Boolean(audio.phaseInvertLeft)} disabled={locked} onChange={(phaseInvertLeft) => updateAudio({ phaseInvertLeft })} /><Toggle label="R 위상 반전" checked={Boolean(audio.phaseInvertRight)} disabled={locked} onChange={(phaseInvertRight) => updateAudio({ phaseInvertRight })} /></div>
          {(asset?.channels ?? 0) > 2 && <><NumberField label="센터 다운믹스" value={audio.downmixCenterDb ?? -3} suffix="dB" min={-60} max={6} step={0.5} disabled={locked} onChange={(downmixCenterDb) => updateAudio({ downmixCenterDb })} /><NumberField label="서라운드 다운믹스" value={audio.downmixSurroundDb ?? -3} suffix="dB" min={-60} max={6} step={0.5} disabled={locked} onChange={(downmixSurroundDb) => updateAudio({ downmixSurroundDb })} />{(asset?.channels ?? 0) >= 6 && <NumberField label="LFE 다운믹스" value={audio.downmixLfeDb ?? -60} suffix="dB" min={-60} max={0} step={0.5} disabled={locked} onChange={(downmixLfeDb) => updateAudio({ downmixLfeDb })} />}</>}
          <NumberField label="5.1 LFE 센드" value={audio.lfeSendDb ?? -60} suffix="dB" min={-60} max={12} step={0.5} disabled={locked} onChange={(lfeSendDb) => updateAudio({ lfeSendDb })} />
          {(audio.lfeSendDb ?? -60) > -60 && <NumberField label="LFE 로우패스" value={audio.lfeLowpassHz ?? 120} suffix="Hz" min={80} max={200} step={5} disabled={locked} onChange={(lfeLowpassHz) => updateAudio({ lfeLowpassHz })} />}
          <NumberField label="5.1 공간 위치" value={audio.surroundPan ?? 0} suffix="°" min={-180} max={180} step={1} disabled={locked} onChange={(surroundPan) => updateAudio({ surroundPan: Math.max(-180, Math.min(180, surroundPan)) })} />
          <NumberField label="5.1 스테레오 펼침" value={audio.surroundSpread ?? 60} suffix="°" min={0} max={180} step={1} disabled={locked} onChange={(surroundSpread) => updateAudio({ surroundSpread: Math.max(0, Math.min(180, surroundSpread)) })} />
          <NumberField label="페이드 인" value={audio.fadeIn} suffix="s" min={0} max={clip.duration} disabled={locked} onChange={(fadeIn) => updateAudio({ fadeIn })} />
          <SelectField label="인 곡선" value={audio.fadeInCurve ?? 'linear'} disabled={locked || audio.fadeIn <= 0} onChange={(fadeInCurve) => updateAudio({ fadeInCurve: fadeInCurve as NonNullable<AudioAdjustment['fadeInCurve']> })}><option value="linear">선형</option><option value="equal-power">Equal Power</option><option value="logarithmic">로그</option></SelectField>
          <NumberField label="페이드 아웃" value={audio.fadeOut} suffix="s" min={0} max={clip.duration} disabled={locked} onChange={(fadeOut) => updateAudio({ fadeOut })} />
          <SelectField label="아웃 곡선" value={audio.fadeOutCurve ?? 'linear'} disabled={locked || audio.fadeOut <= 0} onChange={(fadeOutCurve) => updateAudio({ fadeOutCurve: fadeOutCurve as NonNullable<AudioAdjustment['fadeOutCurve']> })}><option value="linear">선형</option><option value="equal-power">Equal Power</option><option value="logarithmic">로그</option></SelectField>
          <NumberField label="노이즈 감소" value={audio.noiseReduction} suffix="%" min={0} max={100} disabled={locked} onChange={(noiseReduction) => updateAudio({ noiseReduction })} />
          <NumberField label="치찰음 감소" value={audio.deEsser ?? 0} suffix="%" min={0} max={100} disabled={locked} onChange={(deEsser) => updateAudio({ deEsser })} />
          <SelectField label="전원 험 제거" value={audio.humRemoval ?? 'off'} disabled={locked} onChange={(humRemoval) => updateAudio({ humRemoval: humRemoval as AudioAdjustment['humRemoval'] })}><option value="off">끄기</option><option value="50hz">50Hz · 한국/유럽 계통</option><option value="60hz">60Hz · 북미 계통</option></SelectField>
          <SelectField label="역할" value={audio.role} disabled={locked} onChange={(role) => updateAudio({ role: role as AudioAdjustment['role'] })}><option value="dialogue">대화</option><option value="music">음악</option><option value="effects">효과음</option><option value="ambient">환경음</option></SelectField>
          <NumberField label="하이패스" value={audio.highpassHz ?? 20} suffix="Hz" min={20} max={500} step={10} disabled={locked} onChange={(highpassHz) => updateAudio({ highpassHz })} />
          <NumberField label="저역 EQ" value={audio.eqLowDb ?? 0} suffix="dB" min={-18} max={18} disabled={locked} onChange={(eqLowDb) => updateAudio({ eqLowDb })} />
          <NumberField label="중역 EQ" value={audio.eqMidDb ?? 0} suffix="dB" min={-18} max={18} disabled={locked} onChange={(eqMidDb) => updateAudio({ eqMidDb })} />
          <NumberField label="고역 EQ" value={audio.eqHighDb ?? 0} suffix="dB" min={-18} max={18} disabled={locked} onChange={(eqHighDb) => updateAudio({ eqHighDb })} />
          <NumberField label="컴프레서 기준" value={audio.compressorThresholdDb ?? -12} suffix="dB" min={-60} max={0} disabled={locked} onChange={(compressorThresholdDb) => updateAudio({ compressorThresholdDb })} />
          <NumberField label="컴프레서 비율" value={audio.compressorRatio ?? 1} suffix=":1" min={1} max={20} disabled={locked} onChange={(compressorRatio) => updateAudio({ compressorRatio })} />
          <NumberField label="리미터" value={audio.limiterDb ?? -1} suffix="dB" min={-12} max={0} disabled={locked} onChange={(limiterDb) => updateAudio({ limiterDb })} />
        </div>
        <div className="button-row audio-fade-presets" aria-label="오디오 페이드 빠른 프리셋">
          <button disabled={locked} onClick={() => applyAudioFadePreset(0.01, 0.01, 'linear')}>클릭 제거</button>
          <button disabled={locked} onClick={() => applyAudioFadePreset(0.04, 0.08, 'logarithmic')}>대사</button>
          <button disabled={locked} onClick={() => applyAudioFadePreset(0.5, 0.5, 'equal-power')}>뮤직</button>
          <button disabled={locked} onClick={() => applyAudioFadePreset(1, 1, 'equal-power')}>부드럽게</button>
          <button disabled={locked || (audio.fadeIn <= 0 && audio.fadeOut <= 0)} onClick={() => updateAudio({ fadeIn: 0, fadeOut: 0 })}>페이드 제거</button>
          <button disabled={locked || selectedClipCount < 2 || !onApplyAudioFadesToSelection} onClick={() => onApplyAudioFadesToSelection?.(clip.id)}>선택 {selectedClipCount}개 적용</button>
        </div>
        <div className="aux-routing"><div className="property-heading"><h3>Aux 센드</h3><button className="mini-action" disabled={locked || auxSends.length >= 4} onClick={() => { const bus = audioRoles.find((role) => role !== audio.role) ?? 'effects'; updateAuxSends([...auxSends, { id: crypto.randomUUID(), bus, levelDb: -12, position: 'post', enabled: true }]) }}><Plus size={12} /> 센드</button></div>{auxSends.map((send) => <div className={`aux-send-row ${send.enabled ? '' : 'disabled'}`} key={send.id}><Toggle label="" checked={send.enabled} disabled={locked} onChange={(enabled) => updateAuxSends(auxSends.map((item) => item.id === send.id ? { ...item, enabled } : item))} /><select aria-label="Aux 대상 버스" value={send.bus} disabled={locked} onChange={(event) => updateAuxSends(auxSends.map((item) => item.id === send.id ? { ...item, bus: event.target.value as AudioAdjustment['role'] } : item))}>{audioRoles.map((role) => <option key={role} value={role} disabled={role === audio.role}>{role === 'dialogue' ? '대화' : role === 'music' ? '음악' : role === 'effects' ? '효과음' : '환경음'}</option>)}</select><select aria-label="Aux 페이더 위치" value={send.position} disabled={locked} onChange={(event) => updateAuxSends(auxSends.map((item) => item.id === send.id ? { ...item, position: event.target.value as typeof send.position } : item))}><option value="post">포스트</option><option value="pre">프리</option></select><label><input aria-label="Aux 센드 레벨" type="number" min="-60" max="12" step="0.5" value={send.levelDb} disabled={locked} onChange={(event) => updateAuxSends(auxSends.map((item) => item.id === send.id ? { ...item, levelDb: Math.max(-60, Math.min(12, Number(event.target.value))) } : item))} /><small>dB</small></label><button aria-label="Aux 센드 삭제" disabled={locked} onClick={() => updateAuxSends(auxSends.filter((item) => item.id !== send.id))}><Trash2 size={11} /></button></div>)}{!auxSends.length && <small>효과·헤드폰·병렬 처리용 버스로 최대 4개까지 보낼 수 있습니다.</small>}<p className="feature-note">프리는 클립·트랙 페이더 전, 포스트는 페이더 후 신호를 보냅니다.</p></div>
        <div className="toggle-row"><Toggle label="속도 변경 시 음정 유지" checked={audio.preservePitch} disabled={locked} onChange={(preservePitch) => updateAudio({ preservePitch })} /><Toggle label="피크 정규화" checked={audio.normalize} disabled={locked} onChange={(normalize) => updateAudio({ normalize })} /><Toggle label="음성 강조" checked={audio.voiceEnhance} disabled={locked || effectiveAudioRole !== 'dialogue'} onChange={(voiceEnhance) => updateAudio({ voiceEnhance })} /><Toggle label="대화 시 자동 덕킹" checked={audio.ducking} disabled={locked || effectiveAudioRole !== 'music'} onChange={(ducking) => updateAudio({ ducking })} /></div>
        {effectiveAudioRole === 'music' && audio.ducking && <div className="field-grid"><NumberField label="덕킹 감쇠" value={audio.duckingAmountDb ?? -11} suffix="dB" min={-40} max={-1} step={0.5} disabled={locked} onChange={(duckingAmountDb) => updateAudio({ duckingAmountDb })} /><NumberField label="덕킹 어택" value={audio.duckingAttackMs ?? 180} suffix="ms" min={10} max={3000} step={10} disabled={locked} onChange={(duckingAttackMs) => updateAudio({ duckingAttackMs })} /><NumberField label="덕킹 릴리스" value={audio.duckingReleaseMs ?? 650} suffix="ms" min={10} max={5000} step={10} disabled={locked} onChange={(duckingReleaseMs) => updateAudio({ duckingReleaseMs })} /></div>}
        {clipNeedsPitchStretch(clip) && <p className="feature-note">{audio.preservePitch ? '40ms grain·10ms hop과 상관 정렬로 속도 램프 중 원래 음정을 유지합니다. 25% 미만·400% 초과는 납품 전 음질을 확인하세요.' : '음정 유지가 꺼져 있어 재생 속도에 따라 음정도 함께 변합니다.'}</p>}
        {noiseGateDbfs !== undefined && <p className="feature-note">게이트 임계값 {noiseGateDbfs.toFixed(1)} dBFS · 다음 6.0 dB 구간은 부드럽게 열려 저레벨 배경음을 줄이고 말소리의 클릭을 완화합니다.</p>}
        {audio.normalize && <p className="feature-note">{analyzedPeakDbfs !== undefined && normalizedPeakDbfs !== undefined
          ? `소스 sample peak ${analyzedPeakDbfs.toFixed(1)} dBFS · 정규화 ${normalizationGainDb >= 0 ? '+' : ''}${normalizationGainDb.toFixed(1)} dB · 예상 ${normalizedPeakDbfs.toFixed(1)} dBFS`
          : '오디오 피크 분석값이 없어 원본 게인을 유지합니다. 원본 미디어를 다시 연결·분석하세요.'}</p>}
        <div className="keyframe-list">
          {(clip.audioMixKeyframes ?? []).map((keyframe) => <div className="automation-keyframe-group" key={keyframe.id}><div className="automation-keyframe-row"><Diamond size={10} fill="currentColor" /><span>{keyframe.time.toFixed(2)}s · {keyframe.gainDb.toFixed(1)}dB · 팬 {Math.round(keyframe.pan)}</span><select value={keyframe.easing} disabled={locked} onChange={(event) => { const easing = event.target.value as typeof keyframe.easing; onUpdateClip(clip.id, { audioMixKeyframes: clip.audioMixKeyframes?.map((item) => item.id === keyframe.id ? { ...item, easing, curve: easing === 'bezier' ? item.curve ?? { x1: 0.33, y1: 0, x2: 0.67, y2: 1 } : item.curve } : item) }) }}><option value="linear">선형</option><option value="hold">홀드</option><option value="ease-in">가속</option><option value="ease-out">감속</option><option value="ease-in-out">부드럽게</option><option value="bezier">자유 곡선</option></select><button aria-label="오디오 믹스 키프레임 삭제" disabled={locked} onClick={() => onUpdateClip(clip.id, { audioMixKeyframes: clip.audioMixKeyframes?.filter((item) => item.id !== keyframe.id) })}><Trash2 size={11} /></button></div>{keyframe.easing === 'bezier' && <SpeedBezierEditor curve={keyframe.curve} disabled={locked} onChange={(curve) => onUpdateClip(clip.id, { audioMixKeyframes: clip.audioMixKeyframes?.map((item) => item.id === keyframe.id ? { ...item, curve } : item) })} />}</div>)}
          {!clip.audioMixKeyframes?.length && <small>재생 헤드 위치에 게인·팬 값을 기록해 자동화합니다.</small>}
        </div>
      </section>}

      {clip.kind === 'caption' && <section className="property-section">
        <div className="property-heading"><h3>자막 스타일</h3><button className="mini-action" disabled={locked || !onApplyCaptionStyleToTrack} onClick={() => onApplyCaptionStyleToTrack?.(clip.id)}>이 트랙 전체 적용</button></div>
        <div className="title-style-tools"><select value={selectedTitleStyleId} onChange={(event) => setSelectedTitleStyleId(event.target.value)}><option value="">사용자 타이틀 스타일</option>{titleStyleTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select><button disabled={locked || !selectedTitleStyleId} onClick={applySelectedTitleStyle}>적용</button><button disabled={locked} onClick={saveTitleStyleTemplate}>현재값 저장</button><button disabled={!selectedTitleStyleId} onClick={exportSelectedTitleStyle}>공유</button><button onClick={() => titleStyleImportRef.current?.click()}>가져오기</button><button disabled={!selectedTitleStyleId} onClick={deleteSelectedTitleStyle}>삭제</button><input ref={titleStyleImportRef} hidden type="file" accept=".json,.editweave-title.json,application/json" onChange={(event) => void importTitleStyle(event.target.files?.[0])} /></div>
        <div className="field-grid">
          <SelectField label="프리셋" value={caption.preset} disabled={locked} onChange={(preset) => updateCaption({ preset: preset as CaptionStyle['preset'] })}><option value="default">기본</option><option value="bold">볼드 쇼츠</option><option value="minimal">미니멀</option><option value="karaoke">단어 강조</option></SelectField>
          <NumberField label="글자 크기" value={caption.fontSize} suffix="%" min={40} max={240} disabled={locked} onChange={(fontSize) => updateCaption({ fontSize })} />
          <SelectField label="위치" value={caption.position} disabled={locked} onChange={(position) => updateCaption({ position: position as CaptionStyle['position'], positionY: position === 'top' ? 16 : position === 'middle' ? 50 : 84 })}><option value="top">상단</option><option value="middle">중앙</option><option value="bottom">하단</option></SelectField>
          <SelectField label="글꼴" value={caption.fontFamily ?? 'sans'} disabled={locked} onChange={(fontFamily) => updateCaption({ fontFamily: fontFamily as CaptionStyle['fontFamily'] })}><option value="sans">산세리프</option><option value="serif">세리프</option><option value="mono">모노</option></SelectField>
          <NumberField label="굵기" value={caption.fontWeight ?? 800} min={100} max={950} step={50} disabled={locked} onChange={(fontWeight) => updateCaption({ fontWeight })} />
          <SelectField label="정렬" value={caption.textAlign ?? 'center'} disabled={locked} onChange={(textAlign) => updateCaption({ textAlign: textAlign as CaptionStyle['textAlign'] })}><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></SelectField>
          <NumberField label="위치 X" value={caption.positionX ?? 50} suffix="%" min={0} max={100} disabled={locked} onChange={(positionX) => updateCaption({ positionX })} />
          <NumberField label="위치 Y" value={caption.positionY ?? 84} suffix="%" min={0} max={100} disabled={locked} onChange={(positionY) => updateCaption({ positionY })} />
          <NumberField label="행간" value={caption.lineHeight ?? 125} suffix="%" min={80} max={240} disabled={locked} onChange={(lineHeight) => updateCaption({ lineHeight })} />
          <NumberField label="자간" value={caption.letterSpacing ?? 0} suffix="%" min={-20} max={100} disabled={locked} onChange={(letterSpacing) => updateCaption({ letterSpacing })} />
          <NumberField label="최대 폭" value={caption.maxWidth ?? 80} suffix="%" min={10} max={100} disabled={locked} onChange={(maxWidth) => updateCaption({ maxWidth })} />
          <NumberField label="회전" value={caption.rotation ?? 0} suffix="°" min={-180} max={180} disabled={locked} onChange={(rotation) => updateCaption({ rotation })} />
          <SelectField label="안전 영역" value={caption.safeArea ?? 'title'} disabled={locked} onChange={(safeArea) => updateCaption({ safeArea: safeArea as CaptionStyle['safeArea'] })}><option value="none">제한 없음</option><option value="action">액션 안전 5%</option><option value="title">타이틀 안전 10%</option></SelectField>
          <NumberField label="배경 좌우 여백" value={caption.backgroundPaddingX ?? 70} suffix="%" min={0} max={200} disabled={locked || !caption.backgroundEnabled} onChange={(backgroundPaddingX) => updateCaption({ backgroundPaddingX })} />
          <NumberField label="배경 상하 여백" value={caption.backgroundPaddingY ?? 35} suffix="%" min={0} max={200} disabled={locked || !caption.backgroundEnabled} onChange={(backgroundPaddingY) => updateCaption({ backgroundPaddingY })} />
          <NumberField label="배경 모서리" value={caption.backgroundRadius ?? 35} suffix="%" min={0} max={100} disabled={locked || !caption.backgroundEnabled} onChange={(backgroundRadius) => updateCaption({ backgroundRadius })} />
          <NumberField label="그림자 흐림" value={caption.shadowBlur ?? 6} suffix="px" min={0} max={60} disabled={locked} onChange={(shadowBlur) => updateCaption({ shadowBlur })} />
          <NumberField label="그림자 X" value={caption.shadowX ?? 0} suffix="px" min={-50} max={50} disabled={locked} onChange={(shadowX) => updateCaption({ shadowX })} />
          <NumberField label="그림자 Y" value={caption.shadowY ?? 2} suffix="px" min={-50} max={50} disabled={locked} onChange={(shadowY) => updateCaption({ shadowY })} />
          <NumberField label="외곽선" value={caption.strokeWidth ?? 0} suffix="px" min={0} max={12} disabled={locked} onChange={(strokeWidth) => updateCaption({ strokeWidth })} />
          <SelectField label="등장 애니메이션" value={caption.animation ?? 'none'} disabled={locked} onChange={(animation) => updateCaption({ animation: animation as CaptionStyle['animation'] })}><option value="none">없음</option><option value="fade">페이드</option><option value="pop">팝</option><option value="slide-up">아래에서 등장</option></SelectField>
          <SelectField label="퇴장 애니메이션" value={caption.animationOut ?? 'none'} disabled={locked} onChange={(animationOut) => updateCaption({ animationOut: animationOut as CaptionStyle['animationOut'] })}><option value="none">없음</option><option value="fade">페이드</option><option value="pop">축소</option><option value="slide-down">아래로 퇴장</option></SelectField>
          <NumberField label="애니메이션 길이" value={caption.animationDuration ?? 0.35} suffix="s" min={0.05} max={3} disabled={locked} onChange={(animationDuration) => updateCaption({ animationDuration })} />
        </div>
        <div className="toggle-row"><Toggle label="배경 박스" checked={Boolean(caption.backgroundEnabled)} disabled={locked || caption.preset === 'minimal'} onChange={(backgroundEnabled) => updateCaption({ backgroundEnabled })} /><Toggle label="대문자 변환" checked={Boolean(caption.uppercase)} disabled={locked} onChange={(uppercase) => updateCaption({ uppercase })} /></div>
        <label className="color-field"><span>글자색</span><input type="color" value={caption.textColor} disabled={locked} onChange={(event) => updateCaption({ textColor: event.target.value })} /></label>
        <label className="color-field"><span>강조색</span><input type="color" value={caption.highlightColor} disabled={locked} onChange={(event) => updateCaption({ highlightColor: event.target.value })} /></label>
        <label className="color-field"><span>외곽선색</span><input type="color" value={caption.strokeColor ?? '#000000'} disabled={locked} onChange={(event) => updateCaption({ strokeColor: event.target.value })} /></label>
        <label className="text-field"><span>그림자 CSS 색상</span><input value={caption.shadowColor ?? 'rgba(0,0,0,.65)'} disabled={locked} onChange={(event) => updateCaption({ shadowColor: event.target.value })} /></label>
        <label className="text-field"><span>배경 CSS 색상</span><input value={caption.backgroundColor} disabled={locked} onChange={(event) => updateCaption({ backgroundColor: event.target.value })} /></label>
      </section>}

      <section className="property-section edit-status-callout"><span>{locked ? 'TRACK LOCKED' : 'NON-DESTRUCTIVE'}</span><p>{locked ? '트랙 잠금을 해제해야 클립 속성을 변경할 수 있습니다.' : '모든 값은 프로젝트에 저장되며 미리보기와 최종 출력에 함께 반영됩니다.'}</p></section>
    </aside>
  )
}
