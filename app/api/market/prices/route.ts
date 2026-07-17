import { NextResponse } from 'next/server'

// Server-side proxy for a small handful of live futures prices we
// surface in the "All Counties" sidebar. We proxy rather than
// hitting Yahoo Finance directly from the browser because that
// endpoint doesn't set permissive CORS headers.
//
// Runtime notes:
//   - `revalidate = 60`     -> Next caches the response for 60s
//                             so back-to-back client polls stay
//                             cheap and Yahoo doesn't see us as
//                             a hammering client.
//   - Fetches the two symbols in parallel via Promise.all
//   - Returns `{ ok, updatedAt, wti, naturalGas, error? }`; the
//     widget component handles any partial-null case.
//   - No API key. If Yahoo ever tightens or rate-limits this we
//     can drop in a paid feed (EIA, Twelve Data, Financial
//     Modeling Prep) behind the same interface.

export const revalidate = 60
export const dynamic = 'force-dynamic'

interface YahooChartResult {
  meta?: {
    regularMarketPrice?: number
    previousClose?: number
    chartPreviousClose?: number
    regularMarketDayHigh?: number
    regularMarketDayLow?: number
    fiftyTwoWeekHigh?: number
    fiftyTwoWeekLow?: number
    regularMarketTime?: number
    currency?: string
    symbol?: string
  }
}

interface YahooChartResponse {
  chart?: {
    result?: YahooChartResult[]
    error?: { code: string; description: string } | null
  }
}

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

async function fetchQuote(symbol: string, label: string): Promise<PricePoint> {
  const empty: PricePoint = {
    symbol, label, price: null, change: null, changePct: null,
    fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, currency: null, updatedAt: null,
  }
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MineralScout/1.0)',
        Accept: 'application/json',
      },
      next: { revalidate: 60 },
    })
    if (!res.ok) return empty
    const data = (await res.json()) as YahooChartResponse
    const meta = data.chart?.result?.[0]?.meta
    if (!meta) return empty
    const price = typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : null
    // Yahoo returns `chartPreviousClose` reliably; `previousClose` is
    // often missing on futures. Fall through to whichever is set.
    const prev = typeof meta.previousClose === 'number'
      ? meta.previousClose
      : typeof meta.chartPreviousClose === 'number'
        ? meta.chartPreviousClose
        : null
    const change = price !== null && prev !== null ? price - prev : null
    const changePct = price !== null && prev !== null && prev !== 0
      ? ((price - prev) / prev) * 100
      : null
    return {
      symbol,
      label,
      price,
      change,
      changePct,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
      currency: meta.currency ?? 'USD',
      updatedAt: typeof meta.regularMarketTime === 'number' ? meta.regularMarketTime * 1000 : null,
    }
  } catch {
    return empty
  }
}

export async function GET() {
  const [wti, naturalGas] = await Promise.all([
    fetchQuote('CL=F', 'WTI Crude'),
    fetchQuote('NG=F', 'Henry Hub Natural Gas'),
  ])
  return NextResponse.json({
    ok: true,
    updatedAt: new Date().toISOString(),
    wti,
    naturalGas,
  }, {
    // Client-side cache for 30 seconds, server-side edge cache for
    // 60 seconds with 5-minute stale-while-revalidate window so a
    // Yahoo hiccup doesn't blank out the widget instantly.
    headers: {
      'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
    },
  })
}
