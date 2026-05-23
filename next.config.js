/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.optimization.splitChunks = false
      config.optimization.minimize = false
    }
    return config
  }
}
module.exports = nextConfig
