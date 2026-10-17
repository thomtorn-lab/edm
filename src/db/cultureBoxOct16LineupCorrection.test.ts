import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/** Real drizzle query builder against a fake node-postgres client (as in soundcloudLinks.test.ts): asserts on the exact SQL sent. */
const sent: { text: string; values: unknown[] }[] = [];
let rowCount = 1;
const fakeClient = {
  query: vi.fn(async (config: { text: string } | string, values?: unknown[]) => {
    const text = typeof config === "string" ? config : config.text;
    sent.push({ text, values: values ?? [] });
    return { rows: Array.from({ length: rowCount }, () => ({ event_id: "e-8a410de7" })), rowCount, fields: [] };
  }),
};
vi.mock("./client", () => ({ db: drizzle({ client: fakeClient as never, schema }) }));

const mod = await import("./cultureBoxOct16LineupCorrection");
const { run, checkPreconditions, describeChange, applyGuardedWrite, EXPECTED, CORRECTED, CONFIRM_TOKEN, EVENT_ID } = mod;
type Row = import("./cultureBoxOct16LineupCorrection").CorrectionRow;

const reviewedRow = (): Row => ({
  id: EVENT_ID,
  title: EXPECTED.title,
  venueId: EXPECTED.venueId,
  canonicalSourceId: EXPECTED.canonicalSourceId,
  startDatetime: new Date(EXPECTED.startDatetime),
  endDatetime: new Date("2026-10-17T05:00:00.000Z"),
  published: true,
  adminUnpublishReason: null,
  cancelled: false,
  manualOverride: true,
  overriddenFields: [...EXPECTED.overriddenFields],
  updatedAt: new Date(EXPECTED.updatedAt),
  lastChanged: new Date(EXPECTED.updatedAt),
  artists: [...EXPECTED.artists],
  description: EXPECTED.description,
});

function harness(rows: (Row | null)[], updated = 1) {
  const queue = [...rows];
  const log: string[] = [];
  const deps = {
    loadRow: vi.fn(async () => queue.shift() ?? null),
    applyGuardedWrite: vi.fn(async () => updated),
    log: (line: string) => log.push(line),
  };
  return { deps, log };
}

beforeEach(() => {
  sent.length = 0;
  rowCount = 1;
});

describe("the reviewed values", () => {
  it("expected description is exactly what Production held on 2026-10-13", () => {
    expect(EXPECTED.description).toContain("featuring SHK, GeorgeBox, Georgeous, Dani Panda, and ALX, playing");
    expect(EXPECTED.description.endsWith("\n\nRed Box\nGEORGEBOX, GEORGEOUS, DANI PANDA, ALX")).toBe(true);
    expect(EXPECTED.description).toContain("he’s a DJ");
    expect(EXPECTED.description).toContain("heroes – Kallax");
  });

  it("the correction removes ALX everywhere and changes nothing else in the text", () => {
    expect(CORRECTED.artists).toEqual(["CHICH", "KALLAX", "REXXX M", "SHK", "GEORGEBOX", "GEORGEOUS", "DANI PANDA"]);
    expect(CORRECTED.description).not.toContain("ALX");
    expect(CORRECTED.artists).not.toContain("ALX");
    const before = EXPECTED.description.split("\n");
    const after = CORRECTED.description.split("\n");
    expect(after).toHaveLength(before.length);
    const changed = before.map((l, i) => i).filter((i) => before[i] !== after[i]);
    expect(changed).toEqual([2, 8]);
    expect(after[2]).toBe(before[2].replace("Dani Panda, and ALX", "and Dani Panda"));
    expect(after[8]).toBe("SHK, GEORGEBOX, GEORGEOUS, DANI PANDA");
  });

  it("describeChange prints both fields' before/after and what stays untouched", () => {
    const text = describeChange().join("\n");
    expect(text).toContain(`before: ${JSON.stringify(EXPECTED.artists)}`);
    expect(text).toContain(`after:  ${JSON.stringify(CORRECTED.artists)}`);
    expect(text).toContain("line 3:");
    expect(text).toContain("line 9:");
    expect(text).toContain("Unchanged: title, overridden_fields, manual_override, published, start/end");
  });
});

describe("checkPreconditions — aborts on any deviation", () => {
  it("the reviewed state passes", () => {
    expect(checkPreconditions(reviewedRow())).toEqual([]);
  });

  it("a missing event fails", () => {
    expect(checkPreconditions(null)).toEqual([`Event ${EVENT_ID} not found.`]);
  });

  it.each<[string, Partial<Row>]>([
    ["title edited", { title: "CHICH" }],
    ["artists edited", { artists: ["SHK", "GEORGEBOX", "GEORGEOUS", "DANI PANDA"] }],
    ["artists reordered", { artists: ["ALX", "SHK", "GEORGEBOX", "GEORGEOUS", "DANI PANDA"] }],
    ["description edited", { description: "other" }],
    ["description null", { description: null }],
    ["any later edit (updated_at moved)", { updatedAt: new Date("2026-10-15T10:00:00.000Z") }],
    ["start moved", { startDatetime: new Date("2026-10-16T21:00:00.000Z") }],
    ["unpublished", { published: false }],
    ["admin-unpublished", { adminUnpublishReason: "cancelled" }],
    ["cancelled", { cancelled: true }],
    ["override cleared", { manualOverride: false }],
    ["protected fields changed", { overriddenFields: ["title", "artists"] }],
    ["other venue", { venueId: "v-other" }],
    ["other source", { canonicalSourceId: "src-other" }],
  ])("%s", (_label, change) => {
    expect(checkPreconditions({ ...reviewedRow(), ...change })).toHaveLength(1);
  });
});

