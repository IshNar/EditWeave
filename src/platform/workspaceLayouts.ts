export type WorkspacePresetId = 'editing' | 'color' | 'audio' | 'captions' | 'custom'

export interface WorkspaceDimensions {
  mediaWidth: number
  inspectorWidth: number
  timelinePercent: number
}

export interface WorkspacePreferences extends WorkspaceDimensions {
  preset: WorkspacePresetId
  savedCustom?: WorkspaceDimensions
}

export const workspacePresets: Record<Exclude<WorkspacePresetId, 'custom'>, WorkspaceDimensions> = {
  editing: { mediaWidth: 320, inspectorWidth: 300, timelinePercent: 48 },
  color: { mediaWidth: 280, inspectorWidth: 380, timelinePercent: 40 },
  audio: { mediaWidth: 280, inspectorWidth: 340, timelinePercent: 58 },
  captions: { mediaWidth: 380, inspectorWidth: 300, timelinePercent: 48 },
}

const storageKey = 'editweave.workspace.preferences.v1'

function clampDimensions(value: Partial<WorkspaceDimensions> | undefined, fallback: WorkspaceDimensions): WorkspaceDimensions {
  return {
    mediaWidth: Math.round(Math.max(280, Math.min(460, Number(value?.mediaWidth) || fallback.mediaWidth))),
    inspectorWidth: Math.round(Math.max(280, Math.min(480, Number(value?.inspectorWidth) || fallback.inspectorWidth))),
    timelinePercent: Math.round(Math.max(32, Math.min(68, Number(value?.timelinePercent) || fallback.timelinePercent))),
  }
}

export function readWorkspacePreferences(): WorkspacePreferences {
  const fallback = workspacePresets.editing
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Partial<WorkspacePreferences>
    const preset: WorkspacePresetId = stored.preset === 'color' || stored.preset === 'audio' || stored.preset === 'captions' || stored.preset === 'custom' ? stored.preset : 'editing'
    const presetFallback = preset === 'custom' ? fallback : workspacePresets[preset]
    const dimensions = preset === 'custom' ? clampDimensions(stored, presetFallback) : presetFallback
    return {
      preset,
      ...dimensions,
      savedCustom: stored.savedCustom ? clampDimensions(stored.savedCustom, fallback) : undefined,
    }
  } catch {
    return { preset: 'editing', ...fallback }
  }
}

export function writeWorkspacePreferences(preferences: WorkspacePreferences): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferences))
  } catch {
    // 저장 공간을 사용할 수 없는 환경에서도 현재 세션 레이아웃은 유지합니다.
  }
}

export function applyWorkspacePreset(preferences: WorkspacePreferences, preset: WorkspacePresetId): WorkspacePreferences {
  if (preset === 'custom') {
    const dimensions = preferences.savedCustom ?? {
      mediaWidth: preferences.mediaWidth,
      inspectorWidth: preferences.inspectorWidth,
      timelinePercent: preferences.timelinePercent,
    }
    return { ...preferences, preset, ...dimensions }
  }
  return { ...preferences, preset, ...workspacePresets[preset] }
}

export function updateWorkspaceDimensions(preferences: WorkspacePreferences, patch: Partial<WorkspaceDimensions>): WorkspacePreferences {
  return { ...preferences, preset: 'custom', ...clampDimensions({ ...preferences, ...patch }, workspacePresets.editing) }
}
