import { redirect } from 'next/navigation'

/** Seat pricing is retired — access is free; skip-trace is billed at month end. */
export default function PricingRedirect() {
  redirect('/auth')
}
