'use client'

import { useEffect, useState } from 'react'

type ImageryChipData = {
  url: string
  date: string
  cloudCover: number | null
  sceneId: string
  source: 'skyfi' | 'sentinel-2' | string
  provider?: string | null
  constellation?: string | null
  resolution?: string | null
  gsdCm?: number | null
}

type Props = {
  lat: number | null | undefined
  lon: number | null | undefined
  /** When true, fill a taller pad-activity panel (vs compact drawer). */
  tall?: boolean
  label?: string
}

function sourceLabel(chip: ImageryChipData | null): string {
  if (!chip) return 'Imagery'
  if (chip.source === 'skyfi') {
    const bits = ['SkyFi']
    if (chip.resolution) bits.push(String(chip.resolution))
    else if (chip.gsdCm != null) bits.push(`${Math.round(chip.gsdCm)} cm`)
    return bits.join(' · ')
  }
  return 'Sentinel-2'
}

/**
 * Shows the best available on-demand pad preview (SkyFi when keyed,
 * otherwise Sentinel-2) for a lat/lon.
 */
export default function SentinelLatestChip({
  lat,
  lon,
  tall = false,
  label = 'Latest',
}: Props) {
  const [chip, setChip] = useState<ImageryChipData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      setChip(null)
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
    })
    fetch(`/api/pad-activity/sentinel?${params.toString()}`)
      .then(async (res) => {
        const json = await res.json()
        if (cancelled) return
        if (!json?.success || !json?.data?.url) {
          setChip(null)
          setError(json?.error || 'No imagery preview')
          return
        }
        setChip(json.data as ImageryChipData)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setChip(null)
        setError(err instanceof Error ? err.message : 'Imagery lookup failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [lat, lon])

  const height = tall ? 220 : 112
  const hasCoords = lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)

  return (
    <div
      style={{
        minHeight: height,
        display: 'flex',
        flexDirection: 'column',
        background: '#0F172A',
        flex: 1,
      }}
    >
      <div
        style={{
          padding: tall ? '6px 10px' : '4px 8px',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: '#94A3B8',
          background: tall ? '#F8FAFC' : '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span>{label}</span>
        <span
          style={{
            fontWeight: 600,
            color: chip?.source === 'skyfi' ? '#0F766E' : '#CBD5E1',
          }}
        >
          {sourceLabel(chip)}
        </span>
        {chip?.date && (
          <span style={{ fontWeight: 500, marginLeft: 'auto', color: '#64748B' }}>
            {chip.date}
            {chip.cloudCover != null ? ` · ${Math.round(chip.cloudCover)}% cloud` : ''}
          </span>
        )}
      </div>
      {chip?.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={chip.url}
          alt="Latest pad imagery preview"
          style={{
            width: '100%',
            height,
            objectFit: 'cover',
            background: '#0F172A',
          }}
        />
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: height,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 12,
            textAlign: 'center',
            fontSize: 12,
            color: '#94A3B8',
            lineHeight: 1.4,
            background: tall ? '#F8FAFC' : '#F9FAFB',
          }}
        >
          {!hasCoords
            ? 'No coordinates on this lead yet'
            : loading
              ? 'Loading latest imagery…'
              : error || 'No recent imagery'}
        </div>
      )}
    </div>
  )
}
