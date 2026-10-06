/**
 * CLI wrapper around src/lib/newsletter/dstSchedule.ts's pure logic
 * (newsletter activation safety round, 2026-10-06), for the "DST-safe
 * schedule eligibility guard" step in .github/workflows/send-newsletter.yml.
 * Only ever invoked for a `schedule`-triggered run — never for
 * `workflow_dispatch`, which stays unaffected for manual testing (see that
 * workflow's own `if:` conditions).
 *
 * Exit code 0 = eligible (this is the DST-correct firing for today — the
 * workflow should proceed). Exit code 1 = not eligible, or the inputs
 * couldn't be parsed (fails closed either way) — the workflow should no-op.
 *
 * Usage: node --import tsx scripts/checkDstEligibility.ts "<cronExpression>" "<utcOffset e.g. +0200>"
 */
import { isDstCorrectCronFiring, parseUtcOffsetHours } from "@/lib/newsletter/dstSchedule";

const [cronExpression, offsetString] = process.argv.slice(2);

if (!cronExpression || !offsetString) {
  console.error('Usage: checkDstEligibility.ts "<cronExpression>" "<utcOffset e.g. +0200>"');
  process.exit(1);
}

const offsetHours = parseUtcOffsetHours(offsetString);
if (offsetHours === null) {
  console.error(`::error::Unparseable UTC offset "${offsetString}" for Europe/Copenhagen — failing closed (not eligible).`);
  process.exit(1);
}

const eligible = isDstCorrectCronFiring(cronExpression, offsetHours);
console.log(
  eligible
    ? `ELIGIBLE: "${cronExpression}" is the DST-correct firing for today (offset ${offsetString}).`
    : `NOT ELIGIBLE: "${cronExpression}" is not today's DST-correct firing (offset ${offsetString}) — the other prepared cron entry is this week's intended one.`,
);
process.exit(eligible ? 0 : 1);
