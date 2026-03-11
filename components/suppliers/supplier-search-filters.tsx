"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type SupplierSearchFiltersProps = {
  countries: string[]
}

export function SupplierSearchFilters({ countries }: SupplierSearchFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [searchTerm, setSearchTerm] = useState(searchParams.get("q") ?? "")

  const currentCountry = searchParams.get("country") ?? "all"
  const currentRegistered = searchParams.get("registered") ?? "all"
  const currentRisk = searchParams.get("risk") ?? "all"
  const activeAlertsOnly = searchParams.get("alerts") === "1"

  const queryString = useMemo(() => searchParams.toString(), [searchParams])

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (!value || value === "all") {
        params.delete(key)
      } else {
        params.set(key, value)
      }
      const nextQuery = params.toString()
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  useEffect(() => {
    setSearchTerm(searchParams.get("q") ?? "")
  }, [queryString, searchParams])

  useEffect(() => {
    const timeout = setTimeout(() => {
      const currentQuery = searchParams.get("q") ?? ""
      if (searchTerm === currentQuery) {
        return
      }
      updateParam("q", searchTerm.trim() || null)
    }, 300)
    return () => clearTimeout(timeout)
  }, [searchTerm, searchParams, updateParam])

  return (
    <div className="space-y-4">
      <div>
        <Input
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search suppliers by name, country, or compound..."
          className="w-full"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Country</Label>
          <Select value={currentCountry} onValueChange={(value) => updateParam("country", value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All countries" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All countries</SelectItem>
              {countries.map((country) => (
                <SelectItem key={country} value={country}>
                  {country}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">FDA Registered</Label>
          <Select
            value={currentRegistered}
            onValueChange={(value) => updateParam("registered", value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="registered">Registered Only</SelectItem>
              <SelectItem value="unregistered">Unregistered Only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Risk Level</Label>
          <Select value={currentRisk} onValueChange={(value) => updateParam("risk", value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="moderate">Moderate</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end lg:col-span-2">
          <label className="inline-flex items-center gap-2 rounded-md border px-3 py-2">
            <Checkbox
              checked={activeAlertsOnly}
              onCheckedChange={(checked) => updateParam("alerts", checked ? "1" : null)}
            />
            <span className="text-sm">Active Alerts Only</span>
          </label>
        </div>
      </div>
    </div>
  )
}
