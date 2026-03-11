import Link from "next/link"
import { notFound } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"

type SupplierDetailPageProps = {
  params: { id: string }
}

export default async function SupplierDetailPage({ params }: SupplierDetailPageProps) {
  const supabase = createClient()
  const { data } = await supabase
    .from("suppliers")
    .select("id,name,country,city,fda_registered,risk_score,active_fda_actions,notes")
    .eq("id", params.id)
    .single()

  if (!data) {
    notFound()
  }

  return (
    <div className="space-y-4">
      <Link href="/suppliers" className="text-sm text-primary hover:underline">
        ← Back to suppliers
      </Link>
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>{data.name}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {data.country ?? "Unknown country"}
            {data.city ? ` • ${data.city}` : ""}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{data.fda_registered ? "Registered" : "Unregistered"}</Badge>
            <Badge variant="outline">Risk score: {data.risk_score ?? 0}</Badge>
            <Badge variant="outline">Active alerts: {data.active_fda_actions ?? 0}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{data.notes ?? "No notes available."}</p>
        </CardContent>
      </Card>
    </div>
  )
}
