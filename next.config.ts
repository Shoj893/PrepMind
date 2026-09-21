import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native addon: keep it out of the server bundler.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
