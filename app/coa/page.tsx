"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useDropzone } from "react-dropzone"
import { FileUpIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { deleteCOA, getCOAUrl, uploadCOA } from "@/lib/supabase/storage"

type SupplierRelation = { name?: string | null } | Array<{ name?: string | null }> | null

type CoaDocument = {
  id: string
  file_name: string
  file_path: string
  compound_name: string | null
  lot_number: string | null
  expiry_date: string | null
  status: "pending" | "extracted" | "verified" | "expired"
  created_at: string
  suppliers?: SupplierRelation
}

type UploadingRow = {
  id: string
  file_name: string
  status: "uploading" | "error"
  error?: string
}

type DocumentsApiResponse = {
  success: boolean
  data: {
    orgId: string
    documents: CoaDocument[]
  } | null
  error: string | null
}

function getSupplierName(suppliers?: SupplierRelation): string {
  if (!suppliers) return "—"
  if (Array.isArray(suppliers)) {
    return suppliers[0]?.name ?? "—"
  }
  return suppliers.name ?? "—"
}

function getStatusBadge(status: CoaDocument["status"] | UploadingRow["status"]) {
  if (status === "pending") {
    return <Badge className="border-slate-300 bg-slate-100 text-slate-700">Pending</Badge>
  }
  if (status === "extracted") {
    return <Badge className="border-blue-300 bg-blue-50 text-blue-700">Extracted</Badge>
  }
  if (status === "verified") {
    return <Badge className="border-green-300 bg-green-50 text-green-700">Verified</Badge>
  }
  if (status === "expired") {
    return <Badge className="border-red-300 bg-red-50 text-red-700">Expired</Badge>
  }
  if (status === "uploading") {
    return <Badge className="border-amber-300 bg-amber-50 text-amber-700">Uploading...</Badge>
  }
  return <Badge className="border-red-300 bg-red-50 text-red-700">Upload failed</Badge>
}

function formatExpiryDate(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString()
}

export default function CoaDocumentsPage() {
  const [documents, setDocuments] = useState<CoaDocument[]>([])
  const [uploadRows, setUploadRows] = useState<UploadingRow[]>([])
  const [orgId, setOrgId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyDocIds, setBusyDocIds] = useState<Record<string, boolean>>({})

  const fetchDocuments = useCallback(
    async (showRefreshState: boolean) => {
      if (showRefreshState) setIsRefreshing(true)
      try {
        setError(null)
        const response = await fetch("/api/coa/documents", { method: "GET" })
        const result = (await response.json()) as DocumentsApiResponse

        if (!response.ok || !result.success || !result.data) {
          throw new Error(result.error ?? "Failed to load COA documents.")
        }

        setOrgId(result.data.orgId)
        setDocuments(result.data.documents)
      } catch (fetchError) {
        const message =
          fetchError instanceof Error ? fetchError.message : "Failed to load COA documents."
        setError(message)
      } finally {
        if (showRefreshState) {
          setIsRefreshing(false)
        } else {
          setIsLoading(false)
        }
      }
    },
    []
  )

  useEffect(() => {
    void fetchDocuments(false)
  }, [fetchDocuments])

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!orgId) {
        setError("Organization context is not available yet. Please refresh and try again.")
        return
      }

      for (const file of acceptedFiles) {
        const tempId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        setUploadRows((current) => [
          { id: tempId, file_name: file.name, status: "uploading" },
          ...current,
        ])

        try {
          const filePath = await uploadCOA(file, orgId, "unassigned")

          const response = await fetch("/api/coa/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileName: file.name,
              filePath,
              supplierId: null,
            }),
          })

          const result = (await response.json()) as {
            success: boolean
            data: { document: CoaDocument } | null
            error: string | null
          }

          if (!response.ok || !result.success || !result.data?.document) {
            throw new Error(result.error ?? "Failed to save COA metadata.")
          }

          setDocuments((current) => [result.data!.document, ...current])
          setUploadRows((current) => current.filter((row) => row.id !== tempId))
        } catch (uploadError) {
          const message =
            uploadError instanceof Error ? uploadError.message : "Upload failed unexpectedly."
          setUploadRows((current) =>
            current.map((row) =>
              row.id === tempId
                ? {
                    ...row,
                    status: "error",
                    error: message,
                  }
                : row
            )
          )
        }
      }
    },
    [orgId]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
    },
    multiple: true,
  })

  const onViewDocument = useCallback(async (filePath: string, id: string) => {
    setBusyDocIds((current) => ({ ...current, [id]: true }))
    try {
      const signedUrl = await getCOAUrl(filePath)
      window.open(signedUrl, "_blank", "noopener,noreferrer")
    } catch (viewError) {
      const message = viewError instanceof Error ? viewError.message : "Failed to open file."
      setError(message)
    } finally {
      setBusyDocIds((current) => ({ ...current, [id]: false }))
    }
  }, [])

  const onDeleteDocument = useCallback(async (document: CoaDocument) => {
    setBusyDocIds((current) => ({ ...current, [document.id]: true }))
    try {
      await deleteCOA(document.file_path)

      const response = await fetch(`/api/coa/documents/${document.id}`, {
        method: "DELETE",
      })
      const result = (await response.json()) as {
        success: boolean
        data: unknown
        error: string | null
      }

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Failed to delete COA record.")
      }

      setDocuments((current) => current.filter((row) => row.id !== document.id))
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : "Unable to delete document."
      setError(message)
    } finally {
      setBusyDocIds((current) => ({ ...current, [document.id]: false }))
    }
  }, [])

  const tableRows = useMemo(() => {
    const previewRows = uploadRows.map((row) => ({
      kind: "upload" as const,
      id: row.id,
      file_name: row.file_name,
      supplier: "—",
      compound_name: "—",
      lot_number: "—",
      expiry_date: "—",
      status: row.status,
      error: row.error,
    }))

    const persistedRows = documents.map((doc) => ({
      kind: "document" as const,
      id: doc.id,
      file_name: doc.file_name,
      supplier: getSupplierName(doc.suppliers),
      compound_name: doc.compound_name ?? "—",
      lot_number: doc.lot_number ?? "—",
      expiry_date: formatExpiryDate(doc.expiry_date),
      status: doc.status,
      file_path: doc.file_path,
      original: doc,
    }))

    return [...previewRows, ...persistedRows]
  }, [documents, uploadRows])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#111111]">COA Documents</h1>
        <p className="mt-1 text-sm text-slate-600">
          Upload and manage Certificates of Analysis
        </p>
      </div>

      <Card className="rounded-md border-[#E5E7EB] shadow-none">
        <CardContent className="p-4">
          <div
            {...getRootProps()}
            className={`cursor-pointer rounded-md border-2 border-dashed p-8 text-center transition-colors ${
              isDragActive
                ? "border-[#CC0000] bg-red-50"
                : "border-slate-300 bg-slate-50 hover:border-[#CC0000]/70 hover:bg-red-50/40"
            }`}
          >
            <input {...getInputProps()} />
            <div className="mx-auto flex max-w-xl flex-col items-center gap-3">
              <FileUpIcon className="size-9 text-slate-500" />
              <p className="text-sm font-medium text-slate-700">
                Drag and drop a COA PDF here, or click to browse
              </p>
              <p className="text-xs text-slate-500">PDF files only</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <Card className="rounded-md border-[#E5E7EB] shadow-none">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">File Name</th>
                  <th className="px-4 py-3 font-semibold">Supplier</th>
                  <th className="px-4 py-3 font-semibold">Compound</th>
                  <th className="px-4 py-3 font-semibold">Lot Number</th>
                  <th className="px-4 py-3 font-semibold">Expiry Date</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, idx) => (
                    <tr key={`skeleton-${idx}`} className="border-t border-[#E5E7EB]">
                      <td className="px-4 py-3">
                        <Skeleton className="h-4 w-48" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="h-4 w-24" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="h-4 w-24" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="h-4 w-24" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="h-4 w-24" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="h-6 w-20 rounded-md" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="h-4 w-28" />
                      </td>
                    </tr>
                  ))
                ) : tableRows.length === 0 ? (
                  <tr className="border-t border-[#E5E7EB]">
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      No COA documents uploaded yet.
                    </td>
                  </tr>
                ) : (
                  tableRows.map((row) => (
                    <tr key={row.id} className="border-t border-[#E5E7EB] align-top">
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#111111]">{row.file_name}</p>
                        {"error" in row && row.error ? (
                          <p className="mt-1 text-xs text-red-600">{row.error}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{row.supplier}</td>
                      <td className="px-4 py-3 text-slate-700">{row.compound_name}</td>
                      <td className="px-4 py-3 text-slate-700">{row.lot_number}</td>
                      <td className="px-4 py-3 text-slate-700">{row.expiry_date}</td>
                      <td className="px-4 py-3">{getStatusBadge(row.status)}</td>
                      <td className="px-4 py-3">
                        {row.kind === "document" ? (
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 rounded-md"
                              onClick={() => void onViewDocument(row.file_path, row.id)}
                              disabled={Boolean(busyDocIds[row.id])}
                            >
                              View
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-8 rounded-md"
                              onClick={() => void onDeleteDocument(row.original)}
                              disabled={Boolean(busyDocIds[row.id])}
                            >
                              Delete
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">
                            {row.status === "uploading"
                              ? "Processing..."
                              : "Retry by selecting the file again"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {isRefreshing ? <p className="text-xs text-slate-500">Refreshing documents...</p> : null}
    </div>
  )
}
