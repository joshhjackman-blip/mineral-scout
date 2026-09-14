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
    phones: [],
    status: 'open',
    created_at: new Date(Date.now() - 3600000).toISOString(),
    updated_at: new Date(Date.now() - 3600000).toISOString(),
  },
]

export const shouldLoadPreviewReviews = (): boolean => {
  if (process.env.NODE_ENV === 'production') return false
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('preview') === '1'
}
