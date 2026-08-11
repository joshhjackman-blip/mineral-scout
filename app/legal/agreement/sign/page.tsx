'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { CURRENT_AGREEMENT_VERSION } from '@/lib/agreement'

import '../../../landing/landing.css'
import '../agreement.css'

type CheckKey = 'read' | 'authority' | 'bound' | 'esign_consent'

type SuccessState = {
  id: number
  signer_name: string
  signer_email: string
  signed_at: string
  agreement_version: string
}

export default function SignAgreementPage() {
  const router = useRouter()
  const [authReady, setAuthReady] = useState(false)
  const [signerName, setSignerName] = useState('')
  const [signerEmail, setSignerEmail] = useState('')
  const [signerEntity, setSignerEntity] = useState('')
  const [signerTitle, setSignerTitle] = useState('')
  const [typedSignature, setTypedSignature] = useState('')
  const [checks, setChecks] = useState<Record<CheckKey, boolean>>({
    read: false,
    authority: false,
    bound: false,
    esign_consent: false,
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<SuccessState | null>(null)

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      const session = data.session
      if (!session?.user) {
        window.location.href = '/auth'
        return
      }

      const email = session.user.email ?? ''
      setSignerEmail(email)
      const metaName = String(session.user.user_metadata?.full_name ?? '').trim()
      if (metaName) setSignerName((prev) => prev || metaName)

      // If they already signed (DB or metadata), stamp + refresh JWT, then enter app.
      try {
        const statusRes = await fetch('/api/legal/agreement-status', { cache: 'no-store' })
        const status = (await statusRes.json()) as {
          signed?: boolean
          refreshed_metadata?: boolean
        }
        if (status.signed) {
          await supabase.auth.refreshSession()
          if (!cancelled) router.replace('/')
          return
        }
      } catch {
        // fall through to form
      }

      if (!cancelled) setAuthReady(true)
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [router])

  const allChecked = Object.values(checks).every(Boolean)
  const signatureMatches =
    typedSignature.trim().toLowerCase() === signerName.trim().toLowerCase() &&
    typedSignature.trim().length > 0
  const canSubmit =
    !submitting &&
    signerName.trim().length >= 2 &&
    /.+@.+\..+/.test(signerEmail.trim()) &&
    allChecked &&
    signatureMatches

  const submit = async () => {
    setError(null)
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const response = await fetch('/api/legal/sign-agreement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signer_name: signerName.trim(),
          signer_email: signerEmail.trim().toLowerCase(),
          signer_entity: signerEntity.trim() || null,
          signer_title: signerTitle.trim() || null,
          typed_signature: typedSignature.trim(),
          agreement_version: CURRENT_AGREEMENT_VERSION,
          consent_checkboxes: checks,
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
      // Refresh JWT so middleware sees agreement_version immediately.
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
      <div className="lp-root lp-legal-root">
        <main className="lp-sign-container">
          <p className="lp-legal-sub">Checking your account…</p>
        </main>
      </div>
    )
  }

  return (
    <div className="lp-root lp-legal-root">
      <nav className="lp-nav scrolled lp-legal-nav">
        <a href="/landing" className="lp-nav-logo">
          <img src="/mineral-map-logo-light.svg" alt="Mineral Map" />
        </a>
        <div className="lp-nav-links">
          <Link href="/legal/agreement">Read the agreement</Link>
          <Link href="/account" className="lp-nav-cta">
            Account
          </Link>
        </div>
      </nav>

      <main className="lp-sign-container">
        {success ? (
          <SignedSuccess success={success} />
        ) : (
          <>
            <div className="lp-legal-header">
              <span className="lp-section-label">Sign the agreement</span>
              <h1 className="lp-legal-h1">Confirm & sign</h1>
              <p className="lp-legal-sub">
                You must sign the{' '}
                <Link href="/legal/agreement">
                  <span className="lp-legal-inline-link">
                    Platform Services Agreement
                  </span>
                </Link>{' '}
                (version {CURRENT_AGREEMENT_VERSION}) before using the map and
                CRM.
              </p>
            </div>

            <div className="lp-sign-card">
              {error && <div className="lp-sign-error">{error}</div>}

              <div className="lp-sign-field">
                <label htmlFor="signer_name">Full legal name</label>
                <input
                  id="signer_name"
                  type="text"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="Jane A. Broker"
                  autoComplete="name"
                />
              </div>

              <div className="lp-sign-field">
                <label htmlFor="signer_email">Email</label>
                <input
                  id="signer_email"
                  type="email"
                  value={signerEmail}
                  readOnly
                  autoComplete="email"
                />
              </div>

              <div className="lp-sign-field">
                <label htmlFor="signer_entity">
                  Company / entity{' '}
                  <span
                    style={{
                      color: 'var(--lp-text-muted)',
                      textTransform: 'none',
                      letterSpacing: 0,
                    }}
                  >
                    (leave blank if signing as an individual)
                  </span>
                </label>
                <input
                  id="signer_entity"
                  type="text"
                  value={signerEntity}
                  onChange={(e) => setSignerEntity(e.target.value)}
                  placeholder="Acme Minerals LLC"
                  autoComplete="organization"
                />
              </div>

              <div className="lp-sign-field">
                <label htmlFor="signer_title">Title / role</label>
                <input
                  id="signer_title"
                  type="text"
                  value={signerTitle}
                  onChange={(e) => setSignerTitle(e.target.value)}
                  placeholder="Managing Partner"
                  autoComplete="organization-title"
                />
              </div>

              <div className="lp-sign-checks">
                <label className="lp-sign-check">
                  <input
                    type="checkbox"
                    checked={checks.read}
                    onChange={(e) =>
                      setChecks((prev) => ({ ...prev, read: e.target.checked }))
                    }
                  />
                  <span>
                    I have <strong>read and understood</strong> the{' '}
                    <Link href="/legal/agreement">
                      <span className="lp-legal-inline-link">
                        Platform Services Agreement
                      </span>
                    </Link>{' '}
                    (version {CURRENT_AGREEMENT_VERSION}) in full.
                  </span>
                </label>
                <label className="lp-sign-check">
                  <input
                    type="checkbox"
                    checked={checks.authority}
                    onChange={(e) =>
                      setChecks((prev) => ({
                        ...prev,
                        authority: e.target.checked,
                      }))
                    }
                  />
                  <span>
                    I have <strong>authority to bind</strong> myself and, if
                    applicable, my organization.
                  </span>
                </label>
                <label className="lp-sign-check">
                  <input
                    type="checkbox"
                    checked={checks.bound}
                    onChange={(e) =>
                      setChecks((prev) => ({ ...prev, bound: e.target.checked }))
                    }
                  />
                  <span>
                    I agree to be <strong>legally bound</strong> by the Agreement,
                    including fees and attribution terms.
                  </span>
                </label>
                <label className="lp-sign-check">
                  <input
                    type="checkbox"
                    checked={checks.esign_consent}
                    onChange={(e) =>
                      setChecks((prev) => ({
                        ...prev,
                        esign_consent: e.target.checked,
                      }))
                    }
                  />
                  <span>
                    I consent to <strong>electronic signature</strong> and
                    electronic records under applicable e-sign law.
                  </span>
                </label>
              </div>

              <div className="lp-sign-field">
                <label htmlFor="typed_signature">
                  Type your full legal name to sign
                </label>
                <input
                  id="typed_signature"
                  type="text"
                  value={typedSignature}
                  onChange={(e) => setTypedSignature(e.target.value)}
                  placeholder={signerName || 'Type your name exactly as above'}
                  autoComplete="off"
                />
              </div>

              <div className="lp-sign-actions">
                <button
                  type="button"
                  className="lp-btn-primary lp-btn-large"
                  disabled={!canSubmit}
                  onClick={() => {
                    void submit()
                  }}
                >
                  {submitting ? 'Signing…' : 'Sign agreement'}
                </button>
                <Link href="/legal/agreement" className="lp-btn-secondary">
                  Read the agreement first
                </Link>
              </div>
            </div>
          </>
        )}
      </main>

      <footer className="lp-footer">
        <div>
          <img
            src="/mineral-map-logo-light.svg"
            alt="Mineral Map"
            className="lp-footer-logo"
          />
          <div className="lp-footer-copy">© 2026 Mineral Map</div>
        </div>
        <div className="lp-footer-links">
          <Link href="/legal/agreement">Agreement</Link>
          <Link href="/account">Account</Link>
          <a href="mailto:josh@brentwoodenterprisesllc.com">Contact</a>
        </div>
      </footer>
    </div>
  )
}

function SignedSuccess({ success }: { success: SuccessState }) {
  return (
    <div className="lp-sign-success">
      <h2>
        Signed. <em>Welcome.</em>
      </h2>
      <p>
        Your signature is on file. You can continue to the platform — map and CRM
        access is unlocked for this agreement version.
      </p>
      <dl>
        <dt>Signer</dt>
        <dd>{success.signer_name}</dd>
        <dt>Email</dt>
        <dd>{success.signer_email}</dd>
        <dt>Agreement</dt>
        <dd>v{success.agreement_version}</dd>
        <dt>Signed at</dt>
        <dd>{new Date(success.signed_at).toLocaleString()}</dd>
        <dt>Record ID</dt>
        <dd>#{success.id}</dd>
      </dl>
      <div className="lp-sign-actions" style={{ justifyContent: 'center' }}>
        <Link href="/" className="lp-btn-primary lp-btn-large">
          Continue to the platform →
        </Link>
      </div>
    </div>
  )
}
