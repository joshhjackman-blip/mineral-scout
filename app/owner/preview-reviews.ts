import type { SkipTraceReview } from '@/lib/skip-trace-review'

export const PREVIEW_REVIEWS: SkipTraceReview[] = [
  {
    id: 'preview-review-1',
    owner_name: 'Linda Kay Pruitt',
    owner_name_key: 'LINDA KAY PRUITT',
    mailing_address: '412 W 8th St',
    mailing_city: 'Odessa',
    mailing_state: 'TX',
    mailing_zip: '79761',
    county: 'midland',
    tract_abstract: 'A-55',
    requested_by_email: 'broker@example.com',
    emails: [],
    phones: [],
    status: 'open',
    created_at: new Date(Date.now() - 86400000).toISOString(),
    updated_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'preview-review-2',
    owner_name: 'Pecos Mineral Holdings LLC',
    owner_name_key: 'PECOS MINERAL HOLDINGS LLC',
    mailing_address: '600 N Marienfeld St',
    mailing_city: 'Midland',
    mailing_state: 'TX',
    mailing_zip: '79701',
    county: 'midland',
    tract_abstract: 'A-210',
    requested_by_email: 'land@example.com',
    emails: ['office@pecos.example'],
    phones: ['(432) 555-0100'],
    reason: 'wrong_number',
    status: 'open',
    created_at: new Date(Date.now() - 3600000).toISOString(),
    updated_at: new Date(Date.now() - 3600000).toISOString(),
  },
]

export const PREVIEW_USAGE = {
  month: '2026-10',
  callVolume: {
    callClicks: 12,
    skipTraces: 78,
    skipTraceHits: 49,
    skipTraceMisses: 29,
    billableSkipTraces: 0,
  },
  skipTraceBilling: { billableCount: 0, amountUsd: 0, unitPriceUsd: 1 },
  wrongNumbers: { open: 1, thisMonth: 0 },
  monthlyDollars: {
    closedDealCount: 0,
    closedDealVolume: 0,
    estimatedSuccessFee: 0,
  },
  email: { sent: 0 },
  teams: [
    {
      owner_id: 'preview-great-plains',
      owner_email: 'jordan@greatplainsinterests.com',
      seat_count: 4,
      member_count: 3,
      skip_traces: 78,
      skip_trace_hits: 49,
      skip_trace_misses: 29,
      billable_skip_traces: 0,
      skip_trace_amount_usd: 0,
      skip_trace_waived: true,
      call_clicks: 12,
      emails_sent: 0,
      closed_deal_count: 0,
      closed_deal_volume: 0,
      estimated_success_fee: 0,
      wrong_numbers: 0,
      members: [
        {
          user_id: 'preview-quatrocone',
          email: 'quatrocone@example.com',
          role: 'member' as const,
          skip_traces: 73,
          hits: 45,
          misses: 28,
        },
        {
          user_id: 'preview-jordan',
          email: 'jordan@greatplainsinterests.com',
          role: 'admin' as const,
          skip_traces: 5,
          hits: 4,
          misses: 1,
        },
        {
          user_id: 'preview-bskyburch',
          email: 'bskyburch@example.com',
          role: 'member' as const,
          skip_traces: 0,
          hits: 0,
          misses: 0,
        },
        {
          user_id: 'preview-mtf',
          email: 'mtfminerals@example.com',
          role: 'member' as const,
          skip_traces: 0,
          hits: 0,
          misses: 0,
        },
      ],
    },
  ],
}

export const PREVIEW_RESEARCH = {
  queued: 2,
  hits: 2,
  misses: 1,
  hitsToday: 1,
  byProvider: [
    { name: 'idiCORE', count: 1 },
    { name: 'Accurate Append', count: 1 },
  ],
  byMethod: [
    { name: 'TX officer · PRESIDENT', count: 1 },
    { name: 'Tax-roll full name', count: 1 },
  ],
  recentHits: [
    {
      id: 'preview-hit-1',
      ownerName: 'BROWN ROYALTIES INC',
      phones: ['3255550199'],
      emails: [],
      provider: 'idicore',
      method: 'officer:PRESIDENT',
      person: 'MARSHALL EVANS BROWN',
      at: new Date().toISOString(),
    },
    {
      id: 'preview-hit-2',
      ownerName: 'FOSTER MICHAEL DAVID LVG TR',
      phones: ['6265550144'],
      emails: ['mfoster@example.com'],
      provider: 'accurateappend',
      method: 'tax-roll-full',
      person: 'MICHAEL DAVID FOSTER',
      at: new Date(Date.now() - 3_600_000).toISOString(),
    },
  ],
}

export const shouldLoadPreviewReviews = (): boolean => {
  if (process.env.NODE_ENV === 'production') return false
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('preview') === '1'
}
