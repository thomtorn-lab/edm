// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import BackToEventsLink from "./BackToEventsLink";
import { LIST_RETURN_STORAGE_KEY } from "@/lib/explorerFilters";

const store = (eventPath: string, listUrl: string) =>
  window.sessionStorage.setItem(LIST_RETURN_STORAGE_KEY, JSON.stringify({ eventPath, listUrl }));

const href = () => screen.getByRole("link", { name: "← All events" }).getAttribute("href");

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("BackToEventsLink", () => {
  it("links to the plain homepage on a direct visit (nothing recorded in this tab)", () => {
    render(<BackToEventsLink eventPath="/events/a" />);
    expect(href()).toBe("/");
  });

  it("returns to the filtered list this event was opened from", () => {
    store("/events/a", "/?when=weekend&q=tim");
    render(<BackToEventsLink eventPath="/events/a" />);
    expect(href()).toBe("/?when=weekend&q=tim");
  });

  it("links to the plain homepage for a different event than the one opened from the list", () => {
    store("/events/a", "/?q=tim");
    render(<BackToEventsLink eventPath="/events/b" />);
    expect(href()).toBe("/");
  });

  it("never follows a tampered, off-site target", () => {
    store("/events/a", "https://evil.example/");
    render(<BackToEventsLink eventPath="/events/a" />);
    expect(href()).toBe("/");
  });

  it("server-renders the plain homepage link (crawlers and no-JS visitors)", () => {
    store("/events/a", "/?q=tim");
    expect(renderToStaticMarkup(<BackToEventsLink eventPath="/events/a" />)).toContain('href="/"');
  });
});
