import { useState, useEffect } from 'react'
import { getTapes, startRecording, stopRecording, pauseRecording, resumeRecording } from '../api'
import { msToHms } from '../utils'

export default function RecordingSession({ wsStatus, obsConnected }) {
  const [tapes, setTapes] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [error, setError] = useState('')

  const isRecording = wsStatus?.is_recording || false
  const isPaused = wsStatus?.is_paused || false
  const durationMs = wsStatus?.duration_ms || 0
  const recordingTapeId = wsStatus?.tape_id ?? null

  useEffect(() => {
    getTapes('pending').then((data) => setTapes(data || []))
  }, [])

  // Reload pending tapes when recording stops
  useEffect(() => {
    if (!isRecording) {
      getTapes('pending').then((data) => setTapes(data || []))
    }
  }, [isRecording])

  const selectedTape = tapes.find((t) => t.id === Number(selectedId)) || null
  const expectedMs = selectedTape?.duration_minutes ? selectedTape.duration_minutes * 60 * 1000 : null
  const isOvertime = expectedMs !== null && durationMs > expectedMs
  const progressPct = expectedMs ? Math.min((durationMs / expectedMs) * 100, 100) : 0

  const differentTapeRecording = isRecording && recordingTapeId !== null && recordingTapeId !== Number(selectedId)
  const thisRecording = isRecording && recordingTapeId === Number(selectedId)

  async function handleStart() {
    if (!selectedId) return
    try {
      await startRecording(Number(selectedId))
      setError('')
    } catch (e) {
      setError(e.message || 'Failed to start recording')
    }
  }

  async function handleStop() {
    try {
      await stopRecording()
      setError('')
    } catch (e) {
      setError(e.message || 'Failed to stop recording')
    }
  }

  async function handlePause() {
    try {
      await pauseRecording()
    } catch (e) {
      setError(e.message || 'Failed to pause')
    }
  }

  async function handleResume() {
    try {
      await resumeRecording()
    } catch (e) {
      setError(e.message || 'Failed to resume')
    }
  }

  return (
    <div className="page">
      {error && (
        <div className="alert-banner warning" style={{ marginBottom: 16 }}>
          {error}
          <button className="small" style={{ marginLeft: 12 }} onClick={() => setError('')}>✕</button>
        </div>
      )}

      {differentTapeRecording && (
        <div className="alert-banner warning" style={{ marginBottom: 16 }}>
          A recording is in progress for a different tape. Stop it before starting a new one.
        </div>
      )}

      <div className="two-col">
        <div>
          <div className="section">
            <div className="section-title">Select Tape</div>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} disabled={isRecording}>
              <option value="">— Choose a pending tape —</option>
              {tapes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}{t.duration_minutes ? ` (${t.duration_minutes}m)` : ''}
                </option>
              ))}
            </select>
          </div>

          {selectedTape && (
            <div className="card section">
              <div className="card-title">Tape Details</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{selectedTape.label}</div>
              {selectedTape.description && (
                <div style={{ color: 'var(--text-dim)', marginBottom: 4, fontSize: 13 }}>
                  {selectedTape.description}
                </div>
              )}
              {selectedTape.duration_minutes && (
                <div style={{ fontSize: 13 }}>Duration: {selectedTape.duration_minutes} min</div>
              )}
              {selectedTape.content_date && (
                <div style={{ fontSize: 13 }}>Date: {selectedTape.content_date}</div>
              )}
              {selectedTape.notes && (
                <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6 }}>
                  {selectedTape.notes}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <div className="section">
            <div className="section-title">Recording Controls</div>
            <div className={`timer${isOvertime ? ' overtime' : ''}`} style={{ marginBottom: 16 }}>
              {msToHms(durationMs)}
            </div>

            {expectedMs && (
              <div style={{ marginBottom: 16 }}>
                <div className="progress-bar">
                  <div
                    className={`progress-fill${isOvertime ? ' overtime' : ''}`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div style={{ fontSize: 12, color: isOvertime ? 'var(--recording)' : 'var(--text-dim)', marginTop: 4 }}>
                  {isOvertime ? 'OVERTIME — ' : ''}
                  {msToHms(durationMs)} / {msToHms(expectedMs)}
                </div>
              </div>
            )}

            <div className="action-row">
              <button
                className="primary"
                disabled={!obsConnected || !selectedId || isRecording || differentTapeRecording}
                onClick={handleStart}
              >
                ● Start Recording
              </button>

              {thisRecording && !isPaused && (
                <button onClick={handlePause}>⏸ Pause</button>
              )}
              {thisRecording && isPaused && (
                <button className="primary" onClick={handleResume}>▶ Resume</button>
              )}

              <button
                className="danger"
                disabled={!thisRecording}
                onClick={handleStop}
              >
                ■ Stop & Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
