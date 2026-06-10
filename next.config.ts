import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  // Replaces the default "apis" rule (same cacheName wins, other defaults stay).
  // Default kept API GET responses for 24h, so with a dead server the app
  // silently showed day-old catalog/progress. Keep a short offline fallback
  // only: 5 minutes. Staleness beyond that is surfaced by ConnectivityBanner.
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    runtimeCaching: [
      {
        urlPattern: ({ sameOrigin, url: { pathname } }) =>
          sameOrigin && pathname.startsWith("/api/") && !pathname.startsWith("/api/auth/callback"),
        handler: "NetworkFirst",
        method: "GET",
        options: {
          cacheName: "apis",
          networkTimeoutSeconds: 10,
          expiration: { maxEntries: 32, maxAgeSeconds: 5 * 60 },
        },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['192.168.178.55', 'localhost:3000'],
};

export default withPWA(nextConfig);
