import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { getTeamOwnerId } from '@/lib/team'
import { skipTraceOwnerKey } from '@/lib/workspace'

// Skip trace usage is still tracked in the skip_trace_usage table
// for internal accounting / abuse detection, but there is no monthly
// cap enforced on end users. Setting the limit to Number.MAX_SAFE_INTEGER
// keeps the response shape backwards-compatible with the older UI
// (`limit: N`) so nothing downstream has to change.
const MONTHLY_LIMIT = Number.MAX_SAFE_INTEGER

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
    data: { user },
  } = await supabaseAuth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = user.id
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  // Workspace for usage rollups. Cache itself is intentionally global —
  // if Team A already paid to skip-trace this owner, Team B gets a hit.
  const { data: subRow } = await adminClient
    .from('subscriptions')
    .select('team_owner_id')
    .eq('user_id', userId)
    .maybeSingle()
  const workspaceId =
    getTeamOwnerId(
      metadata,
      (subRow as { team_owner_id?: string | null } | null)?.team_owner_id,
    ) || userId

  const currentMonth = new Date().toISOString().slice(0, 7)
  let currentCount = 0
  const cacheKey = skipTraceOwnerKey(ownerName)

  // 1) Shared cache first — any prior team's result counts. Cache hits
  // do NOT increment skip_trace_usage (we didn't pay the provider again).
  if (cacheKey) {
    const { data: cached, error: cacheError } = await adminClient
      .from('skip_trace_cache')
      .select('phones, emails')
      .eq('owner_name', cacheKey)
      .maybeSingle()

    if (cacheError) {
      console.error('Skip trace cache lookup error:', cacheError)
    }

    if (cached) {
      return NextResponse.json({
        success: true,
        phones: (cached as { phones?: string[] }).phones ?? [],
        emails: (cached as { emails?: string[] }).emails ?? [],
        cached: true,
        limit: MONTHLY_LIMIT,
      })
    }
  }

  // 2) Check monthly usage limit (cache misses / paid calls only)
  {
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

    if (apiKey && address && address.trim() && city && city.trim() && state && state.trim()) {
      // Use find_owner: false since we know the name but only have mailing address not property address
      const body: Record<string, unknown> = {
        find_owner: false,
        first_name: firstName,
        last_name: lastName,
      }
      if (address && address.trim()) body.address = address
      if (city && city.trim()) body.city = city
      if (state && state.trim()) body.state = state
      if (zip && zip.trim()) body.zip = zip

      const response = await fetch('https://tracerfy.com/v1/api/trace/lookup/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      })

      const responseText = await response.text()

      try {
        data = JSON.parse(responseText) as Record<string, unknown>
      } catch {
        console.error('Tracerfy response parse failed', { status: response.status })
        if (!bstApiKey) {
          return NextResponse.json(
            { error: 'Invalid API response' },
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
      console.warn('Skipping Tracerfy (missing key or address/city/state); falling back to BatchSkipTracing')
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
        const bstResponse = await fetch('https://api.batchdata.com/api/v1/property/skip-trace', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${bstApiKey}`,
          },
          body: JSON.stringify(bstBody),
        })
        const bstText = await bstResponse.text()
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

    const nextCount = currentCount + 1
    const { error: usageUpdateError } = await adminClient
      .from('skip_trace_usage')
      .upsert(
        {
          user_id: userId,
          team_owner_id: workspaceId,
          month: currentMonth,
          count: nextCount,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,month' },
      )

    if (usageUpdateError) {
      console.error('Skip trace usage update error:', usageUpdateError)
      return NextResponse.json({ error: 'Failed to update skip trace usage' }, { status: 500 })
    }

    // 4) Save to SHARED cache — next team that skip-traces this owner
    // pays $0 provider credits.
    if (cacheKey && (phones.length > 0 || emails.length > 0)) {
      await adminClient.from('skip_trace_cache').upsert(
        {
          owner_name: cacheKey,
          mailing_address: address ?? '',
          phones,
          emails,
          source: cacheSource,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'owner_name' },
      )
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
