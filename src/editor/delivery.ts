import type { AdrCue, AspectRatio, AudioBusMap, AudioBusSettings, MediaAsset, ProjectMergeSession, ProjectSequence, TimelineMarker, TimelineTrack } from './types'
import { applyBrickwallLimiter, applyNoiseGate, applyStaticCompressor, clipNeedsPitchStretch, defaultAudioAdjustment, gainFromDb, peakNormalizationGain } from './effects'
import { isAudioBusActive, normalizeAudioBuses, resolveAudioAuxSends } from './audioBuses'
import { inspectNestedSequenceGraph } from './nesting'
import { stereoPanSample } from './audioDsp'
import { effectiveSourceHdrFormat } from './sourceInterpretation'
import { inspectAdrApprovalCoverage } from '../platform/audioDeliveryConformance'

export interface DeliveryIssue {
  id: string
  level: 'blocker' | 'warning' | 'info'
  title: string
  detail: string
}

function estimateBusMagnitude(value: number, settings: AudioBusSettings): number {
  let output = Math.abs(value)
  for (const insert of settings.inserts) {
    if (!insert.enabled) continue
    if (insert.type === 'equalizer') {
      output *= gainFromDb(Math.max(0, insert.lowDb ?? 0, insert.midDb ?? 0, insert.highDb ?? 0))
    } else if (insert.type === 'compressor') {
      output = Math.abs(applyStaticCompressor(output, insert.thresholdDb ?? -18, insert.ratio ?? 3, insert.makeupDb ?? 0))
    } else if (insert.type === 'delay') {
      const mix = Math.max(0, Math.min(1, (insert.mix ?? 18) / 100))
      const feedback = Math.max(0, Math.min(.85, (insert.feedback ?? 28) / 100))
      output *= Math.cos(mix * Math.PI / 2) + Math.sin(mix * Math.PI / 2) / Math.max(.15, 1 - feedback)
    } else if (insert.type === 'limiter') {
      output = Math.abs(applyBrickwallLimiter(output, insert.ceilingDb ?? -1))
    }
  }
  return Math.abs(applyBrickwallLimiter(output * gainFromDb(settings.gainDb), settings.limiterDb))
}

