import { describe, expect, it } from "vitest";
import {
  addOverriddenFields,
  adminValuesEqual,
  classifyAdminFieldChange,
  isEditableEventField,
  partitionAdminPatch,
  stripOverriddenFields,
} from "./override";

describe("addOverriddenFields", () => {
  it("adds a newly-edited field to an empty override list", () => {
    expect(addOverriddenFields([], ["title"])).toEqual(["title"]);
  });

  it("accumulates edits across multiple corrections without duplicating", () => {
    const afterFirstEdit = addOverriddenFields([], ["primaryGenre"]);
    const afterSecondEdit = addOverriddenFields(afterFirstEdit, ["venueId"]);
    const afterRepeatedEdit = addOverriddenFields(afterSecondEdit, ["primaryGenre"]);
    expect(afterRepeatedEdit.sort()).toEqual(["primaryGenre", "venueId"].sort());
    expect(afterRepeatedEdit).toHaveLength(2);
  });
});

describe("stripOverriddenFields — the manual-override protection guarantee", () => {
  it("a manually-corrected field survives a later automated sync untouched", () => {
    // Admin corrects the genre by hand.
    const overriddenFields = addOverriddenFields([], ["primaryGenre"]);

    // A later sync run tries to overwrite title, primaryGenre and venueId.
    const syncProposedPatch = {
      title: "Updated Title From Source",
      primaryGenre: "house",
      venueId: "v-different-venue",
    };

    const applied = stripOverriddenFields(syncProposedPatch, overriddenFields);

    expect(applied).not.toHaveProperty("primaryGenre");
    expect(applied.title).toBe("Updated Title From Source");
    expect(applied.venueId).toBe("v-different-venue");
  });

  it("protects multiple manually-corrected fields simultaneously", () => {
    const overriddenFields = addOverriddenFields([], ["title", "venueId", "cancelled"]);
    const syncProposedPatch = {
      title: "Source Title",
      venueId: "v-source-venue",
      cancelled: false,
      startDatetime: "2026-09-20T22:00:00+02:00",
    };

    const applied = stripOverriddenFields(syncProposedPatch, overriddenFields);

    expect(applied).toEqual({ startDatetime: "2026-09-20T22:00:00+02:00" });
  });

  it("applies every field normally when nothing has been manually overridden", () => {
    const syncProposedPatch = { title: "Source Title", soldOut: true };
    expect(stripOverriddenFields(syncProposedPatch, [])).toEqual(syncProposedPatch);
  });

  it("a manual hide/unpublish is itself protectable and survives a sync trying to republish", () => {
    const overriddenFields = addOverriddenFields([], ["published"]);
    const syncProposedPatch = { published: true, soldOut: true };
    const applied = stripOverriddenFields(syncProposedPatch, overriddenFields);
    expect(applied).toEqual({ soldOut: true });
    expect(applied).not.toHaveProperty("published");
  });

  // Event-level link editing (2026-09-07): officialEventUrl/ticketUrl go
  // through this exact same generic mechanism as every other editable
  // field — no URL-specific code path exists or is needed.
  it("an admin-added officialEventUrl survives a later source sync proposing a different URL", () => {
    const overriddenFields = addOverriddenFields([], ["officialEventUrl"]);
    const syncProposedPatch = { officialEventUrl: "https://source.example.com/new-page", ticketUrl: "https://source.example.com/tickets" };
    const applied = stripOverriddenFields(syncProposedPatch, overriddenFields);
    expect(applied).not.toHaveProperty("officialEventUrl");
    expect(applied.ticketUrl).toBe("https://source.example.com/tickets");
  });

  it("an admin-cleared ticketUrl (protected, currently null) is not silently restored by a later sync", () => {
    const overriddenFields = addOverriddenFields([], ["ticketUrl"]);
    // The source still reports a ticketUrl on every sync — a real value,
    // not null — but the admin's explicit clear must still win.
    const syncProposedPatch = { ticketUrl: "https://billetto.dk/e/some-event-1" };
    const applied = stripOverriddenFields(syncProposedPatch, overriddenFields);
    expect(applied).toEqual({});
  });

  // Rescheduled-status correction (2026-10-06): adminClearRescheduledStatus
  // (db/writes.ts) deliberately never adds "dateChanged"/"timeChanged" to
  // overriddenFields — this is the mechanism that makes that safe. Unlike
  // every other field above, a genuine future sync-proposed dateChanged:true
  // must NOT be protected/stripped after a clear, so that a real reschedule
  // can still be detected and shown again.
  it("dateChanged/timeChanged are never protected by a Rescheduled-status clear, so a genuine future date change still applies normally", () => {
    const overriddenFieldsAfterClear: string[] = []; // the clear action never adds to this list
    const laterGenuineReschedule = { dateChanged: true, startDatetime: "2026-11-20T22:00:00.000Z" };
    const applied = stripOverriddenFields(laterGenuineReschedule, overriddenFieldsAfterClear);
    expect(applied).toEqual(laterGenuineReschedule);
  });
});

