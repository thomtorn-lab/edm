// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ArtistAlertsBanner from "./ArtistAlertsBanner";

afterEach(cleanup);

describe("ArtistAlertsBanner", () => {
  it("is one link to /artists with the agreed text, and no button or nested link", () => {
    const { container } = render(<ArtistAlertsBanner />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/artists");
    expect(links[0].textContent).toBe("Artist AlertsFind artists →Get email alerts for new events with artists you follow.");
    expect(screen.getByRole("link", { name: /Artist Alerts/ })).toBeTruthy();
    expect(container.querySelector("button")).toBeNull();
  });
});
