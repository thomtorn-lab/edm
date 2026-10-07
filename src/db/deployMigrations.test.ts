import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import {
  applyPendingMigrations,
  decideMigration,
  findRejectedStatements,
  listPendingMigrations,
  readTaggedMigrations,
  rejectReason,
  splitStatements,
  type TaggedMigration,
} from "./deployMigrations";

const MIGRATIONS_FOLDER = path.join(import.meta.dirname, "migrations");
const realMigrations = readTaggedMigrations(MIGRATIONS_FOLDER);

function synthetic(tag: string, folderMillis: number, sql: string[]): TaggedMigration {
  return { tag, folderMillis, sql, bps: true, hash: `hash-${tag}` };
}

describe("decideMigration", () => {
  const DB = { DATABASE_URL: "postgres://x" };
  it("skips outside Vercel (local `npm run build`, CI), even with a DATABASE_URL", () => {
    expect(decideMigration({ ...DB }).action).toBe("skip");
    expect(decideMigration({ ...DB, VERCEL_ENV: "production" }).action).toBe("skip"); // stray var, no builder marker
  });
  it("skips Preview, Development and custom-environment builds", () => {
    expect(decideMigration({ ...DB, VERCEL: "1", VERCEL_ENV: "preview" }).action).toBe("skip");
    expect(decideMigration({ ...DB, VERCEL: "1", VERCEL_ENV: "development" }).action).toBe("skip");
    // Custom environment: VERCEL_ENV says "preview", VERCEL_TARGET_ENV has the real name.
    expect(decideMigration({ ...DB, VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "staging" }).action).toBe("skip");
  });
  it("migrates on a Vercel Production build (VERCEL or NOW_BUILDER; VERCEL_TARGET_ENV or VERCEL_ENV)", () => {
    expect(decideMigration({ ...DB, VERCEL: "1", VERCEL_ENV: "production" }).action).toBe("migrate");
    expect(decideMigration({ ...DB, VERCEL: "1", VERCEL_TARGET_ENV: "production" }).action).toBe("migrate");
    expect(decideMigration({ ...DB, NOW_BUILDER: "1", VERCEL_ENV: "production" }).action).toBe("migrate");
  });
  it("only verifies (never applies) on a Vercel build whose environment isn't exposed", () => {
    expect(decideMigration({ ...DB, VERCEL: "1" }).action).toBe("verify");
    expect(decideMigration({ ...DB, NOW_BUILDER: "1" }).action).toBe("verify");
  });
  it("fails a Production or unknown-environment Vercel build that has no DATABASE_URL", () => {
    expect(decideMigration({ VERCEL: "1", VERCEL_ENV: "production" }).action).toBe("fail");
    expect(decideMigration({ VERCEL: "1" }).action).toBe("fail");
  });
});

