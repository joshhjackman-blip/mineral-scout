'use client'

// Satellite Imagery page — weekly rig → completion signals with
// side-by-side before/after chips and the mineral owners affected.
// Mirrors /permits chrome so brokers treat it as a peer workflow:
// scan activity → expand leads → call / open on map / CRM.

import Link from 'next/link'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import AppLogo from '@/app/components/AppLogo'
import { COUNTIES } from '@/lib/counties'

type PadEvent = {
  id: number
  county_id: string
  rrc_lease_id: string | null
  api_number: string | null
  abstract_number: string | null
  owner_name: string | null
  lease_name: string | null
  operator_name: string | null
  signature: string
  confidence: number
  change_score: number | null
  summary: string
  before_path: string | null
  after_path: string | null
  week_start: string
  propensity_bump: number
  source: string
  created_at: string
  latitude?: number | null
  longitude?: number | null
  raw?: Record<string, unknown> | null
}

function mapHrefForEvent(ev: Pick<PadEvent, 'county_id' | 'abstract_number' | 'latitude' | 'longitude' | 'owner_name'>): string {
  const params = new URLSearchParams()
  params.set('county', ev.county_id)
  if (ev.abstract_number) {
    params.set('abstract', ev.abstract_number)
  }
  if (
    ev.latitude != null &&
    ev.longitude != null &&
    Number.isFinite(ev.latitude) &&
    Number.isFinite(ev.longitude)
  ) {
    params.set('lat', String(ev.latitude))
    params.set('lon', String(ev.longitude))
  }
  if (ev.owner_name) params.set('owner', ev.owner_name)
  return `/?${params.toString()}`
}

type LeadRow = {
  owner_name: string
  county_id: string
  event_count: number
  latest_signature: string
  latest_week: string
  abstracts: string[]
  propensity_bump_total: number
}

type WindowChoice = 7 | 14 | 30 | 90

const SIGNATURE_LABEL: Record<string, { label: string; color: string }> = {
  COMPLETION_CREW: { label: 'Completion crew', color: '#059669' },
  RRC_COMPLETION:  { label: 'RRC completion',  color: '#059669' },
  RRC_APPROVED:    { label: 'Permit approved', color: '#2563EB' },
  RIG_MOVE_IN:     { label: 'Rig / spud',      color: '#7C3AED' },
  RIG_MOVE_OUT:    { label: 'Rig move-out',    color: '#6B7280' },
  AMBIGUOUS:       { label: 'Needs review',    color: '#D97706' },
  NON_RELEVANT:    { label: 'Non-relevant',    color: '#6B7280' },
}

const COUNTY_OPTIONS = Object.keys(COUNTIES)

