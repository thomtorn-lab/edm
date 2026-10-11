import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Regression coverage for .github/workflows/inspect-source.yml's input
 * handling. The workflow used to paste every `${{ inputs.* }}` straight into
 * its `run:` script text, so bash re-parsed user input as code: an artist
 * name like `¥ØU$UK€ ¥UK1MAT$U` had `$UK`/`$U` expanded (and, under the
 * step's `set -u`, aborted the run as an unbound variable). Inputs now reach
 * the script only through `env:` and are expanded inside double quotes.
 *
 * These tests read the REAL workflow file (no copy of its script lives
 * here), extract each step's `run:` block, and execute the inspection step
 * under bash with a stub `node` on PATH that records the exact argv it was
 * given — nothing touches a database, the network, or inspectSource.ts.
 */

const WORKFLOW_PATH = path.join(__dirname, "..", "..", ".github", "workflows", "inspect-source.yml");
const WORKFLOW = readFileSync(WORKFLOW_PATH, "utf-8");

type Step = { name: string; env: Record<string, string>; run: string | null };

/** Minimal, indentation-based reader for this workflow's own `steps:` list. */
function readSteps(yaml: string): Step[] {
  const lines = yaml.split("\n");
  const steps: Step[] = [];
  let current: Step | null = null;
  let section: "env" | "run" | null = null;
  for (const line of lines) {
    const stepStart = line.match(/^ {6}- name: (.*)$/);
    if (stepStart) {
      current = { name: stepStart[1].trim(), env: {}, run: null };
      steps.push(current);
      section = null;
      continue;
    }
    if (!current) continue;
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

function declaredInputs(yaml: string): string[] {
  const block = yaml.slice(yaml.indexOf("    inputs:"), yaml.indexOf("\npermissions:"));
  return [...block.matchAll(/^ {6}([a-z_]+):\s*$/gm)].map((m) => m[1]);
}

const steps = readSteps(WORKFLOW);
const inspectStep = steps.find((s) => s.name === "Run inspection");
const validateStep = steps.find((s) => s.name.startsWith("Validate source_id"));

const scratch = mkdtempSync(path.join(tmpdir(), "inspect-source-wf-"));
const fakeBin = path.join(scratch, "bin");
const argsOut = path.join(scratch, "argv");
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
{
  mkdirSync(fakeBin, { recursive: true });
  const stub = path.join(fakeBin, "node");
  // Records each argument NUL-separated, so spaces/newlines are preserved.
  writeFileSync(stub, `#!/usr/bin/env bash\nprintf '%s\\0' "$@" > "$ARGV_OUT"\n`);
  chmodSync(stub, 0o755);
}

/** Every declared input defaults to "" (what Actions passes for an unset input). */
function inputEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of declaredInputs(WORKFLOW)) env[`INPUT_${name.toUpperCase()}`] = "";
  for (const [k, v] of Object.entries(overrides)) env[`INPUT_${k.toUpperCase()}`] = v;
  return env;
}

function runInspect(overrides: Record<string, string>) {
  rmSync(argsOut, { force: true });
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", inspectStep!.run!], {
    cwd: scratch, // a stray `$(touch …)` would land here, where we look for it
    // NODE_ENV is required by Next's ProcessEnv typing; the scripts never read it.
    env: { NODE_ENV: "test", PATH: `${fakeBin}:${process.env.PATH}`, ARGV_OUT: argsOut, ...inputEnv(overrides) },
    encoding: "utf-8",
  });
  const argv = existsSync(argsOut) ? readFileSync(argsOut, "utf-8").split("\0").slice(0, -1) : null;
  const scriptIdx = argv ? argv.indexOf("src/db/inspectSource.ts") : -1;
  return {
    status: result.status,
    stderr: result.stderr,
    nodeFlags: argv && scriptIdx !== -1 ? argv.slice(0, scriptIdx) : null,
    args: argv && scriptIdx !== -1 ? argv.slice(scriptIdx + 1) : null,
  };
}

const SHELL_SENSITIVE: Array<[string, string]> = [
  ["the reported artist name with $ sequences", "¥ØU$UK€ ¥UK1MAT$U"],
  ["$HOME / ${PATH} variable references", "$HOME and ${PATH}"],
  ["double quotes", 'DJ "The Name" Smith'],
  ["single quotes", "Rock 'n' Roll"],
  ["leading/trailing and repeated spaces", "  two  spaces  "],
  ["backticks", "`touch pwned-backtick`"],
  ["command substitution", "$(touch pwned-subst)"],
  ["; | & < > separators", "a; touch pwned-semi | b && c > out < in &"],
  ["backslashes", "back\\slash \\n \\$x"],
  ["glob characters", "* ? [abc]"],
  ["a literal newline", "line one\nline two"],
  ["a ! history character", "Wow!!"],
  ["comma-separated artist list", "Artist A, $B, C'D"],
];

