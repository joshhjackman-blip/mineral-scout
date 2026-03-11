import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export default function SuppliersLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>

      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full lg:col-span-2" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Card key={index} className="border-slate-200 shadow-sm">
            <CardHeader className="space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-6 w-1/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
