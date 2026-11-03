# SoundCloud evidence: local pilot (2026-10-31)

What the source-provided SoundCloud evidence (`src/lib/soundcloudEvidence/`)
concludes for a fixed set of artists across sources, combined with the shared
identity rules Artist Alerts owns (`classifyAppearance`,
`evidenceBacksAppearance`). Local only: no database, no network, no
SoundCloud lookup, nothing stored.

**Input:**
- Culture Box and Hangaren: the recorded pages in
  `src/lib/adapters/__fixtures__`, through the real parsers.
- Other sources: the 102 published events from the read-only window audits
  of 2026-10-16. Their descriptions are truncated in those logs, so inline
  evidence there is a lower bound.

**Outcome column:**
- **linked (source):** the event's own source links this performer; the
  model may mark the appearance "high".
- **candidate → model reuse rule:** a verified handle for the same
  distinctive key exists on another event. It is a proposal only; the
  shared model applies its reuse rule.
- **review (conflict):** the evidence is contradictory or belongs to a
  duo/collective; it never links.
- **no SoundCloud evidence:** nothing in the source data. These need the
  later candidate-only signals (RA chain, Discogs URL), which require
  separate approval.

| Artist | Source | Identity (bucket/confidence) | SoundCloud evidence | Outcome |
|---|---|---|---|---|
| Rexie Lex | admin | distinct/high | reuse candidate: rexie_lex | candidate → model reuse rule |
| Eusherr | Hangaren | distinct/high | reuse candidate: eusherr | candidate → model reuse rule |
| B From E | Hangaren | distinct/high | reuse candidate: bfrome | candidate → model reuse rule |
| Halfdan Sandquist | Pylonen | distinct/high | reuse candidate: halfdan-sandquist | candidate → model reuse rule |
| PAB DISCO | Culture Box | handle/high | source_anchor: jonas-jagd | linked (source); **alias, check manually** |
| DJ 2LATE | Culture Box | handle/high | source_anchor: dj2late_cph | linked (source) |
| mirr | Pylonen | handle/high | source_inline: mirulstrup | linked (source) |
| SEID | Pylonen | handle/high | source_inline: seid1312 | linked (source); short name, own source link |
| L.A.D.J. | Pylonen | handle/high | source_inline: darealadj | linked (source) |
| Small Horse | Pylonen | handle/high | source_inline: small-horse | linked (source) |
| Kromagon | Hangaren | handle/high | source_inline: aragon | linked (source); **alias, check manually** |
| Krypto | Hangaren | handle/high | source_inline: psykrypp | linked (source) |
| Lulla-Li & Nihility | Hangaren | weak_split/review | two links, entry_not_single_artist | review (conflict) |
| LELE / LeLe | Culture Box | short_generic/review | two profiles, two_handles_same_key | review (conflict) |
| BONGO & PUSK | Culture Box | weak_split/review | source_anchor, entry_not_single_artist | review (conflict) |
| MSW COLLECTIVE | Culture Box | event_marker/review | source_anchor, entry_not_single_artist | review (conflict) |
| Nico Moreno | Poolen | title_copy/pending_decision | none | no SoundCloud evidence |
| Silva Bumpa | Pumpehuset | distinct/high | none | no SoundCloud evidence |
| Chris Luno | admin | distinct/high | none | no SoundCloud evidence |
| Kasper Bjørke | HvadErPå | distinct/high | none | no SoundCloud evidence |
| Anastasia Kristensen | HvadErPå | distinct/high | none | no SoundCloud evidence |
| SkA, HP | admin | short_generic/review | none | no SoundCloud evidence |
| NAT, YOON (B2B parts) | Pylonen | short_generic/review | none | no SoundCloud evidence |
| Special guest: Myd | Pumpehuset | event_marker/review | none | no SoundCloud evidence |

## Findings

- **No wrong link:** none of the selected names gets a link the source
  itself didn't give. Every duo, collective, short name without its own
  source link and key conflict ends in review.
- **Aliases** (PAB DISCO → jonas-jagd, Kromagon → aragon) come straight from
  the venue's own link, the strongest signal, but should be checked by hand
  in the pilot before they count as verified.
- **The source's own links cover little outside Culture Box:** 4 inline
  plus 9 reuse candidates among 208 performers in the sample. Well-known
  names from Poolen, Pumpehuset, HvadErPå and admin events have no evidence
  in source data at all.
- **Admin-created events:** they have no canonical source. Their text is
  attributed to `"admin"` with the candidate-only `admin_inline` signal
  (the shared model's decision): it goes to review and never links on its
  own, because pasted promoter text is not the venue's own statement.
