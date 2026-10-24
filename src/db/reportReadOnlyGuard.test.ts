import { describe, expect, it } from "vitest";
import {
  assertReadOnlyRole,
  DEFINER_FUNCTIONS_SQL,
  evaluateGuard,
  GUARD_STATEMENTS,
  READ_ACCESS_SQL,
  readReportConnectionString,
  REPORT_TABLES,
  ROLE_SQL,
  WRITABLE_RELATIONS_SQL,
  WRITABLE_SCHEMAS_SQL,
  type GuardFacts,
  type QueryClient,
} from "./reportReadOnlyGuard";

/** What a correctly set-up report_ro role looks like in the catalogs. */
function cleanFacts(): GuardFacts {
  return {
    role: {
      rolname: "report_ro",
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      rolbypassrls: false,
      member_of: [],
      db_create: false,
      db_temp: false,
      db_owner: false,
      default_read_only: "on",
    },
    writableRelations: [],
    writableSchemas: [],
    definerFunctions: [],
    readAccess: REPORT_TABLES.map((t) => ({ schema: t.schema, name: t.name, can_select: true, rls: false, open_policy: false, restrictive_policy: false })),
  };
}

describe("evaluateGuard — passes only a role proven unable to write", () => {
  it("a least-privilege SELECT-only role passes", () => {
    expect(evaluateGuard(cleanFacts())).toEqual({ ok: true, role: "report_ro", violations: [], warnings: [] });
  });

  it("the override table may be missing (before migration 0023); every other table is required", () => {
    const f = cleanFacts();
    f.readAccess = f.readAccess.filter((t) => t.name !== "event_youtube_preview_overrides");
    expect(evaluateGuard(f).ok).toBe(true);
    f.readAccess = f.readAccess.filter((t) => t.name !== "events");
    expect(evaluateGuard(f).violations).toEqual(["public.events does not exist or is not visible"]);
  });

  it.each<[string, (f: GuardFacts) => void, RegExp]>([
    ["no role row", (f) => (f.role = undefined), /could not be found/],
    ["superuser", (f) => (f.role!.rolsuper = true), /SUPERUSER/],
    ["CREATEROLE", (f) => (f.role!.rolcreaterole = true), /CREATEROLE/],
    ["CREATEDB", (f) => (f.role!.rolcreatedb = true), /CREATEDB/],
    ["REPLICATION", (f) => (f.role!.rolreplication = true), /REPLICATION/],
    ["BYPASSRLS", (f) => (f.role!.rolbypassrls = true), /BYPASSRLS/],
    ["membership in another role (e.g. postgres, pg_write_all_data)", (f) => (f.role!.member_of = ["pg_write_all_data"]), /member of other roles: pg_write_all_data/],
    ["CREATE on the database", (f) => (f.role!.db_create = true), /CREATE on the database/],
    ["owns the database", (f) => (f.role!.db_owner = true), /owns the database/],
    ["database ownership unknown", (f) => (f.role!.db_owner = null), /owns the database/],
    ["write privilege on any table", (f) => (f.writableRelations = [{ schema: "public", name: "events", kind: "r" }]), /can write to or owns: public\.events/],
    ["CREATE on a schema", (f) => (f.writableSchemas = [{ schema: "public" }]), /CREATE on or owns schema: public/],
    ["owner-rights function it can execute", (f) => (f.definerFunctions = [{ schema: "public", name: "do_write" }]), /owner's rights.*public\.do_write/],
    ["no SELECT on a report table", (f) => (f.readAccess[0].can_select = false), /no SELECT on public\.artist_youtube_preview_cache/],
    ["RLS without an open policy", (f) => (f.readAccess[1].rls = true), /row-level security on public\.events/],
    ["RLS with a restrictive policy", (f) => Object.assign(f.readAccess[1], { rls: true, open_policy: true, restrictive_policy: true }), /row-level security on public\.events/],
    ["a malformed (non-boolean) attribute", (f) => ((f.role as unknown as Record<string, unknown>).rolsuper = "f"), /SUPERUSER/],
  ])("fails closed on %s", (_label, mutate, message) => {
    const f = cleanFacts();
    mutate(f);
    const result = evaluateGuard(f);
    expect(result.ok).toBe(false);
    expect(result.violations.join("\n")).toMatch(message);
  });

  it("RLS with one permissive USING (true) policy and no restrictive policy is fine", () => {
    const f = cleanFacts();
    Object.assign(f.readAccess[1], { rls: true, open_policy: true, restrictive_policy: false });
    expect(evaluateGuard(f).ok).toBe(true);
  });

  it("TEMPORARY (session-local scratch tables) is only a warning", () => {
    const f = cleanFacts();
    f.role!.db_temp = true;
    expect(evaluateGuard(f)).toMatchObject({ ok: true, warnings: [expect.stringMatching(/temporary tables/)] });
  });

  it("default_transaction_read_only off is only a warning (the report's own READ ONLY transaction still applies)", () => {
    const f = cleanFacts();
    f.role!.default_read_only = "off";
    expect(evaluateGuard(f)).toMatchObject({ ok: true, warnings: [expect.stringMatching(/default_transaction_read_only/)] });
  });
});

class FakeClient implements QueryClient {
  statements: string[] = [];
  constructor(private readonly facts: GuardFacts) {}
  async query(sql: string): Promise<{ rows: unknown[] }> {
    this.statements.push(sql);
    if (sql === ROLE_SQL) return { rows: this.facts.role ? [this.facts.role] : [] };
    if (sql === WRITABLE_RELATIONS_SQL) return { rows: this.facts.writableRelations };
    if (sql === WRITABLE_SCHEMAS_SQL) return { rows: this.facts.writableSchemas };
    if (sql === DEFINER_FUNCTIONS_SQL) return { rows: this.facts.definerFunctions };
    if (sql === READ_ACCESS_SQL) return { rows: this.facts.readAccess };
    throw new Error(`unexpected ${sql}`);
  }
}

describe("assertReadOnlyRole", () => {
  it("runs exactly the catalog checks, in order", async () => {
    const client = new FakeClient(cleanFacts());
    await expect(assertReadOnlyRole(client)).resolves.toMatchObject({ ok: true, role: "report_ro" });
    expect(client.statements).toEqual([...GUARD_STATEMENTS]);
  });

  it("throws, listing every violation, for a role that can write", async () => {
    const f = cleanFacts();
    f.role!.rolname = "postgres";
    f.role!.rolcreaterole = true;
    f.writableRelations = [{ schema: "public", name: "events", kind: "r" }];
    await expect(assertReadOnlyRole(new FakeClient(f))).rejects.toThrow(/Refusing to run: database role postgres is not proven read-only:[\s\S]*CREATEROLE[\s\S]*public\.events/);
  });

  it("every check is a plain catalog SELECT", () => {
    for (const sql of GUARD_STATEMENTS) {
      expect(sql.trimStart().startsWith("SELECT ")).toBe(true);
      expect(sql).not.toMatch(/\b(INSERT INTO|UPDATE \w+ SET|DELETE FROM|ALTER|DROP|CREATE (TABLE|ROLE|SCHEMA)|TRUNCATE \w|GRANT \w)\b/i);
    }
  });

  it("checks every non-system schema, not only public", () => {
    expect(WRITABLE_RELATIONS_SQL).not.toMatch(/nspname = 'public'/);
    expect(WRITABLE_RELATIONS_SQL).toContain("NOT IN ('pg_catalog', 'information_schema')");
  });
});

describe("readReportConnectionString — fails closed before connecting", () => {
  const good = "postgresql://report_ro.abcdefghijklmnop:s3cr3t-pa55@aws-1-eu-west-3.pooler.supabase.com:6543/postgres";

  it("returns DATABASE_URL_REPORT_RO", () => {
    expect(readReportConnectionString({ DATABASE_URL_REPORT_RO: good })).toBe(good);
  });

  it.each<[string, Record<string, string | undefined>, RegExp]>([
    ["missing secret", {}, /DATABASE_URL_REPORT_RO is not set/],
    ["empty secret", { DATABASE_URL_REPORT_RO: "  " }, /DATABASE_URL_REPORT_RO is not set/],
    ["never falls back to DATABASE_URL", { DATABASE_URL: good }, /DATABASE_URL_REPORT_RO is not set/],
    ["not a URL", { DATABASE_URL_REPORT_RO: "s3cr3t-pa55 host=x" }, /not a valid URL/],
    ["wrong scheme", { DATABASE_URL_REPORT_RO: "mysql://report_ro:s3cr3t-pa55@h/db" }, /postgres:\/\/ or postgresql:\/\//],
    ["no user", { DATABASE_URL_REPORT_RO: "postgresql://h:6543/postgres" }, /no user name/],
    ["Supabase admin via pooler", { DATABASE_URL_REPORT_RO: "postgresql://postgres.abcdefghijklmnop:s3cr3t-pa55@h:6543/postgres" }, /admin\/built-in role/],
    ["Supabase admin direct", { DATABASE_URL_REPORT_RO: "postgresql://postgres:s3cr3t-pa55@h:5432/postgres" }, /admin\/built-in role/],
    ["service_role", { DATABASE_URL_REPORT_RO: "postgresql://service_role:s3cr3t-pa55@h/postgres" }, /admin\/built-in role/],
    ["same value as DATABASE_URL", { DATABASE_URL_REPORT_RO: good, DATABASE_URL: good }, /identical to DATABASE_URL/],
  ])("rejects %s, without echoing the value", (_label, env, message) => {
    let error: Error | null = null;
    try {
      readReportConnectionString(env);
    } catch (err) {
      error = err as Error;
    }
    expect(error?.message).toMatch(message);
    expect(error?.message).not.toContain("s3cr3t-pa55");
  });
});

describe("docs/youtube-preview-risk-report-readonly-role.md", () => {
  it("grants SELECT on exactly the tables the guard requires", async () => {
    const { readFileSync } = await import("node:fs");
    const doc = readFileSync(`${process.cwd()}/docs/youtube-preview-risk-report-readonly-role.md`, "utf-8");
    const grant = /GRANT SELECT ON\n([\s\S]*?)\nTO report_ro;/.exec(doc)?.[1] ?? "";
    const granted = grant.split(",").map((s) => s.trim()).filter(Boolean).sort();
    expect(granted).toEqual(REPORT_TABLES.map((t) => `${t.schema}.${t.name}`).sort());
    expect(doc).toContain("GRANT USAGE ON SCHEMA public, drizzle TO report_ro;");
    expect(doc).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL|CREATE)/);
  });
});
