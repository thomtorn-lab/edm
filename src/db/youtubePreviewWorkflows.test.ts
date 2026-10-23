import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Regression coverage for the input handling of
 * .github/workflows/youtube-preview-block.yml and
 * .github/workflows/youtube-preview-backfill.yml (same hardening as
 * inspect-source.yml / validate-source.yml / prepare-production-db.yml).
 *
 * The old `${{ inputs.* }}`-in-script version silently changed artist names
 * before they reached the script — `A$$AP Rocky` became `A<pid>AP Rocky`,
 * `Rock "n" Roll` became `Rock n Roll` — so block mode wrote a manualBlock row
 * for the WRONG normalized name and left the real artist unblocked; `Ke$ha`
 * and `¥ØU$UK€ ¥UK1MAT$U` aborted under `set -u`; `cmd`/$(cmd) executed.
 *
 * These tests read the REAL workflows, resolve each step's env from its own
 * `env:` mapping exactly as GitHub would, and run its `run:` script under bash
 * with a stub `node` that only records argv — no database, no YouTube call.
 */

type Step = { name: string; env: Record<string, string>; run: string | null };

function readSteps(yaml: string): Step[] {
  const steps: Step[] = [];
  let current: Step | null = null;
  let section: "env" | "run" | null = null;
  for (const line of yaml.split("\n")) {
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

const wf = (name: string) => readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", name), "utf-8");
const blockSteps = readSteps(wf("youtube-preview-block.yml"));
const backfillSteps = readSteps(wf("youtube-preview-backfill.yml"));
const blockRun = blockSteps.find((s) => s.name === "Run YouTube preview manual block/unblock")!;
const backfillRun = backfillSteps.find((s) => s.name === "Run YouTube preview backfill")!;

const scratch = mkdtempSync(path.join(tmpdir(), "youtube-preview-wf-"));
const fakeBin = path.join(scratch, "bin");
const work = path.join(scratch, "work"); // cwd for every step: a stray `touch` would land here
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
{
  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(work, { recursive: true });
  writeFileSync(path.join(fakeBin, "node"), `#!/usr/bin/env bash\nprintf '%s\\0' "$@" > "$ARGV_OUT"\n`);
  chmodSync(path.join(fakeBin, "node"), 0o755);
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
  const argvFile = path.join(scratch, `argv-${++runCounter}`);
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", s.run!], {
    cwd: work,
    // NODE_ENV is required by Next's ProcessEnv typing; the scripts never read it.
    env: { NODE_ENV: "test", PATH: `${fakeBin}:${process.env.PATH}`, ARGV_OUT: argvFile, ...resolveEnv(s, inputs) },
    encoding: "utf-8",
  });
  const argv = existsSync(argvFile) ? readFileSync(argvFile, "utf-8").split("\0").slice(0, -1) : null;
  return { status: result.status, stderr: result.stderr, argv };
}

const PREFIX = ["--env-file=.env.local", "--import", "tsx"];

// Real-world-shaped artist names, each of which the old interpolation broke,
// changed or (for the last few) executed — plus ordinary ones as controls.
const ARTIST_NAMES: Array<[string, string]> = [
  ["plain", "Benji"],
  ["plain with space", "Benji B"],
  ["the reported $ name", "¥ØU$UK€ ¥UK1MAT$U"],
  ["$$ (expanded to the shell PID before)", "A$$AP Rocky"],
  ["single $ word", "A$AP Rocky"],
  ["$ mid-word", "Ke$ha"],
  ["$ at both ends", "$uicideboy$"],
  ["$$ at the end", "Kid A$$"],
  ["double quotes (stripped before)", 'Rock "n" Roll'],
  ["quoted nickname", 'DJ "Koze"'],
  ["apostrophe", "Guns N' Roses"],
  ["non-ASCII", "Âme"],
  ["non-ASCII 2", "Röyksopp"],
  ["slash", "AC/DC"],
  ["parentheses", "Sunn O)))"],
  ["exclamation marks", "!!!"],
  ["leading asterisk", "*NSYNC"],
  ["leading question mark", "?uestlove"],
  ["ampersand", "Ellen Allien & Apparat"],
  ["semicolon", "Moderat; Live"],
  ["backslash", "DJ\\Slash"],
  ["repeated spaces", "Two  Spaces"],
  ["backticks", "`touch pwned-artist-tick`"],
  ["command substitution", "$(touch pwned-artist-subst)"],
  ["quote break-out", 'x"; touch pwned-artist-breakout; echo "'],
];

