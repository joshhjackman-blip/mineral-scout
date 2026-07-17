'use client'

import { useState } from 'react'

type OwnerDemoRow = {
  name: string
  location: string
  score: number
  nra: string
  estMonthly?: string
}

const DEMO_STEPS = [
  {
    title: 'Welcome',
    description: 'Overview of the prospecting workspace.',
  },
  {
    title: 'Map Tiers',
    description: 'Tracts are colored by opportunity priority.',
  },
  {
    title: 'Selected Tract',
    description: 'AB 266 is selected and owner panel appears.',
  },
  {
    title: 'Score Breakdown',
    description: 'Top owner rationale expands for quick review.',
  },
  {
    title: 'Size at a glance',
    description: 'Net mineral acres are emphasized for sizing.',
  },
  {
    title: 'Skip Trace Ready',
    description: 'One click to enrich contact data.',
  },
  {
    title: 'Contact Found',
    description: 'Phone and email are returned for outreach.',
  },
]

const OWNER_ROWS: OwnerDemoRow[] = [
  { name: 'HAR██████ J.T.', location: 'Denver CO', score: 9, nra: '0.192 NMA', estMonthly: '~$847/mo' },
  { name: 'BRO██████ M.K.', location: 'Phoenix AZ', score: 7, nra: '0.096 NMA', estMonthly: '~$421/mo' },
  { name: 'WIL████ TRUST', location: 'Dallas TX', score: 5, nra: '0.048 NMA' },
  { name: 'FRONTIER MINERALS LLC', location: 'San Antonio TX', score: 2, nra: '62.500 NMA' },
]

const TRACTS = [
  { id: 'AB-121', x: 20, y: 20, w: 140, h: 80, tier: 'gray' as const },
  { id: 'AB-346', x: 172, y: 20, w: 126, h: 80, tier: 'orange' as const },
  { id: 'AB-98', x: 310, y: 20, w: 150, h: 80, tier: 'green' as const },
  { id: 'AB-150', x: 20, y: 112, w: 140, h: 90, tier: 'red' as const },
  { id: 'AB-266', x: 172, y: 112, w: 126, h: 90, tier: 'orange' as const },
  { id: 'AB-77', x: 310, y: 112, w: 150, h: 90, tier: 'gray' as const },
  { id: 'AB-41', x: 20, y: 214, w: 140, h: 86, tier: 'green' as const },
  { id: 'AB-233', x: 172, y: 214, w: 126, h: 86, tier: 'red' as const },
  { id: 'AB-321', x: 310, y: 214, w: 150, h: 86, tier: 'orange' as const },
]

const tierColor: Record<(typeof TRACTS)[number]['tier'], string> = {
  red: '#F44336',
  orange: '#EF9F27',
  green: '#7AB835',
  gray: '#5B616E',
}

