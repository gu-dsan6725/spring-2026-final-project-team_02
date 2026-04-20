import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Redirect build output to native Linux filesystem to avoid WSL/NTFS I/O errors.
  distDir: process.env.NEXT_DIST_DIR ?? '/home/manav/.cache/herald-next',
};

export default nextConfig;
