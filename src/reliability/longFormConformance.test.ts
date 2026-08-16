import { describe, expect, it } from 'vitest'
import { appendHistorySnapshot, redoHistorySnapshot, undoHistorySnapshot } from '../editor/history'
import { parseProjectDocument } from '../editor/project'
import { removeTimelineRange } from '../editor/timelineOps'
import { createLongFormConformanceProject, evaluateLongFormConformance } from './longFormConformance'

describe('10·30·60 minute project conformance', () => {
  it.each([10, 30, 60] as const)('%d minute project survives a full JSON save/open round trip', (minutes) => {
    const project = createLongFormConformanceProject({ minutes, fps: 30 })
    const started = performance.now()
    const raw = JSON.stringify(project)
    const restored = parseProjectDocument(raw)
    const elapsed = performance.now() - started
    const result = evaluateLongFormConformance(restored)
    console.info(`LONG_FORM_CONFORMANCE ${minutes}m fps=30 clips=${result.clipCount} bytes=${raw.length} roundtrip=${elapsed.toFixed(2)}ms drift=${result.maxAvDriftFrames}f`)
    expect(result).toMatchObject({ minutes, fps: 30, brokenLinkCount: 0, maxAvDriftFrames: 0, endFrame: minutes * 60 * 30 })
    expect(result.maxFrameAlignmentError).toBeLessThan(1e-7)
    expect(elapsed).toBeLessThan(5_000)
    expect(raw.length).toBeLessThan(50_000_000)
  })

  it.each([23.976, 29.97, 59.94])('holds linked A/V to zero-frame drift at %s fps for 60 minutes', (fps) => {
    const project = parseProjectDocument(JSON.stringify(createLongFormConformanceProject({ minutes: 60, fps, segmentSeconds: 10 })))
    const result = evaluateLongFormConformance(project)
    expect(result.endFrame).toBe(Math.round(60 * 60 * fps))
    expect(result.maxAvDriftFrames).toBe(0)
    expect(result.brokenLinkCount).toBe(0)
    expect(result.maxFrameAlignmentError).toBeLessThan(1e-7)
  })

  it('restores an exact 60-minute compound ripple edit through atomic undo and redo', () => {
    const project = createLongFormConformanceProject({ minutes: 60, fps: 30 })
    const initialTracks = project.tracks
    const editedTracks = removeTimelineRange(initialTracks, 30 * 60, 30 * 60 + 1.25)
    const past = appendHistorySnapshot([], initialTracks)
    const undone = undoHistorySnapshot(past, editedTracks, [])!
    const redone = redoHistorySnapshot(undone.past, undone.value, undone.future)!
    expect(undone.value).toBe(initialTracks)
    expect(redone.value).toBe(editedTracks)
    expect(JSON.stringify(undone.value)).toBe(JSON.stringify(initialTracks))
    expect(evaluateLongFormConformance({ ...project, tracks: undone.value, sequences: project.sequences?.map((sequence) => sequence.id === project.activeSequenceId ? { ...sequence, tracks: undone.value } : sequence) }).maxAvDriftFrames).toBe(0)
  })
})
