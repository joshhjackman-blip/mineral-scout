/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  output: 'standalone',
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
