import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUDIT_TABLES } from "./artistIdentityAudit";
import { beginReadOnlyTransaction } from "./readOnlyTransaction";
import { assertReadOnlyRole, evaluateGuard, readAccessSql, readReportConnectionString, READ_ACCESS_SQL, REPORT_TABLES } from "./reportReadOnlyGuard";

/**
 * The Artist Alerts identity audit reuses #141's read-only role guard with
 * its own table list (the one change made to the vendored copy). These
 * tests cover that parameter, and — against a REAL, disposable PostgreSQL
 * built from this repository's migrations (same harness as
 * readOnlyTransaction.test.ts) — that a SELECT-only role passes for the
 * audit's tables while every stronger role is refused before any data query.
 */

describe("vendored guard — table list parameter", () => {
  it("keeps #141's default table list and SQL unchanged", () => {
    expect(readAccessSql(REPORT_TABLES)).toBe(READ_ACCESS_SQL);
    expect(REPORT_TABLES.map((t) => t.name)).toContain("artist_youtube_preview_cache");
  });

  it("checks the audit's own tables when given them", () => {
    const sql = readAccessSql(AUDIT_TABLES);
    for (const t of AUDIT_TABLES) expect(sql).toContain(`('public', '${t.name}')`);
    expect(sql).not.toContain("artist_youtube_preview_cache");
  });

  it("refuses table names that are not plain identifiers", () => {
    expect(() => readAccessSql([{ schema: "public", name: "events'); DROP TABLE x; --", optional: false }])).toThrow(/Invalid report table name/);
  });

  it("evaluates read access against the given list, not #141's", () => {
    const facts = {
      role: { rolname: "report_ro", rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false, member_of: [], db_create: false, db_temp: false, db_owner: false, default_read_only: "on" },
      writableRelations: [],
      writableSchemas: [],
      definerFunctions: [],
      readAccess: AUDIT_TABLES.filter((t) => t.name !== "venues").map((t) => ({ schema: t.schema, name: t.name, can_select: true, rls: false, open_policy: false, restrictive_policy: false })),
    };
    expect(evaluateGuard(facts, AUDIT_TABLES).violations).toEqual(["public.venues does not exist or is not visible"]);
  });

  it("reads only DATABASE_URL_REPORT_RO and rejects admin roles and copies of DATABASE_URL", () => {
    expect(() => readReportConnectionString({ DATABASE_URL: "postgres://writer@db/x" })).toThrow(/DATABASE_URL_REPORT_RO is not set/);
    expect(() => readReportConnectionString({ DATABASE_URL_REPORT_RO: "postgres://postgres.abc@db/x" })).toThrow(/admin/);
    expect(() => readReportConnectionString({ DATABASE_URL: "postgres://r@db/x", DATABASE_URL_REPORT_RO: "postgres://r@db/x" })).toThrow(/identical/);
    expect(readReportConnectionString({ DATABASE_URL_REPORT_RO: "postgres://report_ro@db/x" })).toBe("postgres://report_ro@db/x");
  });
});

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
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const CAN_RUN = PG_BIN !== null && !isRoot;
const PORT = 40000 + Math.floor(Math.random() * 20000);
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

let dir = "";
let admin: Client;

