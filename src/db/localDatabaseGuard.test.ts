import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { GUARDED_COMMANDS, checkLocalDatabase, classifyDatabaseUrl } from "./localDatabaseGuard";

/**
 * Local-only guard for developer database commands (2026-10-24): local test
 * databases pass, hosted ones are refused unless explicitly named, the dev
 * seed is never allowed against a hosted database, and the Production paths
 * (Vercel build migrations, the Prepare Production Database workflow) keep
 * working.
 */

const ROOT = join(__dirname, "../..");
const LOCAL = "postgres://edm_app:pw@127.0.0.1:5432/edm_dev";
const HOSTED = "postgresql://postgres.abc:secret@pooler.example.com:6543/postgres";

describe("classifyDatabaseUrl", () => {
  it.each([
    "postgres://u:p@localhost:5432/db",
    "postgres://u:p@127.0.0.1/db",
    "postgres://u:p@127.0.1.1/db",
    "postgres://u:p@[::1]:5432/db",
    "postgresql://u:p@db.localhost/db",
    "postgres://u@/db?host=/var/run/postgresql",
    "postgres://u@localhost/db?host=/tmp",
  ])("local: %s", (url) => {
    expect(classifyDatabaseUrl(url).kind).toBe("local");
  });

  it.each([
    HOSTED,
    "postgres://u:p@db.example.com/db",
    "postgres://u:p@10.0.0.5/db",
    "postgres://u:localhost@db.example.com/db", // "localhost" as the password
    "postgres://u:p@db.example.com/localhost", // ... as the database name
    "postgres://u:p@db.example.com/db?application_name=127.0.0.1",
    "postgres://u:p@localhost/db?host=db.example.com", // the host param wins over the authority
    "postgres://u:p@localhost.example.com/db",
    "postgres://u:p@127.0.0.1.nip.io/db",
  ])("hosted: %s", (url) => {
    expect(classifyDatabaseUrl(url).kind).toBe("hosted");
  });

  it.each([undefined, "", "   ", "postgres://u@/db", "not a url", "mysql://u:p@localhost/db", "https://localhost/db"])("invalid: %s", (url) => {
    expect(classifyDatabaseUrl(url).kind).toBe("invalid");
  });

  it("never echoes credentials, only the host", () => {
    expect(classifyDatabaseUrl(HOSTED).host).toBe("pooler.example.com");
    for (const command of GUARDED_COMMANDS) {
      expect(checkLocalDatabase(command, { DATABASE_URL: HOSTED }).message).not.toContain("secret");
    }
  });
});

describe("checkLocalDatabase", () => {
  it.each(GUARDED_COMMANDS)("%s: a local test database is accepted", (command) => {
    expect(checkLocalDatabase(command, { DATABASE_URL: LOCAL }).ok).toBe(true);
  });

  it.each(GUARDED_COMMANDS)("%s: a hosted database is refused by default", (command) => {
    const r = checkLocalDatabase(command, { DATABASE_URL: HOSTED });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("pooler.example.com");
  });

  it.each(GUARDED_COMMANDS)("%s: a missing or malformed DATABASE_URL is refused", (command) => {
    expect(checkLocalDatabase(command, {}).ok).toBe(false);
    expect(checkLocalDatabase(command, { DATABASE_URL: "nonsense" }).ok).toBe(false);
  });

  it("the opt-in must name the exact command — a generic or another command's opt-in is not enough", () => {
    expect(checkLocalDatabase("db:migrate", { DATABASE_URL: HOSTED, ALLOW_HOSTED_DATABASE: "db:migrate" }).ok).toBe(true);
    expect(checkLocalDatabase("db:migrate", { DATABASE_URL: HOSTED, ALLOW_HOSTED_DATABASE: "1" }).ok).toBe(false);
    expect(checkLocalDatabase("db:migrate", { DATABASE_URL: HOSTED, ALLOW_HOSTED_DATABASE: "true" }).ok).toBe(false);
    expect(checkLocalDatabase("db:studio", { DATABASE_URL: HOSTED, ALLOW_HOSTED_DATABASE: "db:migrate" }).ok).toBe(false);
  });

  it("db:seed:dev is refused against a hosted database even with the opt-in", () => {
    expect(checkLocalDatabase("db:seed:dev", { DATABASE_URL: HOSTED, ALLOW_HOSTED_DATABASE: "db:seed:dev" }).ok).toBe(false);
  });
});

