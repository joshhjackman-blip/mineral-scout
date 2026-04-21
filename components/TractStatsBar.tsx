"use client"

import { useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"

type TractStatsBarProps = {
  grossAcres: number | null
  pdpCount: number
  pudCount: number
  lastCompletionDate?: string | null
}

type UseTractStatsResult = {
  pdpCount: number
  pudCount: number
  lastCompletion: string | null
  loading: boolean
  error: string | null
}

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
})

function formatGrossAcres(grossAcres: number | null): string {
  if (grossAcres === null || Number.isNaN(grossAcres)) {
    return "—"
  }
  return numberFormatter.format(grossAcres)
}

function extractYear(dateValue: string | null | undefined): string | null {
  if (!dateValue) return null
  const yearMatch = dateValue.match(/^(\d{4})/)
  if (yearMatch) return yearMatch[1]

  const parsed = new Date(dateValue)
  if (Number.isNaN(parsed.getTime())) return null
  return String(parsed.getUTCFullYear())
}

export function TractStatsBar({
  grossAcres,
  pdpCount,
  pudCount,
  lastCompletionDate,
}: TractStatsBarProps) {
  const lastYear = extractYear(lastCompletionDate)
  const pdpSubLabel = pdpCount > 0 ? (lastYear ? `last ${lastYear}` : "last unknown") : "no production"
  const pudSubLabel = pudCount > 0 ? "permitted" : "no permits"

  return (
    <div className="grid grid-cols-3 divide-x divide-zinc-700 rounded-md border border-zinc-700 bg-zinc-800 font-mono text-xs">
      <div className="px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-zinc-400">Gross Ac</div>
        <div className="mt-0.5 text-base font-semibold text-zinc-100">{formatGrossAcres(grossAcres)}</div>
      </div>

      <div className="px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-zinc-400">PDP Wells</div>
        <div className={`mt-0.5 text-base font-semibold ${pdpCount > 0 ? "text-emerald-400" : "text-zinc-400"}`}>
          {pdpCount}
        </div>
        <div className="text-[10px] text-zinc-500">{pdpSubLabel}</div>
      </div>

      <div className="px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-zinc-400">PUD Permits</div>
        <div className={`mt-0.5 text-base font-semibold ${pudCount > 0 ? "text-amber-400" : "text-zinc-400"}`}>
          {pudCount}
        </div>
        <div className="text-[10px] text-zinc-500">{pudSubLabel}</div>
      </div>
    </div>
  )
}

export function useTractStats(rrcLeaseId: string | null): UseTractStatsResult {
  const [pdpCount, setPdpCount] = useState(0)
  const [pudCount, setPudCount] = useState(0)
  const [lastCompletion, setLastCompletion] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!rrcLeaseId) {
      setPdpCount(0)
      setPudCount(0)
      setLastCompletion(null)
      setLoading(false)
      setError(null)
      return () => {
        cancelled = true
      }
    }

    const run = async () => {
      setLoading(true)
      setError(null)

      const leaseId = String(rrcLeaseId)
      const [pdpRes, pudRes] = await Promise.all([
        supabase
          .from("gonzales_wells")
          .select("completion_date", { count: "exact" })
          .eq("rrc_lease_id", leaseId)
          .in("well_status", ["PRODUCING", "SHUT IN"])
          .order("completion_date", { ascending: false })
          .limit(1),
        supabase.from("pud_by_lease").select("pud_count").eq("rrc_lease_id", leaseId).limit(1),
      ])

      if (cancelled) return

      if (pdpRes.error) {
        setError(pdpRes.error.message)
        setLoading(false)
        return
      }

      if (pudRes.error) {
        setError(pudRes.error.message)
        setLoading(false)
        return
      }

      const nextPdpCount = pdpRes.count ?? 0
      const nextLastCompletion = (pdpRes.data?.[0] as { completion_date?: string | null } | undefined)?.completion_date ?? null
      const nextPudCount = Number((pudRes.data?.[0] as { pud_count?: number | null } | undefined)?.pud_count ?? 0)

      setPdpCount(nextPdpCount)
      setPudCount(nextPudCount)
      setLastCompletion(nextLastCompletion)
      setLoading(false)
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [rrcLeaseId])

  return { pdpCount, pudCount, lastCompletion, loading, error }
}
