import { NextResponse } from "next/server"
import { SupabaseClient, createClient } from "@supabase/supabase-js"

import { createClient as createServerSupabaseClient } from "@/lib/supabase/server"

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Server is missing Supabase configuration.")
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

async function getUserOrgId(adminClient: SupabaseClient, userId: string) {
  const membershipQuery = await adminClient
    .from("organization_members")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle()

  const membership = membershipQuery.data as { org_id: string } | null
  if (membershipQuery.error || !membership?.org_id) {
    return null
  }
  return membership.org_id
}

type Params = {
  params: {
    id: string
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const id = params.id
  if (!id) {
    return NextResponse.json(
      { success: false, data: null, error: "Document ID is required." },
      { status: 400 }
    )
  }

  try {
    const supabase = createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { success: false, data: null, error: "Unauthorized." },
        { status: 401 }
      )
    }

    const adminClient = getAdminClient()
    const orgId = await getUserOrgId(adminClient, user.id)
    if (!orgId) {
      return NextResponse.json(
        { success: false, data: null, error: "No organization membership found." },
        { status: 403 }
      )
    }

    const existingQuery = await adminClient
      .from("coa_documents")
      .select("id,org_id")
      .eq("id", id)
      .limit(1)
      .maybeSingle()

    const existing = existingQuery.data as { id: string; org_id: string } | null

    if (existingQuery.error || !existing) {
      return NextResponse.json(
        { success: false, data: null, error: "Document not found." },
        { status: 404 }
      )
    }

    if (existing.org_id !== orgId) {
      return NextResponse.json(
        { success: false, data: null, error: "Forbidden." },
        { status: 403 }
      )
    }

    const { error: deleteError } = await adminClient.from("coa_documents").delete().eq("id", id)
    if (deleteError) {
      return NextResponse.json(
        { success: false, data: null, error: deleteError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: { id },
      error: null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error."
    return NextResponse.json({ success: false, data: null, error: message }, { status: 500 })
  }
}
