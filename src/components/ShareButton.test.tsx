// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import ShareButton from "./ShareButton";

const TITLE = "Test Event";
const URL = "https://electroniccph.com/events/test-event";

function setNavigatorShare(fn?: (data: ShareData) => Promise<void>) {
  Object.defineProperty(window.navigator, "share", { value: fn, configurable: true, writable: true });
}

function setNavigatorClipboard(writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(window.navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
    writable: true,
  });
}

async function clickShare() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: `Share ${TITLE}` }));
    // Flush the microtask queue so the mocked share()/clipboard promise
    // resolves and the resulting state update lands before we assert.
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ShareButton", () => {
  afterEach(() => {
    cleanup();
    setNavigatorShare(undefined);
    setNavigatorClipboard(undefined);
    vi.useRealTimers();
  });

  it("1. renders a real, keyboard-accessible button", () => {
    render(<ShareButton title={TITLE} url={URL} />);
    const button = screen.getByRole("button", { name: `Share ${TITLE}` });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
  });

  it("2. accessible name is 'Share <event title>'", () => {
    render(<ShareButton title="Warehouse Night" url={URL} />);
    expect(screen.getByRole("button", { name: "Share Warehouse Night" })).toBeTruthy();
  });

  it("3. supported navigator.share receives exactly the event title and canonical URL", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    setNavigatorShare(shareMock);
    render(<ShareButton title={TITLE} url={URL} />);
    await clickShare();
    expect(shareMock).toHaveBeenCalledTimes(1);
    expect(shareMock).toHaveBeenCalledWith({ title: TITLE, url: URL });
  });

  it("4. the payload contains exactly title/url — no text field, never a description/lineup", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    setNavigatorShare(shareMock);
    render(<ShareButton title={TITLE} url={URL} />);
    await clickShare();
    const payload = shareMock.mock.calls[0][0] as ShareData;
    expect(Object.keys(payload).sort()).toEqual(["title", "url"]);
    expect((payload as { text?: string }).text).toBeUndefined();
  });

  it("5. native-share cancellation shows no error UI and no success UI", async () => {
    const shareMock = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"));
    setNavigatorShare(shareMock);
    render(<ShareButton title={TITLE} url={URL} />);
    await clickShare();
    expect(shareMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/link copied/i)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/error|failed|something went wrong/i)).toBeNull();
  });

  it("5b. a resolved native share also shows no success message of its own — a resolved promise isn't proof the user actually shared", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    setNavigatorShare(shareMock);
    render(<ShareButton title={TITLE} url={URL} />);
    await clickShare();
    expect(screen.queryByText(/link copied/i)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("6. falls back to clipboard copy when navigator.share is unsupported", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigatorClipboard(writeText);
    render(<ShareButton title={TITLE} url={URL} />);
    await clickShare();
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("7. clipboard receives the exact canonical event URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigatorClipboard(writeText);
    render(<ShareButton title={TITLE} url={URL} />);
    await clickShare();
    expect(writeText).toHaveBeenCalledWith(URL);
  });

  it("8. shows 'Link copied' (announced via role=status) after a successful clipboard copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigatorClipboard(writeText);
    render(<ShareButton title={TITLE} url={URL} />);
    await clickShare();
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Link copied");
  });

  it("8b. the 'Link copied' announcement never moves keyboard focus off the Share button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigatorClipboard(writeText);
    render(<ShareButton title={TITLE} url={URL} />);
    const button = screen.getByRole("button", { name: `Share ${TITLE}` });
    button.focus();
    await clickShare();
    expect(document.activeElement).toBe(button);
  });

  it("9. 'Link copied' disappears automatically after ~2-3 seconds", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigatorClipboard(writeText);
    render(<ShareButton title={TITLE} url={URL} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `Share ${TITLE}` }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Link copied")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText("Link copied")).toBeNull();
  });

  it("10. repeated fallback clicks continue to work without reload/navigation", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigatorClipboard(writeText);
    render(<ShareButton title={TITLE} url={URL} />);
    const button = screen.getByRole("button", { name: `Share ${TITLE}` });
    const hrefBefore = window.location.href;

    for (let i = 1; i <= 3; i++) {
      await act(async () => {
        fireEvent.click(button);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText("Link copied")).toBeTruthy();
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.queryByText("Link copied")).toBeNull();
    }
    expect(writeText).toHaveBeenCalledTimes(3);
    expect(window.location.href).toBe(hrefBefore);
  });

  it("11. clipboard failure exposes a selectable canonical URL behind 'Copy event link', not a generic error", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));
    setNavigatorClipboard(writeText);
    render(<ShareButton title={TITLE} url={URL} />);
    await clickShare();

    expect(screen.queryByText(/error|failed|something went wrong/i)).toBeNull();
    expect(screen.getByText("Copy event link")).toBeTruthy();
    const input = screen.getByDisplayValue(URL) as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.tagName).toBe("INPUT");
  });

  it("11b. the manual-copy fallback field is keyboard usable (focusable and reachable via Escape to close)", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));
    setNavigatorClipboard(writeText);
    render(<ShareButton title={TITLE} url={URL} />);
    await clickShare();

    const input = screen.getByDisplayValue(URL) as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Copy event link")).toBeNull();
  });

  it("12. clicking Share never triggers a page navigation or reload", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    setNavigatorShare(shareMock);
    render(<ShareButton title={TITLE} url={URL} />);
    const hrefBefore = window.location.href;
    await clickShare();
    expect(window.location.href).toBe(hrefBefore);
  });
});
