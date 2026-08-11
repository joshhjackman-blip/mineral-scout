import { supabase } from '@/lib/supabase'
import { getWorkspaceContext } from '@/lib/workspace'

export type OwnerOverrideStatus = 'updated' | 'hidden' | 'incorrect'

export type OwnerOverride = {
  id?: number
  team_owner_id?: string
  county_id: string
  owner_name: string
  abstract: string
  status: OwnerOverrideStatus
  display_name?: string | null
  mailing_address?: string | null
  mailing_city?: string | null
  mailing_state?: string | null
  mailing_zip?: string | null
  phone?: string | null
  email?: string | null
  note?: string | null
  updated_at?: string | null
}

export type OwnerDetailsPatch = {
  display_name?: string | null
  mailing_address?: string | null
  mailing_city?: string | null
  mailing_state?: string | null
  mailing_zip?: string | null
  phone?: string | null
  email?: string | null
  note?: string | null
}

export function bareAbstract(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .replace(/^A-\s*/i, '')
    .toUpperCase()
}

export function ownerNameKey(raw: string | null | undefined): string {
  return String(raw || '').trim().toUpperCase()
}

/** True when an override should hide the owner from the working tract list. */
export function isHiddenOverride(
  override: OwnerOverride | null | undefined,
): boolean {
  if (!override) return false
  return override.status === 'hidden' || override.status === 'incorrect'
}

/**
 * Pick the most specific override for an owner on a tract:
 * exact abstract match wins, else county-wide (abstract '').
 */
export function pickOwnerOverride(
  overrides: OwnerOverride[],
  ownerName: string,
  tractAbstract?: string | null,
): OwnerOverride | null {
  const name = ownerNameKey(ownerName)
  if (!name) return null
  const bare = bareAbstract(tractAbstract)
  let countyWide: OwnerOverride | null = null
  for (const row of overrides) {
    if (ownerNameKey(row.owner_name) !== name) continue
    const rowBare = bareAbstract(row.abstract)
    if (bare && rowBare && rowBare === bare) return row
    if (!rowBare) countyWide = row
  }
  return countyWide
}

export function applyOwnerOverride<T extends {
  owner_name: string
  display_name?: string | null
  mailing_address?: string | null
  address_1?: string | null
  mailing_city?: string | null
  mailing_state?: string | null
  mailing_zip?: string | null
  phone?: string | null
  email?: string | null
}>(owner: T, override: OwnerOverride | null | undefined): T {
  if (!override) return owner
  // Keep owner_name as the CAD identity key (leases/wells/notes join on it).
  // Surface a corrected label via display_name only.
  return {
    ...owner,
    display_name: override.display_name?.trim() || owner.display_name || null,
    mailing_address:
      override.mailing_address ?? owner.mailing_address ?? owner.address_1 ?? null,
    address_1: override.mailing_address ?? owner.address_1 ?? owner.mailing_address ?? null,
    mailing_city: override.mailing_city ?? owner.mailing_city ?? null,
    mailing_state: override.mailing_state ?? owner.mailing_state ?? null,
    mailing_zip: override.mailing_zip ?? owner.mailing_zip ?? null,
    phone: override.phone ?? owner.phone ?? null,
    email: override.email ?? owner.email ?? null,
  }
}

export async function fetchOwnerOverrides(
  countyId: string,
): Promise<{ data: OwnerOverride[]; error: string | null }> {
  const workspace = await getWorkspaceContext()
  if (!workspace) {
    return { data: [], error: 'Not signed in' }
  }

  const { data, error } = await supabase
    .from('owner_overrides')
    .select('*')
    .eq('county_id', countyId)
    .eq('team_owner_id', workspace.workspaceId)

  if (error) {
    return { data: [], error: error.message }
  }
  return { data: (data as OwnerOverride[]) ?? [], error: null }
}

export async function upsertOwnerOverride(input: {
  countyId: string
  ownerName: string
  abstract?: string | null
  status: OwnerOverrideStatus
  patch?: OwnerDetailsPatch
}): Promise<{ data: OwnerOverride | null; error: string | null }> {
  const workspace = await getWorkspaceContext()
  if (!workspace) {
    return { data: null, error: 'Not signed in' }
  }

  const abstract = bareAbstract(input.abstract)
  const payload = {
    team_owner_id: workspace.workspaceId,
    county_id: input.countyId,
    owner_name: String(input.ownerName || '').trim(),
    abstract,
    status: input.status,
    display_name: input.patch?.display_name?.trim() || null,
    mailing_address: input.patch?.mailing_address?.trim() || null,
    mailing_city: input.patch?.mailing_city?.trim() || null,
    mailing_state: input.patch?.mailing_state?.trim() || null,
    mailing_zip: input.patch?.mailing_zip?.trim() || null,
    phone: input.patch?.phone?.trim() || null,
    email: input.patch?.email?.trim() || null,
    note: input.patch?.note?.trim() || null,
    updated_at: new Date().toISOString(),
  }

  if (!payload.owner_name) {
    return { data: null, error: 'Owner name is required' }
  }

  const { data, error } = await supabase
    .from('owner_overrides')
    .upsert(payload, {
      onConflict: 'team_owner_id,county_id,owner_name,abstract',
    })
    .select('*')
    .single()

  if (error) {
    return { data: null, error: error.message }
  }
  return { data: data as OwnerOverride, error: null }
}

export async function deleteOwnerOverride(input: {
  countyId: string
  ownerName: string
  abstract?: string | null
}): Promise<{ error: string | null }> {
  const workspace = await getWorkspaceContext()
  if (!workspace) {
    return { error: 'Not signed in' }
  }

  const abstract = bareAbstract(input.abstract)
  const { error } = await supabase
    .from('owner_overrides')
    .delete()
    .eq('team_owner_id', workspace.workspaceId)
    .eq('county_id', input.countyId)
    .eq('owner_name', String(input.ownerName || '').trim())
    .eq('abstract', abstract)

  return { error: error?.message ?? null }
}

/**
 * Also mirror contact edits onto a CRM deal when one exists for this
 * owner+county in THIS workspace, so Skip Trace / CRM stay in sync.
 */
export async function mirrorOverrideToDeal(input: {
  countyId: string
  ownerName: string
  patch: OwnerDetailsPatch
  tag?: string | null
}): Promise<void> {
  const workspace = await getWorkspaceContext()
  if (!workspace) return

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  // Never rename deal.owner_name — CAD name is the join key for
  // holdings / wells. Display-name corrections live in owner_overrides.
  if (input.patch.mailing_address !== undefined) {
    update.mailing_address = input.patch.mailing_address
  }
  if (input.patch.mailing_city !== undefined) {
    update.mailing_city = input.patch.mailing_city
  }
  if (input.patch.mailing_state !== undefined) {
    update.mailing_state = input.patch.mailing_state
  }
  if (input.patch.mailing_zip !== undefined) {
    update.mailing_zip = input.patch.mailing_zip
  }
  if (input.patch.phone !== undefined) update.phone = input.patch.phone
  if (input.patch.email !== undefined) update.email = input.patch.email
  if (input.tag) update.tag = input.tag

  await supabase
    .from('deals')
    .update(update)
    .eq('team_owner_id', workspace.workspaceId)
    .eq('county', input.countyId)
    .ilike('owner_name', input.ownerName)
}
