import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Regression coverage for .github/workflows/validate-source.yml's input
 * handling — the same hardening inspect-source.yml received (see
 * inspectSourceWorkflow.test.ts). The workflow used to paste
 * `${{ inputs.* }}` (and step outputs derived from them) straight into its
 * `run:` scripts, so bash re-parsed user input as code: `$x` expanded,
 * `` `cmd` ``/`$(cmd)` executed, and a `"` could break out of the quoting.
 * Every such value now reaches the scripts only through step-level `env:`.
 *
 * These tests read the REAL workflow file, build each step's environment
 * from that step's own `env:` mapping exactly as GitHub would (inputs, prior
 * step outputs, placeholder secrets/vars), and execute the step's `run:`
 * script under bash with stub `node` and `curl` binaries that only record
 * their argv. Nothing touches a database, the network, or a real sync.
 */

const WORKFLOW = readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "validate-source.yml"), "utf-8");

type Step = { job: string; name: string; env: Record<string, string>; run: string | null };

/** Minimal, indentation-based reader for this workflow's `jobs.<job>.steps` lists. */
function readSteps(yaml: string): Step[] {
  const lines = yaml.split("\n");
  const steps: Step[] = [];
  let job = "";
  let inJobs = false;
  let current: Step | null = null;
  let section: "env" | "run" | null = null;
  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    const jobStart = line.match(/^ {2}([a-z0-9-]+):\s*$/);
    if (jobStart) {
      job = jobStart[1];
      current = null;
      section = null;
      continue;
    }
    const stepStart = line.match(/^ {6}- name: (.*)$/);
    if (stepStart) {
      current = { job, name: stepStart[1].trim().replace(/^"(.*)"$/, "$1"), env: {}, run: null };
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

const steps = readSteps(WORKFLOW);
function step(job: string, name: string): Step {
  const found = steps.find((s) => s.job === job && s.name === name);
  if (!found?.run) throw new Error(`step not found: ${job} / ${name}`);
  return found;
}

const scratch = mkdtempSync(path.join(tmpdir(), "validate-source-wf-"));
const fakeBin = path.join(scratch, "bin");
const work = path.join(scratch, "work"); // cwd for every step: a stray `touch` would land here
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
{
  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(work, { recursive: true });
  // One stub for both binaries: appends "<name>\0<arg>\0<arg>...\x1e" to $CALLS_OUT.
  // curl answers like the real calls expect: "<body>\n<status>" when asked for
  // '\n%{http_code}', otherwise just "<status>" (STUB_HTTP_STATUS, default 200).
  const stub = `#!/usr/bin/env bash
{ printf '%s\\0' "$(basename "$0")" "$@"; printf '\\036'; } >> "$CALLS_OUT"
if [ "$(basename "$0")" = "curl" ]; then
  status="\${STUB_HTTP_STATUS:-200}"
  for a in "$@"; do [ "$a" = '\\n%{http_code}' ] && { printf '{"created":0}\\n%s' "$status"; exit 0; }; done
  printf '%s' "$status"
fi
`;
  for (const name of ["node", "curl"]) {
    writeFileSync(path.join(fakeBin, name), stub);
    chmodSync(path.join(fakeBin, name), 0o755);
  }
}

type Ctx = {
  inputs?: Record<string, string>;
  outputs?: Record<string, Record<string, string>>; // steps.<id>.outputs.<key>
  vars?: Record<string, string>;
  extraEnv?: Record<string, string>;
};

/** Resolves a step's `env:` mapping the way GitHub does — one whole `${{ }}` expression per value. */
function resolveEnv(s: Step, ctx: Ctx): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, expr] of Object.entries(s.env)) {
    const m = expr.match(/^\$\{\{ (inputs|secrets|vars|steps)\.([a-z_A-Z0-9]+)(?:\.outputs\.([a-z_]+))? \}\}$/);
    if (!m) throw new Error(`unexpected env expression in "${s.name}": ${key}: ${expr}`);
    const [, ctxName, a, b] = m;
    env[key] =
      ctxName === "inputs"
        ? (ctx.inputs?.[a] ?? "")
        : ctxName === "secrets"
          ? `test-secret-${a}`
          : ctxName === "vars"
            ? (ctx.vars?.[a] ?? "")
            : (ctx.outputs?.[a]?.[b!] ?? "");
  }
  return env;
}

