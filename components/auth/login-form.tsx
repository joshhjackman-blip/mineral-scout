"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"

export default function LoginForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleLogin = async () => {
    setLoading(true)
    setError("")
    console.log("[Login] Attempt started")

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      })

      const result = (await response.json()) as {
        success: boolean
        error: string | null
      }

      if (!response.ok || !result.success) {
        setError(result.error ?? "Invalid login credentials.")
        return
      }

      router.push("/dashboard")
      router.refresh()
      window.location.href = "/dashboard"
    } catch (err) {
      console.error("[Login] Unexpected error", err)
      setError("Unable to sign in right now. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div
        className="bg-white rounded-xl shadow-sm border border-slate-200 
                      w-full max-w-md p-8"
      >
        {/* Logo */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">PharmaTrace</h1>
          <p className="text-slate-500 text-sm mt-1">
            Supplier intelligence for compounding pharmacies
          </p>
        </div>

        {/* Title */}
        <h2 className="text-lg font-semibold text-slate-800 mb-6">
          Sign in to your account
        </h2>

        {/* Error */}
        {error && (
          <div
            className="bg-red-50 border border-red-200 text-red-700 
                          text-sm rounded-lg px-4 py-3 mb-4"
          >
            {error}
          </div>
        )}

        {/* Fields */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder="you@pharmacy.com"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 
                         text-sm text-slate-900 placeholder-slate-400
                         focus:outline-none focus:ring-2 focus:ring-blue-500 
                         focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder="••••••••"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 
                         text-sm text-slate-900 placeholder-slate-400
                         focus:outline-none focus:ring-2 focus:ring-blue-500 
                         focus:border-transparent"
            />
          </div>
        </div>

        {/* Button */}
        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full mt-6 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400
                     text-white font-medium rounded-lg px-4 py-2.5 text-sm
                     transition-colors duration-150"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>

        {/* Footer */}
        <p className="text-center text-sm text-slate-500 mt-6">
          Don&apos;t have an account?{" "}
          <Link
            href="/auth/signup"
            className="text-blue-600 hover:underline font-medium"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