describe("YouTube preview workflows — structure unchanged, no ${{ }} in any shell script", () => {
  it("youtube-preview-block.yml keeps every step, in order", () => {
    expect(blockSteps.map((s) => s.name)).toEqual([
      "Checkout",
      "Set up Node.js",
      "Verify DATABASE_URL secret is configured",
      "Install dependencies",
      "Write DATABASE_URL for the script",
      "Run YouTube preview manual block/unblock",
      "Remove local env file",
    ]);
  });

  it("youtube-preview-backfill.yml keeps every step, in order", () => {
    expect(backfillSteps.map((s) => s.name)).toEqual([
      "Checkout",
      "Set up Node.js",
      "Verify DATABASE_URL secret is configured",
      "Verify YOUTUBE_API_KEY secret is configured",
      "Install dependencies",
      "Write DATABASE_URL for the script",
      "Run YouTube preview backfill",
      "Remove local env file",
    ]);
  });

  it("no run: script in either workflow contains a ${{ }} expression", () => {
    for (const s of [...blockSteps, ...backfillSteps]) if (s.run !== null) expect(s.run, s.name).not.toContain("${{");
  });

  it("every env: value is exactly one inputs/secrets expression", () => {
    for (const s of [...blockSteps, ...backfillSteps]) expect(() => resolveEnv(s, {}), s.name).not.toThrow();
  });

  it("the backfill step still receives YOUTUBE_API_KEY", () => {
    expect(backfillRun.env.YOUTUBE_API_KEY).toBe("${{ secrets.YOUTUBE_API_KEY }}");
  });

  it("the block/pin step receives YOUTUBE_API_KEY (pin and plan-with-video look the video up)", () => {
    expect(blockRun.env.YOUTUBE_API_KEY).toBe("${{ secrets.YOUTUBE_API_KEY }}");
  });
});

describe("youtube-preview-block.yml — artist names reach the script exactly", () => {
  it.each(ARTIST_NAMES)("plan mode, %s", (_desc, name) => {
    const r = runStep(blockRun, { mode: "plan", artist: name, confirm: "" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv).toEqual([...PREFIX, "src/db/youtubePreviewBlock.ts", "--mode=plan", `--artist=${name}`]);
  });

  it.each(ARTIST_NAMES)("block mode with confirm, %s", (_desc, name) => {
    const r = runStep(blockRun, { mode: "block", artist: name, confirm: "BLOCK-YOUTUBE-PREVIEW" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv).toEqual([
      ...PREFIX,
      "src/db/youtubePreviewBlock.ts",
      "--mode=block",
      `--artist=${name}`,
      "--confirm=BLOCK-YOUTUBE-PREVIEW",
    ]);
  });

  it("pin mode passes --video before --confirm, exactly as typed", () => {
    const video = "https://youtu.be/Pbb0KmuwYSA?si=DGtesIfBBSpPnOoQ&x=$(touch pwned-video)";
    const r = runStep(blockRun, { mode: "pin", artist: "Kardinal Bertram", video, confirm: "PIN-YOUTUBE-PREVIEW" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv?.slice(-4)).toEqual(["--mode=pin", "--artist=Kardinal Bertram", `--video=${video}`, "--confirm=PIN-YOUTUBE-PREVIEW"]);
  });

  it("unblock mode passes its own token through unchanged", () => {
    const r = runStep(blockRun, { mode: "unblock", artist: "Benji", confirm: "UNBLOCK-YOUTUBE-PREVIEW" });
    expect(r.argv?.slice(-3)).toEqual(["--mode=unblock", "--artist=Benji", "--confirm=UNBLOCK-YOUTUBE-PREVIEW"]);
  });

  it.each<[string, string]>([
    ["two double quotes", 'a" "b'],
    ["the token pasted inside quotes", '"BLOCK-YOUTUBE-PREVIEW"'],
    ["command substitution", "$(touch pwned-confirm)"],
  ])("a confirm value with %s is passed literally (the script's own exact-match gate then rejects it)", (_desc, value) => {
    const r = runStep(blockRun, { mode: "block", artist: "Benji", confirm: value });
    expect(r.argv?.at(-1)).toBe(`--confirm=${value}`);
  });
});

describe("youtube-preview-backfill.yml — arguments reach the script exactly", () => {
  it("plan mode with every optional input empty passes only --mode, as before", () => {
    const r = runStep(backfillRun, { mode: "plan" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv).toEqual([...PREFIX, "src/db/youtubePreviewBackfill.ts", "--mode=plan"]);
  });

  it("apply mode maps every input to the same flag, in the same order, as before", () => {
    const r = runStep(backfillRun, {
      mode: "apply",
      confirm: "BACKFILL-YOUTUBE-PREVIEW",
      limit: "50",
      batch_size: "20",
      artist: "Eric Prydz",
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv).toEqual([
      ...PREFIX,
      "src/db/youtubePreviewBackfill.ts",
      "--mode=apply",
      "--confirm=BACKFILL-YOUTUBE-PREVIEW",
      "--limit=50",
      "--batch-size=20",
      "--artist=Eric Prydz",
    ]);
  });

  it.each(ARTIST_NAMES)("apply mode --artist, %s", (_desc, name) => {
    const r = runStep(backfillRun, { mode: "apply", confirm: "BACKFILL-YOUTUBE-PREVIEW", artist: name });
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv?.slice(-1)).toEqual([`--artist=${name}`]);
    expect(r.argv).toHaveLength(PREFIX.length + 4);
  });

  it.each<[string, string]>([
    ["spaces", "5 0"],
    ["command substitution", "$(touch pwned-limit)"],
    ["backticks", "`touch pwned-limit-tick`"],
    ["a $ reference", "$HOME"],
  ])("limit and batch_size with %s are passed literally (the script validates them)", (_desc, value) => {
    const r = runStep(backfillRun, { mode: "plan", limit: value, batch_size: value });
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv?.slice(-2)).toEqual([`--limit=${value}`, `--batch-size=${value}`]);
  });
});

describe("YouTube preview workflows — nothing embedded in any input was ever executed", () => {
  // Declared last; vitest runs tests in file order, so every case above has run.
  it("left no file behind in the steps' working directory", () => {
    expect(readdirSync(work)).toEqual([]);
  });
});
