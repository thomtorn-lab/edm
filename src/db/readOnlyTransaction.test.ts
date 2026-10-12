import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertReadOnlyTransaction, beginReadOnlyTransaction } from "./readOnlyTransaction";

/**
 * Regression tests against a REAL, disposable PostgreSQL cluster (initdb'd
 * into a temp dir, Unix-socket only, deleted afterwards — never any shared or
 * Production database). They prove:
 *   1. the old `BEGIN; SET LOCAL default_transaction_read_only = on` pattern
 *      leaves the open transaction WRITABLE (why this fix exists);
 *   2. beginReadOnlyTransaction makes Postgres itself reject every kind of
 *      write (SQLSTATE 25006) while SELECTs keep working;
 *   3. the transaction-opening code actually embedded in each read-only
 *      workflow (extracted from the YAML and executed as-is) does the same,
 *      and its runtime assertion aborts if BEGIN READ ONLY is ever reverted.
 *
 * Needs PostgreSQL server binaries (GitHub's ubuntu runners ship them under
 * /usr/lib/postgresql/<v>/bin; override with PG_BIN). Locally they are
 * skipped if unavailable; in CI (CI=true) an unavailable server FAILS instead
 * of skipping, so this protection can never silently stop being tested.
 */

function findPgBin(): string | null {
  const candidates: string[] = [];
  if (process.env.PG_BIN) candidates.push(process.env.PG_BIN);
  const pgConfig = spawnSync("pg_config", ["--bindir"], { encoding: "utf-8" });
  if (pgConfig.status === 0) candidates.push(pgConfig.stdout.trim());
  if (existsSync("/usr/lib/postgresql")) {
    for (const v of readdirSync("/usr/lib/postgresql").sort((a, b) => Number(b) - Number(a))) {
      candidates.push(path.join("/usr/lib/postgresql", v, "bin"));
    }
  }
  candidates.push("/usr/local/bin", "/opt/homebrew/bin", "/usr/bin");
  return candidates.find((dir) => existsSync(path.join(dir, "initdb")) && existsSync(path.join(dir, "pg_ctl"))) ?? null;
}

