import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

export type EditorCommand = 'playPause' | 'shuttleReverse' | 'shuttleStop' | 'shuttleForward' | 'previousEdit' | 'nextEdit' | 'selectedClipStart' | 'selectedClipEnd' | 'selectEditPoint' | 'applyDefaultVideoTransition' | 'applyDefaultAudioTransition' | 'removeTransitions' | 'split' | 'addEditTarget' | 'addEditAll' | 'toggleSnap' | 'toggleLinkedSelection' | 'groupClips' | 'ungroupClips' | 'nestClips' | 'selectionTool' | 'razorTool' | 'handTool' | 'zoomTool' | 'rippleTrimTool' | 'rollTrimTool' | 'slipTool' | 'slideTool' | 'rateStretchTool' | 'trackSelectForward' | 'trackSelectBackward' | 'allTracksSelectForward' | 'allTracksSelectBackward' | 'delete' | 'toggleClipEnabled' | 'rippleDelete' | 'closeGap' | 'liftWorkArea' | 'extractWorkArea' | 'selectAllClips' | 'clearSelection' | 'cutClips' | 'copyClips' | 'pasteClips' | 'pasteAttributes' | 'duplicateClips' | 'duplicateTrack' | 'renderAndReplace' | 'nudgeClipBack' | 'nudgeClipForward' | 'marker' | 'markIn' | 'markOut' | 'clearInOut' | 'matchFrame' | 'reverseMatchFrame' | 'fitToFill' | 'replaceEdit' | 'addSource' | 'insertSource' | 'overwriteSource' | 'frameBack' | 'frameForward' | 'multicam1' | 'multicam2' | 'multicam3' | 'multicam4' | 'multicam5' | 'multicam6' | 'multicam7' | 'multicam8' | 'multicam9' | 'undo' | 'redo' | 'save' | 'saveAs' | 'open'

export type ShortcutMap = Record<EditorCommand, string>

