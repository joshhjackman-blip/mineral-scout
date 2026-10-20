'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Flame, Pause, Play } from 'lucide-react'
import { COUNTIES } from '@/lib/counties'
import type { QuotaProviderStatus } from '@/lib/skip-trace-quota'
import {
  clampQuotaTarget,
  quotaTargetPresets,
  quotaTargetStep,
} from '@/lib/skip-trace-quota-target'
import CollapsiblePanel from './CollapsiblePanel'
import { PREVIEW_QUOTA, shouldLoadPreviewReviews } from './preview-reviews'

type QuotaPayload = { providers?: QuotaProviderStatus[]; error?: string }

const CAD_COUNTY_ORDER = Object.values(COUNTIES).map((county) => county.name)

function pct(used: number, quota: number): number {
  if (quota <= 0) return 0
  return Math.min(100, Math.round((used / quota) * 100))
}

function statusLabel(status: QuotaProviderStatus): string {
  if (status.job?.status === 'running') return 'Burning leftover credits'
  if (status.job?.status === 'paused') return 'Paused'
  if (status.job?.status === 'queued') return 'Queued'
  if (status.remaining <= 0) return 'Quota used this month'
  return `${status.remaining.toLocaleString()} prepaid lookups left`
}

function presetLabel(value: number, remaining: number): string {
  if (value >= remaining) return 'All leftover'
  return value.toLocaleString()
}

