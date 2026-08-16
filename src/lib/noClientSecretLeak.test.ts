import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const CLIENT_FILES = [
  "src/app/contact/ContactForm.tsx",
  "src/app/contact/page.tsx",
  "src/app/suggest-event/SuggestEventForm.tsx",
  "src/app/suggest-event/page.tsx",
];

const SERVER_ONLY_SECRETS = ["RESEND_API_KEY", "CONTACT_RECIPIENT_EMAIL"];

function read(relPath: string): string {
  return readFileSync(path.resolve(process.cwd(), relPath), "utf-8");
}

describe("private recipient email and API key never reach client code", () => {
  it.each(CLIENT_FILES)("%s does not reference server-only secrets", (relPath) => {
    const source = read(relPath);
    for (const name of SERVER_ONLY_SECRETS) {
      expect(source).not.toContain(name);
    }
  });

  it.each(["src/app/contact/ContactForm.tsx", "src/app/suggest-event/SuggestEventForm.tsx"])(
    "%s is a Client Component",
    (relPath) => {
      expect(read(relPath).trimStart().startsWith('"use client"')).toBe(true);
    }
  );

  it("the recipient/API key are only read inside server-only lib/email.ts", () => {
    const source = read("src/lib/email.ts");
    expect(source).toContain("RESEND_API_KEY");
    expect(source).toContain("CONTACT_RECIPIENT_EMAIL");
  });

  it(".env.example never prefixes the private vars with NEXT_PUBLIC_", () => {
    const envExample = read(".env.example");
    expect(envExample).toMatch(/^CONTACT_RECIPIENT_EMAIL=/m);
    expect(envExample).toMatch(/^RESEND_API_KEY=/m);
    expect(envExample).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(RESEND_API_KEY|CONTACT_RECIPIENT_EMAIL)/);
  });
});
