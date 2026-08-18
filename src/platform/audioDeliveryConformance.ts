import type { AdrCue, AudioBusMap, AudioRole, MediaAsset, ProjectSequence, TimelineTrack } from '../editor/types'
import { audioRoles, normalizeAudioBuses } from '../editor/audioBuses'

export type AudioDeliveryProfileId = 'web-video' | 'broadcast-ebu-r128' | 'podcast-stereo'

export interface AudioDeliveryProfile {
  id: AudioDeliveryProfileId
  name: string
  targetLufs: number
  toleranceLu: number
  maxTruePeakDbtp: number
  allowedSampleRates: Array<44_100 | 48_000 | 96_000>
  allowedChannels: Array<1 | 2 | 6>
  requiredStemRoles?: AudioRole[]
  require24BitWav?: boolean
}

export interface AudioConformanceIssue {
  id: string
  level: 'blocker' | 'warning'
  title: string
  detail: string
}

export interface LoudnessConformance {
  profileId: AudioDeliveryProfileId
  status: 'pass' | 'fail'
  loudnessDeltaLu: number
  truePeakHeadroomDb: number
  issues: AudioConformanceIssue[]
}

export const audioDeliveryProfiles: Record<AudioDeliveryProfileId, AudioDeliveryProfile> = {
  'web-video': {
    id: 'web-video', name: 'Web 영상 · EditWeave -14', targetLufs: -14, toleranceLu: 2, maxTruePeakDbtp: -1,
    allowedSampleRates: [44_100, 48_000, 96_000], allowedChannels: [1, 2, 6],
  },
  'broadcast-ebu-r128': {
    id: 'broadcast-ebu-r128', name: '방송 · EBU R128', targetLufs: -23, toleranceLu: 0.5, maxTruePeakDbtp: -1,
    allowedSampleRates: [48_000], allowedChannels: [2, 6], requiredStemRoles: [...audioRoles], require24BitWav: true,
  },
  'podcast-stereo': {
    id: 'podcast-stereo', name: '팟캐스트 스테레오 · EditWeave -16', targetLufs: -16, toleranceLu: 1, maxTruePeakDbtp: -1,
    allowedSampleRates: [44_100, 48_000], allowedChannels: [2],
  },
}

export function normalizeAudioDeliveryProfileId(value: unknown): AudioDeliveryProfileId {
  return value === 'broadcast-ebu-r128' || value === 'podcast-stereo' ? value : 'web-video'
}

export function evaluateLoudnessConformance(
  measurement: { integratedLufs: number; truePeakDbtp: number },
  profileId: AudioDeliveryProfileId,
): LoudnessConformance {
  const profile = audioDeliveryProfiles[profileId]
  const loudnessDeltaLu = measurement.integratedLufs - profile.targetLufs
  const truePeakHeadroomDb = profile.maxTruePeakDbtp - measurement.truePeakDbtp
  const issues: AudioConformanceIssue[] = []
  if (!Number.isFinite(measurement.integratedLufs) || measurement.integratedLufs < -120 || measurement.integratedLufs > 24) {
    issues.push({ id: 'loudness-invalid', level: 'blocker', title: '통합 러드니스 측정값 오류', detail: '유한한 -120~24 LUFS 측정값이 필요합니다.' })
  } else if (Math.abs(loudnessDeltaLu) > profile.toleranceLu) {
    issues.push({ id: 'loudness-out-of-range', level: 'blocker', title: '통합 러드니스 허용 범위 초과', detail: `${measurement.integratedLufs.toFixed(1)} LUFS는 ${profile.targetLufs}±${profile.toleranceLu} LU 범위를 벗어납니다.` })
  }
  if (!Number.isFinite(measurement.truePeakDbtp) || measurement.truePeakDbtp < -120 || measurement.truePeakDbtp > 24) {
    issues.push({ id: 'true-peak-invalid', level: 'blocker', title: 'True Peak 측정값 오류', detail: '유한한 -120~24 dBTP 측정값이 필요합니다.' })
  } else if (measurement.truePeakDbtp > profile.maxTruePeakDbtp) {
    issues.push({ id: 'true-peak-over', level: 'blocker', title: 'True Peak 상한 초과', detail: `${measurement.truePeakDbtp.toFixed(1)} dBTP가 ${profile.maxTruePeakDbtp.toFixed(1)} dBTP 상한을 초과합니다.` })
  }
  return { profileId, status: issues.length ? 'fail' : 'pass', loudnessDeltaLu, truePeakHeadroomDb, issues }
}

