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

  const { error: memberError } = await adminClient.from("organization_members").insert({
    user_id: userId,
    org_id: orgData.id,
    role: "owner",
  })

  if (memberError) {
    await adminClient.from("organizations").delete().eq("id", orgData.id)
    return NextResponse.json(
      { success: false, data: null, error: memberError.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    data: { userId, organizationId: orgData.id },
    error: null,
  })
}
