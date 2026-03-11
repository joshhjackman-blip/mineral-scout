"use client"

import { useCallback } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function AlertsFilterBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const currentType = searchParams.get("type") ?? "all"
  const currentStatus = searchParams.get("status") ?? "all"
  const currentFrom = searchParams.get("from") ?? ""
  const currentTo = searchParams.get("to") ?? ""

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (!value || value === "all") {
        params.delete(key)
      } else {
        params.set(key, value)
      }

      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Action Type</Label>
          <Select value={currentType} onValueChange={(value) => updateParam("type", value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="warning_letter">Warning Letter</SelectItem>
              <SelectItem value="import_alert">Import Alert</SelectItem>
              <SelectItem value="recall">Recall</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={currentStatus} onValueChange={(value) => updateParam("status", value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="alerts-from" className="text-xs text-muted-foreground">
            From
          </Label>
          <input
            id="alerts-from"
            type="date"
            value={currentFrom}
            onChange={(event) => updateParam("from", event.target.value || null)}
            className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="alerts-to" className="text-xs text-muted-foreground">
            To
          </Label>
          <input
            id="alerts-to"
            type="date"
            value={currentTo}
            onChange={(event) => updateParam("to", event.target.value || null)}
            className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
          />
        </div>
      </div>
    </div>
  )
}
