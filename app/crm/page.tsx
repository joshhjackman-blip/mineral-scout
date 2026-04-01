'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  BarChart2,
  BookOpen,
  Calendar,
  ChevronRight,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
} from 'lucide-react'

import { supabase } from '@/lib/supabase'

type TagKey =
  | 'all'
  | 'hot'
  | 'nurture'
  | 'prospect'
  | 'not_interested'
  | 'offer_sent'
  | 'under_contract'
  | 'closed'
  | 'skip_traced'

type Deal = {
  id: string
  owner_name: string
  tract_abstract: string | null
  tract_survey: string | null
  operator_name: string | null
  phone: string | null
  email: string | null
  mailing_address: string | null
  mailing_city: string | null
  mailing_state: string | null
  mailing_zip: string | null
  acreage: number | null
  monthly_royalty: number | null
  propensity_score: number | null
  tag: string | null
  offer_amount: number | null
  follow_up_date: string | null
  source: string | null
  notes: string | null
  created_at: string | null
  updated_at: string | null
}

type ContactLogEntry = {
  id?: string
  deal_id?: string
  logged_at: string
  method: string
  outcome?: string | null
  notes?: string | null
}

const TAG_LABELS: Record<TagKey, string> = {
  all: 'All',
  hot: 'Hot',
  nurture: 'Nurture',
  prospect: 'Prospect',
  not_interested: 'Not interested',
  offer_sent: 'Offer sent',
  under_contract: 'Under contract',
  closed: 'Closed',
  skip_traced: 'Skip traced',
}

