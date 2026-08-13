import { describe, expect, it } from "vitest";
import { addOverriddenFields, isEditableEventField, stripOverriddenFields } from "./override";

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
});
