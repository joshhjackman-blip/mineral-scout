import type { Metadata } from "next"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import PostHogProvider from "@/app/components/PostHogProvider"
import HelpChatWidget from "@/app/components/HelpChatWidget"

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
        {/* Type stack (2026-07-17 third refinement — matches
              de-minimis.ai's Geist pairing per user reference):
              - Geist: Vercel's variable sans. Used for BOTH body
                and display. Modern geometric feel, highly legible,
                works at every size from a 10px table cell to a
                48px landing hero.
              - Geist Mono: paired variable mono for tabular numbers
                and code-like values (abstract labels, permit APIs,
                RRC lease IDs).
        */}
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ margin: 0, padding: 0 }}>
        <PostHogProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </PostHogProvider>
        <HelpChatWidget />
        <Toaster richColors position="top-right" />
      </body>
    </html>
  )
}
