# Ticket-replacement shadow: lokal simulering, 2026-10-23 (SYNTETISK)

> **Syntetiske ændringer, ikke Production-observationer.** Resultaterne viser, at reglen opfører sig som designet på konstruerede tilfælde. De er **ikke** dokumentation for præcision på virkelige afvigelser.
>
> Den eneste Production-observation til dato er Culture Box-kørslen 2026-10-23: 18 af 18 `confirm` (`2026-10-23-src-culture-box.md`).

## Metode
- **Grunddata:** de committede, rigtige Culture Box-sider (listeside og 15 detaljesider i `src/lib/adapters/__fixtures__`). De køres gennem den rigtige adapter og pipeline.
- **Lagrede events:** For hver nat bygges det event, en sync ville have gemt.
  - Baseline: 15 af 15 `confirm`. Det svarer til Production-kørslen.
- **Scenarier:** Hvert scenarie ændrer én ting syntetisk. Facit er kendt på forhånd: skal linket erstattes eller ej?
  - Hele den read-only runner køres: sync-match (link eller dedup), derefter skyggebeslutningen.
- **Tællinger:**
  - Falsk positiv (FP): `would_replace` hvor facit er "behold".
  - Falsk negativ (FN): alt andet end `would_replace` hvor facit er "erstat".
- **Placering:** `src/db/ticketReplacementShadow.simulation.test.ts` (permanent regressionskorpus).

## Resultat
| | Facit: erstat | Facit: behold |
|---|---|---|
| `would_replace` | 4 (TP) | **0 (FP)** |
| andet udfald | 4 (FN) | 8 (TN) |

To fejl blev fundet og rettet i samme commit (se nederst). Før rettelsen gav S7 én falsk positiv, og S14 blev fejlrapporteret som `fill`.

## Beslutninger
| # | Situation | Facit | Udfald / årsag | Vurdering |
|---|---|---|---|---|
| S1 | Linket event. Lagret: gammelt Tickster-link fra en aggregator. Culture Box: nattens RA-side | erstat | `would_replace` (strong: linked + lineup + titel) | TP |
| S2 | Linket event. Forældet RA-id | erstat | `would_replace` | TP |
| S3 | Event oprettet af anden kilde, samme titel og lineup, Billetto-link, intet link fra Culture Box | erstat | `would_replace` (strong: lineup + titel, intet anker) | TP |
| S4 | Som S3, men anden titel | erstat | ikke vurderet: syncen matcher slet ikke | FN (på sync-niveau) |
| S5 | Fre og lør deler et weekendpas-link. Culture Box giver fredag sin egen RA-side | erstat | `withheld: stored_ticket_shared` | FN (konservativ, kræver redaktør) |
| S6 | Culture Box' fredagsknap peger fejlagtigt på lørdagens RA-side | behold | `withheld: shared_ticket_page` | TN |
| S7 | Lagrede rum-events (`#black-box` / `#red-box`). Culture Box viser hele natten som ét event | behold | `withheld: room_scope_mismatch` | TN (var FP før rettelse) |
| S8 | Red Box-listing, hvis kildelink fejlagtigt peger på Black Box-eventet | behold | `withheld: room_conflict` | TN |
| S9 | Linket event, lagret en uge tidligere (flyttet) | behold | `withheld: moved_event` | TN |
| S10 | Natsiden linket til en tidlig koncert kl. 18. Klubnatten starter kl. 22 | behold | `withheld: multiple_shows_same_evening` | TN |
| S11 | Natten findes to gange (egen og aggregator-dublet). Kandidaten er linket til den egne | erstat | `withheld: ambiguous_match` | FN (konservativ) |
| S12 | Andet event samme aften (marked) har nattens RA-side som billetlink. Culture Box skiftede til Tickster | behold | `withheld: ticket_url_only_identity` | TN |
| S13 | Admin har sat linket manuelt | behold | `withheld: override` | TN |
| S14 | Admin har ryddet linket | behold | `withheld: override` | TN (var `fill` før rettelse) |
| S15 | Linket event, hvor RA-siden også er billetlink. Culture Box skiftede til Tickster | erstat | `would_replace` (RA-ankeret blev kasseret, linked + lineup + titel bar) | TP |
| S16 | Aggregator-stub (generisk titel, ingen lineup, RA som både RA og billetlink, intet kildelink). Culture Box skiftede til Tickster | erstat | `withheld: ticket_url_only_identity` | FN (konservativ) |

Hver beslutning har identitetskontroller og en trin-for-trin-begrundelse. Testen kan gemme dem som JSON (`SHADOW_SIM_OUT=<fil>`).

## Fejl fundet og rettet (kun i #156, ingen Production-effekt)
1. **Ryddet link rapporteret som `fill`** (S14). Overstyringen blev tjekket efter `fill` og `confirm`.
   - Nu kontrolleres den først. Et admin-ryddet eller admin-sat link giver altid `withheld: override`.
2. **Hel nat mod rum-event gav falsk positiv** (S7). Culture Box angiver rum i URL-fragmentet (`#black-box`), ikke i `sub_venue`. Når kun én side kendte et rum, var rumkontrollen "unknown".
   - Rummet læses nu også fra fragmentet. Det er samme signal som dedups `roomIdentityConflict`.
   - Den nye kontrol `roomScope` tilbageholder med `room_scope_mismatch`, når kun den ene side er et rum.

## Begrænsninger
- Facit er konstrueret. Det er ikke en redaktørs vurdering af virkelige events.
- Kun Culture Box-data og Culture Box som officiel kilde er brugt.
- Scenarierne er valgt til at ramme kendte risici. De siger intet om, hvor ofte situationerne forekommer.
- FN-tallet afspejler bevidst konservative regler (S5, S11, S16) og en sync, der slet ikke matcher (S4).
