'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { OperatorOption } from '@/lib/operator-filter'

/**
 * Compact multi-select for CAD operator clusters.
 * Used in the map's right-side Legend/Overlays panel.
 */
export default function OperatorMultiSelect({
  options,
  selectedKeys,
  onChange,
  matchCount = null,
}: {
  options: OperatorOption[]
  /** Selected cluster keys from OperatorOption.key */
  selectedKeys: string[]
  onChange: (keys: string[]) => void
  /** Optional tract-match count shown next to the trigger. */
  matchCount?: number | null
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
    requestAnimationFrame(() => searchRef.current?.focus())
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!open) setQuery('')
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
    <div ref={rootRef} style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Filter tracts by CAD tax-roll operator (multi-select)"
        style={{
          width: '100%',
          fontSize: 12,
          border: active
            ? '1px solid rgba(239,159,39,0.7)'
            : '1px solid #E5E7EB',
          borderRadius: 6,
          padding: '6px 8px',
          background: active ? '#FFFBEB' : '#fff',
          color: '#374151',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontWeight: active ? 600 : 500,
            color: active ? '#B45309' : '#374151',
          }}
        >
          {summary}
        </span>
        <span style={{ color: '#9CA3AF', fontSize: 10, flexShrink: 0 }}>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {active && matchCount != null && (
        <div style={{ marginTop: 4, fontSize: 10.5, color: '#B45309' }}>
          {matchCount} tract{matchCount === 1 ? '' : 's'} match
        </div>
      )}

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            maxHeight: 280,
            background: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(15,23,42,0.14)',
            zIndex: 30,
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
                minWidth: 0,
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

          <div style={{ overflowY: 'auto', padding: '4px 0', maxHeight: 230 }}>
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
