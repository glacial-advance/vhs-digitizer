import { vi, describe, beforeEach, test, expect } from 'vitest'
import {
  getTapes,
  createTape,
  updateTape,
  deleteTape,
  getStats,
  getSettings,
  updateSettings,
  getObsStatus,
  connectObs,
  disconnectObs,
  startRecording,
  stopRecording,
  getRecordingStatus,
  listChapters,
  createChapter,
  updateChapter,
  deleteChapter,
  exportChapter,
  getJob,
} from '../api'

function mockFetch(data, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  })
}

describe('api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('getTapes calls GET /api/tapes', async () => {
    mockFetch([])
    await getTapes()
    expect(fetch).toHaveBeenCalledWith('/api/tapes', expect.objectContaining({ method: 'GET' }))
  })

  test('getTapes passes status filter', async () => {
    mockFetch([])
    await getTapes('pending')
    expect(fetch).toHaveBeenCalledWith(
      '/api/tapes?status=pending',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  test('createTape calls POST /api/tapes', async () => {
    mockFetch({ id: 1 }, true, 201)
    await createTape({ label: 'Test' })
    expect(fetch).toHaveBeenCalledWith(
      '/api/tapes',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  test('updateTape calls PUT /api/tapes/:id', async () => {
    mockFetch({ id: 1 })
    await updateTape(1, { label: 'New' })
    expect(fetch).toHaveBeenCalledWith('/api/tapes/1', expect.objectContaining({ method: 'PUT' }))
  })

  test('deleteTape calls DELETE /api/tapes/:id', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    await deleteTape(1)
    expect(fetch).toHaveBeenCalledWith(
      '/api/tapes/1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  test('getStats calls GET /api/stats', async () => {
    mockFetch({ total: 0 })
    await getStats()
    expect(fetch).toHaveBeenCalledWith('/api/stats', expect.objectContaining({ method: 'GET' }))
  })

  test('getSettings calls GET /api/settings', async () => {
    mockFetch({})
    await getSettings()
    expect(fetch).toHaveBeenCalledWith(
      '/api/settings',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  test('updateSettings calls PUT /api/settings', async () => {
    mockFetch({})
    await updateSettings({ obs_host: '10.0.0.1' })
    expect(fetch).toHaveBeenCalledWith(
      '/api/settings',
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  test('getObsStatus calls GET /api/obs/status', async () => {
    mockFetch({ connected: false })
    await getObsStatus()
    expect(fetch).toHaveBeenCalledWith(
      '/api/obs/status',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  test('connectObs calls POST /api/obs/connect', async () => {
    mockFetch({ connected: true })
    await connectObs('localhost', 4455, '')
    expect(fetch).toHaveBeenCalledWith(
      '/api/obs/connect',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  test('disconnectObs calls POST /api/obs/disconnect', async () => {
    mockFetch({ connected: false })
    await disconnectObs()
    expect(fetch).toHaveBeenCalledWith(
      '/api/obs/disconnect',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  test('startRecording calls POST /api/recording/start', async () => {
    mockFetch({ ok: true })
    await startRecording(1)
    expect(fetch).toHaveBeenCalledWith(
      '/api/recording/start',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  test('stopRecording calls POST /api/recording/stop', async () => {
    mockFetch({ ok: true })
    await stopRecording()
    expect(fetch).toHaveBeenCalledWith(
      '/api/recording/stop',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  test('getRecordingStatus calls GET /api/recording/status', async () => {
    mockFetch({ is_recording: false })
    await getRecordingStatus()
    expect(fetch).toHaveBeenCalledWith(
      '/api/recording/status',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  test('listChapters calls GET /api/tapes/:id/chapters', async () => {
    mockFetch([])
    await listChapters(5)
    expect(fetch).toHaveBeenCalledWith(
      '/api/tapes/5/chapters',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  test('createChapter calls POST /api/tapes/:id/chapters', async () => {
    mockFetch({ id: 1 }, true, 201)
    await createChapter(5, { title: 'Intro', start_time_ms: 0 })
    expect(fetch).toHaveBeenCalledWith(
      '/api/tapes/5/chapters',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  test('updateChapter calls PUT /api/chapters/:id', async () => {
    mockFetch({ id: 1 })
    await updateChapter(3, { title: 'New' })
    expect(fetch).toHaveBeenCalledWith(
      '/api/chapters/3',
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  test('deleteChapter calls DELETE /api/chapters/:id', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    await deleteChapter(3)
    expect(fetch).toHaveBeenCalledWith(
      '/api/chapters/3',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  test('exportChapter calls POST /api/chapters/:id/export', async () => {
    mockFetch({ job_id: 'abc' })
    await exportChapter(3)
    expect(fetch).toHaveBeenCalledWith(
      '/api/chapters/3/export',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  test('getJob calls GET /api/jobs/:id', async () => {
    mockFetch({ status: 'done' })
    await getJob('abc')
    expect(fetch).toHaveBeenCalledWith('/api/jobs/abc', expect.objectContaining({ method: 'GET' }))
  })
})
