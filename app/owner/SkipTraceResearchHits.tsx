'use client'

import { Bot, Phone } from 'lucide-react'
import type { ResearchStats } from '@/lib/skip-trace-research-stats'
import { methodLabel, providerLabel } from '@/lib/skip-trace-research-stats'

function formatWhen(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const delta = Date.now() - ms
  if (delta < 60_000) return 'just now'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`
  return new Date(ms).toLocaleString()
}

export default function SkipTraceResearchHits({
  stats,
  loading,
}: {
  stats: ResearchStats
  loading?: boolean
}) {
  const hasHits = stats.recentHits.length > 0

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg font-bold text-gray-900 flex items-center gap-2">
            <Bot size={18} className="text-emerald-600" />
            Researcher hits
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Background unwrap of trusts and Texas LLC officers, then a paid
            skip-trace retry. Numbers land on the CRM and shared cache.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${
            stats.hitsToday > 0
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-gray-50 text-gray-600 border-gray-200'
          }`}
        >
          <Phone size={12} />
          {stats.hitsToday} today
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-gray-100 border-b border-gray-100">
        {[
          { label: 'Numbers found', value: stats.hits, hint: 'Resolved by the researcher' },
          { label: 'Found today', value: stats.hitsToday, hint: 'Since midnight' },
          { label: 'Still in queue', value: stats.queued, hint: 'Waiting or retrying' },
          { label: 'Tried, no phone', value: stats.misses, hint: 'Will retry later' },
        ].map((card) => (
          <div key={card.label} className="px-5 py-4">
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              {card.label}
            </div>
            <div className="font-serif text-2xl font-bold text-gray-900 mt-1">
              {loading ? '—' : card.value.toLocaleString()}
            </div>
            <div className="text-[11px] text-gray-400 mt-1">{card.hint}</div>
          </div>
        ))}
      </div>

      {(stats.byProvider.length > 0 || stats.byMethod.length > 0) && (
        <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap gap-6">
          {stats.byProvider.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Provider
              </div>
              <div className="flex flex-wrap gap-1.5">
                {stats.byProvider.map((row) => (
                  <span
                    key={row.name}
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-50 text-slate-700 border border-slate-200"
                  >
                    {row.name} {row.count}
                  </span>
                ))}
              </div>
            </div>
          )}
          {stats.byMethod.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                How it hit
              </div>
              <div className="flex flex-wrap gap-1.5">
                {stats.byMethod.map((row) => (
                  <span
                    key={row.name}
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200"
                  >
                    {row.name} {row.count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-sm text-gray-400">Loading...</div>
      ) : !hasHits ? (
        <div className="p-8 text-center text-sm text-gray-400">
          No researcher numbers yet. Open misses are retried every 15 minutes.
        </div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Owner', 'Phone', 'Provider', 'How', 'When'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stats.recentHits.map((hit) => (
                <tr key={hit.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-sm font-medium text-gray-900">
                    {hit.ownerName}
                    {hit.person ? (
                      <div className="text-xs text-gray-400 font-normal">
                        Matched {hit.person}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-gray-800 whitespace-nowrap">
                    {hit.phones[0] || '—'}
                    {hit.phones.length > 1 ? (
                      <div className="text-[11px] text-gray-400">
                        +{hit.phones.length - 1} more
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-semibold text-slate-700">
                    {providerLabel(hit.provider)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">
                    {methodLabel(hit.method)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                    {formatWhen(hit.at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
