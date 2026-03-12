/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: [
    "*.agent.cvm.dev",
    "*.cursorvm.com",
    "localhost:3000",
    "127.0.0.1:3000",
  ],
  experimental: {
    serverActions: {},
  },
}

export default nextConfig
