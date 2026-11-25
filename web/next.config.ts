import type { NextConfig } from "next";

/** Versão web: site estático para o GitHub Pages (ver scripts/montar-web.py). */
const nextConfig: NextConfig = {
  output: "export",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH,
  trailingSlash: true,
  reactStrictMode: true,
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
  // Os tipos são conferidos no projeto principal
  typescript: { ignoreBuildErrors: true },
  productionBrowserSourceMaps: false,
};

export default nextConfig;
