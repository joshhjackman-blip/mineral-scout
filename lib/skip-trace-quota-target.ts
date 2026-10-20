/** Slider / job-size helpers for prepaid skip-trace burn. Safe for client import. */

export function clampQuotaTarget(
  remaining: number,
  requested?: number | null,
): number {
  const left = Math.max(0, Math.floor(Number(remaining) || 0))
  if (left <= 0) return 0
  if (requested == null) return left
  const n = Number(requested)
  if (!Number.isFinite(n)) return left
  return Math.min(left, Math.max(1, Math.floor(n)))
}

export function quotaTargetStep(remaining: number): number {
  if (remaining >= 2000) return 50
  if (remaining >= 500) return 25
  if (remaining >= 100) return 10
  return 1
}

export function quotaTargetPresets(remaining: number): number[] {
  const left = Math.max(0, Math.floor(remaining))
  if (left <= 0) return []
  const marks = [250, 500, 1000, 2500, 5000, 10000].filter((n) => n < left)
  return [...marks, left]
}
