import { createHash } from "node:crypto";

/** Stable identity of one exact description text — a change in the source means a new hash and a new translation. */
export function descriptionHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export type CachedTranslation = { sourceHash: string; status: string; translatedText: string | null };

/**
 * The About text to display: the cached English translation only when it
 * was made from exactly this description (hash match) — otherwise, and on
 * any failed/missing translation, the original description. Safe fallback by
 * construction: it can only ever return the original or a validated
 * translation of that very same original.
 */
export function englishDescriptionFor(description: string | null, cached: CachedTranslation | null): string | null {
  if (!description) return description;
  if (!cached || cached.status !== "translated" || !cached.translatedText) return description;
  return cached.sourceHash === descriptionHash(description) ? cached.translatedText : description;
}
