'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'

type SignalCard = {
  name: string
  points: number
  what: string
  why: string
  angle: string
}

const SIGNALS: SignalCard[] = [
  {
    name: 'Out of State Address',
    points: 3,
    what: 'Mailing address is outside Texas.',
    why: 'Remote owners typically have less land attachment and higher admin friction for small mineral checks.',
    angle: 'Lead with remote close simplicity and certainty of funds.',
  },
  {
    name: 'Estate / Probate',
    points: 4,
    what: 'Owner record includes Estate / probate indicators.',
    why: 'Probate complexity and distributed heirs often increase motivation for a clean liquidation event.',
    angle: 'Position as a clean resolution path for executors and heirs.',
  },
  {
    name: 'Life Estate',
    points: 4,
    what: 'Owner record indicates life-estate structure.',
    why: 'Lifecycle-driven planning tends to favor immediate liquidity and reduced complexity.',
    angle: 'Emphasize certainty, timing, and reduced family admin burden.',
  },
  {
    name: 'Irrevocable Trust',
    points: 3,
    what: 'Trust ownership with irrevocable language.',
    why: 'Trustees often prefer lower-friction assets and clean fiduciary accounting.',
    angle: 'Frame as prudent trust administration and simplification.',
  },
  {
    name: 'Small Acreage Interest',
    points: 2,
    what: 'Low net acreage and fragmented ownership.',
    why: 'Small positions can be operationally noisy relative to monthly cash flow.',
    angle: 'Anchor on lump-sum conversion of low monthly value.',
  },
  {
    name: 'Steep Production Decline',
    points: 3,
    what: 'Decline curve indicates shrinking cash flow trajectory.',
    why: 'Owners are more willing to monetize before further decline.',
    angle: 'Present timing/decay tradeoff with clear valuation logic.',
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

const FAQS = [
  {
    q: 'Is this score a guarantee of conversion?',
    a: 'No. It is a prioritization signal, not a certainty metric. It should be paired with title validation and outreach quality.',
  },
  {
    q: 'Can owners on the same tract have different scores?',
    a: 'Yes. Tract context is shared, but ownership structures and address/legal signals vary at the owner level.',
  },
  {
    q: 'How frequently is this refreshed?',
    a: 'Whenever source datasets and enrichment jobs are refreshed for Gonzales County.',
  },
  {
    q: 'Why do some producing tracts still score high?',
    a: 'Legal complexity, remote ownership, and fractional interests can outweigh current production strength.',
  },
]

const TOTAL_OWNER_COUNT = SCORE_DISTRIBUTION.reduce((sum, row) => sum + row.owners, 0)
const MOTIVATED_OWNER_COUNT = SCORE_DISTRIBUTION.reduce((sum, row) => (Number(row.score) >= 5 ? sum + row.owners : sum), 0)
const HOT_LEAD_COUNT = SCORE_DISTRIBUTION.reduce((sum, row) => (Number(row.score) >= 8 ? sum + row.owners : sum), 0)

export default function MethodologyPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-5 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-amber-400 rounded-md flex items-center justify-center">
            <span className="text-white text-sm font-bold">M</span>
          </div>
          <span className="font-serif text-base font-bold text-white">Mineral Map</span>
          <span className="text-gray-600 text-sm">·</span>
          <span className="text-sm font-medium text-gray-400">Methodology</span>
        </div>
        <nav className="flex items-center gap-1">
          <Link href="/" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors">← Map</Link>
          <Link href="/crm" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors">CRM</Link>
          <Link href="/comps" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors">Comps</Link>
        </nav>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-56 shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Contents</div>
          <nav className="space-y-1">
            {['Propensity Score', 'Score Distribution', 'Signal Reference', 'Map Layers', 'FAQ'].map((section) => (
              <a
                key={section}
                href={`#${section.toLowerCase().replace(/ /g, '-')}`}
                className="block px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-md transition-colors"
              >
                {section}
              </a>
            ))}
          </nav>
        </aside>

        <main className="flex-1 overflow-y-auto bg-gray-50 p-8">
          <section className="mb-8">
            <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Mineral Map Intelligence</div>
            <h1 className="font-serif text-4xl font-bold text-gray-900 mb-3">How We Score Mineral Rights Owners</h1>
            <p className="text-sm text-gray-600 leading-relaxed max-w-4xl">
              Mineral Map assigns each owner a 0–10 propensity score to prioritize acquisition outreach.
              Scores combine legal structure, geography, production profile, and ownership characteristics.
              This page documents signal logic and how to interpret map behavior in workflow.
            </p>
          </section>

          <section id="propensity-score" className="mb-8">
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Propensity Score</div>
              <p className="text-sm text-gray-600 leading-relaxed mb-4">
                Owners with score 5+ are marked motivated. High confidence “hot” leads are 8–10.
              </p>
              <div className="h-2 rounded-full bg-gradient-to-r from-green-500 via-yellow-400 to-red-500 relative">
                <div className="absolute left-1/2 top-[-4px] h-4 w-0.5 bg-gray-900" />
              </div>
              <div className="mt-2 flex justify-between text-xs text-gray-400">
                <span>0</span><span>2</span><span>4</span><span>6</span><span>8</span><span>10</span>
              </div>
            </div>
          </section>

          <section id="score-distribution" className="mb-8">
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Score Distribution</div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={SCORE_DISTRIBUTION}>
                    <XAxis dataKey="score" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} width={44} />
                    <Bar dataKey="owners" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Total owners</div>
                  <div className="font-serif text-xl font-bold text-gray-900">{TOTAL_OWNER_COUNT.toLocaleString()}</div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="text-xs text-amber-700 mb-1">Motivated (5+)</div>
                  <div className="font-serif text-xl font-bold text-amber-700">{MOTIVATED_OWNER_COUNT.toLocaleString()}</div>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <div className="text-xs text-red-600 mb-1">Hot leads (8–10)</div>
                  <div className="font-serif text-xl font-bold text-red-600">{HOT_LEAD_COUNT.toLocaleString()}</div>
                </div>
              </div>
            </div>
          </section>

          <section id="signal-reference" className="mb-8">
            <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Signal Reference</div>
            {SIGNALS.map((signal) => (
              <div key={signal.name} className="bg-white border border-gray-200 border-l-4 border-l-amber-400 rounded-xl p-6 mb-4 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-serif text-lg font-bold text-gray-900">{signal.name}</h3>
                  <span className="bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-3 py-0.5 text-xs font-semibold">
                    +{signal.points} {signal.points === 1 ? 'point' : 'points'}
                  </span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {[
                    { label: 'WHAT IT MEANS', text: signal.what },
                    { label: 'WHY IT PREDICTS MOTIVATION', text: signal.why },
                    { label: 'OUTREACH ANGLE', text: signal.angle },
                  ].map((col) => (
                    <div key={col.label}>
                      <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">{col.label}</div>
                      <p className="text-sm text-gray-600 leading-relaxed">{col.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>

          <section id="map-layers" className="mb-8">
            <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Map Layers</div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {[
                {
                  title: 'Parcel Layer',
                  text: 'Color intensity reflects owner score concentration and helps rank outreach zones quickly.',
                },
                {
                  title: 'Well Status Layers',
                  text: 'Active, shut-in, and unknown wells reveal production context and urgency.',
                },
                {
                  title: 'Permits',
                  text: 'Permit activity can change owner economics and increase response likelihood.',
                },
              ].map((item) => (
                <div key={item.title} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                  <h3 className="font-serif text-lg font-bold text-gray-900 mb-2">{item.title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{item.text}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="faq">
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">FAQ</div>
              {FAQS.map((faq, i) => (
                <div key={faq.q} className="border-b border-gray-200 py-4 last:border-b-0">
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full flex items-center justify-between text-left"
                  >
                    <span className="font-serif text-base font-bold text-gray-900">{faq.q}</span>
                    <span className="text-amber-500 text-xl font-light ml-4 shrink-0">{openFaq === i ? '−' : '+'}</span>
                  </button>
                  {openFaq === i && (
                    <p className="mt-3 text-sm text-gray-600 leading-relaxed pr-8">{faq.a}</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
