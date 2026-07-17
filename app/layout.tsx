import type { Metadata } from "next"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import PostHogProvider from "@/app/components/PostHogProvider"

import "./globals.css"

export const metadata: Metadata = {
  title: "Mineral Map · Every tool a mineral broker needs. Free until you close.",
  description:
    "Ownership data, CRM, click-to-call, PSAs, skip tracing, and comp-backed valuations for mineral brokers and acquisition shops. Free platform. We only take a fee post close.",
  icons: {
    icon: "/mineral-map-logo.svg",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Type stack (2026-07-17 second refinement — toned down for
              a Texas oil-and-gas B2B audience):
              - Libre Baskerville: classical Baskerville revival.
                Reads like a newspaper / law-firm letterhead — solid,
                trustworthy, not showy. Replaces Cormorant which
                felt slightly literary for the audience.
              - Public Sans: US federal design system font (used by
                usa.gov and Fed sites). Institutional, neutral, no
                startup edge. Replaces Instrument Sans's humanist warmth.
              - JetBrains Mono: kept for tabular numbers.
        */}
        <link
          href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Public+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,500&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ margin: 0, padding: 0 }}>
        <PostHogProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </PostHogProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  )
}
