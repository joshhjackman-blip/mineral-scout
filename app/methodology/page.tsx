'use client'

import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

type SignalKey =
  | 'out_of_state_owner'
  | 'estate_or_probate'
  | 'life_estate'
  | 'irrevocable_trust'
  | 'living_trust'
  | 'out_of_state_llc_lp'
  | 'po_box'
  | 'small_acreage'
  | 'steep_decline'
  | 'tiny_interest'
  | 'low_value'

const SIGNALS: Array<{ key: SignalKey; label: string; points: number }> = [
  { key: 'out_of_state_owner', label: 'Out of state owner', points: 3 },
  { key: 'estate_or_probate', label: 'Estate or probate', points: 4 },
  { key: 'life_estate', label: 'Life estate', points: 4 },
  { key: 'irrevocable_trust', label: 'Irrevocable trust', points: 3 },
  { key: 'living_trust', label: 'Living trust', points: 2 },
  { key: 'out_of_state_llc_lp', label: 'Out of state LLC/LP', points: 2 },
  { key: 'po_box', label: 'PO Box address', points: 1 },
  { key: 'small_acreage', label: 'Small acreage (<5 acres)', points: 3 },
  { key: 'steep_decline', label: 'Steep production decline', points: 3 },
  { key: 'tiny_interest', label: 'Tiny fractional interest', points: 2 },
  { key: 'low_value', label: 'Low appraised value', points: 2 },
]

const SCORE_DISTRIBUTION = [
  { score: '10', owners: 657 },
  { score: '9', owners: 1190 },
  { score: '8', owners: 2103 },
  { score: '7', owners: 7232 },
  { score: '6', owners: 2542 },
  { score: '5', owners: 9273 },
  { score: '4', owners: 26362 },
  { score: '3', owners: 6936 },
  { score: '2', owners: 6638 },
  { score: '1', owners: 6465 },
  { score: '0', owners: 4191 },
]

const LAYER_CARDS = [
  {
    id: 'parcels',
    title: 'Parcel Polygons',
    detail: 'Color intensity reflects the highest-scoring owner in each tract. Click any tract to open a ranked owner list instantly.',
  },
  {
    id: 'wells',
    title: 'Well Dots ● green ● red',
    detail:
      'Green wells indicate production and active royalties. Red wells indicate shut-in status. Shut-in owners often have immediate motivation because income has dropped.',
  },
  {
    id: 'permits',
    title: 'Blue Dots ●',
    detail:
      'Blue dots indicate recent nearby drilling activity. New development can create urgency and pricing pressure before broad market outreach begins.',
  },
] as const

const FAQS = [
  {
    q: 'How accurate are the scores?',
    a: 'Scores are directional, not absolute. They prioritize outreach order by combining owner profile, asset characteristics, and activity signals into one ranking.',
  },
  {
    q: 'What does HBP mean?',
    a: 'HBP means Held by Production. If a lease continues producing, it can stay active beyond its primary term.',
  },
  {
    q: 'What is a survey abstract?',
    a: 'A survey abstract is a land reference unit used to organize tracts and ownership records for mapping and title work.',
  },
  {
    q: 'Why do some tracts show no owners?',
    a: 'Some tracts have incomplete or unmatched ownership records. These are retained on the map so coverage remains complete as matching improves.',
  },
  {
    q: 'How often is data updated?',
    a: 'Property, production, and activity datasets are refreshed on a recurring cadence, with scoring recalculated after each refresh cycle.',
  },
  {
    q: 'What makes someone NOT motivated to sell?',
    a: 'Large acreage, strong stable cash flow, nearby residency, and low ownership friction are common characteristics of lower motivation.',
  },
]

const scoreColor = (score: number) => {
  if (score <= 3) return '#16A34A'
  if (score <= 6) return '#D97706'
  if (score <= 8) return '#F97316'
  return '#DC2626'
}

