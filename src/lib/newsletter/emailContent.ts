import type { EventWithVenue } from "../queries";
import { formatRowDateLabel, formatTimeLabel } from "../format";
import { displayGenres, getMainGenre, type GenreSlug, type MainGenreSlug } from "../taxonomy";

/**
 * Same constant EventRow.tsx defines locally for its own absolute event
 * URLs (no shared export exists for it in this codebase) — kept identical
 * rather than introducing a new shared constant for one more call site.
 */
const SITE_URL = "https://electroniccph.com";

export interface NewsletterEmailContent {
  subject: string;
  html: string;
  text: string;
}

export function buildManageUrl(manageToken: string): string {
  return `${SITE_URL}/newsletter/manage?token=${manageToken}`;
}

/** Target for both the in-body "Unsubscribe" link and the List-Unsubscribe header (RFC 8058 one-click) — see src/app/api/newsletter/unsubscribe/route.ts, which accepts POST with no further confirmation. */
export function buildUnsubscribeUrl(manageToken: string): string {
  return `${SITE_URL}/api/newsletter/unsubscribe?token=${manageToken}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Builds the full subject/html/text for one subscriber's weekly digest.
 * Pure — takes the already-selected, already-capped event list (see
 * selectEventsForSubscriber in eventSelection.ts) and the subscriber's own
 * genre selection for the scope line; does no DB/network I/O itself, and
 * its output is exactly what db/newsletter.ts snapshots into
 * newsletter_sends.payload* at queue time (see that module's own doc
 * comment for why the payload is frozen rather than recomputed on retry).
 *
 * Deliberately plain: no hero image, no branded template, no analytics
 * pixel — "prioritise usefulness over elaborate design" / "do not build an
 * editorial newsletter system" (product brief). Dark, restrained styling
 * mirrors the site's own look without trying to be a pixel-perfect email
 * reproduction of it.
 */
export function buildNewsletterEmail(input: {
  genres: MainGenreSlug[];
  events: EventWithVenue[];
  manageToken: string;
}): NewsletterEmailContent {
  const { genres, events, manageToken } = input;
  const manageUrl = buildManageUrl(manageToken);
  const unsubscribeUrl = buildUnsubscribeUrl(manageToken);
  const scopeLabel = genres.length === 0 ? "All genres" : genres.map((g) => getMainGenre(g).label).join(", ");
  const subject = "This week in Copenhagen electronic music";

  const rows = events.map((event) => ({
    event,
    url: `${SITE_URL}/events/${event.slug}`,
    dateLabel: formatRowDateLabel(event.startDatetime),
    timeLabel: formatTimeLabel(event.startDatetime),
    genreLabel: displayGenres(event.subgenres as GenreSlug[]).map((g) => g.label).join(" · "),
    soldOutSuffix: event.soldOut ? " (Sold out)" : "",
  }));

  const htmlRows = rows
    .map(
      ({ event, url, dateLabel, timeLabel, genreLabel, soldOutSuffix }) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #2a2a2a;">
          <div style="font-weight:600;color:#f5f5f5;">
            <a href="${escapeHtml(url)}" style="color:#f5f5f5;text-decoration:none;">${escapeHtml(event.title)}</a>${soldOutSuffix}
          </div>
          <div style="color:#999999;font-size:13px;margin-top:2px;">
            ${escapeHtml(dateLabel)} ${escapeHtml(timeLabel)} &middot; ${escapeHtml(event.venue.name)}${genreLabel ? ` &middot; ${escapeHtml(genreLabel)}` : ""}
          </div>
        </td>
      </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#0a0a0a;color:#f5f5f5;font-family:-apple-system,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <tr><td>
      <div style="font-weight:700;letter-spacing:0.02em;text-transform:uppercase;font-size:14px;">Electronic CPH</div>
      <div style="color:#999999;font-size:13px;margin-top:4px;">This week &middot; ${escapeHtml(scopeLabel)}</div>
      <table role="presentation" width="100%" style="margin-top:16px;border-collapse:collapse;">${htmlRows}</table>
      <div style="margin-top:24px;color:#777777;font-size:12px;line-height:1.6;">
        <a href="${escapeHtml(manageUrl)}" style="color:#999999;">Manage preferences</a>
        &middot;
        <a href="${escapeHtml(unsubscribeUrl)}" style="color:#999999;">Unsubscribe</a>
      </div>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `Electronic CPH — This week (${scopeLabel})`,
    "",
    ...rows.flatMap(({ event, url, dateLabel, timeLabel, genreLabel, soldOutSuffix }) => [
      `${event.title}${soldOutSuffix}`,
      `${dateLabel} ${timeLabel} · ${event.venue.name}${genreLabel ? ` · ${genreLabel}` : ""}`,
      url,
      "",
    ]),
    `Manage preferences: ${manageUrl}`,
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");

  return { subject, html, text };
}
