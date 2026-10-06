import { after } from "next/server";
import { sweepNewsletterRetention } from "@/db/newsletter";

/**
 * Best-effort, non-blocking retention trigger for every newsletter write
 * path that ISN'T the dedicated send job (GDPR final hardening round,
 * 2026-10-06) — subscribe/confirm/unsubscribe each call this so retention
 * keeps running even if the scheduled workflow that drives
 * /api/newsletter/send stops firing entirely (see sweepNewsletterRetention's
 * own doc comment in db/newsletter.ts for why relying on a single
 * scheduled trigger isn't reliable enough on its own). Runs after the
 * response has already been sent (next/server's after()), so a
 * signup/confirm/unsubscribe request never waits on it; falls back to a
 * plain await when called with no active request (after() throws
 * synchronously in that case — confirmed in
 * node_modules/next/dist/server/after/after.js), which is what a test
 * environment hits. Mirrors the identical deferred-work shape already
 * established in src/db/writes.ts's own deferOrRun for the same reason.
 */
export async function triggerRetentionSweep(): Promise<void> {
  const run = async () => {
    await sweepNewsletterRetention();
  };
  try {
    after(run);
  } catch {
    await run();
  }
}
