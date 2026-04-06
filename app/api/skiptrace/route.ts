import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const { firstName, lastName, address, city, state, zip, ownerName } = await req.json()
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // 1) Check cache first
  if (ownerName) {
    const { data: cached } = await supabase
      .from('skip_trace_cache')
      .select('phones, emails')
      .ilike('owner_name', ownerName.trim())
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()

    if (cached) {
      console.log('Cache hit:', ownerName)
      return NextResponse.json({
        success: true,
        phones: (cached as { phones?: string[] }).phones ?? [],
        emails: (cached as { emails?: string[] }).emails ?? [],
        cached: true,
      })
    }
  }

  // 2) Call Tracerfy Instant Trace Lookup
  const apiKey = process.env.TRACERFY_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Tracerfy API key not configured' }, { status: 500 })
  }

  try {
    const response = await fetch('https://api.tracerfy.com/trace/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName,
        address: address,
        city: city,
        state: state,
        zip: zip,
      }),
    })

    const responseText = await response.text()
    console.log('Tracerfy status:', response.status)
    console.log('Tracerfy raw response:', responseText.substring(0, 1000))

    let data: Record<string, unknown>
    try {
      data = JSON.parse(responseText) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid API response', raw: responseText.substring(0, 200) }, { status: 500 })
    }

    // Extract phones and emails from Tracerfy response
    const phones: string[] = []
    const emails: string[] = []

    const result = (data.result as Record<string, unknown> | undefined) ?? {}
    const phoneList = (data.phones as unknown[] | undefined)
      ?? (data.phone_numbers as unknown[] | undefined)
      ?? (result.phones as unknown[] | undefined)
      ?? []
    const emailList = (data.emails as unknown[] | undefined)
      ?? (result.emails as unknown[] | undefined)
      ?? []

    phoneList.forEach((p: unknown) => {
      const pRecord = p as Record<string, unknown>
      const num = (pRecord?.number as string | undefined) ?? (pRecord?.phone as string | undefined) ?? (typeof p === 'string' ? p : undefined)
      if (num && typeof num === 'string') phones.push(num)
    })

    emailList.forEach((e: unknown) => {
      const eRecord = e as Record<string, unknown>
      const addr = (eRecord?.address as string | undefined) ?? (eRecord?.email as string | undefined) ?? (typeof e === 'string' ? e : undefined)
      if (addr && typeof addr === 'string') emails.push(addr)
    })

    // 3) Save to cache
    if (ownerName && (phones.length > 0 || emails.length > 0)) {
      await supabase.from('skip_trace_cache').upsert(
        {
          owner_name: ownerName.trim(),
          mailing_address: address ?? '',
          phones,
          emails,
          source: 'tracerfy',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'owner_name' }
      )
    }

    return NextResponse.json({
      success: true,
      phones,
      emails,
      cached: false,
      raw: data,
    })
  } catch (err) {
    console.error('Tracerfy error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
