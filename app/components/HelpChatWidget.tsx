'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { LifeBuoy, MessageCircle, X } from 'lucide-react'

const CATEGORIES = [
  { value: 'billing', label: 'Billing / success fee' },
  { value: 'technical', label: 'Technical issue' },
  { value: 'account', label: 'Account / seats' },
  { value: 'data_map', label: 'Data / map' },
  { value: 'other', label: 'Other' },
] as const

const HIDDEN_PREFIXES = ['/landing', '/auth', '/pricing', '/demo', '/book-demo', '/legal']

/**
 * Classic corner help-desk chat widget.
 * Submits tickets to management@ via /api/help-ticket.
 */
export default function HelpChatWidget() {
  const pathname = usePathname() || '/'
  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      ),
    [],
  )

  const [signedIn, setSignedIn] = useState(false)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState('technical')
  const [message, setMessage] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ticketId, setTicketId] = useState<string | null>(null)

  const hidden = HIDDEN_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )

  useEffect(() => {
    if (hidden) return
    void supabase.auth.getSession().then(({ data: { session } }) => {
      setSignedIn(Boolean(session?.user))
      if (session?.user?.email) setEmail(session.user.email)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session?.user))
      if (session?.user?.email) setEmail(session.user.email)
    })
    return () => {
      sub.subscription.unsubscribe()
    }
  }, [hidden, supabase])

  if (hidden || !signedIn) return null

  const onMap = pathname === '/'
  const bottomOffset = onMap ? 64 : 24

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/help-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          category,
          message,
          website: honeypot,
        }),
      })
      const data = (await res.json()) as {
        success?: boolean
        error?: string | null
        data?: { ticketId?: string } | null
      }
      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to submit ticket')
        return
      }
      setTicketId(data.data?.ticketId ?? 'submitted')
      setSubject('')
      setMessage('')
    } catch {
      setError('Failed to submit ticket. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        right: 20,
        bottom: bottomOffset,
        zIndex: 10050,
        fontFamily: 'Geist, Inter, system-ui, sans-serif',
      }}
    >
      {open && (
        <div
          style={{
            width: 'min(360px, calc(100vw - 32px))',
            marginBottom: 12,
            background: 'var(--mm-chrome-panel)',
            border: '1px solid var(--mm-chrome-border)',
            borderRadius: 16,
            boxShadow: '0 18px 50px rgba(15, 23, 42, 0.35)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 'min(520px, calc(100vh - 120px))',
            color: 'var(--mm-chrome-fg)',
          }}
        >
          <div
            style={{
              background: '#111827',
              color: '#fff',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: '#EF9F27',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <LifeBuoy size={16} color="#fff" />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Help desk</div>
                <div style={{ fontSize: 11, color: 'var(--mm-chrome-muted)' }}>
                  We reply to {email || 'your email'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close help"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--mm-chrome-muted)',
                cursor: 'pointer',
                padding: 4,
              }}
            >
              <X size={16} />
            </button>
          </div>

          <div style={{ padding: 14, overflowY: 'auto' }}>
            {ticketId ? (
              <div>
                <div
                  style={{
                    background: '#ECFDF5',
                    border: '1px solid #A7F3D0',
                    borderRadius: 12,
                    padding: '12px 14px',
                    fontSize: 13,
                    color: '#065F46',
                    lineHeight: 1.5,
                    marginBottom: 12,
                  }}
                >
                  Ticket sent — reference <strong>{ticketId}</strong>. Check
                  your inbox for our reply.
                </div>
                <button
                  type="button"
                  onClick={() => setTicketId(null)}
                  style={{
                    width: '100%',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#92400E',
                    background: '#FFFBEB',
                    border: '1px solid #FBBF24',
                    borderRadius: 10,
                    padding: '10px 12px',
                    cursor: 'pointer',
                  }}
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  void handleSubmit(e)
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
              >
                <p style={{ margin: 0, fontSize: 12, color: 'var(--mm-chrome-muted)', lineHeight: 1.45 }}>
                  Tell us what’s going on — tickets go to management@mineralmapllc.com.
                </p>

                <label style={{ display: 'block' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--mm-chrome-muted)', letterSpacing: '0.06em' }}>
                    CATEGORY
                  </span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    style={{
                      marginTop: 4,
                      width: '100%',
                      fontSize: 13,
                      border: '1px solid var(--mm-chrome-border)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      background: 'var(--mm-chrome-bg)',
                      color: 'var(--mm-chrome-fg)',
                    }}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: 'block' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--mm-chrome-muted)', letterSpacing: '0.06em' }}>
                    SUBJECT
                  </span>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    required
                    maxLength={160}
                    placeholder="Short summary"
                    style={{
                      marginTop: 4,
                      width: '100%',
                      fontSize: 13,
                      border: '1px solid var(--mm-chrome-border)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      boxSizing: 'border-box',
                      background: 'var(--mm-chrome-bg)',
                      color: 'var(--mm-chrome-fg)',
                    }}
                  />
                </label>

                <label style={{ display: 'block' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--mm-chrome-muted)', letterSpacing: '0.06em' }}>
                    MESSAGE
                  </span>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    required
                    rows={4}
                    maxLength={5000}
                    placeholder="What happened? Include county/owner if relevant."
                    style={{
                      marginTop: 4,
                      width: '100%',
                      fontSize: 13,
                      border: '1px solid var(--mm-chrome-border)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      resize: 'vertical',
                      boxSizing: 'border-box',
                      minHeight: 96,
                      background: 'var(--mm-chrome-bg)',
                      color: 'var(--mm-chrome-fg)',
                    }}
                  />
                </label>

                <input
                  type="text"
                  name="website"
                  value={honeypot}
                  onChange={(e) => setHoneypot(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  style={{ display: 'none' }}
                />

                {error && (
                  <div
                    style={{
                      fontSize: 12,
                      color: '#B91C1C',
                      background: '#FEF2F2',
                      border: '1px solid #FECACA',
                      borderRadius: 8,
                      padding: '8px 10px',
                    }}
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !subject.trim() || !message.trim()}
                  style={{
                    width: '100%',
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#fff',
                    background:
                      submitting || !subject.trim() || !message.trim()
                        ? '#D1D5DB'
                        : '#EF9F27',
                    border: 'none',
                    borderRadius: 10,
                    padding: '11px 12px',
                    cursor:
                      submitting || !subject.trim() || !message.trim()
                        ? 'default'
                        : 'pointer',
                  }}
                >
                  {submitting ? 'Sending…' : 'Send ticket'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close help desk' : 'Open help desk'}
        aria-expanded={open}
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          border: 'none',
          background: open ? '#111827' : '#EF9F27',
          color: '#fff',
          boxShadow: '0 10px 28px rgba(15, 23, 42, 0.28)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: 'auto',
        }}
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>
    </div>
  )
}
