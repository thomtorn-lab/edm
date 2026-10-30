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

  it("states the Vercel Hobby plan and claims no Vercel data processing addendum or Pro plan", () => {
    render(<PrivacyPage />);
    const text = document.body.textContent!;
    expect(text).toContain("on Vercel\u2019s free Hobby plan");
    expect(text).not.toMatch(/Vercel\u2019s data processing addendum|Vercel Pro|Pro plan/);
  });

  it("contains no unresolved placeholders", () => {
    render(<PrivacyPage />);
    expect(document.body.textContent).not.toMatch(/\[(CONFIRM|CHOOSE|TODO)|TBD/);
  });
});
