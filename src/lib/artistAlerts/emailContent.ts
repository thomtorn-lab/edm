import { formatRowDateLabel, formatTimeLabel } from "../format";
import { SITE_URL } from "../siteUrl";
import { ARTIST_ALERTS_CONSENT_PURPOSE } from "./config";

/**
 * Artist Alerts email bodies. Plain and short on purpose: the email names
 * the artist, the event, date and venue, and links to the event page — the
 * site, not the email, is where the event is shown. No images, no tracking.
 */

export function manageUrl(token: string): string {
  return `${SITE_URL}/artists/manage?token=${token}`;
}

/** One-click unsubscribe target (List-Unsubscribe + RFC 8058 POST). */
export function unsubscribeUrl(token: string): string {
  return `${SITE_URL}/api/artist-alerts/unsubscribe?token=${token}`;
}

export function confirmUrl(token: string): string {
  return `${SITE_URL}/artists/confirm?token=${token}`;
}

export function eventUrl(slug: string): string {
  return `${SITE_URL}/events/${slug}?utm_source=artist-alert&utm_medium=email`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface AlertEmailEvent {
  artistName: string;
  title: string;
  slug: string;
  startDatetime: Date;
  venueName: string;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export function buildAlertEmail(input: { events: AlertEmailEvent[]; manageToken: string }): EmailContent {
  const { events, manageToken } = input;
  const artistNames = [...new Set(events.map((e) => e.artistName))];
  const subject =
    events.length === 1
      ? `${events[0].artistName} — new event in Copenhagen`
      : `New events with ${artistNames.slice(0, 2).join(" and ")}${artistNames.length > 2 ? " and more" : ""}`;

  const lines = events.map((e) => ({
    e,
    url: eventUrl(e.slug),
    when: `${formatRowDateLabel(e.startDatetime.toISOString())} ${formatTimeLabel(e.startDatetime.toISOString())}`,
  }));

  const text = [
    "New on Electronic CPH for an artist you follow:",
    "",
    ...lines.flatMap(({ e, url, when }) => [`${e.artistName}: ${e.title}`, `${when} · ${e.venueName}`, url, ""]),
    `Change your artists: ${manageUrl(manageToken)}`,
    `Unsubscribe: ${unsubscribeUrl(manageToken)}`,
  ].join("\n");

  const rows = lines
    .map(
      ({ e, url, when }) => `
      <tr><td style="padding:10px 0;border-bottom:1px solid #2a2a2a;">
        <div style="color:#999999;font-size:13px;">${escapeHtml(e.artistName)}</div>
        <div style="font-weight:600;"><a href="${escapeHtml(url)}" style="color:#f5f5f5;text-decoration:none;">${escapeHtml(e.title)}</a></div>
        <div style="color:#999999;font-size:13px;margin-top:2px;">${escapeHtml(when)} &middot; ${escapeHtml(e.venueName)}</div>
      </td></tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#0a0a0a;color:#f5f5f5;font-family:-apple-system,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <tr><td style="font-size:15px;padding-bottom:8px;">New on Electronic CPH for an artist you follow:</td></tr>
    ${rows}
    <tr><td style="padding-top:20px;color:#999999;font-size:12px;">
      <a href="${escapeHtml(manageUrl(manageToken))}" style="color:#999999;">Change your artists</a> &middot;
      <a href="${escapeHtml(unsubscribeUrl(manageToken))}" style="color:#999999;">Unsubscribe</a>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

export function buildConfirmEmail(input: { confirmToken: string; artistNames: string[] }): EmailContent {
  const url = confirmUrl(input.confirmToken);
  const names = input.artistNames.slice(0, 10).join(", ") + (input.artistNames.length > 10 ? ", …" : "");
  const text = [
    ARTIST_ALERTS_CONSENT_PURPOSE,
    "",
    names ? `Artists: ${names}` : "",
    "",
    "Confirm your artist alerts:",
    url,
    "",
    "If you didn't request this, ignore this email — nothing happens unless you confirm.",
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;">
<p>${escapeHtml(ARTIST_ALERTS_CONSENT_PURPOSE)}</p>
${names ? `<p>Artists: ${escapeHtml(names)}</p>` : ""}
<p><a href="${escapeHtml(url)}">Confirm your artist alerts</a></p>
<p style="color:#666;font-size:12px;">If you didn't request this, ignore this email — nothing happens unless you confirm.</p>
</body></html>`;
  return { subject: "Confirm your Electronic CPH artist alerts", html, text };
}

/** A requester's identification link: a SoundCloud profile or a Spotify artist page, normalised; anything else is refused. Never fetched. */
export function normalizeProfileUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const v = raw.trim();
  const sc = /^https?:\/\/(?:www\.|m\.)?soundcloud\.com\/([A-Za-z0-9_-]{2,64})\/?(?:[?#].*)?$/i.exec(v);
  if (sc) return `https://soundcloud.com/${sc[1].toLowerCase()}`;
  const sp = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?artist\/([A-Za-z0-9]{22})(?:[/?#].*)?$/.exec(v);
  if (sp) return `https://open.spotify.com/artist/${sp[1]}`;
  return null;
}
