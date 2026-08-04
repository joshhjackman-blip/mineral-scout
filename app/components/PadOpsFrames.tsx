'use client'

import { useEffect, useState } from 'react'
import type { AnnotationBox } from '@/lib/pad-activity-explanations'

type Props = {
  beforeUrl: string | null
  afterUrl: string | null
  beforeLabel: string
  afterLabel: string
  annotations: AnnotationBox[]
  /** When no stored pair, show a single on-demand preview. */
  fallbackLat?: number | null
  fallbackLon?: number | null
  showAnnotationsOn?: 'after' | 'both' | 'none'
}

type OnDemand = {
  url: string
  date: string
  source: string
  resolution?: string | null
}

function Frame({
  label,
  url,
  annotations,
  emptyHint,
}: {
  label: string
  url: string | null
  annotations?: AnnotationBox[]
  emptyHint: string
}) {
  return (
    <div className="pad-ops-frame">
      <div className="pad-ops-frame-label">{label}</div>
      <div className="pad-ops-frame-img-wrap">
        {url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={label} />
            {(annotations || []).map((box, i) => (
              <div
                key={box.id}
                className="pad-ops-anno"
                data-tone={box.tone}
                style={{
                  left: `${box.left}%`,
                  top: `${box.top}%`,
                  width: `${box.width}%`,
                  height: `${box.height}%`,
                  animationDelay: `${0.08 * i}s`,
                }}
              >
                <span className="pad-ops-anno-tag">
                  {box.id} · {box.label}
                </span>
              </div>
            ))}
          </>
        ) : (
          <div className="pad-ops-empty-frame">{emptyHint}</div>
        )}
      </div>
    </div>
  )
}

export default function PadOpsFrames({
  beforeUrl,
  afterUrl,
  beforeLabel,
  afterLabel,
  annotations,
  fallbackLat,
  fallbackLon,
  showAnnotationsOn = 'after',
}: Props) {
  const [onDemand, setOnDemand] = useState<OnDemand | null>(null)
  const [loadingOd, setLoadingOd] = useState(false)
  const hasPair = Boolean(beforeUrl || afterUrl)

  useEffect(() => {
    if (hasPair) {
      setOnDemand(null)
      return
    }
    if (
      fallbackLat == null ||
      fallbackLon == null ||
      !Number.isFinite(fallbackLat) ||
      !Number.isFinite(fallbackLon)
    ) {
      setOnDemand(null)
      return
    }
    let cancelled = false
    setLoadingOd(true)
    const params = new URLSearchParams({
      lat: String(fallbackLat),
      lon: String(fallbackLon),
    })
    fetch(`/api/pad-activity/sentinel?${params.toString()}`)
      .then(async (res) => {
        const json = await res.json()
        if (cancelled) return
        if (json?.success && json?.data?.url) {
          setOnDemand({
            url: json.data.url,
            date: json.data.date || '',
            source: json.data.source || 'sentinel-2',
            resolution: json.data.resolution,
          })
        } else {
          setOnDemand(null)
        }
      })
      .catch(() => {
        if (!cancelled) setOnDemand(null)
      })
      .finally(() => {
        if (!cancelled) setLoadingOd(false)
      })
    return () => {
      cancelled = true
    }
  }, [hasPair, fallbackLat, fallbackLon])

  if (!hasPair) {
    const label = onDemand
      ? `${onDemand.source === 'skyfi' ? 'SkyFi' : 'Sentinel'} pad chip · ${onDemand.date || 'latest'}`
      : loadingOd
        ? 'Cropping pad scene…'
        : 'Pad scene'
    return (
      <div className="pad-ops-frames" style={{ gridTemplateColumns: '1fr' }}>
        <Frame
          label={label}
          url={onDemand?.url || null}
          annotations={onDemand ? annotations : undefined}
          emptyHint={
            loadingOd
              ? 'Cropping a pad-centered Sentinel scene for this well…'
              : 'No coordinates or scene available yet for this signal.'
          }
        />
      </div>
    )
  }

  const afterAnnos =
    showAnnotationsOn === 'after' || showAnnotationsOn === 'both' ? annotations : undefined
  const beforeAnnos = showAnnotationsOn === 'both' ? annotations : undefined

  return (
    <div className="pad-ops-frames">
      <Frame
        label={beforeLabel}
        url={beforeUrl}
        annotations={beforeAnnos}
        emptyHint="Before chip not stored yet — weekly Sentinel job will land this path."
      />
      <Frame
        label={afterLabel}
        url={afterUrl}
        annotations={afterAnnos}
        emptyHint="After chip not stored yet — weekly Sentinel job will land this path."
      />
    </div>
  )
}
