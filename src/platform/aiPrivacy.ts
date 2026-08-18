export interface AiPrivacySettings {
  externalComfyUiAllowed: boolean
  transcriptionQuality: 'fast' | 'balanced' | 'accurate'
  updatedAt?: string
}

const STORAGE_KEY = 'editweave.ai-privacy.v1'

export function readAiPrivacySettings(): AiPrivacySettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<AiPrivacySettings>
    const transcriptionQuality = parsed.transcriptionQuality === 'fast' || parsed.transcriptionQuality === 'accurate' ? parsed.transcriptionQuality : 'balanced'
    return { externalComfyUiAllowed: parsed.externalComfyUiAllowed === true, transcriptionQuality, updatedAt: parsed.updatedAt }
  } catch {
    return { externalComfyUiAllowed: false, transcriptionQuality: 'balanced' }
  }
}

export function writeAiPrivacySettings(settings: AiPrivacySettings): AiPrivacySettings {
  const next = { ...settings, updatedAt: new Date().toISOString() }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // The current session still honors the choice when durable storage is unavailable.
  }
  return next
}
