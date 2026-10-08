import type { NextConfig } from "next";

const VIDEO_ENGINE_URL = process.env.VIDEO_ENGINE_URL || "http://127.0.0.1:8500";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  async rewrites() {
    return [
      {
        source: "/videos/:path*",
        destination: `${VIDEO_ENGINE_URL}/videos/:path*`,
      },
      {
        source: "/audio/:path*",
        destination: `${VIDEO_ENGINE_URL}/audio/:path*`,
      },
      {
        source: "/images/:path*",
        destination: `${VIDEO_ENGINE_URL}/images/:path*`,
      },
      {
        source: "/api/images/:path*",
        destination: `${VIDEO_ENGINE_URL}/api/images/:path*`,
      },
    ];
  },
};

export default nextConfig;
