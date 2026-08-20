#!/usr/bin/env node
// Source adapter scaffold generator (source onboarding factory, Phase 2.3 —
// see SOURCE_ONBOARDING.md). Deliberately NOT a framework: it only writes
// the boilerplate files every source needs in the same shape (adapter
// skeleton, test skeleton, recurring sync workflow), using the exact
// conventions already established by src/lib/adapters/hangarenAdapter.ts /
// billettoAdapter.ts and .github/workflows/sync-hangaren.yml. It never
// touches an existing file — the few genuinely small edits an existing file
// needs (registry entry, route registration, monitored-source-id list) are
// left as a printed checklist, because line-splicing an existing file by
// script is more fragile than just making those three one-line edits
// directly.
//
// The actual parsing logic (HTML/JSON extraction, genre-hint heuristics) is
// irreducibly source-specific and is NOT generated — every TODO below marks
// exactly where that real work goes.
//
// Usage:
//   node scripts/scaffold-source.mjs --id=<slug> --name="<Display Name>" --base-url=<https://...> --kind=<html|api>
//
// Example:
//   node scripts/scaffold-source.mjs --id=pumpehuset --name="Pumpehuset" --base-url=https://pumpehuset.dk --kind=html

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const body = raw.slice(2);
    const eq = body.indexOf("=");
    if (eq === -1) out[body] = true;
    else out[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return out;
}

function toPascalCase(slug) {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join("");
}

