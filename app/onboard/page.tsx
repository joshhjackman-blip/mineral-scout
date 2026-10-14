import fs from 'fs'
import path from 'path'
import type { Metadata } from 'next'
import { renderLegalMarkdown } from '@/lib/legal-markdown'
import OnboardClient from './OnboardClient'
import '../legal/agreement/sign/classic.css'

export const metadata: Metadata = {
  title: 'Finish signup · Mineral Map',
  description: 'Set up your Mineral Map workspace: Terms of Service, billing, and team admin.',
}

export default function OnboardPage() {
  const markdown = fs.readFileSync(
    path.join(process.cwd(), 'legal', 'PLATFORM-SERVICES-AGREEMENT.md'),
    'utf8',
  )
  const agreementHtml = renderLegalMarkdown(markdown)
  return <OnboardClient agreementHtml={agreementHtml} />
}
