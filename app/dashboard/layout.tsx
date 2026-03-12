import { redirect } from "next/navigation"

import { AppSidebar } from "@/components/layout/sidebar"
import { createClient } from "@/lib/supabase/server"

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && process.env.NODE_ENV !== "development") {
    redirect("/auth/login")
  }

  return (
    <div className="flex min-h-screen bg-slate-100">
      <AppSidebar userEmail={user?.email} />
      <main className="flex-1 bg-white p-6 md:p-8">{children}</main>
    </div>
  )
}
