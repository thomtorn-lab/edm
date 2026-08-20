<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Source onboarding

Adding a new event source (a venue, promoter, ticketing platform, or aggregator) follows the
durable process in `SOURCE_ONBOARDING.md` — read it before starting. In short: work autonomously
through every reversible step (research, diagnosis, adapter implementation, tests, validation,
routine fixes/retries) using the permanent tooling it describes
(`.github/workflows/inspect-source.yml`, `.github/workflows/validate-source.yml`,
`scripts/scaffold-source.mjs`) — do not hand-write a new one-off diagnostic or verification
workflow per source. Only stop to ask the user for: (A) credentials or external access that
genuinely require user action, (B) a material product/quality-policy choice that can't be safely
inferred, or (C) Production merge approval. A routine test failure, lint error, network blip, or
sync anomaly is never a reason to stop and ask — diagnose and fix it, then continue.
