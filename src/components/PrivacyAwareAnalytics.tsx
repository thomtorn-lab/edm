"use client";

import { Analytics } from "@vercel/analytics/next";
import { stripSensitiveQueryParams } from "@/lib/analytics";

/**
 * Thin Client Component wrapper (GDPR audit, 2026-10-06): a Server
 * Component (the root layout) cannot pass a function prop like `beforeSend`
 * to a Client Component — React has no way to serialize a closure across
 * that boundary. Defining and using stripSensitiveQueryParams entirely
 * inside this client module avoids that, while keeping layout.tsx itself a
 * plain Server Component.
 */
export default function PrivacyAwareAnalytics() {
  return <Analytics beforeSend={stripSensitiveQueryParams} />;
}
