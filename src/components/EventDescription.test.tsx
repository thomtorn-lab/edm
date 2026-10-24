// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import EventDescription from "./EventDescription";

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
