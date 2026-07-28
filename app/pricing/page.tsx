import { redirect } from 'next/navigation'

/**
 * Pricing / Stripe paywall archived (2026-07-23).
 * Authenticated users with a Supabase account can use the app without
 * an active subscription. Re-enable Stripe checkout later when billing
 * is ready — restore this page from git history before that commit.
 */
export default function PricingPage() {
  redirect('/landing')
}
