import { createHash, createHmac, randomBytes } from "node:crypto";

/** 256-bit URL-safe token. Only its hash is stored. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Rejects anything that is not a plausible token before it reaches a query. */
export function isWellFormedToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

/**
 * The manage/unsubscribe token for a subscriber, derived — not stored — so
 * every alert email can carry it while the database holds only its hash.
 * HMAC with ARTIST_ALERTS_TOKEN_SECRET; without the secret nothing runs.
 */
export function manageTokenFor(subscriberId: string, secret: string | undefined = process.env.ARTIST_ALERTS_TOKEN_SECRET): string {
  if (!secret || secret.length < 32) throw new Error("ARTIST_ALERTS_TOKEN_SECRET is not set (min. 32 characters).");
  return createHmac("sha256", secret).update(`manage:${subscriberId}`, "utf8").digest("base64url");
}