export const shortcutLabels: Array<{ command: EditorCommand; label: string; group: string }> = [
  { command: 'playPause', label: '재생 / 일시정지', group: '재생' },
  { command: 'shuttleReverse', label: '역방향 셔틀', group: '재생' },
  { command: 'shuttleStop', label: '셔틀 정지', group: '재생' },
  { command: 'shuttleForward', label: '정방향 셔틀', group: '재생' },
  { command: 'frameBack', label: '한 프레임 뒤로', group: '재생' },
  { command: 'frameForward', label: '한 프레임 앞으로', group: '재생' },
  { command: 'previousEdit', label: '이전 편집점으로', group: '재생' },
  { command: 'nextEdit', label: '다음 편집점으로', group: '재생' },
  { command: 'selectedClipStart', label: '선택 클립 시작점으로', group: '재생' },
  { command: 'selectedClipEnd', label: '선택 클립 끝점으로', group: '재생' },
  { command: 'selectEditPoint', label: '현재 편집점 선택', group: '타임라인' },
  { command: 'applyDefaultVideoTransition', label: '기본 영상 전환 적용', group: '타임라인' },
  { command: 'applyDefaultAudioTransition', label: '기본 오디오 전환 적용', group: '타임라인' },
  { command: 'removeTransitions', label: '선택 편집점 전환 제거', group: '타임라인' },
  { command: 'markIn', label: '소스/시퀀스 IN 점', group: '소스 편집' },
  { command: 'markOut', label: '소스/시퀀스 OUT 점', group: '소스 편집' },
  { command: 'clearInOut', label: '소스/시퀀스 IN·OUT 지우기', group: '소스 편집' },
  { command: 'matchFrame', label: '선택 클립 Match Frame', group: '소스 편집' },
  { command: 'reverseMatchFrame', label: '소스 Reverse Match Frame', group: '소스 편집' },
  { command: 'fitToFill', label: '4점 Fit to Fill', group: '소스 편집' },
  { command: 'replaceEdit', label: '현재 소스로 선택 클립 교체', group: '소스 편집' },
  { command: 'addSource', label: '선택 소스 추가', group: '소스 편집' },
  { command: 'insertSource', label: '소스 삽입', group: '소스 편집' },
  { command: 'overwriteSource', label: '소스 덮어쓰기', group: '소스 편집' },
  { command: 'split', label: '재생 헤드에서 분할', group: '타임라인' },
  { command: 'addEditTarget', label: '대상 트랙에 편집점 추가', group: '타임라인' },
  { command: 'addEditAll', label: '모든 트랙에 편집점 추가', group: '타임라인' },
  { command: 'toggleSnap', label: '스냅 켜기/끄기', group: '타임라인' },
  { command: 'toggleLinkedSelection', label: '연결 선택 켜기/끄기', group: '타임라인' },
  { command: 'groupClips', label: '선택 클립 그룹', group: '타임라인' },
  { command: 'ungroupClips', label: '선택 클립 그룹 해제', group: '타임라인' },
  { command: 'nestClips', label: '선택 클립 중첩 시퀀스', group: '타임라인' },
  { command: 'selectionTool', label: '선택 도구', group: '타임라인 도구' },
  { command: 'razorTool', label: '면도날 도구', group: '타임라인 도구' },
  { command: 'handTool', label: '손바닥 이동 도구', group: '타임라인 도구' },
  { command: 'zoomTool', label: '확대/축소 도구', group: '타임라인 도구' },
  { command: 'rippleTrimTool', label: '리플 트림 도구', group: '타임라인 도구' },
  { command: 'rollTrimTool', label: '롤 트림 도구', group: '타임라인 도구' },
  { command: 'slipTool', label: '슬립 도구', group: '타임라인 도구' },
  { command: 'slideTool', label: '슬라이드 도구', group: '타임라인 도구' },
  { command: 'rateStretchTool', label: '속도 늘이기 도구', group: '타임라인 도구' },
  { command: 'trackSelectForward', label: '선택 트랙 앞으로 선택', group: '타임라인' },
  { command: 'trackSelectBackward', label: '선택 트랙 뒤로 선택', group: '타임라인' },
  { command: 'allTracksSelectForward', label: '모든 트랙 앞으로 선택', group: '타임라인' },
  { command: 'allTracksSelectBackward', label: '모든 트랙 뒤로 선택', group: '타임라인' },
  { command: 'delete', label: '선택 삭제', group: '타임라인' },
  { command: 'toggleClipEnabled', label: '선택 클립 활성화/비활성화', group: '타임라인' },
  { command: 'rippleDelete', label: '선택 리플 삭제', group: '타임라인' },
  { command: 'closeGap', label: '재생 헤드의 빈 구간 닫기', group: '타임라인' },
  { command: 'liftWorkArea', label: '작업 구간 Lift', group: '타임라인' },
  { command: 'extractWorkArea', label: '작업 구간 Extract', group: '타임라인' },
  { command: 'selectAllClips', label: '모든 클립 선택', group: '타임라인' },
  { command: 'clearSelection', label: '선택 해제', group: '타임라인' },
  { command: 'cutClips', label: '선택 클립 잘라내기', group: '타임라인' },
  { command: 'copyClips', label: '선택 클립 복사', group: '타임라인' },
  { command: 'pasteClips', label: '재생 헤드에 붙여넣기', group: '타임라인' },
  { command: 'pasteAttributes', label: '선택 클립에 속성 붙여넣기', group: '타임라인' },
  { command: 'duplicateClips', label: '선택 클립 복제', group: '타임라인' },
  { command: 'duplicateTrack', label: '선택 트랙 복제', group: '타임라인' },
  { command: 'renderAndReplace', label: 'Render and Replace', group: '타임라인' },
  { command: 'nudgeClipBack', label: '선택 클립 1프레임 뒤로', group: '타임라인' },
  { command: 'nudgeClipForward', label: '선택 클립 1프레임 앞으로', group: '타임라인' },
  { command: 'marker', label: '마커 추가', group: '타임라인' },
  { command: 'multicam1', label: '멀티캠 각도 1', group: '멀티캠' },
  { command: 'multicam2', label: '멀티캠 각도 2', group: '멀티캠' },
  { command: 'multicam3', label: '멀티캠 각도 3', group: '멀티캠' },
  { command: 'multicam4', label: '멀티캠 각도 4', group: '멀티캠' },
  { command: 'multicam5', label: '멀티캠 각도 5', group: '멀티캠' },
  { command: 'multicam6', label: '멀티캠 각도 6', group: '멀티캠' },
  { command: 'multicam7', label: '멀티캠 각도 7', group: '멀티캠' },
  { command: 'multicam8', label: '멀티캠 각도 8', group: '멀티캠' },
  { command: 'multicam9', label: '멀티캠 각도 9', group: '멀티캠' },
  { command: 'undo', label: '실행 취소', group: '프로젝트' },
  { command: 'redo', label: '다시 실행', group: '프로젝트' },
  { command: 'save', label: '프로젝트 저장', group: '프로젝트' },
  { command: 'saveAs', label: '다른 이름으로 저장', group: '프로젝트' },
  { command: 'open', label: '프로젝트 열기', group: '프로젝트' },
]

