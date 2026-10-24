import { describe, expect, it } from "vitest";
import { formatDescription, formattedDescriptionToText, type DescriptionBlock, type DescriptionInline } from "./descriptionFormat";

/** Compact, readable rendering of the block list for assertions. */
function render(blocks: DescriptionBlock[]): string[] {
  const inline = (tokens: DescriptionInline[]) => tokens.map((t) => (t.type === "text" ? t.text : `[${t.label}](${t.href})`)).join("");
  return blocks.map((b) =>
    b.type === "heading" ? `${b.level === "section" ? "##" : "###"} ${inline(b.content)}` : b.lines.map(inline).join(" | "),
  );
}

/** Every word of the source must survive formatting (content is never lost). */
function words(text: string): string[] {
  return text.replace(/https?:\/\/\S+/g, "").match(/[\p{L}\p{N}]+/gu) ?? [];
}

const PINK_MONKEY = `PINK MONKEY AT KB3
Pink Monkey returns to KB3 for a full night of house and disco with residents and friends from all over the city.

LINEUP
PINK MONKEY: DJ
Pink Monkey is a Copenhagen-based selector known for long, warm sets of disco and house. Listen: https://soundcloud.com/pinkmonkey
DJ SOFIE: Artist & Producer
Sofie has released on several labels and plays everything from deep house to italo.
https://open.spotify.com/artist/123abc

PRACTICAL INFORMATION
Doors: 23:00
Tickets: 120 DKK / 150 DKK at the door
Age limit: 18+

CODE OF CONDUCT
We have zero tolerance for racism, sexism, homophobia and transphobia. If you experience anything, contact our awareness team at the bar.`;

const ALIGATOR = `DJ Aligator: The Final Reptile Rave. After many years on stage, DJ Aligator says goodbye with one last party in Store VEGA.
DJ ALIGATOR
DJ Aligator is known for hits like "The Whistle Song" and "Lolita" and has played clubs all over Europe.`;

const BK = `☆ BK [he/him] BK is a Copenhagen DJ who plays bass-heavy club music and runs the night Sweat. ☆ DJ paulC [he/him] paulC has been digging for records since the nineties and is known for eclectic sets. ☆ babysquid [she/her] babysquid is a producer and DJ whose sets blend UK garage and hardcore. https://soundcloud.com/babysquid`;

describe("formatDescription — reported cases", () => {
  it("1. Pink Monkey at KB3: section titles, artist headings, links, practical info and code of conduct", () => {
    expect(render(formatDescription(PINK_MONKEY, { headingHints: ["Pink Monkey"] }))).toEqual([
      "PINK MONKEY AT KB3",
      "Pink Monkey returns to KB3 for a full night of house and disco with residents and friends from all over the city.",
      "## LINEUP",
      "### PINK MONKEY: DJ",
      "Pink Monkey is a Copenhagen-based selector known for long, warm sets of disco and house. Listen: [SoundCloud](https://soundcloud.com/pinkmonkey)",
      "### DJ SOFIE: Artist & Producer",
      "Sofie has released on several labels and plays everything from deep house to italo.",
      "[Listen on Spotify](https://open.spotify.com/artist/123abc)",
      "## PRACTICAL INFORMATION",
      "Doors: 23:00 | Tickets: 120 DKK / 150 DKK at the door | Age limit: 18+",
      "## CODE OF CONDUCT",
      "We have zero tolerance for racism, sexism, homophobia and transphobia. If you experience anything, contact our awareness team at the bar.",
    ]);
  });

  it("2. DJ Aligator at Store VEGA: introduction paragraph, then the artist heading over its bio", () => {
    expect(render(formatDescription(ALIGATOR, { headingHints: ["DJ Aligator"] }))).toEqual([
      "DJ Aligator: The Final Reptile Rave. After many years on stage, DJ Aligator says goodbye with one last party in Store VEGA.",
      "### DJ ALIGATOR",
      'DJ Aligator is known for hits like "The Whistle Song" and "Lolita" and has played clubs all over Europe.',
    ]);
  });

  it("3. BK / DJ paulC / babysquid: three bios merged into one block become three sections", () => {
    expect(render(formatDescription(BK))).toEqual([
      "### ☆ BK [he/him]",
      "BK is a Copenhagen DJ who plays bass-heavy club music and runs the night Sweat.",
      "### ☆ DJ paulC [he/him]",
      "paulC has been digging for records since the nineties and is known for eclectic sets.",
      "### ☆ babysquid [she/her]",
      "babysquid is a producer and DJ whose sets blend UK garage and hardcore. [Listen on SoundCloud](https://soundcloud.com/babysquid)",
    ]);
  });

  it.each([
    ["Pink Monkey", PINK_MONKEY],
    ["DJ Aligator", ALIGATOR],
    ["BK", BK],
  ])("%s: no word of the original is lost, added or reordered", (_name, text) => {
    const out = formattedDescriptionToText(formatDescription(text));
    expect(words(out)).toEqual(words(text));
  });
});

