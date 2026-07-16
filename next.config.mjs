/** @type {import('next').NextConfig} */
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
    // Aggressive caching for the parcel GeoJSON files. They're large and
    // immutable per deploy; a year-long max-age + immutable hint keeps them
    // out of the network path on every county switch after the first load.
    return [
      {
        source: '/:filename(.*_parcels(?:_enriched|_map)?\\.geojson)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ]
  },
};

export default nextConfig;
