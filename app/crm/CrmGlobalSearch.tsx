'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { Deal } from './crm-utils'
import { countyLabel, dealMatchesQuery, dealTag, TAG_LABELS } from './crm-utils'

type CrmGlobalSearchProps = {
  deals: Deal[]
  onSelect: (deal: Deal) => void
}

export default function CrmGlobalSearch({ deals, onSelect }: CrmGlobalSearchProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    if (!query.trim()) return []
    return deals.filter((d) => dealMatchesQuery(d, query)).slice(0, 8)
  }, [deals, query])

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pick = (deal: Deal) => {
    onSelect(deal)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div ref={rootRef} className="relative w-full max-w-xl">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false)
              inputRef.current?.blur()
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((i) => Math.max(i - 1, 0))
            }
            if (e.key === 'Enter' && results[active]) {
              e.preventDefault()
              pick(results[active])
            }
          }}
          placeholder="Search leads, tracts, phone, email, county..."
          aria-label="Search CRM"
          className="w-full h-8 pl-9 pr-16 text-sm bg-gray-800 border border-gray-700 text-gray-100 placeholder:text-gray-500 rounded-md focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            className="absolute right-10 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            aria-label="Clear search"
          >
            <X size={12} />
          </button>
        ) : null}
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center px-1.5 h-5 text-[10px] font-medium text-gray-500 bg-gray-900 border border-gray-700 rounded">
          ⌘K
        </kbd>
      </div>

      {open && query.trim() && (
        <div className="absolute z-30 mt-1.5 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {results.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-500">No matching leads</div>
          ) : (
            <ul role="listbox" className="max-h-80 overflow-y-auto">
              {results.map((deal, i) => (
                <li key={deal.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(deal)}
                    className={`w-full text-left px-3 py-2.5 border-b border-gray-100 last:border-0 ${
                      i === active ? 'bg-amber-50' : 'bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-gray-900 truncate">{deal.owner_name}</span>
                      <span className="text-[11px] text-gray-500 shrink-0">
                        {TAG_LABELS[dealTag(deal)] ?? dealTag(deal)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500 truncate">
                      {[deal.tract_abstract, deal.operator_name, countyLabel(deal)]
                        .filter(Boolean)
                        .join('  ·  ')}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
