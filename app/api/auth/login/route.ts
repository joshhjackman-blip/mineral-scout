import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

type LoginPayload = {
  email?: string
  password?: string
}

export async function POST(request: NextRequest) {
  let payload: LoginPayload = {}
  try {
    payload = (await request.json()) as LoginPayload
  } catch {
    return NextResponse.json(
      { success: false, data: null, error: "Invalid request payload." },
      { status: 400 }
    )
  }

  const email = payload.email?.trim().toLowerCase() ?? ""
  const password = payload.password ?? ""

  if (!email || !password) {
    return NextResponse.json(
      { success: false, data: null, error: "Email and password are required." },
      { status: 400 }
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { success: false, data: null, error: "Server is missing Supabase configuration." },
      { status: 500 }
    )
  }

  const response = NextResponse.json({
    success: true,
    data: null,
    error: null,
  })

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error || !data.session) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: error?.message ?? "Invalid login credentials.",
      },
      { status: 401 }
    )
  }

  return response
}
