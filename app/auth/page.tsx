'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [message, setMessage] = useState<string | null>(null)

  const handleSubmit = async () => {
    console.log('handleSubmit called', { email, password, mode })
    setLoading(true)
    setError(null)

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    console.log('Supabase response:', { data, error })

    if (error) {
      console.error('Auth error:', error.message, error.status)
      setError(error.message)
    } else {
      console.log('Login success, redirecting...')
      window.location.href = '/'
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 justify-center mb-8">
          <div className="w-10 h-10 bg-amber-400 rounded-lg flex items-center justify-center">
            <span className="text-white text-lg font-bold">M</span>
          </div>
          <span className="font-serif text-2xl font-bold text-white">Mineral Map</span>
        </div>

        <div className="bg-white rounded-2xl p-8 shadow-2xl">
          <h2 className="font-serif text-xl font-bold text-gray-900 mb-1">
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            {mode === 'login' ? 'Access your Mineral Map workspace.' : 'Request access to Mineral Map.'}
          </p>

          {error && (
            <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          {message && (
            <div className="mb-4 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
              {message}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="you@company.com"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="••••••••"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 transition-all"
              />
            </div>
            <div
              onClick={() => {
                setEmail('demo@mineralmap.io')
                setPassword('EagleFord2026')
              }}
              className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer hover:bg-amber-100 transition-colors"
            >
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              <div>
                <div className="text-xs font-semibold text-amber-700">Try the demo</div>
                <div className="text-xs text-amber-600">demo@mineralmap.io · EagleFord2026</div>
              </div>
            </div>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-semibold rounded-lg text-sm transition-colors"
            >
              {loading ? 'Loading...' : mode === 'login' ? 'Sign in →' : 'Create account →'}
            </button>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-100 text-center">
            <button
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login')
                setError(null)
              }}
              className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              {mode === 'login' ? 'New to Mineral Map? Request access →' : 'Already have an account? Sign in →'}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-500 mt-6">
          Gonzales County, TX · Eagle Ford Basin
        </p>
      </div>
    </div>
  )
}