const TAG_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  hot:            { bg: '#FEE2E2', color: '#B91C1C', border: '#FECACA' },
  nurture:        { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A' },
  prospect:       { bg: '#F3F4F6', color: '#4B5563', border: '#E5E7EB' },
  not_interested: { bg: '#F9FAFB', color: '#9CA3AF', border: '#F3F4F6' },
  skip_traced:    { bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
  offer_sent:     { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' },
  under_contract: { bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
  closed:         { bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
}

const TagBadge = ({ tag }: { tag: string | null }) => {
  const key = (tag ?? 'prospect') as TagKey
  const label = TAG_LABELS[key] ?? TAG_LABELS.prospect
  const style = TAG_STYLES[key] ?? TAG_STYLES.prospect
  return (
    <span className="badge" style={{ background: style.bg, color: style.color, border: `1px solid ${style.border}` }}>
      {label}
    </span>
  )
}

const formatDate = (value?: string | null) => {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const isOverdue = (value?: string | null) => {
  if (!value) return false
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}

const daysSinceAdded = (value?: string | null) => {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const diffMs = Date.now() - d.getTime()
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))
}

const toNullableNumber = (value: unknown): number | null => {
  if (value === '' || value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export default function CrmPage() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<TagKey>('all')
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null)
  const [contactLog, setContactLog] = useState<ContactLogEntry[]>([])
  const [lastSaved, setLastSaved] = useState<string | null>(null)

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

  const handleSelectDeal = async (deal: Deal) => {
    setEditingDeal({ ...deal })
    setLastSaved(null)

    const { data, error } = await supabase
      .from('contact_log')
      .select('*')
      .eq('deal_id', deal.id)
      .order('logged_at', { ascending: false })

    if (error) {
      console.error('Failed to load contact log:', error.message)
      setContactLog([])
      return
    }
    setContactLog((data ?? []) as ContactLogEntry[])
  }

  const handleSaveDeal = async (overrides?: Partial<Deal>) => {
    const toSave = { ...(editingDeal ?? {}), ...(overrides ?? {}) } as Deal
    if (!toSave?.id) return

    const payload = {
      owner_name: toSave.owner_name ?? '',
      tract_abstract: toSave.tract_abstract ?? null,
      tract_survey: toSave.tract_survey ?? null,
      operator_name: toSave.operator_name ?? null,
      phone: toSave.phone ?? null,
      email: toSave.email ?? null,
      mailing_address: toSave.mailing_address ?? null,
      mailing_city: toSave.mailing_city ?? null,
      mailing_state: toSave.mailing_state ?? null,
      mailing_zip: toSave.mailing_zip ?? null,
      acreage: toNullableNumber(toSave.acreage),
      monthly_royalty: toNullableNumber(toSave.monthly_royalty),
      propensity_score: toNullableNumber(toSave.propensity_score),
      tag: toSave.tag ?? 'prospect',
      offer_amount: toNullableNumber(toSave.offer_amount),
      follow_up_date: toSave.follow_up_date || null,
      source: toSave.source ?? 'map',
      notes: toSave.notes ?? '',
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase
      .from('deals')
      .update(payload)
      .eq('id', toSave.id)

    if (error) {
      console.error('Failed to save deal:', error.message)
      return
    }

    setDeals((prev) => prev.map((d) => (d.id === toSave.id ? { ...d, ...payload } : d)))
    setEditingDeal((prev) => (prev?.id === toSave.id ? { ...prev, ...payload } : prev))
    setLastSaved('just now')
  }

  const handleLogContact = async (dealId: string, method: string) => {
    const loggedAt = new Date().toISOString()
    const { error } = await supabase.from('contact_log').insert({
      deal_id: dealId,
      method,
      logged_at: loggedAt,
    })
    if (error) {
      console.error('Failed to log contact:', error.message)
      return
    }
    setContactLog((prev) => [{ method, logged_at: loggedAt }, ...prev])
  }

  const handleTagChange = async (dealId: string, tag: string) => {
    setEditingDeal((prev) => (prev ? { ...prev, tag } : prev))

    const { error } = await supabase
      .from('deals')
      .update({ tag, updated_at: new Date().toISOString() })
      .eq('id', dealId)
    if (error) {
      console.error('Failed to update tag:', error.message)
      return
    }
    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, tag } : d)))
    setLastSaved('just now')
  }

  return (
    <div
      style={{
        height: '100vh',
        background: '#F4F5F7',
        color: '#111827',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '"DM Sans", system-ui, sans-serif',
      }}
    >
      <div
        style={{
          height: 52,
          minHeight: 52,
          background: '#FFFFFF',
          borderBottom: '1px solid #E5E7EB',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              color: '#111827',
              fontFamily: 'Georgia, serif',
              fontSize: 16,
              letterSpacing: '-0.01em',
              fontWeight: 700,
            }}
          >
            Mineral Map
          </div>
          <a
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: '#6B7280',
              fontSize: 12,
              textDecoration: 'none',
              border: '1px solid #E5E7EB',
              borderRadius: 999,
              padding: '4px 12px',
            }}
          >
            <MapPin size={14} />
            Map
          </a>
          <a
            href="/methodology"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: '#6B7280',
              fontSize: 12,
              textDecoration: 'none',
              border: '1px solid #E5E7EB',
              borderRadius: 999,
              padding: '4px 12px',
            }}
          >
            <BookOpen size={14} />
            Methodology
          </a>
          <a
            href="/comps"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: '#6B7280',
              textDecoration: 'none',
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #E5E7EB',
            }}
          >
            <BarChart2 size={14} />
            Comps
          </a>
        </div>
        <div style={{ color: '#111827', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          CRM & Pipeline <ChevronRight size={14} />
        </div>
      </div>

      <div
        style={{
          padding: 12,
          borderBottom: '1px solid #E5E7EB',
          background: '#FFFFFF',
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
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
              border: tagFilter === key ? '1px solid #EF9F27' : '1px solid #E5E7EB',
              background: tagFilter === key ? '#FEF3C7' : '#FFFFFF',
              color: tagFilter === key ? '#B45309' : '#6B7280',
              fontFamily: 'Inter, sans-serif',
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', minWidth: 280, position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 8, color: '#9CA3AF' }} />
          <input
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search owners / tracts / operator"
            style={{ paddingLeft: 30, fontSize: 12, background: '#FFFFFF' }}
          />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div
          style={{
            width: 380,
            minWidth: 380,
            borderRight: '1px solid #E5E7EB',
            overflowY: 'auto',
            padding: 12,
          }}
        >
          {visibleDeals.length === 0 ? (
            <div style={{ color: '#6B7280', fontSize: 12, padding: '20px 8px' }}>
              No deals match this filter.
            </div>
          ) : (
            visibleDeals.map((deal) => {
              const ageDays = daysSinceAdded(deal.created_at)
              return (
                <div
                  key={deal.id}
                  onClick={() => handleSelectDeal(deal)}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#F9FAFB'}
                  onMouseLeave={(e) => e.currentTarget.style.background = editingDeal?.id === deal.id ? '#FEF3C7' : 'white'}
                  style={{
                    background: editingDeal?.id === deal.id ? '#FEF3C7' : 'white',
                    border: editingDeal?.id === deal.id
                      ? '1px solid #EF9F27'
                      : '1px solid #E5E7EB',
                    borderRadius: 8,
                    padding: '12px 14px',
                    marginBottom: 8,
                    cursor: 'pointer',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: '#111827' }}>{deal.owner_name}</div>
                    <TagBadge tag={deal.tag} />
                  </div>
                  <div style={{ fontSize: 10, color: '#6B7280' }}>
                    {deal.tract_abstract ?? '--'} · {deal.operator_name ?? 'Unknown operator'}
                  </div>
                  <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>
                    {deal.mailing_city ?? 'Unknown city'}, {deal.mailing_state ?? '--'}
                    {deal.acreage ? ` · ${deal.acreage} acres` : ''}
                    {deal.monthly_royalty ? ` · $${Number(deal.monthly_royalty).toLocaleString()}/mo` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {deal.follow_up_date && (
                      <span
                        style={{
                          fontSize: 10,
                          padding: '2px 8px',
                          borderRadius: 10,
                          background: isOverdue(deal.follow_up_date)
                            ? 'rgba(244,67,54,0.15)'
                            : 'rgba(239,159,39,0.12)',
                          color: isOverdue(deal.follow_up_date) ? '#F44336' : '#EF9F27',
                          border: isOverdue(deal.follow_up_date)
                            ? '0.5px solid rgba(244,67,54,0.3)'
                            : '0.5px solid rgba(239,159,39,0.3)',
                        }}
                      >
                        Follow-up {formatDate(deal.follow_up_date)}
                      </span>
                    )}
                    {typeof ageDays === 'number' && (
                      <span
                        style={{
                          fontSize: 10,
                          padding: '2px 8px',
                          borderRadius: 10,
                          background: '#F3F4F6',
                          border: '1px solid #E5E7EB',
                          color: '#6B7280',
                        }}
                      >
                        Added {ageDays}d ago
                      </span>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: '#FFFFFF', borderLeft: '1px solid #E5E7EB' }}>
          {!editingDeal ? (
            <div
              style={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#9CA3AF',
                fontSize: 13,
                fontFamily: 'Inter, sans-serif',
              }}
            >
              [select a lead from the list to view details]
            </div>
          ) : (
            <div>
              <div style={{ padding: '20px 24px', borderBottom: '1px solid #E5E7EB' }}>
                <input
                  className="input"
                  value={editingDeal.owner_name ?? ''}
                  onChange={(e) => setEditingDeal((prev) => (prev ? { ...prev, owner_name: e.target.value } : prev))}
                  onBlur={() => handleSaveDeal()}
                  style={{
                    fontSize: 20,
                    fontWeight: 500,
                    color: '#111827',
                    width: '100%',
                    marginBottom: 8,
                  }}
                />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {Object.entries(TAG_LABELS).filter(([k]) => k !== 'all').map(([key, label]) => {
                    const style = TAG_STYLES[key] ?? TAG_STYLES.prospect
                    return (
                    <button
                      key={key}
                      onClick={() => handleTagChange(editingDeal.id, key)}
                      className="badge"
                      style={{
                        cursor: 'pointer',
                        background: editingDeal.tag === key ? style.bg : '#FFFFFF',
                        border: editingDeal.tag === key ? `1px solid ${style.border}` : '1px solid #E5E7EB',
                        color: editingDeal.tag === key ? style.color : '#9CA3AF',
                      }}
                    >
                      {label}
                    </button>
                    )
                  })}
                </div>
              </div>

              <div style={{ padding: '16px 24px', borderBottom: '1px solid #E5E7EB' }}>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, color: '#111827', marginBottom: 12, fontWeight: 700 }}>
                  LEAD INFO
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {[
                    { label: 'TRACT', field: 'tract_abstract' },
                    { label: 'SURVEY', field: 'tract_survey' },
                    { label: 'OPERATOR', field: 'operator_name' },
                    { label: 'PHONE', field: 'phone' },
                    { label: 'EMAIL', field: 'email' },
                    { label: 'CITY', field: 'mailing_city' },
                    { label: 'STATE', field: 'mailing_state' },
                    { label: 'ZIP', field: 'mailing_zip' },
                    { label: 'ADDRESS', field: 'mailing_address' },
                    { label: 'ACREAGE', field: 'acreage' },
                  ].map(({ label, field }) => (
                    <div key={field}>
                      <div style={{ fontSize: 9, color: '#6B7280', marginBottom: 3 }}>{label}</div>
                      <input
                        className="input"
                        value={String(editingDeal[field as keyof Deal] ?? '')}
                        onChange={(e) => setEditingDeal((prev) => (prev ? { ...prev, [field]: e.target.value } : prev))}
                        onBlur={() => handleSaveDeal()}
                        style={{
                          background: '#F9FAFB',
                          fontSize: 12,
                        }}
                      />
                    </div>
                  ))}
                </div>
                {(editingDeal.phone || editingDeal.email) && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    {editingDeal.phone && (
                      <a href={`tel:${editingDeal.phone}`} style={{ fontSize: 12, color: '#EF9F27', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Phone size={14} /> {editingDeal.phone}
                      </a>
                    )}
                    {editingDeal.email && (
                      <a href={`mailto:${editingDeal.email}`} style={{ fontSize: 12, color: '#EF9F27', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Mail size={14} /> {editingDeal.email}
                      </a>
                    )}
                  </div>
                )}
              </div>

              <div style={{ padding: '16px 24px', borderBottom: '1px solid #E5E7EB' }}>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, color: '#111827', marginBottom: 12, fontWeight: 700 }}>
                  OFFER
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 12, color: '#6B7280' }}>$</span>
                  <input
                    className="input"
                    type="number"
                    placeholder="Your offer amount"
                    value={editingDeal.offer_amount ?? ''}
                    onChange={(e) => {
                      const value = e.target.value
                      setEditingDeal((prev) => (prev ? { ...prev, offer_amount: value === '' ? null : Number(value) } : prev))
                    }}
                    onBlur={() => handleSaveDeal()}
                    style={{
                      fontSize: 14,
                      background: '#F9FAFB',
                      width: 200,
                    }}
                  />
                </div>
                {editingDeal.monthly_royalty && Number(editingDeal.monthly_royalty) > 0 && (
                  <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 6, padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, color: '#6B7280', marginBottom: 8 }}>COMP ESTIMATE</div>
                    {[
                      { label: 'Conservative (3x annual)', mult: 3, color: '#6B7280' },
                      { label: 'Market rate (4x annual)', mult: 4, color: '#EF9F27' },
                      { label: 'Aggressive (5x annual)', mult: 5, color: '#6B7280' },
                    ].map((c) => (
                      <div key={c.mult} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                        <span style={{ fontSize: 11, color: '#6B7280' }}>{c.label}</span>
                        <span
                          style={{
                            fontSize: 11,
                            fontFamily: 'Inter, sans-serif',
                            color: c.color,
                            fontWeight: c.mult === 4 ? 600 : 400,
                          }}
                        >
                          ${(Number(editingDeal.monthly_royalty) * 12 * c.mult).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ padding: '16px 24px', borderBottom: '1px solid #E5E7EB' }}>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, color: '#111827', marginBottom: 12, fontWeight: 700 }}>
                  FOLLOW-UP REMINDER
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    className="input"
                    type="date"
                    value={editingDeal.follow_up_date ?? ''}
                    onChange={(e) => setEditingDeal((prev) => (prev ? { ...prev, follow_up_date: e.target.value } : prev))}
                    onBlur={() => handleSaveDeal()}
                    style={{
                      fontSize: 12,
                      background: '#F9FAFB',
                      colorScheme: 'dark',
                    }}
                  />
                  {editingDeal.follow_up_date && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: '3px 10px',
                        borderRadius: 10,
                        background: isOverdue(editingDeal.follow_up_date)
                          ? 'rgba(244,67,54,0.15)'
                          : 'rgba(239,159,39,0.12)',
                        color: isOverdue(editingDeal.follow_up_date) ? '#F44336' : '#EF9F27',
                        border: `1px solid ${
                          isOverdue(editingDeal.follow_up_date)
                            ? 'rgba(244,67,54,0.3)'
                            : 'rgba(239,159,39,0.3)'
                        }`,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Calendar size={14} />
                      {formatDate(editingDeal.follow_up_date)}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {[
                    { label: '+3 days', days: 3 },
                    { label: '+1 week', days: 7 },
                    { label: '+2 weeks', days: 14 },
                    { label: '+1 month', days: 30 },
                  ].map((q) => (
                    <button
                      key={q.days}
                      onClick={() => {
                        if (!editingDeal) return
                        const d = new Date()
                        d.setDate(d.getDate() + q.days)
                        const dateStr = d.toISOString().split('T')[0]
                        const nextDeal = { ...editingDeal, follow_up_date: dateStr }
                        setEditingDeal(nextDeal)
                        handleSaveDeal(nextDeal)
                      }}
                      style={{
                        fontSize: 10,
                        padding: '3px 8px',
                        borderRadius: 4,
                        cursor: 'pointer',
                        background: 'transparent',
                        border: '1px solid #E5E7EB',
                        color: '#374151',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Plus size={12} />
                        {q.label.replace('+', '').trim()}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ padding: '16px 24px', borderBottom: '1px solid #E5E7EB' }}>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, color: '#111827', marginBottom: 12, fontWeight: 700 }}>
                  CONTACT LOG
                </div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                  {['Called — no answer', 'Called — spoke', 'Left voicemail', 'Sent letter', 'Sent email', 'Met in person'].map((outcome) => (
                    <button
                      key={outcome}
                      onClick={() => handleLogContact(editingDeal.id, outcome)}
                      style={{
                        fontSize: 10,
                        padding: '4px 10px',
                        borderRadius: 4,
                        cursor: 'pointer',
                        background: '#FFFFFF',
                        border: '1px solid #E5E7EB',
                        color: '#374151',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#EF9F27'
                        e.currentTarget.style.color = '#EF9F27'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#E5E7EB'
                        e.currentTarget.style.color = '#6B7280'
                      }}
                    >
                      {outcome}
                    </button>
                  ))}
                </div>
                <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                  {contactLog.map((entry, i) => (
                    <div
                      key={entry.id ?? `${entry.logged_at}-${i}`}
                      style={{
                        display: 'flex',
                        gap: 10,
                        padding: '6px 0',
                        borderBottom: '1px solid #F3F4F6',
                        alignItems: 'flex-start',
                      }}
                    >
                      <div style={{ fontSize: 9, color: '#6B7280', whiteSpace: 'nowrap', marginTop: 1 }}>
                        {new Date(entry.logged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </div>
                      <div style={{ fontSize: 11, color: '#111827' }}>{entry.method}</div>
                    </div>
                  ))}
                  {contactLog.length === 0 && (
                    <div style={{ fontSize: 11, color: '#9CA3AF', fontStyle: 'italic' }}>
                      No contacts logged yet
                    </div>
                  )}
                </div>
              </div>

              <div style={{ padding: '16px 24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 9, color: '#6B7280', letterSpacing: '0.08em', fontWeight: 600 }}>NOTES</div>
                  {lastSaved && <div style={{ fontSize: 9, color: '#9CA3AF' }}>Saved {lastSaved}</div>}
                </div>
                <textarea
                  className="input"
                  value={editingDeal.notes ?? ''}
                  onChange={(e) => setEditingDeal((prev) => (prev ? { ...prev, notes: e.target.value } : prev))}
                  onBlur={() => handleSaveDeal()}
                  placeholder="Add your notes about this lead..."
                  style={{
                    width: '100%',
                    minHeight: 140,
                    fontSize: 12,
                    resize: 'vertical',
                    lineHeight: 1.5,
                    colorScheme: 'dark',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
