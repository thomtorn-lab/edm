# ElectronicCPH QA data — instructions for the external QA

This file is maintained by the `edm` repository (`docs/qa-results-format.md`) and copied into the
private QA repository on every export. Do not edit the copy.

## Files in the private repository

| File | Written by | Purpose |
|---|---|---|
| `qa-snapshot.json` | export workflow only, daily ~02:37 Copenhagen (03:37 in summer) | Every published event that is upcoming or in progress, with `category_fingerprints` |
| `qa-status.json` | export workflow only | The control register: one check per current event and category, issues, processed runs |
| `qa-worklist.json` | export workflow only | A compact, prioritised list of the events with open checks, built from the two files above (see below) |
| `qa-results/<UTC timestamp>.json` | ChatGPT QA only | One new file per QA run. Never edit or delete an existing file |

**Never write `qa-status.json`, `qa-snapshot.json` or `qa-worklist.json`.** If `qa-status.json` is changed by anyone but the
workflow, the next export stops and changes nothing until it is restored.

## Before every QA run

1. Read `qa-snapshot.json` and `qa-status.json`.
2. Stop and report a failed run (write no results) if:
   - `qa-snapshot.json` `generated_at` is not from today (Copenhagen date): the export did not run and the data is
     not current Production data;
   - `qa-status.json` `snapshot_generated_at` differs from `qa-snapshot.json` `generated_at`;
   - `qa-snapshot.json` `validation.passed` is not `true`.
3. Work on checks with `current: true` and `status` `pending` (or anything you decide to recheck).

The three values in step 2 are also in `qa-worklist.json` (`snapshot_generated_at`, `register_snapshot_generated_at`,
`snapshot_validation_passed`), so the checks can be made there without loading the full snapshot.

## qa-worklist.json (start here)

Built by the same export run from `qa-snapshot.json` and the updated `qa-status.json`. It changes neither file and
never completes a check. `events` is ordered by `priority` (highest first, then start time); `reasons` says why.

Each event carries what external verification normally needs: time, venue, lineup (`artists`), `genres`, `links`
(Official Event, Tickets, RA, Facebook, other), `canonical_source_id`, `source_links` (names in the top-level `sources`
map), `status_flags`, the ABOUT text when an `about_language` or `source_facts` check is open (first 1200 characters,
`about_truncated` says when the rest is on `page_url`), and:

- `open_checks`: category → fingerprint. Copy the fingerprint exactly into the result file.
- `reopened`: open checks that had a result and are open again because the content changed (or `next_check_at` passed).
- `completed_categories`, `blocked_categories`, `open_issue_ids`.
- `findings`: structural findings from the site's own rules. Each has a `kind`:
  - `rule_violation`: breaks a documented platform rule (more than two genres, Electronic / Other combined with
    another genre, a main genre with its own subgenre, HvadErPå as Official Event, the same artist twice in one lineup).
    A documented error in the stored data.
  - `observation`: an established fact that is **not an error by itself** (TBA/placeholder in the lineup, no ABOUT
    text, no Official Event URL, Official Event = Tickets, Danish ABOUT text). Decide by external verification.
  - `candidate`: a possible problem that needs verification (`possible_duplicate_event`, with the other event's id).

Use `qa-snapshot.json` only when something is not in the worklist (e.g. the change log).

## Categories (one check per current event)

| Category | What the check covers |
|---|---|
| `source_facts` | Event facts, lineup, date/time, venue, cancellation, electronic relevance (incl. the ABOUT text) — against the official source |
| `music_genre` | Independent musical genre verification of the artists |
| `links` | Official/ticket/RA/Facebook/other links and their destinations |
| `duplicates` | Whether the event duplicates another listing |
| `about_language` | The event's ABOUT text (description) and its language |

`discovery` and `production_technical` are not per event: report them once per run (below).

A check reopens automatically (back to `pending`) when that category's fingerprint changes in a new snapshot,
or when its `next_check_at` passes. Completed, unchanged checks are kept with their evidence.

## Result file format

Write one new file per run: `qa-results/2026-11-25T06-03-12Z.json` (UTC time, no colons).

```json
{
  "schema_version": 1,
  "type": "qa_results",
  "run_id": "2026-11-25-daily",
  "snapshot_generated_at": "<exactly qa-snapshot.json generated_at>",
  "completed_at": "<UTC time the run finished>",
  "results": [
    {
      "event_id": "<events[].id>",
      "category": "source_facts",
      "fingerprint": "<events[].category_fingerprints.source_facts, copied exactly>",
      "status": "completed",
      "method": "official_source_check",
      "checked_at": "<UTC>",
      "evidence": ["https://venue.example/event-page"],
      "issues": [],
      "resolved_issue_ids": [],
      "next_check_at": null
    }
  ],
  "discovery": { "status": "completed", "summary": "…", "evidence": ["https://…"], "issues": [] },
  "production_technical": { "status": "completed", "summary": "…", "evidence": ["https://www.electroniccph.com/…"], "issues": [] }
}
```

- `status`: `completed` (checked, no open problem), `issue` (checked, problem found — at least one entry in
  `issues`), or `blocked` (could not check — give a reason in `evidence` or `issues`).
- `issues`: `[{ "id": "<stable id you choose, e.g. links-<event_id>-ticket-404>", "summary": "…" }]`. Reuse an id
  when reporting the same problem again. `resolved_issue_ids` closes earlier issues for this event.
- `evidence`: `completed` and `issue` need at least one `http(s)` URL you actually used.
- `discovery` / `production_technical`: required every run. `status` is `completed`, `issue`, `blocked` or `not_run`.

## When a result is rejected

The workflow applies a result only if the event id and category exist for a current event, the fingerprint is
exactly the one in the snapshot you checked, and the evidence is valid. Otherwise the check is left unchanged and
the reason is recorded in `qa-status.json` under `runs[].rejected`. A whole file is rejected if
`snapshot_generated_at` is not the register's current snapshot or the run finished more than 26 hours after it.

### music_genre: structural versus independent

- `"method": "independent_music_verification"` with at least one external source (not electroniccph.com) is the
  only way to complete `music_genre`.
- `"method": "structural"` (e.g. checking that the stored genres are allowed values or consistent) is recorded as
  `structural_checked_at` but leaves the check `pending`. A database or structural check never counts as musical
  verification.

## Limits

The snapshot is a database export. It does not certify that facts, genres, links or lineups are correct, or that
every real event is listed. The register records the QA's own results; nothing in it is set to `completed`
except by a valid result file.
