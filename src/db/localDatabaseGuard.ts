import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { loadEnvConfig } from "@next/env";

/**
 * Local-only guard for developer commands that write to whatever
 * DATABASE_URL points at (2026-10-24): db:migrate, db:seed:dev, db:studio,
 * db:verify-sync, db:verify-bootstrap and `npm run dev` (also what local
 * E2E/screenshot runs start). Each runs this first (see package.json), with
 * the same env precedence as the command itself: an already-exported
 * DATABASE_URL wins over .env.local (`node --env-file` and Next.js both
 * behave that way), which is exactly how a shell or sandbox that happens to
 * carry a hosted connection string could otherwise reach a real database.
 *
 * Accepted without question: a connection to localhost / 127.0.0.0/8 / ::1 /
 * *.localhost, or a Unix socket. Anything else is refused unless
 * ALLOW_HOSTED_DATABASE names this exact command (e.g.
 * ALLOW_HOSTED_DATABASE=db:migrate, set by the Prepare Production Database
 * workflow) — and db:seed:dev, which only ever inserts demo content, is
 * refused against a hosted database even then. The opt-in counts only when
 * set for the one run (shell or workflow step env), never from an env file:
 * a line left in .env.local would otherwise switch the guard off for good.
 *
 * Not covered, deliberately: `npm run build` (the Vercel Production build
 * applies migrations itself — src/db/migrateOnDeploy.ts) and the db:
 * scripts the GitHub Actions workflows run against Production on purpose
 * (syncs, bootstrap, overrides, backfills).
 */

export const GUARDED_COMMANDS = ["db:migrate", "db:seed:dev", "db:studio", "db:verify-sync", "db:verify-bootstrap", "dev"] as const;
export type GuardedCommand = (typeof GUARDED_COMMANDS)[number];

/** Commands with no hosted-database escape hatch at all. */
const LOCAL_ONLY: ReadonlySet<GuardedCommand> = new Set(["db:seed:dev"]);

function isLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || /^127(\.\d{1,3}){3}$/.test(h);
}

/**
 * Where a Postgres connection string points: "local" (loopback host or a
 * Unix socket), "hosted" (anything else), or "invalid" (not a postgres URL).
 * Parsed with URL, never matched as text, so "localhost" in a password,
 * database name or query string can't make a hosted URL look local.
 */
export function classifyDatabaseUrl(raw: string | undefined): { kind: "local" | "hosted" | "invalid"; host: string } {
  if (!raw?.trim()) return { kind: "invalid", host: "" };
  let url: URL;
  try {
    // "postgres://user@/db?host=/socket/dir" (empty authority host) is valid for pg but not for URL; the placeholder is
    // never trusted — without a host parameter such a URL stays invalid below.
    url = new URL(raw.trim().replace(/^(postgres(?:ql)?:\/\/(?:[^@/]*@)?)\//i, "$1empty-host.invalid/"));
  } catch {
    return { kind: "invalid", host: "" };
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return { kind: "invalid", host: "" };
  // libpq/pg: a `host` query parameter overrides the authority; one starting with "/" is a Unix socket directory.
  const hostParam = url.searchParams.get("host");
  if (hostParam !== null) {
    const hosts = hostParam.split(",");
    const local = hosts.every((h) => h.startsWith("/") || isLocalHost(h));
    return { kind: local ? "local" : "hosted", host: hostParam };
  }
  if (!url.hostname || url.hostname === "empty-host.invalid") return { kind: "invalid", host: "" };
  return { kind: isLocalHost(url.hostname) ? "local" : "hosted", host: url.hostname };
}

export type GuardResult = { ok: true; message: string } | { ok: false; message: string };

export function checkLocalDatabase(command: GuardedCommand, env: Record<string, string | undefined>): GuardResult {
  const { kind, host } = classifyDatabaseUrl(env.DATABASE_URL);
  if (kind === "invalid") {
    return { ok: false, message: `${command}: DATABASE_URL is missing or isn't a postgres:// URL. Point it at a local test database (see .env.example).` };
  }
  if (kind === "local") return { ok: true, message: `${command}: using local database (${host}).` };
  if (LOCAL_ONLY.has(command)) {
    return {
      ok: false,
      message: `${command}: refusing — DATABASE_URL points at a hosted database (${host}). This command inserts demo data and only ever runs against a local database. Unset DATABASE_URL in your shell or point it at 127.0.0.1.`,
    };
  }
  if (env.ALLOW_HOSTED_DATABASE === command) return { ok: true, message: `${command}: hosted database (${host}) explicitly allowed by ALLOW_HOSTED_DATABASE=${command}.` };
  return {
    ok: false,
    message:
      `${command}: refusing — DATABASE_URL points at a hosted database (${host}), not a local test database. ` +
      "An exported DATABASE_URL overrides .env.local; unset it or point it at 127.0.0.1. " +
      `If you really mean this database, re-run with ALLOW_HOSTED_DATABASE=${command}.`,
  };
}

/**
 * The env the guarded command will actually see, resolved the way that
 * command resolves it, from the current process env and the env files in
 * `cwd`: `next dev` through Next's own loader (.env.development.local,
 * .env.local, .env.development, .env — any of them can hold DATABASE_URL),
 * the db: scripts like `node --env-file=.env.local` (same parser). The
 * process env wins in both, as it does for the command. ALLOW_HOSTED_DATABASE
 * is taken from the process env only; one found in an env file is reported
 * as ignored.
 */
export function resolveGuardEnv(
  command: GuardedCommand,
  cwd: string,
): { env: { DATABASE_URL?: string; ALLOW_HOSTED_DATABASE?: string }; ignoredFileOptIn: boolean } {
  const shellEnv = { ...process.env };
  let fileEnv: Record<string, string | undefined>;
  if (command === "dev") {
    // parsedEnv holds only what the files add — keys already in the process env are left out, which is the precedence Next applies.
    fileEnv = loadEnvConfig(cwd, true, { info: () => {}, error: () => {} }, true).parsedEnv ?? {};
  } else {
    const path = join(cwd, ".env.local");
    fileEnv = existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
  }
  return {
    env: { DATABASE_URL: shellEnv.DATABASE_URL ?? fileEnv.DATABASE_URL, ALLOW_HOSTED_DATABASE: shellEnv.ALLOW_HOSTED_DATABASE },
    ignoredFileOptIn: fileEnv.ALLOW_HOSTED_DATABASE !== undefined && shellEnv.ALLOW_HOSTED_DATABASE === undefined,
  };
}

function isGuardedCommand(value: string | undefined): value is GuardedCommand {
  return (GUARDED_COMMANDS as readonly string[]).includes(value ?? "");
}

// CLI: `node --import tsx src/db/localDatabaseGuard.ts <command>` — reads the env files itself (resolveGuardEnv); exits non-zero to stop the npm script.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = process.argv[2];
  if (!isGuardedCommand(command)) {
    console.error(`localDatabaseGuard: unknown command "${command ?? ""}" (expected one of ${GUARDED_COMMANDS.join(", ")}).`);
    process.exit(2);
  }
  const { env, ignoredFileOptIn } = resolveGuardEnv(command, process.cwd());
  if (ignoredFileOptIn) {
    console.error("[local-db-guard] ALLOW_HOSTED_DATABASE in an env file is ignored — set it for the one run instead (e.g. ALLOW_HOSTED_DATABASE=db:migrate npm run db:migrate).");
  }
  const result = checkLocalDatabase(command, env);
  if (result.ok) {
    console.log(`[local-db-guard] ${result.message}`);
  } else {
    console.error(`[local-db-guard] ${result.message}`);
    process.exit(1);
  }
}
