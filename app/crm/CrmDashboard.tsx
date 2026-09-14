'use client'

import type { ReactNode } from 'react'
import { Clock, MapPin, PhoneOff, User } from 'lucide-react'
import { COUNTIES } from '@/lib/counties'
import type { CountyKey } from '@/lib/counties'
import type { Deal } from './crm-utils'
import {
  buildDashboardStats,
  countyLabel,
  dealTag,
  formatDate,
  isOverdue,
  TAG_LABELS,
} from './crm-utils'

export type DashboardOpenFilter = {
  tag?: string
  county?: CountyKey
  followUp?: 'overdue' | 'upcoming'
  needContact?: boolean
  waitingOnNumber?: boolean
}

type CrmDashboardProps = {
  deals: Deal[]
  onOpenLead: (deal: Deal) => void
  onOpenFilter: (filter: DashboardOpenFilter) => void
  onOpenCalendar: () => void
}

export default function CrmDashboard({ deals, onOpenLead, onOpenFilter, onOpenCalendar }: CrmDashboardProps) {
  const stats = buildDashboardStats(deals)
  const stageMax = Math.max(1, ...stats.byStage.map((s) => s.count))
  const countyMax = Math.max(1, ...stats.byCounty.map((s) => s.count))

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="max-w-6xl mx-auto px-5 py-5 space-y-5">
        <div>
          <h1 className="text-lg font-serif font-semibold text-gray-900">Pipeline home</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Snapshot of your mineral leads. Open a card or row to jump into the workspace.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-3">
          <Kpi
            label="Open pipeline"
            value={stats.open}
            hint={`${stats.total} total`}
            onClick={() => onOpenFilter({})}
          />
          <Kpi
            label="Hot"
            value={stats.hot}
            tone="text-red-600"
            onClick={() => onOpenFilter({ tag: 'hot' })}
          />
          <Kpi
            label="Overdue follow-ups"
            value={stats.overdue}
            tone="text-amber-600"
            onClick={() => onOpenFilter({ followUp: 'overdue' })}
          />
          <Kpi
            label="Need skip trace"
            value={stats.needContact}
            onClick={() => onOpenFilter({ needContact: true })}
          />
          <Kpi
            label="Waiting on a number"
            value={stats.waitingOnNumber}
            tone="text-amber-600"
            onClick={() => onOpenFilter({ waitingOnNumber: true })}
          />
          <Kpi
            label="Offers sent"
            value={stats.offers}
            onClick={() => onOpenFilter({ tag: 'offer_sent' })}
          />
          <Kpi
            label="Closed won"
            value={stats.closedWon}
            tone="text-emerald-600"
            onClick={() => onOpenFilter({ tag: 'closed_won' })}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Pipeline by status</h2>
            {stats.total === 0 ? (
              <EmptyNote text="Add owners from the map to populate the pipeline." />
            ) : (
              <div className="space-y-2">
                {stats.byStage.map((stage) => (
                  <button
                    key={stage.key}
                    type="button"
                    onClick={() => onOpenFilter({ tag: stage.key })}
                    className="w-full text-left group"
                  >
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-gray-600 group-hover:text-gray-900">{stage.label}</span>
                      <span className="font-medium text-gray-900">{stage.count}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-400 rounded-full"
                        style={{ width: `${(stage.count / stageMax) * 100}%` }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Leads by county</h2>
            {stats.byCounty.length === 0 ? (
              <EmptyNote text="County mix appears once leads are in the CRM." />
            ) : (
              <div className="space-y-2">
                {stats.byCounty.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => {
                      if (row.id !== 'unknown' && row.id in COUNTIES) {
                        onOpenFilter({ county: row.id as CountyKey })
                      } else {
                        onOpenFilter({})
                      }
                    }}
                    className="w-full text-left group"
                  >
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="inline-flex items-center gap-1 text-gray-600 group-hover:text-gray-900">
                        <MapPin size={11} />
                        {row.label}
                      </span>
                      <span className="font-medium text-gray-900">{row.count}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gray-700 rounded-full"
                        style={{ width: `${(row.count / countyMax) * 100}%` }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
          <LeadList
            title="Follow-up queue"
            action={{ label: 'Open calendar', onClick: onOpenCalendar }}
            empty="No follow-up dates set."
            deals={stats.followUps}
            onOpenLead={onOpenLead}
            renderMeta={(deal) =>
              deal.follow_up_date ? (
                <span className={isOverdue(deal.follow_up_date) ? 'text-red-600' : 'text-amber-600'}>
                  <Clock size={10} className="inline mr-1" />
                  {formatDate(deal.follow_up_date)}
                </span>
              ) : null
            }
          />
          <LeadList
            title="Waiting on a number"
            empty="No skip traces waiting on a phone."
            deals={stats.waitingOnNumberDeals}
            onOpenLead={onOpenLead}
            renderMeta={() => (
              <span className="inline-flex items-center gap-1 text-amber-700">
                <PhoneOff size={10} />
                Bad skip trace
              </span>
            )}
          />
          <LeadList
            title="Needs skip trace"
            empty="Every lead has a phone or email."
            deals={stats.missingContact}
            onOpenLead={onOpenLead}
            renderMeta={() => (
              <span className="inline-flex items-center gap-1 text-gray-400">
                <PhoneOff size={10} />
                No contact
              </span>
            )}
          />
          <LeadList
            title="Recently updated"
            empty="No recent activity."
            deals={stats.recent}
            onOpenLead={onOpenLead}
            renderMeta={(deal) => (
              <span>{TAG_LABELS[dealTag(deal)] ?? dealTag(deal)}</span>
            )}
          />
        </div>
      </div>
    </div>
  )
}

function Kpi({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string
  value: number
  hint?: string
  tone?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-white border border-gray-200 rounded-xl shadow-sm px-3 py-3 text-left hover:border-amber-300 hover:shadow transition-all"
    >
      <div className={`text-2xl font-serif font-bold leading-none ${tone ?? 'text-gray-900'}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1.5">{label}</div>
      {hint ? <div className="text-[11px] text-gray-400 mt-0.5">{hint}</div> : null}
    </button>
  )
}

function EmptyNote({ text }: { text: string }) {
  return <p className="text-sm text-gray-400 py-6 text-center">{text}</p>
}

function LeadList({
  title,
  action,
  empty,
  deals,
  onOpenLead,
  renderMeta,
}: {
  title: string
  action?: { label: string; onClick: () => void }
  empty: string
  deals: Deal[]
  onOpenLead: (deal: Deal) => void
  renderMeta: (deal: Deal) => ReactNode
}) {
  return (
    <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 flex flex-col min-h-[280px]">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            className="text-xs text-amber-700 hover:text-amber-800"
          >
            {action.label}
          </button>
        ) : null}
      </div>
      {deals.length === 0 ? (
        <EmptyNote text={empty} />
      ) : (
        <ul className="divide-y divide-gray-100">
          {deals.map((deal) => (
            <li key={deal.id}>
              <button
                type="button"
                onClick={() => onOpenLead(deal)}
                className="w-full text-left py-2 hover:bg-gray-50 rounded-md px-1 -mx-1"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-gray-900 truncate inline-flex items-center gap-1.5">
                    <User size={12} className="text-gray-400 shrink-0" />
                    {deal.owner_name}
                  </span>
                  <span className="text-[11px] text-gray-500 shrink-0">{renderMeta(deal)}</span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5 truncate pl-[18px]">
                  {[deal.tract_abstract, countyLabel(deal)].filter(Boolean).join('  ·  ')}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
