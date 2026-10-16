import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Input handling of .github/workflows/culture-box-e-8a410de7-lineup-correction.yml (same
 * hardening and test approach as youtubePreviewWorkflows.test.ts): resolves
 * the real run step's env from its own `env:` mapping exactly as GitHub
 * would, runs its `run:` script under bash with a stub `node` that only
 * records argv — no database.
 */
const yaml = readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "culture-box-e-8a410de7-lineup-correction.yml"), "utf-8");

function runStep(): { env: Record<string, string>; script: string } {
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => /^ {6}- name: Run e-8a410de7 lineup correction$/.test(l));
  const env: Record<string, string> = {};
  let script = "";
  let section: "env" | "run" | null = null;
  for (const line of lines.slice(start + 1)) {
    if (/^ {6}- name:/.test(line)) break;
    if (/^ {8}env:\s*$/.test(line)) section = "env";
    else if (/^ {8}run: \|\s*$/.test(line)) section = "run";
    else if (/^ {8}\S/.test(line)) section = null;
    else if (section === "env") {
      const kv = line.match(/^ {10}([A-Z0-9_]+): (.*)$/);
      if (kv) env[kv[1]] = kv[2].trim();
    } else if (section === "run" && (line.trim() === "" || line.startsWith("          "))) script += line.slice(10) + "\n";
  }
  return { env, script };
}

const step = runStep();
const scratch = mkdtempSync(path.join(tmpdir(), "cb-correction-wf-"));
const fakeBin = path.join(scratch, "bin");
const work = path.join(scratch, "work");
mkdirSync(fakeBin, { recursive: true });
mkdirSync(work, { recursive: true });
writeFileSync(path.join(fakeBin, "node"), `#!/usr/bin/env bash\nprintf '%s\\0' "$@" > "$ARGV_OUT"\n`);
chmodSync(path.join(fakeBin, "node"), 0o755);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
function run(inputs: Record<string, string>) {
  const env: Record<string, string> = {};
  for (const [key, expr] of Object.entries(step.env)) {
    const m = expr.match(/^\$\{\{ inputs\.([a-z_]+) \}\}$/);
    if (!m) throw new Error(`unexpected env expression: ${key}: ${expr}`);
    env[key] = inputs[m[1]] ?? "";
  }
  const argvFile = path.join(scratch, `argv-${++counter}`);
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", step.script], {
    cwd: work,
    env: { NODE_ENV: "test", PATH: `${fakeBin}:${process.env.PATH}`, ARGV_OUT: argvFile, ...env },
    encoding: "utf-8",
  });
  const argv = existsSync(argvFile) ? readFileSync(argvFile, "utf-8").split("\0").slice(0, -1) : null;
  return { status: result.status, argv };
}

const PREFIX = ["--env-file=.env.local", "--import", "tsx", "src/db/cultureBoxOct16LineupCorrection.ts"];

describe("culture-box-e-8a410de7-lineup-correction.yml", () => {
  it("never interpolates inputs into the script, and takes only mode and confirm", () => {
    expect(step.script).not.toContain("${{");
    expect(Object.keys(step.env).sort()).toEqual(["INPUT_CONFIRM", "INPUT_MODE"]);
  });

  it("defaults to plan, needs only the DATABASE_URL secret, and exposes no other secret", () => {
    expect(yaml).toMatch(/default: plan/);
    expect([...yaml.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1])).toEqual(["DATABASE_URL", "DATABASE_URL"]);
    expect(yaml).not.toMatch(/ADMIN_(USERNAME|PASSWORD)|curl /);
    expect(yaml).toMatch(/permissions:\n {2}contents: read/);
  });

  it("plan mode passes only the mode", () => {
    expect(run({ mode: "plan" })).toEqual({ status: 0, argv: [...PREFIX, "--mode=plan"] });
  });

  it("apply passes the confirm verbatim", () => {
    expect(run({ mode: "apply", confirm: "CORRECT-CULTURE-BOX-E-8A410DE7" })).toEqual({
      status: 0,
      argv: [...PREFIX, "--mode=apply", "--confirm=CORRECT-CULTURE-BOX-E-8A410DE7"],
    });
  });

  it.each([
    ["command substitution", "$(touch pwned-confirm)"],
    ["backticks", "`touch pwned-tick`"],
  ])("a hostile confirm (%s) is passed as data and executes nothing", (_label, confirm) => {
    const result = run({ mode: "apply", confirm });
    expect(result).toEqual({ status: 0, argv: [...PREFIX, "--mode=apply", `--confirm=${confirm}`] });
    expect(readdirSync(work)).toEqual([]);
  });
});
