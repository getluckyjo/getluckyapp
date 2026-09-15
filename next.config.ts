import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { withSerwist } from "@serwist/turbopack";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  env: {
    // Stamped at build time and shown on the Account screen, sent with every
    // feedback submission and attached to Sentry events.
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString(),
  },
};

// Source maps are uploaded to Sentry only when SENTRY_AUTH_TOKEN is present
// (set it in Vercel for Production and Preview). Without it the build still
// succeeds and Sentry shows minified frames.
// withSerwist only marks esbuild as a server-external package so the
// service-worker route handler can bundle src/app/sw.ts at build time.
export default withSentryConfig(withSerwist(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  // Route browser events through this origin so ad-blockers do not drop them.
  tunnelRoute: "/monitoring",
  disableLogger: true,
  automaticVercelMonitors: false,
  telemetry: false,
});
