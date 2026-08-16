/**
 * Shared client + server validation for the contact and suggest-event
 * forms. Deliberately permissive (no RFC 5322 parsing, no punycode
 * handling) — this only needs to catch obvious typos before an email
 * round-trips to Resend, which does its own real validation.
 */

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
