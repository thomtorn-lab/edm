import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import {
  DEFAULT_TRANSLATION_MODEL,
  MODEL_PRICES_USD_PER_MTOK,
  TRANSLATION_SYSTEM_PROMPT,
  estimateCostUsd,
  isClearlyEnglish,
  outputTokenCap,
  roughTokenEstimate,
  translateDescription,
  type TranslationContext,
  type TranslationResult,
} from "@/lib/translation/descriptionTranslation";
import { descriptionHash, publicDescriptionFor } from "@/lib/translation/englishDescription";
import { classifyAboutText } from "@/lib/aboutContent";

/**
 * Real-API integration check for About-text translation (2026-10-24).
 *
 * Runs the ACTUAL integration code — translateDescription (prompt,
 * structured output, validator, bilingual merge) and publicDescriptionFor
 * (what the public site would show) — against a fixed, small set of real
 * fixture descriptions in src/lib/translation/__fixtures__/integration/
 * (Danish, long, bilingual, very short, practical-only, already English,
 * and one admin-edited text). Never touches a database and never reads
 * Production data.
 *
 * Without --confirm-paid it makes NO API calls: it prints the samples and an
 * offline cost estimate. With --confirm-paid (and ANTHROPIC_API_KEY set) it
 * calls the Anthropic API once per sample that is not clearly English, and
 * writes a report with every result, validation outcome, token count and
 * cost.
 *
 * Usage:
 *   node --import tsx src/db/translationIntegrationCheck.ts                      # plan only, free
 *   node --import tsx src/db/translationIntegrationCheck.ts --confirm-paid [--model=claude-sonnet-5-5] [--max-cost-usd=0.10] [--out=report.md]
 *
 * Hard budget: every call gets an output-token cap sized to its text
 * (outputTokenCap), samples run shortest first, and before each call the
 * script checks that the money already spent (from the API's own usage
 * numbers) plus that call's WORST case — generously estimated input at the
 * full input price plus the whole output cap at the output price — stays
 * within --max-cost-usd (default $0.10). If not, it stops before calling and
 * says so. Total spend can therefore never exceed the budget.
 */

type Sample = { id: string; kind: string; fromFixture: string | null; context: TranslationContext };

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "../lib/translation/__fixtures__/integration");

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (const arg of argv) {
    const m = arg.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}

const roughTokens = roughTokenEstimate;

