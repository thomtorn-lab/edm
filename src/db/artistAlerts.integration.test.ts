import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Artist Alerts against a REAL, disposable PostgreSQL built from this
 * repository's migrations (same harness as readOnlyTransaction.test.ts:
 * initdb into a temp dir, Unix socket only, deleted afterwards). Skipped
 * locally without server binaries or as root; required in CI.
 */
function findPgBin(): string | null {
  const candidates: string[] = [];
  if (process.env.PG_BIN) candidates.push(process.env.PG_BIN);
  const pgConfig = spawnSync("pg_config", ["--bindir"], { encoding: "utf-8" });
  if (pgConfig.status === 0) candidates.push(pgConfig.stdout.trim());
  if (existsSync("/usr/lib/postgresql")) {
    for (const v of readdirSync("/usr/lib/postgresql").sort((a, b) => Number(b) - Number(a))) candidates.push(path.join("/usr/lib/postgresql", v, "bin"));
  }
  candidates.push("/usr/local/bin", "/opt/homebrew/bin", "/usr/bin");
  return candidates.find((d) => existsSync(path.join(d, "initdb")) && existsSync(path.join(d, "pg_ctl"))) ?? null;
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

describe("disposable PostgreSQL availability (artist alerts)", () => {
  it.runIf(process.env.CI === "true")("is available in CI", () => {
    expect(PG_BIN).not.toBeNull();
    expect(isRoot).toBe(false);
  });
});

const days = (n: number) => new Date(Date.now() + n * 86_400_000);

async function addEvent(id: string, title: string, lineup: string[], opts: { published?: boolean; start?: Date } = {}) {
  await admin.query(
    `INSERT INTO events (id, title, slug, artists, start_datetime, venue_id, primary_genre, canonical_source_id, published) VALUES ($1,$2,$1,$3,$4,'v-a','techno','src-a',$5)`,
    [id, title, lineup, opts.start ?? days(10), opts.published ?? true],
  );
}

describe.runIf(CAN_RUN)("artist alerts against a real PostgreSQL", () => {
  let appearances: typeof import("./artistAppearances");

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "artist-alerts-pg-"));
    run("initdb", ["-D", path.join(dir, "data"), "-U", "postgres", "-A", "trust", "--no-sync"]);
    run("pg_ctl", ["-D", path.join(dir, "data"), "-o", `-p ${PORT} -k ${dir} -c listen_addresses=''`, "-l", path.join(dir, "log"), "-w", "start"]);
    admin = new Client({ host: dir, port: PORT, user: "postgres", database: "postgres" });
    await admin.connect();
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
      for (const statement of readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8").split("--> statement-breakpoint")) {
        if (statement.trim()) await admin.query(statement);
      }
    }
    await admin.query(`INSERT INTO sources (id, source_name, source_type, base_url, trust_level, sync_frequency) VALUES ('src-a','Source A','venue','https://example.test','high','every 6h')`);
    await admin.query(`INSERT INTO venues (id, slug, name, address, city, postal_code, description) VALUES ('v-a','v-a','Club A','x','Copenhagen','1000','x')`);
    process.env.DATABASE_URL = `postgresql://postgres@localhost:${PORT}/postgres?host=${encodeURIComponent(dir)}`;
    appearances = await import("./artistAppearances");
  }, 120_000);

  afterAll(async () => {
    await (await import("./client")).db.$client.end().catch(() => {});
    await admin?.end().catch(() => {});
    if (dir) {
      spawnSync(path.join(PG_BIN!, "pg_ctl"), ["-D", path.join(dir, "data"), "-m", "immediate", "stop"]);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reconciles public events only, idempotently, and keeps admin decisions", async () => {
    await addEvent("e1", "Night", ["Kasper Bjørke", "KRÆ B2B KIRAKINGKONG", "TBA"]);
    await addEvent("e-hidden", "Hidden", ["Hidden Act"], { published: false });
    await addEvent("e-past", "Past", ["Past Act"], { start: days(-5) });

    const first = await appearances.reconcileArtistAppearances();
    expect(first).toMatchObject({ events: 1, newArtists: 3 });
    const rows = (await admin.query("SELECT name_key, confidence, visible_since IS NOT NULL AS visible FROM event_artists ORDER BY name_key")).rows;
    expect(rows).toEqual([
      { name_key: "kasper bjørke", confidence: "high", visible: true },
      { name_key: "kirakingkong", confidence: "high", visible: true },
      { name_key: "kræ", confidence: "review", visible: true },
      { name_key: "tba", confidence: "excluded", visible: true },
    ]);

    const snapshot = async () => (await admin.query("SELECT event_id, name_key, artist_id, confidence, visible_since, confirmed_at, removed_at FROM event_artists ORDER BY 1, 2")).rows;
    const before = await snapshot();
    const second = await appearances.reconcileArtistAppearances();
    expect(second.newArtists).toBe(0);
    expect(await snapshot()).toEqual(before);

    expect(await appearances.decideAppearance("e1", "kræ", "confirmed")).toBe(true);
    await appearances.reconcileArtistAppearances();
    const kr = (await admin.query("SELECT confidence, confirmed_at IS NOT NULL AS c FROM event_artists WHERE name_key = 'kræ'")).rows[0];
    expect(kr).toEqual({ confidence: "confirmed", c: true });
  });

  it("marks a removed lineup entry and restores it without resetting visibility", async () => {
    await admin.query(`UPDATE events SET artists = '{"Kasper Bjørke","TBA"}' WHERE id = 'e1'`);
    await appearances.reconcileArtistAppearances();
    const removed = (await admin.query("SELECT removed_at IS NOT NULL AS r, visible_since FROM event_artists WHERE name_key = 'kirakingkong'")).rows[0];
    expect(removed.r).toBe(true);
    await admin.query(`UPDATE events SET artists = '{"Kasper Bjørke","KRÆ B2B KIRAKINGKONG","TBA"}' WHERE id = 'e1'`);
    await appearances.reconcileArtistAppearances();
    const back = (await admin.query("SELECT removed_at, visible_since FROM event_artists WHERE name_key = 'kirakingkong'")).rows[0];
    expect(back.removed_at).toBeNull();
    expect(back.visible_since).toEqual(removed.visible_since);
  });
});
