import { redirect } from "next/navigation"

import { SignupForm } from "@/components/auth/signup-form"
import { createClient } from "@/lib/supabase/server"

export default async function SignupPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect("/dashboard")
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 px-4">
      <SignupForm />
    </main>
  )
}
