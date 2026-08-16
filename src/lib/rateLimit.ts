import type { NextRequest } from "next/server";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 5;

const hits = new Map<string, number[]>();

/**
 * In-memory, per-server-instance sliding-window limiter. It resets on
 * redeploy and doesn't share state across instances/regions, so treat it
 * as a speed bump against casual abuse (a bot hammering the endpoint),
 * not a hard guarantee — appropriate for a low-volume public form without
 * pulling in an external store.
 */
export function isRateLimited(key: string, now: number = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((timestamp) => now - timestamp < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > MAX_REQUESTS_PER_WINDOW;
}

export function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}
