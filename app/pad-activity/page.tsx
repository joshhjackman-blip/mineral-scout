'use client'

// Satellite Imagery (Pad Ops) — Sentinel change desk.
// Imagery-first premium surface for rig → completion detection.
// Distinct from the light CRM/map chrome on purpose.

import Link from 'next/link'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import PadOpsFrames from '@/app/components/PadOpsFrames'
import { COUNTIES } from '@/lib/counties'
import {
  briefForSignature,
  signalPriority,
} from '@/lib/pad-activity-explanations'
import './pad-ops.css'

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

type WindowChoice = 14 | 30 | 90
type SignalFilter = 'lifecycle' | 'all' | string

const LIFECYCLE = new Set([
  'COMPLETION_CREW',
  'RRC_COMPLETION',
  'RIG_MOVE_IN',
  'RIG_MOVE_OUT',
  'RRC_APPROVED',
  'AMBIGUOUS',
])

const SIG_TONE: Record<string, 'signal' | 'warn' | 'muted'> = {
  COMPLETION_CREW: 'signal',
  RRC_COMPLETION: 'signal',
  AMBIGUOUS: 'warn',
  RIG_MOVE_OUT: 'warn',
  RIG_MOVE_IN: 'signal',
  RRC_APPROVED: 'muted',
}