const scoreMessage = (score: number) => {
  if (score <= 3) return 'Low motivation — focus elsewhere'
  if (score <= 5) return 'Some signals — worth monitoring'
  if (score <= 7) return 'Warm lead — add to nurture list'
  if (score <= 9) return 'Hot lead — prioritize outreach now'
  return '🔴 Maximum motivation — call today'
}

export default function MethodologyPage() {
  const [signals, setSignals] = useState<Record<SignalKey, boolean>>({
    out_of_state_owner: false,
    estate_or_probate: false,
    life_estate: false,
    irrevocable_trust: false,
    living_trust: false,
    out_of_state_llc_lp: false,
    po_box: false,
    small_acreage: false,
    steep_decline: false,
    tiny_interest: false,
    low_value: false,
  })
  const [openLayer, setOpenLayer] = useState<(typeof LAYER_CARDS)[number]['id'] | null>(null)
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  const rawScore = useMemo(
    () =>
      SIGNALS.reduce((sum, signal) => (signals[signal.key] ? sum + signal.points : sum), 0),
    [signals]
  )
  const score = Math.min(10, rawScore)
  const focusedOwners = 13724
  const totalOwners = 73589
  const focusedPct = Math.round((focusedOwners / totalOwners) * 100)

  return (
    <div style={{ minHeight: '100vh', background: '#F8F8F8', color: '#111827', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 20px 48px' }}>
        {/* Hero */}
        <section style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: 28, marginBottom: 18 }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 36, fontWeight: 700, marginBottom: 10 }}>
            How Mineral Map Works
          </div>
          <div style={{ color: '#4B5563', fontSize: 16, lineHeight: 1.6, maxWidth: 760 }}>
            The most sophisticated mineral rights prospecting platform ever built for the Eagle Ford Basin.
          </div>
          <a href="#calculator" style={{ display: 'inline-block', marginTop: 20, color: '#EF9F27', textDecoration: 'none', fontWeight: 600 }}>
            Explore the scoring system ↓
          </a>
        </section>

        {/* Calculator */}
        <section id="calculator" style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: 24, marginBottom: 18 }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 24, fontWeight: 700, marginBottom: 4 }}>BUILD A PROPENSITY SCORE</div>
          <div style={{ color: '#6B7280', marginBottom: 16 }}>Toggle signals on/off and watch the score update live:</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {SIGNALS.map((signal) => (
              <label
                key={signal.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: '#F9FAFB',
                  border: '1px solid #E5E7EB',
                  borderRadius: 8,
                  padding: '10px 12px',
                  cursor: 'pointer',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={signals[signal.key]}
                    onChange={() =>
                      setSignals((prev) => ({ ...prev, [signal.key]: !prev[signal.key] }))
                    }
                  />
                  <span style={{ fontSize: 13 }}>{signal.label}</span>
                </span>
                <span style={{ fontSize: 12, color: '#6B7280' }}>+{signal.points} pts</span>
              </label>
            ))}
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 8 }}>LIVE SCORE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, height: 16, background: '#E5E7EB', borderRadius: 999, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${(score / 10) * 100}%`,
                    height: '100%',
                    background: scoreColor(score),
                    transition: 'width 220ms ease, background 220ms ease',
                  }}
                />
              </div>
              <div style={{ minWidth: 54, textAlign: 'right', color: scoreColor(score), fontWeight: 700 }}>
                {score}/10
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: '#6B7280' }}>
              [ 0 1 2 3 4 5 6 7 8 9 10 ] &nbsp;&nbsp; LOW → WARM → HOT 🔴
            </div>
            <div style={{ marginTop: 10, fontSize: 14, color: scoreColor(score), fontWeight: 600 }}>
              {scoreMessage(score)}
            </div>
          </div>
        </section>

        {/* Layers */}
        <section style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: 24, marginBottom: 18 }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 24, fontWeight: 700, marginBottom: 12 }}>
            WHAT EACH MAP LAYER TELLS YOU
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {LAYER_CARDS.map((card) => {
              const isOpen = openLayer === card.id
              return (
                <div key={card.id} style={{ border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden' }}>
                  <button
                    onClick={() => setOpenLayer(isOpen ? null : card.id)}
                    style={{
                      width: '100%',
                      background: '#FFFFFF',
                      border: 'none',
                      textAlign: 'left',
                      padding: '12px 14px',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      color: '#111827',
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{card.title}</span>
                    <span style={{ color: '#6B7280', fontSize: 12 }}>{isOpen ? 'Hide ↑' : 'Click to expand →'}</span>
                  </button>
                  <div style={{ maxHeight: isOpen ? 140 : 0, transition: 'max-height 220ms ease', overflow: 'hidden', background: '#F9FAFB' }}>
                    <div style={{ padding: '0 14px 14px', color: '#4B5563', fontSize: 13, lineHeight: 1.6 }}>
                      {card.id === 'parcels' && (
                        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', margin: '8px 0 12px', border: '1px solid #E5E7EB' }}>
                          {['#1a3a1a', '#4CAF50', '#FFC107', '#FF9800', '#F44336'].map((c) => (
                            <div key={c} style={{ flex: 1, background: c }} />
                          ))}
                        </div>
                      )}
                      {card.detail}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Distribution */}
        <section style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: 24, marginBottom: 18 }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 24, fontWeight: 700, marginBottom: 14 }}>
            HOW GONZALES COUNTY SCORES
          </div>
          <div style={{ width: '100%', height: 290 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={SCORE_DISTRIBUTION}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="score" stroke="#6B7280" />
                <YAxis stroke="#6B7280" />
                <Tooltip
                  formatter={(value) => `${Number(value ?? 0).toLocaleString()} owners`}
                  labelFormatter={(label) => `Score ${label}`}
                  contentStyle={{ background: '#FFFFFF', border: '1px solid #E5E7EB' }}
                />
                <Bar dataKey="owners" fill="#EF9F27" radius={[6, 6, 0, 0]} animationDuration={900} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ marginTop: 10, background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 8, padding: '10px 12px', fontSize: 13 }}>
            You are focused on {focusedOwners.toLocaleString()} owners ({focusedPct}%) most likely to sell.
          </div>
        </section>

        {/* FAQ */}
        <section style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: 24, marginBottom: 18 }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 24, fontWeight: 700, marginBottom: 12 }}>FAQ</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {FAQS.map((item, index) => {
              const open = openFaq === index
              return (
                <div key={item.q} style={{ border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden' }}>
                  <button
                    onClick={() => setOpenFaq(open ? null : index)}
                    style={{
                      width: '100%',
                      border: 'none',
                      background: '#FFFFFF',
                      textAlign: 'left',
                      padding: '11px 13px',
                      fontSize: 14,
                      color: '#111827',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>{item.q}</span>
                    <span style={{ color: '#6B7280' }}>{open ? '−' : '+'}</span>
                  </button>
                  <div style={{ maxHeight: open ? 140 : 0, transition: 'max-height 200ms ease', overflow: 'hidden', background: '#F9FAFB' }}>
                    <div style={{ padding: '0 13px 12px', color: '#4B5563', fontSize: 13, lineHeight: 1.6 }}>{item.a}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* CTA */}
        <section style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: 24 }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 24, fontWeight: 700, marginBottom: 12 }}>
            Ready to find your next acquisition?
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <a
              href="/"
              style={{
                textDecoration: 'none',
                padding: '9px 14px',
                borderRadius: 8,
                border: '1px solid #E5E7EB',
                color: '#374151',
                fontSize: 13,
              }}
            >
              ← Back to Map
            </a>
            <a
              href="/crm"
              style={{
                textDecoration: 'none',
                padding: '9px 14px',
                borderRadius: 8,
                border: '1px solid #EF9F27',
                color: '#EF9F27',
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              Open CRM →
            </a>
          </div>
        </section>
      </div>
    </div>
  )
}
