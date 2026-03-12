import { redirect } from "next/navigation"
import { SupabaseClient, createClient } from "@supabase/supabase-js"

import { CoaDetailClient } from "@/components/coa/coa-detail-client"
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server"

type CoaDetailPageProps = {
  params: {
    id: string
  }
}

type CoaSupplierRelation = { id?: string | null; name?: string | null } | Array<{ id?: string | null; name?: string | null }> | null

type CoaDetailRecord = {
  id: string
  file_name: string
  file_path: string
  created_at: string
  status: "pending" | "extracted" | "verified" | "expired"
  compound_name: string | null
  lot_number: string | null
  manufacture_date: string | null
  expiry_date: string | null
  supplier_id: string | null
  suppliers: CoaSupplierRelation
  analysis_results: Record<string, unknown> | null
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

function normalizeSupplierRelation(value: CoaSupplierRelation): { id?: string | null; name?: string | null } | null {
  if (!value) return null
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

export default async function CoaDetailPage({ params }: CoaDetailPageProps) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  const adminClient = getAdminClient()
  const orgId = await getUserOrgId(adminClient, user.id)
  if (!orgId) {
    redirect("/coa")
  }

  const documentQuery = await adminClient
    .from("coa_documents")
    .select(
      "id,file_name,file_path,created_at,status,compound_name,lot_number,manufacture_date,expiry_date,supplier_id,analysis_results,suppliers(id,name)"
    )
    .eq("id", params.id)
    .eq("org_id", orgId)
    .limit(1)
    .maybeSingle()

  const document = documentQuery.data as CoaDetailRecord | null
  if (documentQuery.error || !document) {
    redirect("/coa")
  }

  const suppliersQuery = await adminClient
    .from("suppliers")
    .select("id,name")
    .order("name", { ascending: true })

  const suppliers = (suppliersQuery.data ?? []) as Array<{ id: string; name: string }>

  const signedUrlResponse = await adminClient.storage
    .from("coa-documents")
    .createSignedUrl(document.file_path, 60 * 60)
  const signedUrl = signedUrlResponse.data?.signedUrl ?? null

  return (
    <CoaDetailClient
      document={{
        ...document,
        suppliers: normalizeSupplierRelation(document.suppliers),
      }}
      suppliers={suppliers}
      signedUrl={signedUrl}
    />
  )
}
