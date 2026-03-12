import { NextResponse } from "next/server"
import { SupabaseClient, createClient } from "@supabase/supabase-js"

import { createClient as createServerSupabaseClient } from "@/lib/supabase/server"

type CreateCoaDocumentPayload = {
  fileName?: string
  filePath?: string
  supplierId?: string | null
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

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
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

    const { data, error } = await adminClient
      .from("coa_documents")
      .select(
        "id,file_name,file_path,compound_name,lot_number,expiry_date,status,supplier_id,created_at,suppliers(name)"
      )
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })

    if (error) {
      return NextResponse.json(
        { success: false, data: null, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        orgId,
        documents: data ?? [],
      },
      error: null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error."
    return NextResponse.json({ success: false, data: null, error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  let payload: CreateCoaDocumentPayload = {}
  try {
    payload = (await request.json()) as CreateCoaDocumentPayload
  } catch {
    return NextResponse.json(
      { success: false, data: null, error: "Invalid request payload." },
      { status: 400 }
    )
  }

  const fileName = payload.fileName?.trim() ?? ""
  const filePath = payload.filePath?.trim() ?? ""

  if (!fileName || !filePath) {
    return NextResponse.json(
      { success: false, data: null, error: "fileName and filePath are required." },
      { status: 400 }
    )
  }

  try {
    const supabase = await createServerSupabaseClient()
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

    const { data: insertedRow, error: insertError } = await adminClient
      .from("coa_documents")
      .insert({
        org_id: orgId,
        supplier_id: payload.supplierId ?? null,
        file_name: fileName,
        file_path: filePath,
        uploaded_by: user.id,
        status: "pending",
      })
      .select(
        "id,file_name,file_path,compound_name,lot_number,expiry_date,status,supplier_id,created_at,suppliers(name)"
      )
      .single()

    if (insertError || !insertedRow) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: insertError?.message ?? "Failed to create COA document row.",
        },
        { status: 500 }
      )
    }

    // Placeholder extraction step to keep product flow moving until full AI extraction is wired.
    const extractionSummary = {
      extraction_status: "placeholder_complete",
      extracted_at: new Date().toISOString(),
      source: "coa-upload-placeholder",
    }

    const { data: updatedRow, error: updateError } = await adminClient
      .from("coa_documents")
      .update({
        status: "extracted",
        analysis_results: extractionSummary,
        updated_at: new Date().toISOString(),
      })
      .eq("id", insertedRow.id)
      .select(
        "id,file_name,file_path,compound_name,lot_number,expiry_date,status,supplier_id,created_at,suppliers(name)"
      )
      .single()

    if (updateError || !updatedRow) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: updateError?.message ?? "Failed to update COA extraction status.",
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        orgId,
        document: updatedRow,
      },
      error: null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error."
    return NextResponse.json({ success: false, data: null, error: message }, { status: 500 })
  }
}
