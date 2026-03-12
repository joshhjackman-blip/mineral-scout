"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { Loader2Icon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type CoaStatus = "pending" | "extracted" | "verified" | "expired"

type SupplierOption = {
  id: string
  name: string
}

type CoaAnalysisResults = {
  compound_name?: string | null
  supplier_name?: string | null
  lot_number?: string | null
  manufacture_date?: string | null
  expiry_date?: string | null
  purity_percentage?: number | null
  assay_result?: string | null
  lab_name?: string | null
}

type SupplierRelation = { id?: string | null; name?: string | null } | null

type CoaDetailData = {
  id: string
  file_name: string
  file_path: string
  created_at: string
  status: CoaStatus
  compound_name: string | null
  lot_number: string | null
  manufacture_date: string | null
  expiry_date: string | null
  supplier_id: string | null
  suppliers: SupplierRelation
  analysis_results: CoaAnalysisResults | null
}

type CoaDetailClientProps = {
  document: CoaDetailData
  suppliers: SupplierOption[]
  signedUrl: string | null
}

function statusBadge(status: CoaStatus) {
  if (status === "pending") {
    return <Badge className="border-slate-300 bg-slate-100 text-slate-700">Pending</Badge>
  }
  if (status === "extracted") {
    return <Badge className="border-blue-300 bg-blue-50 text-blue-700">Extracted</Badge>
  }
  if (status === "verified") {
    return <Badge className="border-green-300 bg-green-50 text-green-700">Verified</Badge>
  }
  return <Badge className="border-red-300 bg-red-50 text-red-700">Expired</Badge>
}

function formatDate(value: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString()
}

function renderFieldValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-slate-400">Not found in document</span>
  }
  return <span className="text-[#111111]">{String(value)}</span>
}

function isExpiringWithin30Days(expiryDate: string | null) {
  if (!expiryDate) return false
  const expiry = new Date(expiryDate)
  if (Number.isNaN(expiry.getTime())) return false
  const now = new Date()
  const diff = expiry.getTime() - now.getTime()
  const days = diff / (1000 * 60 * 60 * 24)
  return days >= 0 && days <= 30
}

