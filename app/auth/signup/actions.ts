"use server"

import { headers } from "next/headers"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"

import { createClient } from "@/lib/supabase/server"

type SignupWithOrganizationInput = {
  email: string
  password: string
  pharmacyName: string
}

type SignupWithOrganizationResult = {
  success: boolean
  error: string | null
}

export async function signupWithOrganization(
  input: SignupWithOrganizationInput
): Promise<SignupWithOrganizationResult> {
  const email = input.email.trim().toLowerCase()
  const pharmacyName = input.pharmacyName.trim()
  const password = input.password

  if (!email || !password || !pharmacyName) {
    return { success: false, error: "All fields are required." }
  }

  if (password.length < 8) {
    return { success: false, error: "Password must be at least 8 characters." }
  }

  const supabase = createClient()
  const origin = headers().get("origin")

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: origin ? `${origin}/auth/login` : undefined,
    },
  })

  if (error) {
    return { success: false, error: error.message }
  }

  const userId = data.user?.id
  if (!userId) {
    return { success: false, error: "Unable to create user account." }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      success: false,
      error: "Server is missing Supabase configuration.",
    }
  }

  // Service role is used to guarantee org creation during email-confirmation flows.
  const adminClient = createSupabaseClient(supabaseUrl, serviceRoleKey, {
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
    return {
      success: false,
      error: orgError?.message ?? "Unable to create organization.",
    }
  }

  const { error: memberError } = await adminClient.from("organization_members").insert({
    user_id: userId,
    org_id: orgData.id,
    role: "owner",
  })

  if (memberError) {
    await adminClient.from("organizations").delete().eq("id", orgData.id)
    return {
      success: false,
      error: memberError.message,
    }
  }

  return {
    success: true,
    error: null,
  }
}
