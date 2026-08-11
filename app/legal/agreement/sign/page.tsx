'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

import '../../../landing/landing.css'
import '../agreement.css'

// Must match the Version: field in legal/PLATFORM-SERVICES-AGREEMENT.md.
// When the agreement text is materially updated, bump this string and
// (optionally) prompt existing signers to re-sign.
const AGREEMENT_VERSION = '2026-08-11'

type CheckKey = 'read' | 'authority' | 'bound' | 'esign_consent'

type SuccessState = {
  id: number
  signer_name: string
  signer_email: string
  signed_at: string
  agreement_version: string
}

export default function SignAgreementPage() {
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

  // Prefill signer_email if the visitor is already authed on this device.
  useEffect(() => {
    let cancelled = false
    const prefill = async () => {
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      const email = data.session?.user?.email
      if (email) setSignerEmail((prev) => prev || email)
    }
    void prefill()
    return () => {
      cancelled = true
    }
  }, [])

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
          agreement_version: AGREEMENT_VERSION,
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
      setSuccess(payload.signature)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="lp-root lp-legal-root">
      <nav className="lp-nav scrolled lp-legal-nav">
        <a href="/landing" className="lp-nav-logo">
          <img src="/mineral-map-logo-light.svg" alt="Mineral Map" />
        </a>
        <div className="lp-nav-links">
          <Link href="/legal/agreement">Read the agreement</Link>
          <a href="https://getmineralmap.com/auth" className="lp-nav-cta">
            Sign in
          </a>
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
                Signing binds you (and, if applicable, your organization) to the{' '}
                <Link href="/legal/agreement">
                  <span className="lp-legal-inline-link">
                    Platform Services Agreement
                  </span>
                </Link>
                , including the 10% success fee and 24-month attribution tail.
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
                  onChange={(e) => setSignerEmail(e.target.value)}
                  placeholder="jane@yourcompany.com"
                  autoComplete="email"
                />
              </div>

              <div className="lp-sign-field">
                <label htmlFor="signer_entity">
                  Company / entity <span style={{ color: 'var(--lp-text-muted)', textTransform: 'none', letterSpacing: 0 }}>(leave blank if signing as an individual)</span>
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
                    onChange={(e) => setChecks((prev) => ({ ...prev, read: e.target.checked }))}
                  />
                  <span>
                    I have <strong>read and understood</strong> the{' '}
                    <Link href="/legal/agreement">
                      <span className="lp-legal-inline-link">
                        Platform Services Agreement
                      </span>
                    </Link>{' '}
                    (version {AGREEMENT_VERSION}) in full.
                  </span>
                </label>

                <label className="lp-sign-check">
                  <input
                    type="checkbox"
                    checked={checks.authority}
                    onChange={(e) => setChecks((prev) => ({ ...prev, authority: e.target.checked }))}
                  />
                  <span>
                    I have <strong>authority to bind</strong> myself and, if I named
                    a company above, that entity to this Agreement.
                  </span>
                </label>

                <label className="lp-sign-check">
                  <input
                    type="checkbox"
                    checked={checks.bound}
                    onChange={(e) => setChecks((prev) => ({ ...prev, bound: e.target.checked }))}
                  />
                  <span>
                    I agree to be <strong>bound by every term</strong> of the
                    Agreement, including the 10% success fee, the 24-month
                    attribution tail, and the non-circumvention covenants in
                    Section 7.
                  </span>
                </label>

                <label className="lp-sign-check">
                  <input
                    type="checkbox"
                    checked={checks.esign_consent}
                    onChange={(e) => setChecks((prev) => ({ ...prev, esign_consent: e.target.checked }))}
                  />
                  <span>
                    I consent to <strong>electronic signature</strong> and to
                    Mineral Map recording my name, email, IP address, user
                    agent, and timestamp as the signature record (Section 15).
                  </span>
                </label>
              </div>

              <div className="lp-sign-field" style={{ marginTop: 32 }}>
                <label htmlFor="typed_signature">
                  Type your full legal name to sign
                </label>
                <input
                  id="typed_signature"
                  type="text"
                  className="lp-sign-signature"
                  value={typedSignature}
                  onChange={(e) => setTypedSignature(e.target.value)}
                  placeholder="Jane A. Broker"
                />
                {typedSignature.length > 0 && !signatureMatches && (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--lp-text-muted)',
                      marginTop: 6,
                    }}
                  >
                    Signature must match &ldquo;Full legal name&rdquo; above.
                  </div>
                )}
              </div>

              <div className="lp-sign-actions">
                <button
                  onClick={submit}
                  disabled={!canSubmit}
                  className="lp-btn-primary lp-btn-large"
                >
                  {submitting ? 'Signing…' : 'Sign & agree →'}
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
          <img src="/mineral-map-logo-light.svg" alt="Mineral Map" className="lp-footer-logo" />
          <div className="lp-footer-copy">© 2026 Mineral Map</div>
        </div>
        <div className="lp-footer-links">
          <Link href="/legal/agreement">Agreement</Link>
          <a href="https://getmineralmap.com/auth">Sign in</a>
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
        Your signature is on file. A record of this signing, including timestamp,
        IP, and user agent, is stored in the Mineral Map audit table for the
        life of the Agreement.
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
        <a href="https://getmineralmap.com/auth" className="lp-btn-primary lp-btn-large">
          Continue to the platform →
        </a>
      </div>
    </div>
  )
}
