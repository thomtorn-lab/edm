import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { sendEmail } from "./email";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    RESEND_API_KEY: "test-api-key",
    CONTACT_RECIPIENT_EMAIL: "recipient@example.com",
    CONTACT_FROM_EMAIL: "Electronic CPH <hello@send.electroniccph.com>",
  };
  sendMock.mockReset();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("sendEmail", () => {
  it("sends via Resend using the configured from/to addresses", async () => {
    sendMock.mockResolvedValue({ data: { id: "abc" }, error: null });

    await sendEmail({ subject: "Test subject", text: "Test body", replyTo: "someone@example.com" });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      from: "Electronic CPH <hello@send.electroniccph.com>",
      to: "recipient@example.com",
      subject: "Test subject",
      text: "Test body",
      replyTo: "someone@example.com",
    });
  });

  it("throws when Resend returns an error", async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: "invalid domain" } });

    await expect(
      sendEmail({ subject: "Test", text: "Body", replyTo: "someone@example.com" })
    ).rejects.toThrow(/invalid domain/);
  });

  it("throws without calling Resend when required env vars are missing", async () => {
    process.env.RESEND_API_KEY = "";

    await expect(
      sendEmail({ subject: "Test", text: "Body", replyTo: "someone@example.com" })
    ).rejects.toThrow(/not configured/i);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
