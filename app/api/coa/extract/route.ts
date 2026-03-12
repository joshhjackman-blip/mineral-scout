import Anthropic from "@anthropic-ai/sdk"
import { SupabaseClient, createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

import { createClient as createServerSupabaseClient } from "@/lib/supabase/server"

const COA_BUCKET = "coa-documents"

const EXTRACTION_PROMPT = `You are a pharmaceutical document extraction assistant.
Extract the following fields from this Certificate of Analysis.
If a field is not present return null.
Respond with JSON only, no other text:
{
  compound_name: string | null,
  supplier_name: string | null,
  lot_number: string | null,
  manufacture_date: string | null (ISO format YYYY-MM-DD),
  expiry_date: string | null (ISO format YYYY-MM-DD),
  purity_percentage: number | null,
  assay_result: string | null,
  lab_name: string | null,
  test_results: object | null (any other test results found)
}`

type ExtractRequestBody = {
  coaId?: string
  filePath?: string
}

type ExtractedFields = {
  compound_name: string | null
  supplier_name: string | null
  lot_number: string | null
  manufacture_date: string | null
  expiry_date: string | null
  purity_percentage: number | null
  assay_result: string | null
  lab_name: string | null
  test_results: Record<string, unknown> | null
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Server is missing Supabase configuration.")
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

async function getUserOrgId(adminClient: SupabaseClient, userId: string) {
  const membershipQuery = await adminClient
    .from("organization_members")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle()

  const membership = membershipQuery.data as { org_id: string } | null
  if (membershipQuery.error || !membership?.org_id) {
    return null
  }
  return membership.org_id
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function asNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function toIsoDateOrNull(value: unknown): string | null {
  const stringValue = asNullableString(value)
  if (!stringValue) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) {
    return stringValue
  }

  const parsed = new Date(stringValue)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

function parseJsonFromModelOutput(content: string): Record<string, unknown> {
  const trimmed = content.trim()

  const directJson = tryParseJson(trimmed)
  if (directJson) return directJson

  const fenceMatch = trimmed.match(/```json\s*([\s\S]*?)```/i) ?? trimmed.match(/```([\s\S]*?)```/i)
  if (fenceMatch?.[1]) {
    const fencedJson = tryParseJson(fenceMatch[1].trim())
    if (fencedJson) return fencedJson
  }

  const firstBrace = trimmed.indexOf("{")
  const lastBrace = trimmed.lastIndexOf("}")
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const substring = trimmed.slice(firstBrace, lastBrace + 1)
    const embeddedJson = tryParseJson(substring)
    if (embeddedJson) return embeddedJson
  }

  throw new Error("Anthropic response did not contain valid JSON.")
}

function tryParseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function normalizeExtractedFields(raw: Record<string, unknown>): ExtractedFields {
  const testResults =
    raw.test_results && typeof raw.test_results === "object" && !Array.isArray(raw.test_results)
      ? (raw.test_results as Record<string, unknown>)
      : null

  return {
    compound_name: asNullableString(raw.compound_name),
    supplier_name: asNullableString(raw.supplier_name),
    lot_number: asNullableString(raw.lot_number),
    manufacture_date: toIsoDateOrNull(raw.manufacture_date),
    expiry_date: toIsoDateOrNull(raw.expiry_date),
    purity_percentage: asNullableNumber(raw.purity_percentage),
    assay_result: asNullableString(raw.assay_result),
    lab_name: asNullableString(raw.lab_name),
    test_results: testResults,
  }
}

function getMessageText(response: Anthropic.Messages.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
}

function sanitizeLikeInput(value: string): string {
  return value.replace(/[%_]/g, "").trim()
}

async function resolveSupplierId(
  adminClient: SupabaseClient,
  supplierName: string | null
): Promise<string | null> {
  if (!supplierName) return null

  const exactMatch = await adminClient
    .from("suppliers")
    .select("id")
    .eq("name", supplierName)
    .limit(1)
    .maybeSingle()

  const exact = exactMatch.data as { id: string } | null
  if (exact?.id) {
    return exact.id
  }

  const safePattern = sanitizeLikeInput(supplierName)
  if (!safePattern) return null

  const partialMatch = await adminClient
    .from("suppliers")
    .select("id,name")
    .ilike("name", `%${safePattern}%`)
    .limit(5)

  if (partialMatch.error || !partialMatch.data?.length) {
    return null
  }

  const target = supplierName.toLowerCase()
  const exactInsensitive = partialMatch.data.find((supplier) => supplier.name?.toLowerCase() === target)
  return (exactInsensitive ?? partialMatch.data[0])?.id ?? null
}

export async function POST(request: Request) {
  let body: ExtractRequestBody = {}
  try {
    body = (await request.json()) as ExtractRequestBody
  } catch {
    return NextResponse.json(
      { success: false, data: null, error: "Invalid request payload." },
      { status: 400 }
    )
  }

  const coaId = body.coaId?.trim()
  const filePath = body.filePath?.trim()
  if (!coaId || !filePath) {
    return NextResponse.json(
      { success: false, data: null, error: "coaId and filePath are required." },
      { status: 400 }
    )
  }

  try {
    const serverSupabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await serverSupabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { success: false, data: null, error: "Unauthorized." },
        { status: 401 }
      )
    }

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY
    if (!anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured.")
    }

    const adminClient = getAdminClient()
    const orgId = await getUserOrgId(adminClient, user.id)
    if (!orgId) {
      return NextResponse.json(
        { success: false, data: null, error: "No organization membership found." },
        { status: 403 }
      )
    }

    const coaQuery = await adminClient
      .from("coa_documents")
      .select("id,org_id,file_path")
      .eq("id", coaId)
      .limit(1)
      .maybeSingle()

    const coaDocument = coaQuery.data as { id: string; org_id: string; file_path: string } | null
    if (coaQuery.error || !coaDocument) {
      return NextResponse.json(
        { success: false, data: null, error: "COA document not found." },
        { status: 404 }
      )
    }

    if (coaDocument.org_id !== orgId) {
      return NextResponse.json({ success: false, data: null, error: "Forbidden." }, { status: 403 })
    }

    if (coaDocument.file_path !== filePath) {
      return NextResponse.json(
        { success: false, data: null, error: "filePath does not match document record." },
        { status: 400 }
      )
    }

    const signedUrlResponse = await adminClient.storage
      .from(COA_BUCKET)
      .createSignedUrl(filePath, 60 * 10)
    if (signedUrlResponse.error || !signedUrlResponse.data?.signedUrl) {
      throw new Error(signedUrlResponse.error?.message ?? "Failed to create signed COA URL.")
    }

    const pdfResponse = await fetch(signedUrlResponse.data.signedUrl)
    if (!pdfResponse.ok) {
      throw new Error(`Failed to fetch COA PDF (${pdfResponse.status}).`)
    }

    const arrayBuffer = await pdfResponse.arrayBuffer()
    const pdfBase64 = Buffer.from(arrayBuffer).toString("base64")

    const anthropic = new Anthropic({ apiKey: anthropicApiKey })
    const extractionResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      temperature: 0,
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdfBase64,
              },
            },
            {
              type: "text",
              text: EXTRACTION_PROMPT,
            },
          ],
        },
      ],
    })

    const responseText = getMessageText(extractionResponse)
    if (!responseText) {
      throw new Error("Anthropic returned an empty response.")
    }

    const parsedJson = parseJsonFromModelOutput(responseText)
    const extractedFields = normalizeExtractedFields(parsedJson)
    const matchedSupplierId = await resolveSupplierId(adminClient, extractedFields.supplier_name)

    const updatePayload: Record<string, unknown> = {
      compound_name: extractedFields.compound_name,
      lot_number: extractedFields.lot_number,
      manufacture_date: extractedFields.manufacture_date,
      expiry_date: extractedFields.expiry_date,
      analysis_results: extractedFields,
      status: "extracted",
      updated_at: new Date().toISOString(),
    }
    if (matchedSupplierId) {
      updatePayload.supplier_id = matchedSupplierId
    }

    const updateResult = await adminClient
      .from("coa_documents")
      .update(updatePayload)
      .eq("id", coaId)
      .eq("org_id", orgId)

    if (updateResult.error) {
      throw new Error(updateResult.error.message)
    }

    return NextResponse.json({
      success: true,
      data: extractedFields,
      error: null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected extraction error."
    return NextResponse.json({ success: false, data: null, error: message }, { status: 500 })
  }
}
