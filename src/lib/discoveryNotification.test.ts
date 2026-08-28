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

describe("notifyDiscoveryQueueInsert", () => {
  it("sends exactly one email attempt for a new pending row", async () => {
    sendMock.mockResolvedValue({ data: { id: "abc" }, error: null });

    await notifyDiscoveryQueueInsert(baseItem);

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("addresses the notification to DISCOVERY_QUEUE_NOTIFICATION_EMAIL and includes the expected metadata and admin link", async () => {
    sendMock.mockResolvedValue({ data: { id: "abc" }, error: null });

    await notifyDiscoveryQueueInsert(baseItem);

    const call = sendMock.mock.calls[0][0];
    expect(call.to).toBe("discovery@example.com");
    expect(call.from).toBe("Electronic CPH <hello@send.electroniccph.com>");
    expect(call.subject).toBe("Electronic CPH: New Discovery Queue event — Nachtdigital Showcase");
    expect(call.text).toContain("Event title: Nachtdigital Showcase");
    expect(call.text).toContain("Venue name: Culture Box");
    expect(call.text).toContain("Source: src-culture-box");
    expect(call.text).toContain("Predicted genre: Techno");
    expect(call.text).toContain("Genre confidence: high");
    expect(call.text).toContain("Overall confidence: medium");
    expect(call.text).toContain("Missing fields: ticketUrl");
    expect(call.text).toContain("Source URL: https://culture-box.com/events/nachtdigital");
    expect(call.text).toContain("https://electroniccph.com/admin#discovery-queue");
  });

  it("omits rows entirely for unavailable optional metadata rather than rendering filler like 'Unknown' or 'None'", async () => {
    sendMock.mockResolvedValue({ data: { id: "abc" }, error: null });

    await notifyDiscoveryQueueInsert({
      ...baseItem,
      probableStart: null,
      probableVenueName: null,
      predictedGenre: null,
      missingFields: [],
    });

    const call = sendMock.mock.calls[0][0];
    expect(call.text).not.toMatch(/unknown/i);
    expect(call.text).not.toMatch(/none/i);
    expect(call.text).not.toContain("Date/start time:");
    expect(call.text).not.toContain("Venue name:");
    expect(call.text).not.toContain("Predicted genre:");
    expect(call.text).not.toContain("Missing fields:");
    // The always-present fields are unaffected.
    expect(call.text).toContain("Event title: Nachtdigital Showcase");
    expect(call.text).toContain("Source: src-culture-box");
    expect(call.text).toContain("Genre confidence: high");
    expect(call.text).toContain("Overall confidence: medium");
  });

  it("still renders the row when the optional metadata IS available (not omitted just because omission is possible)", async () => {
    sendMock.mockResolvedValue({ data: { id: "abc" }, error: null });

    await notifyDiscoveryQueueInsert(baseItem);

    const call = sendMock.mock.calls[0][0];
    expect(call.text).toContain("Date/start time:");
    expect(call.text).toContain("Venue name: Culture Box");
    expect(call.text).toContain("Predicted genre: Techno");
    expect(call.text).toContain("Missing fields: ticketUrl");
  });

  it("does not send and does not throw when DISCOVERY_QUEUE_NOTIFICATION_EMAIL is unset", async () => {
    process.env.DISCOVERY_QUEUE_NOTIFICATION_EMAIL = "";

    await expect(notifyDiscoveryQueueInsert(baseItem)).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("swallows and logs an email provider failure instead of throwing", async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: "invalid domain" } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(notifyDiscoveryQueueInsert(baseItem)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("dq-abc123");
    errorSpy.mockRestore();
  });

  it("swallows and logs when the Resend API key/sender is missing entirely", async () => {
    process.env.RESEND_API_KEY = "";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(notifyDiscoveryQueueInsert(baseItem)).resolves.toBeUndefined();

    expect(sendMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("never sends an `html` field — plain text only, so markup-like source/event text cannot be rendered as HTML by the recipient's client", async () => {
    sendMock.mockResolvedValue({ data: { id: "abc" }, error: null });

    await notifyDiscoveryQueueInsert({
      ...baseItem,
      probableTitle: '<img src=x onerror=alert(1)> Showcase & "Friends" <script>evil()</script>',
      probableVenueName: "<b>Venue</b>",
      sourceName: "<i>src</i>",
    });

    const call = sendMock.mock.calls[0][0];
    expect(call).not.toHaveProperty("html");
    // The raw text is passed through verbatim as plain text (no escaping
    // needed, since Resend's `text` field is never interpreted as markup).
    expect(call.text).toContain('<img src=x onerror=alert(1)> Showcase & "Friends" <script>evil()</script>');
  });
});

describe("notifyDiscoveryQueueInsertBatch", () => {
  it("sends exactly one attempt per item, for all items", async () => {
    sendMock.mockResolvedValue({ data: { id: "abc" }, error: null });
    const items: DiscoveryQueueNotificationItem[] = Array.from({ length: 8 }, (_, i) => ({
      ...baseItem,
      id: `dq-${i}`,
      probableTitle: `Event ${i}`,
    }));

    await notifyDiscoveryQueueInsertBatch(items);

    expect(sendMock).toHaveBeenCalledTimes(8);
  });

  it("one item's provider failure does not prevent the others from being attempted", async () => {
    sendMock.mockImplementation((call: { subject: string }) => {
      if (call.subject.includes("Event 1 ")) {
        return Promise.resolve({ data: null, error: { message: "rejected" } });
      }
      return Promise.resolve({ data: { id: "abc" }, error: null });
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const items: DiscoveryQueueNotificationItem[] = Array.from({ length: 4 }, (_, i) => ({
      ...baseItem,
      id: `dq-${i}`,
      probableTitle: `Event ${i} `,
    }));

    await expect(notifyDiscoveryQueueInsertBatch(items)).resolves.toBeUndefined();

    expect(sendMock).toHaveBeenCalledTimes(4);
    errorSpy.mockRestore();
  });

  it("does nothing for an empty batch", async () => {
    await notifyDiscoveryQueueInsertBatch([]);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
