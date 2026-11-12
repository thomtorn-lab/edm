// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import BackToTopButton, { BACK_TO_TOP_THRESHOLD } from "./BackToTopButton";

function setScrollY(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, writable: true, configurable: true });
}

describe("BackToTopButton", () => {
  afterEach(() => {
    cleanup();
    setScrollY(0);
  });

  it("is hidden at the top of the page", () => {
    setScrollY(0);
    render(<BackToTopButton />);
    expect(screen.queryByRole("button", { name: "Back to top" })).toBeNull();
  });

  it("appears once scrolled past the threshold and hides again near the top", () => {
    setScrollY(0);
    render(<BackToTopButton />);

    act(() => {
      setScrollY(BACK_TO_TOP_THRESHOLD + 1);
      fireEvent.scroll(window);
    });
    expect(screen.getByRole("button", { name: "Back to top" })).toBeTruthy();

    act(() => {
      setScrollY(BACK_TO_TOP_THRESHOLD);
      fireEvent.scroll(window);
    });
    expect(screen.queryByRole("button", { name: "Back to top" })).toBeNull();
  });

  it("is shown on mount when the page is already scrolled down", () => {
    setScrollY(2000);
    render(<BackToTopButton />);
    expect(screen.getByRole("button", { name: "Back to top" })).toBeTruthy();
  });

  it("floats in a fixed position", () => {
    setScrollY(2000);
    render(<BackToTopButton />);
    expect(screen.getByRole("button", { name: "Back to top" }).className).toContain("fixed");
  });

  it("smooth-scrolls to the top and drops the #hash", () => {
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    const replaceState = vi.spyOn(history, "replaceState");
    window.location.hash = "#2026-09";
    setScrollY(2000);
    render(<BackToTopButton />);

    fireEvent.click(screen.getByRole("button", { name: "Back to top" }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(replaceState).toHaveBeenCalledWith(null, "", window.location.pathname + window.location.search);
    replaceState.mockRestore();
  });
});
