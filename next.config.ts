import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "puppeteer"],
  outputFileTracingExcludes: {
    "/api/ai-diary": ["./next.config.ts"],
  },
};

export default nextConfig;
