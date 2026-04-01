import { NextRequest, NextResponse } from 'next/server'

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
  const { firstName, lastName, address, city, state, zip } = await req.json()

  if (!firstName && !lastName) {
    return NextResponse.json({ error: 'Name required' }, { status: 400 })
  }

  const apiKey = process.env.BATCH_SKIP_TRACING_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
  }

  try {
    // Allow override in case BatchData updates route paths across API versions.
    const endpoint =
      process.env.BATCH_SKIP_TRACING_ENDPOINT ??
      'https://api.batchdata.com/api/v1/property/skip-trace'

    const response = await fetch(
      endpoint,
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

    return NextResponse.json({
      success: true,
      phones,
      emails,
      raw: data,
    })
  } catch (err) {
    console.error('Skip trace error:', err)
    return NextResponse.json({ error: 'Skip trace failed' }, { status: 500 })
  }
}
