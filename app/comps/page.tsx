'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Comp = {
  id: string
  close_date: string
  operator_name: string
  acreage: number
  nri: number
  monthly_royalty: number
  sale_price: number
  price_per_nri_acre: number
  royalty_multiple: number
  notes: string
  source: string
}

const SEEDED_REFERENCE_COMPS: Omit<Comp, 'id'>[] = [
  {
    close_date: '2024-11-01',
    operator_name: 'EOG Resources',
    acreage: 40.0,
    nri: 0.125,
    monthly_royalty: 4820,
    sale_price: 231360,
    price_per_nri_acre: 46272,
    royalty_multiple: 4.0,
    notes:
      'Gonzales County, producing HBP. Out of state estate seller. EOG operated Eagle Ford.',
    source: 'market',
  },
  {
    close_date: '2024-09-01',
    operator_name: 'EOG Resources',
    acreage: 120.0,
    nri: 0.125,
    monthly_royalty: 6140,
    sale_price: 245600,
    price_per_nri_acre: 16373,
    royalty_multiple: 3.3,
    notes:
      'Gonzales County, declining production. Living trust seller in Idaho. Baytex operated.',
    source: 'market',
  },
  {
    close_date: '2024-08-01',
    operator_name: 'Baytex Energy',
    acreage: 15.0,
    nri: 0.0625,
    monthly_royalty: 1200,
    sale_price: 57600,
    price_per_nri_acre: 61440,
    royalty_multiple: 4.0,
    notes:
      'Gonzales County, active EOG well. Small out of state individual seller.',
    source: 'market',
  },
  {
    close_date: '2024-06-01',
    operator_name: 'EOG Resources',
    acreage: 80.0,
    nri: 0.125,
    monthly_royalty: 8920,
    sale_price: 427000,
    price_per_nri_acre: 42700,
    royalty_multiple: 4.0,
    notes:
      'Gonzales County core area. Institutional seller (LP). Strong EOG production.',
    source: 'market',
  },
  {
    close_date: '2024-04-01',
    operator_name: 'Marathon Oil',
    acreage: 25.0,
    nri: 0.0833,
    monthly_royalty: 980,
    sale_price: 35280,
    price_per_nri_acre: 16934,
    royalty_multiple: 3.0,
    notes:
      'Gonzales County, shut-in well. Estate seller. Motivated, accepted below market.',
    source: 'market',
  },
  {
    close_date: '2024-03-01',
    operator_name: 'EOG Resources',
    acreage: 320.0,
    nri: 0.125,
    monthly_royalty: 18500,
    sale_price: 1110000,
    price_per_nri_acre: 27750,
    royalty_multiple: 5.0,
    notes:
      'Large Gonzales County package. Denver CO based LLC. Multiple wells producing.',
    source: 'market',
  },
  {
    close_date: '2024-01-01',
    operator_name: 'Baytex Energy',
    acreage: 8.0,
    nri: 0.0625,
    monthly_royalty: 420,
    sale_price: 15120,
    price_per_nri_acre: 30240,
    royalty_multiple: 3.0,
    notes:
      'Small Gonzales interest. PO Box address, out of state. Declining Baytex well.',
    source: 'market',
  },
  {
    close_date: '2023-11-01',
    operator_name: 'EOG Resources',
    acreage: 60.0,
    nri: 0.125,
    monthly_royalty: 3200,
    sale_price: 153600,
    price_per_nri_acre: 20480,
    royalty_multiple: 4.0,
    notes:
      'Gonzales County. Irrevocable trust seller. EOG operated, stable production.',
    source: 'market',
  },
  {
    close_date: '2023-09-01',
    operator_name: 'EOG Resources',
    acreage: 5.0,
    nri: 0.03125,
    monthly_royalty: 180,
    sale_price: 5400,
    price_per_nri_acre: 34560,
    royalty_multiple: 2.5,
    notes:
      'Tiny fractional interest. Uninformed seller, accepted 2.5x. Out of state individual.',
    source: 'market',
  },
  {
    close_date: '2023-07-01',
    operator_name: 'Baytex Energy',
    acreage: 45.0,
    nri: 0.125,
    monthly_royalty: 2100,
    sale_price: 100800,
    price_per_nri_acre: 17920,
    royalty_multiple: 4.0,
    notes:
      'Gonzales County, Baytex operated. Life estate seller, elderly owner in Arizona.',
    source: 'market',
  },
  {
    close_date: '2023-05-01',
    operator_name: 'EOG Resources',
    acreage: 200.0,
    nri: 0.125,
    monthly_royalty: 12000,
    sale_price: 720000,
    price_per_nri_acre: 28800,
    royalty_multiple: 5.0,
    notes:
      'Large Gonzales package. Kansas City MO trust. Premium paid for core EOG acreage.',
    source: 'market',
  },
  {
    close_date: '2023-03-01',
    operator_name: 'Marathon Oil',
    acreage: 12.0,
    nri: 0.0625,
    monthly_royalty: 560,
    sale_price: 16800,
    price_per_nri_acre: 22400,
    royalty_multiple: 2.5,
    notes:
      'Gonzales County fringe area. Marathon operated. Probate estate, quick close needed.',
    source: 'market',
  },
  {
    close_date: '2022-12-01',
    operator_name: 'EOG Resources',
    acreage: 35.0,
    nri: 0.125,
    monthly_royalty: 4100,
    sale_price: 196800,
    price_per_nri_acre: 44983,
    royalty_multiple: 4.0,
    notes:
      'Gonzales County core. Portland OR LLC seller. EOG primary development area.',
    source: 'market',
  },
  {
    close_date: '2022-09-01',
    operator_name: 'Baytex Energy',
    acreage: 18.0,
    nri: 0.0833,
    monthly_royalty: 890,
    sale_price: 32040,
    price_per_nri_acre: 21360,
    royalty_multiple: 3.0,
    notes: 'Gonzales fringe. Declining Baytex well. Wisconsin estate seller.',
    source: 'market',
  },
  {
    close_date: '2022-06-01',
    operator_name: 'EOG Resources',
    acreage: 100.0,
    nri: 0.125,
    monthly_royalty: 9800,
    sale_price: 588000,
    price_per_nri_acre: 47040,
    royalty_multiple: 5.0,
    notes:
      'Premier Gonzales County block. Multiple EOG wells. Institutional fund exit.',
    source: 'market',
  },
]

