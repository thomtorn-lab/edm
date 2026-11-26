import { NextRequest, NextResponse } from "next/server";
import { rejectUnlessVercelCron } from "@/lib/scheduledRequestAuth";

/**
 * Starts the existing read-only QA export (.github/workflows/qa-export-readonly.yml)
 * from Vercel Cron (vercel.json, twice a night), because GitHub's own schedule
 * dropped or delayed nearly every run in this repository (2026-11-25/26).
 *
 * It only asks GitHub to run the workflow with trigger=scheduled; the
 * workflow's clock job still allows at most one scheduled export per
 * Copenhagen day and none after 05:15. No database access here.
 *
 * Auth: Vercel Cron's `Authorization: Bearer <CRON_SECRET>` only.
 * GITHUB_QA_DISPATCH_TOKEN: fine-grained token, thomtorn-lab/edm only,
 * Actions: Read and write (Vercel Production env only). Never logged or returned.
 */
const QA_EXPORT_DISPATCH_URL =
  "https://api.github.com/repos/thomtorn-lab/edm/actions/workflows/qa-export-readonly.yml/dispatches";
const QA_EXPORT_REF = "claude/copenhagen-edm-events-site-3lo273";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const rejected = rejectUnlessVercelCron(request);
  if (rejected) return rejected;
  const token = process.env.GITHUB_QA_DISPATCH_TOKEN;
  if (!token) {
    console.error("[qa-export-trigger] GITHUB_QA_DISPATCH_TOKEN is not configured.");
    return NextResponse.json({ error: "GITHUB_QA_DISPATCH_TOKEN is not configured." }, { status: 500 });
  }
  try {
    const res = await fetch(QA_EXPORT_DISPATCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "electroniccph-qa-export-trigger",
      },
      body: JSON.stringify({ ref: QA_EXPORT_REF, inputs: { trigger: "scheduled" } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 204 || res.ok) return NextResponse.json({ dispatched: true });
    console.error(`[qa-export-trigger] GitHub responded ${res.status}.`);
    return NextResponse.json({ error: `GitHub responded ${res.status}.` }, { status: 502 });
  } catch (err) {
    console.error(`[qa-export-trigger] dispatch failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "Dispatch to GitHub failed." }, { status: 502 });
  }
}
