/**
 * End-of-month prepaid skip-trace burn.
 *
 * idiCORE (12,500) and Accurate Append (3,333) credits do not roll over.
 * The live user chain stops on the first hit, so Accurate Append is barely
 * used. This job pins one provider, traces owners who are not in the shared
 * cache, and writes hits to skip_trace_cache (not billed to customers).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import { COUNTIES } from '@/lib/counties'
import { hasPhone } from '@/lib/phone-activity'
import { skipTraceOwnerKey } from '@/lib/skip-trace-cache'
import { enrichPersonTraceArgs, isBusinessOwner } from '@/lib/skip-trace-name'
import {
  runSkipTraceChain,
  type SkipTraceProviderName,
} from '@/lib/skip-trace-providers'
import { applySkipTracePhones } from '@/lib/skip-trace-review'

export const QUOTA_PROVIDERS: SkipTraceProviderName[] = ['idicore', 'accurateappend']

export type QuotaJobStatus = 'queued' | 'running' | 'paused' | 'done' | 'error'

export type QuotaJob = {
  id: string
  provider: SkipTraceProviderName
  status: QuotaJobStatus
  month: string
  target_count: number
  processed: number
  hits: number
  misses: number
  skipped: number
  cad_table_index: number
  cad_offset: number
  locked_until?: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export type QuotaProviderStatus = {
  provider: SkipTraceProviderName
  label: string
  quota: number
  used: number
  remaining: number
  job: QuotaJob | null
}

export type QuotaBurnCandidate = {
  ownerName: string
  address: string
  city: string
  state: string
  zip: string
  dealId?: string | null
  county?: string | null
}

const CAD_TABLES = Object.values(COUNTIES).map((c) => c.ownershipTable)

export function quotaMonth(now = new Date()): string {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function providerQuota(provider: SkipTraceProviderName): number {
  if (provider === 'idicore') {
    return Math.max(0, Number(process.env.IDICORE_MONTHLY_QUOTA ?? 12500) || 0)
  }
  if (provider === 'accurateappend') {
    return Math.max(0, Number(process.env.ACCURATE_APPEND_MONTHLY_QUOTA ?? 3333) || 0)
  }
  return 0
}

export function providerLabel(provider: SkipTraceProviderName): string {
  if (provider === 'idicore') return 'idiCORE'
  if (provider === 'accurateappend') return 'Accurate Append'
  return provider
}

export function remainingQuota(quota: number, used: number): number {
  return Math.max(0, quota - Math.max(0, used))
}

export function isQuotaProvider(
  value: unknown,
): value is SkipTraceProviderName {
  return value === 'idicore' || value === 'accurateappend'
}

export function parseQuotaProvider(value: unknown): SkipTraceProviderName | null {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'idicore' || raw === 'accurateappend') return raw
  return null
}

export function quotaBatchSize(): number {
  const n = Number(process.env.SKIP_TRACE_QUOTA_BATCH ?? 40)
  if (!Number.isFinite(n) || n <= 0) return 40
  return Math.min(80, Math.floor(n))
}

function splitOwnerName(ownerName: string) {
  const tokens = ownerName.trim().split(/\s+/).filter(Boolean)
  const lastName = tokens.length > 1 ? tokens[0] : ''
  const firstName = tokens.length > 1 ? tokens.slice(1).join(' ') : (tokens[0] ?? '')
  return enrichPersonTraceArgs({ ownerName, firstName, lastName })
}

async function loadUsage(
  admin: SupabaseClient,
  month: string,
  provider: SkipTraceProviderName,
): Promise<{ live_calls: number; hits: number }> {
  const { data } = await admin
    .from('skip_trace_provider_usage')
    .select('live_calls, hits')
    .eq('month', month)
    .eq('provider', provider)
    .maybeSingle()
  return {
    live_calls: Number(data?.live_calls ?? 0) || 0,
    hits: Number(data?.hits ?? 0) || 0,
  }
}

async function bumpUsage(
  admin: SupabaseClient,
  month: string,
  provider: SkipTraceProviderName,
  hit: boolean,
): Promise<void> {
  const current = await loadUsage(admin, month, provider)
  await admin.from('skip_trace_provider_usage').upsert(
    {
      month,
      provider,
      live_calls: current.live_calls + 1,
      hits: current.hits + (hit ? 1 : 0),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'month,provider' },
  )
}

/** Count a live idiCORE / Accurate Append call against prepaid monthly quota. */
export async function recordPrepaidProviderCall(
  provider: SkipTraceProviderName,
  hit: boolean,
  now = new Date(),
): Promise<void> {
  if (!isQuotaProvider(provider)) return
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  await bumpUsage(admin, quotaMonth(now), provider, hit)
}

