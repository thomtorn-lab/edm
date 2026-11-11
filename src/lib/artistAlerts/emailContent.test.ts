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

  it("rejected request: the agreed wording, manage link and contact address", async () => {
    const { buildRequestResultEmail } = await import("./emailContent");
    const e = buildRequestResultEmail({ artistName: "Teskey Brothers", approved: false, manageToken: token });
    expect(e.subject).toBe("We couldn't add Teskey Brothers");
    expect(e.text.startsWith("Hi,\n\nThanks for suggesting Teskey Brothers!")).toBe(true);
    expect(e.text).toContain("You won\u2019t receive event alerts for Teskey Brothers, but you can still follow other artists on ElectronicCPH.");
    expect(e.text).toContain(`Manage your artist alerts: ${manageUrl(token)}`);
    expect(e.text).toContain("contact us at hello@electroniccph.com.");
    expect(e.text.endsWith("Best regards,\nElectronicCPH")).toBe(true);
    expect(e.html).toContain("contact us at hello@electroniccph.com.");
    expect(e.html).toContain("Thanks for suggesting Teskey Brothers!");
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

describe("HTML link text (2026-11-11)", () => {
  const token = "m".repeat(43);
  const linkTexts = (html: string) => [...html.matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);

  it("alert: the event name is an underlined, coloured link to the event page", () => {
    const e = buildAlertEmail({
      manageToken: token,
      events: [{ artistName: "Daria Kolosova", title: "Night", slug: "night", startDatetime: new Date("2026-12-05T22:00:00Z"), venueName: "Culture Box" }],
    });
    expect(e.html).toMatch(/<a href="[^"]*\/events\/night\?utm_source=artist-alert&amp;utm_medium=email" style="color:#ab9be0;text-decoration:underline;">Night<\/a>/);
  });

  it("manage-link and request-result emails show 'Manage your artist alerts', never the bare URL", async () => {
    const { buildManageLinkEmail, buildRequestResultEmail } = await import("./emailContent");
    const emails = [
      buildManageLinkEmail({ manageToken: token }),
      buildManageLinkEmail({ manageToken: token, picks: { artistIds: ["art_00000000-0001"], requests: [] } }),
      buildRequestResultEmail({ artistName: "Kölsch", approved: true, manageToken: token }),
      buildRequestResultEmail({ artistName: "Kölsch", approved: false, manageToken: token }),
    ];
    for (const e of emails) {
      expect(linkTexts(e.html)).toEqual(["Manage your artist alerts"]);
      expect(e.html).toContain(`/artists/manage?token=${token}`); // same destination, in the href
      expect(e.html.replace(/href="[^"]*"/g, "")).not.toContain("token="); // not visible
      expect(e.text).toContain(`/artists/manage?token=${token}`); // plain-text fallback keeps the URL
    }
  });
});
