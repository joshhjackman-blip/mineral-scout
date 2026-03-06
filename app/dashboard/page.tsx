import { AlertTriangleIcon, Building2Icon, Clock3Icon, ListChecksIcon } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type StatItem = {
  label: string
  value: number
  icon: React.ComponentType<{ className?: string }>
  helper?: string
}

export default function DashboardPage() {
  const stats: StatItem[] = [
    {
      label: "Total Suppliers Tracked",
      value: 0,
      icon: Building2Icon,
    },
    {
      label: "Active FDA Actions",
      value: 0,
      icon: AlertTriangleIcon,
    },
    {
      label: "COAs Expiring Soon",
      helper: "next 30 days",
      value: 0,
      icon: Clock3Icon,
    },
    {
      label: "Watchlist Items",
      value: 0,
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
          <CardTitle className="text-lg text-slate-900">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
            No activity yet
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