export function CoaDetailClient({ document, suppliers, signedUrl }: CoaDetailClientProps) {
  const analysis = document.analysis_results ?? {}

  const [status, setStatus] = useState<CoaStatus>(document.status)
  const [supplierId, setSupplierId] = useState<string>(document.supplier_id ?? "")
  const [linkedSupplierName, setLinkedSupplierName] = useState<string | null>(
    document.suppliers?.name ?? null
  )
  const [isSavingSupplier, setIsSavingSupplier] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [iframeFailed, setIframeFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const extractedSupplierName = useMemo(() => {
    return linkedSupplierName ?? analysis.supplier_name ?? null
  }, [analysis.supplier_name, linkedSupplierName])

  const displayCompound = document.compound_name ?? analysis.compound_name
  const displayLotNumber = document.lot_number ?? analysis.lot_number
  const displayManufactureDate = formatDate(document.manufacture_date ?? analysis.manufacture_date ?? null)
  const displayExpiryDateRaw = document.expiry_date ?? analysis.expiry_date ?? null
  const displayExpiryDate = formatDate(displayExpiryDateRaw)
  const displayPurity =
    typeof analysis.purity_percentage === "number" ? `${analysis.purity_percentage}%` : null

  const expiresSoon = isExpiringWithin30Days(displayExpiryDateRaw)

  async function patchDocument(payload: { supplierId?: string | null; status?: CoaStatus }) {
    const response = await fetch(`/api/coa/${document.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const result = (await response.json()) as {
      success: boolean
      data: {
        status?: CoaStatus
        supplier_id?: string | null
        suppliers?: { name?: string | null } | Array<{ name?: string | null }> | null
      } | null
      error: string | null
    }
    if (!response.ok || !result.success) {
      throw new Error(result.error ?? "Failed to update COA record.")
    }
    return result.data
  }

  async function onSaveSupplierLink() {
    setError(null)
    setNotice(null)
    setIsSavingSupplier(true)
    try {
      const nextSupplierId = supplierId || null
      const updated = await patchDocument({ supplierId: nextSupplierId })
      const supplierRelation = updated?.suppliers
      const supplierName = Array.isArray(supplierRelation)
        ? supplierRelation[0]?.name ?? null
        : supplierRelation?.name ?? null
      setLinkedSupplierName(supplierName)
      setNotice("Supplier link updated.")
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unable to save supplier link."
      setError(message)
    } finally {
      setIsSavingSupplier(false)
    }
  }

  async function onMarkVerified() {
    setError(null)
    setNotice(null)
    setIsVerifying(true)
    try {
      const updated = await patchDocument({ status: "verified" })
      setStatus(updated?.status ?? "verified")
      setNotice("COA marked as verified.")
    } catch (verifyError) {
      const message = verifyError instanceof Error ? verifyError.message : "Unable to verify COA."
      setError(message)
    } finally {
      setIsVerifying(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/coa"
          className="inline-flex items-center text-sm font-medium text-slate-600 transition-colors hover:text-[#111111]"
        >
          &larr; COA Documents
        </Link>
      </div>

      <div className="rounded-md border border-[#E5E7EB] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#111111]">{document.file_name}</h1>
            <p className="mt-1 text-sm text-slate-500">
              Uploaded on {formatDate(document.created_at) ?? "Unknown date"}
            </p>
          </div>
          <div>{statusBadge(status)}</div>
        </div>
      </div>

      {expiresSoon ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          This COA expires soon
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {notice}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-md border-[#E5E7EB] shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-[#111111]">Document Viewer</CardTitle>
          </CardHeader>
          <CardContent>
            {signedUrl && !iframeFailed ? (
              <iframe
                src={signedUrl}
                title={document.file_name}
                className="h-[720px] w-full rounded-md border border-[#E5E7EB]"
                onError={() => setIframeFailed(true)}
              />
            ) : null}

            {signedUrl && iframeFailed ? (
              <a
                href={signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center justify-center rounded-md bg-[#CC0000] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#a60000]"
              >
                Open PDF &rarr;
              </a>
            ) : null}

            {!signedUrl ? (
              <p className="text-sm text-slate-500">
                A viewer URL could not be generated. Please try again shortly.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="rounded-md border-[#E5E7EB] shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-[#111111]">AI Extracted Data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {status === "pending" ? (
              <div className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                <Loader2Icon className="size-4 animate-spin" />
                Extracting data...
              </div>
            ) : null}

            <dl className="space-y-3 text-sm">
              <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] pb-2">
                <dt className="font-medium text-slate-600">Compound Name</dt>
                <dd className="text-right">{renderFieldValue(displayCompound)}</dd>
              </div>
              <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] pb-2">
                <dt className="font-medium text-slate-600">Supplier</dt>
                <dd className="text-right">{renderFieldValue(extractedSupplierName)}</dd>
              </div>
              <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] pb-2">
                <dt className="font-medium text-slate-600">Lot Number</dt>
                <dd className="text-right">{renderFieldValue(displayLotNumber)}</dd>
              </div>
              <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] pb-2">
                <dt className="font-medium text-slate-600">Manufacture Date</dt>
                <dd className="text-right">{renderFieldValue(displayManufactureDate)}</dd>
              </div>
              <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] pb-2">
                <dt className="font-medium text-slate-600">Expiry Date</dt>
                <dd className="text-right">{renderFieldValue(displayExpiryDate)}</dd>
              </div>
              <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] pb-2">
                <dt className="font-medium text-slate-600">Purity %</dt>
                <dd className="text-right">{renderFieldValue(displayPurity)}</dd>
              </div>
              <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] pb-2">
                <dt className="font-medium text-slate-600">Lab Name</dt>
                <dd className="text-right">{renderFieldValue(analysis.lab_name ?? null)}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="font-medium text-slate-600">Assay Result</dt>
                <dd className="text-right">{renderFieldValue(analysis.assay_result ?? null)}</dd>
              </div>
            </dl>

            <div className="space-y-2 border-t border-[#E5E7EB] pt-4">
              <p className="text-sm font-medium text-[#111111]">Link to Supplier</p>
              <div className="flex gap-2">
                <Select
                  value={supplierId || "none"}
                  onValueChange={(value) => {
                    if (!value || value === "none") {
                      setSupplierId("")
                      return
                    }
                    setSupplierId(value)
                  }}
                >
                  <SelectTrigger className="w-full rounded-md">
                    <SelectValue placeholder="Select a supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No linked supplier</SelectItem>
                    {suppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-md"
                  onClick={() => void onSaveSupplierLink()}
                  disabled={isSavingSupplier}
                >
                  {isSavingSupplier ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>

            <Button
              type="button"
              className="w-full rounded-md"
              onClick={() => void onMarkVerified()}
              disabled={isVerifying || status === "verified"}
            >
              {isVerifying ? "Updating..." : status === "verified" ? "Verified" : "Mark as Verified"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