describe("statement allowlist", () => {
  it("accepts every migration already in the repo (0000..latest)", () => {
    expect(realMigrations.length).toBeGreaterThanOrEqual(22);
    expect(findRejectedStatements(realMigrations)).toEqual([]);
  });

  it.each([
    ['ALTER TABLE "events" DROP COLUMN "title"'],
    ['DROP TABLE "events"'],
    ['ALTER TABLE "events" RENAME COLUMN "title" TO "name"'],
    ['ALTER TABLE "events" RENAME TO "gigs"'],
    ['ALTER TABLE "events" ALTER COLUMN "title" SET DATA TYPE varchar(10)'],
    ['ALTER TABLE "events" ALTER COLUMN "title" SET NOT NULL'],
    ['ALTER TABLE "events" ALTER COLUMN "title" DROP DEFAULT'],
    ['ALTER TABLE "events" DROP CONSTRAINT "events_venue_id_fk"'],
    ['ALTER TABLE "events" ADD COLUMN "slug2" text NOT NULL'],
    ['ALTER TABLE "events" ADD CONSTRAINT "u" UNIQUE("slug")'],
    ['CREATE UNIQUE INDEX "u" ON "events" ("slug")'],
    ['CREATE INDEX CONCURRENTLY "i" ON "events" ("slug")'],
    ["UPDATE \"events\" SET \"title\" = 'x'"],
    ['DELETE FROM "events"'],
    ['TRUNCATE "events"'],
    ['GRANT ALL ON "events" TO public'],
  ])("rejects %s", (sql) => {
    expect(rejectReason(splitStatements(sql)[0])).not.toBeNull();
  });

  it.each([
    ['CREATE TABLE "t" ("id" text PRIMARY KEY NOT NULL)'],
    ['ALTER TABLE "events" ADD COLUMN "x" text'],
    ['ALTER TABLE "events" ADD COLUMN "x" boolean DEFAULT false NOT NULL'],
    ['ALTER TABLE "a" ADD CONSTRAINT "a_b_fk" FOREIGN KEY ("b") REFERENCES "public"."b"("id") ON DELETE cascade'],
    ['CREATE INDEX IF NOT EXISTS "i" ON "events" USING btree ("slug")'],
  ])("accepts %s", (sql) => {
    expect(rejectReason(splitStatements(sql)[0])).toBeNull();
  });

  it("is not fooled by comments, string literals or quoted identifiers", () => {
    // Keyword only inside a comment / literal / identifier: still a plain additive statement.
    expect(findRejectedStatements([{ tag: "a", sql: ['-- DROP TABLE "events"\nALTER TABLE "e" ADD COLUMN "drop" text'] }])).toEqual([]);
    expect(findRejectedStatements([{ tag: "b", sql: ["ALTER TABLE \"e\" ADD COLUMN \"x\" text DEFAULT 'a; DROP TABLE e'"] }])).toEqual([]);
    // A destructive statement smuggled after an allowed one in the same chunk (no breakpoint) is still caught.
    expect(findRejectedStatements([{ tag: "c", sql: ['ALTER TABLE "e" ADD COLUMN "x" text; DROP TABLE "e"'] }])).toHaveLength(1);
    // Hidden behind a block comment.
    expect(findRejectedStatements([{ tag: "d", sql: ['/* harmless */ ALTER TABLE "e" DROP COLUMN "x"'] }])).toHaveLength(1);
  });
});

describe("readTaggedMigrations", () => {
  it("returns exactly what drizzle's own migrator reads (same hash, folderMillis, statements), plus the tag", () => {
    const drizzleView = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
    expect(realMigrations.map((m) => ({ sql: m.sql, bps: m.bps, folderMillis: m.folderMillis, hash: m.hash }))).toEqual(drizzleView);
    expect(realMigrations[0].tag).toMatch(/^0000_/);
    expect(realMigrations.at(-1)!.tag).toBe(
      JSON.parse(fs.readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, "utf8")).entries.at(-1).tag,
    );
  });
});

/**
 * Real-Postgres behaviour (transaction, rollback, lock, concurrency,
 * drizzle-kit interop). Runs when TEST_PG_URL points at a disposable server
 * whose user may CREATE DATABASE; each test gets its own fresh database.
 */
const ADMIN_URL = process.env.TEST_PG_URL;

