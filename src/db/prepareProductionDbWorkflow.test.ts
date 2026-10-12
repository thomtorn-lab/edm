import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Regression coverage for .github/workflows/prepare-production-db.yml's
 * input handling (same hardening as inspect-source.yml / validate-source.yml).
 *
 * Two confirmed defects in the old `${{ inputs.* }}`-in-script version:
 *   1. FAIL-OPEN confirmation gate: `if [ "${{ inputs.confirm }}" != "TOKEN" ]`
 *      with a confirm value containing two `"` (e.g. a" "b) gave `[` too many
 *      operands; `[` then exits 2, the `if` treats that as "not different", and
 *      the gate PASSED — straight on to db:migrate + seed against Production.
 *   2. SCOPE ESCALATION: the same thing in `[ -n "${{ inputs.source_id }}" ]`
 *      made a scoped one-source request fall through to the FULL bootstrap
 *      (db:seed:production); `$(...)`/backticks/`"; cmd; "` also executed.
 *
 * These tests read the REAL workflow, build each step's env from that step's
 * own `env:` mapping exactly as GitHub would, and run its `run:` script under
 * bash with a stub `npm` that only records argv — no database, no migration.
 */

const WORKFLOW = readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "prepare-production-db.yml"), "utf-8");

type Step = { name: string; if: string | null; env: Record<string, string>; run: string | null };

function readSteps(yaml: string): Step[] {
  const steps: Step[] = [];
  let current: Step | null = null;
  let section: "env" | "run" | null = null;
  for (const line of yaml.split("\n")) {
    const stepStart = line.match(/^ {6}- name: (.*)$/);
    if (stepStart) {
      current = { name: stepStart[1].trim(), if: null, env: {}, run: null };
      steps.push(current);
      section = null;
      continue;
    }
    if (!current) continue;
    const cond = line.match(/^ {8}if: (.+)$/);
    if (cond) {
      current.if = cond[1].trim();
      section = null;
      continue;
    }
    if (/^ {8}env:\s*$/.test(line)) {
      section = "env";
      continue;
    }
    if (/^ {8}run: \|\s*$/.test(line)) {
      section = "run";
      current.run = "";
      continue;
    }
    const single = line.match(/^ {8}run: (.+)$/);
    if (single) {
      current.run = single[1];
      section = null;
      continue;
    }
    if (/^ {8}\S/.test(line)) {
      section = null;
      continue;
    }
    if (section === "env") {
      const kv = line.match(/^ {10}([A-Z0-9_]+): (.*)$/);
      if (kv) current.env[kv[1]] = kv[2].trim();
    } else if (section === "run") {
      if (line.trim() === "" || line.startsWith("          ")) current.run += line.slice(10) + "\n";
      else section = null;
    }
  }
  return steps;
}

const steps = readSteps(WORKFLOW);
function step(name: string): Step {
  const found = steps.find((s) => s.name.startsWith(name));
  if (!found?.run) throw new Error(`step not found: ${name}`);
  return found;
}
const gate = step("Require explicit confirmation");
const seed = step("Seed production reference data");

const scratch = mkdtempSync(path.join(tmpdir(), "prepare-production-db-wf-"));
const fakeBin = path.join(scratch, "bin");
const work = path.join(scratch, "work"); // cwd for every step: a stray `touch` would land here
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
{
  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(work, { recursive: true });
  writeFileSync(path.join(fakeBin, "npm"), `#!/usr/bin/env bash\n{ printf '%s\\0' "$@"; printf '\\036'; } >> "$CALLS_OUT"\n`);
  chmodSync(path.join(fakeBin, "npm"), 0o755);
}

function resolveEnv(s: Step, inputs: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, expr] of Object.entries(s.env)) {
    const m = expr.match(/^\$\{\{ (inputs|secrets)\.([a-zA-Z_0-9]+) \}\}$/);
    if (!m) throw new Error(`unexpected env expression in "${s.name}": ${key}: ${expr}`);
    env[key] = m[1] === "inputs" ? (inputs[m[2]] ?? "") : `test-secret-${m[2]}`;
  }
  return env;
}

let runCounter = 0;
function runStep(s: Step, inputs: Record<string, string>) {
  const callsFile = path.join(scratch, `calls-${++runCounter}`);
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", s.run!], {
    cwd: work,
    // NODE_ENV is required by Next's ProcessEnv typing; the scripts never read it.
    env: { NODE_ENV: "test", PATH: `${fakeBin}:${process.env.PATH}`, CALLS_OUT: callsFile, ...resolveEnv(s, inputs) },
    encoding: "utf-8",
  });
  const npmCalls = existsSync(callsFile)
    ? readFileSync(callsFile, "utf-8")
        .split("\x1e")
        .filter(Boolean)
        .map((rec) => rec.split("\0").slice(0, -1))
    : [];
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, npmCalls };
}

