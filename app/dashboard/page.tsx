import Link from "next/link"
import { BookmarkIcon, Building2Icon, FileWarningIcon, ShieldAlertIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"

type StatItem = {
  label: string
  value: number
  icon: React.ComponentType<{ className?: string }>
  trend: string
}

type RecentAction = {
  id: string
  supplier_id: string | null
  action_type: string
  status: string | null
  issue_date: string | null
  created_at: string | null
}

function actionBadgeClassName(actionType: string): string {
  const normalized = actionType.toLowerCase()
  if (normalized === "warning_letter") return "border-orange-200 bg-orange-100 text-orange-800"
  if (normalized === "import_alert") return "border-red-300 bg-red-100 text-red-800"
  if (normalized === "recall") return "border-[#8B0000]/30 bg-[#8B0000]/10 text-[#8B0000]"
  return "border-[#E5E7EB] bg-[#F9FAFB] text-[#111111]"
}

function actionRowBorderClassName(actionType: string): string {
  const normalized = actionType.toLowerCase()
  if (normalized === "warning_letter") return "border-l-orange-500"
  if (normalized === "import_alert") return "border-l-[#8B0000]"
  if (normalized === "recall") return "border-l-[#CC0000]"
  return "border-l-[#E5E7EB]"
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

function formatFullDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(value)
}

function statusBadgeClassName(status: string | null): string {
  const normalized = (status ?? "").toLowerCase()
  if (normalized === "active") return "border-red-300 bg-red-100 text-red-800"
  if (normalized === "resolved" || normalized === "closed")
    return "border-[#E5E7EB] bg-[#F3F4F6] text-[#374151]"
  return "border-[#E5E7EB] bg-[#F9FAFB] text-[#374151]"
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
      .select("id,supplier_id,action_type,status,issue_date,created_at")
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
      trend: "↑ 2 this week",
    },
    {
      label: "Active FDA Actions",
      value: activeActionsResponse.count ?? 0,
      icon: ShieldAlertIcon,
      trend: "↑ 1 this week",
    },
    {
      label: "COAs Expiring Soon",
      value: expiringCoasResponse.count ?? 0,
      icon: FileWarningIcon,
      trend: "↑ 2 this week",
    },
    {
      label: "Watchlist Items",
      value: watchlistItemsResponse.count ?? 0,
      icon: BookmarkIcon,
      trend: "↑ 3 this week",
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3">
        <h1 className="text-2xl font-bold tracking-tight text-[#111111]">Dashboard</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{formatFullDate(today)}</span>
          <Badge className="border-[#CC0000]/30 bg-[#CC0000] text-white" variant="outline">
            Live
          </Badge>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="rounded-md border-[#E5E7EB] shadow-none">
            <div className="h-1 w-full bg-[#CC0000]" />
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-1">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {stat.label}
              </CardTitle>
              <stat.icon className="size-4 text-[#111111]" />
            </CardHeader>
            <CardContent className="pt-0">
              <div
                className={`text-4xl font-bold ${
                  stat.label === "Active FDA Actions" && stat.value > 0
                    ? "text-[#CC0000]"
                    : "text-[#111111]"
                }`}
              >
                {stat.value}
              </div>
              <p className="mt-1 text-xs font-medium text-slate-500">{stat.trend}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-md border-[#E5E7EB] shadow-none">
        <CardHeader className="flex flex-row items-center justify-between border-b border-[#E5E7EB] pb-3">
          <CardTitle className="text-base font-bold text-[#111111]">Recent FDA Actions</CardTitle>
          <Link href="/alerts" className="text-sm font-medium text-[#CC0000] hover:underline">
            View all alerts →
          </Link>
        </CardHeader>
        <CardContent className="px-0 pb-0 pt-0">
          {recentActions.length === 0 ? (
            <div className="rounded-md border border-dashed border-[#E5E7EB] bg-[#F9FAFB] p-8 text-center text-sm text-slate-500">
              No recent FDA actions
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F9FAFB] text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Supplier</th>
                  <th className="px-4 py-2.5">Action Type</th>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentActions.map((action, index) => (
                  <tr
                    key={action.id}
                    className={`border-t border-[#E5E7EB] border-l-4 ${actionRowBorderClassName(action.action_type)} ${
                      index % 2 === 0 ? "bg-white" : "bg-[#F9FAFB]"
                    }`}
                  >
                    <td className="px-4 py-3">
                      {action.supplier_id ? (
                        <Link
                          href={`/suppliers/${action.supplier_id}`}
                          className="font-medium text-[#111111] hover:text-[#CC0000] hover:underline"
                        >
                          {supplierNameById[action.supplier_id] ?? "Unknown supplier"}
                        </Link>
                      ) : (
                        <span className="font-medium text-[#111111]">Unknown supplier</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={actionBadgeClassName(action.action_type)} variant="outline">
                        {actionLabel(action.action_type)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-[#111111]">
                      {formatDate(action.issue_date ?? action.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={statusBadgeClassName(action.status)} variant="outline">
                        {(action.status ?? "unknown").toLowerCase()}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
