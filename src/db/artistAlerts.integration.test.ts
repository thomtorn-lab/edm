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
  let alerts: typeof import("./artistAlerts");

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
    process.env.ARTIST_ALERTS_TOKEN_SECRET = "test-secret-test-secret-test-secret-0123";
    appearances = await import("./artistAppearances");
    alerts = await import("./artistAlerts");
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

  // ---- alert engine ------------------------------------------------------
  // A fixed clock at 12:00 Copenhagen time, moved forward explicitly.
  const BASE = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 0, 15, 11, 0, 0));
  const at = (hours: number) => new Date(BASE.getTime() + hours * 3_600_000);
  const sent: { to: string; subject: string; text: string; idempotencyKey: string }[] = [];
  let failNext = 0;
  const sender = async (i: { to: string; subject: string; text: string; idempotencyKey: string }) => {
    if (failNext > 0) {
      failNext--;
      return { status: "ambiguous" as const };
    }
    sent.push(i);
    return { status: "sent" as const, resendEmailId: `re_${sent.length}` };
  };
  const runAt = (hours: number) => alerts.runArtistAlerts("live", sender as never, at(hours));
  const artistId = async (key: string) => (await admin.query("SELECT id FROM artists WHERE name_key = $1", [key])).rows[0].id as string;
  const evStart = (hours: number) => at(hours);

  async function subscribe(email: string, keys: string[], requests: { name: string; profileUrl?: string }[] = [], hours = 0) {
    const ids = await Promise.all(keys.map(artistId));
    const r = await alerts.requestArtistAlerts({ email, artistIds: ids, requests }, at(hours));
    const c = await alerts.confirmArtistAlerts(confirmTokenOf(r), at(hours));
    return c!.manageToken;
  }
  function confirmTokenOf(r: Awaited<ReturnType<typeof alerts.requestArtistAlerts>>): string {
    if (r.outcome !== "confirm") throw new Error(`expected a confirmation, got ${r.outcome}`);
    return r.confirmToken;
  }

  it("end to end: new event, lineup addition, one alert per event, nothing for events listed before the follow", async () => {
    await admin.query("DELETE FROM event_artists; DELETE FROM events; DELETE FROM alert_subscribers; DELETE FROM artists");
    await addEvent("old", "Old Night", ["Daria Kolosova", "Gerd Janson"], { start: evStart(200) });
    await runAt(0);
    const token = await subscribe("fan@example.test", ["daria kolosova", "gerd janson"], [], 1);

    // Existing event: listed before the follow -> no alert, ever.
    await runAt(5);
    expect(sent).toHaveLength(0);

    // A new event with Daria: hold of 2h first, then exactly one email.
    await addEvent("new1", "New Night", ["Daria Kolosova", "Someone Else"], { start: evStart(300) });
    await runAt(6);
    await runAt(7);
    expect(sent).toHaveLength(0);
    await runAt(8.1);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("Daria Kolosova: New Night");

    // Gerd added later to the same event: one alert per event -> nothing new.
    await admin.query(`UPDATE events SET artists = '{"Daria Kolosova","Someone Else","Gerd Janson"}' WHERE id = 'new1'`);
    await runAt(9);
    await runAt(9.4);
    expect(sent).toHaveLength(1);

    // Gerd added later to another, already public event: a relevant alert, once.
    await addEvent("added", "Added Night", ["Opener Two"], { start: evStart(400) });
    await runAt(9.5);
    await admin.query(`UPDATE events SET artists = '{"Opener Two","Gerd Janson"}' WHERE id = 'added'`);
    await runAt(9.7);
    await runAt(22); // next day 10:00 Copenhagen: hold passed, inside sending hours
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toContain("Gerd Janson: Added Night");
    await runAt(23);
    await runAt(30);
    expect(sent).toHaveLength(2);

    // Unsubscribe removes everything for that address.
    expect(await alerts.unsubscribeArtistAlerts(token)).toBe(true);
    const left = await admin.query("SELECT (SELECT count(*) FROM alert_subscribers)::int s, (SELECT count(*) FROM alert_follows)::int f, (SELECT count(*) FROM alert_deliveries)::int d, (SELECT count(*) FROM alert_emails)::int e");
    expect(left.rows[0]).toEqual({ s: 0, f: 0, d: 0, e: 0 });
  });

  it("no alert when an artist is added and removed within the hold, or removed and re-added", async () => {
    sent.length = 0;
    await admin.query("DELETE FROM event_artists; DELETE FROM events; DELETE FROM alert_subscribers");
    await addEvent("x1", "X Night", ["Host Act"], { start: evStart(300) });
    await runAt(0);
    await subscribe("fan2@example.test", ["daria kolosova"], [], 0.5);
    await admin.query(`UPDATE events SET artists = '{"Host Act","Daria Kolosova"}' WHERE id = 'x1'`);
    await runAt(1);
    await admin.query(`UPDATE events SET artists = '{"Host Act"}' WHERE id = 'x1'`);
    await runAt(2);
    await runAt(4);
    expect(sent).toHaveLength(0);
    await admin.query(`UPDATE events SET artists = '{"Host Act","Daria Kolosova"}' WHERE id = 'x1'`);
    await runAt(5);
    // Re-added: visibleSince is still the first sighting (hour 1), hold long passed -> it IS alertable now.
    // This is intended: the appearance stands and was never alerted; one alert, never two.
    await runAt(6);
    await runAt(9);
    expect(sent.filter((m) => m.text.includes("X Night"))).toHaveLength(1);
  });

  it("a late admin confirmation never sends a historical alert", async () => {
    sent.length = 0;
    await admin.query("DELETE FROM event_artists; DELETE FROM events; DELETE FROM alert_subscribers");
    await addEvent("s1", "Short Night", ["ENNA", "Host"], { start: evStart(300) });
    await runAt(0);
    const id = await artistId("enna");
    const r = await alerts.requestArtistAlerts({ email: "fan3@example.test", artistIds: [id], requests: [] }, at(-10));
    await alerts.confirmArtistAlerts(confirmTokenOf(r), at(-10));
    await runAt(1);
    expect((await admin.query("SELECT confidence FROM event_artists WHERE name_key='enna'")).rows[0].confidence).toBe("review");
    // Confirmed 5h after it became visible: outside the 2h hold.
    await appearances.decideAppearance("s1", "enna", "confirmed");
    await admin.query("UPDATE event_artists SET confirmed_at = $1 WHERE name_key='enna'", [at(5)]);
    await runAt(6);
    await runAt(10);
    expect(sent).toHaveLength(0);
  });

  it("a requested artist verified later alerts only for appearances after verification", async () => {
    sent.length = 0;
    await admin.query("DELETE FROM event_artists; DELETE FROM events; DELETE FROM alert_subscribers");
    await addEvent("r1", "Request Night", ["Small Horse", "Host"], { start: evStart(300) });
    await runAt(0);
    const r = await alerts.requestArtistAlerts({ email: "fan4@example.test", artistIds: [], requests: [{ name: "Small Horse" }] }, at(0.5));
    await alerts.confirmArtistAlerts(confirmTokenOf(r), at(0.5));
    const view = await alerts.getManageView((await alerts.confirmArtistAlerts(confirmTokenOf(r), at(0.5)))!.manageToken);
    // "Small Horse" already exists from the lineup, so a request without a profile link follows it directly.
    expect(view!.follows.map((f) => [f.displayName, f.state])).toEqual([["Small Horse", "active"]]);

    // A name that does not exist yet becomes a requested artist and waits for verification.
    // Already confirmed: further artists are requested from the manage page.
    const m2 = (await alerts.confirmArtistAlerts(confirmTokenOf(r), at(0.5)))!.manageToken;
    expect(await alerts.updateFollowsByManageToken(m2, { add: [], remove: [], requests: [{ name: "Brand New DJ", profileUrl: "https://example.com/x" }] }, at(1))).toMatchObject({ ok: true });
    const v2 = await alerts.getManageView(m2);
    expect(v2!.follows.find((f) => f.displayName === "Brand New DJ")!.state).toBe("awaiting_verification");
    const reqId = await artistId("brand new dj");
    expect((await admin.query("SELECT profile_url FROM artists WHERE id=$1", [reqId])).rows[0].profile_url).toBeNull(); // not a SoundCloud/Spotify link

    await addEvent("r2", "Before Verify", ["Brand New DJ", "Host"], { start: evStart(300) });
    await runAt(2);
    await runAt(5);
    expect(sent.some((m) => m.text.includes("Before Verify"))).toBe(false);
    expect(await alerts.resolveRequestedArtist_admin(reqId, { verify: true }, at(6))).toMatchObject({ outcome: "approved", artistName: "Brand New DJ" });
    await runAt(7);
    await runAt(10);
    expect(sent.some((m) => m.text.includes("Before Verify"))).toBe(false); // visible before verification
    await addEvent("r3", "After Verify", ["Brand New DJ", "Host"], { start: evStart(400) });
    await runAt(24);
    await runAt(26.5);
    expect(sent.filter((m) => m.text.includes("After Verify"))).toHaveLength(1);
  });

  it("caps alert emails per day and retries an ambiguous send with the same idempotency key", async () => {
    sent.length = 0;
    await admin.query("DELETE FROM event_artists; DELETE FROM events; DELETE FROM alert_subscribers");
    await addEvent("seed", "Seed", ["Daria Kolosova", "Gerd Janson", "Kasper Bjørke"], { start: evStart(500) });
    await runAt(0);
    await subscribe("fan5@example.test", ["daria kolosova", "gerd janson", "kasper bjørke"], [], 0.2);
    for (const [i, name] of ["Daria Kolosova", "Gerd Janson", "Kasper Bjørke"].entries()) {
      await addEvent(`cap${i}`, `Cap Night ${i}`, [name, "Host"], { start: evStart(300 + i) });
      await runAt(1 + i * 3);
      await runAt(3.5 + i * 3);
    }
    expect(sent).toHaveLength(2); // third waits for the 24h window
    await runAt(26);
    expect(sent).toHaveLength(2);
    await runAt(28);
    expect(sent).toHaveLength(3);

    await addEvent("amb", "Ambiguous Night", ["Daria Kolosova", "Host"], { start: evStart(600) });
    await runAt(30);
    failNext = 1;
    await runAt(33);
    expect(sent).toHaveLength(3);
    const pending = (await admin.query("SELECT idempotency_key FROM alert_emails WHERE status='pending'")).rows;
    expect(pending).toHaveLength(1);
    await runAt(34);
    expect(sent).toHaveLength(4);
    expect(sent[3].idempotencyKey).toBe(pending[0].idempotency_key);
  });

  it("never mails an address outside the test allowlist in test mode", async () => {
    sent.length = 0;
    await admin.query("DELETE FROM event_artists; DELETE FROM events; DELETE FROM alert_subscribers");
    await addEvent("t0", "T0", ["Daria Kolosova", "Host"], { start: evStart(500) });
    await alerts.runArtistAlerts("test", sender as never, at(0));
    await subscribe("outsider@example.test", ["daria kolosova"], [], 0.5);
    await addEvent("t1", "T1", ["Daria Kolosova", "Host"], { start: evStart(500) });
    process.env.ARTIST_ALERTS_TEST_ALLOWLIST = "insider@example.test";
    await alerts.runArtistAlerts("test", sender as never, at(1));
    await alerts.runArtistAlerts("test", sender as never, at(4));
    delete process.env.ARTIST_ALERTS_TEST_ALLOWLIST;
    expect(sent).toHaveLength(0);
  });

  it("observe writes only artists and event_artists: no lease row, no subscriber table, no event data", async () => {
    await admin.query("DELETE FROM event_artists; DELETE FROM events; DELETE FROM alert_subscribers; DELETE FROM sync_locks");
    await addEvent("o1", "Observe Night", ["Brand New Observed Act", "Another Observed Act"], { start: evStart(100) });
    const fingerprint = async () => {
      const tables = (await admin.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('artists','event_artists') ORDER BY 1")).rows.map((r) => r.tablename as string);
      const parts: string[] = [];
      for (const t of tables) {
        const r = await admin.query(`SELECT count(*)::text AS n, md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM public."${t}" x`);
        parts.push(`${t}:${r.rows[0].n}:${r.rows[0].h}`);
      }
      return parts.join("\n");
    };
    const before = await fingerprint();
    let sends = 0;
    const summary = await alerts.runArtistAlerts("observe", (async () => {
      sends++;
      return { status: "sent", resendEmailId: "x" };
    }) as never, at(0));
    expect(summary.reconcile?.events).toBe(1);
    expect(summary.send).toBeUndefined();
    expect(sends).toBe(0);
    expect(await fingerprint()).toBe(before);
    expect((await admin.query("SELECT count(*)::int n FROM event_artists WHERE event_id='o1'")).rows[0].n).toBe(2);
  });

  it("a confirmed address using the public form again gets its manage link; nothing is added", async () => {
    await admin.query("DELETE FROM event_artists; DELETE FROM events; DELETE FROM alert_subscribers");
    await addEvent("m1", "Manage Night", ["Daria Kolosova", "Gerd Janson"], { start: evStart(100) });
    await alerts.runArtistAlerts("observe", (async () => ({ status: "sent", resendEmailId: "x" })) as never, at(0));
    const manageToken = await subscribe("again@example.test", ["daria kolosova"], [], 0.5);
    const again = await alerts.requestArtistAlerts({ email: "Again@Example.test", artistIds: [await artistId("gerd janson")], requests: [] }, at(1));
    expect(again).toEqual({ outcome: "manage", manageToken, picks: { artistIds: [await artistId("gerd janson")], requests: [] } });
    const view = await alerts.getManageView(manageToken);
    expect(view!.follows.map((f) => f.displayName)).toEqual(["Daria Kolosova"]);
    // The manage page still adds artists directly, with no new confirmation.
    expect(await alerts.updateFollowsByManageToken(manageToken, { add: [await artistId("gerd janson")], remove: [], requests: [] }, at(1))).toMatchObject({ ok: true });
    expect((await alerts.getManageView(manageToken))!.follows.map((f) => [f.displayName, f.state])).toEqual([
      ["Daria Kolosova", "active"],
      ["Gerd Janson", "active"],
    ]);
  });
  it("manage link: only a confirmed address gets one, and each counts toward the daily email limit", async () => {
    await admin.query("DELETE FROM event_artists; DELETE FROM events; DELETE FROM alert_subscribers");
    await addEvent("l1", "Link Night", ["Daria Kolosova"], { start: evStart(100) });
    await alerts.runArtistAlerts("observe", (async () => ({ status: "sent", resendEmailId: "x" })) as never, at(0));
    expect(await alerts.requestManageLink("nobody@example.test", at(1))).toBeNull();
    expect((await admin.query("SELECT count(*)::int n FROM alert_subscribers")).rows[0].n).toBe(0); // nothing stored for an unknown address
    const pending = await alerts.requestArtistAlerts({ email: "pending@example.test", artistIds: [await artistId("daria kolosova")], requests: [] }, at(1));
    expect(pending.outcome).toBe("confirm");
    expect(await alerts.requestManageLink("pending@example.test", at(1))).toBeNull(); // not confirmed: no manage link
    const token = await subscribe("linked@example.test", ["daria kolosova"], [], 1); // email 1 of 3 today
    expect(await alerts.requestManageLink(" Linked@Example.test ", at(2))).toEqual({ manageToken: token }); // 2
    expect(await alerts.requestManageLink("linked@example.test", at(3))).toEqual({ manageToken: token }); // 3
    expect(await alerts.requestManageLink("linked@example.test", at(4))).toBeNull(); // limit reached
    expect((await alerts.requestArtistAlerts({ email: "linked@example.test", artistIds: [], requests: [{ name: "X Y" }] }, at(4))).outcome).toBe("limited");
    expect(await alerts.requestManageLink("linked@example.test", at(28))).toEqual({ manageToken: token }); // a day after the last one
  });

  it("artist requests: one shared request, one admin notice, approval makes every confirmed requester follow", async () => {
    await admin.query("DELETE FROM event_artists; DELETE FROM events; DELETE FROM alert_subscribers; DELETE FROM artists WHERE status = 'requested'");
    const sc = "https://soundcloud.com/kolsch";
    const a = await alerts.requestArtistAlerts({ email: "req-a@example.test", artistIds: [], requests: [{ name: "Kölsch", profileUrl: sc }] }, at(0));
    expect((await admin.query("SELECT count(*)::int n FROM artists WHERE status='requested'")).rows[0].n).toBe(1);
    const ca = await alerts.confirmArtistAlerts(confirmTokenOf(a), at(0));
    expect(ca!.newRequests.map((r) => [r.displayName, r.profileUrl])).toEqual([["Kölsch", sc]]); // first confirmed requester: admin notice
    expect((await alerts.confirmArtistAlerts(confirmTokenOf(a), at(0)))!.newRequests).toEqual([]); // confirming again: none

    // A second person asks for the same artist (no link): same request, no second notice.
    const b = await alerts.requestArtistAlerts({ email: "req-b@example.test", artistIds: [], requests: [{ name: "KÖLSCH" }] }, at(1));
    expect((await alerts.confirmArtistAlerts(confirmTokenOf(b), at(1)))!.newRequests).toEqual([]);
    // Someone who never confirms is kept but gets no result email.
    await alerts.requestArtistAlerts({ email: "req-c@example.test", artistIds: [], requests: [{ name: "Kölsch" }] }, at(1));
    expect((await admin.query("SELECT count(*)::int n FROM artists WHERE status='requested'")).rows[0].n).toBe(1);

    const listed = await alerts.listRequestedArtists();
    expect(listed.map((r) => [r.displayName, r.followers])).toEqual([["Kölsch", 2]]);
    const reqId = listed[0].id;
    const { manageTokenFor } = await import("../lib/artistAlerts/tokens");
    const follows = async (email: string) => {
      const sub = (await admin.query("SELECT id FROM alert_subscribers WHERE email=$1", [email])).rows[0];
      return (await alerts.getManageView(manageTokenFor(sub.id)))!.follows.map((f) => [f.displayName, f.state]);
    };
    expect(await follows("req-a@example.test")).toEqual([["Kölsch", "awaiting_verification"]]);

    const result = await alerts.resolveRequestedArtist_admin(reqId, { verify: true }, at(2));
    expect(result!.outcome).toBe("approved");
    expect(result!.artistName).toBe("Kölsch");
    expect(result!.recipients.map((r) => r.email).sort()).toEqual(["req-a@example.test", "req-b@example.test"]);
    expect(await follows("req-a@example.test")).toEqual([["Kölsch", "active"]]);
    expect(await follows("req-c@example.test")).toEqual([["Kölsch", "awaiting_confirmation"]]); // still waits for their own confirmation
    expect(await alerts.resolveRequestedArtist_admin(reqId, { verify: true }, at(3))).toBeNull(); // no second approval, no second email
    expect(await alerts.listRequestedArtists()).toEqual([]);
  });

  it("artist requests: rejecting removes the pending follow; linking moves requesters to the existing artist", async () => {
    await admin.query("DELETE FROM event_artists; DELETE FROM events; DELETE FROM alert_subscribers; DELETE FROM artists WHERE status = 'requested'");
    await addEvent("k1", "Known Night", ["Gerd Janson"], { start: evStart(100) });
    await alerts.runArtistAlerts("observe", (async () => ({ status: "sent", resendEmailId: "x" })) as never, at(0));
    const gerd = await artistId("gerd janson");
    // A namesake with a different profile than the artist already on the site becomes its own request.
    const t = await subscribe("link@example.test", [], [{ name: "Gerd Janson", profileUrl: "https://soundcloud.com/gerd-other" }], 0);
    const [req] = await alerts.listRequestedArtists();
    expect(req.existing.map((e) => e.id)).toEqual([gerd]);
    const linked = await alerts.resolveRequestedArtist_admin(req.id, { linkTo: gerd }, at(1));
    expect(linked).toMatchObject({ outcome: "approved", artistName: "Gerd Janson" });
    expect((await alerts.getManageView(t))!.follows.map((f) => [f.artistId, f.state])).toEqual([[gerd, "active"]]);

    const t2 = await subscribe("reject@example.test", [], [{ name: "Nobody Real" }], 1);
    const [req2] = await alerts.listRequestedArtists();
    const rejected = await alerts.resolveRequestedArtist_admin(req2.id, { reject: true }, at(2));
    expect(rejected).toMatchObject({ outcome: "rejected", artistName: "Nobody Real" });
    expect(rejected!.recipients).toHaveLength(1);
    expect((await alerts.getManageView(t2))!.follows).toEqual([]);
    expect(await alerts.listRequestedArtists()).toEqual([]);
  });

  it("counts every public upcoming event an artist is billed on, including appearances in review", async () => {
    await admin.query("DELETE FROM event_artists; DELETE FROM events; DELETE FROM alert_subscribers");
    await addEvent("u1", "One", ["Daria Kolosova"], { start: evStart(100) });
    await addEvent("u2", "Two", ["Daria Kolosova"], { start: evStart(200) });
    await addEvent("u3", "Hidden", ["Daria Kolosova"], { start: evStart(200), published: false });
    await addEvent("u4", "Short", ["ENNA"], { start: evStart(100) });
    await alerts.runArtistAlerts("observe", (async () => ({ status: "sent", resendEmailId: "x" })) as never, at(0));
    const listed = await appearances.listFollowableArtists(at(0));
    expect(listed.find((a) => a.displayName === "Daria Kolosova")!.upcomingEvents).toBe(2);
    expect(listed.find((a) => a.displayName === "ENNA")!.upcomingEvents).toBe(1); // short name: in review, still billed
  });
  it("an unpublished-then-published event with a followed short name: the admin is told once, at first visibility", async () => {
    await admin.query("DELETE FROM event_artists; DELETE FROM events; DELETE FROM alert_subscribers");
    await addEvent("y0", "Earlier", ["Ayla", "Host"], { start: evStart(300) });
    await alerts.runArtistAlerts("observe", (async () => ({ status: "sent", resendEmailId: "x" })) as never, at(0));
    await subscribe("ayla-fan@example.test", ["ayla"], [], 1);
    // Created unpublished (the normal admin flow): not public, so nothing is seen yet.
    await addEvent("y1", "Headline Flip", ["Ayla", "Host"], { start: evStart(300), published: false });
    const notices: { eventId: string; displayName: string }[][] = [];
    const onFollowedReview = async (items: { eventId: string; displayName: string }[]) => void notices.push(items);
    await appearances.reconcileArtistAppearances(at(2), { onFollowedReview });
    expect(notices).toEqual([]);
    await admin.query("UPDATE events SET published = true WHERE id = 'y1'");
    const summary = await appearances.reconcileArtistAppearances(at(3), { onFollowedReview });
    expect(summary.followedReview).toBe(1);
    expect(notices.flat().map((n) => [n.eventId, n.displayName])).toEqual([["y1", "Ayla"]]); // "Host" is not followed; y0 was seen before
    await appearances.reconcileArtistAppearances(at(4), { onFollowedReview });
    expect(notices).toHaveLength(1); // once per appearance
    expect((await admin.query("SELECT visible_since FROM event_artists WHERE event_id='y1' AND name_key='ayla'")).rows[0].visible_since).toEqual(at(3));
    // Confirmed within the hold: the alert goes out once.
    sent.length = 0;
    await appearances.decideAppearance("y1", "ayla", "confirmed");
    await admin.query("UPDATE event_artists SET confirmed_at = $1 WHERE event_id='y1' AND name_key='ayla'", [at(4)]);
    await runAt(5.5);
    await runAt(6);
    expect(sent.filter((m) => m.text.includes("Headline Flip"))).toHaveLength(1);
    // Unpublish and publish again: no second alert.
    await admin.query("UPDATE events SET published = false WHERE id = 'y1'");
    await runAt(7);
    await admin.query("UPDATE events SET published = true WHERE id = 'y1'");
    await runAt(8);
    await runAt(12);
    expect(sent.filter((m) => m.text.includes("Headline Flip"))).toHaveLength(1);
  });
  it("the alert names the artist as the event bills it, not as a requester typed it", async () => {
    sent.length = 0;
    await admin.query("DELETE FROM event_artists; DELETE FROM events; DELETE FROM alert_subscribers; DELETE FROM artists WHERE status = 'requested'");
    await subscribe("case@example.test", [], [{ name: "black coffee" }], 0);
    const [req] = await alerts.listRequestedArtists();
    expect(req.displayName).toBe("black coffee");
    await alerts.resolveRequestedArtist_admin(req.id, { verify: true }, at(0.5));
    await addEvent("bc1", "TEST EVENT: Black Coffee", ["Black Coffee", "Opener Two"], { start: evStart(300) });
    await runAt(1);
    await runAt(3.2);
    const mail = sent.filter((m) => m.text.includes("TEST EVENT"));
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toBe("Black Coffee \u2014 new event in Copenhagen");
    expect(mail[0].text).toContain("Black Coffee: TEST EVENT: Black Coffee");
    expect(mail[0].text).not.toContain("Opener Two");
  });
});
