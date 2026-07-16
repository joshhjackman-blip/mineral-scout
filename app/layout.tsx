import type { Metadata } from "next"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import PostHogProvider from "@/app/components/PostHogProvider"

import "./globals.css"

export const metadata: Metadata = {
  title: "Mineral Map — Every tool a mineral broker needs. Free until you close.",
  description:
    "Ownership data, CRM, click-to-call, PSAs, skip tracing, and comp-backed valuations for mineral brokers and buyers. Free platform — we only take a cut when you close.",
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
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
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
