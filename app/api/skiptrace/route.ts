import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/auth-helpers-nextjs'

const MONTHLY_LIMIT = 200

const pushUniquePhone = (phones: string[], value: unknown) => {
  if (typeof value !== 'string') return
  const normalized = value.trim()
  if (!normalized) return
  if (!phones.includes(normalized)) phones.push(normalized)
}

const pushUniqueEmail = (emails: string[], value: unknown) => {
  if (typeof value !== 'string') return
  const normalized = value.trim()
  if (!normalized) return
  if (!emails.includes(normalized)) emails.push(normalized)
}

const extractContactsFromPayload = (
  payload: unknown,
  phones: string[],
  emails: string[]
) => {
  if (!payload || typeof payload !== 'object') return

  const root = payload as Record<string, unknown>

  const addPhonesFromArray = (items: unknown) => {
    if (!Array.isArray(items)) return
    for (const item of items) {
      if (typeof item === 'string') {
        pushUniquePhone(phones, item)
        continue
      }
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      pushUniquePhone(phones, obj.number ?? obj.phone ?? obj.phoneNumber ?? obj.mobile)
    }
  }

  const addEmailsFromArray = (items: unknown) => {
    if (!Array.isArray(items)) return
    for (const item of items) {
      if (typeof item === 'string') {
        pushUniqueEmail(emails, item)
        continue
      }
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      pushUniqueEmail(emails, obj.email ?? obj.address ?? obj.emailAddress)
    }
  }

  addPhonesFromArray(root.phones)
  addPhonesFromArray(root.phone_numbers)
  addPhonesFromArray(root.phoneNumbers)
  addEmailsFromArray(root.emails)
  addEmailsFromArray(root.email_addresses)
  addEmailsFromArray(root.emailAddresses)

  pushUniquePhone(phones, root.phone ?? root.phoneNumber ?? root.mobile)
  pushUniqueEmail(emails, root.email ?? root.emailAddress)

  const nestedCollections = [root.persons, root.results, root.data, root.skips]
  for (const collection of nestedCollections) {
    if (!Array.isArray(collection)) continue
    for (const item of collection) {
      extractContactsFromPayload(item, phones, emails)
    }
  }
}

