'use client'

import { Search } from 'lucide-react'
import { useState, useRef } from 'react'

interface SearchInputProps {
  placeholder?: string
  value: string
  onChange: (value: string) => void
  debounceMs?: number
}

export default function SearchInput({ placeholder = 'Search...', value, onChange, debounceMs = 300 }: SearchInputProps) {
  const [local, setLocal] = useState(value)
  const [lastValue, setLastValue] = useState(value)
  const timeout = useRef<ReturnType<typeof setTimeout>>(null)

  // Adopt a new value from the parent during render (the React-documented
  // way to reset state on a prop change) rather than one render later.
  if (value !== lastValue) {
    setLastValue(value)
    setLocal(value)
  }

  const handleChange = (v: string) => {
    setLocal(v)
    if (timeout.current) clearTimeout(timeout.current)
    timeout.current = setTimeout(() => onChange(v), debounceMs)
  }

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 340 }}>
      <Search size={16} aria-hidden style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--green)', opacity: 0.55 }} />
      <input
        type="search"
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="adm-input"
        style={{ width: '100%', paddingLeft: 38 }}
      />
    </div>
  )
}
