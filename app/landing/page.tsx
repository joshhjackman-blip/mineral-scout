import type { Metadata } from 'next'
import LandingPage from './LandingPage'

export const metadata: Metadata = {
  title: 'Mineral Map · Coming Soon',
  description:
    'Mineral Map is coming soon — ownership intelligence for Texas mineral brokers and acquisition shops.',
}

export default function Page() {
  return <LandingPage />
}
