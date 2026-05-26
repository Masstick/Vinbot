import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.vinted.fr' },
      { protocol: 'https', hostname: '**.vinted.com' },
    ],
  },
};

export default nextConfig;
