export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** e.g. "kasst-culture-box-copenhagen-2026-09-19" */
export function eventSlug(title: string, venueName: string, startDatetime: string, city = "copenhagen"): string {
  const dateKey = startDatetime.slice(0, 10); // YYYY-MM-DD, wall-clock as stored
  return `${slugify(title)}-${slugify(venueName)}-${slugify(city)}-${dateKey}`;
}
