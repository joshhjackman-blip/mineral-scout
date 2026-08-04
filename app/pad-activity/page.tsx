import { redirect } from 'next/navigation'

/**
 * Satellite Imagery (Pad Ops) — archived 2026-08-04.
 * Re-enable UI via SATELLITE_IMAGERY_ENABLED in lib/feature-flags.ts
 * (API routes and components remain in the repo).
 */
export default function PadActivityArchivedPage() {
  redirect('/')
}