function writeIfAbsent(path, content) {
  if (existsSync(path)) {
    console.log(`SKIP (already exists): ${path}`);
    return false;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
  console.log(`CREATED: ${path}`);
  return true;
}

function htmlAdapterTemplate({ pascal, id, sourceIdConst, baseUrl, name }) {
  return `import type { RawCandidateEvent, SourceAdapter } from "./types";

/**
 * TODO: source-specific adapter for ${name} (${sourceIdConst} in
 * src/lib/data/sources.ts). Scaffolded by scripts/scaffold-source.mjs —
 * follows the same shape as src/lib/adapters/hangarenAdapter.ts.
 *
 * Before writing the real parser:
 *   1. Confirm robots.txt actually permits fetching ${baseUrl} (or whatever
 *      the real events page turns out to be).
 *   2. Capture a REAL, unmodified fetch of that page into
 *      src/lib/adapters/__fixtures__/${id}-events.html — never a
 *      hand-written fixture (see hangarenAdapter.test.ts's header comment
 *      for why: every assertion must trace back to a real recorded
 *      response).
 *   3. Write parse${pascal}EventsHtml against that real fixture first, then
 *      wire up the live fetch below.
 */

export const ${sourceIdConst} = "src-${id}";
export const ${pascal.toUpperCase()}_BASE_URL = "${baseUrl}";
// TODO: confirm the real events-listing path (often /events, /program, /en/program/ etc.)
export const ${pascal.toUpperCase()}_EVENTS_URL = \`\${${pascal.toUpperCase()}_BASE_URL}/events\`;
const ${pascal.toUpperCase()}_VENUE_NAME = "${name}";

/**
 * TODO: parse the real page structure. Return one RawCandidateEvent per
 * real event found; skip (never throw for) a single malformed record — a
 * bad block must never take down the whole sync. Every adapter in this repo
 * follows this exact contract (see src/lib/adapters/types.ts).
 */
export function parse${pascal}EventsHtml(html: string, sourceUrl = ${pascal.toUpperCase()}_EVENTS_URL): RawCandidateEvent[] {
  const results: RawCandidateEvent[] = [];

  // TODO: replace with real extraction against the captured fixture.
  void html;
  void sourceUrl;
  void ${pascal.toUpperCase()}_VENUE_NAME;

  return results;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOnce(fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(${pascal.toUpperCase()}_EVENTS_URL, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      "user-agent": "ElectronicCPHBot/1.0 (+https://electroniccph.com/about; first-party sync)",
      accept: "text/html",
    },
  });
}

/**
 * Retries once after a short delay on a transient failure (network error or
 * 5xx) — matches every other adapter in this repo (see hangarenAdapter.ts's
 * header comment for the reasoning). Throws a descriptive error only after
 * both attempts fail, so runSourceSync records it as a distinct source
 * failure, never as "zero events".
 */
export function create${pascal}Adapter(fetchImpl: typeof fetch = fetch, retryDelayMs = 2_000): SourceAdapter {
  return {
    sourceId: ${sourceIdConst},
    async fetchCandidates(): Promise<RawCandidateEvent[]> {
      let lastError: string | null = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await fetchOnce(fetchImpl);
          if (res.ok) {
            const html = await res.text();
            return parse${pascal}EventsHtml(html, ${pascal.toUpperCase()}_EVENTS_URL);
          }
          lastError = \`${name} responded with HTTP \${res.status}\`;
          if (res.status < 500) break; // a 4xx won't fix itself on retry
        } catch (err) {
          lastError = \`${name} fetch failed: \${err instanceof Error ? err.message : String(err)}\`;
        }
        if (attempt === 1) {
          console.error(\`[${id}-adapter] attempt 1 failed (\${lastError}), retrying once in \${retryDelayMs}ms\`);
          await delay(retryDelayMs);
        }
      }
      throw new Error(\`\${lastError} (after retry)\`);
    },
  };
}
`;
}

function testTemplate({ pascal, id, name }) {
  return `import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse${pascal}EventsHtml } from "./${id}Adapter";

/**
 * TODO: replace this fixture path with a REAL, unmodified recording of the
 * real ${name} events page (see ${id}Adapter.ts's header TODO). Every
 * assertion below must trace back to something actually present in that
 * real fixture — no fabricated HTML, matching hangarenAdapter.test.ts's
 * convention.
 */
const FIXTURE_PATH = path.join(__dirname, "__fixtures__", "${id}-events.html");

describe.skip("parse${pascal}EventsHtml (TODO: un-skip once a real fixture exists)", () => {
  const FIXTURE_HTML = readFileSync(FIXTURE_PATH, "utf-8");
  const events = parse${pascal}EventsHtml(FIXTURE_HTML);

  it("parses at least one real event from the fixture", () => {
    expect(events.length).toBeGreaterThan(0);
  });

  // TODO: add assertions for date/time extraction, lineup extraction, genre
  // hint evidence tier, ticket/RA URL fallback — one it() per real behavior
  // discovered in the actual fixture, same granularity as
  // hangarenAdapter.test.ts.
});
`;
}

function syncWorkflowTemplate({ id, pascal }) {
  return `name: Sync ${pascal}

# Scheduling entry point for the ${pascal} ingestion adapter
# (src/lib/adapters/${id}Adapter.ts). Calls the deployed app's
# POST /api/sync/${id} on a fixed schedule, matching
# src/lib/data/sources.ts's \`syncFrequency\` for src-${id}.
#
# Generated by scripts/scaffold-source.mjs from the same template as
# sync-hangaren.yml — identical structure/safety model, only the endpoint,
# cron offset and concurrency group differ. See README.md's "Scheduling"
# section for the full explanation (retry layers, concurrency, secrets).
#
# TODO before enabling: confirm SYNC_BASE_URL / SYNC_TRIGGER_TOKEN /
# VERCEL_AUTOMATION_BYPASS_SECRET are already configured (they're shared
# repository-level secrets/variable, not per-source) and pick a cron offset
# that doesn't collide with the other sync-*.yml workflows.

on:
  schedule:
    - cron: "0 */6 * * *" # TODO: offset from other sync-*.yml workflows, e.g. "15 */6 * * *"
  workflow_dispatch: {} # manual re-trigger, e.g. to retry after a fix

concurrency:
  group: sync-${id}
  cancel-in-progress: false

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger ${pascal} sync
        env:
          SYNC_BASE_URL: \${{ vars.SYNC_BASE_URL }}
          SYNC_TRIGGER_TOKEN: \${{ secrets.SYNC_TRIGGER_TOKEN }}
          VERCEL_AUTOMATION_BYPASS_SECRET: \${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}
        run: |
          set -u
          if [ -z "\${SYNC_BASE_URL}" ]; then
            echo "::error::Repository variable SYNC_BASE_URL is not set."
            exit 1
          fi
          if [ -z "\${SYNC_TRIGGER_TOKEN}" ]; then
            echo "::error::Repository secret SYNC_TRIGGER_TOKEN is not set."
            exit 1
          fi
          if [ -z "\${VERCEL_AUTOMATION_BYPASS_SECRET}" ]; then
            echo "::error::Repository secret VERCEL_AUTOMATION_BYPASS_SECRET is not set."
            exit 1
          fi

          http_code=$(curl -sS \\
            --retry 3 --retry-delay 15 --retry-all-errors \\
            --max-time 60 \\
            -o /tmp/sync-response.json -w '%{http_code}' \\
            -X POST \\
            -H "x-sync-token: \${SYNC_TRIGGER_TOKEN}" \\
            -H "x-vercel-protection-bypass: \${VERCEL_AUTOMATION_BYPASS_SECRET}" \\
            "\${SYNC_BASE_URL}/api/sync/${id}")

          echo "HTTP status: \${http_code}"
          echo "Response:"
          cat /tmp/sync-response.json
          echo

          if [ "\${http_code}" -lt 200 ] || [ "\${http_code}" -ge 300 ]; then
            echo "::error::${pascal} sync returned HTTP \${http_code} — see response body above."
            exit 1
          fi
`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const id = args.id;
  const name = args.name;
  const baseUrl = args["base-url"];
  const kind = args.kind ?? "html";

  if (!id || !/^[a-z0-9-]+$/.test(id)) {
    console.error('::error::--id=<slug> is required and must be lowercase-kebab (e.g. --id=pumpehuset). This becomes "src-<id>" and the /api/sync/<id> route segment.');
    process.exit(1);
  }
  if (!name) {
    console.error('::error::--name="<Display Name>" is required (e.g. --name="Pumpehuset").');
    process.exit(1);
  }
  if (!baseUrl || !/^https:\/\//.test(baseUrl)) {
    console.error("::error::--base-url=<https://...> is required.");
    process.exit(1);
  }
  if (kind !== "html" && kind !== "api") {
    console.error(
      `::error::--kind must be "html" or "api". For a plain first-party JSON feed, skip this scaffold entirely and use src/lib/adapters/firstPartyAdapter.ts's createFirstPartyAdapter() directly — no new adapter file needed.`,
    );
    process.exit(1);
  }
  if (kind === "api") {
    console.error(
      '::error::--kind=api scaffolding is intentionally not generated here — a credentialed API adapter (see billettoAdapter.ts) is different enough per source (auth scheme, pagination, response shape) that copying its real file as a starting point and adapting it by hand is safer than a generic template. Copy src/lib/adapters/billettoAdapter.ts as your starting point instead.',
    );
    process.exit(1);
  }

  const pascal = toPascalCase(id);
  const sourceIdConst = `${pascal.toUpperCase()}_SOURCE_ID`;

  console.log(`Scaffolding source "${id}" (${name}, kind=${kind})...\n`);

  writeIfAbsent(join(ROOT, "src/lib/adapters", `${id}Adapter.ts`), htmlAdapterTemplate({ pascal, id, sourceIdConst, baseUrl, name }));
  writeIfAbsent(join(ROOT, "src/lib/adapters", `${id}Adapter.test.ts`), testTemplate({ pascal, id, name }));
  writeIfAbsent(join(ROOT, ".github/workflows", `sync-${id}.yml`), syncWorkflowTemplate({ id, pascal }));

  console.log(`
Remaining manual steps (deliberately not auto-edited — small, targeted diffs are safer than script-splicing existing files):

  1. src/lib/data/sources.ts — add a registry entry:
       {
         id: "src-${id}",
         sourceName: "${name}",
         sourceType: "official-venue",
         baseUrl: "${baseUrl}",
         roles: ["discovery"],       // widen to ["discovery","ingestion","verification","link"] once the adapter is real and verified
         adapter: null,              // set to e.g. "${id}-html" once real
         trustLevel: "medium",
         autoPublish: false,         // flip to true only once verified via validate-source.yml
         syncFrequency: "manual coverage check",
         active: true,
         lastSuccessfulSync: null, lastAttemptedSync: null, lastError: null,
         eventsFound: 0, eventsUpdated: 0,
         integrationNote: "TODO: document robots.txt check, structure, evaluation.",
       },

  2. src/app/api/sync/[source]/route.ts — add to the ADAPTERS map:
       ${id}: { sourceId: ${sourceIdConst}, displayName: "${name}", create: create${pascal}Adapter },
     (also add the import line for create${pascal}Adapter / ${sourceIdConst})

  3. src/db/checkSourceHealth.ts — add "src-${id}" to MONITORED_SOURCE_IDS
     once the source has a real adapter wired to the scheduler.

  4. Run: node --env-file=.env.local --import tsx src/db/inspectSource.ts --mode=reachability --endpoint=${baseUrl}
     (or dispatch inspect-source.yml in "reachability" mode) before writing
     the real parser, to confirm the page is actually reachable/permitted.

  5. Capture a real fixture, write the real parser + tests, then run
     validate-source.yml against your branch before proposing a merge.

See SOURCE_ONBOARDING.md for the full autonomous flow and STOP conditions.
`);
}

main();
