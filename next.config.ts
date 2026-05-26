import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Cover every URL variant Google Play or Apple may have on file
      { source: '/privacy-policy', destination: '/privacy', permanent: true },
      { source: '/privacy-policy.html', destination: '/privacy', permanent: true },
      { source: '/privacy_policy', destination: '/privacy', permanent: true },
      { source: '/privacy_policy.html', destination: '/privacy', permanent: true },
      { source: '/privacypolicy', destination: '/privacy', permanent: true },
      { source: '/privacypolicy.html', destination: '/privacy', permanent: true },
    ]
  },
};

export default nextConfig;