export default function PadActivityPage() {
  const [events, setEvents] = useState<PadEvent[]>([])
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [signed, setSigned] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [windowDays, setWindowDays] = useState<WindowChoice>(90)
  const [signatureFilter, setSignatureFilter] = useState<string>('all')
  const [countyFilter, setCountyFilter] = useState<string>('all')
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [reviewingId, setReviewingId] = useState<number | null>(null)
  const [hiresLoadingId, setHiresLoadingId] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const counties =
        countyFilter === 'all' ? COUNTY_OPTIONS.join(',') : countyFilter
      const params = new URLSearchParams({
        mode: 'list',
        counties,
        days: String(windowDays),
        limit: '100',
      })
      if (signatureFilter !== 'all') params.set('signature', signatureFilter)
      const res = await fetch(`/api/pad-activity?${params.toString()}`)
      const json = await res.json()
      if (!json?.success) {
        setError(json?.error || 'Failed to load satellite imagery')
        setEvents([])
        setLeads([])
        setSigned({})
        return
      }
      setEvents((json.data?.events || []) as PadEvent[])
      setLeads((json.data?.leads || []) as LeadRow[])
      setSigned((json.data?.signed || {}) as Record<string, string>)
      if (json.error) setError(json.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load satellite imagery')
      setEvents([])
      setLeads([])
    } finally {
      setLoading(false)
    }
  }, [windowDays, signatureFilter, countyFilter])

  useEffect(() => {
    void load()
  }, [load])

  const completionCount = useMemo(
    () =>
      events.filter((e) =>
        e.signature === 'COMPLETION_CREW' || e.signature === 'RRC_COMPLETION',
      ).length,
    [events],
  )

  const reviewCount = useMemo(
    () => events.filter((e) => e.signature === 'AMBIGUOUS' && e.before_path && e.after_path).length,
    [events],
  )

  const submitReview = useCallback(
    async (eventId: number, decision: 'COMPLETION_CREW' | 'RIG_MOVE_IN' | 'NON_RELEVANT') => {
      setReviewingId(eventId)
      setError(null)
      try {
        const res = await fetch('/api/pad-activity/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event_id: eventId, decision }),
        })
        const json = await res.json()
        if (!json?.success) {
          setError(json?.error || 'Review failed')
          return
        }
        await load()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Review failed')
      } finally {
        setReviewingId(null)
      }
    },
    [load],
  )

  const requestHires = useCallback(
    async (eventId: number, force = false) => {
      setHiresLoadingId(eventId)
      setError(null)
      try {
        const res = await fetch('/api/pad-activity/hires', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event_id: eventId, force }),
        })
        const json = await res.json()
        if (!json?.success) {
          setError(json?.error || 'Hi-res request failed')
          return
        }
        await load()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Hi-res request failed')
      } finally {
        setHiresLoadingId(null)
      }
    },
    [load],
  )

  // Group events by pad key so one card can list multiple owners.
  const cards = useMemo(() => {
    const map = new Map<string, {
      key: string
      sample: PadEvent
      owners: string[]
      eventIds: number[]
    }>()
    for (const ev of events) {
      const key = [
        ev.county_id,
        ev.api_number || '',
        ev.abstract_number || '',
        ev.week_start,
        ev.signature,
      ].join('|')
      const existing = map.get(key)
      if (!existing) {
        map.set(key, {
          key,
          sample: ev,
          owners: ev.owner_name ? [ev.owner_name] : [],
          eventIds: [ev.id],
        })
      } else {
        existing.eventIds.push(ev.id)
        if (ev.owner_name && !existing.owners.includes(ev.owner_name)) {
          existing.owners.push(ev.owner_name)
        }
      }
    }
    return Array.from(map.values())
  }, [events])

  const searchTerms = useMemo(
    () =>
      searchQuery
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0),
    [searchQuery],
  )

  const filteredCards = useMemo(() => {
    if (searchTerms.length === 0) return cards
    return cards.filter(({ sample, owners }) => {
      const haystack = [
        sample.lease_name,
        sample.operator_name,
        sample.api_number,
        sample.abstract_number,
        sample.rrc_lease_id,
        sample.owner_name,
        sample.summary,
        ...owners,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return searchTerms.every((t) => haystack.includes(t))
    })
  }, [cards, searchTerms])

  const filteredLeads = useMemo(() => {
    if (searchTerms.length === 0) return leads
    return leads.filter((lead) => {
      const haystack = [
        lead.owner_name,
        lead.county_id,
        ...lead.abstracts,
      ]
        .join(' ')
        .toLowerCase()
      return searchTerms.every((t) => haystack.includes(t))
    })
  }, [leads, searchTerms])

  useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev }
      for (const card of cards) {
        if (card.owners.length > 0 && next[card.sample.id] === undefined) {
          next[card.sample.id] = true
        }
      }
      return next
    })
  }, [cards])

  return (
    <div style={{ minHeight: '100dvh', background: '#F8FAFC', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          height: 52,
          minHeight: 52,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.98) 100%), " +
            "url('/hero-permian.jpg') center/cover no-repeat",
          borderBottom: '1px solid #E5E7EB',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 20px',
        }}
      >
        <Link href="/" style={{ textDecoration: 'none' }}>
          <AppLogo width={150} />
        </Link>
        <span style={{ fontSize: 12, color: '#6B7280' }}>·</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>
          Satellite Imagery
        </span>
        <div style={{ flex: 1 }} />
        <Link
          href="/permits"
          style={{
            fontSize: 12,
            color: '#2563EB',
            textDecoration: 'none',
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid #2563EB',
            fontWeight: 500,
          }}
        >
          Permits
        </Link>
        <Link
          href="/"
          style={{
            fontSize: 12,
            color: '#6B7280',
            textDecoration: 'none',
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid #E5E7EB',
          }}
        >
          ← Map
        </Link>
      </div>

      <div style={{ maxWidth: 1280, width: '100%', margin: '0 auto', padding: '24px 20px 40px', flex: 1 }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#111827', marginBottom: 6 }}>
            Satellite Imagery — last {windowDays} days
          </h1>
          <p style={{ fontSize: 14, color: '#6B7280', margin: 0 }}>
            {loading
              ? 'Loading satellite imagery…'
              : `${filteredCards.length} pad event${filteredCards.length === 1 ? '' : 's'} · ${completionCount} completion · ${filteredLeads.length} lead${filteredLeads.length === 1 ? '' : 's'} affected`}
          </p>
        </div>

        {/* Search + filters */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flex: '1 1 260px',
              maxWidth: 420,
              background: '#FFFFFF',
              border: '1px solid #E5E7EB',
              borderRadius: 8,
              padding: '8px 12px',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search owner, lease, API, abstract…"
              style={{
                border: 'none',
                outline: 'none',
                background: 'transparent',
                width: '100%',
                fontSize: 13,
                color: '#111827',
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#9CA3AF',
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: 0,
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
          <FilterGroup label="Window">
            {([7, 14, 30, 90] as WindowChoice[]).map((d) => (
              <Chip
                key={d}
                active={windowDays === d}
                onClick={() => setWindowDays(d)}
                label={`${d}d`}
              />
            ))}
          </FilterGroup>
          <FilterGroup label="County">
            <Chip
              active={countyFilter === 'all'}
              onClick={() => setCountyFilter('all')}
              label="All"
            />
            {COUNTY_OPTIONS.map((c) => (
              <Chip
                key={c}
                active={countyFilter === c}
                onClick={() => setCountyFilter(c)}
                label={COUNTIES[c]?.name || c}
              />
            ))}
          </FilterGroup>
          <FilterGroup label="Signal">
            <Chip active={signatureFilter === 'all'} onClick={() => setSignatureFilter('all')} label="All" />
            <Chip
              active={signatureFilter === 'RRC_APPROVED'}
              onClick={() => setSignatureFilter('RRC_APPROVED')}
              label="Approved"
              color="#2563EB"
            />
            <Chip
              active={signatureFilter === 'RRC_COMPLETION'}
              onClick={() => setSignatureFilter('RRC_COMPLETION')}
              label="Completion"
              color="#059669"
            />
            <Chip
              active={signatureFilter === 'RIG_MOVE_IN'}
              onClick={() => setSignatureFilter('RIG_MOVE_IN')}
              label="Spud"
              color="#7C3AED"
            />
            <Chip
              active={signatureFilter === 'COMPLETION_CREW'}
              onClick={() => setSignatureFilter('COMPLETION_CREW')}
              label="Crew (imagery)"
              color="#059669"
            />
            <Chip
              active={signatureFilter === 'AMBIGUOUS'}
              onClick={() => setSignatureFilter('AMBIGUOUS')}
              label={reviewCount > 0 ? `Needs review (${reviewCount})` : 'Needs review'}
              color="#D97706"
            />
          </FilterGroup>
        </div>

        {error && (
          <div style={{
            marginBottom: 16,
            padding: '10px 14px',
            borderRadius: 8,
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            color: '#991B1B',
            fontSize: 13,
          }}>
            {error}
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 320px',
            gap: 20,
            alignItems: 'start',
          }}
          className="pad-activity-grid"
        >
          {/* Event cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {loading ? (
              <EmptyBox>Loading satellite imagery across counties…</EmptyBox>
            ) : cards.length === 0 ? (
              <EmptyBox>
                No satellite imagery events in this window yet.
                <div style={{ marginTop: 8, fontSize: 12, color: '#9CA3AF' }}>
                  Imagery is optional. Re-run{' '}
                  <strong>Pad activity weekly</strong> on <code>main</code> —
                  Phase 1 pulls recent approved / spud / completion permits
                  from your RRC scrape (no satellite needed).
                </div>
              </EmptyBox>
            ) : filteredCards.length === 0 ? (
              <EmptyBox>
                No events match &quot;{searchQuery.trim()}&quot;.
                <div style={{ marginTop: 8, fontSize: 12, color: '#9CA3AF' }}>
                  Try a lease name, owner, API number, or abstract.
                </div>
              </EmptyBox>
            ) : (
              filteredCards.map(({ key, sample, owners }) => {
                const meta = SIGNATURE_LABEL[sample.signature] || {
                  label: sample.signature,
                  color: '#6B7280',
                }
                const beforeKey = sample.before_path?.replace(/^\/+/, '').trim() || null
                const afterKey = sample.after_path?.replace(/^\/+/, '').trim() || null
                const beforeUrl = beforeKey ? signed[beforeKey] || null : null
                const afterUrl = afterKey ? signed[afterKey] || null : null
                const hiresPath =
                  typeof sample.raw?.hires_path === 'string'
                    ? sample.raw.hires_path.replace(/^\/+/, '').trim()
                    : null
                const hiresUrl = hiresPath ? signed[hiresPath] || null : null
                const hiresDate =
                  typeof sample.raw?.hires_date === 'string'
                    ? sample.raw.hires_date
                    : null
                const hiresLabel =
                  typeof sample.raw?.hires_label === 'string'
                    ? sample.raw.hires_label
                    : hiresDate
                      ? `Hi-res · ${hiresDate}`
                      : 'Hi-res'
                const hiresSource = String(sample.raw?.hires_source || '')
                const hiresIsStale =
                  Boolean(sample.raw?.hires_stale_survey) ||
                  hiresSource === 'naip'
                const canRequestHires = Boolean(
                  (sample.latitude != null && sample.longitude != null) ||
                    sample.api_number ||
                    sample.raw?.latitude != null ||
                    sample.raw?.longitude != null,
                )
                const open = expanded[sample.id] ?? owners.length > 0
                const countyName = COUNTIES[sample.county_id]?.name || sample.county_id
                const pct = Math.round((sample.confidence || 0) * 100)
                const mapHref = mapHrefForEvent(sample)

                return (
                  <div
                    key={key}
                    style={{
                      background: '#FFFFFF',
                      border: '1px solid #E5E7EB',
                      borderRadius: 10,
                      overflow: 'hidden',
                      boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
                    }}
                  >
                    <div style={{ padding: '14px 16px', borderBottom: '1px solid #F3F4F6' }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: meta.color,
                            background: `${meta.color}14`,
                            border: `1px solid ${meta.color}55`,
                            borderRadius: 999,
                            padding: '3px 10px',
                          }}
                        >
                          {meta.label} · {pct}%
                        </span>
                        <span style={{ fontSize: 12, color: '#6B7280' }}>{countyName}</span>
                        {sample.abstract_number && (
                          <span style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace', color: '#374151' }}>
                            A-{sample.abstract_number}
                          </span>
                        )}
                        {sample.api_number && (
                          <span style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace', color: '#6B7280' }}>
                            API {sample.api_number}
                          </span>
                        )}
                        <span style={{ fontSize: 12, color: '#9CA3AF', marginLeft: 'auto' }}>
                          Week of {sample.week_start}
                        </span>
                      </div>
                      <div style={{ marginTop: 8, fontSize: 15, fontWeight: 600, color: '#111827' }}>
                        {sample.lease_name || 'Unknown lease'}
                        {sample.operator_name ? (
                          <span style={{ fontWeight: 400, color: '#6B7280' }}>
                            {' '}· {sample.operator_name}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* Side-by-side chips */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: hiresUrl ? '1fr 1fr 1.15fr' : '1fr 1fr',
                        gap: 0,
                        borderBottom: '1px solid #F3F4F6',
                        background: '#F8FAFC',
                      }}
                    >
                      <ChipPanel
                        label="Before"
                        url={beforeUrl}
                        subtitle="Sentinel-2 · 10 m"
                        missingHint={
                          beforeKey
                            ? 'Chip path on file but image failed to load — re-check Storage'
                            : 'No before chip yet (run weekly with --enable-sentinel)'
                        }
                      />
                      <ChipPanel
                        label="After"
                        url={afterUrl}
                        subtitle="Sentinel-2 · 10 m"
                        borderLeft
                        missingHint={
                          afterKey
                            ? 'Chip path on file but image failed to load — re-check Storage'
                            : 'No after chip yet (run weekly with --enable-sentinel)'
                        }
                      />
                      {hiresUrl && (
                        <ChipPanel
                          label="Hi-res"
                          url={hiresUrl}
                          subtitle={hiresLabel}
                          borderLeft
                          crisp
                        />
                      )}
                    </div>

                    <div style={{ padding: '14px 16px' }}>
                      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: '#1F2937' }}>
                        {sample.summary}
                      </p>

                      {(canRequestHires || sample.signature === 'AMBIGUOUS') && (
                        <div
                          style={{
                            marginTop: 12,
                            padding: '10px 12px',
                            borderRadius: 8,
                            background: sample.signature === 'AMBIGUOUS' ? '#FFFBEB' : '#F0FDFA',
                            border: sample.signature === 'AMBIGUOUS' ? '1px solid #FDE68A' : '1px solid #99F6E4',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 8,
                            alignItems: 'center',
                          }}
                        >
                          {sample.signature === 'AMBIGUOUS' && (
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#92400E', marginRight: 4 }}>
                              Human review
                            </span>
                          )}
                          {canRequestHires && !hiresUrl && (
                            <button
                              type="button"
                              disabled={hiresLoadingId === sample.id}
                              onClick={() => void requestHires(sample.id, false)}
                              style={reviewBtnStyle('#0F766E')}
                              title="Pull current satellite chip for this pad (Mapbox)"
                            >
                              {hiresLoadingId === sample.id ? 'Pulling hi-res…' : 'Request hi-res'}
                            </button>
                          )}
                          {hiresUrl && (
                            <>
                              <span style={{ fontSize: 11, fontWeight: 600, color: hiresIsStale ? '#B45309' : '#0F766E' }}>
                                {hiresIsStale
                                  ? `Survey aerial ${hiresDate || ''} — may predate this event`
                                  : `Hi-res ready · current`}
                              </span>
                              {canRequestHires && (
                                <button
                                  type="button"
                                  disabled={hiresLoadingId === sample.id}
                                  onClick={() => void requestHires(sample.id, true)}
                                  style={reviewBtnStyle('#0F766E')}
                                  title="Re-pull current Mapbox satellite (replaces stale NAIP)"
                                >
                                  {hiresLoadingId === sample.id ? 'Refreshing…' : 'Refresh hi-res'}
                                </button>
                              )}
                            </>
                          )}
                          {sample.signature === 'AMBIGUOUS' && beforeUrl && afterUrl && (
                            <>
                              <button
                                type="button"
                                disabled={reviewingId === sample.id}
                                onClick={() => void submitReview(sample.id, 'COMPLETION_CREW')}
                                style={reviewBtnStyle('#059669')}
                              >
                                Confirm completion
                              </button>
                              <button
                                type="button"
                                disabled={reviewingId === sample.id}
                                onClick={() => void submitReview(sample.id, 'RIG_MOVE_IN')}
                                style={reviewBtnStyle('#7C3AED')}
                              >
                                Confirm rig / pad
                              </button>
                              <button
                                type="button"
                                disabled={reviewingId === sample.id}
                                onClick={() => void submitReview(sample.id, 'NON_RELEVANT')}
                                style={reviewBtnStyle('#6B7280')}
                              >
                                Not relevant
                              </button>
                            </>
                          )}
                          {(reviewingId === sample.id || hiresLoadingId === sample.id) && (
                            <span style={{ fontSize: 11, color: '#92400E' }}>
                              {hiresLoadingId === sample.id ? 'Fetching aerial…' : 'Saving…'}
                            </span>
                          )}
                        </div>
                      )}

                      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((prev) => ({ ...prev, [sample.id]: !open }))
                          }
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            padding: '6px 12px',
                            borderRadius: 6,
                            border: '1px solid #059669',
                            background: open ? '#059669' : '#FFFFFF',
                            color: open ? '#FFFFFF' : '#059669',
                            cursor: 'pointer',
                          }}
                        >
                          {open ? 'Hide leads' : `Leads affected (${owners.length})`}
                        </button>
                        <Link
                          href={mapHref}
                          style={{
                            fontSize: 12,
                            fontWeight: 500,
                            padding: '6px 12px',
                            borderRadius: 6,
                            border: '1px solid #E5E7EB',
                            color: '#374151',
                            textDecoration: 'none',
                          }}
                        >
                          Open on map
                        </Link>
                        {sample.propensity_bump > 0 && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#059669' }}>
                            +{sample.propensity_bump} propensity
                          </span>
                        )}
                        <span style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                          {sample.source.replace(/_/g, ' ')}
                        </span>
                      </div>

                      {open && (
                        <div style={{ marginTop: 12, border: 'flex', flexDirection: 'column', gap: 6 }}>
                          {owners.length === 0 ? (
                            <div style={{ fontSize: 13, color: '#6B7280' }}>
                              No mineral owners linked for this pad yet.
                            </div>
                          ) : (
                            owners.map((name) => (
                              <div
                                key={name}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 10,
                                  padding: '8px 10px',
                                  borderRadius: 8,
                                  border: '1px solid #E5E7EB',
                                  background: '#FFFFFF',
                                }}
                              >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
                                    {name}
                                  </div>
                                  <div style={{ fontSize: 11, color: '#6B7280' }}>
                                    {countyName}
                                    {sample.abstract_number ? ` · A-${sample.abstract_number}` : ''}
                                  </div>
                                </div>
                                <Link
                                  href={`/crm`}
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: '#EF9F27',
                                    textDecoration: 'none',
                                    padding: '4px 8px',
                                    border: '1px solid #FCD34D',
                                    borderRadius: 6,
                                  }}
                                >
                                  CRM
                                </Link>
                                <Link
                                  href={mapHrefForEvent({ ...sample, owner_name: name })}
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: '#2563EB',
                                    textDecoration: 'none',
                                    padding: '4px 8px',
                                    border: '1px solid #93C5FD',
                                    borderRadius: 6,
                                  }}
                                >
                                  Map
                                </Link>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Leads sidebar */}
          <aside
            style={{
              position: 'sticky',
              top: 16,
              background: '#FFFFFF',
              border: '1px solid #E5E7EB',
              borderRadius: 10,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '12px 14px',
                borderBottom: '1px solid #F3F4F6',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                color: '#64748B',
              }}
            >
              Leads affected · {filteredLeads.length}
            </div>
            <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {loading ? (
                <div style={{ padding: 16, fontSize: 13, color: '#6B7280' }}>Loading…</div>
              ) : leads.length === 0 ? (
                <div style={{ padding: 16, fontSize: 13, color: '#6B7280' }}>
                  No owner-linked events in this window.
                </div>
              ) : filteredLeads.length === 0 ? (
                <div style={{ padding: 16, fontSize: 13, color: '#6B7280' }}>
                  No leads match this search.
                </div>
              ) : (
                filteredLeads.map((lead) => {
                  const meta = SIGNATURE_LABEL[lead.latest_signature]
                  const abs = lead.abstracts[0]
                  const href = abs
                    ? `/?county=${encodeURIComponent(lead.county_id)}&abstract=${encodeURIComponent(abs)}&owner=${encodeURIComponent(lead.owner_name)}`
                    : `/?county=${encodeURIComponent(lead.county_id)}&owner=${encodeURIComponent(lead.owner_name)}`
                  return (
                    <Link
                      key={`${lead.county_id}-${lead.owner_name}`}
                      href={href}
                      style={{
                        display: 'block',
                        padding: '12px 14px',
                        borderBottom: '1px solid #F3F4F6',
                        textDecoration: 'none',
                        color: 'inherit',
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
                        {lead.owner_name}
                      </div>
                      <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                        {COUNTIES[lead.county_id]?.name || lead.county_id}
                        {abs ? ` · A-${abs}` : ''}
                        {' · '}
                        {lead.event_count} event{lead.event_count === 1 ? '' : 's'}
                      </div>
                      <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: meta?.color || '#6B7280',
                          }}
                        >
                          {meta?.label || lead.latest_signature}
                        </span>
                        {lead.propensity_bump_total > 0 && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#059669' }}>
                            +{lead.propensity_bump_total} propensity
                          </span>
                        )}
                      </div>
                    </Link>
                  )
                })
              )}
            </div>
          </aside>
        </div>
      </div>

      <style jsx global>{`
        @media (max-width: 900px) {
          .pad-activity-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: '#6B7280', marginRight: 4 }}>{label}:</span>
      {children}
    </div>
  )
}

function Chip({
  label,
  active,
  onClick,
  color = '#0F172A',
}: {
  label: string
  active: boolean
  onClick: () => void
  color?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 12,
        padding: '4px 10px',
        borderRadius: 6,
        cursor: 'pointer',
        background: active ? `${color}15` : '#FFFFFF',
        border: active ? `1px solid ${color}` : '1px solid #E5E7EB',
        color: active ? color : '#6B7280',
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  )
}

function reviewBtnStyle(color: string): CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 600,
    padding: '6px 10px',
    borderRadius: 6,
    border: `1px solid ${color}`,
    background: '#FFFFFF',
    color,
    cursor: 'pointer',
  }
}

function ChipPanel({
  label,
  url,
  borderLeft,
  subtitle = 'Sentinel-2 · 10 m',
  crisp = false,
  missingHint,
}: {
  label: string
  url: string | null
  borderLeft?: boolean
  subtitle?: string
  /** Hi-res chips are sharp enough — don't force pixelated upscale. */
  crisp?: boolean
  missingHint?: string
}) {
  const [broken, setBroken] = useState(false)
  useEffect(() => {
    setBroken(false)
  }, [url])

  return (
    <div
      style={{
        borderLeft: borderLeft ? '1px solid #E5E7EB' : undefined,
        minHeight: 240,
        display: 'flex',
        flexDirection: 'column',
        background: '#0F172A',
      }}
    >
      <div
        style={{
          padding: '6px 10px',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: '#94A3B8',
          background: '#F8FAFC',
        }}
      >
        {label}
        <span style={{ fontWeight: 500, marginLeft: 6, color: crisp ? '#0F766E' : '#64748B' }}>
          {subtitle}
        </span>
      </div>
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`${label} pad chip`}
          onError={() => setBroken(true)}
          style={{
            width: '100%',
            height: 220,
            objectFit: 'contain',
            imageRendering: crisp ? 'auto' : 'pixelated',
            background: '#0F172A',
          }}
        />
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 220,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            textAlign: 'center',
            fontSize: 12,
            color: '#94A3B8',
            lineHeight: 1.4,
            background: '#F8FAFC',
          }}
        >
          {broken ? 'Image failed to load' : 'No satellite chip yet'}
          <br />
          <span style={{ fontSize: 11 }}>
            {broken
              ? 'Chip missing in Storage (or proxy failed)'
              : missingHint ||
                'RRC signals show without imagery; Sentinel before/after appears when the weekly job lands paths'}
          </span>
        </div>
      )}
    </div>
  )
}

function EmptyBox({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: 40,
        textAlign: 'center',
        fontSize: 14,
        color: '#6B7280',
        background: '#FFFFFF',
        borderRadius: 8,
        border: '1px solid #E5E7EB',
      }}
    >
      {children}
    </div>
  )
}
