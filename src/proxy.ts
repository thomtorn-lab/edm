import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * Gates /admin (the internal review UI) and /api/admin/* (the write API it
 * calls — publish/edit/hide events, resolve the discovery queue) behind HTTP
 * Basic Auth. This is deliberately not a user-management system: a single
 * shared credential pair via env vars is the simplest production-
 * appropriate stopgap for a single/small-team internal tool, per the brief
 * ("without building a large user-management system"). ADMIN_USERNAME and
 * ADMIN_PASSWORD must be set in production — if either is unset, access is
 * denied outright (fail closed), never silently left open.
 *
 * /api/sync/[source] is NOT covered here — it has its own, separate
 * x-sync-token check (see that route) so the GitHub Actions scheduler can
 * call it without a browser-style Basic Auth prompt.
 */

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch rather than returning
  // false, so pad both to the same length first — comparing against a
  // same-length buffer keeps the comparison itself constant-time even when
  // the inputs aren't, at the cost of leaking only the length difference.
  const maxLen = Math.max(aBuf.length, bBuf.length, 1);
  const aPadded = Buffer.concat([aBuf], maxLen);
  const bPadded = Buffer.concat([bBuf], maxLen);
  return aBuf.length === bBuf.length && timingSafeEqual(aPadded, bPadded);
}

function unauthorized(): Response {
  return new Response("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Nattefrekvens admin", charset="UTF-8"' },
  });
}

export function proxy(request: NextRequest): Response {
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedPass = process.env.ADMIN_PASSWORD;
  if (!expectedUser || !expectedPass) {
    return unauthorized();
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Basic ")) {
    return unauthorized();
  }

  let decoded: string;
  try {
    decoded = Buffer.from(authHeader.slice("Basic ".length), "base64").toString("utf-8");
  } catch {
    return unauthorized();
  }
  const separatorIdx = decoded.indexOf(":");
  const user = separatorIdx === -1 ? decoded : decoded.slice(0, separatorIdx);
  const pass = separatorIdx === -1 ? "" : decoded.slice(separatorIdx + 1);

  if (!safeEqual(user, expectedUser) || !safeEqual(pass, expectedPass)) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};
