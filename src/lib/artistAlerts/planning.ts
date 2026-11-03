import { getCopenhagenParts } from "../datetime";
import type { AlertTiming } from "./config";

/**
 * Pure rules for which pending deliveries go into an email now (Artist
 * Alerts, 2026-11-02). The database layer (src/db/artistAlerts.ts) supplies
 * the rows and writes the outcome.
 */

export interface PendingDelivery {
  eventId: string;
  createdAt: Date;
  startDatetime: Date;
  /** Event still publicly listed and not cancelled. */
  eventPublic: boolean;
  /** The appearance is still in the lineup with alertable confidence. */
  appearanceAlertable: boolean;
}

export interface EmailPlan {
  /** Deliveries to put in the next email, soonest event first. */
  send: string[];
  /** Deliveries no longer worth sending (past, cancelled, removed, too old). */
  drop: string[];
}

/** Emails are only composed 08:00–22:00 Copenhagen time. */
export function withinSendingHours(now: Date): boolean {
  const h = getCopenhagenParts(now).hour;
  return h >= 8 && h < 22;
}

export function planEmail(deliveries: PendingDelivery[], emailsInLast24h: number, now: Date, timing: AlertTiming): EmailPlan {
  const drop: string[] = [];
  const keep: PendingDelivery[] = [];
  for (const d of deliveries) {
    const tooSoon = d.startDatetime.getTime() - now.getTime() < timing.minLeadMs;
    const tooOld = now.getTime() - d.createdAt.getTime() > timing.maxDeliveryAgeMs;
    if (!d.eventPublic || !d.appearanceAlertable || tooSoon || tooOld) drop.push(d.eventId);
    else keep.push(d);
  }
  if (keep.length === 0 || emailsInLast24h >= timing.maxEmailsPerDay || !withinSendingHours(now)) return { send: [], drop };
  keep.sort((a, b) => a.startDatetime.getTime() - b.startDatetime.getTime());
  return { send: keep.slice(0, timing.maxEventsPerEmail).map((d) => d.eventId), drop };
}
