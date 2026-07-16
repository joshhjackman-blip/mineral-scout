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
        {/* Type stack (2026-07-16 redesign):
              - Fraunces: variable serif for headings + display type.
                Slightly newspaper-feeling, has warmth. Falls back to
                Georgia so a slow font-server doesn't strip the vibe.
              - Instrument Sans: humanist sans for body / UI copy.
                Warmer + a little chunkier than Inter — pulls the app
                away from the generic 'startup Inter' look.
              - JetBrains Mono: unchanged, kept for tabular numbers.
        */}
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
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
