import { msToHms } from '../utils'

export default function Dashboard({
  stats,
  nextTape,
  recentTapes,
  wsStatus,
  obsConnected,
  activeTapeLabel,
  onStartRecording,
}) {
  const s = stats || {}
  const isRecording = wsStatus?.is_recording
  const durationMs = wsStatus?.duration_ms || 0

  return (
    <div className="page">
      {isRecording && (
        <div className="alert-banner recording" role="alert">
          <strong>Recording in progress</strong> — {activeTapeLabel || 'Unknown tape'}{' '}
          &nbsp; ⏱ {msToHms(durationMs)}
        </div>
      )}

      <div className="section">
        <div className="stat-grid">
          <div className="card">
            <div className="card-title">Total</div>
            <div className="card-value">{s.total ?? 0}</div>
          </div>
          <div className="card">
            <div className="card-title">Pending</div>
            <div className="card-value">{s.pending ?? 0}</div>
          </div>
          <div className="card">
            <div className="card-title">Done</div>
            <div className="card-value">{s.done ?? 0}</div>
          </div>
          <div className="card">
            <div className="card-title">Skipped</div>
            <div className="card-value">{s.skipped ?? 0}</div>
          </div>
          <div className="card">
            <div className="card-title">Total Runtime</div>
            <div className="card-value">{s.total_minutes ?? 0}</div>
            <div className="card-sub">minutes</div>
          </div>
          <div className="card">
            <div className="card-title">Digitized</div>
            <div className="card-value">{s.done_minutes ?? 0}</div>
            <div className="card-sub">minutes</div>
          </div>
        </div>
      </div>

      <div className="section card">
        <div className="section-title">
          Progress — {s.pct_complete ?? 0}% complete
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${s.pct_complete ?? 0}%` }} />
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-dim)' }}>
          {s.done_minutes ?? 0} / {s.total_minutes ?? 0} minutes digitized
        </div>
      </div>

      <div className="two-col section" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-title">Next Pending</div>
          {nextTape ? (
            <>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>{nextTape.label}</div>
              {nextTape.duration_minutes && (
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
                  ~{nextTape.duration_minutes} min
                </div>
              )}
              <button
                className="primary small"
                disabled={!obsConnected || isRecording}
                onClick={() => onStartRecording(nextTape.id)}
              >
                Start Recording
              </button>
            </>
          ) : (
            <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>No pending tapes</div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Recently Digitized</div>
          {recentTapes && recentTapes.length > 0 ? (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {recentTapes.slice(0, 5).map((t) => (
                <li key={t.id} style={{ padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                  {t.label}
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>Nothing yet</div>
          )}
        </div>
      </div>
    </div>
  )
}
