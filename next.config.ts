import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Prisma needs to be treated as an external in server components/runtime.
  serverExternalPackages: ["@prisma/client", "googleapis"],
};

export default nextConfig;
