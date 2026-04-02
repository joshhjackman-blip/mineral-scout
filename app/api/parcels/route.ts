import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/auth-helpers-nextjs'

export async function GET(req: NextRequest) {
  const res = NextResponse.next()

  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll().map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
          }))
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value)
            res.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const {
    data: { session },
  } = await authClient.auth.getSession()

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await adminClient.storage
    .from('raw-data')
    .download('gonzales_parcels_enriched.geojson')

  if (error || !data) {
    console.error('Storage error:', error)
    return NextResponse.json({ error: 'Failed to load parcel data' }, { status: 500 })
  }

  const text = await data.text()

  return new NextResponse(text, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