function clip(text: string, max = 600): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const model = typeof args.model === "string" ? args.model : DEFAULT_TRANSLATION_MODEL;
  const samples: Sample[] = JSON.parse(readFileSync(path.join(FIXTURES, "samples.json"), "utf8"));
  const texts = new Map(samples.map((s) => [s.id, readFileSync(path.join(FIXTURES, `${s.id}.txt`), "utf8").trim()]));

  const price = MODEL_PRICES_USD_PER_MTOK[model];
  const promptTokens = roughTokens(TRANSLATION_SYSTEM_PROMPT.length);
  let estimate = 0;
  console.log(`Model: ${model}. Samples: ${samples.length}.`);
  for (const s of samples) {
    const t = texts.get(s.id)!;
    const est = price ? ((promptTokens + roughTokens(t.length) + 60) * price.input + (roughTokens(t.length) * 1.3 + 150) * price.output) / 1e6 : 0;
    estimate += est;
    console.log(`  ${s.id.padEnd(20)} ${String(t.length).padStart(5)} chars  ${s.kind}${price ? `  ~$${est.toFixed(4)}` : ""}`);
  }
  console.log(price ? `Offline estimate (upper bound, before skipping clearly-English texts): ~$${estimate.toFixed(3)}` : `No price known for ${model}.`);

  if (args["confirm-paid"] !== true) {
    console.log("Plan only — no API calls made. Re-run with --confirm-paid (and ANTHROPIC_API_KEY set) to call the API.");
    return;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("::error::--confirm-paid needs ANTHROPIC_API_KEY.");
    process.exit(1);
  }
  const client = new Anthropic({ apiKey });
  const budget = typeof args["max-cost-usd"] === "string" ? Number(args["max-cost-usd"]) : 0.1;
  if (!price || !(budget > 0)) {
    console.error(`::error::need a known model price and a positive --max-cost-usd (model ${model}).`);
    process.exit(1);
  }
  /** Worst-case cost of one call: input over-estimated by 25%, the whole output cap billed. */
  const worstCase = (t: string, s: Sample) =>
    ((promptTokens + roughTokens(t.length) + roughTokens(JSON.stringify(s.context).length)) * 1.25 * price.input + outputTokenCap(t) * price.output) / 1e6;
  // Clearly-English samples make no call; the rest run shortest first so the
  // budget check has the most room for the longest texts.
  const ordered = [...samples].sort((a, b) => texts.get(a.id)!.length - texts.get(b.id)!.length);
  let stoppedAt: string | null = null;

  const rows: string[] = [];
  let totalIn = 0;
  let totalOut = 0;
  let totalCost = 0;
  const counts: Record<string, number> = {};
  for (const s of ordered) {
    const source = texts.get(s.id)!;
    if (!isClearlyEnglish(source) && totalCost + worstCase(source, s) > budget) {
      stoppedAt = s.id;
      console.log(
        `::warning::Budget guard: ${s.id} could cost up to $${worstCase(source, s).toFixed(4)}; with $${totalCost.toFixed(4)} spent that could exceed the $${budget.toFixed(2)} budget. Stopping before calling the API.`,
      );
      break;
    }
    const started = Date.now();
    const result: TranslationResult = await translateDescription(client, source, model, s.context);
    const ms = Date.now() - started;
    counts[result.status] = (counts[result.status] ?? 0) + 1;
    const cost = estimateCostUsd(model, result.usage) ?? 0;
    totalIn += result.usage?.inputTokens ?? 0;
    totalOut += result.usage?.outputTokens ?? 0;
    totalCost += cost;
    // What the public site would show for this result.
    const cached =
      result.status === "failed"
        ? { sourceHash: descriptionHash(source), status: "failed", translatedText: null }
        : { sourceHash: descriptionHash(source), status: result.status, translatedText: result.status === "translated" ? result.text : null };
    const shown = classifyAboutText(source) === "empty" ? null : publicDescriptionFor(source, cached);
    const detail =
      result.status === "failed"
        ? `FAILED: ${result.error}`
        : result.status === "translated"
          ? `translated (${result.sourceLanguage}); repeated lines removed: ${result.removedDuplicateLines}; review: ${result.reviewReason ?? "no"}`
          : `already English (${result.sourceLanguage})`;
    console.log(`${s.id}: ${detail} — ${result.usage ? `${result.usage.inputTokens}+${result.usage.outputTokens} tokens, $${cost.toFixed(4)}` : "no API call"}, ${ms} ms`);
    rows.push(
      [
        `### ${s.id} — ${s.kind}`,
        `Fixture: ${s.fromFixture ?? "constructed"} · About kind: ${classifyAboutText(source)} · Result: ${detail}`,
        `Tokens: ${result.usage ? `${result.usage.inputTokens} in / ${result.usage.outputTokens} out` : "none (no API call)"} · Cost: $${cost.toFixed(4)} · ${ms} ms`,
        "",
        "**Source**",
        "```",
        clip(source),
        "```",
        "**Shown on the public site**",
        "```",
        shown === null ? "(nothing — About hidden)" : clip(shown),
        "```",
        "",
      ].join("\n"),
    );
  }
  const summary = `${stoppedAt ? `STOPPED by the budget guard before "${stoppedAt}". ` : ""}Budget $${budget.toFixed(2)}. Model ${model}: ${Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(", ")}. Total ${totalIn} input + ${totalOut} output tokens = $${totalCost.toFixed(4)}.`;
  console.log(summary);
  const out = typeof args.out === "string" ? args.out : "translation-integration-report.md";
  writeFileSync(out, `# Translation integration check\n\n${new Date().toISOString()}\n\n${summary}\n\n${rows.join("\n")}`);
  console.log(`Report written to ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("::error::translationIntegrationCheck.ts FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
