/**
 * Shared "is this a real, usable link" check (event-level link editing,
 * 2026-09-07) — the same http(s)-only validation `/api/admin/extract`
 * already applied ad hoc to a pasted source URL, pulled out so the admin
 * event-edit path (officialEventUrl/ticketUrl) can reuse it instead of
 * re-implementing it. Intentionally permissive beyond protocol/parseability
 * — this never rejects a URL for being "unusual," only for being
 * structurally unusable as a link.
 */
export function isValidHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:";
}