function mapHrefForEvent(ev: PadEvent): string {
  const params = new URLSearchParams()
  params.set('county', ev.county_id)
  if (ev.abstract_number) {
    params.set('abstract', String(ev.abstract_number).replace(/^A-\s*/i, '').trim())
  }
  // Always pass pad coords when we have them so the map zooms even if
  // abstract label matching against slim map geojson fails.
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

const COUNTY_OPTIONS = Object.keys(COUNTIES)

export default function PadActivityPage() {
  const [events, setEvents] = useState<PadEvent[]>([])
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [signed, setSigned] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [windowDays, setWindowDays] = useState<WindowChoice>(90)
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('lifecycle')
  const [countyFilter, setCountyFilter] = useState<string>('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [reviewingId, setReviewingId] = useState<number | null>(null)
  const [skyfiBusy, setSkyfiBusy] = useState(false)
  const [skyfiNote, setSkyfiNote] = useState<string | null>(null)
  const [feedSource, setFeedSource] = useState<string>('pad_activity_events')

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
        limit: '120',
      })
      // Server filters exact signature; lifecycle is client-side.
      if (signalFilter !== 'all' && signalFilter !== 'lifecycle') {
        params.set('signature', signalFilter)
      }
      const res = await fetch(`/api/pad-activity?${params.toString()}`)
      const json = await res.json()
      if (!json?.success) {
        setError(json?.error || 'Failed to load pad activity')
        setEvents([])
        setLeads([])
        setSigned({})
        return
      }
      setEvents((json.data?.events || []) as PadEvent[])
      setLeads((json.data?.leads || []) as LeadRow[])
      setSigned((json.data?.signed || {}) as Record<string, string>)
      setFeedSource(String(json.data?.feed_source || 'pad_activity_events'))
      if (json.error) setError(json.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pad activity')
      setEvents([])
      setLeads([])
    } finally {
      setLoading(false)
    }
  }, [windowDays, signalFilter, countyFilter])

  useEffect(() => {
    void load()
  }, [load])

  const cards = useMemo(() => {
    const map = new Map<string, {
      key: string
      sample: PadEvent
      owners: string[]
    }>()
    for (const ev of events) {
      if (signalFilter === 'lifecycle' && !LIFECYCLE.has(ev.signature)) continue
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
        })
      } else if (ev.owner_name && !existing.owners.includes(ev.owner_name)) {
        existing.owners.push(ev.owner_name)
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const pd =
        signalPriority(b.sample.signature) - signalPriority(a.sample.signature)
      if (pd !== 0) return pd
      return String(b.sample.created_at).localeCompare(String(a.sample.created_at))
    })
  }, [events, signalFilter])

  useEffect(() => {
    if (cards.length === 0) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !cards.some((c) => c.sample.id === selectedId)) {
      setSelectedId(cards[0].sample.id)
    }
  }, [cards, selectedId])

  const selected = useMemo(
    () => cards.find((c) => c.sample.id === selectedId) || null,
    [cards, selectedId],
  )

  const brief = briefForSignature(selected?.sample.signature || '')
  const beforeUrl = selected?.sample.before_path
    ? signed[selected.sample.before_path] || null
    : null
  const afterUrl = selected?.sample.after_path
    ? signed[selected.sample.after_path] || null
    : null
  const confidencePct = Math.round((selected?.sample.confidence || 0) * 100)
  const countyName = selected
    ? COUNTIES[selected.sample.county_id]?.name || selected.sample.county_id
    : ''

  const completionCount = useMemo(
    () =>
      cards.filter((c) =>
        c.sample.signature === 'COMPLETION_CREW' ||
        c.sample.signature === 'RRC_COMPLETION',
      ).length,
    [cards],
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

  const confirmWithSkyfi = useCallback(async () => {
    if (!selected) return
    const { latitude: lat, longitude: lon } = selected.sample
    if (lat == null || lon == null) {
      setSkyfiNote('No coordinates on this pad — cannot query SkyFi.')
      return
    }
    setSkyfiBusy(true)
    setSkyfiNote(null)
    try {
      // Force SkyFi preference by calling the imagery route (SkyFi first when keyed).
      const params = new URLSearchParams({
        lat: String(lat),
        lon: String(lon),
      })
      const res = await fetch(`/api/pad-activity/sentinel?${params.toString()}`)
      const json = await res.json()
      if (!json?.success || !json?.data?.url) {
        setSkyfiNote(json?.error || 'No SkyFi / Sentinel preview returned.')
        return
      }
      const src = json.data.source === 'skyfi' ? 'SkyFi' : 'Sentinel fallback'
      setSkyfiNote(
        `${src} scene ${json.data.date || 'n/d'}` +
          (json.data.resolution ? ` · ${json.data.resolution}` : '') +
          ' — use the live frame to confirm the change.',
      )
      // Soft-select: reload isn't needed; frames component already shows on-demand
      // when pair missing. When pair exists, open the preview URL in a new tab.
      if (selected.sample.before_path || selected.sample.after_path) {
        window.open(json.data.url, '_blank', 'noopener,noreferrer')
      }
    } catch (err) {
      setSkyfiNote(err instanceof Error ? err.message : 'SkyFi confirm failed')
    } finally {
      setSkyfiBusy(false)
    }
  }, [selected])

  const requestHires = useCallback(async () => {
    if (!selected) return
    const { latitude: lat, longitude: lon, id } = selected.sample
    if (lat == null || lon == null) {
      setSkyfiNote('No coordinates on this pad — cannot pull hi-res.')
      return
    }
    setSkyfiBusy(true)
    setSkyfiNote(null)
    try {
      const body =
        id > 0
          ? { event_id: id, force: true }
          : { lat, lon, county_id: selected.sample.county_id, api_number: selected.sample.api_number }
      const res = await fetch('/api/pad-activity/hires', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!json?.success) {
        setSkyfiNote(json?.error || 'Hi-res pull failed')
        return
      }
      const url = json.data?.signed_url as string | undefined
      setSkyfiNote(
        `${json.data?.hires_label || 'Hi-res'} ready` +
          (json.data?.hires_source ? ` · ${json.data.hires_source}` : ''),
      )
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
      if (id > 0) await load()
    } catch (err) {
      setSkyfiNote(err instanceof Error ? err.message : 'Hi-res pull failed')
    } finally {
      setSkyfiBusy(false)
    }
  }, [selected, load])

  return (
    <div className="pad-ops">
      <header className="pad-ops-top">
        <Link href="/" className="pad-ops-brand">
          <strong>Satellite Imagery</strong>
          <span>Pad Ops · catch crews before the filing</span>
        </Link>
        <div className="pad-ops-top-meta">
          <span className="live">Live desk</span>
          <span>
            {loading
              ? 'syncing…'
              : `${cards.length} signals · ${completionCount} completion`}
          </span>
          <span>{leads.length} leads in window</span>
          {!loading && feedSource === 'rrc_live' && (
            <span style={{ color: '#f5a524' }} title="Stored before/after chips land when the weekly Sentinel job finishes — showing public filings as a watchlist until then">
              Filing watchlist · before/after chips pending weekly job
            </span>
          )}
        </div>
        <nav className="pad-ops-nav">
          <Link href="/permits">Permits</Link>
          <Link href="/">Map</Link>
        </nav>
      </header>

      <div className="pad-ops-body">
        {/* Left: signal list */}
        <aside className="pad-ops-rail">
          <div className="pad-ops-rail-head">
            <h2>Signals</h2>
            <div className="pad-ops-filters">
              {([14, 30, 90] as WindowChoice[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  className="pad-ops-chip"
                  data-active={windowDays === d}
                  onClick={() => setWindowDays(d)}
                >
                  {d}d
                </button>
              ))}
            </div>
            <div className="pad-ops-filters">
              <button
                type="button"
                className="pad-ops-chip"
                data-active={signalFilter === 'lifecycle'}
                onClick={() => setSignalFilter('lifecycle')}
              >
                Early edge
              </button>
              <button
                type="button"
                className="pad-ops-chip"
                data-active={signalFilter === 'all'}
                onClick={() => setSignalFilter('all')}
              >
                All
              </button>
              <button
                type="button"
                className="pad-ops-chip"
                data-active={signalFilter === 'RRC_APPROVED'}
                onClick={() => setSignalFilter('RRC_APPROVED')}
              >
                Approved
              </button>
              <button
                type="button"
                className="pad-ops-chip"
                data-active={signalFilter === 'RRC_COMPLETION'}
                onClick={() => setSignalFilter('RRC_COMPLETION')}
              >
                Completion
              </button>
              <button
                type="button"
                className="pad-ops-chip"
                data-active={signalFilter === 'COMPLETION_CREW'}
                onClick={() => setSignalFilter('COMPLETION_CREW')}
              >
                Crew
              </button>
            </div>
            <div className="pad-ops-filters">
              <button
                type="button"
                className="pad-ops-chip"
                data-active={countyFilter === 'all'}
                onClick={() => setCountyFilter('all')}
              >
                All counties
              </button>
              {COUNTY_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="pad-ops-chip"
                  data-active={countyFilter === c}
                  onClick={() => setCountyFilter(c)}
                >
                  {COUNTIES[c]?.name || c}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="pad-ops-loading">Scanning pad change feed…</div>
          ) : cards.length === 0 ? (
            <div className="pad-ops-empty">
              {events.length > 0
                ? `${events.length} signal${events.length === 1 ? '' : 's'} hidden by filter — try All.`
                : 'No pad signals yet in this window.'}
              <br />
              {events.length === 0
                ? 'Check county permits scrape, or widen the 90d window.'
                : 'Lifecycle includes approved / spud / completion / crew.'}
            </div>
          ) : (
            cards.map(({ key, sample }) => {
              const tone = SIG_TONE[sample.signature] || 'muted'
              const b = briefForSignature(sample.signature)
              return (
                <button
                  key={key}
                  type="button"
                  className="pad-ops-event"
                  data-active={sample.id === selectedId}
                  onClick={() => {
                    setSelectedId(sample.id)
                    setSkyfiNote(null)
                  }}
                >
                  <div className="sig" data-tone={tone}>
                    {b.headline}
                  </div>
                  <div className="title">
                    {sample.lease_name || sample.api_number || 'Unnamed pad'}
                  </div>
                  <div className="meta">
                    {(COUNTIES[sample.county_id]?.name || sample.county_id)}
                    {sample.abstract_number ? ` · A-${sample.abstract_number}` : ''}
                    {' · '}
                    {Math.round((sample.confidence || 0) * 100)}%
                  </div>
                </button>
              )
            })
          )}
        </aside>

        {/* Center: imagery stage */}
        <main className="pad-ops-stage">
          {error && (
            <div
              style={{
                padding: '10px 12px',
                border: '1px solid rgba(251,113,133,0.45)',
                background: 'rgba(251,113,133,0.08)',
                color: '#fecdd3',
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}

          {!selected ? (
            <div className="pad-ops-empty" style={{ margin: 'auto' }}>
              Select a signal to open the change desk.
            </div>
          ) : (
            <>
              <div className="pad-ops-stage-head">
                <div>
                  <h1>{brief.headline}</h1>
                  <div className="sub">
                    {selected.sample.lease_name || 'Unknown lease'}
                    {selected.sample.operator_name
                      ? ` · ${selected.sample.operator_name}`
                      : ''}
                    {' · '}
                    {countyName}
                    {selected.sample.api_number
                      ? ` · API ${selected.sample.api_number}`
                      : ''}
                  </div>
                </div>
                <div className="sub">
                  Week of {selected.sample.week_start}
                  {' · '}
                  source {selected.sample.source.replace(/_/g, ' ')}
                </div>
              </div>

              <PadOpsFrames
                beforeUrl={beforeUrl}
                afterUrl={afterUrl}
                beforeLabel={brief.beforeLabel}
                afterLabel={brief.afterLabel}
                annotations={brief.annotations}
                fallbackLat={selected.sample.latitude}
                fallbackLon={selected.sample.longitude}
                showAnnotationsOn={
                  beforeUrl || afterUrl ? 'after' : 'after'
                }
              />
            </>
          )}
        </main>

        {/* Right: explanation + actions */}
        <aside className="pad-ops-brief">
          <div className="pad-ops-brief-head">
            <h2>Readout</h2>
          </div>
          {!selected ? (
            <div className="pad-ops-empty">Waiting for selection…</div>
          ) : (
            <div className="pad-ops-brief-body">
              <div>
                <h3>{brief.headline}</h3>
                <p>{brief.story}</p>
              </div>

              <div className="pad-ops-stat-row">
                <div className="pad-ops-stat">
                  <div className="k">Confidence</div>
                  <div className="v">{confidencePct}%</div>
                </div>
                <div className="pad-ops-stat">
                  <div className="k">Change score</div>
                  <div className="v">
                    {selected.sample.change_score != null
                      ? Number(selected.sample.change_score).toFixed(2)
                      : '—'}
                  </div>
                </div>
              </div>

              <ol className="pad-ops-bullets">
                {brief.bullets.map((line, i) => (
                  <li key={line}>
                    <span className="index">0{i + 1}</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ol>

              {selected.sample.summary && (
                <div>
                  <div
                    style={{
                      fontFamily: 'IBM Plex Mono, monospace',
                      fontSize: 9,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: '#8b9bb8',
                      marginBottom: 6,
                    }}
                  >
                    Filing / model note
                  </div>
                  <p>{selected.sample.summary}</p>
                </div>
              )}

              <div className="pad-ops-skyfi">
                <div className="title">Confirm imagery</div>
                <p>{brief.skyfiHint}</p>
                <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  <button
                    type="button"
                    className="pad-ops-btn amber"
                    disabled={skyfiBusy}
                    onClick={() => void confirmWithSkyfi()}
                    style={{ width: '100%' }}
                  >
                    {skyfiBusy ? 'Querying archive…' : 'Confirm with SkyFi'}
                  </button>
                  <button
                    type="button"
                    className="pad-ops-btn"
                    disabled={skyfiBusy}
                    onClick={() => void requestHires()}
                    style={{ width: '100%' }}
                  >
                    {skyfiBusy ? 'Pulling…' : 'Request Mapbox / NAIP hi-res'}
                  </button>
                </div>
                {skyfiNote && (
                  <p style={{ marginTop: 8, color: '#fde68a' }}>{skyfiNote}</p>
                )}
              </div>

              {selected.sample.signature === 'AMBIGUOUS' && (beforeUrl || afterUrl) && (
                <div className="pad-ops-actions">
                  <button
                    type="button"
                    className="pad-ops-btn primary"
                    disabled={reviewingId === selected.sample.id}
                    onClick={() =>
                      void submitReview(selected.sample.id, 'COMPLETION_CREW')
                    }
                  >
                    Mark completion crew
                  </button>
                  <button
                    type="button"
                    className="pad-ops-btn"
                    disabled={reviewingId === selected.sample.id}
                    onClick={() =>
                      void submitReview(selected.sample.id, 'RIG_MOVE_IN')
                    }
                  >
                    Mark rig / pad
                  </button>
                  <button
                    type="button"
                    className="pad-ops-btn"
                    disabled={reviewingId === selected.sample.id}
                    onClick={() =>
                      void submitReview(selected.sample.id, 'NON_RELEVANT')
                    }
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <div className="pad-ops-actions">
                <Link
                  href={mapHrefForEvent(selected.sample)}
                  className="pad-ops-btn primary"
                >
                  Open owners on map
                </Link>
              </div>

              <div>
                <div
                  style={{
                    fontFamily: 'IBM Plex Mono, monospace',
                    fontSize: 9,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: '#8b9bb8',
                    marginBottom: 8,
                  }}
                >
                  Mineral owners
                </div>
                {selected.owners.length === 0 ? (
                  <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: '#8b9bb8' }}>
                    No owner names on this event row yet — open the map tract for the full list.
                  </p>
                ) : (
                  <div className="pad-ops-owners">
                    {selected.owners.slice(0, 12).map((name) => (
                      <div key={name} className="pad-ops-owner">
                        {name}
                      </div>
                    ))}
                    {selected.owners.length > 12 && (
                      <div className="pad-ops-owner">
                        +{selected.owners.length - 12} more on map
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
