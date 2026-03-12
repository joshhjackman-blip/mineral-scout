import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export default function DashboardLoading() {
  return (
    <div className="space-y-5">
      <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3">
        <Skeleton className="h-8 w-64" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="rounded-md border-[#E5E7EB] shadow-none">
            <div className="h-1 w-full bg-[#CC0000]" />
            <CardHeader className="space-y-2 pb-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-10 w-16" />
              <Skeleton className="h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-md border-[#E5E7EB] shadow-none">
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-56" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-11 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
