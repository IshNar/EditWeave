import { Archive, BrainCircuit, Clock3, Cloud, Download, FileInput, FilePlus2, FolderOpen, GitCompareArrows, HardDrive, History, Keyboard, LayoutPanelTop, ListVideo, MessageSquare, Mic2, PackageOpen, Redo2, RefreshCw, RotateCcw, Save, SaveAll, ShieldCheck, SlidersHorizontal, Smartphone, Undo2, X } from 'lucide-react'
import type { AspectRatio, ProjectSequence, SequencePreset } from '../editor/types'
import type { RecentProjectEntry } from '../platform/recentProjects'
import type { WorkspaceDimensions, WorkspacePreferences, WorkspacePresetId } from '../platform/workspaceLayouts'

interface TopbarProps {
  projectName: string
  onProjectNameChange: (name: string) => void
  aspectRatio: AspectRatio
  presets: SequencePreset[]
  onAspectRatioChange: (ratio: AspectRatio) => void
  sequences: ProjectSequence[]
  activeSequenceId: string
  onSequenceChange: (id: string) => void
  onSequenceManager: () => void
  onCreateShorts: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  saveState: string
  onOpenProject: () => void
  recentProjects: RecentProjectEntry[]
  onOpenRecentProject: (path: string) => void
  onRemoveRecentProject: (path: string) => void
  onNewProject: () => void
  onSaveProject: () => void
  onSaveProjectAs: () => void
  onArchiveProject: () => void
  onImportExchange: () => void
  archivingProject?: boolean
  onHistory: () => void
  onCheckUpdate: () => void
  checkingUpdate?: boolean
  onExport: () => void
  isExporting?: boolean
  renderQueueCount: number
  onRenderQueue: () => void
  onShortcuts: () => void
  onAudioMixer: () => void
  onVoiceover: () => void
  onReview: () => void
  onAiPrivacy: () => void
  onAiActivity: () => void
  aiActivityCount: number
  onCreatorPacks: () => void
  onScratchDisks: () => void
  staleSequenceIds: Set<string>
  onRefreshDerived: () => void
  onSourceGraphBatch: () => void
  workspace: WorkspacePreferences
  onWorkspacePreset: (preset: WorkspacePresetId) => void
  onWorkspaceResize: (patch: Partial<WorkspaceDimensions>) => void
  onSaveCustomWorkspace: () => void
}

