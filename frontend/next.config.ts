import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pins the Turbopack workspace root to this project — avoids a stray
  // pnpm-lock.yaml elsewhere on the machine being misread as a monorepo
  // root boundary.
  turbopack: {
    root: path.join(__dirname),
  },
  // Standalone output for the Docker production image (docker/Dockerfile) —
  // bundles only the traced dependency subset needed to run `node server.js`.
  output: "standalone",
};

export default nextConfig;