describe("isEditableEventField", () => {
  it("accepts known editable fields", () => {
    expect(isEditableEventField("primaryGenre")).toBe(true);
    expect(isEditableEventField("venueId")).toBe(true);
  });

  it("rejects fields that are never admin-editable (identity/provenance fields)", () => {
    expect(isEditableEventField("id")).toBe(false);
    expect(isEditableEventField("slug")).toBe(false);
    expect(isEditableEventField("canonicalSourceId")).toBe(false);
    expect(isEditableEventField("createdAt")).toBe(false);
  });

  it("accepts officialEventUrl and ticketUrl (event-level link editing, 2026-09-07)", () => {
    expect(isEditableEventField("officialEventUrl")).toBe(true);
    expect(isEditableEventField("ticketUrl")).toBe(true);
  });
});


describe("classifyAdminFieldChange (editorial screening, priority 1)", () => {
  it("changed / cleared / unchanged", () => {
    expect(classifyAdminFieldChange("A", "B")).toBe("changed");
    expect(classifyAdminFieldChange(null, "B")).toBe("changed");
    expect(classifyAdminFieldChange("A", null)).toBe("cleared");
    expect(classifyAdminFieldChange("A", "")).toBe("cleared");
    expect(classifyAdminFieldChange(["A"], [])).toBe("cleared");
    expect(classifyAdminFieldChange(null, "")).toBe("unchanged");
    expect(classifyAdminFieldChange(undefined, null)).toBe("unchanged");
    expect(classifyAdminFieldChange(["A", "B"], ["A", "B"])).toBe("unchanged");
  });

  it("artist order and spelling are real edits; surrounding whitespace is not", () => {
    expect(classifyAdminFieldChange(["A", "B"], ["B", "A"])).toBe("changed");
    expect(classifyAdminFieldChange(["Alice Ai"], ["Alice AI"])).toBe("changed");
    expect(classifyAdminFieldChange(["A "], ["A"])).toBe("unchanged");
  });

  it("only the precision the form can't express is ignored", () => {
    // form value on the minute vs stored value inside that minute -> same
    expect(adminValuesEqual(new Date("2026-10-17T19:00:42Z"), new Date("2026-10-17T19:00:00Z"))).toBe(true);
    // a submitted value carrying its own seconds must match exactly
    expect(adminValuesEqual(new Date("2026-10-17T19:00:00Z"), new Date("2026-10-17T19:00:30Z"))).toBe(false);
    expect(adminValuesEqual(new Date("2026-10-17T19:00:30Z"), new Date("2026-10-17T19:00:30Z"))).toBe(true);
    // the next minute is a real change, even when the stored value is :59
    expect(adminValuesEqual(new Date("2026-10-17T19:00:59Z"), new Date("2026-10-17T19:01:00Z"))).toBe(false);
  });

  it("an invalid date never equals anything and is never classified as unchanged or cleared", () => {
    expect(adminValuesEqual(new Date("2026-10-17T19:00:00Z"), new Date("not a date"))).toBe(false);
    expect(adminValuesEqual(new Date("invalid"), new Date("invalid"))).toBe(false);
    expect(classifyAdminFieldChange(new Date("2026-10-17T19:00:00Z"), new Date("not a date"))).toBe("changed");
  });

  it("timestamps compare at minute precision and across Date/ISO string", () => {
    expect(adminValuesEqual(new Date("2026-10-17T19:00:42Z"), new Date("2026-10-17T19:00:00Z"))).toBe(true);
    expect(adminValuesEqual(new Date("2026-10-17T19:00:00Z"), "2026-10-17T19:00:00.000Z")).toBe(true);
    expect(adminValuesEqual(new Date("2026-10-17T19:00:00Z"), new Date("2026-10-17T20:00:00Z"))).toBe(false);
  });

  it("booleans and numbers are compared exactly", () => {
    expect(classifyAdminFieldChange(false, false)).toBe("unchanged");
    expect(classifyAdminFieldChange(false, true)).toBe("changed");
    expect(classifyAdminFieldChange(0, 0)).toBe("unchanged");
  });
});

describe("partitionAdminPatch", () => {
  it("keeps only changed and cleared keys, plus alwaysTouched keys that are present", () => {
    const stored = { title: "T", ticketUrl: "https://t.example/1", published: true, endDatetime: null };
    const result = partitionAdminPatch(stored, { title: "T", ticketUrl: null, published: true, endDatetime: null }, { alwaysTouched: ["published"] });
    expect(result.effectivePatch).toEqual({ ticketUrl: null, published: true });
    expect(result.changed).toEqual([]);
    expect(result.cleared).toEqual(["ticketUrl"]);
    expect(result.unchanged).toEqual(["title", "published", "endDatetime"]);
    expect(result.touchedFields).toEqual(["ticketUrl", "published"]);
  });

  it("never mutates its inputs", () => {
    const stored = { title: "T" };
    const patch = { title: "U" };
    partitionAdminPatch(stored, patch);
    expect(stored).toEqual({ title: "T" });
    expect(patch).toEqual({ title: "U" });
  });
});