async function attemptedKeys(
  admin: SupabaseClient,
  month: string,
  provider: SkipTraceProviderName,
): Promise<Set<string>> {
  const keys = new Set<string>()
  const { data } = await admin
    .from('skip_trace_quota_attempts')
    .select('owner_name')
    .eq('month', month)
    .eq('provider', provider)
    .limit(20000)
  for (const row of data ?? []) {
    const key = skipTraceOwnerKey(String((row as { owner_name?: string }).owner_name ?? ''))
    if (key) keys.add(key)
  }
  return keys
}

async function cachedWithPhone(
  admin: SupabaseClient,
  keys: string[],
): Promise<Set<string>> {
  const found = new Set<string>()
  if (keys.length === 0) return found
  const { data } = await admin
    .from('skip_trace_cache')
    .select('owner_name, phones')
    .in('owner_name', keys)
  for (const row of data ?? []) {
    const phones = (row as { phones?: string[] }).phones ?? []
    if (phones.some((p) => String(p ?? '').trim())) {
      found.add(skipTraceOwnerKey(String((row as { owner_name?: string }).owner_name ?? '')))
    }
  }
  return found
}

export function quotaCandidateAllowed(
  provider: SkipTraceProviderName,
  row: Pick<QuotaBurnCandidate, 'ownerName' | 'address' | 'city'>,
): boolean {
  if (!row.address && !row.city) return false
  const tokens = row.ownerName.trim().split(/\s+/).filter(Boolean)
  if (tokens.length < 2) return false
  if (provider === 'idicore' && isBusinessOwner(row.ownerName)) return false
  return true
}

function asCandidate(row: {
  owner_name?: string | null
  mailing_address?: string | null
  mailing_city?: string | null
  mailing_state?: string | null
  mailing_zip?: string | null
  id?: string | null
  county?: string | null
}): QuotaBurnCandidate | null {
  const ownerName = String(row.owner_name ?? '').trim()
  if (!ownerName) return null
  return {
    ownerName,
    address: String(row.mailing_address ?? '').trim(),
    city: String(row.mailing_city ?? '').trim(),
    state: String(row.mailing_state ?? '').trim(),
    zip: String(row.mailing_zip ?? '').trim(),
    dealId: row.id ?? null,
    county: row.county ?? null,
  }
}

async function nextCandidates(
  admin: SupabaseClient,
  job: QuotaJob,
  want: number,
): Promise<{ candidates: QuotaBurnCandidate[]; cadTableIndex: number; cadOffset: number }> {
  const skip = await attemptedKeys(admin, job.month, job.provider)
  const out: QuotaBurnCandidate[] = []
  const seen = new Set<string>(skip)

  const take = async (rows: QuotaBurnCandidate[]) => {
    const keys = rows.map((r) => skipTraceOwnerKey(r.ownerName)).filter(Boolean)
    const cached = await cachedWithPhone(admin, keys)
    for (const row of rows) {
      if (out.length >= want) return
      const key = skipTraceOwnerKey(row.ownerName)
      if (!key || seen.has(key) || cached.has(key)) continue
      if (!quotaCandidateAllowed(job.provider, row)) continue
      seen.add(key)
      out.push(row)
    }
  }

  const { data: deals } = await admin
    .from('deals')
    .select('id, owner_name, mailing_address, mailing_city, mailing_state, mailing_zip, phone, phones, county')
    .order('updated_at', { ascending: false })
    .limit(800)

  const dealRows = ((deals ?? []) as Array<Record<string, unknown>>)
    .filter((d) => !hasPhone({ phone: d.phone as string | null, phones: d.phones as string[] | null }))
    .map((d) => asCandidate(d as Parameters<typeof asCandidate>[0]))
    .filter((c): c is QuotaBurnCandidate => Boolean(c))
  await take(dealRows)
  if (out.length >= want) {
    return { candidates: out, cadTableIndex: job.cad_table_index, cadOffset: job.cad_offset }
  }

  let tableIndex = job.cad_table_index
  let offset = job.cad_offset
  let safety = 0
  while (out.length < want && tableIndex < CAD_TABLES.length && safety < 20) {
    safety += 1
    const table = CAD_TABLES[tableIndex]
    const { data, error } = await admin
      .from(table)
      .select('owner_name, mailing_address, mailing_city, mailing_state, mailing_zip')
      .not('owner_name', 'is', null)
      .not('mailing_address', 'is', null)
      .order('owner_name', { ascending: true })
      .range(offset, offset + 199)
    if (error) {
      console.error(`quota burn CAD ${table}:`, error.message)
      tableIndex += 1
      offset = 0
      continue
    }
    const rows = (data ?? []) as Array<Record<string, unknown>>
    if (rows.length === 0) {
      tableIndex += 1
      offset = 0
      continue
    }
    await take(
      rows
        .map((r) => asCandidate(r as Parameters<typeof asCandidate>[0]))
        .filter((c): c is QuotaBurnCandidate => Boolean(c)),
    )
    offset += rows.length
    if (rows.length < 200) {
      tableIndex += 1
      offset = 0
    }
  }

  return { candidates: out, cadTableIndex: tableIndex, cadOffset: offset }
}

