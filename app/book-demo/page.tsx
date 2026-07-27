'use client'

import Link from 'next/link'
import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Barlow_Condensed } from 'next/font/google'
import AppLogo from '@/app/components/AppLogo'
import '../landing/coming-soon.css'
import './book-demo.css'

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
  phone: string
  preferredTime: string
  notes: string
  website: string
}

const emptyForm: FormState = {
  name: '',
  email: '',
  company: '',
  phone: '',
  preferredTime: '',
  notes: '',
  website: '',
}

export default function BookDemoPage() {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const onChange =
    (key: keyof FormState) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((prev) => ({ ...prev, [key]: e.target.value }))
    }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setStatus(null)
    try {
      const res = await fetch('/api/demo-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
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
        text: 'Request sent. We’ll follow up shortly at your email.',
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
          <a className="bd-contact" href={`mailto:${CONTACT_EMAIL}`} style={{ marginTop: 0 }}>
            {CONTACT_EMAIL}
          </a>
          <Link href="/auth" className="cs-login">
            Log in
          </Link>
        </div>
      </nav>

      <main className="bd-stage">
        <div className="bd-copy">
          <h1 className="bd-headline">
            Book a <span className="cs-map">demo</span>
          </h1>
          <p className="bd-subhead">
            See how Mineral Map helps you find, track, and close Permian mineral deals.
          </p>
          <p className="bd-contact">
            Questions?{' '}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </div>

        <div className="bd-panel">
          <h2>Request a walkthrough</h2>
          <p className="bd-panel-lead">
            Tell us a bit about your team — we’ll reply to schedule a live demo.
          </p>

          <form className="bd-form" onSubmit={onSubmit} noValidate>
            <div className="bd-row">
              <div className="bd-field">
                <label htmlFor="bd-name">Name *</label>
                <input
                  id="bd-name"
                  name="name"
                  autoComplete="name"
                  required
                  value={form.name}
                  onChange={onChange('name')}
                  placeholder="Jane Broker"
                />
              </div>
              <div className="bd-field">
                <label htmlFor="bd-email">Work email *</label>
                <input
                  id="bd-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={form.email}
                  onChange={onChange('email')}
                  placeholder="jane@firm.com"
                />
              </div>
            </div>

            <div className="bd-row">
              <div className="bd-field">
                <label htmlFor="bd-company">Company</label>
                <input
                  id="bd-company"
                  name="company"
                  autoComplete="organization"
                  value={form.company}
                  onChange={onChange('company')}
                  placeholder="Acquisition shop"
                />
              </div>
              <div className="bd-field">
                <label htmlFor="bd-phone">Phone</label>
                <input
                  id="bd-phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={onChange('phone')}
                  placeholder="(432) 555-0100"
                />
              </div>
            </div>

            <div className="bd-field">
              <label htmlFor="bd-time">Preferred time</label>
              <select
                id="bd-time"
                name="preferredTime"
                value={form.preferredTime}
                onChange={onChange('preferredTime')}
              >
                <option value="">Flexible</option>
                <option value="Mornings (CT)">Mornings (CT)</option>
                <option value="Afternoons (CT)">Afternoons (CT)</option>
                <option value="This week">This week</option>
                <option value="Next week">Next week</option>
              </select>
            </div>

            <div className="bd-field">
              <label htmlFor="bd-notes">What are you looking for?</label>
              <textarea
                id="bd-notes"
                name="notes"
                value={form.notes}
                onChange={onChange('notes')}
                placeholder="Counties, team size, how you prospect today…"
              />
            </div>

            {/* Honeypot */}
            <div className="bd-hp" aria-hidden="true">
              <label htmlFor="bd-website">Website</label>
              <input
                id="bd-website"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={form.website}
                onChange={onChange('website')}
              />
            </div>

            <button className="bd-submit" type="submit" disabled={submitting}>
              {submitting ? 'Sending…' : 'Request demo'}
            </button>

            {status && (
              <p className={`bd-status ${status.kind === 'ok' ? 'ok' : 'err'}`}>{status.text}</p>
            )}
          </form>

          <p className="bd-panel-foot">
            Prefer email? Reach us at{' '}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </div>
      </main>
    </div>
  )
}
