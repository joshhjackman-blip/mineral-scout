'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { OperatorOption } from '@/lib/operator-filter'

/**
 * Compact multi-select for CAD operator clusters (toolbar).
 * Options are already deduped A–Z by collectOperatorOptions.
 */
export default function OperatorMultiSelect({
  options,
  selectedKeys,
  onChange,
  isMobile = false,
}: {
  options: OperatorOption[]
  /** Selected cluster keys from OperatorOption.key */
  selectedKeys: string[]
  onChange: (keys: string[]) => void
  isMobile?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    // Focus search when opened.
    requestAnimationFrame(() => searchRef.current?.focus())
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys])

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase()
    if (!q) return options
    return options.filter((op) => {
      if (op.label.toUpperCase().includes(q)) return true
      if (op.key.includes(q)) return true
      return op.aliases.some((a) => a.toUpperCase().includes(q))
    })
  }, [options, query])

  const toggle = (key: string) => {
    if (selectedSet.has(key)) {
      onChange(selectedKeys.filter((k) => k !== key))
      return
    }
    onChange([...selectedKeys, key])
  }

  const active = selectedKeys.length > 0
  const summary = !active
    ? 'All operators'
    : selectedKeys.length === 1
      ? options.find((o) => o.key === selectedKeys[0])?.label || '1 selected'
      : `${selectedKeys.length} selected`

  return (
    <div ref={rootRef} style={{ position: 'relative', minWidth: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Filter tracts by CAD tax-roll operator (multi-select)"
        style={{
          fontSize: 11,
          border: active
            ? '1px solid rgba(239,159,39,0.7)'
            : '1px solid #E5E7EB',
          borderRadius: 6,
          padding: '3px 8px',
          background: active ? '#FFFBEB' : '#fff',
          color: '#374151',
          width: isMobile ? 130 : 180,
          minWidth: 110,
          textAlign: 'left',
          cursor: 'pointer',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {summary}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            width: isMobile ? 260 : 320,
            maxHeight: 320,
            background: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
            zIndex: 80,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '8px 8px 6px',
              borderBottom: '1px solid #F3F4F6',
              display: 'flex',
              gap: 6,
              alignItems: 'center',
            }}
          >
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search operators…"
              style={{
                flex: 1,
                fontSize: 11,
                border: '1px solid #E5E7EB',
                borderRadius: 6,
                padding: '4px 8px',
                color: '#374151',
              }}
            />
            {active && (
              <button
                type="button"
                onClick={() => onChange([])}
                style={{
                  fontSize: 10,
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: '1px solid #E5E7EB',
                  background: '#fff',
                  color: '#6B7280',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Clear
              </button>
            )}
          </div>

          <div style={{ overflowY: 'auto', padding: '4px 0' }}>
            {filtered.length === 0 ? (
              <div style={{ fontSize: 11, color: '#9CA3AF', padding: '10px 12px' }}>
                No operators match
              </div>
            ) : (
              filtered.map((op) => {
                const checked = selectedSet.has(op.key)
                return (
                  <label
                    key={op.key}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      padding: '6px 10px',
                      cursor: 'pointer',
                      background: checked ? '#FFFBEB' : 'transparent',
                      borderLeft: checked
                        ? '3px solid #EF9F27'
                        : '3px solid transparent',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(op.key)}
                      style={{ marginTop: 2, accentColor: '#EF9F27' }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 11,
                          fontWeight: checked ? 600 : 500,
                          color: '#111827',
                          lineHeight: 1.3,
                        }}
                      >
                        {op.label}
                      </span>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 10,
                          color: '#9CA3AF',
                          marginTop: 1,
                        }}
                      >
                        {op.aliases.length > 1
                          ? `${op.aliases.length} spellings · ${op.count.toLocaleString()} rows`
                          : `${op.count.toLocaleString()} rows`}
                      </span>
                    </span>
                  </label>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
