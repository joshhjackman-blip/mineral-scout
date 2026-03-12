import Link from "next/link"

import { SupplierSearchFilters } from "@/components/suppliers/supplier-search-filters"
import { SuppliersToastListener } from "@/components/suppliers/suppliers-toast-listener"
import RiskScoreBadge from "@/components/ui/risk-score-badge"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"

type SuppliersPageProps = {
  searchParams?: {
    q?: string | string[]
    country?: string | string[]
    registered?: string | string[]
    risk?: string | string[]
    alerts?: string | string[]
  }
}

type SupplierRow = {
  id: string
  name: string
  country: string | null
  city: string | null
  fda_registered: boolean | null
  primary_compounds: string[] | null
  risk_score: number | null
  last_shipment_date: string | null
  active_fda_actions: number | null
}

function getSingleValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

function matchRiskLevel(score: number, riskFilter: string): boolean {
  if (riskFilter === "low") return score <= 25
  if (riskFilter === "moderate") return score >= 26 && score <= 50
  if (riskFilter === "high") return score >= 51 && score <= 75
  if (riskFilter === "critical") return score >= 76
  return true
}

function formatLastShipment(lastShipmentDate: string | null): string {
  if (!lastShipmentDate) {
    return "No shipments on record"
  }
  const parsed = new Date(lastShipmentDate)
  if (Number.isNaN(parsed.getTime())) {
    return "No shipments on record"
  }
  return `Last shipment: ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(parsed)}`
}

export default async function SuppliersPage({ searchParams }: SuppliersPageProps) {
  const supabase = await createClient()
  const query = (getSingleValue(searchParams?.q) ?? "").trim().toLowerCase()
  const countryFilter = getSingleValue(searchParams?.country) ?? "all"
  const registeredFilter = getSingleValue(searchParams?.registered) ?? "all"
  const riskFilter = getSingleValue(searchParams?.risk) ?? "all"
  const activeAlertsOnly = getSingleValue(searchParams?.alerts) === "1"

  const { data, error } = await supabase
    .from("suppliers")
    .select(
      "id,name,country,city,fda_registered,primary_compounds,risk_score,last_shipment_date,active_fda_actions"
    )
    .order("risk_score", { ascending: false })

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">Supplier Intelligence</h1>
        <p className="text-sm text-destructive">
          Could not load suppliers: {error.message}
        </p>
      </div>
    )
  }

  const suppliers = (data ?? []) as SupplierRow[]
  const countries = Array.from(
    new Set(
      suppliers
        .map((supplier) => supplier.country)
        .filter((country): country is string => Boolean(country))
    )
  ).sort((a, b) => a.localeCompare(b))

  const filteredSuppliers = suppliers.filter((supplier) => {
    const supplierCountry = supplier.country ?? ""
    const supplierCity = supplier.city ?? ""
    const compounds = supplier.primary_compounds ?? []
    const score = supplier.risk_score ?? 0
    const activeAlerts = supplier.active_fda_actions ?? 0

    const matchesQuery =
      !query ||
      supplier.name.toLowerCase().includes(query) ||
      supplierCountry.toLowerCase().includes(query) ||
      supplierCity.toLowerCase().includes(query) ||
      compounds.some((compound) => compound.toLowerCase().includes(query))

    const matchesCountry = countryFilter === "all" || supplierCountry === countryFilter
    const matchesRegistered =
      registeredFilter === "all" ||
      (registeredFilter === "registered" && supplier.fda_registered === true) ||
      (registeredFilter === "unregistered" && supplier.fda_registered !== true)
    const matchesRisk = riskFilter === "all" || matchRiskLevel(score, riskFilter)
    const matchesAlerts = !activeAlertsOnly || activeAlerts > 0

    return (
      matchesQuery && matchesCountry && matchesRegistered && matchesRisk && matchesAlerts
    )
  })

  return (
    <div className="space-y-6">
      <SuppliersToastListener />
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Supplier Intelligence
        </h1>
        <p className="text-sm text-slate-600">
          Search and monitor API suppliers for your pharmacy
        </p>
      </div>

      <SupplierSearchFilters countries={countries} />

      {filteredSuppliers.length === 0 ? (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="py-10 text-center">
            <p className="font-medium text-slate-900">No suppliers match your search</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try adjusting your search terms or filters.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredSuppliers.map((supplier) => {
            const score = supplier.risk_score ?? 0
            const activeAlerts = supplier.active_fda_actions ?? 0

            return (
              <Link key={supplier.id} href={`/suppliers/${supplier.id}`} className="block">
                <Card className="h-full border-slate-200 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                  <CardHeader className="space-y-2">
                    <CardTitle className="text-base font-semibold text-slate-900">
                      {supplier.name}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {supplier.country ?? "Unknown country"}
                      {supplier.city ? ` • ${supplier.city}` : ""}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge
                        className={
                          supplier.fda_registered
                            ? "border-emerald-200 bg-emerald-100 text-emerald-800"
                            : "border-red-200 bg-red-100 text-red-800"
                        }
                        variant="outline"
                      >
                        {supplier.fda_registered ? "Registered" : "Unregistered"}
                      </Badge>
                      <RiskScoreBadge score={score} size="lg" />
                    </div>

                    <p className="text-sm text-muted-foreground">
                      {formatLastShipment(supplier.last_shipment_date)}
                    </p>

                    {activeAlerts > 0 ? (
                      <Badge className="border-red-200 bg-red-100 text-red-700" variant="outline">
                        {activeAlerts} Active Alerts
                      </Badge>
                    ) : (
                      <p className="text-sm text-muted-foreground">No active alerts</p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