export function Topbar({
  projectName,
  onProjectNameChange,
  aspectRatio,
  presets,
  onAspectRatioChange,
  sequences,
  activeSequenceId,
  onSequenceChange,
  onSequenceManager,
  onCreateShorts,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  saveState,
  onOpenProject,
  recentProjects,
  onOpenRecentProject,
  onRemoveRecentProject,
  onNewProject,
  onSaveProject,
  onSaveProjectAs,
  onArchiveProject,
  onImportExchange,
  archivingProject = false,
  onHistory,
  onCheckUpdate,
  checkingUpdate = false,
  onExport,
  isExporting = false,
  renderQueueCount,
  onRenderQueue,
  onShortcuts,
  onAudioMixer,
  onVoiceover,
  onReview,
  onAiPrivacy,
  onAiActivity,
  aiActivityCount,
  onCreatorPacks,
  onScratchDisks,
  staleSequenceIds,
  onRefreshDerived,
  onSourceGraphBatch,
  workspace,
  onWorkspacePreset,
  onWorkspaceResize,
  onSaveCustomWorkspace,
}: TopbarProps) {
  return (
    <header className="topbar">
      <div className="brand" aria-label="EditWeave">
        <span className="brand-mark">C</span>
        <span>editweave</span>
      </div>

      <div className="project-meta">
        <input
          className="project-name"
          aria-label="프로젝트 이름"
          value={projectName}
          onChange={(event) => onProjectNameChange(event.target.value)}
        />
        <span className="save-state"><Cloud size={13} /> {saveState}</span>
      </div>

      <div className="topbar-actions">
        <div className="file-actions" aria-label="프로젝트 파일">
          <button className="icon-button" onClick={onNewProject} aria-label="새 프로젝트" title="새 프로젝트">
            <FilePlus2 size={17} />
          </button>
          <button className="icon-button" onClick={onOpenProject} aria-label="프로젝트 열기" title="프로젝트 열기">
            <FolderOpen size={17} />
          </button>
          <details className="recent-projects"><summary className="icon-button" aria-label="최근 프로젝트" title="최근 프로젝트"><Clock3 size={16} /></summary><div className="recent-project-menu"><strong>최근 프로젝트</strong>{recentProjects.map((project) => <div key={project.path}><button className="recent-project-open" onClick={() => onOpenRecentProject(project.path)} title={project.path}><span>{project.name}</span><small>{project.path}</small></button><button className="recent-project-remove" onClick={() => onRemoveRecentProject(project.path)} aria-label={`${project.name} 최근 목록에서 제거`}><X size={11} /></button></div>)}{!recentProjects.length && <small>저장하거나 연 프로젝트가 여기에 표시됩니다.</small>}</div></details>
          <button className="icon-button" onClick={onSaveProject} aria-label="프로젝트 저장" title="프로젝트 저장 (Ctrl/Cmd+S)">
            <Save size={17} />
          </button>
          <button className="icon-button" onClick={onSaveProjectAs} aria-label="다른 이름으로 프로젝트 저장" title="다른 이름으로 저장"><SaveAll size={16} /></button>
          <button className="icon-button" onClick={onArchiveProject} disabled={archivingProject} aria-label="프로젝트 아카이브" title="프로젝트 파일·원본·프록시를 이동 가능한 한 폴더로 수집"><Archive size={16} className={archivingProject ? 'spin' : ''} /></button>
          <button className="icon-button" onClick={onImportExchange} aria-label="편집 교환 파일 가져오기" title="OTIO·Premiere Pro XML·FCPXML·CMX 3600 EDL을 새 시퀀스로 가져오기"><FileInput size={16} /></button>
          <button className="icon-button" onClick={onHistory} aria-label="버전 기록" title="자동 저장 버전 기록"><History size={17} /></button>
          <button className="icon-button" onClick={onCheckUpdate} disabled={checkingUpdate} aria-label="업데이트 확인" title="업데이트 확인"><RefreshCw size={17} className={checkingUpdate ? 'spin' : ''} /></button>
          <button className={`icon-button render-queue-button ${isExporting ? 'active' : ''}`} onClick={onRenderQueue} aria-label="렌더 작업" title="렌더 작업"><ListVideo size={17} />{renderQueueCount > 0 && <small>{Math.min(99, renderQueueCount)}</small>}</button>
          <button className="icon-button" onClick={onShortcuts} aria-label="키보드 단축키" title="키보드 단축키"><Keyboard size={17} /></button>
          <button className="icon-button" onClick={onAudioMixer} aria-label="오디오 믹서" title="오디오 믹서"><SlidersHorizontal size={17} /></button>
          <button className="icon-button" onClick={onVoiceover} aria-label="보이스오버 녹음" title="재생 헤드에서 ADR·보이스오버 녹음"><Mic2 size={17} /></button>
          <button className="icon-button" onClick={onReview} aria-label="검토 코멘트" title="타임코드 검토 코멘트"><MessageSquare size={17} /></button>
          <button className="icon-button" onClick={onCreatorPacks} aria-label="Creator Pack" title="안전한 템플릿 확장 Pack"><PackageOpen size={17} /></button>
          <button className="icon-button" onClick={onScratchDisks} aria-label="스크래치 디스크" title="프록시·녹음·렌더 캐시 저장 위치"><HardDrive size={17} /></button>
          <button className="icon-button" onClick={onAiPrivacy} aria-label="AI 데이터 설정" title="AI 처리 위치와 데이터 보관"><ShieldCheck size={17} /></button>
          <button className="icon-button render-queue-button" onClick={onAiActivity} aria-label="AI 활동 기록" title="AI 입력·처리 위치·변경·Undo 기록"><BrainCircuit size={17} />{aiActivityCount > 0 && <small>{Math.min(99, aiActivityCount)}</small>}</button>
        </div>
        <div className="history-actions" aria-label="편집 기록">
          <button className="icon-button" onClick={onUndo} disabled={!canUndo} aria-label="실행 취소" title="실행 취소 (Ctrl/Cmd+Z)">
            <Undo2 size={17} />
          </button>
          <button className="icon-button" onClick={onRedo} disabled={!canRedo} aria-label="다시 실행" title="다시 실행 (Ctrl/Cmd+Shift+Z)">
            <Redo2 size={17} />
          </button>
        </div>

        <details className="workspace-menu">
          <summary className="icon-button" aria-label="작업공간" title="작업공간 레이아웃"><LayoutPanelTop size={17} /></summary>
          <div className="workspace-menu-popover">
            <header><div><strong>작업공간</strong><small>현재 구성은 자동 저장됩니다.</small></div><LayoutPanelTop size={16} /></header>
            <label className="workspace-preset-control">
              <span>레이아웃</span>
              <select value={workspace.preset} onChange={(event) => onWorkspacePreset(event.target.value as WorkspacePresetId)}>
                <option value="editing">편집</option>
                <option value="color">컬러</option>
                <option value="audio">오디오</option>
                <option value="captions">자막</option>
                <option value="custom">사용자</option>
              </select>
            </label>
            <label><span>미디어 패널 <b>{workspace.mediaWidth}px</b></span><input type="range" min="280" max="460" step="2" value={workspace.mediaWidth} onChange={(event) => onWorkspaceResize({ mediaWidth: Number(event.target.value) })} /></label>
            <label><span>인스펙터 <b>{workspace.inspectorWidth}px</b></span><input type="range" min="280" max="480" step="2" value={workspace.inspectorWidth} onChange={(event) => onWorkspaceResize({ inspectorWidth: Number(event.target.value) })} /></label>
            <label><span>타임라인 <b>{workspace.timelinePercent}%</b></span><input type="range" min="32" max="68" step="1" value={workspace.timelinePercent} onChange={(event) => onWorkspaceResize({ timelinePercent: Number(event.target.value) })} /></label>
            <div className="workspace-menu-actions">
              <button onClick={() => onWorkspacePreset('editing')}><RotateCcw size={12} /> 기본값</button>
              <button className="save" onClick={onSaveCustomWorkspace}><Save size={12} /> 사용자로 저장</button>
            </div>
          </div>
        </details>

        <label className="ratio-control">
          <span>캔버스</span>
          <select value={aspectRatio} onChange={(event) => onAspectRatioChange(event.target.value as AspectRatio)}>
            {presets.map((preset) => (
              <option key={preset.ratio} value={preset.ratio}>
                {preset.ratio} · {preset.label}
              </option>
            ))}
          </select>
        </label>

        <label className="sequence-control">
          <span>시퀀스</span>
          <select value={activeSequenceId} onChange={(event) => onSequenceChange(event.target.value)} aria-label="활성 시퀀스">
            {sequences.map((sequence) => <option key={sequence.id} value={sequence.id}>{sequence.kind === 'shorts' ? 'Shorts · ' : sequence.kind === 'nested' ? 'Nested · ' : sequence.kind === 'multicam' ? 'MultiCam · ' : ''}{sequence.name}{staleSequenceIds.has(sequence.id) ? ' · 업데이트 있음' : ''}</option>)}
          </select>
        </label>
        <button className="icon-button sequence-manager-trigger" onClick={onSequenceManager} aria-label="시퀀스 관리" title="시퀀스 생성·이름 변경·복제·삭제"><ListVideo size={16} /></button>

        {staleSequenceIds.size > 0 && <button className="derived-refresh-button" onClick={onSourceGraphBatch}><GitCompareArrows size={13} /> 파생물 {staleSequenceIds.size}개 변경</button>}
        {staleSequenceIds.has(activeSequenceId) && <button className="derived-refresh-button" onClick={onRefreshDerived}><RefreshCw size={13} /> 현재 항목 반영</button>}

        <button className="shorts-button" onClick={onCreateShorts}><Smartphone size={15} /> 쇼츠 만들기</button>

        <button className="primary-button" onClick={onExport} disabled={isExporting}>
          <Download size={16} /> {isExporting ? '출력 중…' : '내보내기'}
        </button>
      </div>
    </header>
  )
}
