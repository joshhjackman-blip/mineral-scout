import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export type EmailSendKind = 'team_invite' | 'demo_booking' | 'help_ticket' | 'other'
export type UsageEventType = 'call_clicked' | 'email_clicked' | 'other'

/** Best-effort Resend send log for the admin Usage tab (server). */
export async function logEmailSend(
  client: SupabaseClient,
  input: {
    kind: EmailSendKind
    toEmail: string
    userId?: string | null
    meta?: Record<string, unknown>
  },
): Promise<void> {
  try {
    const { error } = await client.from('email_send_log').insert({
      kind: input.kind,
      to_email: input.toEmail.toLowerCase().trim(),
      user_id: input.userId ?? null,
      meta: input.meta ?? {},
    })
    if (error) console.error('logEmailSend failed:', error.message)
  } catch (err) {
    console.error('logEmailSend failed:', err)
  }
}

/** Best-effort usage event insert (server). */
export async function logUsageEventWithClient(
  client: SupabaseClient,
  input: {
    eventType: UsageEventType
    userId?: string | null
    countyId?: string | null
    ownerName?: string | null
    meta?: Record<string, unknown>
  },
): Promise<void> {
  try {
    const { error } = await client.from('usage_events').insert({
      event_type: input.eventType,
      user_id: input.userId ?? null,
      county_id: input.countyId ?? null,
      owner_name: input.ownerName ?? null,
      meta: input.meta ?? {},
    })
    if (error) console.error('logUsageEvent failed:', error.message)
  } catch (err) {
    console.error('logUsageEvent failed:', err)
  }
}

/** Browser-side call/email click logging via anon supabase client. */
export async function logUsageEvent(input: {
  eventType: UsageEventType
  userId?: string | null
  countyId?: string | null
  ownerName?: string | null
  meta?: Record<string, unknown>
}): Promise<void> {
  return logUsageEventWithClient(supabase, input)
}
