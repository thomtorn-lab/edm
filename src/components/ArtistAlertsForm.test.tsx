// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ArtistAlertsForm from "./ArtistAlertsForm";

const artists = [
  { id: "art_00000000-0001", displayName: "Aaron Able", disambiguation: null, upcomingEvents: 2 },
  { id: "art_00000000-0002", displayName: "Daria Kolosova", disambiguation: null, upcomingEvents: 1 },
];

afterEach(cleanup);

describe("ArtistAlertsForm (signup)", () => {
  it("shows no artist list until the visitor searches", () => {
    render(<ArtistAlertsForm mode="signup" artists={artists} />);
    expect(screen.queryByText("Aaron Able")).toBeNull();
    expect(screen.getByText(/Type an artist.s name to find them/)).toBeTruthy();
  });

  it("shows matching artists when typing", () => {
    render(<ArtistAlertsForm mode="signup" artists={artists} />);
    fireEvent.change(screen.getByLabelText("Find artists"), { target: { value: "daria" } });
    expect(screen.getByText("Daria Kolosova")).toBeTruthy();
    expect(screen.queryByText("Aaron Able")).toBeNull();
  });

  it("offers a request right under the search field, and opens it when nothing matches", () => {
    render(<ArtistAlertsForm mode="signup" artists={artists} />);
    expect(screen.queryByLabelText("Artist name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Request them/ }));
    expect(screen.getByLabelText("Artist name")).toBeTruthy();
  });

  it("opens the request form by itself when a search finds nothing", () => {
    render(<ArtistAlertsForm mode="signup" artists={artists} />);
    fireEvent.change(screen.getByLabelText("Find artists"), { target: { value: "Nobody Known" } });
    expect((screen.getByLabelText("Artist name") as HTMLInputElement).value).toBe("Nobody Known");
  });
});
