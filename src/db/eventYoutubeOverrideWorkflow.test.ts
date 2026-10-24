import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * .github/workflows/event-youtube-override.yml (2026-10-23), same approach as
 * soundcloudLinkBlockWorkflow.test.ts: resolve the real run step's env from
 * its own `env:` mapping, run its `run:` script under bash with a stub `node`
 * that only records argv — no database, no YouTube. Also pins the weekly
 * schedule's safety: off until EVENT_VIDEO_VERIFY_ENABLED is "true", and a
 * scheduled run can only ever do `verify`.
 */
const yaml = readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "event-youtube-override.yml"), "utf-8");

function runStep(): { env: Record<string, string>; script: string } {
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => /^ {6}- name: Run event YouTube video override$/.test(l));
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
const scratch = mkdtempSync(path.join(tmpdir(), "event-youtube-override-wf-"));
const fakeBin = path.join(scratch, "bin");
const work = path.join(scratch, "work");
mkdirSync(fakeBin, { recursive: true });
mkdirSync(work, { recursive: true });
writeFileSync(path.join(fakeBin, "node"), `#!/usr/bin/env bash\nprintf '%s\\0' "$@" > "$ARGV_OUT"\n`);
chmodSync(path.join(fakeBin, "node"), 0o755);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
function run(inputs: Record<string, string>, eventName = "workflow_dispatch") {
  const env: Record<string, string> = {};
  for (const [key, expr] of Object.entries(step.env)) {
    const m = expr.match(/^\$\{\{ (inputs|secrets|github)\.([a-z_A-Z]+) \}\}$/);
    if (!m) throw new Error(`unexpected env expression: ${key}: ${expr}`);
    env[key] = m[1] === "inputs" ? (inputs[m[2]] ?? "") : m[1] === "github" ? eventName : `test-secret-${m[2]}`;
  }
  const argvFile = path.join(scratch, `argv-${++counter}`);
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", step.script], {
    cwd: work,
    env: { NODE_ENV: "test", PATH: `${fakeBin}:${process.env.PATH}`, ARGV_OUT: argvFile, ...env },
    encoding: "utf-8",
  });
  const argv = existsSync(argvFile) ? readFileSync(argvFile, "utf-8").split("\0").slice(0, -1) : null;
  return { status: result.status, prefix: argv?.slice(0, PREFIX.length) ?? null, argv: argv?.slice(PREFIX.length) ?? null };
}

const PREFIX = ["--env-file=.env.local", "--import", "tsx", "src/db/eventYoutubeOverride.ts"];

describe("event-youtube-override.yml — weekly schedule stays off until enabled", () => {
  it("has a weekly schedule, gated at job level on the EVENT_VIDEO_VERIFY_ENABLED variable", () => {
    expect(yaml).toMatch(/^on:\n {2}schedule:\n(?: {4}#.*\n)* {4}- cron: "17 5 \* \* 1"$/m);
    expect(yaml).toMatch(/^ {4}if: github\.event_name != 'schedule' \|\| vars\.EVENT_VIDEO_VERIFY_ENABLED == 'true'$/m);
  });

  it("a scheduled run ignores every input and can only verify", () => {
    const r = run({ mode: "clear", event: "e-a2b5cf47", confirm: "CLEAR-EVENT-YOUTUBE-VIDEO" }, "schedule");
    expect(r.status).toBe(0);
    expect(r.argv).toEqual(["--mode=verify", "--confirm=VERIFY-EVENT-YOUTUBE-VIDEOS"]);
  });

  it("only uses DATABASE_URL and YOUTUBE_API_KEY secrets", () => {
    expect([...new Set([...yaml.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]))].sort()).toEqual(["DATABASE_URL", "YOUTUBE_API_KEY"]);
  });
});

describe("event-youtube-override.yml — inputs reach the script exactly as typed", () => {
  it("never interpolates inputs into the script itself", () => {
    expect(step.script).not.toContain("${{");
  });

  it("calls the right script", () => {
    expect(run({ mode: "plan", event: "e-a2b5cf47" }).prefix).toEqual(PREFIX);
  });

  it("plan mode passes only what was given", () => {
    expect(run({ mode: "plan", event: "e-a2b5cf47" }).argv).toEqual(["--mode=plan", "--event=e-a2b5cf47"]);
    expect(run({ mode: "verify-plan" }).argv).toEqual(["--mode=verify-plan"]);
  });

  it("migrate mode passes every input, in order", () => {
    expect(
      run({
        mode: "migrate-artist-pin",
        event: "e-a2b5cf47",
        video: "https://youtu.be/Pbb0KmuwYSA?si=DGtesIfBBSpPnOoQ",
        artist: "STEAMBOI",
        assert_blocked: "LMN",
        confirm: "MIGRATE-ARTIST-PIN",
      }).argv,
    ).toEqual([
      "--mode=migrate-artist-pin",
      "--event=e-a2b5cf47",
      "--video=https://youtu.be/Pbb0KmuwYSA?si=DGtesIfBBSpPnOoQ",
      "--artist=STEAMBOI",
      "--assert-blocked=LMN",
      "--confirm=MIGRATE-ARTIST-PIN",
    ]);
  });

  it.each([
    ["$ and quotes", 'A$$AP "Rocky"'],
    ["command substitution", "$(touch pwned-artist)"],
    ["backticks", "`touch pwned-tick`"],
  ])("passes hostile values verbatim (%s) and executes nothing", (_label, value) => {
    const r = run({ mode: "set", event: value, video: `${value}?v=$(touch pwned-video)`, artist: value, confirm: value });
    expect(r.status).toBe(0);
    expect(r.argv).toEqual(["--mode=set", `--event=${value}`, `--video=${value}?v=$(touch pwned-video)`, `--artist=${value}`, `--confirm=${value}`]);
    expect(readdirSync(work)).toEqual([]);
  });
});
