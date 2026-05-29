import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives in a subfolder of a repo that has its own lockfile at the
  // root. Pin Turbopack's root to this directory so file tracing and the dev
  // root are unambiguous.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
