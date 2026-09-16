import { NextRequest, NextResponse } from "next/server";

/**
 * TEMPORARY diagnostic route (time-boxed KultuNaut connectivity investigation,
 * 2026-09-16) — tests whether the KultuNaut fetch failure observed from the
 * real Production sync (src/lib/adapters/kultunautAdapter.ts) is caused by
 * request shape/headers, by making the exact same request from the exact
 * same Vercel runtime the real sync uses. Read-only: no DB access, no writes,
 * never touches events/discovery_queue/sources. Removed immediately after
 * the diagnostic is captured — see the removal commit that follows this one.
 */

const URLS = [
  { label: "root", url: "https://www.kultunaut.dk/" },
  {
    label: "listing",
    url: "https://www.kultunaut.dk/perl/arrlist/type-nynaut?Genre=Elektronisk&Area=Kbh.+og+Frederiksberg",
  },
];

const PROFILES: { label: string; headers: Record<string, string> }[] = [
  {
    label: "A_current",
    headers: {
      "user-agent": "NattefrekvensBot/1.0 (+https://nattefrekvens.dk/about; first-party sync)",
      accept: "text/html",
    },
  },
  {
    label: "B_current_ua_normal_headers",
    headers: {
      "user-agent": "NattefrekvensBot/1.0 (+https://nattefrekvens.dk/about; first-party sync)",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "da-DK,da;q=0.9,en;q=0.8",
    },
  },
  {
    label: "C_browser_diagnostic_only",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "da-DK,da;q=0.9,en;q=0.8",
    },
  },
];

function serializeError(err: unknown) {
  if (!(err instanceof Error)) return { message: String(err) };
  const cause = (err as { cause?: unknown }).cause;
  const causeObj = cause && typeof cause === "object" ? (cause as Record<string, unknown>) : null;
  return {
    name: err.name,
    message: err.message,
    cause: causeObj
      ? {
          name: causeObj.name,
          message: causeObj.message,
          code: causeObj.code,
          errno: causeObj.errno,
          syscall: causeObj.syscall,
          hostname: causeObj.hostname,
          address: causeObj.address,
          port: causeObj.port,
        }
      : null,
  };
}

export async function GET(request: NextRequest) {
  const token = process.env.SYNC_TRIGGER_TOKEN;
  if (!token || request.headers.get("x-sync-token") !== token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const results: Record<string, unknown> = {};
  for (const { label: urlLabel, url } of URLS) {
    for (const { label: profileLabel, headers } of PROFILES) {
      const key = `${urlLabel}__${profileLabel}`;
      const start = Date.now();
      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
        const body = await res.text();
        results[key] = {
          success: res.ok,
          status: res.status,
          elapsedMs: Date.now() - start,
          responseSize: body.length,
        };
      } catch (err) {
        results[key] = {
          success: false,
          status: null,
          elapsedMs: Date.now() - start,
          responseSize: null,
          error: serializeError(err),
        };
      }
    }
  }

  return NextResponse.json({ results });
}
