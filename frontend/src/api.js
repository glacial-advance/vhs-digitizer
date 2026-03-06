async function request(method, url, body) {
  const opts = {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const resp = await fetch(url, opts)
  if (resp.status === 204) return null
  return resp.json()
}

export const getTapes = (status) =>
  request('GET', status ? `/api/tapes?status=${status}` : '/api/tapes')

export const createTape = (data) => request('POST', '/api/tapes', data)
export const updateTape = (id, data) => request('PUT', `/api/tapes/${id}`, data)
export const deleteTape = (id) => request('DELETE', `/api/tapes/${id}`)

export const getStats = () => request('GET', '/api/stats')

export const getSettings = () => request('GET', '/api/settings')
export const updateSettings = (data) => request('PUT', '/api/settings', data)

export const getObsStatus = () => request('GET', '/api/obs/status')
export const connectObs = (host, port, password) =>
  request('POST', '/api/obs/connect', { host, port, password })
export const disconnectObs = () => request('POST', '/api/obs/disconnect')

export const getRecordingStatus = () => request('GET', '/api/recording/status')
export const startRecording = (tape_id) => request('POST', '/api/recording/start', { tape_id })
export const stopRecording = () => request('POST', '/api/recording/stop')
export const pauseRecording = () => request('POST', '/api/recording/pause')
export const resumeRecording = () => request('POST', '/api/recording/resume')

export const listChapters = (tapeId) => request('GET', `/api/tapes/${tapeId}/chapters`)
export const createChapter = (tapeId, data) => request('POST', `/api/tapes/${tapeId}/chapters`, data)
export const updateChapter = (id, data) => request('PUT', `/api/chapters/${id}`, data)
export const deleteChapter = (id) => request('DELETE', `/api/chapters/${id}`)
export const exportChapter = (id) => request('POST', `/api/chapters/${id}/export`)
export const exportAllChapters = (tapeId) =>
  request('POST', `/api/tapes/${tapeId}/chapters/export-all`)
export const getJob = (jobId) => request('GET', `/api/jobs/${jobId}`)

export function createWebSocket(onMessage, onStatusChange) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const base = `${protocol}//${window.location.host}/ws`
  let ws = null
  let retryTimer = null
  let stopped = false

  function connect() {
    ws = new WebSocket(base)
    ws.onopen = () => onStatusChange?.('connected')
    ws.onclose = () => {
      onStatusChange?.('disconnected')
      if (!stopped) retryTimer = setTimeout(connect, 3000)
    }
    ws.onerror = () => ws.close()
    ws.onmessage = (evt) => {
      try {
        onMessage?.(JSON.parse(evt.data))
      } catch {
        // ignore malformed messages
      }
    }
  }

  connect()

  return {
    close() {
      stopped = true
      clearTimeout(retryTimer)
      ws?.close()
    },
  }
}
