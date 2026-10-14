import fs from 'fs'
import path from 'path'
import Link from 'next/link'
import type { Metadata } from 'next'
import { renderLegalMarkdown } from '@/lib/legal-markdown'
import LegalDocShell from '../LegalDocShell'

import '../../landing/landing.css'
import './agreement.css'

export const metadata: Metadata = {
  title: 'Terms of Service · Mineral Map',
  description:
    'Terms of Service for the Mineral Map platform, including license, data-use restrictions, and skip-trace billing.',
}

export default function AgreementPage() {
  const markdown = fs.readFileSync(
    path.join(process.cwd(), 'legal', 'PLATFORM-SERVICES-AGREEMENT.md'),
    'utf8',
  )
  const html = renderLegalMarkdown(markdown)

  return (
    <LegalDocShell
      label="Legal"
      title="Terms of Service"
      subtitle={
        <>
          The terms that govern use of Mineral Map. Customers accept them at{' '}
          <Link href="/legal/agreement/sign">
            <span className="lp-legal-inline-link">/legal/agreement/sign</span>
          </Link>
          . See also our{' '}
          <Link href="/legal/privacy">
            <span className="lp-legal-inline-link">Privacy Policy</span>
          </Link>
          .
        </>
      }
      html={html}
      cta={
        <>
          <Link href="/legal/agreement/sign" className="lp-btn-primary lp-btn-large">
            Accept Terms of Service →
          </Link>
          <span className="lp-legal-cta-hint">
            Acceptance records your name, IP address, user agent, and timestamp.
          </span>
        </>
      }
    />
  )
}
