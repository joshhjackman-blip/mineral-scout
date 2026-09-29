'use client'

import Link from 'next/link'
import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Barlow_Condensed } from 'next/font/google'
import AppLogo from '@/app/components/AppLogo'
import '../landing/coming-soon.css'
import '../book-demo/book-demo.css'

const display = Barlow_Condensed({
  weight: ['700', '800'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-barlow-condensed',
})

const CONTACT_EMAIL = 'management@mineralmapllc.com'

type FormState = {
  name: string
  email: string
  company: string
  website: string
}

const emptyForm: FormState = {
  name: '',
  email: '',
  company: '',
  website: '',
}

export default function GetStartedPage() {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const onChange =
    (key: keyof FormState) =>
    (e: ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [key]: e.target.value }))
    }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setStatus(null)
    try {
      const res = await fetch('/api/signup-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = (await res.json()) as {
        success?: boolean
        error?: string
        data?: { message?: string }
      }
      if (!json?.success) {
        setStatus({
          kind: 'err',
          text: json?.error || `Could not send — email ${CONTACT_EMAIL}`,
        })
        return
      }
      setForm(emptyForm)
      setStatus({
        kind: 'ok',
        text:
          json.data?.message ||
          'Request sent. We will email you a signup link if Mineral Map approves access.',
      })
    } catch {
      setStatus({
        kind: 'err',
        text: `Network error — email ${CONTACT_EMAIL} directly.`,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={`cs-root ${display.variable}`}>
      <nav className="cs-nav" aria-label="Primary">
        <Link href="/landing" className="cs-logo" aria-label="Mineral Map">
          <AppLogo width={168} />
        </Link>
        <div className="bd-nav-links">
          <Link href="/book-demo" className="cs-nav-demo">
            Book a demo
          </Link>
          <Link href="/auth" className="cs-login">
            Log in
          </Link>
        </div>
      </nav>

      <main className="bd-stage">
        <div className="bd-copy">
          <h1 className="bd-headline">
            Get <span className="cs-map">started</span>
          </h1>
          <p className="bd-subhead">
            Tell us your name and work email. Mineral Map reviews each request, then emails you a
            link to finish signup.
          </p>
          <p className="bd-contact">
            Already approved? <Link href="/auth">Log in</Link>
          </p>
        </div>

        <div className="bd-panel">
          <h2>Request access</h2>
          <p className="bd-panel-lead">
            Access is free. After we approve you, you will set a password, sign the agreement, add
            a card for skip-trace ($1 per phone hit, billed at month end), and say if you are the
            team admin.
          </p>

          <form className="bd-form" onSubmit={onSubmit} noValidate>
            <div className="bd-field">
              <label htmlFor="gs-name">Full name *</label>
              <input
                id="gs-name"
                name="name"
                autoComplete="name"
                required
                value={form.name}
                onChange={onChange('name')}
                placeholder="Jane Broker"
              />
            </div>
            <div className="bd-field">
              <label htmlFor="gs-email">Work email *</label>
              <input
                id="gs-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={form.email}
                onChange={onChange('email')}
                placeholder="jane@firm.com"
              />
            </div>
            <div className="bd-field">
              <label htmlFor="gs-company">Company</label>
              <input
                id="gs-company"
                name="company"
                autoComplete="organization"
                value={form.company}
                onChange={onChange('company')}
                placeholder="Optional"
              />
            </div>
            <div className="bd-hp" aria-hidden="true">
              <label htmlFor="gs-website">Website</label>
              <input
                id="gs-website"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={form.website}
                onChange={onChange('website')}
              />
            </div>
            <button className="bd-submit" type="submit" disabled={submitting}>
              {submitting ? 'Sending…' : 'Request access'}
            </button>
            {status && (
              <p className={`bd-status ${status.kind === 'ok' ? 'ok' : 'err'}`}>{status.text}</p>
            )}
          </form>

          <p className="bd-panel-foot">
            Teammate already on Mineral Map? Ask them to invite you from Account — do not request a
            second workspace. Questions:{' '}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </div>
      </main>
    </div>
  )
}
