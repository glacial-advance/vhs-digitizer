import { render, screen } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import Dashboard from '../components/Dashboard'

const mockStats = {
  total: 10,
  pending: 6,
  recording: 0,
  done: 3,
  skipped: 1,
  total_minutes: 600,
  done_minutes: 180,
  pct_complete: 30.0,
}

const mockNextTape = { id: 2, label: 'Summer 88', duration_minutes: 90 }
const mockRecentTapes = [
  { id: 1, label: 'Christmas 94', recorded_at: '2026-01-01T00:00:00Z' },
]

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('renders stat cards with values', () => {
    render(
      <Dashboard
        stats={mockStats}
        nextTape={mockNextTape}
        recentTapes={mockRecentTapes}
        wsStatus={{ is_recording: false, tape_id: null, duration_ms: 0 }}
        obsConnected={true}
        onStartRecording={() => {}}
      />,
    )
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  test('renders progress bar', () => {
    render(
      <Dashboard
        stats={mockStats}
        nextTape={null}
        recentTapes={[]}
        wsStatus={{ is_recording: false }}
        obsConnected={false}
        onStartRecording={() => {}}
      />,
    )
    expect(screen.getByText(/30/)).toBeInTheDocument()
  })

  test('renders next pending tape', () => {
    render(
      <Dashboard
        stats={mockStats}
        nextTape={mockNextTape}
        recentTapes={[]}
        wsStatus={{ is_recording: false }}
        obsConnected={true}
        onStartRecording={() => {}}
      />,
    )
    expect(screen.getByText('Summer 88')).toBeInTheDocument()
  })

  test('start button disabled when OBS not connected', () => {
    render(
      <Dashboard
        stats={mockStats}
        nextTape={mockNextTape}
        recentTapes={[]}
        wsStatus={{ is_recording: false }}
        obsConnected={false}
        onStartRecording={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /start/i })).toBeDisabled()
  })

  test('shows active recording banner', () => {
    render(
      <Dashboard
        stats={mockStats}
        nextTape={null}
        recentTapes={[]}
        wsStatus={{ is_recording: true, tape_id: 1, duration_ms: 120000 }}
        obsConnected={true}
        activeTapeLabel="Christmas 94"
        onStartRecording={() => {}}
      />,
    )
    expect(screen.getByText(/Christmas 94/)).toBeInTheDocument()
    expect(screen.getByText(/recording/i)).toBeInTheDocument()
  })

  test('renders recently digitized tapes', () => {
    render(
      <Dashboard
        stats={mockStats}
        nextTape={null}
        recentTapes={mockRecentTapes}
        wsStatus={{ is_recording: false }}
        obsConnected={false}
        onStartRecording={() => {}}
      />,
    )
    expect(screen.getByText('Christmas 94')).toBeInTheDocument()
  })
})