describe.skipIf(!ADMIN_URL)("applyPendingMigrations against real Postgres", () => {
  const created: string[] = [];
  let admin: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
  });
  afterAll(async () => {
    for (const db of created) await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin.end();
  });

  async function freshDb(): Promise<string> {
    const name = `deploymig_${randomBytes(4).toString("hex")}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    created.push(name);
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${name}`;
    return url.toString();
  }
  async function connect(url: string): Promise<Client> {
    const c = new Client({ connectionString: url });
    await c.connect();
    return c;
  }
  async function appliedCount(c: Client): Promise<number> {
    const { rows } = await c.query(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
    return rows[0].n;
  }
  async function columnExists(c: Client, table: string, column: string): Promise<boolean> {
    const { rowCount } = await c.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      [table, column],
    );
    return rowCount === 1;
  }

  it("applies every real migration from empty, then is a no-op on the next build", async () => {
    const c = await connect(await freshDb());
    try {
      expect((await applyPendingMigrations(c, realMigrations)).applied).toHaveLength(realMigrations.length);
      expect(await columnExists(c, "discovery_queue", "predicted_secondary_genre")).toBe(true);
      expect((await applyPendingMigrations(c, realMigrations)).applied).toEqual([]);
      expect(await appliedCount(c)).toBe(realMigrations.length);
    } finally {
      await c.end();
    }
  });

  it("is interchangeable with drizzle-kit migrate / the manual workflow in both directions", async () => {
    const url = await freshDb();
    const c = await connect(url);
    try {
      // Manual workflow applied everything except the newest migration…
      await applyPendingMigrations(c, realMigrations.slice(0, -1));
      // …drizzle's own migrator (what `npm run db:migrate` runs) picks up exactly the remainder…
      await migrate(drizzle(c), { migrationsFolder: MIGRATIONS_FOLDER });
      expect(await appliedCount(c)).toBe(realMigrations.length);
      // …and this runner then agrees nothing is pending.
      expect((await applyPendingMigrations(c, realMigrations)).applied).toEqual([]);
    } finally {
      await c.end();
    }
  });

  it("verify mode is read-only: reports pending migrations without creating or changing anything", async () => {
    const c = await connect(await freshDb());
    try {
      // Brand-new database: everything pending, and no drizzle schema gets created by checking.
      expect(await listPendingMigrations(c, realMigrations)).toEqual(realMigrations.map((m) => m.tag));
      const { rowCount } = await c.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = 'drizzle'`);
      expect(rowCount).toBe(0);
      // Partially migrated: exactly the remainder is reported, nothing is applied.
      await applyPendingMigrations(c, realMigrations.slice(0, -1));
      expect(await listPendingMigrations(c, realMigrations)).toEqual([realMigrations.at(-1)!.tag]);
      expect(await appliedCount(c)).toBe(realMigrations.length - 1);
      // Up to date: nothing pending.
      await applyPendingMigrations(c, realMigrations);
      expect(await listPendingMigrations(c, realMigrations)).toEqual([]);
    } finally {
      await c.end();
    }
  });

  it("serialises concurrent Production builds: one applies, the other waits and applies nothing; both succeed", async () => {
    const url = await freshDb();
    const [a, b] = [await connect(url), await connect(url)];
    try {
      const results = await Promise.all([applyPendingMigrations(a, realMigrations), applyPendingMigrations(b, realMigrations)]);
      const counts = results.map((r) => r.applied.length).sort((x, y) => x - y);
      expect(counts).toEqual([0, realMigrations.length]);
      expect(await appliedCount(a)).toBe(realMigrations.length); // no duplicate bookkeeping rows
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("rolls back every pending migration if any statement fails (nothing partially applied)", async () => {
    const c = await connect(await freshDb());
    try {
      await applyPendingMigrations(c, realMigrations);
      const base = realMigrations.at(-1)!.folderMillis;
      const batch = [
        synthetic("9001_ok", base + 1, ['ALTER TABLE "events" ADD COLUMN "probe_one" text']),
        synthetic("9002_broken", base + 2, ['ALTER TABLE "no_such_table" ADD COLUMN "probe_two" text']),
      ];
      await expect(applyPendingMigrations(c, [...realMigrations, ...batch])).rejects.toThrow(/no_such_table/);
      expect(await columnExists(c, "events", "probe_one")).toBe(false);
      expect(await appliedCount(c)).toBe(realMigrations.length);
    } finally {
      await c.end();
    }
  });

  it("rejects an unsafe pending migration before executing anything", async () => {
    const c = await connect(await freshDb());
    try {
      await applyPendingMigrations(c, realMigrations);
      const base = realMigrations.at(-1)!.folderMillis;
      const batch = [
        synthetic("9001_add", base + 1, ['ALTER TABLE "events" ADD COLUMN "probe" text']),
        synthetic("9002_drop", base + 2, ['ALTER TABLE "events" DROP COLUMN "title"']),
      ];
      await expect(applyPendingMigrations(c, [...realMigrations, ...batch])).rejects.toThrow(/9002_drop/);
      expect(await columnExists(c, "events", "probe")).toBe(false);
      expect(await columnExists(c, "events", "title")).toBe(true);
    } finally {
      await c.end();
    }
  });

  it("gives up (and rolls back) instead of queueing DDL behind a long-held table lock", async () => {
    const url = await freshDb();
    const [c, blocker] = [await connect(url), await connect(url)];
    try {
      await applyPendingMigrations(c, realMigrations);
      await blocker.query("BEGIN");
      await blocker.query('LOCK TABLE "events" IN ACCESS SHARE MODE'); // e.g. a long-running read
      const next = synthetic("9001_add", realMigrations.at(-1)!.folderMillis + 1, ['ALTER TABLE "events" ADD COLUMN "probe" text']);
      await expect(applyPendingMigrations(c, [...realMigrations, next], { lockTimeout: "300ms" })).rejects.toThrow(/lock timeout/);
      await blocker.query("ROLLBACK");
      expect(await columnExists(c, "events", "probe")).toBe(false);
      expect(await appliedCount(c)).toBe(realMigrations.length);
    } finally {
      await c.end();
      await blocker.end();
    }
  });
});