describe("the CLI stops the npm script before the command runs", () => {
  const GUARD = join(ROOT, "src/db/localDatabaseGuard.ts");
  const TSX = pathToFileURL(join(ROOT, "node_modules/tsx/dist/loader.mjs")).href;

  /** Runs the guard as `npm run <command>` would, in a scratch project dir holding `files`, with exactly `env` set for the run. */
  function run(command: string, env: Record<string, string>, files: Record<string, string> = {}) {
    const cwd = mkdtempSync(join(tmpdir(), "db-guard-"));
    for (const [name, content] of Object.entries(files)) writeFileSync(join(cwd, name), content);
    // The container/CI env may export its own DATABASE_URL; NODE_ENV=test would make Next skip .env.local.
    const childEnv: Record<string, string | undefined> = { ...process.env, ...env };
    for (const key of ["DATABASE_URL", "ALLOW_HOSTED_DATABASE", "NODE_ENV"]) if (!(key in env)) delete childEnv[key];
    return spawnSync(process.execPath, ["--import", TSX, GUARD, command], { cwd, env: childEnv as NodeJS.ProcessEnv, encoding: "utf8" });
  }

  it("exits 0 for a local database", () => {
    expect(run("db:migrate", { DATABASE_URL: LOCAL }).status).toBe(0);
  });

  it("exits 1 for a hosted database, without printing the password", () => {
    const r = run("db:seed:dev", { DATABASE_URL: HOSTED });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("refusing");
    expect(r.stderr + r.stdout).not.toContain("secret");
  });

  it("exits non-zero for an unknown command", () => {
    expect(run("db:nope", { DATABASE_URL: LOCAL }).status).toBe(2);
  });

  it("reads DATABASE_URL from .env.local like the db: scripts do, and an exported one wins over it", () => {
    expect(run("db:migrate", {}, { ".env.local": `DATABASE_URL=${HOSTED}\n` }).status).toBe(1);
    expect(run("db:migrate", {}, { ".env.local": `DATABASE_URL=${LOCAL}\n` }).status).toBe(0);
    expect(run("db:migrate", { DATABASE_URL: HOSTED }, { ".env.local": `DATABASE_URL=${LOCAL}\n` }).status).toBe(1);
  });

  it("dev: sees every env file Next loads — a hosted URL in .env.development.local beats a local one in .env.local", () => {
    expect(run("dev", {}, { ".env.local": `DATABASE_URL=${LOCAL}\n`, ".env.development.local": `DATABASE_URL=${HOSTED}\n` }).status).toBe(1);
    expect(run("dev", {}, { ".env": `DATABASE_URL=${HOSTED}\n` }).status).toBe(1);
    expect(run("dev", {}, { ".env.local": `DATABASE_URL=${LOCAL}\n`, ".env": `DATABASE_URL=${HOSTED}\n` }).status).toBe(0);
    expect(run("dev", { DATABASE_URL: HOSTED }, { ".env.local": `DATABASE_URL=${LOCAL}\n` }).status).toBe(1);
  });

  it("ALLOW_HOSTED_DATABASE in an env file is ignored (and said so) — only a per-run opt-in counts", () => {
    for (const command of ["db:migrate", "dev"]) {
      const r = run(command, {}, { ".env.local": `DATABASE_URL=${HOSTED}\nALLOW_HOSTED_DATABASE=${command}\n` });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("in an env file is ignored");
    }
    expect(run("db:migrate", { ALLOW_HOSTED_DATABASE: "db:migrate" }, { ".env.local": `DATABASE_URL=${HOSTED}\n` }).status).toBe(0);
  });

  it("the Prepare Production Database migrate step passes: hosted URL in .env.local, opt-in in the step env", () => {
    const r = run("db:migrate", { ALLOW_HOSTED_DATABASE: "db:migrate" }, { ".env.local": `DATABASE_URL=${HOSTED}\n` });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("explicitly allowed");
  });

  it("db:seed:dev never passes against a hosted database, whatever the opt-in", () => {
    for (const env of [{}, { ALLOW_HOSTED_DATABASE: "db:seed:dev" }, { ALLOW_HOSTED_DATABASE: "db:migrate" }] as Record<string, string>[]) {
      expect(run("db:seed:dev", env, { ".env.local": `DATABASE_URL=${HOSTED}\n` }).status).toBe(1);
    }
  });
});

describe("wiring", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };

  it.each(GUARDED_COMMANDS)("npm run %s runs the guard first, for that same command, and stops on failure (&&)", (command) => {
    expect(pkg.scripts[command]).toMatch(new RegExp(`^node --import tsx src/db/localDatabaseGuard\\.ts ${command} && `));
  });

  it("the guard loads no env file itself via node flags (it resolves them in resolveGuardEnv, so an opt-in in a file can't count); the commands keep --env-file=.env.local", () => {
    for (const command of GUARDED_COMMANDS) {
      const [guard, rest] = pkg.scripts[command].split(" && ");
      expect(guard).not.toContain("--env-file");
      if (command !== "dev") expect(rest.startsWith("node --env-file=.env.local ")).toBe(true);
    }
  });

  it("the Production build is not guarded (Vercel applies migrations in migrateOnDeploy)", () => {
    expect(pkg.scripts.build).toBe("node --import tsx src/db/migrateOnDeploy.ts && next build");
    expect(readFileSync(join(ROOT, "src/db/migrateOnDeploy.ts"), "utf8")).not.toContain("localDatabaseGuard");
  });

  it("Prepare Production Database explicitly allows db:migrate on its migrate step, and nothing else", () => {
    const wf = readFileSync(join(ROOT, ".github/workflows/prepare-production-db.yml"), "utf8");
    expect(wf).toMatch(/- name: Apply database migrations\n(?:\s+#.*\n)*\s+env:\n\s+ALLOW_HOSTED_DATABASE: db:migrate\n\s+run: npm run db:migrate\n/);
    expect(wf.match(/ALLOW_HOSTED_DATABASE/g)).toHaveLength(1);
  });

  it("no workflow runs a guarded command other than that migrate step", () => {
    const dir = join(ROOT, ".github/workflows");
    for (const name of readdirSync(dir)) {
      const wf = readFileSync(join(dir, name), "utf8")
        .split("\n")
        .filter((line) => !line.trim().startsWith("#"))
        .join("\n");
      for (const command of GUARDED_COMMANDS) {
        const runs = wf.match(new RegExp(`npm run ${command.replace(":", "\\:")}(?![\\w:-])`, "g")) ?? [];
        if (name === "prepare-production-db.yml" && command === "db:migrate") continue;
        expect(runs, `${name} runs npm run ${command}`).toHaveLength(0);
      }
    }
  });
});
