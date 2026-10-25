import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "./client";
import { eventDescriptionTranslations, events, venues } from "./schema";
import {
  DEFAULT_TRANSLATION_MODEL,
  descriptionHash,
  estimateCostUsd,
  isClearlyEnglish,
  translateDescription,
  type TranslationResult,
} from "@/lib/translation/descriptionTranslation";
import {
  nextAttemptCount,
  selectTranslationWork,
  type TranslationWorkRow,
} from "@/lib/translation/translationWork";

/**
 * English-only About descriptions (2026-10-15): fills/refreshes
 * event_description_translations for published events. Run by
 * .github/workflows/translate-descriptions.yml on a schedule, so a newly
 * imported event or a changed source description gets its English version
 * within the hour, and existing events are worked through in batches.
 *
 * Never writes to `events` — events.description keeps the original source
 * text. Only rows of event_description_translations are inserted/updated.
 * An unchanged description that already has a result is never sent again
 * (hash match, see translationWork.ts); a clearly-English text is recorded
 * as "english" without any API call.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx src/db/translateDescriptions.ts --mode=plan [--limit=N]
 *   node --env-file=.env.local --import tsx src/db/translateDescriptions.ts --mode=apply [--limit=N] [--event=<slug>]
 *
 * --mode=plan is read-only and spends nothing: it reports how many events
 * are pending and how many of those would need an API call.
 * --mode=apply requires ANTHROPIC_API_KEY for non-English texts; without it,
 * clearly-English texts are still recorded and the rest are left pending
 * (exit code 0 — untranslated descriptions show their original text, or are
 * hidden once ENGLISH_ONLY_ABOUT_TEXTS is on).
 * DESCRIPTION_TRANSLATION_MODEL overrides the model (default: DEFAULT_TRANSLATION_MODEL).
 * One fixed model per run, no automatic fallback to another model.
 */

