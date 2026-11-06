import { NextRequest, NextResponse } from "next/server";
import { updateFollowsByManageToken } from "@/db/artistAlerts";
import { artistAlertsMode, subscriptionsEnabled } from "@/lib/artistAlerts/config";
import { parseIdList, parseRequests } from "@/lib/artistAlerts/requestParsing";
import { notifyAdminOfRequests } from "@/lib/artistAlerts/notify";
import { isWellFormedToken } from "@/lib/artistAlerts/tokens";

/** Add or remove followed artists from the manage page (the token in every email). */
export async function POST(request: NextRequest) {
  if (!subscriptionsEnabled(artistAlertsMode())) return NextResponse.json({ error: "Not available." }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isWellFormedToken(body?.token)) return NextResponse.json({ error: "Invalid link." }, { status: 400 });
  const result = await updateFollowsByManageToken(body.token as string, {
    add: parseIdList(body.add),
    remove: parseIdList(body.remove),
    requests: parseRequests(body.requests),
  });
  if (!result) return NextResponse.json({ error: "Invalid link." }, { status: 400 });
  await notifyAdminOfRequests(result.newRequests);
  return NextResponse.json({ ok: true });
}
