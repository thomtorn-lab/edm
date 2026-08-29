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

  // Post-launch QA follow-up (2026-08-29): Production discovery-notification
  // send failures traced to email.ts, confirming/proving the explicit-`to`
  // path's actual behavior rather than assuming it.
  describe("explicit `to` (Discovery Queue notification and any similar caller)", () => {
    it("sends using the explicit `to`, even with CONTACT_RECIPIENT_EMAIL unset — an explicit recipient never requires it", async () => {
      delete process.env.CONTACT_RECIPIENT_EMAIL;
      sendMock.mockResolvedValue({ data: { id: "abc" }, error: null });

      await sendEmail({ subject: "New row", text: "Body", to: "discovery@example.com" });

      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: "discovery@example.com" }),
      );
    });

    it("still throws (never calls Resend) when RESEND_API_KEY is missing, even with an explicit `to`", async () => {
      process.env.RESEND_API_KEY = "";

      await expect(
        sendEmail({ subject: "New row", text: "Body", to: "discovery@example.com" }),
      ).rejects.toThrow(/RESEND_API_KEY/);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("still throws (never calls Resend) when CONTACT_FROM_EMAIL is missing, even with an explicit `to`", async () => {
      delete process.env.CONTACT_FROM_EMAIL;

      await expect(
        sendEmail({ subject: "New row", text: "Body", to: "discovery@example.com" }),
      ).rejects.toThrow(/CONTACT_FROM_EMAIL/);
      expect(sendMock).not.toHaveBeenCalled();
    });
  });

  describe("default recipient path (no `to` given — /contact, /suggest-event, and any other existing caller)", () => {
    it("still requires CONTACT_RECIPIENT_EMAIL when no `to` is given — unaffected by the explicit-`to` path", async () => {
      delete process.env.CONTACT_RECIPIENT_EMAIL;

      await expect(
        sendEmail({ subject: "Test", text: "Body", replyTo: "someone@example.com" }),
      ).rejects.toThrow(/CONTACT_RECIPIENT_EMAIL/);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("existing callers' behavior is unchanged: sends to CONTACT_RECIPIENT_EMAIL exactly as before", async () => {
      sendMock.mockResolvedValue({ data: { id: "abc" }, error: null });

      await sendEmail({ subject: "Test subject", text: "Test body", replyTo: "someone@example.com" });

      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: "recipient@example.com" }),
      );
    });
  });

  it("error message names only the actually-missing variable(s), not all three unconditionally", async () => {
    process.env.RESEND_API_KEY = "";
    delete process.env.CONTACT_FROM_EMAIL;

    let err: Error | undefined;
    try {
      await sendEmail({ subject: "Test", text: "Body", to: "discovery@example.com" });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err!.message).toMatch(/RESEND_API_KEY/);
    expect(err!.message).toMatch(/CONTACT_FROM_EMAIL/);
    // CONTACT_RECIPIENT_EMAIL was never the problem here (an explicit `to`
    // was given) and must not be named as something to "set".
    expect(err!.message).not.toContain("CONTACT_RECIPIENT_EMAIL");
  });
});
