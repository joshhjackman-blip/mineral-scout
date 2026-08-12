import fs from 'fs'
import path from 'path'
import Link from 'next/link'
import type { Metadata } from 'next'
import { renderLegalMarkdown } from '@/lib/legal-markdown'
import LegalDocShell from '../LegalDocShell'

import '../../landing/landing.css'
import '../agreement/agreement.css'

export const metadata: Metadata = {
  title: 'Terms of Use · Mineral Map',
  description:
    'Terms governing use of the Mineral Map website and platform. Customers also accept the Platform Services Agreement.',
}

export default function TermsPage() {
  const markdown = fs.readFileSync(
    path.join(process.cwd(), 'legal', 'TERMS-OF-USE.md'),
    'utf8',
  )
  const html = renderLegalMarkdown(markdown)

  return (
    <LegalDocShell
      label="Legal"
      title="Terms of Use"
      subtitle={
        <>
          Last updated August 12, 2026. Platform customers also accept the{' '}
          <Link href="/legal/agreement">
            <span className="lp-legal-inline-link">Platform Services Agreement</span>
          </Link>
          . See the{' '}
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
            Sign the Platform Services Agreement
          </Link>
          <span className="lp-legal-cta-hint">
            Required before map and CRM access.
          </span>
        </>
      }
    />
  )
}
