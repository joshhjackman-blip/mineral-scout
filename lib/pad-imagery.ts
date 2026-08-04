/**
 * Latest pad imagery: SkyFi hi-res preview when SKYFI_API_KEY is set,
 * otherwise (or on miss) free Sentinel-2 from Element84 Earth Search.
 */

import { fetchLatestSentinel, type SentinelLatest } from '@/lib/sentinel-latest'
import { fetchLatestSkyfi, type SkyfiLatest } from '@/lib/skyfi-latest'

export type PadImagery = {
  url: string
  date: string
  cloudCover: number | null
  sceneId: string
  source: 'skyfi' | 'sentinel-2'
  provider?: string | null
  constellation?: string | null
  resolution?: string | null
  gsdCm?: number | null
}

function asPadImagery(chip: SkyfiLatest | SentinelLatest): PadImagery {
  if (chip.source === 'skyfi') {
    return {
      url: chip.url,
      date: chip.date,
      cloudCover: chip.cloudCover,
      sceneId: chip.sceneId,
      source: 'skyfi',
      provider: chip.provider,
      constellation: chip.constellation,
      resolution: chip.resolution,
      gsdCm: chip.gsdCm,
    }
  }
  return {
    url: chip.url,
    date: chip.date,
    cloudCover: chip.cloudCover,
    sceneId: chip.sceneId,
    source: 'sentinel-2',
  }
}

export async function fetchLatestPadImagery(
  lat: number,
  lon: number,
): Promise<PadImagery | null> {
  // Prefer SkyFi commercial preview when the key is present.
  try {
    const skyfi = await fetchLatestSkyfi(lat, lon)
    if (skyfi?.url) return asPadImagery(skyfi)
  } catch {
    // fall through to Sentinel
  }

  try {
    const sentinel = await fetchLatestSentinel(lat, lon)
    if (sentinel?.url) return asPadImagery(sentinel)
  } catch {
    return null
  }
  return null
}
