"use client"

import { useState } from "react"
import Link from "next/link"
import { ExternalLinkIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

type AlertFeedItem = {
  id: string
  supplier_id: string | null
  supplier_name: string | null
  action_type: string
  status: string | null
  issue_date: string | null
  title: string | null
  description: string | null
  source_url: string | null
}

type AlertsFeedListProps = {
  items: AlertFeedItem[]
}

function formatDate(value: string | null): string {
  if (!value) return "Unknown date"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "Unknown date"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed)
}

function actionLabel(actionType: string): string {
  return actionType.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase())
}

function actionTypeStyle(actionType: string): string {
  const normalized = actionType.toLowerCase()
  if (normalized === "warning_letter") return "border-orange-200 bg-orange-100 text-orange-800"
  if (normalized === "import_alert") return "border-red-200 bg-red-100 text-red-700"
  if (normalized === "recall") return "border-red-200 bg-red-100 text-red-700"
  return "border-slate-200 bg-slate-100 text-slate-700"
}

function statusStyle(status: string | null): string {
  const normalized = (status ?? "").toLowerCase()
  if (normalized === "active") return "border-red-200 bg-red-100 text-red-700"
  if (normalized === "resolved" || normalized === "closed")
    return "border-slate-300 bg-slate-100 text-slate-700"
  return "border-slate-200 bg-slate-100 text-slate-600"
}

export function AlertsFeedList({ items }: AlertsFeedListProps) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})

  if (items.length === 0) {
    return (
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No FDA actions match your filters
        </CardContent>
      </Card>
    )
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const expanded = Boolean(expandedIds[item.id])
        const body = [item.title, item.description].filter(Boolean).join(" — ")

        return (
          <li key={item.id}>
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="space-y-3 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={actionTypeStyle(item.action_type)} variant="outline">
                    {actionLabel(item.action_type)}
                  </Badge>
                  <Badge className={statusStyle(item.status)} variant="outline">
                    {(item.status ?? "unknown").toLowerCase() === "closed" ? "resolved" : item.status ?? "unknown"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Date issued: {formatDate(item.issue_date)}
                  </span>
                </div>

                <div className="text-sm">
                  {item.supplier_id && item.supplier_name ? (
                    <Link href={`/suppliers/${item.supplier_id}`} className="font-medium text-primary hover:underline">
                      {item.supplier_name}
                    </Link>
                  ) : (
                    <span className="font-medium text-slate-900">{item.supplier_name ?? "Unknown supplier"}</span>
                  )}
                </div>

                <div className="space-y-1">
                  <p
                    className={
                      expanded
                        ? "text-sm text-slate-700"
                        : "text-sm text-slate-700 overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
                    }
                  >
                    {body || "No description provided."}
                  </p>
                  {body.length > 120 ? (
                    <Button
                      variant="link"
                      className="h-auto p-0 text-xs"
                      onClick={() =>
                        setExpandedIds((prev) => ({
                          ...prev,
                          [item.id]: !prev[item.id],
                        }))
                      }
                    >
                      {expanded ? "Show less" : "Read more"}
                    </Button>
                  ) : null}
                </div>

                {item.source_url ? (
                  <a
                    href={item.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    Source
                    <ExternalLinkIcon className="size-3.5" />
                  </a>
                ) : null}
              </CardContent>
            </Card>
          </li>
        )
      })}
    </ul>
  )
}
