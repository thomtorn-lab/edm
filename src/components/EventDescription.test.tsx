// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import EventDescription from "./EventDescription";

const fixture = (name: string) => readFileSync(path.join(__dirname, "..", "lib", "__fixtures__", "descriptions", name), "utf8");

afterEach(cleanup);

describe("EventDescription", () => {
  it("renders headings and paragraphs as real elements", () => {
    const { container } = render(
      <EventDescription text={"LINEUP\n☆ BK [he/him]\nBK is a Copenhagen DJ who plays bass-heavy club music and runs the night Sweat."} />,
    );
    expect(container.querySelector("h3")?.textContent).toBe("LINEUP");
    expect(container.querySelector("h4")?.textContent).toBe("☆ BK [he/him]");
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("never injects source markup — tags arrive as text, never as elements", () => {
    const { container } = render(<EventDescription text={'Hello <img src=x onerror="alert(1)"> world, a long enough line.'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it("renders links as external, accessible, non-endorsing anchors to the original URL", () => {
    const { container } = render(<EventDescription text="Listen here: https://soundcloud.com/babysquid" />);
    const a = container.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://soundcloud.com/babysquid");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer nofollow ugc");
    expect(a.textContent).toBe("SoundCloud (opens in a new tab)");
  });

  it("keeps line breaks within a paragraph of short info lines", () => {
    const { container } = render(<EventDescription text={"Doors 23:00\nTickets 120 DKK"} />);
    expect(container.querySelectorAll("br")).toHaveLength(1);
  });

  it("renders nothing for an empty description", () => {
    const { container } = render(<EventDescription text="   " />);
    expect(container.innerHTML).toBe("");
  });
});

describe("EventDescription — Show more / Show less", () => {
  const LONG = Array.from({ length: 6 }, (_, i) => `Paragraph ${i + 1}: ${"the night continues with more music and more dancing. ".repeat(4)}`).join("\n\n");

  it("short texts render in full with no toggle", () => {
    const { container } = render(<EventDescription text="Doors 23:00. A short description." />);
    expect(container.querySelector("button")).toBeNull();
  });

  it("long texts: everything is in the server-rendered HTML; the folded part is only hidden", () => {
    const html = renderToString(<EventDescription text={LONG} />);
    for (let i = 1; i <= 6; i++) expect(html).toContain(`Paragraph ${i}:`);
    expect(html).toMatch(/<div id="[^"]+" hidden="">/);
    expect(html).toContain("Show more");
  });

  it("toggles visibility and aria-expanded, and folds back", () => {
    const { container, getByRole } = render(<EventDescription text={LONG} />);
    const button = getByRole("button", { name: "Show more" });
    const folded = container.querySelector(`#${CSS.escape(button.getAttribute("aria-controls")!)}`)!;
    expect(folded.hasAttribute("hidden")).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(folded.hasAttribute("hidden")).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.textContent).toBe("Show less");
    fireEvent.click(button);
    expect(folded.hasAttribute("hidden")).toBe(true);
  });
});

describe("EventDescription — recovered structure and practical section (2026-10-30)", () => {
  it("shows a flat admin-created text with its sections, and its practical part folded under its own toggle", () => {
    const html = renderToString(<EventDescription text={fixture("den-anden-side-morpheus-flat.txt")} />);
    const { container } = render(<EventDescription text={fixture("den-anden-side-morpheus-flat.txt")} />);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toContain("Practical information");
    expect(details.textContent).toContain("Presale 170 DKK");
    expect(details.textContent).toContain("Code Of Conduct");
    // Lineup stays in the About text, outside the practical section.
    const lineup = [...container.querySelectorAll("h3")].find((h) => h.textContent === "Lineup")!;
    expect(details.contains(lineup)).toBe(false);
    // Everything is in the server-rendered HTML.
    expect(html).toContain("The Awareness Team is at the club every weekend");
    expect(html).toContain("Beste Hira Alina Niels Fisker");
  });

  it("uses the source's own 'Practical information' title as the toggle instead of repeating it", () => {
    const about = "A long description of the night and its artists. ".repeat(6);
    const { container } = render(<EventDescription text={`${about}\n\nPractical Information:\nDoors at 22. Age 18+.`} />);
    expect(container.querySelector("summary")?.textContent).toContain("Practical Information");
    expect(container.querySelector("details h3")).toBeNull();
    expect(container.querySelector("details")?.textContent).toContain("Doors at 22. Age 18+.");
  });

  it("keeps a text whole when practical details only appear in prose", () => {
    const { container } = render(<EventDescription text={fixture("den-anden-side-syntharax-prose.txt")} />);
    expect(container.querySelector("details")).toBeNull();
  });

  it("folds one long single paragraph inside that paragraph, with the full text in the HTML", () => {
    const text = fixture("pumpehuset-icona-pop-flat.txt");
    const { container } = render(<EventDescription text={text} />);
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    const folded = paragraphs[0].querySelector("[hidden]")!;
    expect(folded.tagName).toBe("SPAN");
    expect(paragraphs[0].textContent!.replace(/Show (more|less)$/, "")).toBe(text.trim());
    fireEvent.click(container.querySelector("button")!);
    expect(paragraphs[0].querySelector("[hidden]")).toBeNull();
  });
});
