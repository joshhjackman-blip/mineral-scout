import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

type SkipTracePhone = {
  phone?: string | null
}

type SkipTraceEmail = {
  email?: string | null
}

type SkipTraceApiResponse = {
  output?: {
    phones?: SkipTracePhone[]
    emails?: SkipTraceEmail[]
  }
  error?: string
}

export async function POST(req: NextRequest) {
  const { firstName, lastName, address, city, state, zip, ownerName } = await req.json()

  if (!firstName && !lastName) {
    return NextResponse.json({ error: 'Name required' }, { status: 400 })
  }

  const apiKey = process.env.BATCH_SKIP_TRACING_API_KEY
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  if (ownerName) {
    const { data: cached } = await supabase
      .from('skip_trace_cache')
      .select('phones, emails')
      .ilike('owner_name', ownerName.trim())
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (cached) {
      console.log('Skip trace cache hit for:', ownerName)
      return NextResponse.json({
        success: true,
        phones: (cached as { phones?: string[] }).phones ?? [],
        emails: (cached as { emails?: string[] }).emails ?? [],
        cached: true,
      })
    }
  }
  if (!apiKey) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
  }

  try {
    const response = await fetch(
      'https://api.batchskiptracing.com/api/beta/propertySearch',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          firstName,
          lastName,
          address,
          city,
          state,
          zip,
        }),
      }
    )

    const data = (await response.json()) as SkipTraceApiResponse
    console.log('BatchSkipTracing response:', JSON.stringify(data, null, 2))

    if (!response.ok) {
      return NextResponse.json(
        { error: data?.error ?? 'Skip trace request failed' },
        { status: response.status }
      )
    }

    const phones: string[] = []
    const emails: string[] = []

    if (Array.isArray(data?.output?.phones)) {
      data.output.phones.forEach((p) => {
        if (p?.phone) phones.push(p.phone)
      })
    }
    if (Array.isArray(data?.output?.emails)) {
      data.output.emails.forEach((e) => {
        if (e?.email) emails.push(e.email)
      })
    }

    if (ownerName && (phones.length > 0 || emails.length > 0)) {
      const normalizedOwnerName = ownerName.trim()
      const normalizedAddress = String(address ?? '').trim()

      const { data: existingCache } = await supabase
        .from('skip_trace_cache')
        .select('id')
        .ilike('owner_name', normalizedOwnerName)
        .ilike('mailing_address', normalizedAddress)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingCache?.id) {
        await supabase
          .from('skip_trace_cache')
          .update({
            phones,
            emails,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingCache.id)
      } else {
        await supabase.from('skip_trace_cache').insert({
          owner_name: normalizedOwnerName,
          mailing_address: normalizedAddress,
          phones,
          emails,
          source: 'batchdata',
          updated_at: new Date().toISOString(),
        })
      }
      console.log('Saved to skip trace cache:', ownerName)
    }

    return NextResponse.json({
      success: true,
      phones,
      emails,
      cached: false,
    })
  } catch (err) {
    console.error('Skip trace error:', err)
    return NextResponse.json({ error: 'Skip trace failed' }, { status: 500 })
  }
}