describe("inspect-source.yml — no user input is interpolated into shell script text", () => {
  it("found the steps this test depends on", () => {
    expect(inspectStep?.run).toBeTruthy();
    expect(validateStep?.run).toBeTruthy();
  });

  it("no step's run: script contains a ${{ }} expression", () => {
    for (const step of steps) {
      if (step.run !== null) expect(step.run, `step "${step.name}"`).not.toContain("${{");
    }
  });

  it("every declared workflow_dispatch input is passed to the inspection step via env", () => {
    const inputs = declaredInputs(WORKFLOW);
    expect(inputs.length).toBeGreaterThan(20);
    for (const name of inputs) {
      expect(inspectStep!.env[`INPUT_${name.toUpperCase()}`], name).toBe(`\${{ inputs.${name} }}`);
    }
  });
});

describe("inspect-source.yml — inspection step passes inputs through literally", () => {
  it.each(SHELL_SENSITIVE)("dedup_artists with %s", (_desc, value) => {
    const r = runInspect({ mode: "youtube-preview-dry-run", dedup_artists: value });
    expect(r.status, r.stderr).toBe(0);
    expect(r.args).toEqual(["--mode=youtube-preview-dry-run", `--artists=${value}`]);
  });

  it.each(SHELL_SENSITIVE)("every free-text input with %s", (_desc, value) => {
    const r = runInspect({
      mode: "dedup-simulate",
      dedup_title: value,
      dedup_artists: value,
      dedup_venue: value,
      dedup_subvenue: value,
      dedup_url: value,
      body: value,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.args).toEqual([
      "--mode=dedup-simulate",
      `--body=${value}`,
      `--title=${value}`,
      `--artists=${value}`,
      `--venue=${value}`,
      `--subvenue=${value}`,
      `--url=${value}`,
    ]);
  });

  it("never executed any embedded command", () => {
    for (const f of ["pwned-backtick", "pwned-subst", "pwned-semi", "out"]) {
      expect(existsSync(path.join(scratch, f)), f).toBe(false);
    }
  });
});

describe("inspect-source.yml — existing diagnostic modes and flags are preserved", () => {
  it("DB modes still load .env.local; reachability/youtube-preview-dry-run still do not", () => {
    expect(runInspect({ mode: "inventory" }).nodeFlags).toEqual(["--env-file=.env.local", "--import", "tsx"]);
    expect(runInspect({ mode: "reachability" }).nodeFlags).toEqual(["--import", "tsx"]);
    expect(runInspect({ mode: "youtube-preview-dry-run" }).nodeFlags).toEqual(["--import", "tsx"]);
  });

  it("empty inputs add no flags (only --mode, plus the default limit)", () => {
    expect(runInspect({ mode: "inventory", limit: "20" }).args).toEqual(["--mode=inventory", "--limit=20"]);
  });

  it("maps every input to the same CLI flag, in the same order, as before", () => {
    const r = runInspect({
      mode: "reachability",
      source_id: "src-poolen",
      endpoint: "https://poolen.dk/da/?a=1&b=2",
      save_body_path: "/tmp/fixture.html",
      print_full_body: "true",
      no_follow_redirects: "true",
      body_start: "100",
      body_length: "500",
      method: "POST",
      body: "action=fetch_concerts&genres=Elektronisk",
      with_credentials: "true",
      limit: "5",
      dedup_title: "T",
      dedup_artists: "A",
      dedup_venue: "V",
      dedup_subvenue: "Store VEGA",
      dedup_start: "2026-10-02T22:00:00+02:00",
      dedup_url: "https://x.example/e",
      table: "events",
      detail_category: "needs_review",
      detail_source: "src-billetto",
      detail_limit: "10",
      detail_offset: "20",
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.args).toEqual([
      "--mode=reachability",
      "--source=src-poolen",
      "--endpoint=https://poolen.dk/da/?a=1&b=2",
      "--save-body=/tmp/fixture.html",
      "--print-full-body",
      "--no-follow-redirects",
      "--body-start=100",
      "--body-length=500",
      "--method=POST",
      "--body=action=fetch_concerts&genres=Elektronisk",
      "--with-credentials",
      "--limit=5",
      "--title=T",
      "--artists=A",
      "--venue=V",
      "--subvenue=Store VEGA",
      "--start=2026-10-02T22:00:00+02:00",
      "--url=https://x.example/e",
      "--table=events",
      "--detail-category=needs_review",
      "--detail-source=src-billetto",
      "--detail-limit=10",
      "--detail-offset=20",
    ]);
  });

  it("boolean inputs other than exactly 'true' add no flag", () => {
    const r = runInspect({ mode: "reachability", print_full_body: "false", no_follow_redirects: "false", with_credentials: "false" });
    expect(r.args).toEqual(["--mode=reachability"]);
  });
});

describe("inspect-source.yml — source_id validation step", () => {
  const runValidate = (value: string) =>
    spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", validateStep!.run!], {
      cwd: scratch,
      env: { NODE_ENV: "test", PATH: process.env.PATH, INPUT_SOURCE_ID: value },
      encoding: "utf-8",
    });

  it("accepts a well-formed source id", () => {
    expect(runValidate("src-poolen").status).toBe(0);
  });

  const validateCases: Array<[string, string]> = [
    ...SHELL_SENSITIVE,
    ["a valid id followed by an injected command", "src-x$(touch pwned-validate)"],
  ];
  it.each(validateCases)(
    "rejects (without executing) %s, echoing the value literally",
    (_desc, value) => {
      const r = runValidate(value);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain(`got: ${value}`);
      expect(existsSync(path.join(scratch, "pwned-validate"))).toBe(false);
    },
  );
});
