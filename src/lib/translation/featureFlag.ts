/**
 * Switch for the English-only About rule (rollout safety, 2026-10-25).
 *
 * Unset/anything but "true" (the default on every deployment): the public
 * site shows the cached English translation of an event's description when
 * one exists for exactly the current text, and otherwise the original
 * description — the same text it shows today. Merging and deploying
 * therefore never makes an existing About text disappear.
 *
 * "true": strict English-only — a non-English description without a valid
 * translation is hidden (see publicDescriptionFor). Turned on only after the
 * translation backlog has been worked through; unsetting it is the rollback.
 */
export function isEnglishOnlyAboutEnabled(): boolean {
  return process.env.ENGLISH_ONLY_ABOUT_TEXTS === "true";
}
