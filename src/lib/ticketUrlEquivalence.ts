/**
 * Whether two ticket links are functionally the same URL, so an automated
 * sync need not overwrite the stored one (ticket-link history analysis,
 * 2026-10-23: 633 logged ticketUrl rewrites, one event alternating 316 times
 * between two spellings).
 *
 * Deliberately much narrower than dedup.ts's normalizeUrl, which is built
 * for event IDENTITY, not for which link a buyer should get: it forces
 * https, strips "www.", drops every utm_* parameter plus ref/affiliate, and
 * sorts the query. Any of those can change what a ticket link does (partner
 * or affiliate attribution, a host that only answers with or without www,
 * a plain-http link being upgraded on purpose), so none of them count here.
 *
 * Equivalent only when the two parse to the identical WHATWG URL, i.e. they
 * differ solely in what RFC 3986/WHATWG define as non-significant:
 * surrounding whitespace, the case of the scheme and host, an explicit
 * default port (:443 / :80), and an empty path versus "/". Query, path,
 * fragment, parameter order and percent-encoding are compared exactly. An
 * HTML-entity-escaped link ("&#038;" left in a query) is NOT equivalent to
 * its decoded form: the escaped one is broken in a browser, so replacing it
 * is a real fix. Anything unparseable, relative or non-http(s) is never
 * equivalent, which keeps today's behaviour for it.
 */
export function ticketUrlsEquivalent(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = parseHttpUrl(a);
  const y = parseHttpUrl(b);
  return x !== null && y !== null && x === y;
}

function parseHttpUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.href;
  } catch {
    return null;
  }
}