export default function InteractiveDemo() {
  const [stepIndex, setStepIndex] = useState(0)
  const currentStep = stepIndex + 1

  const isTierHighlightStep = currentStep === 2
  const showPanel = currentStep >= 3
  const showScoreBreakdown = currentStep >= 4
  const emphasizeNra = currentStep >= 5
  const showSkipTraceButton = currentStep >= 6
  const showSkipTraceResult = currentStep >= 7

  return (
    <div
      style={{
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 14,
        background: '#0D1117',
        boxShadow: '0 14px 40px rgba(0,0,0,0.38)',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes demoPulseRing {
          0% { opacity: 0.95; transform: scale(1); }
          70% { opacity: 0.25; transform: scale(1.04); }
          100% { opacity: 0.95; transform: scale(1); }
        }
      `}</style>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.02)',
        }}
      >
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.08em', color: 'rgba(239,159,39,0.8)', fontWeight: 600 }}>
            STEP {currentStep} OF 7
          </div>
          <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{DEMO_STEPS[stepIndex].title}</div>
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{DEMO_STEPS[stepIndex].description}</div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.15fr 0.85fr',
          minHeight: 420,
        }}
      >
        <div
          style={{
            borderRight: '1px solid rgba(255,255,255,0.08)',
            padding: 14,
            background: '#0D1117',
          }}
        >
          <div
            style={{
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 10,
              background: '#121821',
              height: '100%',
              position: 'relative',
              boxShadow: isTierHighlightStep ? 'inset 0 0 0 2px rgba(239,159,39,0.65)' : 'none',
              transition: 'box-shadow 0.25s ease',
            }}
          >
            <svg viewBox="0 0 480 320" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
              <rect x="0" y="0" width="480" height="320" fill="#121821" />
              {TRACTS.map((tract) => (
                <g key={tract.id}>
                  <rect
                    x={tract.x}
                    y={tract.y}
                    width={tract.w}
                    height={tract.h}
                    fill={tierColor[tract.tier]}
                    opacity={0.78}
                    stroke="rgba(255,255,255,0.18)"
                    strokeWidth={1}
                    rx={5}
                  />
                  <text
                    x={tract.x + 8}
                    y={tract.y + 18}
                    fill="rgba(255,255,255,0.88)"
                    fontSize="11"
                    fontFamily="'DM Sans', sans-serif"
                  >
                    {tract.id}
                  </text>
                </g>
              ))}
              {currentStep >= 3 && (
                <rect
                  x={169}
                  y={109}
                  width={132}
                  height={96}
                  fill="none"
                  stroke="#EF9F27"
                  strokeWidth={3}
                  rx={7}
                  style={{ transformOrigin: '235px 157px', animation: 'demoPulseRing 1.4s ease-in-out infinite' }}
                />
              )}
            </svg>

            <div
              style={{
                position: 'absolute',
                left: 12,
                bottom: 10,
                display: 'flex',
                gap: 10,
                fontSize: 10,
                color: 'rgba(255,255,255,0.62)',
              }}
            >
              {[
                { label: 'HOT', color: '#F44336' },
                { label: 'WARM', color: '#EF9F27' },
                { label: 'STABLE', color: '#7AB835' },
                { label: 'LOW', color: '#5B616E' },
              ].map((tier) => (
                <div key={tier.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: tier.color, display: 'inline-block' }} />
                  <span>{tier.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          style={{
            padding: 14,
            background: '#10151E',
            opacity: showPanel ? 1 : 0.12,
            transform: showPanel ? 'translateX(0)' : 'translateX(10px)',
            transition: 'opacity 0.35s ease, transform 0.35s ease',
          }}
        >
          <div
            style={{
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 10,
              background: '#0D1117',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 10, color: 'rgba(239,159,39,0.82)', letterSpacing: '0.08em', fontWeight: 700 }}>
                SELECTED TRACT
              </div>
              <div style={{ fontSize: 14, color: '#fff', marginTop: 2 }}>A‑543 · Howard County</div>
            </div>

            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
              {OWNER_ROWS.map((owner, index) => {
                const isTopOwner = index === 0
                const scoreColor = owner.score >= 8 ? '#F44336' : owner.score >= 6 ? '#EF9F27' : '#7AB835'
                return (
                  <div
                    key={owner.name}
                    style={{
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 8,
                      padding: '8px 9px',
                      background: 'rgba(255,255,255,0.02)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: '#fff', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {owner.name}
                        </div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>{owner.location}</div>
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: scoreColor,
                          border: `1px solid ${scoreColor}66`,
                          borderRadius: 999,
                          padding: '2px 8px',
                          fontWeight: 700,
                          outline: showScoreBreakdown && isTopOwner ? '1px solid #EF9F27' : 'none',
                        }}
                      >
                        {owner.score}/10
                      </div>
                    </div>

                    <div style={{ marginTop: 6, display: 'flex', gap: 10, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10 }}>
                      <span style={{ color: emphasizeNra ? '#EF9F27' : 'rgba(255,255,255,0.68)' }}>{owner.nra}</span>
                      {owner.estMonthly && <span style={{ color: 'rgba(255,255,255,0.54)' }}>{owner.estMonthly}</span>}
                    </div>

                    {showScoreBreakdown && isTopOwner && (
                      <div
                        style={{
                          marginTop: 7,
                          borderTop: '1px dashed rgba(255,255,255,0.12)',
                          paddingTop: 7,
                          fontSize: 10,
                          color: 'rgba(255,255,255,0.62)',
                        }}
                      >
                        OOS + trust + active production + high response propensity
                      </div>
                    )}
                  </div>
                )
              })}

              <div style={{ marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10 }}>
                {showSkipTraceButton && (
                  <button
                    type="button"
                    style={{
                      width: '100%',
                      border: '1px solid rgba(239,159,39,0.55)',
                      background: 'rgba(239,159,39,0.14)',
                      color: '#EF9F27',
                      borderRadius: 7,
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '7px 10px',
                      cursor: 'default',
                    }}
                  >
                    Run skip trace
                  </button>
                )}
                {showSkipTraceResult && (
                  <div
                    style={{
                      marginTop: 8,
                      border: '1px solid rgba(122,184,53,0.48)',
                      background: 'rgba(122,184,53,0.12)',
                      borderRadius: 7,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: 10,
                      color: '#D1FAE5',
                      padding: '7px 8px',
                    }}
                  >
                    (720) 555-0182 · jhar●●●●@gmail.com
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.015)',
        }}
      >
        <button
          type="button"
          onClick={() => setStepIndex((prev) => Math.max(0, prev - 1))}
          disabled={stepIndex === 0}
          style={{
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'transparent',
            color: stepIndex === 0 ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.74)',
            borderRadius: 7,
            padding: '7px 11px',
            fontSize: 11,
            cursor: stepIndex === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          Prev
        </button>

        <div style={{ display: 'flex', gap: 7 }}>
          {DEMO_STEPS.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setStepIndex(idx)}
              aria-label={`Go to step ${idx + 1}`}
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                border: 'none',
                padding: 0,
                background: idx === stepIndex ? '#EF9F27' : 'rgba(255,255,255,0.2)',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => setStepIndex((prev) => Math.min(DEMO_STEPS.length - 1, prev + 1))}
          disabled={stepIndex === DEMO_STEPS.length - 1}
          style={{
            border: '1px solid rgba(239,159,39,0.5)',
            background: 'rgba(239,159,39,0.16)',
            color: stepIndex === DEMO_STEPS.length - 1 ? 'rgba(239,159,39,0.35)' : '#EF9F27',
            borderRadius: 7,
            padding: '7px 11px',
            fontSize: 11,
            cursor: stepIndex === DEMO_STEPS.length - 1 ? 'not-allowed' : 'pointer',
          }}
        >
          Next
        </button>
      </div>
    </div>
  )
}
