"use client"

import { useEffect, useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { toast } from "@/components/ui/toast"

export function SuppliersToastListener() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryString = useMemo(() => searchParams.toString(), [searchParams])

  useEffect(() => {
    if (searchParams.get("notFound") !== "1") {
      return
    }

    toast.error("Supplier not found")

    const params = new URLSearchParams(searchParams.toString())
    params.delete("notFound")
    const nextQuery = params.toString()
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false })
  }, [pathname, queryString, router, searchParams])

  return null
}