export const defaultShortcuts: ShortcutMap = {
  playPause: 'Space', shuttleReverse: 'J', shuttleStop: 'K', shuttleForward: 'L', frameBack: 'ArrowLeft', frameForward: 'ArrowRight', previousEdit: 'ArrowUp', nextEdit: 'ArrowDown', selectedClipStart: 'Shift+ArrowUp', selectedClipEnd: 'Shift+ArrowDown', selectEditPoint: 'Shift+E', applyDefaultVideoTransition: 'Mod+D', applyDefaultAudioTransition: 'Mod+Shift+D', removeTransitions: 'Mod+Alt+Shift+D', markIn: 'I', markOut: 'O', clearInOut: 'Mod+Shift+X', matchFrame: 'F', reverseMatchFrame: 'Shift+F', fitToFill: 'Shift+R', replaceEdit: '', addSource: 'Enter', insertSource: ',', overwriteSource: '.', split: 'S', addEditTarget: 'Mod+K', addEditAll: 'Mod+Shift+K', toggleSnap: 'Shift+S', toggleLinkedSelection: 'Shift+L', groupClips: 'Mod+G', ungroupClips: 'Mod+Shift+G', nestClips: 'Mod+Alt+G', selectionTool: 'V', razorTool: 'C', handTool: 'H', zoomTool: 'Z', rippleTrimTool: 'B', rollTrimTool: 'N', slipTool: 'Y', slideTool: 'U', rateStretchTool: 'R', trackSelectForward: 'A', trackSelectBackward: 'Shift+A', allTracksSelectForward: 'Alt+A', allTracksSelectBackward: 'Alt+Shift+A', delete: 'Delete', toggleClipEnabled: 'Mod+Shift+E', rippleDelete: 'Shift+Delete', closeGap: 'Mod+Backspace', liftWorkArea: ';', extractWorkArea: "'", selectAllClips: 'Mod+A', clearSelection: 'Escape', cutClips: 'Mod+X', copyClips: 'Mod+C', pasteClips: 'Mod+V', pasteAttributes: 'Mod+Alt+V', duplicateClips: 'Mod+Alt+D', duplicateTrack: '', renderAndReplace: '', nudgeClipBack: 'Alt+ArrowLeft', nudgeClipForward: 'Alt+ArrowRight', marker: 'M', multicam1: '1', multicam2: '2', multicam3: '3', multicam4: '4', multicam5: '5', multicam6: '6', multicam7: '7', multicam8: '8', multicam9: '9', undo: 'Mod+Z', redo: 'Mod+Shift+Z', save: 'Mod+S', saveAs: 'Mod+Shift+S', open: 'Mod+O',
}

const KEY = 'editweave.shortcuts.v1'

export function readShortcuts(): ShortcutMap {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ShortcutMap>
    const migrated = { ...value }
    if (migrated.duplicateClips === 'Mod+D' && migrated.applyDefaultVideoTransition === undefined) migrated.duplicateClips = defaultShortcuts.duplicateClips
    return { ...defaultShortcuts, ...migrated }
  } catch {
    return { ...defaultShortcuts }
  }
}

export function writeShortcuts(shortcuts: ShortcutMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(shortcuts))
  } catch {
    // The active session still uses the selected shortcuts.
  }
}

export function shortcutFromEvent(event: KeyboardEvent | ReactKeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Mod')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  let key = event.key
  if (key === ' ') key = 'Space'
  else if (key.length === 1) key = key.toUpperCase()
  if (!['Control', 'Meta', 'Alt', 'Shift'].includes(key)) parts.push(key)
  return parts.join('+')
}

export function commandFromEvent(event: KeyboardEvent, shortcuts: ShortcutMap): EditorCommand | undefined {
  const binding = shortcutFromEvent(event)
  return shortcutLabels.find(({ command }) => shortcuts[command] === binding)?.command
}
