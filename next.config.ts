import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "vhs.resultapp.org",
    "10.17.105.252",
    "localhost:3000"
  ],
};

export default nextConfig;