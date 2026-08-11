import fs from 'fs'
import path from 'path'
import Link from 'next/link'
import type { Metadata } from 'next'
import { renderLegalMarkdown } from '@/lib/legal-markdown'
import LegalDocShell from '../LegalDocShell'

import '../../landing/landing.css'
import '../agreement/agreement.css'

export const metadata: Metadata = {
  title: 'Privacy Policy · Mineral Map',
  description:
    'How Mineral Map collects, uses, and shares information for the website and platform.',
}

export default function PrivacyPage() {
  const markdown = fs.readFileSync(
    path.join(process.cwd(), 'legal', 'PRIVACY-POLICY.md'),
    'utf8',
  )
  const html = renderLegalMarkdown(markdown)

  return (
    <LegalDocShell
      label="Legal"
      title="Privacy Policy"
      subtitle={
        <>
          How we handle account, usage, and platform data. Related:{' '}
          <Link href="/legal/terms">
            <span className="lp-legal-inline-link">Terms of Use</span>
          </Link>{' '}
          and{' '}
          <Link href="/legal/agreement">
            <span className="lp-legal-inline-link">Platform Services Agreement</span>
          </Link>
          .
        </>
      }
      html={html}
    />
  )
}
