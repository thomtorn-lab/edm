import { createHash } from "node:crypto";
import { isClearlyEnglish } from "./languageCheck";

/** Stable identity of one exact description text — a change in the source means a new hash and a new translation. */
export function descriptionHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export type CachedTranslation = { sourceHash: string; status: string; translatedText: string | null };

/**
 * The About text the PUBLIC site may show (English-only About texts,
 * 2026-10-24; rollout flag 2026-10-25).
 *
 * - A cached result made from exactly this description (hash match):
 *   "translated" → the English translation; "english" → the description
 *   itself (it was confirmed to be English).
 * - No usable cached result (none yet, failed, or made from an older text):
 *   with `englishOnly` (ENGLISH_ONLY_ABOUT_TEXTS=true) the description is
 *   shown only if it is clearly English on its own (isClearlyEnglish, tuned
 *   never to call a non-English text English), otherwise null — the About
 *   section is hidden until a translation exists. Without `englishOnly` the
 *   original description is shown, exactly as before this feature.
 *
 * The original description is never altered: it stays in the database and
 * in admin, and the translation job keeps retrying. A translation of an
 * older text can never be returned for a newer one.
 */
export function publicDescriptionFor(
  description: string | null,
  cached: CachedTranslation | null,
  options: { englishOnly: boolean } = { englishOnly: true },
): string | null {
  if (!description || !description.trim()) return null;
  if (cached && cached.sourceHash === descriptionHash(description)) {
    if (cached.status === "translated" && cached.translatedText) return cached.translatedText;
    if (cached.status === "english") return description;
  }
  if (!options.englishOnly) return description;
  return isClearlyEnglish(description) ? description : null;
}
