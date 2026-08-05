'use client'

import { useEffect, useState } from 'react'

interface CountyBreakdown {
  countyId: string
  displayName: string
  activeRigs: number
  newPermits: number
  completions: number
}

interface BasinActivityResponse {
  ok: boolean
  updatedAt: string
  totals: {
    activeRigs: number
    newPermits: number
    completions: number
  }
  windows: {
    rigLookbackDays: number
    permitLookbackDays: number
    completionLookbackDays: number
  }
  counties: CountyBreakdown[]
}

// Sidebar widget rendering aggregate drilling activity across
// every active county. Sourced from /api/basin/activity, which
// queries the per-county <county>_permits tables and returns
// three counts (active rigs, new permits, completions) plus a
// per-county breakdown for the expandable footer.
//
// Poll cadence: every 5 minutes. Permits ship overnight from the
// RRC EWA scrape and rigs move on weekly cycles, so pounding this
// more aggressively wouldn't surface newer data — the network cost
// would just eat into free-tier headroom.

export default function BasinActivityWidget() {
  const [data, setData] = useState<BasinActivityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch('/api/basin/activity', { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        const json = (await res.json()) as BasinActivityResponse
        if (!cancelled) setData(json)
      } catch {
        if (!cancelled) setData(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    tick()
    const interval = setInterval(tick, 5 * 60_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const totals = data?.totals ?? { activeRigs: 0, newPermits: 0, completions: 0 }
  const nonZero = totals.activeRigs + totals.newPermits + totals.completions > 0

  const permitWindow = data?.windows.permitLookbackDays ?? 30
  const completionWindow = data?.windows.completionLookbackDays ?? 30

  return (
    <div style={{
      background: 'var(--mm-chrome-panel)',
      border: '1px solid var(--mm-chrome-border)',
      borderRadius: 10,
      padding: '14px 16px 12px',
      marginBottom: 16,
      fontFamily: 'Geist, Inter, system-ui, sans-serif',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      color: 'var(--mm-chrome-fg)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <div style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--mm-chrome-muted)',
        }}>
          Basin Activity
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 9,
          color: '#94A3B8',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: loading ? '#F59E0B' : (data?.ok ? '#10B981' : '#EF4444'),
            boxShadow: '0 0 4px currentColor',
            display: 'inline-block',
          }} />
          <span>{loading ? 'Fetching' : (data?.ok ? 'Live' : 'Offline')}</span>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 8,
      }}>
        <StatCell
          value={totals.activeRigs}
          label="Rigs drilling"
          sublabel="active"
          color="#DC2626"
        />
        <StatCell
          value={totals.newPermits}
          label="New permits"
          sublabel={`last ${permitWindow}d`}
          color="#2563EB"
        />
        <StatCell
          value={totals.completions}
          label="Completions"
          sublabel={`last ${completionWindow}d`}
          color="#059669"
        />
      </div>

      {nonZero && data && data.counties.length > 0 && (
        <>
          <button
            onClick={() => setExpanded((prev) => !prev)}
            style={{
              marginTop: 12,
              width: '100%',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 0',
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--mm-chrome-muted)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            <span>Breakdown by county</span>
            <span style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
          </button>
          {expanded && (
            <div style={{ marginTop: 6, borderTop: '1px solid var(--mm-chrome-border)', paddingTop: 8 }}>
              {data.counties.map((c) => (
                <div key={c.countyId} style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto auto',
                  columnGap: 10,
                  padding: '4px 0',
                  alignItems: 'baseline',
                }}>
                  <span style={{ fontSize: 11, color: 'var(--mm-chrome-fg)', fontWeight: 500 }}>
                    {c.displayName.replace(' County, TX', '')}
                  </span>
                  <span style={{
                    fontFamily: '"Geist Mono", ui-monospace, monospace',
                    fontSize: 11,
                    color: '#DC2626',
                    fontVariantNumeric: 'tabular-nums lining-nums',
                    minWidth: 24,
                    textAlign: 'right',
                  }}>{c.activeRigs}</span>
                  <span style={{
                    fontFamily: '"Geist Mono", ui-monospace, monospace',
                    fontSize: 11,
                    color: '#2563EB',
                    fontVariantNumeric: 'tabular-nums lining-nums',
                    minWidth: 24,
                    textAlign: 'right',
                  }}>{c.newPermits}</span>
                  <span style={{
                    fontFamily: '"Geist Mono", ui-monospace, monospace',
                    fontSize: 11,
                    color: '#059669',
                    fontVariantNumeric: 'tabular-nums lining-nums',
                    minWidth: 24,
                    textAlign: 'right',
                  }}>{c.completions}</span>
                </div>
              ))}
              <div style={{
                marginTop: 4,
                fontSize: 9,
                color: '#94A3B8',
                letterSpacing: '0.04em',
              }}>
                Columns: rigs · permits · completions
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function StatCell({ value, label, sublabel, color }: { value: number; label: string; sublabel: string; color: string }) {
  return (
    <div style={{
      background: 'var(--mm-chrome-muted-fill)',
      border: '1px solid var(--mm-chrome-border)',
      borderRadius: 8,
      padding: '10px 8px',
      textAlign: 'center',
    }}>
      <div style={{
        fontFamily: '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace',
        fontSize: 22,
        fontWeight: 600,
        color,
        lineHeight: 1.1,
        fontVariantNumeric: 'tabular-nums lining-nums',
      }}>
        {value.toLocaleString()}
      </div>
      <div style={{
        fontSize: 10,
        color: 'var(--mm-chrome-fg)',
        fontWeight: 600,
        marginTop: 6,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 9,
        color: 'var(--mm-chrome-muted)',
        marginTop: 1,
        letterSpacing: '0.02em',
      }}>
        {sublabel}
      </div>
    </div>
  )
}
