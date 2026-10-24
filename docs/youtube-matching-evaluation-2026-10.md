# YouTube preview matching — false-positive evaluation (2026-10-23)

Analysis only. Nothing here is implemented. It is kept for a later decision on
the automated matcher (`src/lib/enrichment/youtubePreviewMatching.ts`).

## The confirmed false positive

`LMN` was matched to "A Daughter's Conviction | Full Movie | LMN", a film on
the Lifetime Movie Network channel, which is also called "LMN". The matcher
treats a channel as the artist's own **only because the channel name equals
the artist name**. The title also contained the exact name, billed one name,
ran over 20 minutes, and was public and embeddable, so every Rule A check
passed. Nothing checks that the video is music. The cache row is manually
blocked (`manualBlock = true`).

## Rules evaluated

- **A.** On an own-channel match, the title must contain a music/set cue
  (dj set, set, mix, live, b2b, boiler room, radio, podcast, festival,
  showcase, session, concert, closing, `@`, …) **or** start with the artist
  name (name before the first `|`, ` - `, `–`, `—`, `:` or ` @ `).
- **B.** Reject clearly non-music YouTube categories via `snippet.categoryId`.
  This needs no extra quota on the existing `videos.list` call.
- **C.** A negative title list. A *broad* list adds episode, season, film,
  documentary and broadcast to the narrow one. The *narrow* list is: full
  movie, movie, trailer, gameplay, walkthrough, full match, compilation, news.
- **D / D'.** For short names (≤ 4 letters/digits) on their own channel,
  require a cue (D'), or a cue and the name first (D). This grades the
  evidence required for short names; it does not reject them.

## Method and data

The evaluation was run locally and read-only, as a scratch script using the
real `titleContainsExactName` and `countBilledNames`. It covered 38 labelled
title/channel cases:

- the repo's matcher test fixtures, which come from the 2026-09-25 audit;
- the real Production false positives (LMN, Benji B, the Meute warm-up);
- constructed edge cases, including legitimate short names (SNTS, DVS1, HDN,
  avoN, a hypothetical real DJ called "LMN"), legitimate DJ content that uses
  "episode", "season" or "film", and false positives without telltale words.

**Limits:** Production cache evidence was not read; that would need a workflow
run. Category (B) could not be evaluated because `categoryId` is not stored
today. The sample is small and partly constructed, so the figures indicate
direction only.

| Rule set | False accepts (of 13) | Legitimate lost (of 25) |
|---|---|---|
| Current Rule A | 11 | 0 |
| A | 5 | 0 |
| C, broad | 3 | 4 |
| A + broad C (+ D or D') | 1 | 4 |
| A + narrow C | 3 | 0 |
| **A + narrow C + D'** | **2** | **0** |

## Findings

- **A alone catches LMN**, including a variant of the title without
  "Full Movie", because the name only appears as a trailing channel tag.
- **A broad negative list is harmful.** Episode, season and film hit
  legitimate radio shows, podcasts and mix films. Keep C narrow.
- **D' keeps legitimate short names** (SNTS, DVS1, HDN, avoN, a real "LMN")
  while requiring a cue from them.
- **Two cases stay unresolved by title text:** "CNN Live Coverage …" (a
  generic cue word) and "Ooops - Best Of 2024" (name first, five letters).
  These need a non-text signal.
- **Categories (B) are uploader-chosen** and often left at the default
  (People & Blogs). They are usable at most as a reject-only signal for
  clearly non-music categories, never as positive evidence.

## Recommendation, if this is picked up later

1. Implement A + narrow C + D'.
2. Start storing `categoryId` from the existing `videos.list` call, observe it
   only, and do not use it yet.
3. Before switching anything on, replay the new rules read-only against every
   currently accepted cache row's stored evidence and review exactly which
   matches would be lost.
