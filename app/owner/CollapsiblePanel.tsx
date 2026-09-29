'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export default function CollapsiblePanel({
  title,
  subtitle,
  icon,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string
  subtitle?: string
  icon?: ReactNode
  badge?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="w-full px-6 py-4 flex items-start justify-between gap-3 text-left hover:bg-gray-50"
      >
        <div className="min-w-0">
          <h2 className="font-serif text-lg font-bold text-gray-900 flex items-center gap-2">
            {icon}
            {title}
          </h2>
          {subtitle ? (
            <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
          ) : null}
        </div>
        <span className="flex items-center gap-2 shrink-0">
          {badge}
          <ChevronDown
            size={16}
            className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>
      {open ? children : null}
    </div>
  )
}