const PG_BIN = findPgBin();
const isRoot = typeof process.getuid === "function" && process.getuid() === 0; // initdb refuses to run as root
const CAN_RUN = PG_BIN !== null && !isRoot;
const WRITE_REJECTED = "25006"; // read_only_sql_transaction
const OLD_PATTERN_QUERY = /query\(\s*["'`]\s*SET\s+(LOCAL\s+)?default_transaction_read_only/i;

let dir = "";
let client: Client;
const PORT = 40000 + Math.floor(Math.random() * 20000); // names the socket file only; no TCP listener

function run(cmd: string, args: string[]) {
  const r = spawnSync(path.join(PG_BIN!, cmd), args, { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr || r.stdout}`);
}

async function expectWriteRejected(sql: string): Promise<void> {
  await beginReadOnlyTransaction(client);
  try {
    await expect(client.query(sql)).rejects.toMatchObject({ code: WRITE_REJECTED });
  } finally {
    await client.query("ROLLBACK");
  }
}

describe("disposable PostgreSQL availability", () => {
  it.runIf(process.env.CI === "true")("is available in CI (these tests must never silently skip there)", () => {
    expect(PG_BIN, "PostgreSQL server binaries not found — set PG_BIN").not.toBeNull();
    expect(isRoot, "initdb cannot run as root").toBe(false);
  });
});

describe.runIf(CAN_RUN)("read-only transactions against a real, disposable PostgreSQL", () => {
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "ro-pg-"));
    run("initdb", ["-D", path.join(dir, "data"), "-U", "postgres", "-A", "trust", "--no-sync"]);
    run("pg_ctl", ["-D", path.join(dir, "data"), "-o", `-p ${PORT} -k ${dir} -c listen_addresses=''`, "-l", path.join(dir, "log"), "-w", "start"]);
    client = new Client({ host: dir, port: PORT, user: "postgres", database: "postgres" });
    await client.connect();
    await client.query("CREATE TABLE ro_probe (id int PRIMARY KEY, note text)");
    await client.query("CREATE SEQUENCE ro_probe_seq");
    await client.query("INSERT INTO ro_probe VALUES (1, 'seed')");
  }, 60_000);

  afterAll(async () => {
    await client?.end().catch(() => {});
    if (dir) {
      spawnSync(path.join(PG_BIN!, "pg_ctl"), ["-D", path.join(dir, "data"), "-m", "immediate", "stop"]);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the OLD pattern (BEGIN; SET LOCAL default_transaction_read_only = on) leaves the transaction writable", async () => {
    await client.query("BEGIN");
    await client.query("SET LOCAL default_transaction_read_only = on");
    expect((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only).toBe("off");
    await client.query("INSERT INTO ro_probe VALUES (99, 'should never be possible in a read-only tx')"); // succeeds
    await expect(assertReadOnlyTransaction(client)).rejects.toThrow(/transaction_read_only is "off"/);
    await client.query("ROLLBACK");
  });

  it("beginReadOnlyTransaction yields transaction_read_only = on and SELECTs still work", async () => {
    await beginReadOnlyTransaction(client);
    expect((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only).toBe("on");
    await client.query("SET LOCAL statement_timeout = '20s'"); // what inspectSource.ts does next — still allowed
    expect((await client.query("SELECT id, note FROM ro_probe ORDER BY id")).rows).toEqual([{ id: 1, note: "seed" }]);
    await client.query("ROLLBACK");
  });

  it.each([
    ["INSERT", "INSERT INTO ro_probe VALUES (2, 'x')"],
    ["UPDATE", "UPDATE ro_probe SET note = 'x'"],
    ["DELETE", "DELETE FROM ro_probe"],
    ["TRUNCATE", "TRUNCATE ro_probe"],
    ["CREATE TABLE", "CREATE TABLE ro_new (x int)"],
    ["ALTER TABLE", "ALTER TABLE ro_probe ADD COLUMN y int"],
    ["nextval()", "SELECT nextval('ro_probe_seq')"],
    ["SELECT … FOR UPDATE", "SELECT * FROM ro_probe FOR UPDATE"],
    ["a data-modifying CTE", "WITH d AS (DELETE FROM ro_probe RETURNING id) SELECT * FROM d"],
  ])("rejects %s with SQLSTATE 25006", async (_desc, sql) => {
    await expectWriteRejected(sql);
  });

  it("assertReadOnlyTransaction refuses a plain BEGIN transaction and no transaction at all", async () => {
    await expect(assertReadOnlyTransaction(client)).rejects.toThrow(/expected "on"/);
    await client.query("BEGIN");
    await expect(assertReadOnlyTransaction(client)).rejects.toThrow(/transaction_read_only is "off"/);
    await client.query("ROLLBACK");
  });

  it("left the database exactly as seeded", async () => {
    expect((await client.query("SELECT id, note FROM ro_probe ORDER BY id")).rows).toEqual([{ id: 1, note: "seed" }]);
    expect((await client.query("SELECT last_value, is_called FROM ro_probe_seq")).rows[0].is_called).toBe(false);
  });

  // ---- the real code embedded in each read-only workflow ------------------

  type AsyncFn = (client: unknown, execute: boolean) => Promise<void>;
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => AsyncFn;

  /** Extracts the .mjs heredoc a workflow writes, then the transaction-opening block from it. */
  function txOpeningSnippet(workflow: string): string {
    const yaml = readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", workflow), "utf-8");
    const script = yaml.match(/cat > \.\/\.[\w-]+\.mjs <<'EOF'\n([\s\S]*?)\n\s*EOF\n/)?.[1];
    if (!script) throw new Error(`no inline .mjs heredoc in ${workflow}`);
    // Any actual query that sets the old, non-protective setting (comments explaining it are fine).
    expect(script).not.toMatch(OLD_PATTERN_QUERY);
    const lines = script.split("\n");
    const start = lines.findIndex((l) => l.includes('"BEGIN READ ONLY"'));
    if (start === -1) throw new Error(`no BEGIN READ ONLY in ${workflow}`);
    // From the BEGIN line through the end of the read-only assertion block.
    let depth = 0;
    let opened = false;
    const out: string[] = [];
    for (const line of lines.slice(start)) {
      out.push(line);
      for (const ch of line) {
        if (ch === "{") {
          depth++;
          opened = true;
        } else if (ch === "}") {
          depth--;
        }
      }
      if (opened && depth === 0) break;
    }
    const snippet = out.join("\n");
    expect(snippet).toContain('SHOW transaction_read_only');
    return snippet;
  }

  const READ_ONLY_WORKFLOWS = [
    "audit-event-forensics-readonly.yml",
    "audit-production-baseline-readonly.yml",
    "audit-source-completeness-readonly.yml",
    "verify-db-readonly.yml",
    "correct-final-relevance-exclusions.yml", // dry-run (execute=false) path
  ];

  it.each(READ_ONLY_WORKFLOWS)("%s: its own transaction-opening code makes Postgres reject writes", async (workflow) => {
    const open = new AsyncFunction("client", "execute", txOpeningSnippet(workflow));
    await open(client, false);
    try {
      expect((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only).toBe("on");
      await expect(client.query("UPDATE ro_probe SET note = 'x'")).rejects.toMatchObject({ code: WRITE_REJECTED });
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it.each(READ_ONLY_WORKFLOWS)("%s: its runtime assertion aborts if BEGIN READ ONLY is reverted to a plain BEGIN", async (workflow) => {
    const open = new AsyncFunction("client", "execute", txOpeningSnippet(workflow).replace('"BEGIN READ ONLY"', '"BEGIN"'));
    try {
      await expect(open(client, false)).rejects.toThrow(/Refusing to run: transaction_read_only is "off"/);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("correct-final-relevance-exclusions.yml: execute=true still opens a normal writable transaction (behaviour preserved)", async () => {
    const open = new AsyncFunction("client", "execute", txOpeningSnippet("correct-final-relevance-exclusions.yml"));
    await open(client, true);
    try {
      expect((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only).toBe("off");
      await client.query("UPDATE ro_probe SET note = 'written in execute mode'"); // allowed
    } finally {
      await client.query("ROLLBACK");
    }
    expect((await client.query("SELECT note FROM ro_probe WHERE id = 1")).rows[0].note).toBe("seed");
  });

  it("inspectSource.ts opens every DB-touching mode through beginReadOnlyTransaction", () => {
    const src = readFileSync(path.join(__dirname, "inspectSource.ts"), "utf-8");
    expect(src).not.toMatch(OLD_PATTERN_QUERY);
    const body = src.slice(src.indexOf("async function withReadOnlyTx"), src.indexOf("const result = await fn(client);"));
    expect(body).toContain("await beginReadOnlyTransaction(client);");
    expect(body).not.toMatch(/client\.query\("BEGIN"\)/);
  });
});
