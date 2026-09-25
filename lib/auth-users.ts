import type { SupabaseClient, User } from '@supabase/supabase-js'

export async function listAuthUsers(adminClient: SupabaseClient): Promise<User[]> {
  const users: User[] = []
  let page = 1
  const perPage = 1000
  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const batch = data?.users ?? []
    users.push(...batch)
    if (batch.length < perPage) break
    page += 1
  }
  return users
}

export async function findUserByEmail(
  adminClient: SupabaseClient,
  email: string,
): Promise<User | null> {
  const needle = email.toLowerCase().trim()
  if (!needle) return null
  const users = await listAuthUsers(adminClient)
  return users.find((u) => (u.email ?? '').toLowerCase() === needle) ?? null
}

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
}