let runCounter = 0;
function runStep(s: Step, ctx: Ctx = {}) {
  const id = ++runCounter;
  const outputFile = path.join(scratch, `output-${id}`);
  const callsFile = path.join(scratch, `calls-${id}`);
  writeFileSync(outputFile, "");
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", s.run!], {
    cwd: work,
    // NODE_ENV is required by Next's ProcessEnv typing; the scripts never read it.
    env: {
      NODE_ENV: "test",
      PATH: `${fakeBin}:${process.env.PATH}`,
      GITHUB_OUTPUT: outputFile,
      CALLS_OUT: callsFile,
      ...ctx.extraEnv,
      ...resolveEnv(s, ctx),
    },
    encoding: "utf-8",
  });
  const outputs: Record<string, string> = {};
  for (const line of readFileSync(outputFile, "utf-8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) outputs[line.slice(0, eq)] = line.slice(eq + 1);
  }
  const calls = existsSync(callsFile)
    ? readFileSync(callsFile, "utf-8")
        .split("\x1e")
        .filter(Boolean)
        .map((rec) => {
          const [cmd, ...argv] = rec.split("\0").slice(0, -1);
          return { cmd, argv };
        })
    : [];
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, outputs, calls };
}

// Values that must survive as literal data. None ends in "/" (base_url trims one).
const SHELL_SENSITIVE: Array<[string, string]> = [
  ["a $ artist-style name", "¥ØU$UK€ ¥UK1MAT$U"],
  ["$VAR / ${VAR} references", "$HOME-${PATH}-$SYNC_TRIGGER_TOKEN"],
  ["double quotes", 'a"b"c'],
  ["single quotes", "it's 'quoted'"],
  ["spaces", "  two  spaces  "],
  ["backticks", "`touch pwned-backtick`"],
  ["command substitution", "$(touch pwned-subst)"],
  ["; | & < > separators", "x; touch pwned-semi | y && z > out-file < in &"],
  ["a quote break-out attempt", 'x" ; touch pwned-breakout ; echo "'],
  ["backslashes", "back\\slash \\$x \\n"],
  ["glob characters", "* ? [abc]"],
  ["a ! history character", "Wow!!"],
];
// Values written to $GITHUB_OUTPUT are single-line by GitHub's own format, so
// the newline case is exercised only where nothing is written to an output.
const WITH_NEWLINE: Array<[string, string]> = [...SHELL_SENSITIVE, ["a literal newline", "line one\nline two"]];

describe("validate-source.yml — structure is unchanged and no ${{ }} reaches a shell script", () => {
  it("keeps every existing step, in order, in both jobs", () => {
    expect(steps.filter((s) => s.job === "static-checks").map((s) => s.name)).toEqual([
      "Validate source_id format",
      "Checkout requested ref",
      "Record the exact commit this run is validating",
      "Set up Node.js",
      "Install dependencies",
      "Lint",
      "Unit tests",
      "Verify DATABASE_URL secret is configured (required for build — see next step)",
      "Typecheck + build",
    ]);
    expect(steps.filter((s) => s.job === "live-preview-validation").map((s) => s.name)).toEqual([
      "Require explicit confirmation for a live sync",
      "Resolve target base URL",
      "Checkout requested ref",
      "Set up Node.js",
      "Verify required secrets are configured",
      "Confirm the target deployment is actually reachable before touching anything",
      "Install dependencies",
      "Write DATABASE_URL for the diagnostic script",
      "Resolve sync endpoint path",
      "BEFORE snapshot",
      "Trigger sync N times (idempotency check)",
      "Source health verdict",
      "Sync lock status (should be clear — sync already finished)",
      "Discovery queue results",
      "Remove local env file",
    ]);
  });

  it("no step's run: script contains a ${{ }} expression", () => {
    for (const s of steps) if (s.run !== null) expect(s.run, `${s.job} / ${s.name}`).not.toContain("${{");
  });

  it("every env: value is exactly one inputs/secrets/vars/steps expression (resolvable without string splicing)", () => {
    for (const s of steps) expect(() => resolveEnv(s, {}), `${s.job} / ${s.name}`).not.toThrow();
  });

  it("the static checks job still runs exactly lint, tests and the normal build — no migration or sync command", () => {
    const runs = steps.filter((s) => s.job === "static-checks").map((s) => s.run?.trim());
    expect(runs).toContain("npm run lint");
    expect(runs).toContain("npm run test");
    expect(runs).toContain("npm run build");
    expect(runs.join("\n")).not.toMatch(/db:migrate|drizzle-kit|\/api\/sync/);
  });
});

describe("validate-source.yml — source_id validation (static-checks)", () => {
  const s = step("static-checks", "Validate source_id format");

  it("accepts a well-formed source id", () => {
    expect(runStep(s, { inputs: { source_id: "src-poolen" } }).status).toBe(0);
  });

  it.each([...WITH_NEWLINE, ["a valid id followed by an injected command", "src-x$(touch pwned-validate)"]])(
    "rejects %s without executing it, echoing the value literally",
    (_desc, value) => {
      const r = runStep(s, { inputs: { source_id: value } });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain(`got: ${value}`);
    },
  );
});

