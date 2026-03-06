import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Compliance dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Supplier intelligence and COA management foundation is active.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Supplier Intelligence</CardTitle>
            <CardDescription>Data ingestion phase starts next.</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge>Phase 2 target</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">COA Management</CardTitle>
            <CardDescription>Document workflows scaffolded.</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">Phase 4 target</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Alerts</CardTitle>
            <CardDescription>Watchlists and emails planned.</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">Phase 5 target</Badge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live metrics placeholder</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    </div>
  )
}
