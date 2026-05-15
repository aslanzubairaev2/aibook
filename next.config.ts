import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['192.168.178.55', 'localhost:3000'],
};

export default nextConfig;
