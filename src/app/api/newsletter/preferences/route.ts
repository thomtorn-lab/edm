import { NextRequest, NextResponse } from "next/server";
import { sanitizeGenreSelection, updateSubscriberGenres } from "@/db/newsletter";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { token, genres } = body as Record<string, unknown>;
  if (typeof token !== "string" || !token) {
    return NextResponse.json({ error: "Missing token." }, { status: 400 });
  }

  const sanitized = sanitizeGenreSelection(genres);
  const updated = await updateSubscriberGenres(token, sanitized);
  if (!updated) {
    return NextResponse.json({ error: "This link is no longer valid." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, genres: sanitized });
}
