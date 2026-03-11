import { redirect } from "next/navigation"

import LoginForm from "@/components/auth/login-form"
import { createClient } from "@/lib/supabase/server"

export default async function LoginPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect("/dashboard")
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 px-4">
      <LoginForm />
    </main>
  )
}
