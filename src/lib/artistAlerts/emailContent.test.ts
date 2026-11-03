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