describe("formatDescription — further validation cases", () => {
  it("4. a short one-paragraph description stays one plain paragraph", () => {
    const text = "Bliv forført af NNHMN's mystiske lyde - sikr din plads til debuten i København nu! 🎶🔮";
    expect(render(formatDescription(text))).toEqual([text]);
  });

  it("5. existing HTML: headings, paragraphs, lists and anchors are structured — tags are never passed through", () => {
    const html =
      '<h2>About the night</h2><p>A <strong>long</strong> night of techno.</p><p>Tickets at <a href="https://tix.example.com/e/1">our shop</a>.</p><ul><li>Doors 22</li><li>Ends 06</li></ul><script>alert(1)</script>';
    const out = render(formatDescription(html));
    expect(out).toEqual([
      "## About the night",
      "A long night of techno.",
      "Tickets at our shop [tix.example.com/e/1](https://tix.example.com/e/1).",
      "Doors 22 | Ends 06",
    ]);
    expect(out.join("\n")).not.toMatch(/<|alert/);
  });

  it("6. unusual symbols, emojis and several links: symbols kept, each valid link labelled, a truncated URL left as text", () => {
    const text =
      "🔥 WARM UP 🔥\n✨ Free entry before 23:00 ✨\nFollow us: https://www.instagram.com/club_x/ and https://facebook.com/clubx — and https://soundcloud.com/clubx/sets/summer… (link in bio)";
    expect(render(formatDescription(text))).toEqual([
      "🔥 WARM UP 🔥 | ✨ Free entry before 23:00 ✨",
      "Follow us: [Instagram](https://www.instagram.com/club_x/) and [Facebook](https://facebook.com/clubx) — and https://soundcloud.com/clubx/sets/summer… (link in bio)",
    ]);
  });

  it("7. ambiguous headings: a description written all in capitals gets no headings at all", () => {
    const text = "JOIN US FOR A NIGHT TO REMEMBER\nGREAT MUSIC\nGOOD VIBES\nSEE YOU THERE";
    expect(render(formatDescription(text))).toEqual(["JOIN US FOR A NIGHT TO REMEMBER | GREAT MUSIC | GOOD VIBES | SEE YOU THERE"]);
  });

  it("7b. ambiguous: a capitalised line with a time/date is information, not a heading", () => {
    const text = "DOORS 22:00\nWe open the doors at ten and the music runs until the early morning hours.";
    expect(render(formatDescription(text)).some((l) => l.startsWith("#"))).toBe(false);
  });

  it("7c. ambiguous: a single ☆ mention inside prose is not a section boundary", () => {
    const text = "Rated ☆ five stars by everyone who came last year, this night returns with the same crew.";
    expect(render(formatDescription(text))).toEqual([text]);
  });

  it("7d. ambiguous: a run of ★ list lines stays a list, not a stack of headings", () => {
    const text = "★ Free entry before 23\n★ Cheap drinks all night\n★ Open until 05";
    expect(render(formatDescription(text))).toEqual(["★ Free entry before 23 | ★ Cheap drinks all night | ★ Open until 05"]);
  });

  it("7e. 'LINEUP: DJ Aligator' is a lineup line, not an artist heading", () => {
    const text = "LINEUP: DJ Aligator and friends\nA night of hands-in-the-air Eurodance classics from start to finish.";
    expect(render(formatDescription(text)).some((l) => l.startsWith("#"))).toBe(false);
  });
});

