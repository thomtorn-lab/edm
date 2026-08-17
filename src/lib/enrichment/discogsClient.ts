/**
 * Minimal Discogs API client for genre enrichment (task 9, MVP). Discogs'
 * Artist resource has no genre field — genre/style live on Release
 * resources — so a lookup is: search for the artist by exact name, then
 * pull genre/style off a handful of their most recent releases. See
 * src/lib/enrichment/discogsGenreMapping.ts for how that data becomes a
 * GenreSlug, and src/db/enrichment.ts for caching + orchestration.
 *
 * Credentials: DISCOGS_TOKEN is OPTIONAL. Unauthenticated requests work but
 * are capped at 25/min; a personal access token (Settings > Developers on
 * discogs.com) raises that to 60/min and is recommended for production, but
 * this client works without one — it just falls back to a lower rate limit
 * rather than failing. The token, if set, is only ever placed in the
 * Authorization header, never logged.
 */

const DISCOGS_BASE_URL = "https://api.discogs.com";
const USER_AGENT = "NattefrekvensGenreEnrichment/1.0 (+https://nattefrekvens.dk/about; genre-enrichment)";
const DEFAULT_TIMEOUT_MS = 8_000;

export interface DiscogsArtistSearchResult {
  id: number;
  title: string; // artist name, possibly with a Discogs disambiguation suffix like "SKALA (2)"
}

export interface DiscogsReleaseGenreData {
  genres: string[]; // coarse field, e.g. ["Electronic"]
  styles: string[]; // fine-grained field, e.g. ["Tech House"]
}

function authHeaders(): HeadersInit {
  const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "application/vnd.discogs.v2.discogs+json" };
  const token = process.env.DISCOGS_TOKEN;
  if (token) headers["Authorization"] = `Discogs token=${token}`;
  return headers;
}

async function discogsGet(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  const res = await fetch(`${DISCOGS_BASE_URL}${path}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Discogs request failed: HTTP ${res.status} for ${path}`);
  }
  return res.json();
}

export async function searchArtist(name: string): Promise<DiscogsArtistSearchResult[]> {
  const data = (await discogsGet(`/database/search?q=${encodeURIComponent(name)}&type=artist&per_page=10`)) as {
    results?: { id: number; title: string; type: string }[];
  };
  return (data.results ?? []).filter((r) => r.type === "artist").map((r) => ({ id: r.id, title: r.title }));
}

/**
 * Only plain "release" entries (not "master" — those need a separate
 * /masters/{id} lookup for genre data, deliberately out of scope for this
 * MVP: if an artist's Discogs credits are all masters, that artist simply
 * contributes no genre evidence, which is a safe degradation, not a bug).
 */
export async function getArtistReleaseIds(artistId: number, limit: number): Promise<number[]> {
  const data = (await discogsGet(`/artists/${artistId}/releases?sort=year&sort_order=desc&per_page=${limit}`)) as {
    releases?: { id: number; type: string }[];
  };
  return (data.releases ?? [])
    .filter((r) => r.type === "release")
    .slice(0, limit)
    .map((r) => r.id);
}

export async function getReleaseGenres(releaseId: number): Promise<DiscogsReleaseGenreData> {
  const data = (await discogsGet(`/releases/${releaseId}`)) as { genres?: string[]; styles?: string[] };
  return { genres: data.genres ?? [], styles: data.styles ?? [] };
}
