import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The shared package ships TypeScript source; let Next compile it.
  transpilePackages: ['@deployx/shared'],
  eslint: { ignoreDuringBuilds: true },
  devIndicators: false, // the floating dev badge overlaps the sidebar footer
  experimental: {
    // Rewrite barrel imports to per-module imports so only the icons/components actually used get
    // compiled (@hugeicons/core-free-icons alone is ~12k files).
    optimizePackageImports: ['@hugeicons/core-free-icons', '@hugeicons/react', 'motion'],
  },
};

export default nextConfig;
