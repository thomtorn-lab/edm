import type { FestivalEditionStatus } from "./types";

/** Authoring helpers for FESTIVALS — keeps festivals.ts free of raw discriminated-union literals. */
export const confirmed = (dates: string): FestivalEditionStatus => ({ kind: "confirmed", dates });
export const datesTBA = (): FestivalEditionStatus => ({ kind: "dates-tba" });
export const nextEditionTBA = (): FestivalEditionStatus => ({ kind: "next-edition-tba" });
export const noEdition = (year: number): FestivalEditionStatus => ({ kind: "no-edition", year });
export const cancelled = (): FestivalEditionStatus => ({ kind: "cancelled" });
export const returns = (year: number): FestivalEditionStatus => ({ kind: "returns", year });
export const biennial = (nextYear: number): FestivalEditionStatus => ({ kind: "biennial", nextYear });

/** Renders the one line of date/status copy shown per festival on /festivals. */
export function formatFestivalEdition(edition: FestivalEditionStatus): string {
  switch (edition.kind) {
    case "confirmed":
      return edition.dates;
    case "dates-tba":
      return "Dates TBA";
    case "next-edition-tba":
      return "Next edition TBA";
    case "no-edition":
      return `No ${edition.year} edition`;
    case "cancelled":
      return "Cancelled";
    case "returns":
      return `Returns ${edition.year}`;
    case "biennial":
      return `Biennial · next edition ${edition.nextYear}`;
  }
}
