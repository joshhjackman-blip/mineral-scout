import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Book a demo · Mineral Map',
  description:
    'Request a Mineral Map walkthrough. Questions? Email management@mineralmapllc.com.',
}

export default function BookDemoLayout({ children }: { children: React.ReactNode }) {
  return children
}
