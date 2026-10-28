import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Auth-gated DB pages; keep classic dynamic rendering for MVP.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
