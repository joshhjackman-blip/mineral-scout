import fs from 'fs'
import path from 'path'
import type { Metadata } from 'next'
import { renderLegalMarkdown } from '@/lib/legal-markdown'
import AgreementSignClient from './AgreementSignClient'
import './classic.css'

export const metadata: Metadata = {
  title: 'Sign Platform Services Agreement · Mineral Map',
  description:
    'Review and accept the Mineral Map Platform Services Agreement to access the map and CRM.',
}

export default function SignAgreementPage() {
  const markdown = fs.readFileSync(
    path.join(process.cwd(), 'legal', 'PLATFORM-SERVICES-AGREEMENT.md'),
    'utf8',
  )
  const agreementHtml = renderLegalMarkdown(markdown)

  return <AgreementSignClient agreementHtml={agreementHtml} />
}
