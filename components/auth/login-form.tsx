"use client"

import Link from "next/link"
import { FormEvent, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"

export function LoginForm() {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    console.log("[LoginForm] submit handler called", { email })
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const supabase = createClient()
      console.log("[LoginForm] attempting signInWithPassword")
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        console.error("[LoginForm] sign in failed", error)
        setErrorMessage(error.message)
        setIsLoading(false)
        return
      }

      console.log("[LoginForm] sign in succeeded, redirecting to /dashboard")
      setIsLoading(false)
      router.push("/dashboard")
      router.refresh()
    } catch (error) {
      console.error("[LoginForm] unexpected sign in error", error)
      setErrorMessage("Unable to sign in right now. Please try again.")
      setIsLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-md border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl text-slate-900">Sign in</CardTitle>
        <CardDescription className="text-slate-600">
          Access your PharmaTrace compliance workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit} ref={formRef}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@pharmacy.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          <Button
            type="button"
            className="w-full"
            disabled={isLoading}
            onClick={() => {
              console.log("[LoginForm] sign in button clicked")
              formRef.current?.requestSubmit()
            }}
          >
            {isLoading ? "Signing in..." : "Sign in"}
          </Button>

          {errorMessage ? (
            <p className="text-sm text-destructive" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          New to PharmaTrace?{" "}
          <Link href="/auth/signup" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