const SHELL_SENSITIVE: Array<[string, string]> = [
  ["$ sequences", "¥ØU$UK€ ¥UK1MAT$U"],
  ["$VAR / ${VAR} / $$", "$HOME ${PATH} $$"],
  ["double quotes", 'a"b"c'],
  ["single quotes", "it's 'quoted'"],
  ["spaces", "  two  spaces  "],
  ["backticks", "`touch pwned-backtick`"],
  ["command substitution", "$(touch pwned-subst)"],
  ["; | & < > separators", "x; touch pwned-semi | y && z > out-file < in &"],
  ["backslashes", "back\\slash \\$x"],
  ["glob characters", "* ? [abc]"],
  ["a literal newline", "line one\nline two"],
];

describe("prepare-production-db.yml — structure unchanged, no ${{ }} in any shell script", () => {
  it("keeps every existing step, in order", () => {
    expect(steps.map((s) => s.name)).toEqual([
      "Require explicit confirmation",
      "Checkout",
      "Set up Node.js",
      "Verify DATABASE_URL secret is configured",
      "Install dependencies",
      "Write DATABASE_URL for the db scripts",
      "Apply database migrations",
      "Seed production reference data (full bootstrap, or one scoped source if source_id was given)",
      "Skipped reference-data seed (migrations_only)",
      "Remove local env file",
    ]);
  });

  it("no step's run: script contains a ${{ }} expression", () => {
    for (const s of steps) if (s.run !== null) expect(s.run, s.name).not.toContain("${{");
  });

  it("keeps the migrations_only branching and the migrate command exactly as before", () => {
    expect(seed.if).toBe("${{ !inputs.migrations_only }}");
    expect(step("Skipped reference-data seed").if).toBe("${{ inputs.migrations_only }}");
    expect(step("Apply database migrations").run!.trim()).toBe("npm run db:migrate");
  });
});

describe("prepare-production-db.yml — confirmation gate fails CLOSED", () => {
  it("passes on exactly PREPARE-PRODUCTION-DB", () => {
    expect(runStep(gate, { confirm: "PREPARE-PRODUCTION-DB" }).status).toBe(0);
  });

  it.each<[string, string]>([
    ["empty", ""],
    ["wrong case", "prepare-production-db"],
    ["leading space", " PREPARE-PRODUCTION-DB"],
    ["trailing newline", "PREPARE-PRODUCTION-DB\n"],
    ["two double quotes (the old fail-open payload)", 'a" "b'],
    ["the token pasted inside quotes", '"PREPARE-PRODUCTION-DB"'],
    ["a -o break-out", 'x" -o "x'],
    ["a || break-out", 'PREPARE-PRODUCTION-DB" ] || [ "x'],
    ["a ; break-out", 'x" ]; then :; fi; if [ "x'],
    ...SHELL_SENSITIVE,
  ])("rejects %s", (_desc, value) => {
    const r = runStep(gate, { confirm: value });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("::error::Confirmation input did not match");
  });
});

describe("prepare-production-db.yml — source_id scoping", () => {
  it("empty source_id runs the full bootstrap, as before", () => {
    expect(runStep(seed, { source_id: "" }).npmCalls).toEqual([["run", "db:seed:production"]]);
  });

  it("a valid source_id runs only the scoped registry sync, as before", () => {
    const r = runStep(seed, { source_id: "src-poolen" });
    expect(r.status).toBe(0);
    expect(r.npmCalls).toEqual([["run", "db:sync-source-registry", "--", "src-poolen"]]);
    expect(r.stdout).toContain("Scoped run: syncing only source id 'src-poolen'");
  });

  it.each<[string, string]>([
    ["two double quotes (the old scope-escalation payload)", 'src-a" "src-b'],
    ["a quote break-out with a command", 'src-x"; touch pwned-breakout; echo "'],
    ...SHELL_SENSITIVE,
  ])("a source_id with %s is passed literally as ONE argument and never escalates to the full bootstrap", (_desc, value) => {
    const r = runStep(seed, { source_id: value });
    expect(r.status, r.stderr).toBe(0);
    // syncSourceRegistry.ts then rejects anything not matching src-[a-z0-9-]+ / not in the registry.
    expect(r.npmCalls).toEqual([["run", "db:sync-source-registry", "--", value]]);
    expect(r.stdout).toContain(`Scoped run: syncing only source id '${value}'`);
  });
});

describe("prepare-production-db.yml — nothing embedded in any input was ever executed", () => {
  // Declared last; vitest runs tests in file order, so every case above has run.
  it("left no file behind in the steps' working directory", () => {
    expect(readdirSync(work)).toEqual([]);
  });
});
