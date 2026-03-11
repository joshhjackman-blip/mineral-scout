"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowDownIcon, ArrowUpIcon, ExternalLinkIcon, FileUpIcon, StarIcon } from "lucide-react"

import RiskScoreBadge from "@/components/ui/risk-score-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type Supplier = {
  id: string
  name: string
  country: string | null
  city: string | null
  fda_registration_number: string | null
  fda_registered: boolean | null
  primary_compounds: string[] | null
  risk_score: number | null
  notes: string | null
}

type Shipment = {
  id: string
  arrival_date: string | null
  country_of_origin: string | null
  port_of_entry: string | null
  consignee_name: string | null
  description: string | null
  weight_kg: number | null
  container_count: number | null
}

type FdaAction = {
  id: string
  action_type: string
  issue_date: string | null
  status: string | null
  title: string | null
  description: string | null
  source_url: string | null
}

type SupplierProfileProps = {
  supplier: Supplier
  shipments: Shipment[]
  actions: FdaAction[]
}

type ShipmentSortKey =
  | "arrival_date"
  | "country_of_origin"
  | "port_of_entry"
  | "consignee_name"
  | "description"
  | "weight_kg"
  | "container_count"

function formatDate(value: string | null): string {
  if (!value) return "-"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "-"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed)
}

function formatLastShipment(value: string | null): string {
  if (!value) return "No shipments on record"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "No shipments on record"
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(parsed)
}

function getActionTypeStyle(actionType: string): string {
  const type = actionType.toLowerCase()
  if (type === "warning_letter") return "border-amber-200 bg-amber-100 text-amber-800"
  if (type === "import_alert") return "border-red-200 bg-red-100 text-red-800"
  if (type === "recall") return "border-orange-200 bg-orange-100 text-orange-800"
  return "border-slate-200 bg-slate-100 text-slate-700"
}

function getStatusStyle(status: string | null): string {
  const normalized = (status ?? "").toLowerCase()
  if (normalized === "active") return "border-red-200 bg-red-100 text-red-700"
  if (normalized === "resolved" || normalized === "closed")
    return "border-emerald-200 bg-emerald-100 text-emerald-700"
  return "border-slate-200 bg-slate-100 text-slate-700"
}

