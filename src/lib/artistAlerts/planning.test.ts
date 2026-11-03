import { describe, expect, it } from "vitest";
import { alertTiming } from "./config";
import { planEmail, withinSendingHours, type PendingDelivery } from "./planning";

const timing = alertTiming({});
const NOON = new Date("2026-11-02T11:00:00Z"); // 12:00 Copenhagen
const h = (n: number) => new Date(NOON.getTime() + n * 3_600_000);
const d = (o: Partial<PendingDelivery> & { eventId: string }): PendingDelivery => ({
  createdAt: h(-1),
  startDatetime: h(48),
  eventPublic: true,
  appearanceAlertable: true,
  ...o,
});

describe("planEmail", () => {
  it("defaults: 2h hold, at most 2 emails a day", () => {
    expect(timing.holdMs).toBe(2 * 3_600_000);
    expect(timing.maxEmailsPerDay).toBe(2);
    expect(alertTiming({ ALERT_HOLD_MINUTES: "30", ALERT_MAX_EMAILS_PER_DAY: "1" })).toMatchObject({ holdMs: 30 * 60_000, maxEmailsPerDay: 1 });
  });

  it("batches pending events into one email, soonest first", () => {
    expect(planEmail([d({ eventId: "late", startDatetime: h(100) }), d({ eventId: "soon", startDatetime: h(10) })], 0, NOON, timing)).toEqual({ send: ["soon", "late"], drop: [] });
  });

  it("drops events that are past or too close, cancelled, removed from the lineup, or waited too long", () => {
    const plan = planEmail(
      [
        d({ eventId: "ok" }),
        d({ eventId: "starts-in-2h", startDatetime: h(2) }),
        d({ eventId: "past", startDatetime: h(-3) }),
        d({ eventId: "unpublished", eventPublic: false }),
        d({ eventId: "artist-removed", appearanceAlertable: false }),
        d({ eventId: "stale", createdAt: h(-80) }),
      ],
      0,
      NOON,
      timing,
    );
    expect(plan.send).toEqual(["ok"]);
    expect(plan.drop.sort()).toEqual(["artist-removed", "past", "stale", "starts-in-2h", "unpublished"]);
  });

  it("holds everything back at the daily limit and outside sending hours, but still drops irrelevant ones", () => {
    expect(planEmail([d({ eventId: "a" }), d({ eventId: "past", startDatetime: h(-1) })], 2, NOON, timing)).toEqual({ send: [], drop: ["past"] });
    const night = new Date("2026-11-02T23:30:00Z"); // 00:30 Copenhagen
    expect(withinSendingHours(night)).toBe(false);
    expect(planEmail([d({ eventId: "a", startDatetime: new Date(night.getTime() + 86_400_000), createdAt: night })], 0, night, timing).send).toEqual([]);
  });

  it("caps events per email", () => {
    const many = Array.from({ length: 12 }, (_, i) => d({ eventId: `e${i}`, startDatetime: h(10 + i) }));
    expect(planEmail(many, 0, NOON, timing).send).toHaveLength(10);
  });
});
