'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { CURRENT_AGREEMENT_VERSION } from '@/lib/agreement'

type SuccessState = {
  id: number
  signer_name: string
  signer_email: string
  signed_at: string
  agreement_version: string
}

export default function AgreementSignClient({
  agreementHtml,
}: {
  agreementHtml: string
}) {
  const router = useRouter()
  const endRef = useRef<HTMLDivElement | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [email, setEmail] = useState('')
  const [signerName, setSignerName] = useState('')
  const [reachedEnd, setReachedEnd] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<SuccessState | null>(null)
  const [fromCheckout, setFromCheckout] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setFromCheckout(params.get('from') === 'checkout')
  }, [])

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      const session = data.session
      if (!session?.user) {
        const next = encodeURIComponent('/legal/agreement/sign')
        window.location.href = `/auth?next=${next}`
        return
      }

      setEmail(session.user.email ?? '')
      const metaName = String(
        session.user.user_metadata?.full_name ??
          session.user.user_metadata?.name ??
          '',
      ).trim()
      if (metaName) setSignerName(metaName)
      else {
        const local = (session.user.email ?? '').split('@')[0] ?? ''
        setSignerName(local.replace(/[._-]+/g, ' ').trim())
      }

      try {
        const statusRes = await fetch('/api/legal/agreement-status', {
          cache: 'no-store',
        })
        const status = (await statusRes.json()) as { signed?: boolean }
        if (status.signed) {
          await supabase.auth.refreshSession()
          if (!cancelled) router.replace('/')
          return
        }
      } catch {
        // show document
      }

      if (!cancelled) setAuthReady(true)
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [router])

  useEffect(() => {
    const node = endRef.current
    if (!node || !authReady) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setReachedEnd(true)
      },
      { root: null, threshold: 0.4 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [authReady])

  const canSubmit =
    !submitting &&
    reachedEnd &&
    accepted &&
    signerName.trim().length >= 2 &&
    Boolean(email)

  const submit = async () => {
    setError(null)
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const name = signerName.trim()
      const response = await fetch('/api/legal/sign-agreement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signer_name: name,
          signer_email: email.trim().toLowerCase(),
          typed_signature: name,
          agreement_version: CURRENT_AGREEMENT_VERSION,
          consent_checkboxes: {
            read: true,
            authority: true,
            bound: true,
            esign_consent: true,
            accepted: true,
          },
        }),
      })
      const payload = (await response.json()) as {
        ok?: boolean
        signature?: SuccessState
        error?: string
      }
      if (!response.ok || !payload.ok || !payload.signature) {
        throw new Error(payload.error || `Signing failed (${response.status})`)
      }
      await supabase.auth.refreshSession()
      setSuccess(payload.signature)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (!authReady && !success) {
    return (
      <div className="ag-classic-root">
        <div className="ag-classic-loading">Loading agreement…</div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="ag-classic-root">
        <div className="ag-classic-success">
          <h1>Agreement accepted</h1>
          <p>
            Thanks, {success.signer_name}. Your acceptance of version{' '}
            {success.agreement_version} is on file
            {fromCheckout ? ' and your subscription is active' : ''}.
          </p>
          <Link href="/" className="ag-classic-btn">
            Continue to Mineral Map →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="ag-classic-root">
      <header className="ag-classic-topbar">
        <Link href="/landing" className="ag-classic-brand">
          Mineral Map
        </Link>
        <div className="ag-classic-topbar-meta">
          {fromCheckout ? <span className="ag-classic-pill">Payment received</span> : null}
          <span className="ag-classic-account">Signed in as {email}</span>
        </div>
      </header>

      {fromCheckout ? (
        <div className="ag-classic-banner">
          Payment complete. Please review and accept the Platform Services
          Agreement to open the map.
        </div>
      ) : null}

      <main className="ag-classic-sheet-wrap">
        <article className="ag-classic-sheet">
          <div
            className="ag-classic-body"
            dangerouslySetInnerHTML={{ __html: agreementHtml }}
          />
          <div ref={endRef} className="ag-classic-end-sentinel" aria-hidden />
        </article>
      </main>

      <footer className="ag-classic-accept">
        <div className="ag-classic-accept-inner">
          {!reachedEnd ? (
            <p className="ag-classic-hint">
              Scroll to the end of the agreement to enable acceptance.
            </p>
          ) : null}

          <label className="ag-classic-name">
            <span>Full legal name</span>
            <input
              type="text"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              autoComplete="name"
              placeholder="Your full legal name"
            />
          </label>

          <label className="ag-classic-check">
            <input
              type="checkbox"
              checked={accepted}
              disabled={!reachedEnd}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>
              I have read and agree to the Platform Services Agreement (version{' '}
              {CURRENT_AGREEMENT_VERSION}), and I consent to electronic
              acceptance.
            </span>
          </label>

          {error ? <div className="ag-classic-error">{error}</div> : null}

          <button
            type="button"
            className="ag-classic-btn"
            disabled={!canSubmit}
            onClick={() => {
              void submit()
            }}
          >
            {submitting ? 'Saving…' : 'Accept & continue'}
          </button>
        </div>
      </footer>
    </div>
  )
}
