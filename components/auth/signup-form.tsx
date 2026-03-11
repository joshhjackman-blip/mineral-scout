"use client"

import Link from "next/link"
import { FormEvent, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function SignupForm() {
  const [email, setEmail] = useState("")
  const [pharmacyName, setPharmacyName] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)

    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.")
      return
    }

    setIsLoading(true)

    let result: { success: boolean; error: string | null } = {
      success: false,
      error: "Unable to create your account.",
    }
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          pharmacyName,
          password,
        }),
      })
      result = (await response.json()) as { success: boolean; error: string | null }
      if (!response.ok) {
        result.success = false
        result.error = result.error ?? "Unable to create your account."
      }
    } catch {
      result = {
        success: false,
        error: "Unable to create your account.",
      }
    }

    setIsLoading(false)

    if (!result.success) {
      setErrorMessage(result.error ?? "Unable to create your account.")
      return
    }

    setSuccessMessage("Check your email to confirm your account.")
    setEmail("")
    setPharmacyName("")
    setPassword("")
    setConfirmPassword("")
  }

  return (
    <Card className="w-full max-w-md border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl text-slate-900">Create account</CardTitle>
        <CardDescription className="text-slate-600">
          Set up your pharmacy organization in PharmaTrace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="pharmacy-name">Pharmacy name</Label>
            <Input
              id="pharmacy-name"
              type="text"
              placeholder="Acme Compounding Pharmacy"
              value={pharmacyName}
              onChange={(event) => setPharmacyName(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Work email</Label>
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
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              type="password"
              minLength={8}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Creating account..." : "Create account"}
          </Button>
        </form>

        {errorMessage ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {successMessage ? (
          <p className="mt-3 text-sm text-primary" role="status">
            {successMessage}
          </p>
        ) : null}

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/auth/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