function run(cmd: string, args: string[]) {
  const r = spawnSync(path.join(PG_BIN!, cmd), args, { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr || r.stdout}`);
}

async function asRole<T>(role: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ host: dir, port: PORT, user: role, database: "postgres" });
  await c.connect();
  try {
    await beginReadOnlyTransaction(c);
    return await fn(c);
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
}

describe("disposable PostgreSQL availability (artist audit guard)", () => {
  it.runIf(process.env.CI === "true")("is available in CI (these tests must never silently skip there)", () => {
    expect(PG_BIN, "PostgreSQL server binaries not found — set PG_BIN").not.toBeNull();
    expect(isRoot, "initdb cannot run as root").toBe(false);
  });
});

describe.runIf(CAN_RUN)("shared guard with the audit's tables, against the repo's real schema", () => {
  const audit = AUDIT_TABLES;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "artist-audit-pg-"));
    run("initdb", ["-D", path.join(dir, "data"), "-U", "postgres", "-A", "trust", "--no-sync"]);
    run("pg_ctl", ["-D", path.join(dir, "data"), "-o", `-p ${PORT} -k ${dir} -c listen_addresses=''`, "-l", path.join(dir, "log"), "-w", "start"]);
    admin = new Client({ host: dir, port: PORT, user: "postgres", database: "postgres" });
    await admin.connect();
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
      for (const statement of readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8").split("--> statement-breakpoint")) {
        if (statement.trim()) await admin.query(statement);
      }
    }
    const tables = audit.map((t) => t.name).join(", ");
    for (const sql of [
      "REVOKE CREATE ON SCHEMA public FROM PUBLIC",
      "CREATE ROLE report_ro LOGIN",
      "GRANT USAGE ON SCHEMA public TO report_ro",
      `GRANT SELECT ON ${tables} TO report_ro`,
      "CREATE ROLE report_writer LOGIN",
      "GRANT USAGE ON SCHEMA public TO report_writer",
      `GRANT SELECT ON ${tables} TO report_writer`,
      "GRANT UPDATE (title) ON events TO report_writer",
      "CREATE ROLE report_member LOGIN IN ROLE pg_write_all_data",
      "GRANT USAGE ON SCHEMA public TO report_member",
      `GRANT SELECT ON ${tables} TO report_member`,
      "CREATE ROLE report_partial LOGIN",
      "GRANT USAGE ON SCHEMA public TO report_partial",
      "GRANT SELECT ON events, venues TO report_partial",
      "CREATE ROLE report_su LOGIN SUPERUSER",
      "CREATE ROLE report_definer LOGIN",
      "GRANT USAGE ON SCHEMA public TO report_definer",
      `GRANT SELECT ON ${tables} TO report_definer`,
      "CREATE FUNCTION public.touch_events() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ UPDATE events SET title = title WHERE false $$",
      "REVOKE EXECUTE ON FUNCTION public.touch_events() FROM PUBLIC",
      "GRANT EXECUTE ON FUNCTION public.touch_events() TO report_definer",
    ]) {
      await admin.query(sql);
    }
  }, 120_000);

  afterAll(async () => {
    await admin?.end().catch(() => {});
    if (dir) {
      spawnSync(path.join(PG_BIN!, "pg_ctl"), ["-D", path.join(dir, "data"), "-m", "immediate", "stop"]);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts a role with SELECT on exactly the audit's tables", async () => {
    await asRole("report_ro", async (c) => {
      const result = await assertReadOnlyRole(c, audit);
      expect(result).toMatchObject({ ok: true, role: "report_ro", violations: [] });
    });
  });

  it("a passing role still cannot write, even outside a read-only transaction", async () => {
    const c = new Client({ host: dir, port: PORT, user: "report_ro", database: "postgres" });
    await c.connect();
    try {
      await expect(c.query("UPDATE events SET title = title")).rejects.toThrow(/permission denied/);
      await expect(c.query("CREATE TABLE x (id int)")).rejects.toThrow(/permission denied/);
    } finally {
      await c.end();
    }
  });

  it.each([
    ["a column-level write grant", "report_writer", /can write to or owns: public\.events/],
    ["membership of pg_write_all_data", "report_member", /member of other roles: pg_write_all_data/],
    ["missing SELECT on audit tables", "report_partial", /no SELECT on public\.(sources|artist_genre_cache|discovery_queue|event_change_log)/],
    ["a superuser", "report_su", /SUPERUSER/],
    ["an executable SECURITY DEFINER function", "report_definer", /functions that run with their owner's rights[\s\S]*touch_events/],
  ])("refuses %s", async (_desc, role, message) => {
    await asRole(role, async (c) => {
      await expect(assertReadOnlyRole(c, audit)).rejects.toThrow(message);
    });
  });
});
