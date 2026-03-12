import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import type { SupabaseClient } from "@supabase/supabase-js"

type CreateTestUserPayload = {
  email?: string
  password?: string
  pharmacyName?: string
}

async function findUserIdByEmail(
  adminClient: SupabaseClient,
  email: string
): Promise<string | null> {
  const { data, error } = await adminClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })

  if (error || !data?.users) {
    return null
  }

  const match = data.users.find((user) => (user.email ?? "").toLowerCase() === email)
  return match?.id ?? null
}

async function ensureOrganizationMembership(
  adminClient: SupabaseClient,
  userId: string,
  pharmacyName: string
): Promise<string> {
  const existingMembership = await adminClient
    .from("organization_members")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)

  const existingMembershipRows = existingMembership.data as Array<{ org_id: string }> | null
  if (existingMembershipRows?.[0]?.org_id) {
    return existingMembershipRows[0].org_id
  }

  const existingOrg = await adminClient
    .from("organizations")
    .select("id")
    .eq("name", pharmacyName)
    .limit(1)

  const existingOrgRows = existingOrg.data as Array<{ id: string }> | null
  let organizationId = existingOrgRows?.[0]?.id
  if (!organizationId) {
    const createdOrg = await adminClient
      .from("organizations")
      .insert({ name: pharmacyName })
      .select("id")
      .single()
    if (createdOrg.error || !createdOrg.data?.id) {
      throw new Error(createdOrg.error?.message ?? "Unable to create organization.")
    }
    organizationId = createdOrg.data.id
  }

  if (!organizationId) {
    throw new Error("Unable to resolve organization for membership.")
  }

  const resolvedOrganizationId = organizationId

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const membershipExists = await adminClient
      .from("organization_members")
      .select("id")
      .eq("user_id", userId)
      .eq("org_id", resolvedOrganizationId)
      .limit(1)

    const membershipRows = membershipExists.data as Array<{ id: string }> | null
    if (membershipRows?.length) {
      return resolvedOrganizationId
    }

    const membershipInsert = await adminClient.from("organization_members").insert({
      user_id: userId,
      org_id: resolvedOrganizationId,
      role: "owner",
    })

    if (!membershipInsert.error) {
      return resolvedOrganizationId
    }

    if (
      membershipInsert.error.code === "23503" &&
      attempt < 3
    ) {
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
      continue
    }

    throw new Error(membershipInsert.error.message)
  }

  throw new Error("Unable to create organization membership.")
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { success: false, data: null, error: "This endpoint is only available in development." },
      { status: 403 }
    )
  }

  let payload: CreateTestUserPayload = {}
  try {
    payload = (await request.json()) as CreateTestUserPayload
  } catch {
    return NextResponse.json(
      { success: false, data: null, error: "Invalid request payload." },
      { status: 400 }
    )
  }

  const email = payload.email?.trim().toLowerCase() ?? ""
  const password = payload.password ?? ""
  const pharmacyName = payload.pharmacyName?.trim() ?? "Development Test Pharmacy"

  if (!email || !password) {
    return NextResponse.json(
      { success: false, data: null, error: "Email and password are required." },
      { status: 400 }
    )
  }

  if (password.length < 8) {
    return NextResponse.json(
      { success: false, data: null, error: "Password must be at least 8 characters." },
      { status: 400 }
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { success: false, data: null, error: "Server is missing Supabase configuration." },
      { status: 500 }
    )
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  let userId: string | null = null
  let existingUser = false

  const createdUser = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      pharmacy_name: pharmacyName,
      seeded_by: "dev-create-test-user-endpoint",
    },
  })

  if (createdUser.error) {
    const message = createdUser.error.message.toLowerCase()
    if (message.includes("already been registered") || message.includes("already exists")) {
      existingUser = true
      userId = await findUserIdByEmail(adminClient, email)
      if (!userId) {
        return NextResponse.json(
          { success: false, data: null, error: "User exists but could not be loaded." },
          { status: 500 }
        )
      }
    } else {
      return NextResponse.json(
        { success: false, data: null, error: createdUser.error.message },
        { status: 400 }
      )
    }
  } else {
    userId = createdUser.data.user?.id ?? null
  }

  if (!userId) {
    return NextResponse.json(
      { success: false, data: null, error: "Unable to create test user." },
      { status: 500 }
    )
  }

  try {
    const organizationId = await ensureOrganizationMembership(adminClient, userId, pharmacyName)
    return NextResponse.json({
      success: true,
      data: { userId, organizationId, existingUser },
      error: null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create organization membership."
    return NextResponse.json({ success: false, data: null, error: message }, { status: 500 })
  }
}
