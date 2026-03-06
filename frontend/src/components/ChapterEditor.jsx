import { useState, useEffect, useCallback } from 'react'
import {
  listChapters, createChapter, updateChapter, deleteChapter,
  exportChapter, exportAllChapters, getJob,
} from '../api'
import TimeInput from './TimeInput'
import { msToHms } from '../utils'

const COLORS = ['#4f8ef7', '#e07040', '#40a07a', '#a040e0', '#e04080', '#40c0e0']

function ChapterRow({ ch, ffmpegAvailable, onEdit, onDelete, onExport, jobStatus }) {
  const duration = ch.end_time_ms != null ? ch.end_time_ms - ch.start_time_ms : null
  const isExporting = jobStatus === 'running' || jobStatus === 'pending'
  const exportDone = jobStatus === 'done'

  return (
    <tr>
      <td>{ch.order}</td>
      <td style={{ fontWeight: 500 }}>{ch.title}</td>
      <td>{msToHms(ch.start_time_ms)}</td>
      <td>{ch.end_time_ms != null ? msToHms(ch.end_time_ms) : '—'}</td>
      <td>{duration != null ? msToHms(duration) : '—'}</td>
      <td>
        {exportDone ? (
          <span style={{ color: 'var(--success)' }}>✓ {ch.output_file?.split('/').pop()}</span>
        ) : isExporting ? (
          <span><span className="spinner" />Exporting…</span>
        ) : ch.output_file ? (
          <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>✓ {ch.output_file.split('/').pop()}</span>
        ) : '—'}
      </td>
      <td>
        <div className="action-row">
          <button className="small" onClick={() => onEdit(ch)}>Edit</button>
          <button
            className="small primary"
            disabled={!ffmpegAvailable || isExporting}
            title={!ffmpegAvailable ? 'FFmpeg not available' : ''}
            onClick={() => onExport(ch)}
          >
            Export
          </button>
          <button className="small danger" onClick={() => onDelete(ch)}>Delete</button>
        </div>
      </td>
    </tr>
  )
}

function ChapterForm({ existing, onSave, onCancel }) {
  const [title, setTitle] = useState(existing?.title || '')
  const [startMs, setStartMs] = useState(existing?.start_time_ms ?? null)
  const [endMs, setEndMs] = useState(existing?.end_time_ms ?? null)
  const [notes, setNotes] = useState(existing?.notes || '')
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required'); return }
    if (startMs === null) { setError('Start time is required'); return }
    if (endMs !== null && endMs <= startMs) { setError('End time must be after start'); return }
    try {
      await onSave({ title: title.trim(), start_time_ms: startMs, end_time_ms: endMs, notes: notes || null })
      setError('')
    } catch (e) {
      setError(e.message || 'Failed to save')
    }
  }

  return (
    <div className="inline-form">
      {error && <div className="alert-banner warning" style={{ marginBottom: 10 }}>{error}</div>}
      <form onSubmit={submit}>
        <div className="form-row">
          <div className="field">
            <label>Title *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label>Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label>Start Time</label>
            <TimeInput value={startMs} onChange={setStartMs} />
          </div>
          <div className="field">
            <label>End Time (optional)</label>
            <TimeInput value={endMs} onChange={setEndMs} />
          </div>
        </div>
        <div className="action-row" style={{ marginTop: 10 }}>
          <button type="button" className="small" onClick={onCancel}>Cancel</button>
          <button type="submit" className="small primary">Save Chapter</button>
        </div>
      </form>
    </div>
  )
}

