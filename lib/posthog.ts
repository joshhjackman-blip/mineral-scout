import posthog from 'posthog-js'

export const initPostHog = () => {
  if (typeof window !== 'undefined') {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
    if (!key) return

    posthog.init(key, {
      api_host: 'https://app.posthog.com',
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
    })
  }
}

export const identifyUser = (userId: string, email: string, isAdmin?: boolean) => {
  if (isAdmin) {
    posthog.opt_out_capturing()
    return
  }
  if (!userId) return
  posthog.opt_in_capturing()
  posthog.identify(userId, { email })
}

export const trackEvent = (event: string, properties?: Record<string, unknown>) => {
  posthog.capture(event, properties)
}

export default posthog