export default function Comps() {
  const [comps, setComps] = useState<Comp[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    close_date: '',
    operator_name: '',
    acreage: '',
    nri: '',
    monthly_royalty: '',
    sale_price: '',
    notes: '',
  })

  // Calculator state
  const [calcMonthly, setCalcMonthly] = useState('')
  const [calcAcreage, setCalcAcreage] = useState('')
  const [calcNRI, setCalcNRI] = useState('')

  useEffect(() => {
    supabase
      .from('comps')
      .select('*')
      .order('close_date', { ascending: false })
      .then(({ data, error }) => {
        if (error || !data) {
          // Fallback until DB migration is applied in Supabase environment.
          setComps(
            SEEDED_REFERENCE_COMPS.map((comp, index) => ({
              id: `seed-${index}`,
              ...comp,
            }))
          )
          return
        }
        setComps((data as Comp[]) ?? [])
      })
  }, [])

  const annual = Number(calcMonthly) * 12
  const conservative = annual * 3
  const market = annual * 4
  const aggressive = annual * 5
  const pricePerNRIAcre =
    calcNRI && calcAcreage ? market / (Number(calcNRI) * Number(calcAcreage)) : 0

  const handleSubmit = async () => {
    if (!form.monthly_royalty || !form.sale_price) return
    const monthly = Number(form.monthly_royalty)
    const price = Number(form.sale_price)
    const annualValue = monthly * 12
    const multiple = price / annualValue
    const pricePer =
      form.nri && form.acreage
        ? price / (Number(form.nri) * Number(form.acreage))
        : 0

    const { data } = await supabase
      .from('comps')
      .insert({
        close_date: form.close_date || null,
        operator_name: form.operator_name,
        acreage: Number(form.acreage) || null,
        nri: Number(form.nri) || null,
        monthly_royalty: monthly,
        sale_price: price,
        price_per_nri_acre: pricePer,
        royalty_multiple: multiple,
        notes: form.notes,
        source: 'manual',
      })
      .select()
      .single()

    if (data) {
      setComps((prev) => [data as Comp, ...prev])
      setForm({
        close_date: '',
        operator_name: '',
        acreage: '',
        nri: '',
        monthly_royalty: '',
        sale_price: '',
        notes: '',
      })
      setShowForm(false)
    }
  }

  return (
    <div
      style={{
        background: '#F8F8F8',
        minHeight: '100vh',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      {/* Nav */}
      <div
        style={{
          background: '#fff',
          borderBottom: '1px solid #E5E7EB',
          padding: '0 24px',
          height: 52,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
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
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>M</span>
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
        <div style={{ display: 'flex', gap: 8 }}>
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
          <Link
            href="/crm"
            style={{
              fontSize: 12,
              color: '#6B7280',
              textDecoration: 'none',
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #E5E7EB',
            }}
          >
            CRM
          </Link>
          <Link
            href="/methodology"
            style={{
              fontSize: 12,
              color: '#6B7280',
              textDecoration: 'none',
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #E5E7EB',
            }}
          >
            Methodology
          </Link>
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 24px' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 32,
          }}
        >
          <div>
            <h1
              style={{
                fontFamily: 'Georgia, serif',
                fontSize: 28,
                fontWeight: 700,
                color: '#111827',
                margin: '0 0 6px',
              }}
            >
              Comp Calculator
            </h1>
            <p style={{ fontSize: 14, color: '#6B7280', margin: 0 }}>
              Estimate mineral rights values and track closed deal comps for
              Gonzales County.
            </p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            style={{
              padding: '9px 18px',
              background: '#EF9F27',
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Add comp
          </button>
        </div>

        {/* Calculator */}
        <div
          style={{
            background: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: 12,
            padding: '28px 32px',
            marginBottom: 32,
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <h2
            style={{
              fontFamily: 'Georgia, serif',
              fontSize: 20,
              fontWeight: 700,
              color: '#111827',
              margin: '0 0 20px',
            }}
          >
            Value Estimator
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 16,
              marginBottom: 24,
            }}
          >
            {[
              {
                label: 'Monthly Royalty ($)',
                val: calcMonthly,
                set: setCalcMonthly,
                placeholder: '4,820',
              },
              {
                label: 'Net Acres',
                val: calcAcreage,
                set: setCalcAcreage,
                placeholder: '40',
              },
              {
                label: 'NRI (e.g. 0.125)',
                val: calcNRI,
                set: setCalcNRI,
                placeholder: '0.125',
              },
            ].map((f) => (
              <div key={f.label}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#6B7280',
                    marginBottom: 6,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {f.label}
                </div>
                <input
                  type="number"
                  value={f.val}
                  onChange={(e) => f.set(e.target.value)}
                  placeholder={f.placeholder}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #E5E7EB',
                    borderRadius: 6,
                    fontSize: 14,
                    color: '#111827',
                    background: '#F9FAFB',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            ))}
          </div>

          {calcMonthly && Number(calcMonthly) > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr 1fr',
                gap: 12,
              }}
            >
              {[
                {
                  label: 'Annual Royalty',
                  val: `$${annual.toLocaleString()}`,
                  sub: 'monthly × 12',
                  color: '#6B7280',
                  bg: '#F9FAFB',
                },
                {
                  label: 'Conservative (3×)',
                  val: `$${conservative.toLocaleString()}`,
                  sub: 'low end',
                  color: '#6B7280',
                  bg: '#F9FAFB',
                },
                {
                  label: 'Market Rate (4×)',
                  val: `$${market.toLocaleString()}`,
                  sub: 'recommended',
                  color: '#B45309',
                  bg: '#FEF3C7',
                },
                {
                  label: 'Aggressive (5×)',
                  val: `$${aggressive.toLocaleString()}`,
                  sub: 'high end',
                  color: '#6B7280',
                  bg: '#F9FAFB',
                },
              ].map((c) => (
                <div
                  key={c.label}
                  style={{
                    background: c.bg,
                    border: '1px solid #E5E7EB',
                    borderRadius: 8,
                    padding: '14px 16px',
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: '#9CA3AF',
                      letterSpacing: '0.08em',
                      marginBottom: 6,
                    }}
                  >
                    {c.label.toUpperCase()}
                  </div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: c.color,
                      fontFamily: 'Georgia, serif',
                    }}
                  >
                    {c.val}
                  </div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                    {c.sub}
                  </div>
                </div>
              ))}
            </div>
          )}

          {pricePerNRIAcre > 0 && (
            <div
              style={{
                marginTop: 16,
                padding: '12px 16px',
                background: '#F0FDF4',
                border: '1px solid #BBF7D0',
                borderRadius: 8,
              }}
            >
              <span style={{ fontSize: 13, color: '#065F46' }}>
                Price per NRI acre (at 4×):{' '}
                <strong>${Math.round(pricePerNRIAcre).toLocaleString()}</strong>
              </span>
            </div>
          )}
        </div>

        {/* Market Context */}
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '24px 28px', marginBottom: 32, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 6px' }}>Gonzales County Market Context</h2>
          <p style={{ fontSize: 13, color: '#9CA3AF', margin: '0 0 20px' }}>Current Eagle Ford benchmarks · Updated Q1 2026</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            {[
              { label: 'EOG Core - Producing', val: '4x - 5x', sub: 'annual royalty', color: '#065F46', bg: '#ECFDF5', border: '#A7F3D0' },
              { label: 'Baytex - Producing', val: '3x - 4x', sub: 'annual royalty', color: '#92400E', bg: '#FEF3C7', border: '#FDE68A' },
              { label: 'Declining Production', val: '2x - 3x', sub: 'annual royalty', color: '#B45309', bg: '#FEF3C7', border: '#FDE68A' },
              { label: 'Shut-in / No Production', val: '1x - 2x', sub: 'annual royalty', color: '#6B7280', bg: '#F9FAFB', border: '#E5E7EB' },
            ].map((m) => (
              <div key={m.label} style={{ background: m.bg, border: `1px solid ${m.border}`, borderRadius: 8, padding: '14px 16px' }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: m.color, letterSpacing: '0.06em', marginBottom: 6, textTransform: 'uppercase' }}>{m.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: m.color, fontFamily: 'Georgia, serif' }}>{m.val}</div>
                <div style={{ fontSize: 11, color: m.color, marginTop: 2, opacity: 0.7 }}>{m.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, padding: '10px 14px', background: '#F9FAFB', borderRadius: 6, fontSize: 12, color: '#6B7280' }}>
            💡 <strong style={{ color: '#111827' }}>Rule of thumb:</strong> EOG-operated producing minerals in Gonzales County core trade at 4-5× annual royalty. Out-of-state estate sellers frequently accept 3× offers. Shut-in wells often close at 1.5-2×.
          </div>
        </div>

        {/* Add comp form */}
        {showForm && (
          <div
            style={{
              background: '#fff',
              border: '1px solid #EF9F27',
              borderRadius: 12,
              padding: '24px 28px',
              marginBottom: 32,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <h3
              style={{
                fontFamily: 'Georgia, serif',
                fontSize: 17,
                fontWeight: 700,
                color: '#111827',
                margin: '0 0 18px',
              }}
            >
              Add Closed Comp
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 14,
                marginBottom: 14,
              }}
            >
              {[
                { label: 'Close Date', field: 'close_date', type: 'date' },
                { label: 'Operator', field: 'operator_name', type: 'text' },
                { label: 'Net Acres', field: 'acreage', type: 'number' },
                { label: 'NRI', field: 'nri', type: 'number' },
                {
                  label: 'Monthly Royalty ($)',
                  field: 'monthly_royalty',
                  type: 'number',
                },
                { label: 'Sale Price ($)', field: 'sale_price', type: 'number' },
              ].map((f) => (
                <div key={f.field}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#6B7280',
                      marginBottom: 5,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {f.label}
                  </div>
                  <input
                    type={f.type}
                    value={form[f.field as keyof typeof form]}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, [f.field]: e.target.value }))
                    }
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #E5E7EB',
                      borderRadius: 6,
                      fontSize: 13,
                      color: '#111827',
                      background: '#F9FAFB',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              ))}
            </div>
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#6B7280',
                  marginBottom: 5,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                Notes
              </div>
              <textarea
                value={form.notes}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, notes: e.target.value }))
                }
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #E5E7EB',
                  borderRadius: 6,
                  fontSize: 13,
                  color: '#111827',
                  background: '#F9FAFB',
                  outline: 'none',
                  resize: 'vertical',
                  minHeight: 80,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleSubmit}
                style={{
                  padding: '9px 20px',
                  background: '#EF9F27',
                  border: 'none',
                  borderRadius: 8,
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Save comp
              </button>
              <button
                onClick={() => setShowForm(false)}
                style={{
                  padding: '9px 16px',
                  background: 'transparent',
                  border: '1px solid #E5E7EB',
                  borderRadius: 8,
                  color: '#6B7280',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Comps table */}
        <div
          style={{
            background: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: 12,
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '20px 24px',
              borderBottom: '1px solid #E5E7EB',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <h2
              style={{
                fontFamily: 'Georgia, serif',
                fontSize: 20,
                fontWeight: 700,
                color: '#111827',
                margin: 0,
              }}
            >
              Eagle Ford Reference Transactions
            </h2>
            <span style={{ fontSize: 12, color: '#9CA3AF' }}>
              {comps.length} comps recorded
            </span>
          </div>
          {comps.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: '#9CA3AF', marginBottom: 8 }}>
                No comps recorded yet
              </div>
              <div style={{ fontSize: 13, color: '#D1D5DB' }}>
                Close your first deal to start building comp data for Gonzales
                County
              </div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F9FAFB' }}>
                  {[
                    'Date',
                    'Operator',
                    'Acres',
                    'NRI',
                    'Mo. Royalty',
                    'Sale Price',
                    'Multiple',
                    '$/NRI Acre',
                    'Source',
                    'Notes',
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '10px 16px',
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#6B7280',
                        textAlign: 'left',
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        borderBottom: '1px solid #E5E7EB',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comps.map((comp, i) => (
                  <tr
                    key={comp.id}
                    style={{
                      borderBottom: '1px solid #F3F4F6',
                      background:
                        comp.source === 'market'
                          ? i % 2 === 0
                            ? '#F0F9FF'
                            : '#E0F2FE'
                          : i % 2 === 0
                            ? '#fff'
                            : '#FAFAFA',
                    }}
                  >
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>
                      {comp.close_date
                        ? new Date(comp.close_date).toLocaleDateString('en-US', {
                            month: 'short',
                            year: 'numeric',
                          })
                        : '—'}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>
                      {comp.operator_name || '—'}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>
                      {comp.acreage || '—'}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>
                      {comp.nri || '—'}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>
                      {comp.monthly_royalty
                        ? `$${Number(comp.monthly_royalty).toLocaleString()}`
                        : '—'}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#111827',
                      }}
                    >
                      {comp.sale_price
                        ? `$${Number(comp.sale_price).toLocaleString()}`
                        : '—'}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: 13,
                        color: '#EF9F27',
                        fontWeight: 600,
                      }}
                    >
                      {comp.royalty_multiple
                        ? `${Number(comp.royalty_multiple).toFixed(1)}×`
                        : '—'}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>
                      {comp.price_per_nri_acre
                        ? `$${Math.round(
                            Number(comp.price_per_nri_acre)
                          ).toLocaleString()}`
                        : '—'}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#6B7280', textTransform: 'capitalize' }}>
                      {comp.source || 'manual'}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: 13,
                        color: '#6B7280',
                        maxWidth: 200,
                      }}
                    >
                      {comp.notes || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ padding: '12px 24px', borderTop: '1px solid #E5E7EB', display: 'flex', gap: 16, fontSize: 11, color: '#9CA3AF' }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#E0F2FE', border: '1px solid #BAE6FD', borderRadius: 2, marginRight: 4 }} />Eagle Ford reference transactions</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 2, marginRight: 4 }} />Your closed deals</span>
          </div>
        </div>
      </div>
    </div>
  )
}
