import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The shared package ships TypeScript source; let Next compile it.
  transpilePackages: ['@deployx/shared'],
  eslint: { ignoreDuringBuilds: true },
  devIndicators: false, // the floating dev badge overlaps the sidebar footer
};

export default nextConfig;
