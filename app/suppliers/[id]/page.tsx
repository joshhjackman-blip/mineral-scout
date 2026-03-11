import { redirect } from "next/navigation"

import { SupplierProfile } from "@/components/suppliers/supplier-profile"
import { createClient } from "@/lib/supabase/server"

type SupplierDetailPageProps = {
  params: { id: string }
}

export default async function SupplierDetailPage({ params }: SupplierDetailPageProps) {
  const supabase = createClient()
  const { data: supplier } = await supabase
    .from("suppliers")
    .select(
      "id,name,country,city,fda_registration_number,fda_registered,primary_compounds,risk_score,notes"
    )
    .eq("id", params.id)
    .single()

  if (!supplier) {
    redirect("/suppliers?notFound=1")
  }

  const [{ data: shipmentsData }, { data: actionsData }] = await Promise.all([
    supabase
      .from("shipments")
      .select(
        "id,arrival_date,country_of_origin,port_of_entry,consignee_name,description,weight_kg,container_count"
      )
      .eq("supplier_id", params.id),
    supabase
      .from("fda_actions")
      .select("id,action_type,issue_date,status,title,description,source_url")
      .eq("supplier_id", params.id),
  ])

  return (
    <SupplierProfile
      supplier={supplier}
      shipments={shipmentsData ?? []}
      actions={actionsData ?? []}
    />
  )
}