export function estimateAudioLoudness(tracks: TimelineTrack[], assets: MediaAsset[], busSettings?: AudioBusMap): { lufs?: number; truePeakDb?: number } {
  let weightedEnergy = 0
  let weightedDuration = 0
  let truePeak = 0
  const solo = tracks.some((track) => (track.kind === 'video' || track.kind === 'audio') && track.solo)
  const buses = normalizeAudioBuses(busSettings)
  for (const track of tracks) {
    if ((track.kind !== 'video' && track.kind !== 'audio') || track.muted || (solo && !track.solo)) continue
    const trackVolumeValues = track.mixAutomationMode !== 'off' && track.mixKeyframes?.length ? track.mixKeyframes.map((keyframe) => keyframe.volume) : [track.volume ?? 100]
    const trackGain = Math.sqrt(trackVolumeValues.reduce((sum, volume) => sum + (volume / 100) ** 2, 0) / trackVolumeValues.length)
    const trackPeakGain = Math.max(...trackVolumeValues) / 100
    for (const clip of track.clips) {
      if (!clip.assetId || clip.audioDisabled) continue
      const asset = assets.find((candidate) => candidate.id === clip.assetId)
      if (!asset?.waveform?.length) continue
      const waveform = asset.waveform
      const adjustment = { ...defaultAudioAdjustment(), ...clip.audioAdjustment, ...(track.audioRole ? { role: track.audioRole } : {}) }
      const normalizationGain = adjustment.normalize ? peakNormalizationGain(asset.audioPeak) : 1
      const toneGain = gainFromDb(Math.max(0, adjustment.eqLowDb ?? 0, adjustment.eqMidDb ?? 0, adjustment.eqHighDb ?? 0, adjustment.voiceEnhance ? 4.5 : 0))
      const processClipMagnitude = (peak: number) => Math.abs(applyBrickwallLimiter(applyStaticCompressor(applyNoiseGate(peak, adjustment.noiseReduction) * toneGain, adjustment.compressorThresholdDb ?? -12, adjustment.compressorRatio ?? 1), adjustment.limiterDb ?? -1))
      const processedWaveform = waveform.map(processClipMagnitude)
      const gainValues = clip.audioMixKeyframes?.length ? clip.audioMixKeyframes.map((keyframe) => keyframe.gainDb) : [clip.audioAdjustment?.gainDb ?? 0]
      const role = adjustment.role
      const sends = resolveAudioAuxSends(clip.audioAdjustment).filter((send) => send.enabled && send.bus !== role && isAudioBusActive(buses, send.bus))
      const rmsFader = Math.sqrt(gainValues.reduce((sum, gainDb) => sum + gainFromDb(gainDb) ** 2, 0) / gainValues.length) * trackGain
      const peakFader = gainFromDb(Math.max(...gainValues)) * trackPeakGain
      const clipPanValues = clip.audioMixKeyframes?.length ? clip.audioMixKeyframes.map((keyframe) => keyframe.pan) : [adjustment.pan]
      const trackPanValues = track.mixKeyframes?.length ? track.mixKeyframes.map((keyframe) => keyframe.pan) : [track.pan ?? 0]
      const panPeakFactor = Math.max(...clipPanValues.flatMap((clipPan) => trackPanValues.map((trackPan) => {
        const panned = stereoPanSample(1, 1, (clipPan + trackPan) / 100, asset.channels === 1)
        return Math.max(Math.abs(panned.left), Math.abs(panned.right))
      })))
      const routeMagnitude = (peak: number, fader: number) => {
        let total = isAudioBusActive(buses, role) ? estimateBusMagnitude(peak * normalizationGain * fader * panPeakFactor, buses[role]) : 0
        for (const send of sends) {
          const sendFader = send.position === 'pre' ? 1 : fader * panPeakFactor
          total += estimateBusMagnitude(peak * normalizationGain * sendFader * gainFromDb(send.levelDb), buses[send.bus])
        }
        return Math.abs(Math.tanh(total))
      }
      const energy = processedWaveform.reduce((sum, peak) => sum + routeMagnitude(peak, rmsFader) ** 2, 0) / processedWaveform.length
      if (energy <= 0) continue
      weightedEnergy += energy * clip.duration
      weightedDuration += clip.duration
      truePeak = Math.max(truePeak, routeMagnitude(processClipMagnitude(asset.audioPeak ?? Math.max(...waveform)), peakFader))
    }
  }
  if (!weightedDuration) return {}
  const rms = Math.sqrt(weightedEnergy / weightedDuration)
  return {
    lufs: Math.max(-70, 20 * Math.log10(Math.max(1e-7, rms)) - 7),
    truePeakDb: Math.max(-70, 20 * Math.log10(Math.max(1e-7, truePeak))),
  }
}

