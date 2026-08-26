import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@boletera/shared', '@boletera/ui', '@boletera/venue-engine'],
};

export default nextConfig;