describe("validate-source.yml — live-sync confirmation gate", () => {
  const s = step("live-preview-validation", "Require explicit confirmation for a live sync");

  it("passes only on exactly VALIDATE-SOURCE", () => {
    expect(runStep(s, { inputs: { confirm: "VALIDATE-SOURCE" } }).status).toBe(0);
    expect(runStep(s, { inputs: { confirm: "" } }).status).toBe(1);
    expect(runStep(s, { inputs: { confirm: "validate-source" } }).status).toBe(1);
    expect(runStep(s, { inputs: { confirm: " VALIDATE-SOURCE" } }).status).toBe(1);
  });

  it.each([
    ...WITH_NEWLINE,
    ["a test-expression break-out", 'x" = "x" ] || [ "'],
    ["a break-out that would otherwise satisfy the gate", 'VALIDATE-SOURCE" ] && [ "a'],
  ])("cannot be bypassed by %s", (_desc, value) => {
    expect(runStep(s, { inputs: { confirm: value } }).status).toBe(1);
  });
});

describe("validate-source.yml — target base URL resolution", () => {
  const s = step("live-preview-validation", "Resolve target base URL");

  it.each(SHELL_SENSITIVE)("preview_base_url with %s is output literally", (_desc, value) => {
    const r = runStep(s, { inputs: { preview_base_url: value }, vars: { SYNC_BASE_URL: "https://standing.example" } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.outputs.base_url).toBe(value);
  });

  it("trims one trailing slash, as before", () => {
    expect(runStep(s, { inputs: { preview_base_url: "https://p.example.app/" } }).outputs.base_url).toBe("https://p.example.app");
  });

  it("falls back to the SYNC_BASE_URL repository variable when preview_base_url is empty", () => {
    const r = runStep(s, { inputs: { preview_base_url: "" }, vars: { SYNC_BASE_URL: "https://standing.example/" } });
    expect(r.status).toBe(0);
    expect(r.outputs.base_url).toBe("https://standing.example");
  });

  it("fails when neither is set", () => {
    expect(runStep(s, { inputs: { preview_base_url: "" } }).status).toBe(1);
  });
});

describe("validate-source.yml — reachability pre-check", () => {
  const s = step("live-preview-validation", "Confirm the target deployment is actually reachable before touching anything");

  it.each(SHELL_SENSITIVE)("requests the resolved base URL with %s literally", (_desc, value) => {
    const r = runStep(s, { outputs: { target: { base_url: value } } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].cmd).toBe("curl");
    expect(r.calls[0].argv.at(-1)).toBe(`${value}/`);
    expect(r.calls[0].argv).toContain("x-vercel-protection-bypass: test-secret-VERCEL_AUTOMATION_BYPASS_SECRET");
  });

  it("still stops on a non-2xx status, naming the URL literally", () => {
    const value = "https://p.example/$(touch pwned-reach)";
    const r = runStep(s, { outputs: { target: { base_url: value } }, extraEnv: { STUB_HTTP_STATUS: "503" } });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`::error::Target base URL ${value} did not return 2xx (got 503)`);
  });
});

