'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { CURRENT_AGREEMENT_VERSION } from '@/lib/agreement'

type OnboardData = {
  email?: string | null
  full_name?: string | null
  company?: string | null
  wants_admin?: boolean | null
  seat_count?: number | null
  agreement_signed?: boolean
  has_card?: boolean
  stripe_configured?: boolean
  onboarded?: boolean
}

export default function OnboardClient({ agreementHtml }: { agreementHtml: string }) {
  const endRef = useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = useState(false)
  const [data, setData] = useState<OnboardData | null>(null)
  const [fullName, setFullName] = useState('')
  const [company, setCompany] = useState('')
  const [wantsAdmin, setWantsAdmin] = useState(true)
  const [seatCount, setSeatCount] = useState(5)
  const [reachedEnd, setReachedEnd] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [cardLoading, setCardLoading] = useState(false)
  const [cardSaved, setCardSaved] = useState(false)

  const load = async () => {
    const res = await fetch('/api/onboard', { cache: 'no-store' })
    if (res.status === 401) {
      window.location.href = '/auth?next=/onboard'
      return
    }
    const json = (await res.json()) as { data?: OnboardData }
    const next = json.data ?? {}
    setData(next)
    if (next.full_name) setFullName(next.full_name)
    if (next.company) setCompany(next.company)
    if (next.wants_admin === false) setWantsAdmin(false)
    if (next.seat_count) setSeatCount(next.seat_count)
    setReady(true)
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('card') === 'saved') setCardSaved(true)
    void load()
  }, [])

  useEffect(() => {
    const node = endRef.current
    if (!node || data?.agreement_signed) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setReachedEnd(true)
      },
      { threshold: 0.4 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [data?.agreement_signed, ready])

  const saveWorkspace = async () => {
    setError(null)
    if (fullName.trim().length < 2) {
      setError('Enter your full legal name')
      return false
    }
    setSaving(true)
    try {
      const res = await fetch('/api/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          company: company.trim(),
          wants_admin: wantsAdmin,
          seat_count: wantsAdmin ? seatCount : 1,
        }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error || 'Could not save')
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setSaving(false)
    }
  }

  const signAgreement = async () => {
    setError(null)
    if (!reachedEnd || !accepted) {
      setError('Scroll to the end and check the box to accept.')
      return
    }
    setSaving(true)
    try {
      const saved = await saveWorkspace()
      if (!saved) return
      const { data: sessionData } = await supabase.auth.getSession()
      const email = sessionData.session?.user.email ?? data?.email ?? ''
      const res = await fetch('/api/legal/sign-agreement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signer_name: fullName.trim(),
          signer_email: email,
          typed_signature: fullName.trim(),
          agreement_version: CURRENT_AGREEMENT_VERSION,
          signer_entity: company.trim() || null,
          consent_checkboxes: {
            read: true,
            authority: true,
            bound: true,
            esign_consent: true,
            accepted: true,
          },
        }),
      })
      const payload = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !payload.ok) throw new Error(payload.error || 'Signing failed')
      await supabase.auth.refreshSession()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const addCard = async () => {
    setCardLoading(true)
    setError(null)
    try {
      const saved = await saveWorkspace()
      if (!saved) return
      const res = await fetch('/api/billing/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ return_path: '/onboard?card=saved' }),
      })
      const json = (await res.json()) as { error?: string; data?: { url?: string | null } }
      if (!res.ok || !json.data?.url) throw new Error(json.error || 'Could not start card setup')
      window.location.href = json.data.url
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCardLoading(false)
    }
  }

  const finish = async () => {
    setSaving(true)
    setError(null)
    try {
      const saved = await saveWorkspace()
      if (!saved) return
      const res = await fetch('/api/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          company: company.trim(),
          wants_admin: wantsAdmin,
          seat_count: wantsAdmin ? seatCount : 1,
          complete: true,
        }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error || 'Could not finish')
      window.location.href = '/'
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-500">
        Loading signup…
      </div>
    )
  }

  const agreementDone = Boolean(data?.agreement_signed)
  const cardDone = Boolean(data?.has_card || cardSaved)
  const stripeOn = data?.stripe_configured !== false
  const canFinish = agreementDone && (!stripeOn || cardDone)

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <header className="h-12 bg-gray-900 text-white flex items-center justify-between px-5">
        <span className="text-sm font-semibold">Finish signup</span>
        <span className="text-xs text-gray-400">{data?.email}</span>
      </header>

      <div className="max-w-3xl mx-auto px-5 py-8 space-y-5">
        <div>
          <h1 className="font-serif text-2xl font-bold text-gray-900">Set up your workspace</h1>
          <p className="text-sm text-gray-500 mt-1">
            Access is free. Skip-trace is $1 per phone hit, charged to your card at month end.
          </p>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <section className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            1. You and your team
          </h2>
          <label className="block text-xs font-medium text-gray-500 mb-1">Full legal name</label>
          <input
            className="w-full mb-3 px-3 py-2 text-sm border border-gray-200 rounded-lg"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
          />
          <label className="block text-xs font-medium text-gray-500 mb-1">Company</label>
          <input
            className="w-full mb-4 px-3 py-2 text-sm border border-gray-200 rounded-lg"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            autoComplete="organization"
          />
          <div className="space-y-2 text-sm text-gray-700">
            <label className="flex gap-2 items-start">
              <input
                type="radio"
                checked={wantsAdmin}
                onChange={() => setWantsAdmin(true)}
              />
              <span>
                <strong>I am the team admin.</strong> I will invite brokers from Account.
              </span>
            </label>
            <label className="flex gap-2 items-start">
              <input
                type="radio"
                checked={!wantsAdmin}
                onChange={() => setWantsAdmin(false)}
              />
              <span>
                <strong>Just me.</strong> Solo workspace — you can add seats later.
              </span>
            </label>
          </div>
          {wantsAdmin ? (
            <label className="block mt-4 text-sm text-gray-700">
              Seats (you + teammates)
              <input
                type="number"
                min={1}
                max={25}
                className="ml-2 w-20 px-2 py-1 border border-gray-200 rounded-lg"
                value={seatCount}
                onChange={(e) => setSeatCount(Number(e.target.value) || 1)}
              />
            </label>
          ) : null}
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
            2. Platform Services Agreement
          </h2>
          {agreementDone ? (
            <p className="text-sm text-emerald-700">Signed. Version {CURRENT_AGREEMENT_VERSION} is on file.</p>
          ) : (
            <>
              <div className="max-h-72 overflow-y-auto border border-gray-200 rounded-lg p-4 bg-[#faf9f6] text-sm">
                <article
                  className="ag-classic-body"
                  dangerouslySetInnerHTML={{ __html: agreementHtml }}
                />
                <div ref={endRef} className="h-4" />
              </div>
              {!reachedEnd ? (
                <p className="text-xs text-gray-500 mt-2">Scroll the agreement to the end to enable accept.</p>
              ) : null}
              <label className="flex gap-2 items-start mt-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={accepted}
                  disabled={!reachedEnd}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                <span>
                  I have read and agree to the Platform Services Agreement (version{' '}
                  {CURRENT_AGREEMENT_VERSION}) and consent to electronic acceptance.
                </span>
              </label>
              <button
                type="button"
                disabled={saving || !reachedEnd || !accepted}
                onClick={() => {
                  void signAgreement()
                }}
                className="mt-3 px-4 py-2 text-sm font-semibold bg-gray-900 text-white rounded-lg disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Accept agreement'}
              </button>
            </>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
            3. Card on file
          </h2>
          <p className="text-sm text-gray-600 mb-3">
            We charge this card at month end for skip-trace phone hits ($1 each). Cache hits,
            misses, and email-only are free. Team members share this card.
          </p>
          {cardDone ? (
            <p className="text-sm text-emerald-700">Card saved.</p>
          ) : stripeOn ? (
            <button
              type="button"
              disabled={cardLoading}
              onClick={() => {
                void addCard()
              }}
              className="px-4 py-2 text-sm font-semibold bg-amber-500 text-white rounded-lg disabled:opacity-50"
            >
              {cardLoading ? 'Opening Stripe…' : 'Add card'}
            </button>
          ) : (
            <p className="text-sm text-gray-500">Billing is not configured in this environment — continue.</p>
          )}
        </section>

        <div className="flex items-center justify-between gap-3">
          <Link href="/account" className="text-sm text-gray-500">
            Open Account instead
          </Link>
          <button
            type="button"
            disabled={saving || !canFinish}
            onClick={() => {
              void finish()
            }}
            className="px-4 py-2 text-sm font-semibold bg-amber-500 text-white rounded-lg disabled:opacity-50"
          >
            {saving ? 'Finishing…' : 'Open Mineral Map →'}
          </button>
        </div>
        {!canFinish ? (
          <p className="text-xs text-gray-400">
            Accept the agreement{stripeOn ? ' and add a card' : ''} to open the map.
          </p>
        ) : null}
      </div>
    </div>
  )
}
