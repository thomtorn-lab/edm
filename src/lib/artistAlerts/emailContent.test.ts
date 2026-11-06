import { describe, expect, it } from "vitest";
import { buildAlertEmail, manageUrl, unsubscribeUrl } from "./emailContent";

const TOKEN = "a".repeat(43);

describe("buildAlertEmail", () => {
  const email = buildAlertEmail({
    manageToken: TOKEN,
    events: [{ artistName: "Daria Kolosova", title: "Night", slug: "night", startDatetime: new Date("2026-12-05T22:00:00Z"), venueName: "Culture Box" }],
  });

  it("links Unsubscribe in the body to the manage page (GET-safe), never to the POST-only API", () => {
    expect(email.text).toContain(`Unsubscribe: ${manageUrl(TOKEN)}`);
    expect(email.html).toContain(`href="${manageUrl(TOKEN)}" style="color:#999999;">Unsubscribe</a>`);
    expect(email.text).not.toContain(unsubscribeUrl(TOKEN));
    expect(email.html).not.toContain(unsubscribeUrl(TOKEN));
  });

  it("keeps the one-click target for the List-Unsubscribe header", () => {
    expect(unsubscribeUrl(TOKEN)).toBe(`https://www.electroniccph.com/api/artist-alerts/unsubscribe?token=${TOKEN}`);
  });
});

describe("artist request and manage emails (2026-11-06)", () => {
  const token = "m".repeat(43);

  it("approved request: the agreed subject and body, plus a personal manage link", async () => {
    const { buildRequestResultEmail } = await import("./emailContent");
    const e = buildRequestResultEmail({ artistName: "Kölsch", approved: true, manageToken: token });
    expect(e.subject).toBe("You're now following Kölsch");
    expect(e.text).toContain("Your artist request has been approved. You're now following Kölsch on Electronic CPH.");
    expect(e.text).toContain("We'll email you when new events featuring Kölsch are added.");
    expect(e.text).toContain(`/artists/manage?token=${token}`);
  });

  it("rejected request: short, with the manage link", async () => {
    const { buildRequestResultEmail } = await import("./emailContent");
    const e = buildRequestResultEmail({ artistName: "Teskey Brothers", approved: false, manageToken: token });
    expect(e.subject).toBe("We couldn't add Teskey Brothers");
    expect(e.text).toContain(`/artists/manage?token=${token}`);
  });

  it("manage link carries picks that the manage page can read back", async () => {
    const { buildManageLinkEmail, decodeRequestPicks } = await import("./emailContent");
    const e = buildManageLinkEmail({ manageToken: token, picks: { artistIds: ["art_00000000-0001"], requests: [{ name: "Kölsch", profileUrl: null }] } });
    const url = e.text.split("\n").find((l) => l.includes("/artists/manage"))!;
    const params = new URL(url).searchParams;
    expect(params.get("token")).toBe(token);
    expect(params.get("add")).toBe("art_00000000-0001");
    expect(decodeRequestPicks(params.get("req") ?? undefined)).toEqual([{ name: "Kölsch", profileUrl: null }]);
    expect(decodeRequestPicks("not base64 json")).toEqual([]);
    expect(buildManageLinkEmail({ manageToken: token }).text).toContain(`/artists/manage?token=${token}\n`);
  });

  it("the confirmation email has no manage link", async () => {
    const { buildConfirmEmail } = await import("./emailContent");
    expect(buildConfirmEmail({ confirmToken: "c".repeat(43), artistNames: ["Ayla"] }).text).not.toContain("/artists/manage");
  });
});
