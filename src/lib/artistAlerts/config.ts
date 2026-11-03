/**
 * Artist Alerts settings (2026-11-02). One switch, ARTIST_ALERTS_MODE:
 * - "off" (default, also any unknown value): every Artist Alerts route answers
 *   404/503, nothing is reconciled or sent;
 * - "observe": the scheduled run reconciles lineups only — no subscriber data,
 *   no email;
 * - "test": signup and sending work only for addresses on
 *   ARTIST_ALERTS_TEST_ALLOWLIST; the public page stays hidden;
 * - "live": public.
 * Kept apart from the newsletter's NEWSLETTER_SIGNUP_ENABLED on purpose.
 */
export type ArtistAlertsMode = "off" | "observe" | "test" | "live";

export function artistAlertsMode(env: Record<string, string | undefined> = process.env): ArtistAlertsMode {
  const v = env.ARTIST_ALERTS_MODE;
  return v === "observe" || v === "test" || v === "live" ? v : "off";
}

/** Signup/manage/unsubscribe work (subject to the test allowlist in "test"). */
export function subscriptionsEnabled(mode: ArtistAlertsMode): boolean {
  return mode === "test" || mode === "live";
}

export function testAllowlist(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set(
    (env.ARTIST_ALERTS_TEST_ALLOWLIST ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Whether this address may subscribe / be emailed in the given mode. */
export function emailAllowed(email: string, mode: ArtistAlertsMode, env: Record<string, string | undefined> = process.env): boolean {
  if (mode === "live") return true;
  if (mode === "test") return testAllowlist(env).has(email.trim().toLowerCase());
  return false;
}

function intSetting(name: string, fallback: number, env: Record<string, string | undefined>): number {
  const n = Number(env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export interface AlertTiming {
  /** Safety hold between an appearance becoming public and its alert. */
  holdMs: number;
  /** At most this many alert emails per subscriber in any 24 hours. */
  maxEmailsPerDay: number;
  /** Never alert about an event starting sooner than this. */
  minLeadMs: number;
  /** A pending delivery older than this is dropped instead of sent late. */
  maxDeliveryAgeMs: number;
  /** Events listed in one email; the rest wait for the next one. */
  maxEventsPerEmail: number;
}

export function alertTiming(env: Record<string, string | undefined> = process.env): AlertTiming {
  return {
    holdMs: intSetting("ALERT_HOLD_MINUTES", 120, env) * 60_000,
    maxEmailsPerDay: intSetting("ALERT_MAX_EMAILS_PER_DAY", 2, env),
    minLeadMs: 6 * 3_600_000,
    maxDeliveryAgeMs: 72 * 3_600_000,
    maxEventsPerEmail: 10,
  };
}

export const ARTIST_ALERTS_CONSENT_VERSION = "2026-11-02";

/** Replies to any Artist Alerts email go to the site's ordinary inbox; the sending address itself stays send.electroniccph.com. */
export const ARTIST_ALERTS_REPLY_TO = "hello@electroniccph.com";

export const ARTIST_ALERTS_CONSENT_PURPOSE =
  "To email you when a new event with an artist you follow is listed on Electronic CPH. Only for the artists you choose; no newsletter. You can change your artists or unsubscribe at any time from the link in every email.";

/** Limits against abuse of the public signup. */
export const LIMITS = {
  maxFollowsPerSubscriber: 50,
  maxPendingRequestsPerSubscriber: 10,
  maxConfirmEmailsPerAddressPerDay: 3,
  maxConfirmEmailsPerHourGlobal: 30,
  unconfirmedRetentionMs: 7 * 86_400_000,
  historyRetentionMs: 30 * 86_400_000,
} as const;
