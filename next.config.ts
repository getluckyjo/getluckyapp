import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
};

// Source maps are uploaded to Sentry only when SENTRY_AUTH_TOKEN is present
// (set it in Vercel for Production and Preview). Without it the build still
// succeeds and Sentry shows minified frames.
export default withSentryConfig(nextConfig, {
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
