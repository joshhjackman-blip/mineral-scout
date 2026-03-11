import Link from "next/link"
import { AlertTriangleIcon, Building2Icon, Clock3Icon, ListChecksIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"

type StatItem = {
  label: string
  value: number
  icon: React.ComponentType<{ className?: string }>
  helper?: string
}

type RecentAction = {
  id: string
  supplier_id: string | null
  action_type: string
  created_at: string | null
}

function actionBadgeClassName(actionType: string): string {
  const normalized = actionType.toLowerCase()
  if (normalized === "warning_letter") return "border-orange-200 bg-orange-100 text-orange-800"
  if (normalized === "import_alert") return "border-red-200 bg-red-100 text-red-700"
  if (normalized === "recall") return "border-red-200 bg-red-100 text-red-700"
  return "border-slate-200 bg-slate-100 text-slate-700"
}

function actionLabel(actionType: string): string {
  return actionType.replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase())
}

function formatDate(value: string | null): string {
  if (!value) return "Unknown date"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "Unknown date"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed)
}

export default async function DashboardPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const userId = user?.id ?? null

  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)
  const next30DaysIso = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  const watchlistPromise = userId
    ? supabase.from("watchlist").select("id", { count: "exact", head: true }).eq("user_id", userId)
    : Promise.resolve({ count: 0 } as { count: number | null })

  const [
    totalSuppliersResponse,
    activeActionsResponse,
    expiringCoasResponse,
    watchlistItemsResponse,
    recentActionsResponse,
  ] = await Promise.all([
    supabase.from("suppliers").select("id", { count: "exact", head: true }),
    supabase
      .from("fda_actions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("coa_documents")
      .select("id", { count: "exact", head: true })
      .gte("expiry_date", todayIso)
      .lte("expiry_date", next30DaysIso)
      .neq("status", "expired"),
    watchlistPromise,
    supabase
      .from("fda_actions")
      .select("id,supplier_id,action_type,created_at")
      .order("created_at", { ascending: false })
      .limit(5),
  ])

  const recentActions = (recentActionsResponse.data ?? []) as RecentAction[]
  const supplierIds = Array.from(
    new Set(
      recentActions
        .map((action) => action.supplier_id)
        .filter((supplierId): supplierId is string => Boolean(supplierId))
    )
  )

  let supplierNameById: Record<string, string> = {}
  if (supplierIds.length > 0) {
    const suppliersResponse = await supabase
      .from("suppliers")
      .select("id,name")
      .in("id", supplierIds)

    supplierNameById = (suppliersResponse.data ?? []).reduce<Record<string, string>>(
      (acc, supplier) => {
        if (supplier.id && supplier.name) {
          acc[supplier.id] = supplier.name
        }
        return acc
      },
      {}
    )
  }

  const stats: StatItem[] = [
    {
      label: "Total Suppliers Tracked",
      value: totalSuppliersResponse.count ?? 0,
      icon: Building2Icon,
    },
    {
      label: "Active FDA Actions",
      value: activeActionsResponse.count ?? 0,
      icon: AlertTriangleIcon,
    },
    {
      label: "COAs Expiring Soon",
      helper: "next 30 days",
      value: expiringCoasResponse.count ?? 0,
      icon: Clock3Icon,
    },
    {
      label: "Watchlist Items",
      value: watchlistItemsResponse.count ?? 0,
      icon: ListChecksIcon,
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="border-slate-200 shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-700">{stat.label}</CardTitle>
              <stat.icon className="size-4 text-slate-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-slate-900">{stat.value}</div>
              {stat.helper ? <p className="mt-1 text-xs text-slate-500">{stat.helper}</p> : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg text-slate-900">Recent FDA Actions</CardTitle>
        </CardHeader>
        <CardContent>
          {recentActions.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
              No recent FDA actions
            </div>
          ) : (
            <ul className="space-y-2">
              {recentActions.map((action) => (
                <li key={action.id}>
                  <Link
                    href="/alerts"
                    className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm transition hover:bg-slate-50"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge className={actionBadgeClassName(action.action_type)} variant="outline">
                        {actionLabel(action.action_type)}
                      </Badge>
                      <span className="truncate font-medium text-slate-900">
                        {action.supplier_id
                          ? supplierNameById[action.supplier_id] ?? "Unknown supplier"
                          : "Unknown supplier"}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(action.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
