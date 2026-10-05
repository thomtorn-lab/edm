// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const confirmSubscriberByTokenMock = vi.fn();
vi.mock("@/db/newsletter", () => ({
  confirmSubscriberByToken: (...args: unknown[]) => confirmSubscriberByTokenMock(...args),
}));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

import NewsletterConfirmPage from "./page";

afterEach(() => {
  cleanup();
  confirmSubscriberByTokenMock.mockReset();
  redirectMock.mockClear();
});

describe("NewsletterConfirmPage", () => {
  it("redirects to the manage page with the manage token on a valid confirm token", async () => {
    confirmSubscriberByTokenMock.mockResolvedValue({ manageToken: "manage-123" });
    await expect(
      NewsletterConfirmPage({ searchParams: Promise.resolve({ token: "confirm-123" }) }),
    ).rejects.toThrow("REDIRECT:/newsletter/manage?token=manage-123&justConfirmed=1");
    expect(confirmSubscriberByTokenMock).toHaveBeenCalledWith("confirm-123");
  });

  it("shows an invalid-link message for an unrecognized token, without redirecting", async () => {
    confirmSubscriberByTokenMock.mockResolvedValue(null);
    const element = await NewsletterConfirmPage({ searchParams: Promise.resolve({ token: "bogus" }) });
    render(element);
    expect(screen.getByText(/Link not valid/i)).toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("shows an invalid-link message when no token is present at all", async () => {
    const element = await NewsletterConfirmPage({ searchParams: Promise.resolve({}) });
    render(element);
    expect(screen.getByText(/Link not valid/i)).toBeTruthy();
    expect(confirmSubscriberByTokenMock).not.toHaveBeenCalled();
  });
});