describe("run", () => {
  it("plan reads once, prints the change, and never writes", async () => {
    const { deps, log } = harness([reviewedRow()]);
    await expect(run({ mode: "plan" }, deps)).resolves.toBe("planned");
    expect(deps.loadRow).toHaveBeenCalledTimes(1);
    expect(deps.applyGuardedWrite).not.toHaveBeenCalled();
    expect(log.join("\n")).toContain("PLAN ONLY");
  });

  it("plan with a deviation fails loudly and never writes", async () => {
    const { deps, log } = harness([{ ...reviewedRow(), title: "edited" }]);
    await expect(run({ mode: "plan" }, deps)).rejects.toThrow(/No write was made/);
    expect(deps.applyGuardedWrite).not.toHaveBeenCalled();
    expect(log.join("\n")).toContain("ABORTING");
  });

  it.each([undefined, "", "yes", "correct-culture-box-e-8a410de7"])("apply without the exact confirm token (%s) does not even read", async (confirm) => {
    const { deps } = harness([reviewedRow()]);
    const args: Record<string, string> = { mode: "apply" };
    if (confirm !== undefined) args.confirm = confirm;
    await expect(run(args, deps)).rejects.toThrow(CONFIRM_TOKEN);
    expect(deps.loadRow).not.toHaveBeenCalled();
    expect(deps.applyGuardedWrite).not.toHaveBeenCalled();
  });

  it("unknown mode is rejected", async () => {
    const { deps } = harness([reviewedRow()]);
    await expect(run({ mode: "write" }, deps)).rejects.toThrow(/--mode/);
    expect(deps.loadRow).not.toHaveBeenCalled();
  });

  it("apply on a deviating row aborts before writing", async () => {
    const { deps } = harness([{ ...reviewedRow(), updatedAt: new Date("2026-10-15T00:00:00.000Z") }]);
    await expect(run({ mode: "apply", confirm: CONFIRM_TOKEN }, deps)).rejects.toThrow(/No write was made/);
    expect(deps.applyGuardedWrite).not.toHaveBeenCalled();
  });

  it("apply writes once and verifies the read-back", async () => {
    const { deps } = harness([reviewedRow(), { ...reviewedRow(), ...CORRECTED, artists: [...CORRECTED.artists] }]);
    await expect(run({ mode: "apply", confirm: CONFIRM_TOKEN }, deps)).resolves.toBe("applied");
    expect(deps.applyGuardedWrite).toHaveBeenCalledTimes(1);
  });

  it("apply whose guarded write matched nothing (row changed in between) fails", async () => {
    const { deps } = harness([reviewedRow()], 0);
    await expect(run({ mode: "apply", confirm: CONFIRM_TOKEN }, deps)).rejects.toThrow(/matched 0 rows/);
  });

  it("re-running after the correction is a no-op in both modes", async () => {
    const applied = { ...reviewedRow(), ...CORRECTED, artists: [...CORRECTED.artists] };
    const runs: Record<string, string>[] = [{ mode: "plan" }, { mode: "apply", confirm: CONFIRM_TOKEN }];
    for (const args of runs) {
      const { deps } = harness([applied]);
      await expect(run(args, deps)).resolves.toBe("already-applied");
      expect(deps.applyGuardedWrite).not.toHaveBeenCalled();
    }
  });
});

describe("applyGuardedWrite — one guarded statement", () => {
  it("updates only artists/description/updated_at/last_changed of e-8a410de7, guarded by every precondition, and logs in the same statement", async () => {
    await expect(applyGuardedWrite()).resolves.toBe(1);
    expect(sent).toHaveLength(1);
    const { text, values } = sent[0];
    const setClause = text.match(/set([\s\S]*?)where/)![1];
    expect(setClause.match(/(\w+) =/g)).toEqual(["artists =", "description =", "updated_at =", "last_changed ="]);
    for (const column of ["id", "title", "venue_id", "canonical_source_id", "start_datetime", "published", "admin_unpublish_reason", "cancelled", "manual_override", "overridden_fields", "updated_at", "artists", "description"]) {
      expect(text).toMatch(new RegExp(`and ${column} |where id = `));
    }
    expect(text).toMatch(/insert into event_change_log [\s\S]* from updated/);
    expect(values).toEqual(
      expect.arrayContaining([
        CORRECTED.artists,
        CORRECTED.description,
        EVENT_ID,
        EXPECTED.updatedAt,
        EXPECTED.artists,
        EXPECTED.description,
        EXPECTED.overriddenFields,
        ["artists", "description"],
      ]),
    );
  });

  it("reports 0 when nothing matched", async () => {
    rowCount = 0;
    await expect(applyGuardedWrite()).resolves.toBe(0);
  });
});