export async function POST(req: NextRequest) {
  const { firstName, lastName, address, city, state, zip, ownerName } = await req.json()

  const res = NextResponse.next()
  const supabaseAuth = createServerClient(
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
  } = await supabaseAuth.auth.getSession()
  const userId = session?.user?.id

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const currentMonth = new Date().toISOString().slice(0, 7)
  let currentCount = 0

  // 1) Check cache first
  if (ownerName) {
    const { data: cached, error: cacheError } = await adminClient
      .from('skip_trace_cache')
      .select('phones, emails')
      .ilike('owner_name', ownerName.trim())
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (cacheError) {
      console.error('Skip trace cache lookup error:', cacheError)
    }

    if (cached) {
      console.log('Cache hit - not counting against limit:', ownerName)
      return NextResponse.json({
        success: true,
        phones: (cached as { phones?: string[] }).phones ?? [],
        emails: (cached as { emails?: string[] }).emails ?? [],
        cached: true,
        limit: MONTHLY_LIMIT,
      })
    }
  }

  // 2) Check monthly usage limit (cache misses only)
  if (userId) {
    const { data: usage, error: usageError } = await adminClient
      .from('skip_trace_usage')
      .select('count')
      .eq('user_id', userId)
      .eq('month', currentMonth)
      .maybeSingle()

    if (usageError) {
      console.error('Skip trace usage lookup error:', usageError)
      return NextResponse.json({ error: 'Failed to read skip trace usage' }, { status: 500 })
    }

    currentCount = Number((usage as { count?: number } | null)?.count ?? 0)
    console.log(`User ${userId} skip trace usage: ${currentCount}/${MONTHLY_LIMIT}`)

    if (currentCount >= MONTHLY_LIMIT) {
      return NextResponse.json(
        {
          error: 'monthly_limit_reached',
          message: `You have used all ${MONTHLY_LIMIT} skip traces for this month. Resets on the 1st.`,
          count: currentCount,
          limit: MONTHLY_LIMIT,
        },
        { status: 429 }
      )
    }
  }

  // 3) Call Tracerfy Instant Trace Lookup
  const apiKey = process.env.TRACERFY_API_KEY?.trim()
  const bstApiKey = process.env.BATCHSKIPTRACING_API_KEY?.trim()
  if (!apiKey && !bstApiKey) {
    return NextResponse.json(
      { error: 'Skip trace providers are not configured (TRACERFY_API_KEY / BATCHSKIPTRACING_API_KEY)' },
      { status: 500 }
    )
  }

  try {
    let data: Record<string, unknown> = {}
    const phones: string[] = []
    const emails: string[] = []
    let cacheSource = 'tracerfy'

    if (apiKey) {
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

      try {
        data = JSON.parse(responseText) as Record<string, unknown>
      } catch {
        console.error('Tracerfy response parse failed')
        if (!bstApiKey) {
          return NextResponse.json(
            { error: 'Invalid API response', raw: responseText.substring(0, 300) },
            { status: 500 }
          )
        }
      }

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

      // Parse additional shapes defensively in case provider schema varies.
      extractContactsFromPayload(data, phones, emails)
    } else {
      console.warn('Tracerfy key missing; skipping Tracerfy and trying BatchSkipTracing fallback')
    }

    if (bstApiKey && phones.length === 0 && emails.length === 0) {
      try {
        const bstBody: Record<string, unknown> = {
          requests: [
            {
              firstName: firstName,
              lastName: lastName,
              address: address || '',
              city: city || '',
              state: state || '',
              zip: zip || '',
            },
          ],
        }
        console.log('BST request:', JSON.stringify(bstBody))
        const bstResponse = await fetch('https://api.batchdata.com/api/v1/property/skip-trace', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${bstApiKey}`,
          },
          body: JSON.stringify(bstBody),
        })
        const bstText = await bstResponse.text()
        console.log('BST raw response:', bstText.substring(0, 1000))
        if (bstResponse.ok) {
          const bstData = JSON.parse(bstText) as Record<string, unknown>
          const persons = ((bstData?.results as Record<string, unknown> | undefined)?.persons as Array<Record<string, unknown>>) ?? []
          for (const person of persons) {
            const phoneNumbers = (person?.phoneNumbers as Array<Record<string, unknown>>) ?? []
            for (const p of phoneNumbers) {
              const num = String(p?.phoneNumber ?? p?.number ?? '').trim()
              if (num && !phones.includes(num)) phones.push(num)
            }
            const emailList = (person?.emails as Array<Record<string, unknown>>) ?? []
            for (const e of emailList) {
              const addr = String(e?.email ?? e?.address ?? '').trim()
              if (addr && !emails.includes(addr)) emails.push(addr)
            }
          }
          if (phones.length > 0 || emails.length > 0) {
            cacheSource = 'batchskiptracing'
          }
        }
      } catch (bstErr) {
        console.error('BST error:', bstErr)
      }
    }

    let nextCount = currentCount
    if (userId) {
      nextCount = currentCount + 1
      const { error: usageUpdateError } = await adminClient
        .from('skip_trace_usage')
        .upsert(
          {
            user_id: userId,
            month: currentMonth,
            count: nextCount,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,month' }
        )

      if (usageUpdateError) {
        console.error('Skip trace usage update error:', usageUpdateError)
        return NextResponse.json({ error: 'Failed to update skip trace usage' }, { status: 500 })
      }
    }

    // 4) Save to cache if we got results
    if (ownerName && (phones.length > 0 || emails.length > 0)) {
      await adminClient.from('skip_trace_cache').upsert(
        {
          owner_name: ownerName.trim(),
          mailing_address: address ?? '',
          phones,
          emails,
          source: cacheSource,
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
      count: nextCount,
      limit: MONTHLY_LIMIT,
    })
  } catch (err) {
    console.error('Tracerfy error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
