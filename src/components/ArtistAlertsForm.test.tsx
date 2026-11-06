// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ArtistAlertsForm from "./ArtistAlertsForm";

const artists = [
  { id: "art_00000000-0001", displayName: "Aaron Able", disambiguation: null, upcomingEvents: 2 },
  { id: "art_00000000-0002", displayName: "Daria Kolosova", disambiguation: null, upcomingEvents: 1 },
];

afterEach(cleanup);

describe("ArtistAlertsForm (manage)", () => {
  it("labels requested artists Pending and offers picks from the public form in one click", () => {
    render(
      <ArtistAlertsForm
        mode="manage"
        token={"m".repeat(43)}
        artists={artists}
        followed={[{ artistId: "art_req", displayName: "Kölsch", state: "awaiting_verification" }]}
        picks={{ artists: [artists[1]], requests: [{ name: "Teskey Brothers", profileUrl: null }] }}
      />,
    );
    expect(screen.getByText(/Pending/)).toBeTruthy();
    expect(screen.getByText("Daria Kolosova, Teskey Brothers (request)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add these 2 artists" })).toBeTruthy();
  });
});

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

  it("offers a request once the visitor searches", () => {
    render(<ArtistAlertsForm mode="signup" artists={artists} />);
    expect(screen.queryByRole("button", { name: /Request an artist/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Find artists"), { target: { value: "dar" } });
    expect(screen.queryByLabelText("Artist name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Request an artist/ }));
    expect(screen.getByLabelText("Artist name")).toBeTruthy();
  });

  it("never requests an artist already on the site, unless a profile link marks a namesake", () => {
    render(<ArtistAlertsForm mode="signup" artists={artists} />);
    fireEvent.change(screen.getByLabelText("Find artists"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Request an artist/ }));
    fireEvent.change(screen.getByLabelText("Artist name"), { target: { value: "daria kolosova" } });
    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    expect(screen.getByRole("alert").textContent).toMatch(/already on Electronic CPH/);
    expect(screen.queryByText(/\(request\) ×/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Spotify or SoundCloud URL (optional)"), { target: { value: "https://soundcloud.com/other-daria" } });
    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    expect(screen.getByText("daria kolosova (request) ×")).toBeTruthy();
  });

  it("opens the request form by itself when a search finds nothing", () => {
    render(<ArtistAlertsForm mode="signup" artists={artists} />);
    fireEvent.change(screen.getByLabelText("Find artists"), { target: { value: "Nobody Known" } });
    expect((screen.getByLabelText("Artist name") as HTMLInputElement).value).toBe("Nobody Known");
  });
});
