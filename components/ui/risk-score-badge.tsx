"use client"

import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type RiskScoreBadgeProps = {
  score: number
  size?: "sm" | "lg"
  className?: string
}

type RiskTier = {
  label: "Low Risk" | "Moderate Risk" | "High Risk" | "Critical Risk"
  badgeClassName: string
  barClassName: string
}

function getTier(score: number): RiskTier {
  if (score <= 25) {
    return {
      label: "Low Risk",
      badgeClassName: "bg-emerald-100 text-emerald-800 border-emerald-200",
      barClassName: "bg-emerald-500",
    }
  }
  if (score <= 50) {
    return {
      label: "Moderate Risk",
      badgeClassName: "bg-amber-100 text-amber-800 border-amber-200",
      barClassName: "bg-amber-500",
    }
  }
  if (score <= 75) {
    return {
      label: "High Risk",
      badgeClassName: "bg-orange-100 text-orange-800 border-orange-200",
      barClassName: "bg-orange-500",
    }
  }
  return {
    label: "Critical Risk",
    badgeClassName: "bg-red-100 text-red-800 border-red-200",
    barClassName: "bg-red-500",
  }
}

export default function RiskScoreBadge({
  score,
  size = "sm",
  className,
}: RiskScoreBadgeProps) {
  const normalizedScore = Math.max(0, Math.min(100, Math.round(score)))
  const tier = getTier(normalizedScore)

  return (
    <Tooltip>
      <TooltipTrigger
        className={cn("inline-flex items-center rounded-md", className)}
        aria-label={`Risk score ${normalizedScore}`}
      >
        {size === "sm" ? (
          <span
            className={cn(
              "inline-flex h-6 min-w-10 items-center justify-center rounded-md border px-2 text-xs font-semibold",
              tier.badgeClassName
            )}
          >
            {normalizedScore}
          </span>
        ) : (
          <div className="inline-flex items-center gap-2">
            <span
              className={cn(
                "inline-flex h-7 min-w-12 items-center justify-center rounded-md border px-2.5 text-sm font-semibold",
                tier.badgeClassName
              )}
            >
              {normalizedScore}
            </span>
            <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
              <div
                className={cn("h-full rounded-full transition-all", tier.barClassName)}
                style={{ width: `${normalizedScore}%` }}
              />
            </div>
          </div>
        )}
      </TooltipTrigger>
      <TooltipContent>{tier.label}</TooltipContent>
    </Tooltip>
  )
}
