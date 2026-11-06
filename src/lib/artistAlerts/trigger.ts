import { after } from "next/server";
import { artistAlertsMode } from "./config";
import { notifyAdminOfFollowedReview } from "./notify";

/**
 * Starts the Artist Alerts clock as soon as an event's public state or
 * lineup may have changed (publish, edit, create, source sync), instead of
 * waiting for the next scheduled run (2026-11-06, the Ayla event: published
 * 07:24, first seen by a scheduled run at 10:50 because GitHub's schedule
 * ran late). Only the lineup reconcile runs here: it records when each
 * appearance became public (event_artists.visible_since). Planning and
 * sending stay in the scheduled run, so the 120-minute hold, sending hours
 * and daily cap are untouched, and this request never sends an email.
 *
 * Runs after the response (next/server's after()); a failure is logged and
 * never affects the request. Does nothing in mode "off". Idempotent and
 * advisory-locked, so a concurrent run simply skips this one.
 */
export function reconcileArtistsSoon(): void {
  if (artistAlertsMode() === "off") return;
  const run = async () => {
    try {
      // Loaded lazily, so the routes that call this never open a database client just by importing it.
      const { reconcileArtistAppearances } = await import("@/db/artistAppearances");
      const mode = artistAlertsMode();
      // Admin notices only once subscriber data is in use (test/live), as in the scheduled run.
      await reconcileArtistAppearances(new Date(), mode === "test" || mode === "live" ? { onFollowedReview: notifyAdminOfFollowedReview } : {});
    } catch (err) {
      console.error("artist alerts reconcile after write failed:", err instanceof Error ? err.message : err);
    }
  };
  try {
    after(run);
  } catch {
    // Outside a request (scripts): nothing to defer to; the scheduled run catches up.
  }
}
