/** Public map layers: Storage first (nightly / newly uploaded), then /public. */

export function countyStorageUrl(file: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '')
  if (!base) return ''
  return `${base}/storage/v1/object/public/map-data/${file}`
}

export function countyAssetUrls(file: string, cacheTag?: string): string[] {
  const suffix = cacheTag ? `?v=${cacheTag}` : ''
  return [countyStorageUrl(file), `/${file}${suffix}`].filter(Boolean)
}

export async function fetchCountyAsset(
  file: string,
  cacheTag?: string,
): Promise<Response | null> {
  for (const url of countyAssetUrls(file, cacheTag)) {
    try {
      const res = await fetch(url)
      if (res.ok) return res
    } catch {
      // try next source
    }
  }
  return null
}
