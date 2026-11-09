// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import PrivacyPage from "./page";

describe("Privacy page (GDPR review, 2026-10-30)", () => {
  afterEach(cleanup);

  it("names the data controller", () => {
    render(<PrivacyPage />);
    expect(document.body.textContent).toContain("run by Thomas Tornerup, who is the data controller");
  });

  it("offers the visitor-statistics choice under the #statistics anchor the consent banner links to", () => {
    render(<PrivacyPage />);
    expect(document.getElementById("statistics")?.textContent).toBe("Visitor statistics");
    expect(screen.getByRole("button", { name: "Allow statistics" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline statistics" })).toBeTruthy();
  });

  it("states the Vercel Pro plan and claims no Vercel data processing addendum", () => {
    render(<PrivacyPage />);
    const text = document.body.textContent!;
    expect(text).toContain("on Vercel\u2019s Pro plan");
    expect(text).not.toMatch(/Hobby plan|Vercel\u2019s data processing addendum/);
  });

  it("describes Artist Alerts whenever it takes signups (test or live), and not otherwise", () => {
    for (const mode of [undefined, "observe", "test", "live"]) {
      if (mode) process.env.ARTIST_ALERTS_MODE = mode;
      else delete process.env.ARTIST_ALERTS_MODE;
      render(<PrivacyPage />);
      const text = document.body.textContent!;
      const shown = mode === "test" || mode === "live";
      expect(text.includes("If you sign up for Artist Alerts")).toBe(shown);
      expect(text.includes("and sending Artist Alerts emails")).toBe(shown);
      if (shown) expect(text).toContain("A signup that is never confirmed is deleted after 7 days");
      cleanup();
    }
    delete process.env.ARTIST_ALERTS_MODE;
  });

  it("names Resend as sender and Simply.com as the inbox host, not Gmail", () => {
    render(<PrivacyPage />);
    const text = document.body.textContent!;
    expect(text).toContain("our email-sending provider, Resend, to our @electroniccph.com inbox, which is hosted by Simply.com");
    expect(text).toContain("Simply.com \u2014 hosting of our @electroniccph.com email inbox");
    expect(text).toContain("6 months after our last exchange");
    expect(text).not.toMatch(/Gmail/);
  });

  it("contains no unresolved placeholders", () => {
    render(<PrivacyPage />);
    expect(document.body.textContent).not.toMatch(/\[(CONFIRM|CHOOSE|TODO)|TBD/);
  });
});