export function SupplierProfile({ supplier, shipments, actions }: SupplierProfileProps) {
  const [watchlisted, setWatchlisted] = useState(false)
  const [sortKey, setSortKey] = useState<ShipmentSortKey>("arrival_date")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")

  const sortedShipments = useMemo(() => {
    const list = [...shipments]
    list.sort((a, b) => {
      const aValue = a[sortKey]
      const bValue = b[sortKey]

      if (sortKey === "arrival_date") {
        const aDate = aValue ? new Date(aValue).getTime() : 0
        const bDate = bValue ? new Date(bValue).getTime() : 0
        return sortDirection === "asc" ? aDate - bDate : bDate - aDate
      }

      if (typeof aValue === "number" || typeof bValue === "number") {
        const aNum = typeof aValue === "number" ? aValue : 0
        const bNum = typeof bValue === "number" ? bValue : 0
        return sortDirection === "asc" ? aNum - bNum : bNum - aNum
      }

      const aStr = String(aValue ?? "")
      const bStr = String(bValue ?? "")
      return sortDirection === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr)
    })
    return list
  }, [shipments, sortDirection, sortKey])

  const lastShipmentDate = useMemo(() => {
    if (!shipments.length) return null
    const sorted = [...shipments].sort((a, b) => {
      const aDate = a.arrival_date ? new Date(a.arrival_date).getTime() : 0
      const bDate = b.arrival_date ? new Date(b.arrival_date).getTime() : 0
      return bDate - aDate
    })
    return sorted[0]?.arrival_date ?? null
  }, [shipments])

  const activeActionsCount = useMemo(
    () => actions.filter((action) => (action.status ?? "").toLowerCase() === "active").length,
    [actions]
  )

  const topConsignees = useMemo(() => {
    const counts = new Map<string, number>()
    shipments.forEach((shipment) => {
      const key = shipment.consignee_name?.trim()
      if (!key) return
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
  }, [shipments])

  const portsOfEntry = useMemo(() => {
    const counts = new Map<string, number>()
    shipments.forEach((shipment) => {
      const key = shipment.port_of_entry?.trim()
      if (!key) return
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  }, [shipments])

  const onSort = (key: ShipmentSortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))
      return
    }
    setSortKey(key)
    setSortDirection("desc")
  }

  const renderSortIcon = (key: ShipmentSortKey) => {
    if (sortKey !== key) return null
    return sortDirection === "asc" ? (
      <ArrowUpIcon className="size-3.5" />
    ) : (
      <ArrowDownIcon className="size-3.5" />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/suppliers" className="text-sm text-primary hover:underline">
          ← Back to suppliers
        </Link>
        <Button variant={watchlisted ? "secondary" : "outline"} onClick={() => setWatchlisted((v) => !v)}>
          <StarIcon className="mr-1 size-4" />
          {watchlisted ? "Watchlisted" : "Add to Watchlist"}
        </Button>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-3xl font-semibold text-slate-900">{supplier.name}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {supplier.country ?? "Unknown country"}
                {supplier.city ? ` • ${supplier.city}` : ""}
              </p>
            </div>
            <RiskScoreBadge score={supplier.risk_score ?? 0} size="lg" />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge
              variant="outline"
              className={
                supplier.fda_registered
                  ? "border-emerald-200 bg-emerald-100 text-emerald-800"
                  : "border-red-200 bg-red-100 text-red-800"
              }
            >
              {supplier.fda_registered ? "Registered" : "Not Registered"}
            </Badge>
            <Badge variant="outline">
              FDA Registration #: {supplier.fda_registration_number ?? "Not Registered"}
            </Badge>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Total Shipments</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{shipments.length}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Last Shipment Date</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatLastShipment(lastShipmentDate)}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Active FDA Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{activeActionsCount}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">FDA Registration Status</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {supplier.fda_registered ? "Registered" : "Unregistered"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview">
        <TabsList variant="line">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="shipments">Shipment History</TabsTrigger>
          <TabsTrigger value="actions">FDA Actions</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle>Compounds Supplied</CardTitle>
              </CardHeader>
              <CardContent>
                {supplier.primary_compounds?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {supplier.primary_compounds.map((compound) => (
                      <Badge key={compound} variant="outline">
                        {compound}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No compounds listed.</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle>Top Consignees</CardTitle>
              </CardHeader>
              <CardContent>
                {topConsignees.length ? (
                  <ul className="space-y-2">
                    {topConsignees.map(([name, count]) => (
                      <li key={name} className="flex items-center justify-between text-sm">
                        <span>{name}</span>
                        <Badge variant="outline">{count}</Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No consignee records found.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="mt-4 border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle>Ports of Entry Used</CardTitle>
            </CardHeader>
            <CardContent>
              {portsOfEntry.length ? (
                <div className="flex flex-wrap gap-2">
                  {portsOfEntry.map(([port, count]) => (
                    <Badge key={port} variant="outline">
                      {port} ({count})
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No port data available.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="shipments">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="pt-4">
              {sortedShipments.length === 0 ? (
                <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No shipment records found
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[920px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        {[
                          ["arrival_date", "Date"],
                          ["country_of_origin", "Origin Country"],
                          ["port_of_entry", "Port of Entry"],
                          ["consignee_name", "Consignee"],
                          ["description", "Description"],
                          ["weight_kg", "Weight (kg)"],
                          ["container_count", "Containers"],
                        ].map(([key, label]) => (
                          <th key={key} className="px-2 py-2 font-medium">
                            <button
                              className="inline-flex items-center gap-1 hover:text-foreground"
                              onClick={() => onSort(key as ShipmentSortKey)}
                              type="button"
                            >
                              {label}
                              {renderSortIcon(key as ShipmentSortKey)}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedShipments.map((shipment) => (
                        <tr key={shipment.id} className="border-b last:border-b-0">
                          <td className="px-2 py-2">{formatDate(shipment.arrival_date)}</td>
                          <td className="px-2 py-2">{shipment.country_of_origin ?? "-"}</td>
                          <td className="px-2 py-2">{shipment.port_of_entry ?? "-"}</td>
                          <td className="px-2 py-2">{shipment.consignee_name ?? "-"}</td>
                          <td className="px-2 py-2">{shipment.description ?? "-"}</td>
                          <td className="px-2 py-2">
                            {typeof shipment.weight_kg === "number"
                              ? shipment.weight_kg.toLocaleString()
                              : "-"}
                          </td>
                          <td className="px-2 py-2">{shipment.container_count ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="actions">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="pt-4">
              {actions.length === 0 ? (
                <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No FDA actions on record — this is a positive signal
                </div>
              ) : (
                <ul className="space-y-3">
                  {actions.map((action) => (
                    <li key={action.id} className="rounded-md border border-slate-200 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={getActionTypeStyle(action.action_type)} variant="outline">
                          {action.action_type.replaceAll("_", " ")}
                        </Badge>
                        <Badge className={getStatusStyle(action.status)} variant="outline">
                          {action.status ?? "unknown"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{formatDate(action.issue_date)}</span>
                      </div>
                      <p className="mt-2 font-medium text-slate-900">{action.title ?? "FDA Action"}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {action.description ?? "No description provided."}
                      </p>
                      {action.source_url ? (
                        <a
                          href={action.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                        >
                          View source
                          <ExternalLinkIcon className="size-3.5" />
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="space-y-4 pt-6">
              <p className="text-sm text-muted-foreground">
                COA document management is coming in the next update. You&apos;ll be able to upload
                and track Certificates of Analysis here.
              </p>
              <Button disabled variant="outline" className="opacity-70">
                <FileUpIcon className="mr-1 size-4" />
                Upload COA (Coming Soon)
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