describe("validate-source.yml — sync endpoint resolution", () => {
  const s = step("live-preview-validation", "Resolve sync endpoint path");

  it.each(SHELL_SENSITIVE)("sync_endpoint with %s is output literally", (_desc, value) => {
    const r = runStep(s, { inputs: { sync_endpoint: value, source_id: "src-poolen" } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.outputs.path).toBe(value);
  });

  it("defaults to source_id with its src- prefix stripped, as before", () => {
    expect(runStep(s, { inputs: { sync_endpoint: "", source_id: "src-culture-box" } }).outputs.path).toBe("culture-box");
  });

  it.each(SHELL_SENSITIVE)("the source_id fallback with %s stays literal too", (_desc, value) => {
    expect(runStep(s, { inputs: { sync_endpoint: "", source_id: `src-${value}` } }).outputs.path).toBe(value);
  });
});

describe("validate-source.yml — read-only inspectSource.ts steps pass source_id literally", () => {
  const cases: Array<[string, string[]]> = [
    ["BEFORE snapshot", ["--mode=snapshot", "--source=<id>", "--label=BEFORE (pre-sync)"]],
    ["Source health verdict", ["--mode=health", "--source=<id>"]],
    ["Sync lock status (should be clear — sync already finished)", ["--mode=lock-status", "--source=<id>"]],
    ["Discovery queue results", ["--mode=discovery-queue", "--source=<id>", "--limit=50"]],
  ];
  for (const [name, expected] of cases) {
    it.each(WITH_NEWLINE)(`${name}: source_id with %s`, (_desc, value) => {
      const r = runStep(step("live-preview-validation", name), { inputs: { source_id: value } });
      expect(r.status, r.stderr).toBe(0);
      expect(r.calls).toEqual([
        {
          cmd: "node",
          argv: ["--env-file=.env.local", "--import", "tsx", "src/db/inspectSource.ts", ...expected.map((a) => a.replace("<id>", value))],
        },
      ]);
    });
  }
});

describe("validate-source.yml — sync trigger loop", () => {
  const s = step("live-preview-validation", "Trigger sync N times (idempotency check)");

  it.each(SHELL_SENSITIVE)("POSTs to base_url/api/sync/path and snapshots after each attempt, with %s kept literal", (_desc, value) => {
    const r = runStep(s, {
      inputs: { sync_count: "2", source_id: value },
      outputs: { target: { base_url: `https://p.example/${value}` }, endpoint: { path: value } },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls.map((c) => c.cmd)).toEqual(["curl", "node", "curl", "node"]);
    for (const c of r.calls.filter((c) => c.cmd === "curl")) {
      expect(c.argv.at(-1)).toBe(`https://p.example/${value}/api/sync/${value}`);
      expect(c.argv).toContain("x-sync-token: test-secret-SYNC_TRIGGER_TOKEN");
      expect(c.argv).toContain("POST");
    }
    const nodeCalls = r.calls.filter((c) => c.cmd === "node");
    expect(nodeCalls[0].argv.slice(-2)).toEqual([`--source=${value}`, "--label=AFTER SYNC #1"]);
    expect(nodeCalls[1].argv.slice(-2)).toEqual([`--source=${value}`, "--label=AFTER SYNC #2"]);
  });

  it("uses the sync_count default (2) when passed through unchanged", () => {
    const r = runStep(s, {
      inputs: { sync_count: "2", source_id: "src-poolen" },
      outputs: { target: { base_url: "https://p.example" }, endpoint: { path: "poolen" } },
    });
    expect(r.calls.filter((c) => c.cmd === "curl")).toHaveLength(2);
  });

  it.each([
    ["command substitution", "$(touch pwned-count)"],
    ["a separator", "1; touch pwned-count-semi"],
    ["backticks", "`touch pwned-count-tick`"],
  ])("a sync_count containing %s never executes it or triggers a sync", (_desc, value) => {
    const r = runStep(s, {
      inputs: { sync_count: value, source_id: "src-poolen" },
      outputs: { target: { base_url: "https://p.example" }, endpoint: { path: "poolen" } },
    });
    expect(r.calls).toEqual([]);
  });

  it("still fails the step on a non-2xx sync response", () => {
    const r = runStep(s, {
      inputs: { sync_count: "2", source_id: "src-poolen" },
      outputs: { target: { base_url: "https://p.example" }, endpoint: { path: "poolen" } },
      extraEnv: { STUB_HTTP_STATUS: "500" },
    });
    expect(r.status).toBe(1);
    expect(r.calls.map((c) => c.cmd)).toEqual(["curl"]);
  });
});

describe("validate-source.yml — end to end through step outputs", () => {
  it("a hostile preview_base_url / sync_endpoint flows through outputs into the sync URL literally", () => {
    const base = "https://p.example/$(touch pwned-e2e)`id`";
    const endpoint = 'poolen"; touch pwned-e2e-2; echo "';
    const target = runStep(step("live-preview-validation", "Resolve target base URL"), { inputs: { preview_base_url: base } });
    const ep = runStep(step("live-preview-validation", "Resolve sync endpoint path"), {
      inputs: { sync_endpoint: endpoint, source_id: "src-poolen" },
    });
    const sync = runStep(step("live-preview-validation", "Trigger sync N times (idempotency check)"), {
      inputs: { sync_count: "1", source_id: "src-poolen" },
      outputs: { target: target.outputs, endpoint: ep.outputs },
    });
    expect(sync.status, sync.stderr).toBe(0);
    expect(sync.calls[0].argv.at(-1)).toBe(`${base}/api/sync/${endpoint}`);
  });
});

describe("validate-source.yml — nothing embedded in any input was ever executed", () => {
  // Declared last; vitest runs tests in file order, so every case above has run.
  it("left no file behind in the steps' working directory", () => {
    expect(readdirSync(work)).toEqual([]);
  });
});
