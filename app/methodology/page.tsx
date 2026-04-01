'use client'

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'

type SignalCard = {
  title: string
  points: string
  meaning: string
  why: string
  angle: string
}

const SIGNAL_CARDS: SignalCard[] = [
  {
    title: 'Out of State Address',
    points: '+3 points',
    meaning: 'Mailing address is outside Texas.',
    why:
      "No physical connection to land. Receives only a check in mail. Out-of-state owners consistently accept lower multiples. Managing a small royalty from another state is administratively burdensome - property taxes, division orders, and operator changes all require attention they often can't give.",
    angle:
      'Lead with simplicity and remote closing. Emphasize lump sum vs ongoing administrative burden of a small royalty check.',
  },
  {
    title: 'Estate or Probate',
    points: '+4 points',
    meaning: 'The word "Estate" appears in the owner name.',
    why:
      'Mineral rights inside a probate estate create legal complexity for heirs. The estate must be kept open as long as minerals are held, generating ongoing legal fees. Heirs across multiple states often disagree on disposition. A clean cash offer removes complexity. This is consistently the highest-converting owner type in mineral acquisitions.',
    angle:
      '"We work with estates regularly and can close quickly. One payment, estate closed." Talk directly to executor or administrator.',
  },
  {
    title: 'Life Estate',
    points: '+4 points',
    meaning: 'Owner name contains "Life Estate".',
    why:
      'A life estate holder has rights only during their lifetime, then ownership passes to remaindermen. Holders are typically older and may prefer converting a constrained asset into immediate liquidity.',
    angle:
      'Focus on liquidity and legacy: convert the asset to cash now rather than leaving legal complexity for family.',
  },
  {
    title: 'Irrevocable Trust',
    points: '+3 points',
    meaning: 'Owner name contains "Irrevocable".',
    why:
      'Trustees have fiduciary duty to administer assets prudently. Small, remote mineral interests are high-friction to administer. Selling converts to cleaner, easier-to-manage cash.',
    angle:
      'Contact trustee directly and frame as simplification of fiduciary obligations.',
  },
  {
    title: 'Living Trust',
    points: '+2 points',
    meaning: 'Owner name contains "Living Trust".',
    why:
      'Living trusts are estate-planning vehicles. This signals financially organized owners who may be receptive to transactions that simplify their estate.',
    angle:
      'Acknowledge planning intent and emphasize quick close plus full paperwork handling.',
  },
  {
    title: 'Out of State LLC or LP',
    points: '+2 points',
    meaning: 'Business entity with out-of-state mailing address.',
    why:
      'Entity owners are economically driven with minimal emotional attachment. Remote entity administration of Texas minerals through agents is usually low priority.',
    angle:
      'Be direct and financial. Lead with certainty of close and clean terms.',
  },
  {
    title: 'PO Box Address',
    points: '+1 point',
    meaning: 'Mailing address is a PO Box.',
    why:
      'A PO Box can indicate mobility, intermediated communications, or intentional separation from physical location. In each case, attachment to the asset tends to be weaker.',
    angle:
      'Make first-touch outreach highly actionable with simple response options.',
  },
  {
    title: 'Small Acreage - under 5 acres',
    points: '+3 points',
    meaning: 'Mineral interest is under 5 net acres.',
    why:
      'Very small interests often produce small checks while preserving admin overhead (taxes, operator notices, division orders). Owners may prefer one-time conversion to cash.',
    angle:
      'Anchor on lump-sum conversion of a low monthly stream.',
  },
  {
    title: 'Small Acreage - 5 to 15 acres',
    points: '+2 points',
    meaning: 'Mineral interest is between 5 and 15 net acres.',
    why:
      'Still a relatively small ownership position with moderate administrative burden and variable return.',
    angle:
      'Use the same lump-sum framing, adjusted for larger ownership size.',
  },
  {
    title: 'Steep Production Decline',
    points: '+3 points',
    meaning: 'First 6-month production is >2.5x 60-month production.',
    why:
      'Shrinking royalty checks create urgency. Owners experiencing declines often seek to lock value before further deterioration.',
    angle:
      'Position offer timing around decline trajectory and certainty of proceeds.',
  },
  {
    title: 'Tiny Fractional Interest',
    points: '+2 points',
    meaning: 'Net revenue interest is less than 0.1%.',
    why:
      'Extremely small fractional interests can produce negligible cashflow and receive minimal owner attention.',
    angle:
      'Emphasize unexpected value realization for a very small position.',
  },
  {
    title: 'Low Appraised Value',
    points: '+2 points',
    meaning: 'County appraises interest below $5,000.',
    why:
      'Low valuation indicates constrained earning potential relative to ongoing ownership complexity.',
    angle:
      'Lead with total offer amount and certainty.',
  },
]

