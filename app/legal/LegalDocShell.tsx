import Link from 'next/link'
import type { ReactNode } from 'react'

type LegalDocShellProps = {
  label: string
  title: string
  subtitle: ReactNode
  html: string
  cta?: ReactNode
}

/** Shared chrome for /legal/* markdown document pages. */
export default function LegalDocShell({
  label,
  title,
  subtitle,
  html,
  cta,
}: LegalDocShellProps) {
  return (
    <div className="lp-root lp-legal-root">
      <nav className="lp-nav scrolled lp-legal-nav">
        <a href="/landing" className="lp-nav-logo">
          <img src="/mineral-map-logo-light.svg" alt="Mineral Map" />
        </a>
        <div className="lp-nav-links">
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/terms">Terms</Link>
          <Link href="/legal/agreement">Agreement</Link>
          <Link href="/legal/agreement/sign" className="lp-nav-cta">
            Sign →
          </Link>
        </div>
      </nav>

      <main className="lp-legal-container">
        <div className="lp-legal-header">
          <span className="lp-section-label">{label}</span>
          <h1 className="lp-legal-h1">{title}</h1>
          <p className="lp-legal-sub">{subtitle}</p>
        </div>

        <article
          className="lp-legal-body"
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {cta ? <div className="lp-legal-cta">{cta}</div> : null}
      </main>

      <footer className="lp-footer">
        <div>
          <img
            src="/mineral-map-logo-light.svg"
            alt="Mineral Map"
            className="lp-footer-logo"
          />
          <div className="lp-footer-copy">
            © 2026 Mineral Map · Brentwood Enterprises LLC
          </div>
        </div>
        <div className="lp-footer-links">
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/terms">Terms</Link>
          <Link href="/legal/agreement">Agreement</Link>
          <a href="https://getmineralmap.com/auth">Sign in</a>
        </div>
      </footer>
    </div>
  )
}