describe("formatDescription — paragraphs and whitespace", () => {
  it("collapses runs of blank lines and stray spaces, keeps real paragraph breaks", () => {
    expect(render(formatDescription("First   paragraph here.\n\n\n\n\nSecond paragraph here.  "))).toEqual([
      "First paragraph here.",
      "Second paragraph here.",
    ]);
  });

  it("rejoins a sentence the source hard-wrapped mid-way", () => {
    const text = "This is a hard wrapped paragraph that the source broke\nin the middle of a sentence for no reason at all.";
    expect(render(formatDescription(text))).toEqual([
      "This is a hard wrapped paragraph that the source broke in the middle of a sentence for no reason at all.",
    ]);
  });

  it("separates full-length prose lines into paragraphs, but keeps short info lines together", () => {
    const text =
      "Prepare to witness a historic milestone as Infected Mushroom brings their massive anniversary tour to Copenhagen.\nThis is the definitive celebration of the absolute forefront of electronic music in this city.\nDoors 20:00\nTickets 450 DKK";
    expect(render(formatDescription(text))).toEqual([
      "Prepare to witness a historic milestone as Infected Mushroom brings their massive anniversary tour to Copenhagen.",
      "This is the definitive celebration of the absolute forefront of electronic music in this city.",
      "Doors 20:00 | Tickets 450 DKK",
    ]);
  });

  it("returns nothing for empty/whitespace input", () => {
    expect(formatDescription(null)).toEqual([]);
    expect(formatDescription("  \n\n ")).toEqual([]);
  });

  it("a trailing heading-shaped line with nothing after it stays plain text", () => {
    expect(render(formatDescription("Some text about the night that runs long enough.\n\nLINEUP"))).toEqual([
      "Some text about the night that runs long enough.",
      "LINEUP",
    ]);
  });
});

describe("formatDescription — link safety", () => {
  it("never links non-http(s) schemes or credentials-bearing URLs", () => {
    const blocks = formatDescription("Try javascript:alert(1) or https://user:pw@evil.example.com/x or ftp://files.example.com");
    const links = blocks.flatMap((b) => (b.type === "paragraph" ? b.lines.flat() : b.content)).filter((t) => t.type === "link");
    expect(links).toEqual([]);
  });

  it("www. links get an https destination; trailing punctuation stays outside the link", () => {
    expect(render(formatDescription("More info at www.vega.dk."))).toEqual(["More info at [vega.dk](https://www.vega.dk/)."]);
  });

  it("keeps the original URL as the destination when a short label is shown", () => {
    const blocks = formatDescription("https://open.spotify.com/playlist/37i9dQZF1DX?si=abc123");
    const link = blocks[0].type === "paragraph" ? blocks[0].lines[0][0] : null;
    expect(link).toEqual({ type: "link", href: "https://open.spotify.com/playlist/37i9dQZF1DX?si=abc123", label: "Listen on Spotify" });
  });

  it("shortens a long unknown URL's label without changing its destination", () => {
    const url = "https://www.example-promoter.com/events/2026/october/some-very-long-event-name-slug";
    const blocks = formatDescription(url);
    const link = blocks[0].type === "paragraph" ? blocks[0].lines[0][0] : null;
    expect(link?.type === "link" && link.href).toBe(url);
    expect(link?.type === "link" && link.label.length).toBeLessThanOrEqual(40);
  });
});