export const DEFAULT_RUN_LIMIT = 40;

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    const m = arg.match(/^--([a-z-]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function loadRows(slug: string | null): Promise<TranslationWorkRow[]> {
  const rows = await db
    .select({
      eventId: events.id,
      slug: events.slug,
      title: events.title,
      artists: events.artists,
      venueName: venues.name,
      description: events.description,
      startDatetime: events.startDatetime,
      endDatetime: events.endDatetime,
      sourceHash: eventDescriptionTranslations.sourceHash,
      status: eventDescriptionTranslations.status,
      attempts: eventDescriptionTranslations.attempts,
      updatedAt: eventDescriptionTranslations.updatedAt,
    })
    .from(events)
    .innerJoin(venues, eq(venues.id, events.venueId))
    .leftJoin(eventDescriptionTranslations, eq(eventDescriptionTranslations.eventId, events.id))
    .where(
      and(
        eq(events.published, true),
        isNotNull(events.description),
        sql`btrim(${events.description}) <> ''`,
        slug ? eq(events.slug, slug) : undefined,
      ),
    );
  return rows.map((r) => ({
    eventId: r.eventId,
    slug: r.slug,
    context: { title: r.title, venueName: r.venueName, artists: r.artists },
    description: r.description as string,
    startDatetime: r.startDatetime.toISOString(),
    endDatetime: r.endDatetime ? r.endDatetime.toISOString() : null,
    cached:
      r.sourceHash && r.status
        ? { sourceHash: r.sourceHash, status: r.status, attempts: r.attempts ?? 0, updatedAt: r.updatedAt?.toISOString() ?? null }
        : null,
  }));
}

type WriteRow = typeof eventDescriptionTranslations.$inferInsert;

async function upsert(row: WriteRow): Promise<void> {
  await db
    .insert(eventDescriptionTranslations)
    .values(row)
    .onConflictDoUpdate({
      target: eventDescriptionTranslations.eventId,
      set: {
        sourceHash: row.sourceHash,
        status: row.status,
        sourceLanguage: row.sourceLanguage ?? null,
        translatedText: row.translatedText ?? null,
        model: row.model ?? null,
        attempts: row.attempts ?? 0,
        lastError: row.lastError ?? null,
        reviewReason: row.reviewReason ?? null,
        removedDuplicateLines: row.removedDuplicateLines ?? 0,
        updatedAt: new Date(),
      },
    });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;
  if (mode !== "plan" && mode !== "apply") {
    console.error("::error::--mode=<plan|apply> is required.");
    process.exit(1);
  }
  const limit = args.limit ? Number(args.limit) : DEFAULT_RUN_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    console.error("::error::--limit must be a positive integer.");
    process.exit(1);
  }
  const slug = args.event ? args.event : null;

  const rows = await loadRows(slug);
  const all = selectTranslationWork(rows, new Date(), Number.MAX_SAFE_INTEGER);
  const batch = all.slice(0, limit);
  const needApi = all.filter((r) => !isClearlyEnglish(r.description)).length;
  console.log(
    `Published events with a description: ${rows.length}. Pending: ${all.length} (${needApi} would need an API call, ${all.length - needApi} are clearly English). This run: ${batch.length}.`,
  );
  if (mode === "plan") return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const client = apiKey ? new Anthropic({ apiKey }) : null;
  const model = process.env.DESCRIPTION_TRANSLATION_MODEL || DEFAULT_TRANSLATION_MODEL;
  if (!client) {
    console.log("::notice::ANTHROPIC_API_KEY is not set — recording clearly-English descriptions only; others stay pending (original text shown, or hidden once ENGLISH_ONLY_ABOUT_TEXTS is on).");
  }

  const counts = { english: 0, translated: 0, failed: 0, skipped: 0, review: 0 };
  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const row of batch) {
    const sourceHash = descriptionHash(row.description);
    if (!client && !isClearlyEnglish(row.description)) {
      counts.skipped++;
      continue;
    }
    const result: TranslationResult = client
      ? await translateDescription(client, row.description, model, row.context)
      : { status: "english", sourceLanguage: "en" };
    if (result.usage) {
      inputTokens += result.usage.inputTokens;
      outputTokens += result.usage.outputTokens;
      costUsd += estimateCostUsd(model, result.usage) ?? 0;
    }
    if (result.status === "failed") {
      counts.failed++;
      console.log(`::warning::${row.slug}: translation failed — ${result.error}`);
      await upsert({
        eventId: row.eventId,
        sourceHash,
        status: "failed",
        model,
        attempts: nextAttemptCount(row, false),
        lastError: result.error.slice(0, 500),
      });
      continue;
    }
    counts[result.status]++;
    await upsert({
      eventId: row.eventId,
      sourceHash,
      status: result.status,
      sourceLanguage: result.sourceLanguage,
      translatedText: result.status === "translated" ? result.text : null,
      model: result.status === "translated" ? model : null,
      attempts: nextAttemptCount(row, true),
      lastError: null,
      reviewReason: result.status === "translated" ? result.reviewReason : null,
      removedDuplicateLines: result.status === "translated" ? result.removedDuplicateLines : 0,
    });
    if (result.status === "translated" && result.reviewReason) {
      counts.review++;
      console.log(`::warning::${row.slug}: needs review — ${result.reviewReason}`);
    }
    const removed = result.status === "translated" && result.removedDuplicateLines ? `, ${result.removedDuplicateLines} repeated-language lines removed` : "";
    console.log(`${row.slug}: ${result.status} (${result.sourceLanguage}${removed})`);
  }
  console.log(
    `Done: ${counts.translated} translated (${counts.review} flagged for review), ${counts.english} already English, ${counts.failed} failed, ${counts.skipped} left pending (no API key). ` +
      `API usage: ${inputTokens} input + ${outputTokens} output tokens ≈ $${costUsd.toFixed(4)} (${model}).`,
  );
}

// Only auto-run when executed directly, never on import.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("::error::translateDescriptions.ts FAILED:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