async function recordAttempt(
  admin: SupabaseClient,
  month: string,
  provider: SkipTraceProviderName,
  ownerName: string,
  hit: boolean,
): Promise<boolean> {
  const key = skipTraceOwnerKey(ownerName)
  if (!key) return false
  const { error } = await admin.from('skip_trace_quota_attempts').insert({
    month,
    provider,
    owner_name: key,
    hit,
  })
  if (error) {
    if (String(error.message ?? '').toLowerCase().includes('duplicate')) return false
    if (error.code === '23505') return false
    console.error('quota attempt insert:', error.message)
    return false
  }
  return true
}

export async function quotaStatus(admin: SupabaseClient): Promise<QuotaProviderStatus[]> {
  const month = quotaMonth()
  const { data: jobs } = await admin
    .from('skip_trace_quota_jobs')
    .select('*')
    .eq('month', month)
    .in('status', ['queued', 'running', 'paused'])
    .order('updated_at', { ascending: false })

  const activeByProvider = new Map<string, QuotaJob>()
  for (const row of jobs ?? []) {
    const job = row as QuotaJob
    if (!activeByProvider.has(job.provider)) activeByProvider.set(job.provider, job)
  }

  const rows: QuotaProviderStatus[] = []
  for (const provider of QUOTA_PROVIDERS) {
    const usage = await loadUsage(admin, month, provider)
    const quota = providerQuota(provider)
    rows.push({
      provider,
      label: providerLabel(provider),
      quota,
      used: usage.live_calls,
      remaining: remainingQuota(quota, usage.live_calls),
      job: activeByProvider.get(provider) ?? null,
    })
  }
  return rows
}

