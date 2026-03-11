import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

type SignupPayload = {
  email?: string
  password?: string
  pharmacyName?: string
}

export async function POST(request: Request) {
  let payload: SignupPayload = {}
  try {
    payload = (await request.json()) as SignupPayload
  } catch {
    return NextResponse.json(
      { success: false, data: null, error: "Invalid request payload." },
      { status: 400 }
    )
  }

  const email = payload.email?.trim().toLowerCase() ?? ""
  const password = payload.password ?? ""
  const pharmacyName = payload.pharmacyName?.trim() ?? ""

  if (!email || !password || !pharmacyName) {
    return NextResponse.json(
      { success: false, data: null, error: "All fields are required." },
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
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json(
      { success: false, data: null, error: "Server is missing Supabase configuration." },
      { status: 500 }
    )
  }

  const origin = headers().get("origin")

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const { data: signupData, error: signupError } = await authClient.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: origin ? `${origin}/auth/login` : undefined,
    },
  })

  if (signupError) {
    return NextResponse.json(
      { success: false, data: null, error: signupError.message },
      { status: 400 }
    )
  }

  const userId = signupData.user?.id
  if (!userId) {
    return NextResponse.json(
      { success: false, data: null, error: "Unable to create user account." },
      { status: 500 }
    )
  }

  const identitiesCount = signupData.user.identities?.length ?? 0
  const isExistingUserSignupResponse = identitiesCount === 0

  // Supabase can return a sanitized user object for already-registered emails.
  // In that case we should not create a new organization/member row.
  if (isExistingUserSignupResponse) {
    return NextResponse.json({
      success: true,
      data: { userId, existingUser: true, organizationId: null },
      error: null,
    })
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const { data: orgData, error: orgError } = await adminClient
    .from("organizations")
    .insert({ name: pharmacyName })
    .select("id")
    .single()

  if (orgError || !orgData) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: orgError?.message ?? "Unable to create organization.",
      },
      { status: 500 }
    )
  }

  let memberInsertError: { message: string; code?: string } | null = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { error: memberError } = await adminClient.from("organization_members").insert({
      user_id: userId,
      org_id: orgData.id,
      role: "owner",
    })

    if (!memberError) {
      memberInsertError = null
      break
    }

    memberInsertError = {
      message: memberError.message,
      code: "code" in memberError ? String(memberError.code) : undefined,
    }

    // Rarely, auth user replication can lag briefly behind signup completion.
    if (memberInsertError.code === "23503" && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
      continue
    }
    break
  }

  if (memberInsertError) {
    await adminClient.from("organizations").delete().eq("id", orgData.id)
    return NextResponse.json(
      { success: false, data: null, error: memberInsertError.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    data: { userId, organizationId: orgData.id },
    error: null,
  })
}
