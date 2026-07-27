import type { Metadata } from 'next'
import LandingPage from './LandingPage'

export const metadata: Metadata = {
  title: 'Mineral Map',
  description:
    'Everything you need to find, track, and close Permian mineral deals — ownership intelligence for Texas mineral brokers and acquisition shops.',
}

export default function Page() {
  return <LandingPage />
}
