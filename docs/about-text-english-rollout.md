# English-only About texts — rollout plan

Status: **not started.** Nothing below has run against Production. Each step
that touches Production, spends API money or changes what the public site
shows needs explicit approval.

## What changes when

| Step | What happens | Public site effect | Reversible by |
| --- | --- | --- | --- |
| 1. Merge + deploy PR #169 (flag **off**) | New formatter, Show more, "Practical information" label, migration 0024 creates the empty `event_description_translations` table (additive, applied automatically before `next build`) | About texts get paragraphs/headings/links. **No About text disappears**: with `ENGLISH_ONLY_ABOUT_TEXTS` unset, an event without a translation shows its original description exactly as today. Descriptions made only of bare labels ("Praktisk info:", "Entré") are no longer shown. | Revert the PR (the new table is harmless if left) |
| 2. First sync runs after deploy | Adapters now store the full description with paragraph breaks; Poolen/Pumpehuset keep Danish descriptions | Longer, complete descriptions. Danish Poolen/Pumpehuset texts appear in Danish until step 4 (flag still off) | Revert the PR; the next sync re-stores the old shape |
| 3. Add `ANTHROPIC_API_KEY` repository secret | — | none | delete the secret |
| 4. Translation backlog, flag still off | Run *Translate Event Descriptions* manually: `mode=plan` (free, shows pending count and API-needing count), then `mode=apply` with a small `limit` (e.g. 10), review the log (failures, "needs review" lines, cost line), then larger batches until `plan` reports 0 pending | Each translated event switches to its English text as soon as its row exists. Untranslated events keep their original text | `DELETE FROM event_description_translations` (or per event) — the site falls back to originals |
| 5. Spot-check | Look at 10–20 translated events incl. long/bilingual ones; read the rows with `review_reason` set | none | — |
| 6. Turn the flag on: `ENGLISH_ONLY_ABOUT_TEXTS=true` in Vercel (+ redeploy) | Strict English-only | Only descriptions still without a valid English version are hidden — after step 4 that should be ~none (new imports, persistent failures) | Unset the flag + redeploy: originals come back immediately |
| 7. Enable the hourly schedule in `translate-descriptions.yml` | New or changed descriptions get translated within about an hour | A new non-English description is hidden for up to an hour (clearly English ones, incl. short ones, show at once) | Remove the schedule |

Steps 1–2 can ship without 3–7. Steps 6–7 should only follow a complete
backlog run (step 4) and a spot check (step 5).

## Why this order keeps existing texts visible

- The strict rule is behind `ENGLISH_ONLY_ABOUT_TEXTS`, default off. Merging
  never hides an existing description.
- Translations take effect per event as they land, while the flag is off, so
  the switch in step 6 only affects what is still untranslated.
- English descriptions need no API call: the job records them as "english"
  for free, and clearly English texts (including short ones with strong
  evidence) are shown even without a row.
- Admin edits keep priority: an admin-edited description is never
  overwritten by sync, and a translation is used only while it matches the
  exact current text.

## Cost (Claude Sonnet 5.5, $2 / $10 per million input/output tokens)

- Measured on the 9-sample integration check: see the PR / integration
  report. Estimate before that run: about $0.005–0.015 per non-English
  description, $0.02–0.04 for the longest bilingual ones.
- Each call has an output-token cap sized to its text (`outputTokenCap`), so
  a runaway response cannot cost more than a small multiple of a normal one.
- English descriptions, unchanged descriptions and already translated ones
  are never sent again.

## Monitoring

- Job log per run: translated / already English / failed / flagged for
  review counts, plus `API usage: … tokens ≈ $…`.
- `review_reason` on a row: a bilingual description whose repeated version
  could not be removed without risking unique information (both versions are
  kept and shown).
- Failed rows are retried on the next runs, then daily; `last_error` says
  why.
