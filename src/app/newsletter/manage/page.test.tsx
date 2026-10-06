// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const getSubscriberByManageTokenMock = vi.fn();
vi.mock("@/db/newsletter", () => ({
  getSubscriberByManageToken: (...args: unknown[]) => getSubscriberByManageTokenMock(...args),
}));

import NewsletterManagePage from "./page";

afterEach(() => {
  cleanup();
  getSubscriberByManageTokenMock.mockReset();
});

describe("NewsletterManagePage", () => {
  it("renders the preferences form for a valid token", async () => {
    getSubscriberByManageTokenMock.mockResolvedValue({
      id: "sub-1",
      email: "a@example.com",
      genres: ["techno"],
      confirmed: true,
      manageToken: "manage-123",
    });
    const element = await NewsletterManagePage({ searchParams: Promise.resolve({ token: "manage-123" }) });
    render(element);
    expect(screen.getByText("Newsletter preferences")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Techno" })).toBeTruthy();
  });

  it("shows the 'Subscribed' heading and copy when arriving fresh from confirmation", async () => {
    getSubscriberByManageTokenMock.mockResolvedValue({
      id: "sub-1",
      email: "a@example.com",
      genres: [],
      confirmed: true,
      manageToken: "manage-123",
    });
    const element = await NewsletterManagePage({
      searchParams: Promise.resolve({ token: "manage-123", justConfirmed: "1" }),
    });
    render(element);
    expect(screen.getByText("Subscribed")).toBeTruthy();
  });

  it("shows an invalid-link message for an unrecognized token", async () => {
    getSubscriberByManageTokenMock.mockResolvedValue(null);
    const element = await NewsletterManagePage({ searchParams: Promise.resolve({ token: "bogus" }) });
    render(element);
    expect(screen.getByText(/Link not valid/i)).toBeTruthy();
  });

  it("shows an invalid-link message when no token is present", async () => {
    const element = await NewsletterManagePage({ searchParams: Promise.resolve({}) });
    render(element);
    expect(screen.getByText(/Link not valid/i)).toBeTruthy();
    expect(getSubscriberByManageTokenMock).not.toHaveBeenCalled();
  });
});
