'use client'

import { useEffect, useState } from 'react'

interface PricePoint {
  symbol: string
  label: string
  price: number | null
  change: number | null
  changePct: number | null
  fiftyTwoWeekHigh: number | null
  fiftyTwoWeekLow: number | null
  currency: string | null
  updatedAt: number | null
}

interface MarketPricesResponse {
  ok: boolean
  updatedAt: string
  wti: PricePoint | null
  naturalGas: PricePoint | null
}

// Sidebar widget on the "All Counties" view. Pulls WTI Crude and
// Henry Hub Natural Gas futures from /api/market/prices every 60s.
// Kept intentionally lightweight — three lines per commodity
// (label, price, change), no charts, so it doesn't compete with
// the county list below it for attention. The data is meant to be
// glanceable context ("is the market up or down today?"), not
// tradeable.
//
// If the API returns null for either quote (Yahoo hiccup, network
// blip) the row shows an em dash instead of a stale price to keep
// the display honest.

export default function MarketPricesWidget() {
  const [data, setData] = useState<MarketPricesResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch('/api/market/prices', { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        const json = (await res.json()) as MarketPricesResponse
        if (!cancelled) setData(json)
      } catch {
        if (!cancelled) setData(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    tick()
    const interval = setInterval(tick, 60_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return (
    <div style={{
      background: '#0F172A',
      color: '#F8FAFC',
      borderRadius: 10,
      padding: '14px 16px 16px',
      marginBottom: 16,
      fontFamily: 'Geist, Inter, system-ui, sans-serif',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <div style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: '#94A3B8',
        }}>
          Commodity Prices
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
            background: loading ? '#F59E0B' : (data?.ok && (data.wti?.price || data.naturalGas?.price)) ? '#10B981' : '#EF4444',
            boxShadow: '0 0 4px currentColor',
            display: 'inline-block',
          }} />
          <span>{loading ? 'Fetching' : (data?.ok && (data.wti?.price || data.naturalGas?.price)) ? 'Live' : 'Offline'}</span>
        </div>
      </div>

      <PriceRow point={data?.wti ?? null} />
      <div style={{ height: 1, background: 'rgba(148,163,184,0.15)', margin: '10px 0' }} />
      <PriceRow point={data?.naturalGas ?? null} unit="$/MMBtu" />

      <div style={{
        marginTop: 12,
        fontSize: 9.5,
        color: '#64748B',
        letterSpacing: '0.02em',
      }}>
        Front-month NYMEX futures · updates every minute
      </div>
    </div>
  )
}

function PriceRow({ point, unit = '$/bbl' }: { point: PricePoint | null; unit?: string }) {
  const hasPrice = point && typeof point.price === 'number'
  const changePct = point?.changePct ?? null
  const up = changePct !== null && changePct > 0
  const down = changePct !== null && changePct < 0
  const flat = changePct !== null && changePct === 0
  const arrow = up ? '▲' : down ? '▼' : flat ? '—' : ''
  const color = up ? '#34D399' : down ? '#F87171' : '#94A3B8'

  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 11,
          color: '#CBD5E1',
          fontWeight: 500,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {point?.label ?? '—'}
        </div>
        <div style={{
          fontSize: 9,
          color: '#64748B',
          marginTop: 1,
          letterSpacing: '0.04em',
        }}>
          {unit}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{
          fontFamily: '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace',
          fontSize: 20,
          fontWeight: 600,
          color: '#F8FAFC',
          lineHeight: 1.1,
          fontVariantNumeric: 'tabular-nums lining-nums',
        }}>
          {hasPrice ? `$${point!.price!.toFixed(2)}` : '—'}
        </div>
        {changePct !== null && (
          <div style={{
            fontFamily: '"Geist Mono", ui-monospace, monospace',
            fontSize: 11,
            color,
            marginTop: 2,
            fontVariantNumeric: 'tabular-nums lining-nums',
          }}>
            <span style={{ marginRight: 3 }}>{arrow}</span>
            <span>{changePct > 0 ? '+' : ''}{changePct.toFixed(2)}%</span>
          </div>
        )}
      </div>
    </div>
  )
}