export function inspectAudioOutputSettings(options: {
  profileId: AudioDeliveryProfileId
  sampleRate: 44_100 | 48_000 | 96_000
  channels: 1 | 2 | 6
  bitDepth?: number
  mixdownWav?: boolean
  stemRoles?: AudioRole[]
}): AudioConformanceIssue[] {
  const profile = audioDeliveryProfiles[options.profileId]
  const issues: AudioConformanceIssue[] = []
  if (!profile.allowedSampleRates.includes(options.sampleRate)) issues.push({ id: 'audio-sample-rate', level: 'blocker', title: '납품 샘플레이트 불일치', detail: `${profile.name}은 ${profile.allowedSampleRates.map((rate) => `${rate / 1_000}kHz`).join(' 또는 ')}를 사용해야 합니다.` })
  if (!profile.allowedChannels.includes(options.channels)) issues.push({ id: 'audio-channel-count', level: 'blocker', title: '납품 채널 구성 불일치', detail: `${profile.name}이 허용하는 채널 수는 ${profile.allowedChannels.join('·')}ch입니다.` })
  if (profile.require24BitWav && (!options.mixdownWav || (options.bitDepth ?? 24) < 24)) issues.push({ id: 'audio-master-wav', level: 'blocker', title: '24-bit Full Mix WAV 필요', detail: `${profile.name} 납품에는 24-bit Full Mix WAV를 함께 생성해야 합니다.` })
  if (profile.requiredStemRoles) {
    const selected = new Set(options.stemRoles ?? [])
    const missing = profile.requiredStemRoles.filter((role) => !selected.has(role))
    if (missing.length) issues.push({ id: 'audio-required-stems', level: 'blocker', title: '역할별 Stem 누락', detail: `대화·음악·효과음·환경음 중 ${missing.length}개 역할 Stem이 선택되지 않았습니다.` })
  }
  return issues
}

export function inspectAudioProjectRouting(tracks: TimelineTrack[], buses?: AudioBusMap, outputChannels: 1 | 2 | 6 = 2): AudioConformanceIssue[] {
  const issues: AudioConformanceIssue[] = []
  const normalized = normalizeAudioBuses(buses)
  const soloRoles = audioRoles.filter((role) => normalized[role].solo)
  if (soloRoles.length) issues.push({ id: 'audio-bus-solo', level: 'blocker', title: '버스 Solo 활성화', detail: `납품 전 ${soloRoles.length}개 역할 버스의 Solo를 해제해야 합니다.` })
  const soloTracks = tracks.filter((track) => (track.kind === 'audio' || track.kind === 'video') && track.solo)
  if (soloTracks.length) issues.push({ id: 'audio-track-solo', level: 'blocker', title: '트랙 Solo 활성화', detail: `납품 전 ${soloTracks.length}개 오디오 가능 트랙의 Solo를 해제해야 합니다.` })
  if (outputChannels !== 6) {
    const surroundRouted = tracks.filter((track) => track.audioOutputChannel && track.audioOutputChannel !== 'auto')
    if (surroundRouted.length) issues.push({ id: 'audio-surround-downmix', level: 'warning', title: '5.1 직접 라우팅 다운믹스', detail: `${surroundRouted.length}개 트랙의 직접 채널 지정은 ${outputChannels}ch 출력에서 보존되지 않습니다.` })
  }
  return issues
}

