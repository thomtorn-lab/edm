import type { NextConfig } from "next";
import { SITE_URL } from "./src/lib/siteUrl";

const nextConfig: NextConfig = {
  /**
   * GDPR final hardening round, 2026-10-06 — token/data-exposure review.
   * Newsletter confirm/manage pages carry a single-use confirmToken/
   * manageToken in their URL (the entire auth model for a no-account
   * design). Two defense-in-depth headers, verifiable in code rather than
   * relying on framework/browser defaults:
   *
   * - Referrer-Policy: site-wide, strict-origin-when-cross-origin — a
   *   cross-origin request from a token-bearing page (e.g. the Analytics
   *   script, or any future third-party resource) gets only the origin in
   *   its Referer header, never the path/query where the token lives.
   *   Modern browsers already default to this, but setting it explicitly
   *   means it no longer depends on a browser default remaining what it
   *   is today.
   * - Cache-Control: no-store on every newsletter page/route — these
   *   render token-specific content and must never be served from a
   *   shared/CDN cache to a different visitor. Next.js already renders
   *   them dynamically (searchParams usage forces that), but this removes
   *   any dependency on that remaining true as an implementation detail.
   */
  /**
   * Retired event URLs (2026-10-07). /events/[slug] only serves published
   * events, so an admin-unpublished duplicate's old URL 404s even though the
   * same real event lives on under a new slug. One entry per known case:
   * - Sunday Psy, Hangaren, 13 Sep 2026: the synced "Sunday Psy: Maurinstarr,
   *   Milo Makua, RunaRift, Afgang" (e-ed02665a, public 24 Aug–8 Sep) was
   *   replaced by the admin-created e-b4a8bd2e — same official Hangaren URL,
   *   RA ticket, venue and start time.
   * Absolute www destination, so the redirect lands on the canonical host in
   * a single hop.
   */
  async redirects() {
    return [
      {
        source: "/events/sunday-psy-maurinstarr-milo-makua-runarift-afgang-e-ed02665a",
        destination: `${SITE_URL}/events/sunday-psy-e-b4a8bd2e`,
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }],
      },
      {
        source: "/newsletter/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        source: "/api/newsletter/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;
