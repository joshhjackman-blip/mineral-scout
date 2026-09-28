export function skipTraceOwnerKey(ownerName: string | null | undefined): string {
  return String(ownerName ?? '')
    .trim()
    .toUpperCase()
}

export type SkipTraceContacts = {
  phones: string[]
  emails: string[]
}

type CacheRow = {
  owner_name?: string | null
  phones?: string[] | null
  emails?: string[] | null
}

function cleanList(values: string[] | null | undefined): string[] {
  const out: string[] = []
  for (const value of values ?? []) {
    const normalized = String(value ?? '').trim()
    if (normalized && !out.includes(normalized)) out.push(normalized)
  }
  return out
}

/** Index skip_trace_cache rows by the shared owner-name key. */
export function indexSkipTraceCache(
  rows: CacheRow[],
): Map<string, SkipTraceContacts> {
  const byKey = new Map<string, SkipTraceContacts>()
  for (const row of rows) {
    const key = skipTraceOwnerKey(row.owner_name)
    if (!key) continue
    byKey.set(key, {
      phones: cleanList(row.phones),
      emails: cleanList(row.emails),
    })
  }
  return byKey
}

/**
 * Stamp cached phones/emails onto owner rows so the same lead shows
 * contact info on every tract without a second paid skip-trace.
 */
export function mergeSkipTraceCache<T extends { owner_name?: string | null }>(
  owners: T[],
  cacheRows: CacheRow[],
): Array<
  T & {
    phone: string | null
    email: string | null
    phones: string[]
    emails: string[]
  }
> {
  const byKey = indexSkipTraceCache(cacheRows)
  return owners.map((owner) => {
    const hit = byKey.get(skipTraceOwnerKey(owner.owner_name))
    const phones = hit?.phones ?? []
    const emails = hit?.emails ?? []
    return {
      ...owner,
      phones,
      emails,
      phone: phones[0] ?? null,
      email: emails[0] ?? null,
    }
  })
}
