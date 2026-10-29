# ElectronicCPH QA – isolated phases 1 and 2 (NOT PRODUCTION)

## Scope
The read-only exporter uses the existing PostgreSQL transaction guard, event/change/source/discovery tables, existing `assessDuplicate` and `getSourceHealth` engines. It produces an artifact named `electroniccph-qa-snapshot`, not a live-site mutation. It exports all *upcoming published* events as of the snapshot timestamp, not all historical/unpublished events. The candidate discovery queue is filtered to pending rows with a future or unknown date. No event is automatically accepted/rejected.

## Workflow scheduling
GitHub Actions cron uses UTC. The workflow schedules 03:15 and 04:15 UTC and checks that local Europe/Copenhagen time is 05:15 before exporting. This handles CET/CEST including transition days. GitHub Actions schedules are best-effort and may run late or be skipped. The QA consumer must verify `generated_at` and artifact freshness; **never** treat a missing or stale artifact as verified coverage. Scheduled workflows run on the repository default branch only: this development-branch workflow does not activate scheduled Production execution.

## Automated versus manual QA
Automated: current DB inventory; canonical source links; source-health classifications using existing rules; change history; candidate discovery queue; heuristic duplicate candidates using the site's existing engine; missing-field flags; category-specific fingerprint inputs. These are **signals**, not verified external facts.

ChatGPT/human must still perform all existing controls: (A/F) official-source lineup/date/time/venue/cancellation verification for each event; (B) independent artist-identity/music-genre evaluation (max two permitted genres); (C) real end-to-end links/redirects/ticket/KultuNaut; (D) human review of fuzzy duplicate findings; (E) independent discovery of missing events and inclusion criteria; (G) ABOUT English language review; Production/Vercel/admin/mobile genre behavior and other technical checks. Never mark these completed solely from a database snapshot.

## Persistent status and fail-safe continuation
The GitHub QA consumer reads `qa/status.json` from the explicitly selected branch and captures its **blob SHA**. Validate JSON, generation and snapshot freshness; reconcile `qa_inputs` with the ledger; preserve previous reported issues; update via GitHub Contents API using that exact SHA; reread the file and compare the saved payload. A 409/422 conflict, unavailable GitHub connection, invalid JSON, stale snapshot, missing artifact or interrupted write is a **failed run**, not a successful QA. Stop and report. Never overwrite without rereading the current state; never blindly retry a failed update. A separate planned run can resume from the last verified generation.

After a manual/ChatGPT check, record `checked_at`, a finite `next_check_at` appropriate to the category, evidence and reported issue IDs. Checks reopen when their own material fingerprint changes or when the next-check deadline is reached. No blanket reopening on every source sync or unrelated change-log insertion. Global ABOUT and Production checks are explicit site-scoped subjects. Expired events remain in the ledger as historical evidence, but are not counted as current coverage. Every published upcoming event must have four event-scoped checks.

## Limits / acceptance
The workflow currently provides a structured *data export*, not proof that external sites or music genres were independently checked. The ChatGPT scheduled QA task is unchanged. This branch has not been deployed or run against Production. Typecheck, unit tests and workflow execution must be evidenced before acceptance; GitHub Actions may not run on this branch automatically. No merge or phase 3/4 is authorized.
