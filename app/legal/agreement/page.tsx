import fs from 'fs'
import path from 'path'
import Link from 'next/link'
import type { Metadata } from 'next'

import '../../landing/landing.css'
import './agreement.css'

export const metadata: Metadata = {
  title: 'Platform Services Agreement · Mineral Map',
  description:
    'The Platform Services Agreement every Mineral Map customer signs before accessing the platform. 10% success fee on Platform Leads closed during a 24-month attribution tail. No monthly, per-seat, or per-lookup charges.',
}

// The signed agreement is drafted in markdown at legal/PLATFORM-SERVICES-AGREEMENT.md
// so it can be version-controlled and diff-reviewed. The page pulls it at
// build time and renders a lightweight HTML view of the markdown. No
// runtime markdown parser dependency needed, just the handful of block
// types the doc actually uses.
export default function AgreementPage() {
  const markdown = fs.readFileSync(
    path.join(process.cwd(), 'legal', 'PLATFORM-SERVICES-AGREEMENT.md'),
    'utf8',
  )
  const html = renderMarkdown(markdown)

  return (
    <div className="lp-root lp-legal-root">
      <nav className="lp-nav scrolled lp-legal-nav">
        <a href="/landing" className="lp-nav-logo">
          <img src="/mineral-map-logo-light.svg" alt="Mineral Map" />
        </a>
        <div className="lp-nav-links">
          {/* Pricing / Valuations were archived on the landing page
              2026-07-20; drop these two links so the legal-page nav
              doesn't ship dead anchors. */}
          <a href="/landing">Home</a>
          <a href="/landing#how">How it works</a>
          <Link href="/legal/agreement/sign" className="lp-nav-cta">
            Sign the agreement →
          </Link>
        </div>
      </nav>

      <main className="lp-legal-container">
        <div className="lp-legal-header">
          <span className="lp-section-label">Legal</span>
          <h1 className="lp-legal-h1">Platform Services Agreement</h1>
          <p className="lp-legal-sub">
            The agreement every Mineral Map customer signs before accessing the
            platform. Read it in full, then sign at{' '}
            <Link href="/legal/agreement/sign">
              <span className="lp-legal-inline-link">/legal/agreement/sign</span>
            </Link>
            .
          </p>
        </div>

        <article
          className="lp-legal-body"
          dangerouslySetInnerHTML={{ __html: html }}
        />

        <div className="lp-legal-cta">
          <Link href="/legal/agreement/sign" className="lp-btn-primary lp-btn-large">
            Sign the agreement →
          </Link>
          <span className="lp-legal-cta-hint">
            Signing captures name, IP, user agent, and timestamp for the audit
            trail described in Section 15.
          </span>
        </div>
      </main>

      <footer className="lp-footer">
        <div>
          <img src="/mineral-map-logo-light.svg" alt="Mineral Map" className="lp-footer-logo" />
          <div className="lp-footer-copy">© 2026 Mineral Map · Built for mineral brokers &amp; acquisition shops</div>
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

// Minimal markdown renderer covering the subset the agreement uses: h1-h4,
// paragraphs, bold, italic, inline code, blockquote, numbered + bulleted
// lists, horizontal rules, and links. Avoids pulling a full markdown dep
// for a doc that changes on human timescales.
function renderMarkdown(md: string): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_m, text, href) => `<a href="${href}">${text}</a>`,
      )

  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  const flushList = (buffer: string[], ordered: boolean) => {
    if (buffer.length === 0) return
    const tag = ordered ? 'ol' : 'ul'
    out.push(
      `<${tag}>${buffer.map((li) => `<li>${inline(li)}</li>`).join('')}</${tag}>`,
    )
    buffer.length = 0
  }

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed === '') {
      i += 1
      continue
    }

    if (trimmed.startsWith('---')) {
      out.push('<hr />')
      i += 1
      continue
    }

    const headingMatch = /^(#{1,4})\s+(.*)$/.exec(trimmed)
    if (headingMatch) {
      const level = headingMatch[1].length
      out.push(`<h${level}>${inline(headingMatch[2])}</h${level}>`)
      i += 1
      continue
    }

    if (trimmed.startsWith('> ')) {
      const block: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        block.push(lines[i].trim().slice(2))
        i += 1
      }
      out.push(`<blockquote>${block.map(inline).join(' ')}</blockquote>`)
      continue
    }

    const orderedMatch = /^\d+\.\s+(.*)$/.exec(trimmed)
    if (orderedMatch) {
      const items: string[] = []
      while (i < lines.length) {
        const t = lines[i].trim()
        const m = /^\d+\.\s+(.*)$/.exec(t)
        if (!m) break
        items.push(m[1])
        i += 1
      }
      flushList(items, true)
      continue
    }

    const bulletMatch = /^[-*]\s+(.*)$/.exec(trimmed)
    if (bulletMatch) {
      const items: string[] = []
      while (i < lines.length) {
        const t = lines[i].trim()
        const m = /^[-*]\s+(.*)$/.exec(t)
        if (!m) break
        items.push(m[1])
        i += 1
      }
      flushList(items, false)
      continue
    }

    // Paragraph: accumulate lines until blank or heading/list start.
    const para: string[] = [trimmed]
    i += 1
    while (i < lines.length) {
      const t = lines[i].trim()
      if (
        t === '' ||
        /^#{1,4}\s/.test(t) ||
        /^[-*]\s/.test(t) ||
        /^\d+\.\s/.test(t) ||
        t.startsWith('> ') ||
        t.startsWith('---')
      ) {
        break
      }
      para.push(t)
      i += 1
    }
    out.push(`<p>${inline(para.join(' '))}</p>`)
  }

  return out.join('\n')
}
