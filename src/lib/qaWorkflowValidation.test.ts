import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const ciPath=".github/workflows/qa-branch-ci.yml",snapshotPath=".github/workflows/qa-snapshot.yml";
const ci=readFileSync(ciPath,"utf8"),snapshot=readFileSync(snapshotPath,"utf8");
for(const file of [ciPath,snapshotPath]) {
 execFileSync("ruby",["-e","require 'yaml'; YAML.load_file(ARGV[0])",file],{stdio:"pipe"});
}
assert.match(ci,/npx next typegen/);
assert.match(ci,/npx tsc --noEmit/);
assert.match(ci,/npx vitest run src\/lib\/qaStatus\.test\.ts/);
assert.doesNotMatch(ci,/npm run build|DATABASE_URL|secrets\.|migrate|deploy/);
assert.match(snapshot,/cron: ["']15 3,4 \* \* \*["']/);
assert.match(snapshot,/TZ=Europe\/Copenhagen date \+%H:%M/);
function local(utc:string) {
 return new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Copenhagen",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(utc));
}
for(const utc of ["2026-07-01T03:15:00Z","2026-01-01T04:15:00Z","2026-03-29T03:15:00Z","2026-10-25T04:15:00Z"])
 assert.equal(local(utc),"05:15");
console.log("Workflow YAML syntax and CET/CEST 05:15 schedule validated");