export default function ChapterEditor({ tape, onBack, ffmpegAvailable }) {
  const [chapters, setChapters] = useState([])
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [jobs, setJobs] = useState({}) // chapterId -> {jobId, status}
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const data = await listChapters(tape.id)
    setChapters(data || [])
  }, [tape.id])

  useEffect(() => { load() }, [load])

  // Poll running jobs
  useEffect(() => {
    const running = Object.entries(jobs).filter(([, j]) => j.status === 'running' || j.status === 'pending')
    if (running.length === 0) return
    const timer = setTimeout(async () => {
      const updated = { ...jobs }
      for (const [chapterId, j] of running) {
        const result = await getJob(j.jobId)
        updated[chapterId] = { ...j, status: result.status }
        if (result.status === 'done') load()
      }
      setJobs(updated)
    }, 2000)
    return () => clearTimeout(timer)
  }, [jobs, load])

  async function handleCreate(payload) {
    await createChapter(tape.id, payload)
    setAdding(false)
    load()
  }

  async function handleEdit(payload) {
    await updateChapter(editingId, payload)
    setEditingId(null)
    load()
  }

  async function handleDelete(ch) {
    if (!confirm(`Delete chapter "${ch.title}"?`)) return
    await deleteChapter(ch.id)
    load()
  }

  async function handleExport(ch) {
    try {
      const { job_id } = await exportChapter(ch.id)
      setJobs((j) => ({ ...j, [ch.id]: { jobId: job_id, status: 'pending' } }))
    } catch (e) {
      setError(e.message || 'Export failed')
    }
  }

  async function handleExportAll() {
    try {
      const { job_ids } = await exportAllChapters(tape.id)
      const newJobs = { ...jobs }
      job_ids.forEach((jobId, i) => {
        const ch = chapters[i]
        if (ch) newJobs[ch.id] = { jobId, status: 'pending' }
      })
      setJobs(newJobs)
    } catch (e) {
      setError(e.message || 'Export all failed')
    }
  }

  const defaultStart = chapters.length > 0
    ? (chapters[chapters.length - 1].end_time_ms ?? chapters[chapters.length - 1].start_time_ms)
    : 0

  const durationMs = tape.duration_ms
  const hasTimeline = durationMs != null && durationMs > 0

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button className="small" onClick={onBack}>← Back</button>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>{tape.label}</h2>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {durationMs ? msToHms(durationMs) + ' total' : 'Duration unknown'}
            {tape.output_file && <span> · {tape.output_file}</span>}
            &nbsp;· {chapters.length} chapter{chapters.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {error && (
        <div className="alert-banner warning" style={{ marginBottom: 12 }}>
          {error}
          <button className="small" style={{ marginLeft: 12 }} onClick={() => setError('')}>✕</button>
        </div>
      )}

      {hasTimeline ? (
        <div className="timeline-container" style={{ marginBottom: 16 }}>
          {chapters.map((ch, i) => {
            const left = (ch.start_time_ms / durationMs) * 100
            const end = ch.end_time_ms ?? durationMs
            const width = ((end - ch.start_time_ms) / durationMs) * 100
            return (
              <div
                key={ch.id}
                className={`timeline-chapter${editingId === ch.id ? ' selected' : ''}`}
                style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%`, background: COLORS[i % COLORS.length] }}
                onClick={() => setEditingId(editingId === ch.id ? null : ch.id)}
                title={ch.title}
              >
                <span>{ch.title}</span>
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="section-header">
        <div className="section-title">Chapters</div>
        <div className="action-row">
          <button
            className="small primary"
            disabled={!ffmpegAvailable || chapters.length === 0}
            title={!ffmpegAvailable ? 'FFmpeg not available' : ''}
            onClick={handleExportAll}
          >
            Export All
          </button>
          <button className="small primary" onClick={() => { setAdding(true); setEditingId(null) }}>
            + Add Chapter
          </button>
        </div>
      </div>

      {adding && (
        <ChapterForm
          existing={{ start_time_ms: defaultStart }}
          onSave={handleCreate}
          onCancel={() => setAdding(false)}
        />
      )}

      {chapters.length === 0 && !adding ? (
        <div className="empty-state">No chapters defined yet</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Title</th>
                <th>Start</th>
                <th>End</th>
                <th>Duration</th>
                <th>Export</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {chapters.map((ch) => (
                <>
                  <ChapterRow
                    key={ch.id}
                    ch={ch}
                    ffmpegAvailable={ffmpegAvailable}
                    onEdit={(c) => { setEditingId(c.id); setAdding(false) }}
                    onDelete={handleDelete}
                    onExport={handleExport}
                    jobStatus={jobs[ch.id]?.status}
                  />
                  {editingId === ch.id && (
                    <tr key={`edit-${ch.id}`}>
                      <td colSpan={7} style={{ padding: 0 }}>
                        <ChapterForm
                          existing={ch}
                          onSave={handleEdit}
                          onCancel={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
