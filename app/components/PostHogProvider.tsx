'use client'

import { useEffect } from 'react'

import { initPostHog } from '@/lib/posthog'

type PostHogProviderProps = {
  children: React.ReactNode
}

export default function PostHogProvider({ children }: PostHogProviderProps) {
  useEffect(() => {
    initPostHog()
  }, [])

  return <>{children}</>
}
