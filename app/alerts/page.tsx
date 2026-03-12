import { AlertsFeedList } from "@/components/alerts/alerts-feed-list"
import { AlertsFilterBar } from "@/components/alerts/alerts-filter-bar"
import { createClient } from "@/lib/supabase/server"

type AlertsPageProps = {
  searchParams?: {
    type?: string | string[]
    status?: string | string[]
    from?: string | string[]
    to?: string | string[]
  }
}

type ActionRow = {
  id: string
  supplier_id: string | null
  action_type: string
  status: string | null
  issue_date: string | null
  title: string | null
  description: string | null
  source_url: string | null
  created_at: string | null
}

function getSingleValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

export default async function AlertsPage({ searchParams }: AlertsPageProps) {
  const supabase = await createClient()
  const typeFilter = getSingleValue(searchParams?.type) ?? "all"
  const statusFilter = getSingleValue(searchParams?.status) ?? "all"
  const fromFilter = getSingleValue(searchParams?.from)
  const toFilter = getSingleValue(searchParams?.to)

  let query = supabase
    .from("fda_actions")
    .select("id,supplier_id,action_type,status,issue_date,title,description,source_url,created_at")
    .order("issue_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })

  if (typeFilter !== "all") {
    query = query.eq("action_type", typeFilter)
  }

  if (statusFilter === "active") {
    query = query.eq("status", "active")
  } else if (statusFilter === "resolved") {
    query = query.in("status", ["resolved", "closed"])
  }

  if (fromFilter) {
    query = query.gte("issue_date", fromFilter)
  }
  if (toFilter) {
    query = query.lte("issue_date", toFilter)
  }

  const { data, error } = await query

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">FDA Alerts Feed</h1>
        <p className="text-sm text-destructive">Could not load FDA actions: {error.message}</p>
      </div>
    )
  }

  const actions = (data ?? []) as ActionRow[]
  const supplierIds = Array.from(
    new Set(actions.map((action) => action.supplier_id).filter((id): id is string => Boolean(id)))
  )

  let supplierMap: Record<string, string> = {}
  if (supplierIds.length > 0) {
    const suppliersResponse = await supabase
      .from("suppliers")
      .select("id,name")
      .in("id", supplierIds)
    const supplierRows = suppliersResponse.data ?? []
    supplierMap = supplierRows.reduce<Record<string, string>>((acc, row) => {
      if (row.id && row.name) {
        acc[row.id] = row.name
      }
      return acc
    }, {})
  }

  const feedItems = actions.map((action) => ({
    id: action.id,
    supplier_id: action.supplier_id,
    supplier_name: action.supplier_id ? supplierMap[action.supplier_id] ?? null : null,
    action_type: action.action_type,
    status: action.status,
    issue_date: action.issue_date,
    title: action.title,
    description: action.description,
    source_url: action.source_url,
  }))

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">FDA Alerts Feed</h1>
      </div>

      <AlertsFilterBar />
      <AlertsFeedList items={feedItems} />
    </div>
  )
}
