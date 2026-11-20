import type { NextConfig } from "next";

const VIDEO_ENGINE_URL = process.env.VIDEO_ENGINE_URL || "http://127.0.0.1:8500";

// Folders the Python services, scrapers and video engine write to while the app runs. In development the file
// watcher used to treat every one of those writes (the news scraper alone saves its database every minute) as a
// source change, so the page rebuilt and flashed unstyled at random. Nothing here is imported by the web app.
const WATCH_IGNORED = [
  "**/.git/**",
  "**/node_modules/**",
  "**/.next/**",
  "**/.venv/**",
  "**/.runtime/**",
  "**/logs/**",
  "**/news-feed/**",
  "**/scrapper/**",
  "**/paper-trading/**",
  "**/india-trade-cli/**",
  "**/video-engine/**",
  "**/doc_Scrapper/**",
  "**/Blackbook/**",
  "**/Finpilot Project Realted Documents/**",
  "**/public/videos/**",
  "**/public/audio/**",
  "**/public/images/nifty-shorts/**",
  "**/src/data/nifty_shorts_cache.json",
];

const nextConfig: NextConfig = {
  // the floating "Compiling..." badge in dev mode is just noise during demos
  devIndicators: false,
  // The TradingView client opens raw websockets; bundling it breaks them and every quote/chart call times out.
  serverExternalPackages: ["@mathieuc/tradingview", "ws", "bufferutil", "utf-8-validate"],
  turbopack: {
    root: __dirname,
  },
  webpack: (config, { isServer, dev }) => {
    if (isServer) {
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push("@mathieuc/tradingview", "ws", "bufferutil", "utf-8-validate");
      }
    }
    if (dev) {
      config.watchOptions = { ...config.watchOptions, ignored: WATCH_IGNORED };
    }
    return config;
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
