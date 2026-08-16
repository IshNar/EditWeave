import { invoke, isTauri } from '@tauri-apps/api/core'
import { evaluateLoudnessConformance, normalizeAudioDeliveryProfileId, type AudioDeliveryProfileId, type LoudnessConformance } from './audioDeliveryConformance'

export interface LoudnessMeasurement {
  integratedLufs: number
  loudnessRangeLu: number
  truePeakDbtp: number
  measuredAt: string
  standard: 'EBU R128 / ITU-R BS.1770'
  conformance: LoudnessConformance
}

interface NativeLoudnessMeasurement {
  integratedLufs: number
  loudnessRangeLu: number
  truePeakDbtp?: number
  /** Compatibility with render jobs created before E8. */
  truePeakDbfs?: number
}

export async function measureRenderedLoudness(outputPath: string, profileId: AudioDeliveryProfileId = 'web-video'): Promise<LoudnessMeasurement | undefined> {
  if (!isTauri()) return undefined
  const result = await invoke<NativeLoudnessMeasurement>('measure_rendered_loudness', { outputPath })
  const truePeakDbtp = result.truePeakDbtp ?? result.truePeakDbfs
  if (!Number.isFinite(result.integratedLufs) || !Number.isFinite(result.loudnessRangeLu) || !Number.isFinite(truePeakDbtp)) throw new Error('완성 파일의 러드니스 측정 결과가 올바르지 않습니다.')
  return {
    integratedLufs: result.integratedLufs,
    loudnessRangeLu: result.loudnessRangeLu,
    truePeakDbtp: truePeakDbtp!,
    measuredAt: new Date().toISOString(),
    standard: 'EBU R128 / ITU-R BS.1770',
    conformance: evaluateLoudnessConformance({ integratedLufs: result.integratedLufs, truePeakDbtp: truePeakDbtp! }, profileId),
  }
}

export function normalizeLoudnessMeasurement(value: unknown, fallbackProfile: AudioDeliveryProfileId = 'web-video'): LoudnessMeasurement | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<LoudnessMeasurement> & { truePeakDbfs?: number }
  const truePeakDbtp = Number.isFinite(candidate.truePeakDbtp) ? candidate.truePeakDbtp! : candidate.truePeakDbfs
  if (!Number.isFinite(candidate.integratedLufs) || !Number.isFinite(candidate.loudnessRangeLu) || !Number.isFinite(truePeakDbtp)) return undefined
  const profileId = normalizeAudioDeliveryProfileId(candidate.conformance?.profileId ?? fallbackProfile)
  return {
    integratedLufs: candidate.integratedLufs!, loudnessRangeLu: candidate.loudnessRangeLu!, truePeakDbtp: truePeakDbtp!,
    measuredAt: typeof candidate.measuredAt === 'string' ? candidate.measuredAt : new Date(0).toISOString(),
    standard: 'EBU R128 / ITU-R BS.1770',
    conformance: evaluateLoudnessConformance({ integratedLufs: candidate.integratedLufs!, truePeakDbtp: truePeakDbtp! }, profileId),
  }
}
