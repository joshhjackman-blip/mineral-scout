'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Deal } from './crm-utils'
import {
  buildMonthCells,
  countyLabel,
  dateKeyToIso,
  dealTag,
  formatDateKey,
  groupDealsByDate,
  isOverdue,
  TAG_LABELS,
  toDateKey,
} from './crm-utils'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type CrmCalendarProps = {
  deals: Deal[]
  onOpenLead: (deal: Deal) => void
  onSetFollowUp: (deal: Deal, followUpDate: string | null) => Promise<void> | void
}

export default function CrmCalendar({ deals, onOpenLead, onSetFollowUp }: CrmCalendarProps) {
  const now = new Date()
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() })
  const [selectedKey, setSelectedKey] = useState(toDateKey(now))
  const [scheduleId, setScheduleId] = useState('')
  const [busy, setBusy] = useState(false)

  const cells = useMemo(
    () => buildMonthCells(cursor.year, cursor.month),
    [cursor.year, cursor.month],
  )
  const byDate = useMemo(() => groupDealsByDate(deals), [deals])
  const selectedDeals = byDate.get(selectedKey) ?? []
  const unscheduled = deals.filter((d) => !d.follow_up_date)

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  const goToday = () => {
    const today = new Date()
    setCursor({ year: today.getFullYear(), month: today.getMonth() })
    setSelectedKey(toDateKey(today))
  }

  const shiftMonth = (delta: number) => {
    const next = new Date(cursor.year, cursor.month + delta, 1)
    setCursor({ year: next.getFullYear(), month: next.getMonth() })
  }

  const schedule = async () => {
    const deal = deals.find((d) => d.id === scheduleId)
    if (!deal) return
    setBusy(true)
    try {
      await onSetFollowUp(deal, dateKeyToIso(selectedKey))
      setScheduleId('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex-1 overflow-hidden bg-gray-50">
      <div className="h-full max-w-6xl mx-auto px-5 py-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-serif font-semibold text-gray-900">Calendar</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Follow-ups by day. Click a date to review or schedule a call-back.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="p-1.5 rounded-md border border-gray-200 bg-white text-gray-600 hover:border-gray-300"
              aria-label="Previous month"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="min-w-[160px] text-center text-sm font-semibold text-gray-900">{monthLabel}</div>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="p-1.5 rounded-md border border-gray-200 bg-white text-gray-600 hover:border-gray-300"
              aria-label="Next month"
            >
              <ChevronRight size={16} />
            </button>
            <button
              type="button"
              onClick={goToday}
              className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-200 bg-white text-gray-700 hover:border-amber-300"
            >
              Today
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
          <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-3 flex flex-col min-h-0">
            <div className="grid grid-cols-7 mb-1">
              {WEEKDAYS.map((d) => (
                <div key={d} className="text-[11px] font-medium text-gray-400 text-center py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 flex-1 min-h-[420px] auto-rows-fr gap-px bg-gray-100 rounded-lg overflow-hidden border border-gray-100">
              {cells.map((cell) => {
                const items = byDate.get(cell.key) ?? []
                const selected = cell.key === selectedKey
                const hasOverdue = items.some((d) => d.follow_up_date && isOverdue(d.follow_up_date))
                return (
                  <button
                    key={cell.key}
                    type="button"
                    onClick={() => setSelectedKey(cell.key)}
                    className={`text-left p-1.5 bg-white hover:bg-amber-50/60 transition-colors ${
                      !cell.inMonth ? 'bg-gray-50' : ''
                    } ${selected ? 'ring-2 ring-inset ring-amber-400' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs ${
                          cell.isToday
                            ? 'w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center font-semibold'
                            : cell.inMonth
                              ? 'text-gray-800'
                              : 'text-gray-400'
                        }`}
                      >
                        {cell.day}
                      </span>
                      {items.length > 0 && (
                        <span className={`text-[10px] ${hasOverdue ? 'text-red-600' : 'text-amber-700'}`}>
                          {items.length}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {items.slice(0, 2).map((deal) => (
                        <div
                          key={deal.id}
                          className={`truncate text-[10px] px-1 py-0.5 rounded ${
                            deal.follow_up_date && isOverdue(deal.follow_up_date)
                              ? 'bg-red-50 text-red-700'
                              : 'bg-amber-50 text-amber-800'
                          }`}
                        >
                          {deal.owner_name}
                        </div>
                      ))}
                      {items.length > 2 && (
                        <div className="text-[10px] text-gray-400 px-1">+{items.length - 2} more</div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          <aside className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 flex flex-col min-h-0">
            <h2 className="text-sm font-semibold text-gray-900">{formatDateKey(selectedKey)}</h2>
            <p className="text-xs text-gray-400 mt-0.5 mb-3">
              {selectedDeals.length === 0
                ? 'No follow-ups on this day'
                : `${selectedDeals.length} follow-up${selectedDeals.length === 1 ? '' : 's'}`}
            </p>

            <div className="flex-1 overflow-y-auto space-y-2 mb-4">
              {selectedDeals.map((deal) => (
                <div key={deal.id} className="border border-gray-100 rounded-lg p-2.5">
                  <button
                    type="button"
                    onClick={() => onOpenLead(deal)}
                    className="w-full text-left"
                  >
                    <div className="text-sm font-medium text-gray-900">{deal.owner_name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {[deal.tract_abstract, countyLabel(deal), TAG_LABELS[dealTag(deal)] ?? dealTag(deal)]
                        .filter(Boolean)
                        .join('  ·  ')}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSetFollowUp(deal, null)}
                    className="mt-2 text-xs text-gray-500 hover:text-red-600"
                  >
                    Clear date
                  </button>
                </div>
              ))}
            </div>

            <div className="border-t border-gray-100 pt-3">
              <label className="block text-xs font-medium text-gray-600 mb-1.5" htmlFor="crm-schedule-lead">
                Schedule a follow-up
              </label>
              <select
                id="crm-schedule-lead"
                value={scheduleId}
                onChange={(e) => setScheduleId(e.target.value)}
                className="w-full appearance-none px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-md text-gray-700 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
              >
                <option value="">Choose a lead</option>
                {unscheduled.length > 0 && (
                  <optgroup label="No date yet">
                    {unscheduled.map((deal) => (
                      <option key={deal.id} value={deal.id}>{deal.owner_name}</option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Move existing">
                  {deals.filter((d) => d.follow_up_date).map((deal) => (
                    <option key={deal.id} value={deal.id}>{deal.owner_name}</option>
                  ))}
                </optgroup>
              </select>
              <button
                type="button"
                onClick={() => void schedule()}
                disabled={!scheduleId || busy}
                className="mt-2 w-full px-2.5 py-1.5 text-xs font-medium rounded-md bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 disabled:hover:bg-amber-500"
              >
                {busy ? 'Saving...' : 'Set follow-up'}
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
