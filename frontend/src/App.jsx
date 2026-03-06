import { useState, useEffect, useCallback } from 'react'
import { createWebSocket, getTapes, getStats } from './api'
import Dashboard from './components/Dashboard'
import TapeLibrary from './components/TapeLibrary'
import RecordingSession from './components/RecordingSession'
import OBSSettings from './components/OBSSettings'
import ChapterEditor from './components/ChapterEditor'

const TABS = ['Dashboard', 'Tape Library', 'Record', 'OBS Settings']

export default function App() {
  const [tab, setTab] = useState('Dashboard')
  const [wsStatus, setWsStatus] = useState({ obs_connected: false, is_recording: false, is_paused: false, duration_ms: 0, tape_id: null })
  const [wsConnected, setWsConnected] = useState(false)
  const [stats, setStats] = useState(null)
  const [allTapes, setAllTapes] = useState([])
  const [chapterTape, setChapterTape] = useState(null) // open chapter editor for this tape
  const [ffmpegAvailable, setFfmpegAvailable] = useState(true)

  const refreshAll = useCallback(async () => {
    const [s, tapes] = await Promise.all([getStats(), getTapes()])
    if (s) setStats(s)
    if (tapes) setAllTapes(tapes)
  }, [])

  // Initial load
  useEffect(() => { refreshAll() }, [refreshAll])

  // WebSocket
  useEffect(() => {
    const ws = createWebSocket(
      (msg) => {
        if (msg.event === 'status_update') {
          setWsStatus(msg)
        } else if (msg.event === 'recording_started' || msg.event === 'recording_stopped') {
          setWsStatus((prev) => ({ ...prev, event: msg.event }))
          refreshAll()
        }
      },
      (state) => setWsConnected(state === 'connected'),
    )
    return () => ws.close()
  }, [refreshAll])

  // Check ffmpeg via settings (backend startup exposes it)
  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((s) => {
      setFfmpegAvailable(s.ffmpeg_available !== false)
    }).catch(() => {})
  }, [])

  const nextTape = allTapes.find((t) => t.status === 'pending') || null
  const recentTapes = allTapes.filter((t) => t.status === 'done').slice(-5).reverse()
  const activeTapeLabel = allTapes.find((t) => t.id === wsStatus.tape_id)?.label || null

  if (chapterTape) {
    return (
      <>
        <NavBar wsConnected={wsConnected} wsStatus={wsStatus} tab="Tape Library" setTab={setTab} />
        <ChapterEditor
          tape={chapterTape}
          ffmpegAvailable={ffmpegAvailable}
          onBack={() => setChapterTape(null)}
        />
      </>
    )
  }

  return (
    <>
      <NavBar wsConnected={wsConnected} wsStatus={wsStatus} tab={tab} setTab={setTab} />
      {tab === 'Dashboard' && (
        <Dashboard
          stats={stats}
          nextTape={nextTape}
          recentTapes={recentTapes}
          wsStatus={wsStatus}
          obsConnected={wsStatus.obs_connected}
          activeTapeLabel={activeTapeLabel}
          onStartRecording={() => { setTab('Record') }}
        />
      )}
      {tab === 'Tape Library' && (
        <TapeLibrary
          obsConnected={wsStatus.obs_connected}
          wsStatus={wsStatus}
          onOpenChapters={(tape) => setChapterTape(tape)}
          onStartRecording={refreshAll}
        />
      )}
      {tab === 'Record' && (
        <RecordingSession wsStatus={wsStatus} obsConnected={wsStatus.obs_connected} />
      )}
      {tab === 'OBS Settings' && (
        <OBSSettings
          obsConnected={wsStatus.obs_connected}
          ffmpegAvailable={ffmpegAvailable}
          onConnectionChange={refreshAll}
        />
      )}
    </>
  )
}

function NavBar({ wsConnected, wsStatus, tab, setTab }) {
  const isRecording = wsStatus?.is_recording

  return (
    <>
      <nav className="nav">
        <span className="nav-title">📼 VHS Digitizer</span>
        <span className="nav-spacer" />
        <div className="nav-status">
          <span>
            <span className={`status-dot ${wsStatus.obs_connected ? 'green' : 'red'}`} />
            OBS {wsStatus.obs_connected ? 'Connected' : 'Disconnected'}
          </span>
          {isRecording && (
            <span>
              <span className="status-dot recording" />
              Recording
            </span>
          )}
          <span>
            <span className={`status-dot ${wsConnected ? 'green' : 'red'}`} />
            {wsConnected ? 'Live' : 'Offline'}
          </span>
        </div>
      </nav>
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t}
            className={`tab${tab === t ? ' active' : ''}${t === 'Record' && isRecording ? ' recording-active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'Record' && isRecording ? '● ' : ''}{t}
          </button>
        ))}
      </div>
    </>
  )
}