export function inspectAdrApprovalCoverage(cues: AdrCue[], sequences: ProjectSequence[], assets: MediaAsset[]): AudioConformanceIssue[] {
  const issues: AudioConformanceIssue[] = []
  const sequenceIds = new Set(sequences.map((sequence) => sequence.id))
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  for (const cue of cues.filter((item) => sequenceIds.has(item.sequenceId))) {
    if (cue.status !== 'approved') {
      if (cue.takes.length) issues.push({ id: `adr-unapproved-${cue.id}`, level: 'warning', title: 'ADR 테이크 미승인', detail: `ADR 큐 “${cue.text || cue.id}”의 최종 테이크가 승인되지 않았습니다.` })
      continue
    }
    const segments = [...(cue.compSegments ?? [])].sort((left, right) => left.start - right.start)
    if (!cue.selectedTakeId || !segments.length) {
      issues.push({ id: `adr-approval-${cue.id}`, level: 'blocker', title: '승인 ADR 컴프 누락', detail: `승인된 ADR 큐 “${cue.text || cue.id}”에 선택 테이크와 전체 컴프가 필요합니다.` })
      continue
    }
    let coveredUntil = cue.start
    for (const segment of segments) {
      const take = cue.takes.find((candidate) => candidate.id === segment.takeId)
      if (!take || !assetById.has(take.assetId)) continue
      if (segment.start < cue.start - 0.001 || segment.end > cue.end + 0.001 || segment.end <= segment.start || segment.start > coveredUntil + 0.001 || segment.start < coveredUntil - 0.001) {
        issues.push({ id: `adr-coverage-${cue.id}-${segment.id}`, level: 'blocker', title: 'ADR 컴프 구간 불연속', detail: `ADR 큐 “${cue.text || cue.id}”의 컴프에 공백·중첩 또는 범위 이탈이 있습니다.` })
      }
      if (segment.end - segment.start > take.duration + 0.05) issues.push({ id: `adr-duration-${cue.id}-${segment.id}`, level: 'blocker', title: 'ADR 테이크 길이 부족', detail: `Take ${take.takeNumber}보다 긴 컴프 구간을 사용할 수 없습니다.` })
      coveredUntil = Math.max(coveredUntil, segment.end)
    }
    if (coveredUntil < cue.end - 0.001) issues.push({ id: `adr-tail-${cue.id}`, level: 'blocker', title: 'ADR 컴프 끝 구간 누락', detail: `ADR 큐 “${cue.text || cue.id}”의 끝까지 승인 컴프가 이어지지 않습니다.` })
  }
  return issues
}

export function audioChannelLabels(channels: 1 | 2 | 6): string[] {
  return channels === 1 ? ['M'] : channels === 2 ? ['L', 'R'] : ['L', 'R', 'C', 'LFE', 'Ls', 'Rs']
}

export interface AudioDeliveryBenchmark {
  version: 'editweave-audio-delivery-v1'
  provenance: 'synthetic-reference' | 'measured-lab'
  cases: Array<{ id: string; profileId: AudioDeliveryProfileId; integratedLufs: number; truePeakDbtp: number; expected: 'pass' | 'fail' }>
}

export function evaluateAudioDeliveryBenchmark(value: unknown): { cases: number; passed: number; mismatches: string[] } {
  const benchmark = value as Partial<AudioDeliveryBenchmark>
  if (benchmark.version !== 'editweave-audio-delivery-v1' || !['synthetic-reference', 'measured-lab'].includes(benchmark.provenance ?? '') || !Array.isArray(benchmark.cases)) throw new Error('지원되는 오디오 납품 기준셋 형식이 아닙니다.')
  const mismatches: string[] = []
  for (const item of benchmark.cases) {
    if (!item.id || !(item.profileId in audioDeliveryProfiles) || !Number.isFinite(item.integratedLufs) || !Number.isFinite(item.truePeakDbtp) || !['pass', 'fail'].includes(item.expected)) throw new Error('오디오 납품 기준 사례가 올바르지 않습니다.')
    if (evaluateLoudnessConformance(item, item.profileId).status !== item.expected) mismatches.push(item.id)
  }
  return { cases: benchmark.cases.length, passed: benchmark.cases.length - mismatches.length, mismatches }
}
