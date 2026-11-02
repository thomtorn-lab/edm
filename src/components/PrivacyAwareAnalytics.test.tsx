// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import PrivacyAwareAnalytics from "./PrivacyAwareAnalytics";
import AnalyticsConsentSettings from "./AnalyticsConsentSettings";
import { analyticsBeforeSend } from "@/lib/analytics";
import { ANALYTICS_CONSENT_STORAGE_KEY, ANALYTICS_CONSENT_VERSION, resetAnalyticsConsentForTests } from "@/lib/analyticsConsent";

/**
 * Consent for visitor statistics (consent round, 2026-10-30). Uses the real
 * @vercel/analytics component: "loaded" means its script tag in <head> and
 * its window.va queue — neither may exist before the visitor allows it.
 */
type AnalyticsWindow = Window & { va?: unknown; vaq?: unknown };

function analyticsScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll("script")).filter((s) => /insights|vercel-scripts/.test(s.src));
}

function analyticsLoaded(): boolean {
  return analyticsScripts().length > 0 || (window as AnalyticsWindow).va !== undefined;
}

function storedChoice(): unknown {
  const raw = localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY);
  return raw ? JSON.parse(raw).choice : null;
}

const PAGEVIEW = { type: "pageview" as const, url: "https://electroniccph.com/newsletter/manage?token=secret" };

beforeEach(() => {
  localStorage.clear();
  resetAnalyticsConsentForTests();
  for (const s of analyticsScripts()) s.remove();
  delete (window as AnalyticsWindow).va;
  delete (window as AnalyticsWindow).vaq;
});
afterEach(cleanup);

describe("before any choice", () => {
  it("shows the banner and loads nothing", () => {
    render(<PrivacyAwareAnalytics />);
    expect(screen.getByRole("heading", { name: "Allow visitor statistics?" })).toBeTruthy();
    expect(analyticsLoaded()).toBe(false);
  });

  it("drops every analytics event", () => {
    expect(analyticsBeforeSend(PAGEVIEW)).toBeNull();
  });

  it("offers Decline and Allow as equal buttons, with a link to change the choice later", () => {
    render(<PrivacyAwareAnalytics />);
    const decline = screen.getByRole("button", { name: "Decline" });
    const allow = screen.getByRole("button", { name: "Allow" });
    expect(decline.className).toBe(allow.className);
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy#statistics");
  });
});

describe("Decline", () => {
  it("hides the banner, stores the refusal and never loads analytics", () => {
    render(<PrivacyAwareAnalytics />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(screen.queryByRole("heading", { name: "Allow visitor statistics?" })).toBeNull();
    expect(storedChoice()).toBe("denied");
    expect(analyticsLoaded()).toBe(false);
    expect(analyticsBeforeSend(PAGEVIEW)).toBeNull();
  });

  it("is respected on the next visit: no banner, nothing loaded", () => {
    localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, JSON.stringify({ choice: "denied", version: ANALYTICS_CONSENT_VERSION }));
    render(<PrivacyAwareAnalytics />);
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    expect(analyticsLoaded()).toBe(false);
  });
});

describe("Allow", () => {
  it("loads analytics only after the press, and sends with the query string stripped", () => {
    render(<PrivacyAwareAnalytics />);
    expect(analyticsLoaded()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(storedChoice()).toBe("granted");
    expect(analyticsScripts()).toHaveLength(1);
    expect(analyticsBeforeSend(PAGEVIEW)).toEqual({ type: "pageview", url: "https://electroniccph.com/newsletter/manage" });
  });

  it("a choice stored under an older wording version asks again and loads nothing", () => {
    localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, JSON.stringify({ choice: "granted", version: ANALYTICS_CONSENT_VERSION - 1 }));
    render(<PrivacyAwareAnalytics />);
    expect(screen.getByRole("button", { name: "Allow" })).toBeTruthy();
    expect(analyticsLoaded()).toBe(false);
  });
});

describe("changing the choice later (Privacy page)", () => {
  it("withdrawing stops sending immediately", () => {
    render(
      <>
        <PrivacyAwareAnalytics />
        <AnalyticsConsentSettings />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(screen.getByRole("status").textContent).toBe("You have allowed visitor statistics.");
    expect(analyticsBeforeSend(PAGEVIEW)).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Decline statistics" }));
    expect(storedChoice()).toBe("denied");
    expect(screen.getByRole("status").textContent).toContain("declined");
    expect(analyticsBeforeSend(PAGEVIEW)).toBeNull();
  });

  it("a visitor who declined can allow from the Privacy page", () => {
    render(
      <>
        <PrivacyAwareAnalytics />
        <AnalyticsConsentSettings />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect((screen.getByRole("button", { name: "Decline statistics" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Allow statistics" }));
    expect(storedChoice()).toBe("granted");
    expect(analyticsScripts()).toHaveLength(1);
  });

  it("follows a choice made in another tab", () => {
    render(<PrivacyAwareAnalytics />);
    act(() => {
      localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, JSON.stringify({ choice: "denied", version: ANALYTICS_CONSENT_VERSION }));
      window.dispatchEvent(new StorageEvent("storage", { key: ANALYTICS_CONSENT_STORAGE_KEY }));
    });
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
  });
});

describe("blocked storage", () => {
  it("still respects the choice for the rest of the page's life", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      render(<PrivacyAwareAnalytics />);
      fireEvent.click(screen.getByRole("button", { name: "Decline" }));
      expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
      expect(analyticsLoaded()).toBe(false);
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