export function inspectDelivery(options: {
  tracks: TimelineTrack[]
  assets: MediaAsset[]
  sequences: ProjectSequence[]
  aspectRatio: AspectRatio
  audioBuses?: AudioBusMap
  sourceTracks?: TimelineTrack[]
  activeSequenceId?: string
  markers?: TimelineMarker[]
  mergeSessions?: ProjectMergeSession[]
  adrCues?: AdrCue[]
}): DeliveryIssue[] {
  const { tracks, assets, sequences, aspectRatio, audioBuses } = options
  const issues: DeliveryIssue[] = []
  const visibleVideoClips = tracks
    .filter((track) => track.kind === 'video' && !track.muted && track.visible !== false)
    .flatMap((track) => track.clips.filter((clip) => clip.enabled !== false && !clip.adjustmentLayer))

  if (!visibleVideoClips.length) issues.push({ id: 'no-picture', level: 'blocker', title: '출력할 영상이 없음', detail: '표시된 비디오 트랙에 영상·이미지 또는 중첩 시퀀스를 추가하세요.' })

  const referencedAssetIds = new Set(tracks.flatMap((track) => track.clips.flatMap((clip) => clip.enabled !== false && clip.assetId ? [clip.assetId] : [])))
  for (const assetId of referencedAssetIds) {
    const asset = assets.find((candidate) => candidate.id === assetId)
    if (!asset || asset.status === 'offline' || !asset.sourceFile) {
      issues.push({ id: `offline-${assetId}`, level: 'blocker', title: '원본 미디어 오프라인', detail: asset ? `“${asset.name}” 원본을 다시 연결해야 합니다.` : `프로젝트가 찾을 수 없는 미디어 ID ${assetId}를 참조합니다.` })
      continue
    }
    const compatibleProxyReady = asset.proxyStatus === 'ready' && Boolean(asset.proxyFile || asset.proxyCachePath || asset.proxySourcePath)
    const visualDecoderMissing = asset.videoDecodable === false || asset.imageDecodable === false
    if (asset.status === 'error' || visualDecoderMissing && !compatibleProxyReady) issues.push({ id: `decode-${assetId}`, level: 'blocker', title: asset.kind === 'image' ? '이미지 디코더 없음' : '영상 디코더 없음', detail: `“${asset.name}”을 이 장비에서 디코딩할 수 없습니다. 호환 프록시를 생성하거나 원본을 다시 연결하세요.` })
    else if (visualDecoderMissing && compatibleProxyReady) issues.push({ id: `decode-proxy-${assetId}`, level: 'warning', title: asset.proxyPurpose === 'external' ? '외부 프록시 기반 납품' : '고품질 호환 미디어 기반 납품', detail: asset.kind === 'image' ? `“${asset.name}”은 앱 코덱 엔진으로 만든 원본 해상도 알파 보존 PNG로 출력됩니다.` : asset.proxyPurpose === 'external' ? `“${asset.name}” 원본은 직접 디코딩할 수 없어 연결한 외부 프록시로 출력됩니다. 외부 프록시의 해상도·색·비트레이트가 마스터 기준을 충족해야 합니다.` : `“${asset.name}”은 원본 해상도·고품질 호환 미디어로 출력됩니다. HDR 원본은 Rec.709 호환 변환이므로 HDR 마스터에는 직접 지원되는 원본 코덱이 필요합니다.` })
    if (asset.variableFrameRate) issues.push({ id: `vfr-${assetId}`, level: 'warning', title: 'VFR 원본 확인 필요', detail: `“${asset.name}”은 가변 프레임레이트입니다. 최종 파일의 프레임 정확도와 A/V 동기화를 확인하세요.` })
    const sourceHdrFormat = effectiveSourceHdrFormat(asset)
    if (sourceHdrFormat === 'pq' || sourceHdrFormat === 'hlg') {
      const light = [asset.maxContentLightLevel ? `MaxCLL ${asset.maxContentLightLevel} nit` : '', asset.maxFrameAverageLightLevel ? `MaxFALL ${asset.maxFrameAverageLightLevel} nit` : ''].filter(Boolean).join(' · ')
      issues.push({ id: `hdr-${assetId}`, level: 'warning', title: 'HDR 원본 · 출력 모드 확인', detail: `“${asset.name}”은 ${sourceHdrFormat.toUpperCase()} 원본${asset.sourceColorSpaceOverride && asset.sourceColorSpaceOverride !== 'auto' ? ' (수동 해석)' : ''}${light ? ` (${light})` : ''}입니다. 편집 프록시는 Rec.709로 톤매핑됩니다. SDR 납품의 하이라이트 또는 HDR10/HLG 출력의 네이티브 휘도 보존 범위를 확인하세요.` })
    }
    if (asset.audioCodec && asset.audioDecodable === false) issues.push({ id: `audio-${assetId}`, level: 'warning', title: compatibleProxyReady ? '호환 프록시 오디오 사용' : '일부 오디오 디코딩 불가', detail: compatibleProxyReady ? `“${asset.name}”의 ${asset.audioCodec} 오디오는 호환 프록시에서 디코딩해 출력됩니다.` : `“${asset.name}”의 ${asset.audioCodec} 오디오가 무음으로 출력될 수 있습니다.` })
    if ((asset.channels ?? 0) > 6) issues.push({ id: `audio-layout-${assetId}`, level: 'warning', title: '7.1 이상 오디오 레이아웃 확인', detail: `“${asset.name}”은 ${asset.channels}채널입니다. 현재 스테레오 납품은 앞쪽 5.1 bed를 기준으로 downmix하므로 추가 후방·높이 채널은 보존되지 않습니다.` })
  }

  const sequenceById = new Map(sequences.map((sequence) => [sequence.id, sequence]))
  const deliverySequenceIds = new Set<string>()
  const collectDeliverySequence = (sequenceId: string) => {
    if (deliverySequenceIds.has(sequenceId)) return
    deliverySequenceIds.add(sequenceId)
    sequenceById.get(sequenceId)?.tracks.flatMap((track) => track.clips).filter((clip) => clip.enabled !== false).forEach((clip) => {
      if (clip.nestedSequenceId) collectDeliverySequence(clip.nestedSequenceId)
    })
  }
  collectDeliverySequence(options.activeSequenceId ?? sequences[0]?.id ?? '')

  for (const cue of (options.adrCues ?? []).filter((candidate) => deliverySequenceIds.has(candidate.sequenceId))) {
    const cueSequence = sequences.find((sequence) => sequence.id === cue.sequenceId)
    if (!cueSequence) {
      issues.push({ id: `adr-sequence-${cue.id}`, level: 'blocker', title: 'ADR 시퀀스 누락', detail: `ADR 큐 “${cue.text || cue.id}”가 찾을 수 없는 시퀀스를 참조합니다.` })
      continue
    }
    const takeIds = new Set(cue.takes.map((take) => take.id))
    if (cue.selectedTakeId && !takeIds.has(cue.selectedTakeId)) issues.push({ id: `adr-selected-${cue.id}`, level: 'blocker', title: 'ADR 선택 테이크 누락', detail: `ADR 큐 “${cue.text || cue.id}”의 채택 테이크를 찾을 수 없습니다.` })
    const missingCompTake = cue.compSegments?.find((segment) => !takeIds.has(segment.takeId))
    if (missingCompTake) issues.push({ id: `adr-comp-${cue.id}`, level: 'blocker', title: 'ADR 컴프 참조 손상', detail: `ADR 큐 “${cue.text || cue.id}”의 컴프 구간이 없는 테이크 ${missingCompTake.takeId}를 참조합니다.` })
    for (const take of cue.takes) {
      const asset = assets.find((candidate) => candidate.id === take.assetId)
      if (!asset || asset.status !== 'ready' || !asset.sourceFile) issues.push({ id: `adr-asset-${take.id}`, level: 'blocker', title: 'ADR 녹음 원본 사용 불가', detail: asset ? `ADR Take ${take.takeNumber}의 “${asset.name}” 원본을 다시 연결하거나 분석 오류를 해결해야 합니다.` : `ADR Take ${take.takeNumber}이 찾을 수 없는 미디어 ID ${take.assetId}를 참조합니다.` })
      const track = cueSequence.tracks.find((candidate) => candidate.id === take.trackId)
      const clip = track?.clips.find((candidate) => candidate.id === take.clipId)
      if (!track || !clip) issues.push({ id: `adr-clip-${take.id}`, level: 'blocker', title: 'ADR 테이크 레인 누락', detail: `ADR Take ${take.takeNumber}의 트랙 또는 타임라인 클립을 찾을 수 없습니다.` })
      else if (clip.assetId !== take.assetId) issues.push({ id: `adr-media-${take.id}`, level: 'blocker', title: 'ADR 테이크 미디어 불일치', detail: `ADR Take ${take.takeNumber} 기록과 타임라인 클립이 서로 다른 미디어를 참조합니다.` })
    }
  }
  issues.push(...inspectAdrApprovalCoverage((options.adrCues ?? []).filter((candidate) => deliverySequenceIds.has(candidate.sequenceId)), sequences, assets))

  for (const diagnostic of inspectNestedSequenceGraph(options.sourceTracks ?? tracks, sequences, options.activeSequenceId)) {
    if (diagnostic.kind === 'missing') issues.push({ id: diagnostic.id, level: 'blocker', title: '중첩 시퀀스 누락', detail: `“${diagnostic.clipName}”이 찾을 수 없는 시퀀스를 참조합니다. 경로: ${diagnostic.sequencePath.join(' → ')}` })
    else if (diagnostic.kind === 'cycle') issues.push({ id: diagnostic.id, level: 'blocker', title: '중첩 시퀀스 순환 참조', detail: `“${diagnostic.clipName}”에서 시퀀스가 자신을 다시 참조합니다. 경로: ${diagnostic.sequencePath.join(' → ')}` })
    else issues.push({ id: diagnostic.id, level: 'blocker', title: '중첩 깊이 제한 초과', detail: `16단계를 넘는 중첩을 안전하게 합성할 수 없습니다. 경로: ${diagnostic.sequencePath.join(' → ')}` })
  }

  const intervals = visibleVideoClips
    .map((clip) => ({ start: clip.start, end: clip.start + clip.duration }))
    .sort((a, b) => a.start - b.start)
  if (intervals.length) {
    let coveredUntil = 0
    let gapCount = 0
    for (const interval of intervals) {
      if (interval.start - coveredUntil > 0.5) gapCount += 1
      coveredUntil = Math.max(coveredUntil, interval.end)
    }
    if (gapCount) issues.push({ id: 'picture-gaps', level: 'warning', title: `검은 화면 구간 ${gapCount}개`, detail: '0.5초보다 긴 비디오 공백이 있습니다. 의도한 공백인지 확인하세요.' })
  }

  const loudTracks = tracks.filter((track) => (track.kind === 'video' || track.kind === 'audio') && !track.muted).flatMap((track) => track.clips
    .filter((clip) => clip.enabled !== false && !clip.audioDisabled && (Math.max(clip.audioAdjustment?.gainDb ?? 0, ...(clip.audioMixKeyframes ?? []).map((keyframe) => keyframe.gainDb)) > 0 || Math.max(track.volume ?? 100, ...(track.mixKeyframes ?? []).map((keyframe) => keyframe.volume)) > 100)))
  if (loudTracks.length) issues.push({ id: 'audio-headroom', level: 'warning', title: '오디오 클리핑 가능성', detail: `양의 게인 또는 100% 초과 트랙 음량을 사용하는 클립 ${loudTracks.length}개가 있습니다.` })
  const pitchStretched = tracks.filter((track) => (track.kind === 'video' || track.kind === 'audio') && !track.muted).flatMap((track) => track.clips.filter((clip) => clip.enabled !== false && !clip.audioDisabled && ({ ...defaultAudioAdjustment(), ...clip.audioAdjustment }).preservePitch && clipNeedsPitchStretch(clip)))
  const extremePitchStretched = pitchStretched.filter((clip) => {
    const rates = [clip.playbackRate ?? 1, ...(clip.speedKeyframes ?? []).map((keyframe) => keyframe.rate)]
    return Math.min(...rates) < 0.25 || Math.max(...rates) > 4
  })
  if (extremePitchStretched.length) issues.push({ id: 'pitch-stretch-extreme', level: 'warning', title: '극단 속도 음정 유지 확인', detail: `25% 미만 또는 400% 초과에서 음정을 유지하는 클립 ${extremePitchStretched.length}개가 있습니다. 대사·음악의 grain 질감과 전환 경계를 확인하세요.` })
  const loudness = estimateAudioLoudness(tracks, assets, audioBuses)
  if (loudness.truePeakDb !== undefined && loudness.truePeakDb > -1) issues.push({ id: 'true-peak', level: 'warning', title: 'True Peak 여유 부족', detail: `빠른 예상값이 ${loudness.truePeakDb.toFixed(1)} dBTP입니다. 믹서에서 -1 dBTP 이하의 여유를 확보하세요.` })
  if (loudness.lufs !== undefined && (loudness.lufs > -12 || loudness.lufs < -20)) issues.push({ id: 'loudness-target', level: 'warning', title: 'YouTube 음량 목표 확인', detail: `빠른 예상값이 ${loudness.lufs.toFixed(1)} LUFS입니다. 일반적인 YouTube 기준인 -14 LUFS 근처로 맞출 수 있습니다.` })
  else if (loudness.lufs !== undefined) issues.push({ id: 'loudness-estimate', level: 'info', title: '오디오 음량 예상', detail: `${loudness.lufs.toFixed(1)} LUFS · ${loudness.truePeakDb?.toFixed(1) ?? '—'} dBTP로 추정됩니다.` })

  if (aspectRatio !== '16:9' && tracks.some((track) => track.kind === 'caption' && track.clips.some((clip) => (clip.captionStyle?.position ?? 'bottom') === 'bottom' && (clip.captionStyle?.fontSize ?? 100) > 130))) {
    issues.push({ id: 'caption-safe-area', level: 'warning', title: '쇼츠 자막 안전 영역', detail: '큰 하단 자막이 플랫폼 버튼 또는 설명 영역과 겹칠 수 있습니다.' })
  }

  const unresolvedSessionConflicts = (options.mergeSessions ?? []).flatMap((session) => session.conflicts.filter((conflict) => conflict.status === 'open'))
  const unresolvedMergeMarkers = (options.markers ?? []).filter((marker) => marker.kind === 'comment' && marker.status !== 'resolved' && (marker.author === 'Cutline 병합' || marker.id.startsWith('merge-conflict-')))
  const unresolvedMergeCount = unresolvedSessionConflicts.length || unresolvedMergeMarkers.length
  if (unresolvedMergeCount) issues.push({ id: 'unresolved-merge-conflicts', level: 'warning', title: '공동 작업 충돌 미확인', detail: `프로젝트에 해결되지 않은 병합 충돌 ${unresolvedMergeCount}개가 있습니다. 버전 기록에서 현재/상대 결정을 완료하고 의도한 편집인지 확인하세요.` })

  if (!issues.some((issue) => issue.level === 'blocker' || issue.level === 'warning')) issues.push({ id: 'ready', level: 'info', title: '기본 납품 검사 통과', detail: '오프라인 원본, 디코더, 긴 영상 공백과 자막 안전 영역에서 차단 문제를 찾지 못했습니다.' })
  return issues
}
