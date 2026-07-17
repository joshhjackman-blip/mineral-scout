/** @type {import('next').NextConfig} */
// Build stamp: 2026-07-17 — force a fresh Vercel build so the UI
// redesign (Fraunces + Instrument Sans + Permian hero photo)
// actually ships. Vercel's GitHub webhook missed the earlier pushes,
// and reconnecting the integration doesn't retro-trigger a build.
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  output: 'standalone',
  // Bundle the Platform Services Agreement markdown alongside the
  // /legal/agreement route so its `fs.readFileSync` still resolves when
  // the page is served from a Vercel serverless function (Next's file
  // tracer misses filesystem reads outside app/ and public/ by default).
  outputFileTracingIncludes: {
    '/legal/agreement': ['./legal/**/*.md'],
  },
  async headers() {
    // Parcel GeoJSONs (both the full enriched and the slim map variants)
    // ship at unversioned URLs like /martin_parcels_map.geojson, and their
    // content changes whenever we re-enrich or re-tag. The previous config
    // set `max-age=31536000, immutable` on them, which pinned browsers to
    // whatever version they first fetched — every existing user was stuck
    // on the pre-production_status file forever, which is why parcels
    // rendered gray after the paint swap even though main had fresh data.
    //
    // Trade-off after the fix:
    //   * Browsers keep the file for 5 minutes without asking (`max-age=300`),
    //   * then revalidate via If-None-Match / ETag (`must-revalidate`),
    //   * so a fresh deploy propagates within ~5 minutes even if the URL
    //     doesn't change. Vercel's CDN still caches per-deploy under the
    //     hood, so origin load is unchanged.
    //
    // The county configs in lib/counties.ts additionally append a
    // ?v=... query string that gets bumped when the schema changes, so
    // major migrations (e.g. adding production_status) can force an
    // instant refresh instead of waiting the 5-minute TTL.
    return [
      {
        source: '/:filename(.*_parcels(?:_enriched|_map)?\\.geojson)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=300, must-revalidate',
          },
        ],
      },
    ]
  },
};

export default nextConfig;
