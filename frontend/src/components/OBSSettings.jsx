import { useState, useEffect } from 'react'
import { getSettings, updateSettings, connectObs, disconnectObs } from '../api'

export default function OBSSettings({ obsConnected, ffmpegAvailable, onConnectionChange }) {
  const [form, setForm] = useState({ obs_host: 'localhost', obs_port: '4455', obs_password: '', output_dir: '' })
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    getSettings().then((s) => {
      if (s) setForm({ obs_host: s.obs_host || 'localhost', obs_port: s.obs_port || '4455', obs_password: s.obs_password || '', output_dir: s.output_dir || '' })
    })
  }, [])

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }))
    setSaved(false)
  }

  async function handleSave(e) {
    e.preventDefault()
    try {
      await updateSettings(form)
      setSaved(true)
      setError('')
    } catch {
      setError('Failed to save settings')
    }
  }

  async function handleConnect() {
    setConnecting(true)
    setError('')
    try {
      await connectObs(form.obs_host, parseInt(form.obs_port, 10), form.obs_password)
      onConnectionChange?.()
    } catch (e) {
      setError(e.message || 'Failed to connect to OBS')
    } finally {
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    try {
      await disconnectObs()
      onConnectionChange?.()
    } catch {
      setError('Failed to disconnect')
    }
  }

  return (
    <div className="page">
      {!ffmpegAvailable && (
        <div className="alert-banner warning" style={{ marginBottom: 16 }}>
          <strong>FFmpeg not found.</strong> Chapter export is disabled. Install FFmpeg and restart the backend.
        </div>
      )}

      <div className="two-col">
        <div>
          <div className="card section">
            <div className="section-title">OBS Connection</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span className={`status-dot ${obsConnected ? 'green' : 'red'}`} />
              <span>{obsConnected ? 'Connected' : 'Disconnected'}</span>
            </div>

            {error && <div className="alert-banner warning" style={{ marginBottom: 12 }}>{error}</div>}

            <div className="field">
              <label>OBS Host</label>
              <input value={form.obs_host} onChange={(e) => set('obs_host', e.target.value)} />
            </div>
            <div className="field">
              <label>Port</label>
              <input type="number" value={form.obs_port} onChange={(e) => set('obs_port', e.target.value)} />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                value={form.obs_password}
                onChange={(e) => set('obs_password', e.target.value)}
              />
            </div>

            <div className="action-row" style={{ marginTop: 8 }}>
              {!obsConnected ? (
                <button className="primary" disabled={connecting} onClick={handleConnect}>
                  {connecting ? <><span className="spinner" />Connecting…</> : 'Connect'}
                </button>
              ) : (
                <button className="danger" onClick={handleDisconnect}>Disconnect</button>
              )}
            </div>
          </div>

          <div className="card section">
            <div className="section-title">Recording Output</div>
            <div className="field">
              <label>Output Directory</label>
              <input value={form.output_dir} onChange={(e) => set('output_dir', e.target.value)} />
            </div>
            <form onSubmit={handleSave}>
              <button type="submit" className="primary small">Save Settings</button>
              {saved && <span style={{ marginLeft: 10, color: 'var(--success)', fontSize: 12 }}>Saved!</span>}
            </form>
          </div>
        </div>

        <div className="card">
          <div className="section-title">OBS Setup Guide</div>
          <ol style={{ paddingLeft: 18, lineHeight: 1.7, fontSize: 13, color: 'var(--text-dim)' }}>
            <li>Open OBS Studio (v28 or later)</li>
            <li>Go to <strong>Tools → WebSocket Server Settings</strong></li>
            <li>Enable the WebSocket server, port <code>4455</code></li>
            <li>Optionally set a password and enter it above</li>
            <li>Add a <strong>Video Capture Device</strong> source for your USB capture card</li>
            <li>Configure audio input for RCA channels</li>
            <li>Set output format to <strong>MKV</strong> (Settings → Output → Recording)</li>
            <li>Click <strong>Connect</strong> above</li>
          </ol>
        </div>
      </div>
    </div>
  )
}
