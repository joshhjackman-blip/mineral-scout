import { createClient } from "@/lib/supabase/client"

const COA_BUCKET = "coa-documents"
const ONE_HOUR_SECONDS = 60 * 60

function sanitizeFilename(filename: string): string {
  return filename
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
}

export async function uploadCOA(
  file: File,
  orgId: string,
  supplierId: string
): Promise<string> {
  const supabase = createClient()
  const safeFilename = sanitizeFilename(file.name) || "coa-document"
  const filePath = `${orgId}/${supplierId}/${Date.now()}-${safeFilename}`

  const { error } = await supabase.storage.from(COA_BUCKET).upload(filePath, file, {
    upsert: false,
  })

  if (error) {
    throw new Error(`Failed to upload COA: ${error.message}`)
  }

  return filePath
}

export async function getCOAUrl(filePath: string): Promise<string> {
  const supabase = createClient()
  const { data, error } = await supabase.storage
    .from(COA_BUCKET)
    .createSignedUrl(filePath, ONE_HOUR_SECONDS)

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to generate COA URL: ${error?.message ?? "Unknown error"}`)
  }

  return data.signedUrl
}

export async function deleteCOA(filePath: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.storage.from(COA_BUCKET).remove([filePath])

  if (error) {
    throw new Error(`Failed to delete COA: ${error.message}`)
  }
}
