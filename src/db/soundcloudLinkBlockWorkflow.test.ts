import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Input handling of .github/workflows/soundcloud-link-block.yml (same
 * hardening and test approach as youtubePreviewWorkflows.test.ts): resolves
 * the real run step's env from its own `env:` mapping exactly as GitHub
 * would, runs its `run:` script under bash with a stub `node` that only
 * records argv — no database.
 */
const yaml = readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "soundcloud-link-block.yml"), "utf-8");

function runStep(): { env: Record<string, string>; script: string } {
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => /^ {6}- name: Run SoundCloud link manual block\/unblock$/.test(l));
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
const scratch = mkdtempSync(path.join(tmpdir(), "soundcloud-block-wf-"));
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

const PREFIX = ["--env-file=.env.local", "--import", "tsx", "src/db/soundcloudLinkBlock.ts"];

describe("soundcloud-link-block.yml — inputs reach the script exactly as typed", () => {
  it("never interpolates inputs into the script itself", () => {
    expect(step.script).not.toContain("${{");
    expect(Object.keys(step.env).sort()).toEqual(["INPUT_CONFIRM", "INPUT_MODE", "INPUT_REASON", "INPUT_URL"]);
  });

  it("plan mode passes only mode and url", () => {
    expect(run({ mode: "plan", url: "https://soundcloud.com/guy-j" })).toEqual({
      status: 0,
      argv: [...PREFIX, "--mode=plan", "--url=https://soundcloud.com/guy-j"],
    });
  });

  it.each([
    ["a reason with $ and quotes", 'not "Guy J" — wrong $artist'],
    ["command substitution", "$(touch pwned-reason)"],
    ["backticks", "`touch pwned-tick`"],
  ])("block mode passes reason and confirm verbatim (%s) and executes nothing", (_label, reason) => {
    const result = run({ mode: "block", url: "https://soundcloud.com/x?y=$(touch pwned-url)", reason, confirm: "BLOCK-SOUNDCLOUD-LINK" });
    expect(result.status).toBe(0);
    expect(result.argv).toEqual([
      ...PREFIX,
      "--mode=block",
      "--url=https://soundcloud.com/x?y=$(touch pwned-url)",
      `--reason=${reason}`,
      "--confirm=BLOCK-SOUNDCLOUD-LINK",
    ]);
    expect(readdirSync(work)).toEqual([]);
  });
});
