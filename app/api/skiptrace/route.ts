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
    // Use find_owner: false since we know the name but only have mailing address not property address
    const body: Record<string, unknown> = {
      address,
      city,
      state,
      zip,
      find_owner: false,
      first_name: firstName,
      last_name: lastName,
    }

    console.log('Tracerfy request:', JSON.stringify(body))

    const response = await fetch('https://tracerfy.com/v1/api/trace/lookup/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    const responseText = await response.text()
    console.log('Tracerfy status:', response.status)
    console.log('Tracerfy raw response:', responseText.substring(0, 1000))

    let data: Record<string, unknown>
    try {
      data = JSON.parse(responseText) as Record<string, unknown>
    } catch {
      return NextResponse.json(
        { error: 'Invalid API response', raw: responseText.substring(0, 300) },
        { status: 500 }
      )
    }

    const phones: string[] = []
    const emails: string[] = []

    // Extract from persons array
    const persons = (data.persons as Array<Record<string, unknown>>) ?? []
    for (const person of persons) {
      const personPhones = (person?.phones as Array<Record<string, unknown>>) ?? []
      for (const p of personPhones) {
        const num = p?.number
        const isDnc = Boolean(p?.dnc)
        if (typeof num === 'string' && num && !isDnc) phones.push(num)
      }
      // Also include DNC numbers but mark them — for now include all
      for (const p of personPhones) {
        const num = p?.number
        const isDnc = Boolean(p?.dnc)
        if (typeof num === 'string' && num && isDnc && !phones.includes(num)) phones.push(num)
      }

      const personEmails = (person?.emails as Array<Record<string, unknown>>) ?? []
      for (const e of personEmails) {
        const addr = e?.email
        if (typeof addr === 'string' && addr) emails.push(addr)
      }
    }

    // 3) Save to cache if we got results
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
      console.log('Saved to cache:', ownerName)
    }

    return NextResponse.json({
      success: true,
      phones,
      emails,
      cached: false,
      hit: Boolean(data?.hit),
      credits_deducted: Number(data?.credits_deducted ?? 0),
    })
  } catch (err) {
    console.error('Tracerfy error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
