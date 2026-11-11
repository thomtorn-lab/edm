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
    // A link in the body is followed with GET, which never unsubscribes (link
    // scanners); the manage page has the unsubscribe button. One-click
    // unsubscribe stays in the List-Unsubscribe header (POST).
    `Unsubscribe: ${manageUrl(manageToken)}`,
  ].join("\n");

  const rows = lines
    .map(
      ({ e, url, when }) => `
      <tr><td style="padding:10px 0;border-bottom:1px solid #2a2a2a;">
        <div style="color:#999999;font-size:13px;">${escapeHtml(e.artistName)}</div>
        <div style="font-weight:600;"><a href="${escapeHtml(url)}" style="color:#ab9be0;text-decoration:underline;">${escapeHtml(e.title)}</a></div>
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
      <a href="${escapeHtml(manageUrl(manageToken))}" style="color:#999999;">Unsubscribe</a>
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

export interface ManagePicks {
  artistIds: string[];
  requests: { name: string; profileUrl?: string | null }[];
}

/**
 * Manage link carrying a visitor's not-yet-applied picks (from the public
 * form). Nothing is stored: the picks travel in the link, and the manage page
 * only adds them when the subscriber presses the button there.
 */
export function manageUrlWithPicks(token: string, picks?: ManagePicks): string {
  const base = manageUrl(token);
  if (!picks || (picks.artistIds.length === 0 && picks.requests.length === 0)) return base;
  const parts = [base];
  if (picks.artistIds.length) parts.push(`add=${picks.artistIds.map(encodeURIComponent).join(",")}`);
  if (picks.requests.length) {
    const json = JSON.stringify(picks.requests.map((r) => ({ name: r.name, profileUrl: r.profileUrl ?? null })));
    parts.push(`req=${Buffer.from(json, "utf8").toString("base64url")}`);
  }
  return parts.join("&");
}

/** Reads the picks back on the manage page; anything malformed is ignored. */
export function decodeRequestPicks(raw: string | undefined): unknown {
  if (!raw || raw.length > 4000) return [];
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return [];
  }
}

/** Manage link for a confirmed subscriber (public form used again, or "Manage Artist Alerts"). */
export function buildManageLinkEmail(input: { manageToken: string; picks?: ManagePicks }): EmailContent {
  const url = manageUrlWithPicks(input.manageToken, input.picks);
  const withPicks = !!input.picks && input.picks.artistIds.length + input.picks.requests.length > 0;
  const lead = withPicks ? "Open your artist alerts to add the artists you just picked:" : "Manage the artists you follow on Electronic CPH:";
  const text = [lead, url, "", "If you didn't ask for this, you can ignore this email."].join("\n");
  const html = `<!doctype html><html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;">
<p>${escapeHtml(lead)}</p>
<p><a href="${escapeHtml(url)}">Manage your artist alerts</a></p>
<p style="color:#666;font-size:12px;">If you didn't ask for this, you can ignore this email.</p>
</body></html>`;
  return { subject: "Your Electronic CPH artist alerts", html, text };
}

/** One result email per requester when an admin approves or rejects a requested artist. */
export function buildRequestResultEmail(input: { artistName: string; approved: boolean; manageToken: string }): EmailContent {
  const url = manageUrl(input.manageToken);
  const name = input.artistName;
  const subject = input.approved ? `You're now following ${name}` : `We couldn't add ${name}`;
  const body = input.approved
    ? [`Your artist request has been approved. You're now following ${name} on Electronic CPH.`, "", `We'll email you when new events featuring ${name} are added.`]
    : [`We couldn't approve your request for ${name}, so you won't get alerts for it.`];
  const text = [...body, "", `Manage your artist alerts: ${url}`].join("\n");
  const html = `<!doctype html><html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;">
${body.filter(Boolean).map((l) => `<p>${escapeHtml(l)}</p>`).join("\n")}
<p><a href="${escapeHtml(url)}">Manage your artist alerts</a></p>
</body></html>`;
  return { subject, html, text };
}

/** To the site's own inbox when a request first gets a confirmed requester. */
export function buildAdminRequestEmail(input: { requests: { displayName: string; profileUrl: string | null }[] }): EmailContent {
  const lines = input.requests.map((r) => `- ${r.displayName}${r.profileUrl ? ` (${r.profileUrl})` : ""}`);
  const text = ["New artist request on Electronic CPH:", "", ...lines, "", `Review it: ${SITE_URL}/admin/artists`].join("\n");
  return { subject: `Artist request: ${input.requests.map((r) => r.displayName).join(", ")}`, html: "", text };
}

/** To the site's own inbox when a followed artist's new appearance needs an admin (e.g. a short name). */
export function buildAdminReviewEmail(input: { items: { eventTitle: string; displayName: string; reason: string | null }[]; holdMinutes?: number }): EmailContent {
  const lines = input.items.map((i) => `- ${i.displayName} at ${i.eventTitle}${i.reason ? ` (${i.reason})` : ""}`);
  const text = [
    "A followed artist was just listed, but the match needs a check before anyone is alerted:",
    "",
    ...lines,
    "",
    `Confirm or reject within ${input.holdMinutes ?? 120} minutes, or followers won't get an alert for it: ${SITE_URL}/admin/artists`,
  ].join("\n");
  return { subject: `Artist check needed: ${[...new Set(input.items.map((i) => i.displayName))].join(", ")}`, html: "", text };
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
