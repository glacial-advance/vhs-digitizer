import { useState, useEffect } from 'react'

const TIME_RE = /^(\d{1,2}):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?$/

export function msToDisplay(ms) {
  if (ms === null || ms === undefined) return ''
  const totalSec = Math.floor(ms / 1000)
  const millis = ms % 1000
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const base = [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
  if (millis > 0) return `${base}.${String(millis).padStart(3, '0')}`
  return base
}

export function parseTimeToMs(str) {
  if (!str || str.trim() === '') return null
  const match = str.trim().match(TIME_RE)
  if (!match) return undefined // invalid
  const [, h, m, s, ms = '0'] = match
  const millis = parseInt(ms.padEnd(3, '0'), 10)
  return (parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10)) * 1000 + millis
}

export default function TimeInput({ value, onChange, placeholder, disabled }) {
  const [text, setText] = useState(msToDisplay(value))
  const [error, setError] = useState('')

  useEffect(() => {
    setText(msToDisplay(value))
    setError('')
  }, [value])

  function handleChange(e) {
    setText(e.target.value)
    setError('')
  }

  function handleBlur() {
    const trimmed = text.trim()
    if (trimmed === '') {
      setError('')
      onChange(null)
      return
    }
    const ms = parseTimeToMs(trimmed)
    if (ms === undefined) {
      setError('Invalid time format. Use HH:MM:SS or HH:MM:SS.mmm')
    } else {
      setError('')
      onChange(ms)
    }
  }

  return (
    <span className="time-input-wrapper">
      <input
        type="text"
        value={text}
        placeholder={placeholder || 'HH:MM:SS'}
        disabled={disabled}
        onChange={handleChange}
        onBlur={handleBlur}
      />
      {error && <span className="field-error">{error}</span>}
    </span>
  )
}
