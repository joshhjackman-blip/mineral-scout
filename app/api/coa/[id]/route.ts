import { NextResponse } from "next/server"
import { SupabaseClient, createClient } from "@supabase/supabase-js"

import { createClient as createServerSupabaseClient } from "@/lib/supabase/server"

type PatchPayload = {
  supplierId?: string | null
  status?: "pending" | "extracted" | "verified" | "expired"
}

type Params = {
  params: {
    id: string
  }
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

export async function PATCH(request: Request, { params }: Params) {
  const coaId = params.id
  if (!coaId) {
    return NextResponse.json(
      { success: false, data: null, error: "Document ID is required." },
      { status: 400 }
    )
  }

  let payload: PatchPayload = {}
  try {
    payload = (await request.json()) as PatchPayload
  } catch {
    return NextResponse.json(
      { success: false, data: null, error: "Invalid request payload." },
      { status: 400 }
    )
  }

  const hasSupplierPatch = Object.prototype.hasOwnProperty.call(payload, "supplierId")
  const hasStatusPatch = Object.prototype.hasOwnProperty.call(payload, "status")
  if (!hasSupplierPatch && !hasStatusPatch) {
    return NextResponse.json(
      { success: false, data: null, error: "At least one patch field is required." },
      { status: 400 }
    )
  }

  if (
    hasStatusPatch &&
    payload.status &&
    !["pending", "extracted", "verified", "expired"].includes(payload.status)
  ) {
    return NextResponse.json(
      { success: false, data: null, error: "Invalid status value." },
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

    const existingQuery = await adminClient
      .from("coa_documents")
      .select("id,org_id")
      .eq("id", coaId)
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

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (hasSupplierPatch) {
      const supplierId = payload.supplierId?.trim()
      if (!supplierId) {
        updates.supplier_id = null
      } else {
        const supplierQuery = await adminClient
          .from("suppliers")
          .select("id")
          .eq("id", supplierId)
          .limit(1)
          .maybeSingle()

        const supplier = supplierQuery.data as { id: string } | null
        if (supplierQuery.error || !supplier?.id) {
          return NextResponse.json(
            { success: false, data: null, error: "Selected supplier was not found." },
            { status: 400 }
          )
        }
        updates.supplier_id = supplier.id
      }
    }

    if (hasStatusPatch && payload.status) {
      updates.status = payload.status
    }

    const { data: updatedDocument, error: updateError } = await adminClient
      .from("coa_documents")
      .update(updates)
      .eq("id", coaId)
      .eq("org_id", orgId)
      .select("id,supplier_id,status,suppliers(id,name)")
      .single()

    if (updateError || !updatedDocument) {
      return NextResponse.json(
        { success: false, data: null, error: updateError?.message ?? "Failed to update document." },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: updatedDocument,
      error: null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error."
    return NextResponse.json({ success: false, data: null, error: message }, { status: 500 })
  }
}
