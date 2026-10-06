import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import {
  notifyDiscoveryQueueInsert,
  notifyDiscoveryQueueInsertBatch,
  type DiscoveryQueueNotificationItem,
} from "./discoveryNotification";

const ORIGINAL_ENV = process.env;

const baseItem: DiscoveryQueueNotificationItem = {
  id: "dq-abc123",
  probableTitle: "Nachtdigital Showcase",
  probableStart: new Date("2026-09-12T22:00:00Z"),
  probableVenueName: "Culture Box",
  sourceName: "src-culture-box",
  sourceUrl: "https://culture-box.com/events/nachtdigital",
  predictedGenre: "techno",
  genreConfidence: "high",
  overallConfidence: "medium",
  missingFields: ["ticketUrl"],
};

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    RESEND_API_KEY: "test-api-key",
    CONTACT_FROM_EMAIL: "Electronic CPH <hello@send.electroniccph.com>",
    DISCOVERY_QUEUE_NOTIFICATION_EMAIL: "discovery@example.com",
  };
  sendMock.mockReset();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

// Discovery Queue new-row email notifications were deliberately disabled
// (2026-10-06, no longer wanted) — notifyDiscoveryQueueInsert/Batch are now
// unconditional no-ops. These tests confirm that holds regardless of
// DISCOVERY_QUEUE_NOTIFICATION_EMAIL being set, regardless of item content,
// and that both functions still never throw (sync.ts and the admin "Add
// event from URL" route call them unconditionally and must not break).

describe("notifyDiscoveryQueueInsert (disabled, 2026-10-06)", () => {
  it("never sends an email, even with DISCOVERY_QUEUE_NOTIFICATION_EMAIL configured", async () => {
    await notifyDiscoveryQueueInsert(baseItem);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("resolves without throwing", async () => {
    await expect(notifyDiscoveryQueueInsert(baseItem)).resolves.toBeUndefined();
  });

  it("never sends regardless of RESEND_API_KEY/sender configuration either", async () => {
    process.env.RESEND_API_KEY = "";
    await expect(notifyDiscoveryQueueInsert(baseItem)).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("notifyDiscoveryQueueInsertBatch (disabled, 2026-10-06)", () => {
  it("never sends any email for a batch of items", async () => {
    const items: DiscoveryQueueNotificationItem[] = Array.from({ length: 8 }, (_, i) => ({
      ...baseItem,
      id: `dq-${i}`,
      probableTitle: `Event ${i}`,
    }));

    await notifyDiscoveryQueueInsertBatch(items);

    expect(sendMock).not.toHaveBeenCalled();
  });

  it("resolves without throwing for an empty batch", async () => {
    await expect(notifyDiscoveryQueueInsertBatch([])).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });
});
