import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { firstName, lastName, address, city, state, zip } = await req.json()

  const apiKey = process.env.BATCH_SKIP_TRACING_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
  }

  try {
    const response = await fetch('https://api.batchdata.com/api/v1/property/skip-trace', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        requests: [
          {
            firstName,
            lastName,
            address,
            city,
            state,
            zip,
          },
        ],
      }),
    })

    const responseText = await response.text()
    console.log('BatchData status:', response.status)
    console.log('BatchData raw response:', responseText.substring(0, 1000))

    let data: unknown
    try {
      data = JSON.parse(responseText)
    } catch {
      return NextResponse.json(
        {
          error: 'Invalid API response',
          raw: responseText.substring(0, 300),
        },
        { status: 500 }
      )
    }

    const dataRecord = data as Record<string, unknown>
    const result =
      (dataRecord?.results as unknown[] | undefined)?.[0] ??
      (dataRecord?.data as unknown[] | undefined)?.[0] ??
      dataRecord

    const resultRecord = result as Record<string, unknown>
    const phones: string[] = []
    const emails: string[] = []

    const phoneList = (resultRecord?.phoneNumbers as unknown[] | undefined) ?? (resultRecord?.phones as unknown[] | undefined) ?? []
    phoneList.forEach((p: unknown) => {
      const pRecord = p as Record<string, unknown>
      const num = (pRecord?.number as string | undefined) ?? (pRecord?.phone as string | undefined) ?? (typeof p === 'string' ? p : undefined)
      if (num && typeof num === 'string') phones.push(num)
    })

    const emailList = (resultRecord?.emails as unknown[] | undefined) ?? []
    emailList.forEach((e: unknown) => {
      const eRecord = e as Record<string, unknown>
      const addr = (eRecord?.address as string | undefined) ?? (eRecord?.email as string | undefined) ?? (typeof e === 'string' ? e : undefined)
      if (addr && typeof addr === 'string') emails.push(addr)
    })

    return NextResponse.json({
      success: true,
      phones,
      emails,
      raw: data,
    })
  } catch (err) {
    console.error('Skip trace error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
