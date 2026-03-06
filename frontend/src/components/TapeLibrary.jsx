import { useState, useEffect, useCallback } from 'react'
import { getTapes, createTape, updateTape, deleteTape, startRecording } from '../api'

const STATUSES = ['all', 'pending', 'recording', 'done', 'skipped']

function TapeModal({ tape, onSave, onClose }) {
  const [form, setForm] = useState({
    label: tape?.label || '',
    description: tape?.description || '',
    duration_minutes: tape?.duration_minutes || '',
    content_date: tape?.content_date || '',
    notes: tape?.notes || '',
  })
  const [error, setError] = useState('')

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function submit(e) {
    e.preventDefault()
    if (!form.label.trim()) { setError('Label is required'); return }
    const payload = {
      label: form.label.trim(),
      description: form.description || null,
      duration_minutes: form.duration_minutes ? parseInt(form.duration_minutes, 10) : null,
      content_date: form.content_date || null,
      notes: form.notes || null,
    }
    await onSave(payload)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{tape ? 'Edit Tape' : 'Add Tape'}</div>
        <form onSubmit={submit}>
          <div className="field">
            <label>Label *</label>
            <input value={form.label} onChange={(e) => set('label', e.target.value)} autoFocus />
            {error && <span className="field-error">{error}</span>}
          </div>
          <div className="field">
            <label>Description</label>
            <input value={form.description} onChange={(e) => set('description', e.target.value)} />
          </div>
          <div className="form-row">
            <div className="field">
              <label>Duration (minutes)</label>
              <input
                type="number"
                min="0"
                value={form.duration_minutes}
                onChange={(e) => set('duration_minutes', e.target.value)}
              />
            </div>
            <div className="field">
              <label>Content Date</label>
              <input
                value={form.content_date}
                placeholder="e.g. 1994-12"
                onChange={(e) => set('content_date', e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label>Notes</label>
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ConfirmModal({ message, onConfirm, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Confirm</div>
        <p style={{ marginBottom: 18 }}>{message}</p>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="danger" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  )
}

export default function TapeLibrary({ obsConnected, wsStatus, onOpenChapters, onStartRecording }) {
  const [tapes, setTapes] = useState([])
  const [filter, setFilter] = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [editTape, setEditTape] = useState(null)
  const [deletingTape, setDeletingTape] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const data = await getTapes(filter === 'all' ? undefined : filter)
    setTapes(data || [])
  }, [filter])

  useEffect(() => { load() }, [load])

  // Refresh on recording events via wsStatus changes
  useEffect(() => {
    if (wsStatus?.event === 'recording_started' || wsStatus?.event === 'recording_stopped') {
      load()
    }
  }, [wsStatus, load])

  async function handleCreate(payload) {
    try {
      await createTape(payload)
      setShowAdd(false)
      load()
    } catch {
      setError('Failed to create tape')
    }
  }

  async function handleEdit(payload) {
    try {
      await updateTape(editTape.id, payload)
      setEditTape(null)
      load()
    } catch {
      setError('Failed to update tape')
    }
  }

  async function handleDelete() {
    try {
      await deleteTape(deletingTape.id)
      setDeletingTape(null)
      load()
    } catch {
      setError('Failed to delete tape')
    }
  }

  async function handleSkipToggle(tape) {
    const newStatus = tape.status === 'skipped' ? 'pending' : 'skipped'
    await updateTape(tape.id, { status: newStatus })
    load()
  }

  async function handleStart(tapeId) {
    try {
      await startRecording(tapeId)
      if (onStartRecording) onStartRecording()
      load()
    } catch (e) {
      setError(e.message || 'Failed to start recording')
    }
  }

  const isRecording = wsStatus?.is_recording
  const recordingTapeId = wsStatus?.tape_id

  return (
    <div className="page">
      {error && (
        <div className="alert-banner warning" style={{ marginBottom: 12 }}>
          {error}
          <button className="small" style={{ marginLeft: 12 }} onClick={() => setError('')}>✕</button>
        </div>
      )}

      <div className="section-header">
        <div className="filter-pills">
          {STATUSES.map((s) => (
            <button key={s} className={`pill${filter === s ? ' active' : ''}`} onClick={() => setFilter(s)}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <button className="primary small" onClick={() => setShowAdd(true)}>+ Add Tape</button>
      </div>

      {tapes.length === 0 ? (
        <div className="empty-state">No tapes found</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Label</th>
                <th>Description</th>
                <th>Duration</th>
                <th>Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tapes.map((t) => {
                const isThisRecording = recordingTapeId === t.id && isRecording
                return (
                  <tr key={t.id}>
                    <td style={{ color: 'var(--text-dim)' }}>{t.id}</td>
                    <td style={{ fontWeight: 500 }}>{t.label}</td>
                    <td style={{ color: 'var(--text-dim)' }}>{t.description || '—'}</td>
                    <td>{t.duration_minutes ? `${t.duration_minutes}m` : '—'}</td>
                    <td>{t.content_date || '—'}</td>
                    <td><span className={`badge ${t.status}`}>{t.status}</span></td>
                    <td>
                      <div className="action-row">
                        {t.status === 'pending' && (
                          <button
                            className="small primary"
                            disabled={!obsConnected || isRecording}
                            onClick={() => handleStart(t.id)}
                          >
                            ● Record
                          </button>
                        )}
                        {t.status === 'done' && (
                          <button className="small" onClick={() => onOpenChapters?.(t)}>
                            Chapters
                          </button>
                        )}
                        {!isThisRecording && (
                          <>
                            <button className="small" onClick={() => setEditTape(t)}>Edit</button>
                            <button className="small" onClick={() => handleSkipToggle(t)}>
                              {t.status === 'skipped' ? 'Unskip' : 'Skip'}
                            </button>
                            <button className="small danger" onClick={() => setDeletingTape(t)}>
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <TapeModal onSave={handleCreate} onClose={() => setShowAdd(false)} />}
      {editTape && <TapeModal tape={editTape} onSave={handleEdit} onClose={() => setEditTape(null)} />}
      {deletingTape && (
        <ConfirmModal
          message={`Delete "${deletingTape.label}"? This cannot be undone.`}
          onConfirm={handleDelete}
          onClose={() => setDeletingTape(null)}
        />
      )}
    </div>
  )
}
