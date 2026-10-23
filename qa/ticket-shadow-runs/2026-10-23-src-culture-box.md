# Ticket-replacement shadow: Culture Box, 2026-10-23

Godkendt enkeltkørsel (thomtorn-lab/edm#156). Rå rapport: `2026-10-23-src-culture-box.json`.
Den er transskriberet fra jobloggens REPORT JSON-linje, og alle 18 `decisionId` er genberegnet og stemmer.

## Kørslen
| | |
|---|---|
| Workflow | `inspect-source.yml`, mode `ticket-replacement-shadow`, `source_id=src-culture-box` |
| Run / job | [39958996095](https://github.com/thomtorn-lab/edm/actions/runs/39958996095) / 120431918630, `success` |
| Kode | `8f8598b` (PR-branchens head, ikke merget) |
| Tidspunkt | 2026-10-23 13:10:36 UTC, ca. 12 s live-hentning |
| Database | Én `BEGIN READ ONLY`-transaktion. Kun SELECT på `venues`, `events` og `source_event_links`, derefter ROLLBACK. |
| Netværk | Kun culture-box.com. 0 RA-forespørgsler forsøgt (`residentAdvisorRequestsRefused: 0`). Ingen Discogs. |
| Andre workflows | Ingen udløst. Artefakt-upload sprunget over. `.env.local` slettet. |

## Resultat
| Mål | Antal |
|---|---|
| Kandidater hentet fra Culture Box (fuldstændig hentning) | 18 |
| Matchet til et eksisterende event af en rigtig sync | 18, alle `linked` via Culture Box' egen registrerede event-URL |
| Uden match / matchet til tidligere events | 0 / 0 |
| `confirm` (samme billetlink som det lagrede) | 18 |
| `would_replace` | 0 |
| `withheld` | 0, derfor ingen årsager at fordele |
| `fill` / `no_change` | 0 / 0 |

Alle 18 indkommende billetlinks er en `https://ra.co/events/<id>`-side fra Culture Box' egen "Tickets"-knap. Alle er identiske med det lagrede `ticket_url`.

## Svar på de konkrete spørgsmål
- **Ændrede billetlinks blandt `would_replace`:** 0. Der var ingen `would_replace`, og ingen af de 18 events har et afvigende billetlink i dag.
- **Tilstrækkelig dokumentation for samme event:** Kan ikke besvares med skyggetilstandens egne identitetskontroller. Ved `confirm` stopper beslutningen, før identiteten vurderes (`identity: null`), fordi intet skal erstattes. Det eneste, data viser, er, at alle 18 er matchet `linked` via kildens egen registrerede URL.
- **Kræver fortsat manuel vurdering:** 0 beslutninger. Label-skabelonen er tom.
- **Falske positive:** Ingen mulige, fordi der er 0 `would_replace`.
- **Tvetydige matches:** Ingen rapporteret. Uden afvigende links blev konkurrence-kontrollen ikke kørt.
- **Sikkerhedsproblemer:** Ingen fundet.

## Iagttagelser (ingen handling)
- `e-41440270`: lagret titel "IBOGA RECORDS and SOFA BEATS", Culture Box' titel er "Black Box: TICON, EMOK, ZORA, UMLOUD · Red Box: TIM ANDRESEN, ALEXANDER DESCROIX". Matchet `linked` med samme RA-billetlink. Det er en titelforskel, ikke et billetlinkproblem. Det kan ikke ses i rapporten, om titlen er en admin-override.
- `e-e3bd3ab9`: kun tegnsætning afviger ("NECKLESS: HALLOWEEN EDITION").

## Hvad kørslen beviser, og hvad den ikke beviser
- Den beviser, at tilstanden kører read-only mod Production og kun henter Culture Box. Den beviser også, at Culture Box i dag ikke har nogen afvigende billetlinks for kommende events.
- Den giver **ingen evidens** for erstatningsreglens præcision. Der er 0 `would_replace` og 0 `withheld`, så der er intet at mærke, og hverken falske positive eller falske negative kan måles.
