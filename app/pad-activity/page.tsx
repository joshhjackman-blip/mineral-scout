import { redirect } from 'next/navigation'
import { SATELLITE_IMAGERY_ENABLED } from '@/lib/feature-flags'

/**
 * Satellite Imagery (Pad Ops) — archived for now.
 * Full implementation remains in git history / API routes; re-enable via
 * SATELLITE_IMAGERY_ENABLED in lib/feature-flags.ts.
 */
export default function PadActivityPage() {
  if (!SATELLITE_IMAGERY_ENABLED) {
    redirect('/')
  }
  redirect('/')
}