export default function SkipTraceQuotaBurn() {
  const [providers, setProviders] = useState<QuotaProviderStatus[]>([])
  const [targets, setTargets] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (shouldLoadPreviewReviews()) {
      setProviders(PREVIEW_QUOTA)
      setLoading(false)
      return
    }
    try {
      const res = await fetch('/api/owner/skiptrace-quota', { cache: 'no-store' })
      const json = (await res.json()) as { data?: QuotaPayload; error?: string }
      setProviders(json.data?.providers ?? [])
      if (!res.ok && json.error) setMessage(json.error)
    } catch {
      setProviders([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => {
      void load()
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    setTargets((prev) => {
      const next = { ...prev }
      let changed = false
      for (const row of providers) {
        const clamped = clampQuotaTarget(row.remaining, prev[row.provider] ?? row.remaining)
        if (next[row.provider] !== clamped) {
          next[row.provider] = clamped
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [providers])

  const run = async (
    action: 'start' | 'pause' | 'resume' | 'tick',
    provider?: QuotaProviderStatus['provider'],
  ) => {
    const targetCount =
      provider != null ? clampQuotaTarget(
        providers.find((row) => row.provider === provider)?.remaining ?? 0,
        targets[provider],
      ) : undefined
    if (shouldLoadPreviewReviews()) {
      if (action === 'start' && provider && targetCount) {
        const label = providers.find((row) => row.provider === provider)?.label ?? provider
        setMessage(`Preview only. Live dashboard would burn ${targetCount.toLocaleString()} ${label} lookups.`)
        return
      }
      setMessage('Preview only — live burn is on the owner dashboard.')
      return
    }
    setBusy(`${action}:${provider ?? 'all'}`)
    setMessage(null)
    try {
      const res = await fetch('/api/owner/skiptrace-quota', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, provider, targetCount }),
      })
      const json = (await res.json()) as { data?: QuotaPayload; error?: string }
      if (json.data?.providers) setProviders(json.data.providers)
      if (!res.ok) {
        setMessage(json.error || 'Could not update prepaid burn')
        return
      }
      if (action === 'start') {
        setMessage(
          `Burn started for ${targetCount?.toLocaleString() ?? ''} lookups. Cron spends them every 5 minutes until this job finishes or you pause it.`,
        )
      }
      if (action === 'tick') {
        setMessage('Ran one batch. Cron keeps going every 5 minutes while a job is running.')
      }
    } catch {
      setMessage('Could not update prepaid burn')
    } finally {
      setBusy(null)
    }
  }

  const remaining = providers.reduce((sum, row) => sum + row.remaining, 0)
  const countyList = useMemo(() => CAD_COUNTY_ORDER.join(' → '), [])

  return (
    <CollapsiblePanel
      title="Prepaid skip-trace burn"
      subtitle="idiCORE (12,500) and Accurate Append (3,333) do not roll over. Slide how many leftover lookups to spend into the shared cache. Not billed to customers. CAD names are not dumped into the miss queue."
      icon={<Flame size={18} className="text-orange-600" />}
      defaultOpen
      badge={
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-orange-50 text-orange-800 border border-orange-200">
          {remaining.toLocaleString()} left
        </span>
      }
    >
      <div className="px-6 py-3 border-t border-gray-100 text-xs text-gray-600 space-y-2">
        <p>
          <span className="font-semibold text-gray-800">Where it picks:</span> CRM
          deals with a mailing address and no phone first (newest activity). If
          that pool is too small, it walks CAD mineral rolls county by county:{' '}
          {countyList}. It skips anyone already in the shared cache with a
          phone, already attempted this month on this provider, missing an
          address, or — for idiCORE — companies.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2 text-gray-500">
          <p>
            Live user skip-traces already count against these totals. Cache hits stay free.
            Cron burns about 40 lookups every 5 minutes (~11,500/day).
          </p>
          {providers.some((row) => row.job?.status === 'running') ? (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => {
                void run('tick')
              }}
              className="shrink-0 inline-flex items-center text-xs font-semibold px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 disabled:text-gray-400"
            >
              {busy === 'tick:all' ? 'Running batch…' : 'Run a batch now'}
            </button>
          ) : null}
        </div>
      </div>

      {message ? (
        <div className="mx-6 mb-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          {message}
        </div>
      ) : null}

      {loading ? (
        <div className="p-8 text-center text-sm text-gray-400">Loading prepaid quotas…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100 border-t border-gray-100">
          {providers.map((row) => {
            const usedPct = pct(row.used, row.quota)
            const jobPct = row.job
              ? pct(row.job.processed, Math.max(1, row.job.target_count))
              : 0
            const starting = busy === `start:${row.provider}`
            const pausing = busy === `pause:${row.provider}`
            const resuming = busy === `resume:${row.provider}`
            const selected = clampQuotaTarget(row.remaining, targets[row.provider] ?? row.remaining)
            const step = quotaTargetStep(row.remaining)
            const canStart = !row.job && row.remaining > 0
            return (
              <div key={row.provider} className="px-6 py-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-serif text-lg font-bold text-gray-900">{row.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{statusLabel(row)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-serif text-2xl font-bold text-gray-900">
                      {row.remaining.toLocaleString()}
                    </div>
                    <div className="text-[11px] text-gray-400">
                      of {row.quota.toLocaleString()} prepaid
                    </div>
                  </div>
                </div>

                <div className="mt-3 h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full bg-orange-500"
                    style={{ width: `${usedPct}%` }}
                  />
                </div>
                <div className="mt-1 text-[11px] text-gray-400">
                  {row.used.toLocaleString()} live lookups used this month
                </div>

                {row.job ? (
                  <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                    <div className="flex items-center justify-between text-xs text-gray-600">
                      <span>
                        Job {row.job.status}: {row.job.processed.toLocaleString()} /{' '}
                        {row.job.target_count.toLocaleString()}
                      </span>
                      <span>
                        {row.job.hits.toLocaleString()} hit · {row.job.misses.toLocaleString()} miss
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-white overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${jobPct}%` }} />
                    </div>
                    {row.job.last_error ? (
                      <div className="mt-1 text-[11px] text-red-600">{row.job.last_error}</div>
                    ) : null}
                  </div>
                ) : null}

                {canStart ? (
                  <div className="mt-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <label
                        htmlFor={`quota-burn-${row.provider}`}
                        className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider"
                      >
                        Lookups to burn
                      </label>
                      <div className="font-serif text-xl font-bold text-gray-900">
                        {selected.toLocaleString()}
                      </div>
                    </div>
                    <input
                      id={`quota-burn-${row.provider}`}
                      type="range"
                      min={1}
                      max={row.remaining}
                      step={step}
                      value={selected}
                      onChange={(event) => {
                        setTargets((prev) => ({
                          ...prev,
                          [row.provider]: clampQuotaTarget(
                            row.remaining,
                            Number(event.target.value),
                          ),
                        }))
                      }}
                      className="mt-2 w-full accent-orange-500"
                    />
                    <div className="flex justify-between text-[11px] text-gray-400 mt-1">
                      <span>1</span>
                      <span>{row.remaining.toLocaleString()} leftover</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {quotaTargetPresets(row.remaining).map((value) => {
                        const active = selected === value
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => {
                              setTargets((prev) => ({
                                ...prev,
                                [row.provider]: value,
                              }))
                            }}
                            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                              active
                                ? 'bg-orange-50 text-orange-800 border-orange-200'
                                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            {presetLabel(value, row.remaining)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  {canStart ? (
                    <button
                      type="button"
                      disabled={Boolean(busy) || selected <= 0}
                      onClick={() => {
                        void run('start', row.provider)
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-gray-900 text-white disabled:bg-gray-200 disabled:text-gray-400"
                    >
                      <Play size={12} />
                      {starting ? 'Starting…' : `Burn ${selected.toLocaleString()}`}
                    </button>
                  ) : null}
                  {row.job?.status === 'running' || row.job?.status === 'queued' ? (
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => {
                        void run('pause', row.provider)
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 disabled:text-gray-400"
                    >
                      <Pause size={12} />
                      {pausing ? 'Pausing…' : 'Pause'}
                    </button>
                  ) : null}
                  {row.job?.status === 'paused' ? (
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => {
                        void run('resume', row.provider)
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-gray-900 text-white disabled:bg-gray-200"
                    >
                      <Play size={12} />
                      {resuming ? 'Resuming…' : 'Resume'}
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </CollapsiblePanel>
  )
}
