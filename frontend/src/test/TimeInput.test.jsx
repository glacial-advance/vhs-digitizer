import { render, screen, fireEvent } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import TimeInput from '../components/TimeInput'

describe('TimeInput', () => {
  test('renders a text input', () => {
    render(<TimeInput value={null} onChange={() => {}} />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  test('displays null value as empty string', () => {
    render(<TimeInput value={null} onChange={() => {}} />)
    expect(screen.getByRole('textbox').value).toBe('')
  })

  test('displays ms value as HH:MM:SS', () => {
    render(<TimeInput value={5400000} onChange={() => {}} />)
    expect(screen.getByRole('textbox').value).toBe('01:30:00')
  })

  test('displays ms value with sub-second precision as HH:MM:SS.mmm', () => {
    render(<TimeInput value={5400500} onChange={() => {}} />)
    expect(screen.getByRole('textbox').value).toBe('01:30:00.500')
  })

  test('calls onChange with ms on valid HH:MM:SS input', () => {
    const onChange = vi.fn()
    render(<TimeInput value={null} onChange={onChange} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '00:01:30' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith(90000)
  })

  test('calls onChange with ms on valid HH:MM:SS.mmm input', () => {
    const onChange = vi.fn()
    render(<TimeInput value={null} onChange={onChange} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '00:00:05.250' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith(5250)
  })

  test('shows error for invalid format on blur', () => {
    render(<TimeInput value={null} onChange={() => {}} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'not-a-time' } })
    fireEvent.blur(input)
    expect(screen.getByText(/invalid/i)).toBeInTheDocument()
  })

  test('clears error when corrected', () => {
    render(<TimeInput value={null} onChange={() => {}} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'bad' } })
    fireEvent.blur(input)
    expect(screen.getByText(/invalid/i)).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '00:01:00' } })
    fireEvent.blur(input)
    expect(screen.queryByText(/invalid/i)).not.toBeInTheDocument()
  })

  test('calls onChange with null on empty input', () => {
    const onChange = vi.fn()
    render(<TimeInput value={5000} onChange={onChange} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
