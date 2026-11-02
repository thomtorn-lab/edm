import type { ArtistRequestInput } from "@/db/artistAlerts";

/** Defensive parsing of the public JSON bodies: unknown shapes become empty lists, never errors. */
export function parseIdList(value: unknown, max = 50): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string" && /^art_[A-Za-z0-9-]{8,64}$/.test(v)))].slice(0, max);
}

export function parseRequests(value: unknown, max = 10): ArtistRequestInput[] {
  if (!Array.isArray(value)) return [];
  const out: ArtistRequestInput[] = [];
  for (const v of value) {
    if (typeof v !== "object" || v === null) continue;
    const { name, profileUrl } = v as Record<string, unknown>;
    if (typeof name !== "string" || name.trim().length < 2 || name.length > 80) continue;
    out.push({ name: name.trim(), profileUrl: typeof profileUrl === "string" ? profileUrl.slice(0, 300) : null });
    if (out.length >= max) break;
  }
  return out;
}