const SCORE_DISTRIBUTION = [
  { score: '10', owners: 2175 },
  { score: '9', owners: 1801 },
  { score: '8', owners: 7133 },
  { score: '7', owners: 2601 },
  { score: '6', owners: 8928 },
  { score: '5', owners: 25829 },
  { score: '4', owners: 7399 },
  { score: '3', owners: 6667 },
  { score: '2', owners: 6696 },
  { score: '1', owners: 4236 },
  { score: '0', owners: 124 },
]

const TOTAL_OWNER_COUNT = SCORE_DISTRIBUTION.reduce(
  (sum, row) => sum + row.owners,
  0
)
const MOTIVATED_OWNER_COUNT = SCORE_DISTRIBUTION.reduce((sum, row) => {
  return Number(row.score) >= 6 ? sum + row.owners : sum
}, 0)
const MOTIVATED_OWNER_PCT =
  (MOTIVATED_OWNER_COUNT / TOTAL_OWNER_COUNT) * 100
const SCORE_DISTRIBUTION_WITH_SHARE = SCORE_DISTRIBUTION.map((row) => ({
  ...row,
  share: (row.owners / TOTAL_OWNER_COUNT) * 100,
}))

export default function MethodologyPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#F8F8F8',
        color: '#111827',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <div
        style={{
          height: 52,
          background: '#FFFFFF',
          borderBottom: '1px solid #E5E7EB',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              background: '#EF9F27',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>
              M
            </span>
          </div>
          <span
            style={{
              fontFamily: 'Georgia, serif',
              fontSize: 16,
              fontWeight: 700,
              color: '#111827',
            }}
          >
            Mineral Map
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <a
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
            Back to Map
          </a>
          <a
            href="/crm"
            style={{
              fontSize: 12,
              color: '#EF9F27',
              textDecoration: 'none',
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #EF9F27',
              fontWeight: 500,
            }}
          >
            CRM &rarr;
          </a>
        </div>
      </div>

      <div style={{ maxWidth: 780, margin: '0 auto', padding: '34px 20px 54px' }}>
        <section style={{ marginBottom: 30 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.14em',
              color: '#9CA3AF',
              fontWeight: 600,
              marginBottom: 12,
            }}
          >
            MINERAL MAP INTELLIGENCE
          </div>
          <h1
            style={{
              fontFamily: 'Georgia, serif',
              fontSize: 38,
              lineHeight: 1.15,
              margin: 0,
              marginBottom: 14,
            }}
          >
            How We Score Mineral Rights Owners
          </h1>
          <p
            style={{
              fontSize: 16,
              color: '#374151',
              lineHeight: 1.8,
              margin: 0,
              maxWidth: 740,
            }}
          >
            Mineral Map assigns every mineral owner in Gonzales County a
            Propensity Score from 0 to 10 - a data-driven measure of how likely
            they are to sell their mineral interests. This document explains the
            methodology behind every signal, what each map layer represents, and
            how to interpret the scores in your acquisition work.
          </p>
          <div style={{ marginTop: 14, fontSize: 12, color: '#6B7280' }}>
            Last updated: March 2026 - Gonzales County, TX
          </div>
        </section>

        <section style={{ marginBottom: 34 }}>
          <h2
            style={{
              fontFamily: 'Georgia, serif',
              fontSize: 28,
              margin: 0,
              marginBottom: 12,
            }}
          >
            The Propensity Score (0-10)
          </h2>
          <p style={{ margin: 0, color: '#374151', lineHeight: 1.8, fontSize: 15 }}>
            Each owner receives weighted points across legal, geographic, and
            asset-level signals. Total points are normalized to a 0-10 scale.
            Owners with scores 6-10 are marked as motivated and prioritized for
            outreach.
          </p>

          <div
            style={{
              marginTop: 16,
              border: '1px solid #E5E7EB',
              borderRadius: 12,
              background: '#fff',
              padding: 16,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}
            >
              <span style={{ fontSize: 13, color: '#6B7280' }}>
                Example score threshold
              </span>
              <span style={{ fontSize: 13, color: '#111827', fontWeight: 600 }}>
                Motivated {'>='} 6
              </span>
            </div>
            <div
              style={{
                width: '100%',
                height: 11,
                borderRadius: 999,
                background:
                  'linear-gradient(90deg, #22C55E 0%, #EAB308 45%, #F97316 70%, #DC2626 100%)',
                position: 'relative',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: '60%',
                  top: -5,
                  width: 2,
                  height: 22,
                  background: '#111827',
                }}
              />
            </div>
            <div
              style={{
                marginTop: 8,
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 11,
                color: '#6B7280',
              }}
            >
              <span>0</span>
              <span>2</span>
              <span>4</span>
              <span>6</span>
              <span>8</span>
              <span>10</span>
            </div>
          </div>

          <div
            style={{
              marginTop: 18,
              border: '1px solid #E5E7EB',
              borderRadius: 12,
              background: '#fff',
              padding: 16,
            }}
          >
            <h3
              style={{
                margin: 0,
                marginBottom: 10,
                fontSize: 14,
                color: '#111827',
                fontWeight: 600,
              }}
            >
              Current score distribution
            </h3>
            <div style={{ width: '100%', height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={SCORE_DISTRIBUTION}>
                  <XAxis
                    dataKey="score"
                    tick={{ fontSize: 11, fill: '#6B7280' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#6B7280' }}
                    axisLine={false}
                    tickLine={false}
                    width={42}
                  />
                  <Bar dataKey="owners" fill="#EF9F27" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div
              style={{
                marginTop: 14,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 8,
              }}
            >
              <div
                style={{
                  border: '1px solid #FCD34D',
                  background: '#FFFBEB',
                  borderRadius: 10,
                  padding: '10px 12px',
                }}
              >
                <div style={{ fontSize: 11, color: '#92400E', marginBottom: 4 }}>
                  Motivated owners (score {'>='} 6)
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>
                  {MOTIVATED_OWNER_COUNT.toLocaleString()} ({MOTIVATED_OWNER_PCT.toFixed(1)}%)
                </div>
              </div>
              <div
                style={{
                  border: '1px solid #E5E7EB',
                  background: '#F9FAFB',
                  borderRadius: 10,
                  padding: '10px 12px',
                }}
              >
                <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>
                  Total scored owners
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>
                  {TOTAL_OWNER_COUNT.toLocaleString()}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12, borderTop: '1px solid #F3F4F6', paddingTop: 10 }}>
              <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 8 }}>
                Current score buckets
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: 8,
                }}
              >
                {SCORE_DISTRIBUTION_WITH_SHARE.map((bucket) => (
                  <div
                    key={bucket.score}
                    style={{
                      border: '1px solid #E5E7EB',
                      borderRadius: 10,
                      background: '#FFFFFF',
                      padding: '8px 10px',
                    }}
                  >
                    <div style={{ fontSize: 11, color: '#6B7280' }}>
                      Score {bucket.score}
                    </div>
                    <div style={{ fontSize: 14, color: '#111827', fontWeight: 600 }}>
                      {bucket.owners.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 11, color: '#9CA3AF' }}>
                      {bucket.share.toFixed(1)}% of owners
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section style={{ marginBottom: 34 }}>
          <h2
            style={{
              fontFamily: 'Georgia, serif',
              fontSize: 28,
              margin: 0,
              marginBottom: 12,
            }}
          >
            Signal Reference Table
          </h2>
          <p style={{ margin: 0, color: '#374151', lineHeight: 1.8, fontSize: 15 }}>
            These are the exact signals used in the current model and how to
            interpret them in real acquisition workflows.
          </p>

          <div
            style={{
              marginTop: 16,
              display: 'grid',
              gap: 12,
              gridTemplateColumns: '1fr',
            }}
          >
            {SIGNAL_CARDS.map((signal) => (
              <div
                key={signal.title}
                style={{
                  border: '1px solid #E5E7EB',
                  background: '#fff',
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 10,
                    marginBottom: 8,
                  }}
                >
                  <h3
                    style={{
                      margin: 0,
                      fontSize: 16,
                      fontFamily: 'Georgia, serif',
                      color: '#111827',
                    }}
                  >
                    {signal.title}
                  </h3>
                  <span
                    style={{
                      fontSize: 12,
                      color: '#B45309',
                      fontWeight: 700,
                      border: '1px solid #FCD34D',
                      background: '#FFFBEB',
                      borderRadius: 999,
                      padding: '3px 9px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {signal.points}
                  </span>
                </div>
                <p style={{ margin: 0, color: '#374151', fontSize: 13, marginBottom: 8 }}>
                  <strong>Meaning:</strong> {signal.meaning}
                </p>
                <p style={{ margin: 0, color: '#374151', fontSize: 13, marginBottom: 8 }}>
                  <strong>Why it matters:</strong> {signal.why}
                </p>
                <p style={{ margin: 0, color: '#374151', fontSize: 13 }}>
                  <strong>Outreach angle:</strong> {signal.angle}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section style={{ marginBottom: 34 }}>
          <h2
            style={{
              fontFamily: 'Georgia, serif',
              fontSize: 28,
              margin: 0,
              marginBottom: 12,
            }}
          >
            Understanding the Map Layers
          </h2>
          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            }}
          >
            <div
              style={{
                border: '1px solid #E5E7EB',
                borderRadius: 12,
                background: '#fff',
                padding: 14,
              }}
            >
              <h3 style={{ margin: 0, marginBottom: 8, fontSize: 15, color: '#111827' }}>
                Parcel Layer
              </h3>
              <p style={{ margin: 0, color: '#374151', fontSize: 13, lineHeight: 1.7 }}>
                Every polygon represents a survey parcel aggregated by abstract.
                Fill color reflects maximum propensity score observed among
                owners linked to that tract.
              </p>
            </div>
            <div
              style={{
                border: '1px solid #E5E7EB',
                borderRadius: 12,
                background: '#fff',
                padding: 14,
              }}
            >
              <h3 style={{ margin: 0, marginBottom: 8, fontSize: 15, color: '#111827' }}>
                Motivated Owners
              </h3>
              <p style={{ margin: 0, color: '#374151', fontSize: 13, lineHeight: 1.7 }}>
                The right panel highlights owners with score 6+ and surfaces the
                highest-priority records first, including direct mailing details
                and context for outreach.
              </p>
            </div>
            <div
              style={{
                border: '1px solid #E5E7EB',
                borderRadius: 12,
                background: '#fff',
                padding: 14,
              }}
            >
              <h3 style={{ margin: 0, marginBottom: 8, fontSize: 15, color: '#111827' }}>
                New Permits
              </h3>
              <p style={{ margin: 0, color: '#374151', fontSize: 13, lineHeight: 1.7 }}>
                Blue pulsing dots indicate recent permit activity. Permit
                proximity can increase urgency, especially for owners with small
                fractional interests and declining legacy production.
              </p>
            </div>
          </div>
        </section>

        <section style={{ marginBottom: 34 }}>
          <h2
            style={{
              fontFamily: 'Georgia, serif',
              fontSize: 28,
              margin: 0,
              marginBottom: 12,
            }}
          >
            Frequently Asked Questions
          </h2>

          <div style={{ display: 'grid', gap: 10 }}>
            {[
              {
                q: 'Is the score a prediction guarantee?',
                a: 'No. It is a prioritization tool based on historical patterns and current parcel/owner signals.',
              },
              {
                q: 'Can two owners in the same tract have different scores?',
                a: 'Yes. Parcel context is shared, but owner-level legal and address signals can differ substantially.',
              },
              {
                q: 'How often is scoring refreshed?',
                a: 'Scoring updates when source records are re-ingested and enrichment scripts are rerun.',
              },
              {
                q: 'Why are some high-producing tracts still motivated?',
                a: 'Ownership complexity (estate/trust), fractionalization, and remote administration can outweigh production strength.',
              },
            ].map((faq) => (
              <div
                key={faq.q}
                style={{
                  border: '1px solid #E5E7EB',
                  background: '#fff',
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 6 }}>
                  {faq.q}
                </div>
                <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.7 }}>{faq.a}</div>
              </div>
            ))}
          </div>
        </section>

        <section
          style={{
            border: '1px solid #FCD34D',
            background: '#FFFBEB',
            borderRadius: 14,
            padding: '18px 16px',
          }}
        >
          <h2
            style={{
              margin: 0,
              marginBottom: 8,
              fontFamily: 'Georgia, serif',
              fontSize: 24,
              color: '#111827',
            }}
          >
            Built for disciplined acquisition teams
          </h2>
          <p style={{ margin: 0, color: '#374151', lineHeight: 1.8, fontSize: 14 }}>
            The methodology is intentionally conservative and transparent. Use
            the score as a ranking engine, then validate with title, current
            lease context, and owner-specific conversation history in CRM.
          </p>
        </section>
      </div>
    </div>
  )
}
