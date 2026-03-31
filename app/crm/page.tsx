'use client'

import { useEffect, useMemo, useState } from 'react'

import { supabase } from '@/lib/supabase'

type TagKey =
  | 'all'
  | 'hot'
  | 'nurture'
  | 'prospect'
  | 'not_interested'
  | 'skip_traced'

type Deal = {
  id: string
  owner_name: string
  tract_abstract: string | null
  tract_survey: string | null
  operator_name: string | null
  mailing_city: string | null
  mailing_state: string | null
  acreage: number | null
  monthly_royalty: number | null
  propensity_score: number | null
  tag: string | null
  follow_up_date: string | null
  notes: string | null
}

const TAG_CONFIG = {
  hot: { label: 'Hot', color: '#F44336', bg: 'rgba(244,67,54,0.15)' },
  nurture: { label: 'Nurture', color: '#EF9F27', bg: 'rgba(239,159,39,0.12)' },
  prospect: { label: 'Prospect', color: '#7A7870', bg: 'rgba(255,255,255,0.06)' },
  not_interested: { label: 'Not interested', color: '#4A4F5E', bg: 'rgba(255,255,255,0.04)' },
  offer_sent: { label: 'Offer sent', color: '#378ADD', bg: 'rgba(55,138,221,0.15)' },
  under_contract: { label: 'Under contract', color: '#7AB835', bg: 'rgba(122,184,53,0.15)' },
  closed: { label: 'Closed', color: '#7AB835', bg: 'rgba(122,184,53,0.2)' },
  skip_traced: { label: 'Skip traced', color: '#7AB835', bg: 'rgba(122,184,53,0.15)' },
} as const

const TagBadge = ({ tag }: { tag: string | null }) => {
  const key = (tag ?? 'prospect') as keyof typeof TAG_CONFIG
  const cfg = TAG_CONFIG[key] ?? TAG_CONFIG.prospect
  return (
    <span
      style={{
        fontSize: 9,
        padding: '2px 8px',
        borderRadius: 10,
        fontWeight: 600,
        background: cfg.bg,
        color: cfg.color,
        border: `0.5px solid ${cfg.color}40`,
      }}
    >
      {cfg.label}
    </span>
  )
}

export default function CrmPage() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<TagKey>('all')

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from('deals')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) {
        console.error('Failed to load deals:', error.message)
        return
      }
      setDeals((data ?? []) as Deal[])
    }
    load()
  }, [])

  const visibleDeals = useMemo(() => {
    return deals.filter((deal) => {
      if (tagFilter !== 'all' && (deal.tag ?? 'prospect') !== tagFilter) return false
      if (!search.trim()) return true
      const q = search.trim().toLowerCase()
      return (
        (deal.owner_name ?? '').toLowerCase().includes(q) ||
        (deal.tract_abstract ?? '').toLowerCase().includes(q) ||
        (deal.tract_survey ?? '').toLowerCase().includes(q) ||
        (deal.operator_name ?? '').toLowerCase().includes(q)
      )
    })
  }, [deals, search, tagFilter])

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0D1220',
        color: '#F5F3EE',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          height: 48,
          minHeight: 48,
          borderBottom: '0.5px solid #1E2535',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              color: '#EF9F27',
              fontFamily: 'monospace',
              fontSize: 13,
              letterSpacing: '0.12em',
              fontWeight: 600,
            }}
          >
            MINERAL MAP
          </div>
          <a
            href="/"
            style={{
              color: '#7A7870',
              fontSize: 11,
              textDecoration: 'none',
              border: '0.5px solid #2A2F3E',
              borderRadius: 999,
              padding: '3px 10px',
            }}
          >
            ← Map
          </a>
        </div>
        <div style={{ color: '#F5F3EE', fontSize: 12, fontWeight: 600 }}>CRM & Pipeline</div>
      </div>

      <div style={{ padding: 12, borderBottom: '0.5px solid #1E2535', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {([
          ['all', 'All'],
          ['hot', 'Hot'],
          ['nurture', 'Nurture'],
          ['prospect', 'Prospect'],
          ['not_interested', 'Not Interested'],
          ['skip_traced', 'Skip Traced'],
        ] as Array<[TagKey, string]>).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTagFilter(key)}
            style={{
              fontSize: 10,
              padding: '4px 10px',
              borderRadius: 10,
              border: tagFilter === key ? '0.5px solid rgba(239,159,39,0.6)' : '0.5px solid #2A2F3E',
              background: tagFilter === key ? 'rgba(239,159,39,0.2)' : 'transparent',
              color: tagFilter === key ? '#EF9F27' : '#7A7870',
              fontFamily: 'monospace',
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search owners / tracts / operator"
          style={{
            marginLeft: 'auto',
            minWidth: 240,
            background: '#12192A',
            border: '0.5px solid #2A2F3E',
            borderRadius: 8,
            color: '#F5F3EE',
            padding: '6px 10px',
            fontSize: 11,
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {visibleDeals.length === 0 ? (
          <div style={{ color: '#7A7870', fontSize: 12, padding: '20px 8px' }}>
            No deals match this filter.
          </div>
        ) : (
          visibleDeals.map((deal) => (
            <div
              key={deal.id}
              style={{
                background: '#1E2535',
                border: '0.5px solid #2A2F3E',
                borderRadius: 8,
                padding: '12px 14px',
                marginBottom: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#F5F3EE' }}>{deal.owner_name}</div>
                <TagBadge tag={deal.tag} />
              </div>
              <div style={{ fontSize: 10, color: '#7A7870' }}>
                {deal.tract_abstract ?? '--'} · {deal.operator_name ?? 'Unknown operator'}
              </div>
              <div style={{ fontSize: 10, color: '#7A7870', marginTop: 2 }}>
                {deal.mailing_city ?? 'Unknown city'}, {deal.mailing_state ?? '--'}
                {deal.acreage ? ` · ${deal.acreage} acres` : ''}
                {deal.monthly_royalty ? ` · $${Number(deal.monthly_royalty).toLocaleString()}/mo` : ''}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
