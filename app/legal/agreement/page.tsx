import fs from 'fs'
import path from 'path'
import Link from 'next/link'
import type { Metadata } from 'next'
import { renderLegalMarkdown } from '@/lib/legal-markdown'
import LegalDocShell from '../LegalDocShell'

import '../../landing/landing.css'
import './agreement.css'

export const metadata: Metadata = {
  title: 'Platform Services Agreement · Mineral Map',
  description:
    'The Platform Services Agreement every Mineral Map customer signs before accessing the platform, including seats, skip-trace usage, and related terms.',
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
      title="Platform Services Agreement"
      subtitle={
        <>
          Last updated August 12, 2026. Sign at{' '}
          <Link href="/legal/agreement/sign">
            <span className="lp-legal-inline-link">/legal/agreement/sign</span>
          </Link>
          . Also see{' '}
          <Link href="/legal/terms">
            <span className="lp-legal-inline-link">Terms</span>
          </Link>{' '}
          and{' '}
          <Link href="/legal/privacy">
            <span className="lp-legal-inline-link">Privacy</span>
          </Link>
          .
        </>
      }
      html={html}
      cta={
        <>
          <Link href="/legal/agreement/sign" className="lp-btn-primary lp-btn-large">
            Sign the agreement
          </Link>
          <span className="lp-legal-cta-hint">
            Signing captures name, IP, user agent, and timestamp for the audit
            trail described in Section 15.
          </span>
        </>
      }
    />
  )
}
