export interface BiquadCoefficients {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

export const AUDIO_EQ_FREQUENCIES = { low: 220, mid: 1_200, high: 4_200, voice: 2_400 } as const
export const AUDIO_EQ_Q = { highpass: 1, mid: 0.75, voice: 0.8 } as const

export function stereoPanSample(left: number, right: number, pan: number, mono: boolean): { left: number; right: number } {
  const position = Math.max(-1, Math.min(1, pan))
  if (mono) {
    const normalized = (position + 1) / 2
    return {
      left: left * Math.cos(normalized * Math.PI / 2),
      right: left * Math.sin(normalized * Math.PI / 2),
    }
  }
  const normalized = position <= 0 ? position + 1 : position
  const gainLeft = Math.cos(normalized * Math.PI / 2)
  const gainRight = Math.sin(normalized * Math.PI / 2)
  return position <= 0
    ? { left: left + right * gainLeft, right: right * gainRight }
    : { left: left * gainLeft, right: right + left * gainRight }
}

export interface BiquadState {
  x1: number
  x2: number
  y1: number
  y2: number
}

export function createBiquadState(): BiquadState {
  return { x1: 0, x2: 0, y1: 0, y2: 0 }
}

export function processBiquad(value: number, coefficients: BiquadCoefficients, state: BiquadState): number {
  const output = coefficients.b0 * value + coefficients.b1 * state.x1 + coefficients.b2 * state.x2 - coefficients.a1 * state.y1 - coefficients.a2 * state.y2
  state.x2 = state.x1
  state.x1 = value
  state.y2 = state.y1
  state.y1 = Number.isFinite(output) ? output : 0
  return state.y1
}

export function highpassBiquad(sampleRate: number, frequency: number, q = 1): BiquadCoefficients {
  const { cosine, alpha } = common(sampleRate, frequency, q)
  const a0 = 1 + alpha
  return normalize({
    b0: (1 + cosine) / 2,
    b1: -(1 + cosine),
    b2: (1 + cosine) / 2,
    a0,
    a1: -2 * cosine,
    a2: 1 - alpha,
  })
}

export function lowpassBiquad(sampleRate: number, frequency: number, q = Math.SQRT1_2): BiquadCoefficients {
  const { cosine, alpha } = common(sampleRate, frequency, q)
  const a0 = 1 + alpha
  return normalize({
    b0: (1 - cosine) / 2,
    b1: 1 - cosine,
    b2: (1 - cosine) / 2,
    a0,
    a1: -2 * cosine,
    a2: 1 - alpha,
  })
}

export function peakingBiquad(sampleRate: number, frequency: number, q: number, gainDb: number): BiquadCoefficients {
  const { cosine, alpha } = common(sampleRate, frequency, q)
  const amplitude = 10 ** (Math.max(-36, Math.min(36, gainDb)) / 40)
  return normalize({
    b0: 1 + alpha * amplitude,
    b1: -2 * cosine,
    b2: 1 - alpha * amplitude,
    a0: 1 + alpha / amplitude,
    a1: -2 * cosine,
    a2: 1 - alpha / amplitude,
  })
}

export function lowShelfBiquad(sampleRate: number, frequency: number, gainDb: number): BiquadCoefficients {
  const { cosine, sine } = common(sampleRate, frequency, 1)
  const amplitude = 10 ** (Math.max(-36, Math.min(36, gainDb)) / 40)
  const beta = Math.SQRT2 * Math.sqrt(amplitude) * sine
  return normalize({
    b0: amplitude * ((amplitude + 1) - (amplitude - 1) * cosine + beta),
    b1: 2 * amplitude * ((amplitude - 1) - (amplitude + 1) * cosine),
    b2: amplitude * ((amplitude + 1) - (amplitude - 1) * cosine - beta),
    a0: (amplitude + 1) + (amplitude - 1) * cosine + beta,
    a1: -2 * ((amplitude - 1) + (amplitude + 1) * cosine),
    a2: (amplitude + 1) + (amplitude - 1) * cosine - beta,
  })
}

export function highShelfBiquad(sampleRate: number, frequency: number, gainDb: number): BiquadCoefficients {
  const { cosine, sine } = common(sampleRate, frequency, 1)
  const amplitude = 10 ** (Math.max(-36, Math.min(36, gainDb)) / 40)
  const beta = Math.SQRT2 * Math.sqrt(amplitude) * sine
  return normalize({
    b0: amplitude * ((amplitude + 1) + (amplitude - 1) * cosine + beta),
    b1: -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosine),
    b2: amplitude * ((amplitude + 1) + (amplitude - 1) * cosine - beta),
    a0: (amplitude + 1) - (amplitude - 1) * cosine + beta,
    a1: 2 * ((amplitude - 1) - (amplitude + 1) * cosine),
    a2: (amplitude + 1) - (amplitude - 1) * cosine - beta,
  })
}

function common(sampleRate: number, frequency: number, q: number): { cosine: number; sine: number; alpha: number } {
  const safeRate = Math.max(8_000, sampleRate)
  const safeFrequency = Math.max(1, Math.min(safeRate * 0.49, frequency))
  const omega = 2 * Math.PI * safeFrequency / safeRate
  const sine = Math.sin(omega)
  return { cosine: Math.cos(omega), sine, alpha: sine / (2 * Math.max(0.0001, q)) }
}

function normalize(value: { b0: number; b1: number; b2: number; a0: number; a1: number; a2: number }): BiquadCoefficients {
  const divisor = Math.abs(value.a0) > 1e-12 ? value.a0 : 1
  return {
    b0: value.b0 / divisor,
    b1: value.b1 / divisor,
    b2: value.b2 / divisor,
    a1: value.a1 / divisor,
    a2: value.a2 / divisor,
  }
}
