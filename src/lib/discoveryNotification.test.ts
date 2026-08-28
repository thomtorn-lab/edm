import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { notifyDiscoveryQueueInsert, type DiscoveryQueueNotificationItem } from "./discoveryNotification";

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

  it("falls back to 'Unknown' for missing venue/genre/start and 'None' for empty missing fields", async () => {
    sendMock.mockResolvedValue({ data: { id: "abc" }, error: null });

    await notifyDiscoveryQueueInsert({
      ...baseItem,
      probableStart: null,
      probableVenueName: null,
      predictedGenre: null,
      missingFields: [],
    });

    const call = sendMock.mock.calls[0][0];
    expect(call.text).toContain("Date/start time: Unknown");
    expect(call.text).toContain("Venue name: Unknown");
    expect(call.text).toContain("Predicted genre: Unknown");
    expect(call.text).toContain("Missing fields: None");
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
});