export async function startQuotaJob(
  admin: SupabaseClient,
  input: { provider: SkipTraceProviderName; targetCount?: number; createdBy?: string | null },
): Promise<QuotaJob> {
  if (!QUOTA_PROVIDERS.includes(input.provider)) {
    throw new Error('Provider is not a prepaid quota target')
  }
  const month = quotaMonth()
  const { data: existing } = await admin
    .from('skip_trace_quota_jobs')
    .select('id, status')
    .eq('month', month)
    .eq('provider', input.provider)
    .in('status', ['queued', 'running', 'paused'])
    .maybeSingle()
  if (existing?.id) {
    throw new Error('A burn job is already running for this provider')
  }
  const usage = await loadUsage(admin, month, input.provider)
  const remaining = remainingQuota(providerQuota(input.provider), usage.live_calls)
  if (remaining <= 0) {
    throw new Error('No prepaid lookups left on this provider this month')
  }
  const target = Math.min(remaining, Math.max(1, Math.floor(input.targetCount ?? remaining)))
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('skip_trace_quota_jobs')
    .insert({
      provider: input.provider,
      status: 'running',
      month,
      target_count: target,
      processed: 0,
      hits: 0,
      misses: 0,
      skipped: 0,
      cad_table_index: 0,
      cad_offset: 0,
      created_by: input.createdBy ?? null,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single()
  if (error || !data) throw new Error(error?.message || 'Failed to start quota job')
  return data as QuotaJob
}

export async function setQuotaJobStatus(
  admin: SupabaseClient,
  jobId: string,
  status: QuotaJobStatus,
): Promise<QuotaJob | null> {
  const { data, error } = await admin
    .from('skip_trace_quota_jobs')
    .update({
      status,
      locked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .select('*')
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as QuotaJob | null) ?? null
}

export type QuotaBurnBatchResult = {
  ran: boolean
  jobId?: string
  provider?: SkipTraceProviderName
  processed: number
  hits: number
  misses: number
  skipped: number
}

async function claimQuotaJob(
  admin: SupabaseClient,
  job: QuotaJob,
): Promise<boolean> {
  const now = Date.now()
  if (job.locked_until && Date.parse(job.locked_until) > now) return false
  const nowIso = new Date(now).toISOString()
  const lockedUntil = new Date(now + 4 * 60_000).toISOString()
  const { data, error } = await admin
    .from('skip_trace_quota_jobs')
    .update({ locked_until: lockedUntil, updated_at: nowIso })
    .eq('id', job.id)
    .eq('status', 'running')
    .select('id')
    .maybeSingle()
  if (error) {
    console.error('quota job claim failed:', error.message)
    return false
  }
  return Boolean(data?.id)
}

export async function processQuotaBurnBatch(
  admin: SupabaseClient,
  options?: { limit?: number; jobId?: string },
): Promise<QuotaBurnBatchResult> {
  let query = admin.from('skip_trace_quota_jobs').select('*').eq('status', 'running')
  if (options?.jobId) query = query.eq('id', options.jobId)
  else query = query.order('updated_at', { ascending: true }).limit(1)
  const { data: jobRow } = await query.maybeSingle()
  if (!jobRow) return { ran: false, processed: 0, hits: 0, misses: 0, skipped: 0 }

  const job = jobRow as QuotaJob
  const claimed = await claimQuotaJob(admin, job)
  if (!claimed) return { ran: false, processed: 0, hits: 0, misses: 0, skipped: 0 }

  const usage = await loadUsage(admin, job.month, job.provider)
  const remaining = remainingQuota(providerQuota(job.provider), usage.live_calls)
  const leftOnJob = Math.max(0, job.target_count - job.processed)
  const budget = Math.min(remaining, leftOnJob, options?.limit ?? quotaBatchSize())
  if (budget <= 0) {
    await admin
      .from('skip_trace_quota_jobs')
      .update({
        status: 'done',
        locked_until: null,
        updated_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('id', job.id)
    return { ran: true, jobId: job.id, provider: job.provider, processed: 0, hits: 0, misses: 0, skipped: 0 }
  }

  const picked = await nextCandidates(admin, job, budget)
  let processed = 0
  let hits = 0
  let misses = 0
  let skipped = 0

  for (const candidate of picked.candidates) {
    if (processed + skipped >= budget) break
    const reserved = await recordAttempt(admin, job.month, job.provider, candidate.ownerName, false)
    if (!reserved) {
      skipped += 1
      continue
    }
    try {
      const args = splitOwnerName(candidate.ownerName)
      const chain = await runSkipTraceChain(
        {
          ...args,
          address: candidate.address,
          city: candidate.city,
          state: candidate.state,
          zip: candidate.zip,
        },
        { providers: [job.provider] },
      )
      const hit = chain.phones.length > 0
      processed += 1
      if (hit) hits += 1
      else misses += 1
      if (hit) {
        await applySkipTracePhones(admin, {
          ownerName: candidate.ownerName,
          mailingAddress: [candidate.address, candidate.city, candidate.state, candidate.zip]
            .filter(Boolean)
            .join(', '),
          phones: chain.phones,
          emails: chain.emails,
          source: `quota-${job.provider}`,
          dealId: candidate.dealId,
        })
        await admin
          .from('skip_trace_quota_attempts')
          .update({ hit: true })
          .eq('month', job.month)
          .eq('provider', job.provider)
          .eq('owner_name', skipTraceOwnerKey(candidate.ownerName))
      }
    } catch (err) {
      console.error('quota burn trace failed:', err)
      skipped += 1
    }
  }

  const nextProcessed = job.processed + processed
  const done =
    nextProcessed >= job.target_count ||
    remainingQuota(providerQuota(job.provider), usage.live_calls + processed) <= 0 ||
    (picked.candidates.length === 0 && processed === 0)
  const { data: latest } = await admin
    .from('skip_trace_quota_jobs')
    .select('status')
    .eq('id', job.id)
    .maybeSingle()
  const nextStatus = done ? 'done' : latest?.status === 'paused' ? 'paused' : 'running'

  await admin
    .from('skip_trace_quota_jobs')
    .update({
      processed: nextProcessed,
      hits: job.hits + hits,
      misses: job.misses + misses,
      skipped: job.skipped + skipped,
      cad_table_index: picked.cadTableIndex,
      cad_offset: picked.cadOffset,
      status: nextStatus,
      locked_until: null,
      last_error: picked.candidates.length === 0 && processed === 0 ? 'No uncached owners left to trace' : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id)

  return {
    ran: true,
    jobId: job.id,
    provider: job.provider,
    processed,
    hits,
    misses,
    skipped,
  }
}

export async function processQuotaBurnTick(
  admin: SupabaseClient,
  options?: { limit?: number },
): Promise<{ ran: boolean; jobs: QuotaBurnBatchResult[] }> {
  const { data: jobs } = await admin
    .from('skip_trace_quota_jobs')
    .select('id')
    .eq('status', 'running')
    .order('updated_at', { ascending: true })
  if (!jobs?.length) return { ran: false, jobs: [] }

  const total = options?.limit ?? quotaBatchSize()
  const perJob = Math.max(5, Math.floor(total / jobs.length))
  const results: QuotaBurnBatchResult[] = []
  for (const row of jobs) {
    const id = String((row as { id?: string }).id ?? '')
    if (!id) continue
    results.push(await processQuotaBurnBatch(admin, { limit: perJob, jobId: id }))
  }
  return { ran: results.some((row) => row.ran), jobs: results }
}
