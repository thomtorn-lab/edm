import path from "node:path";
import { Client } from "pg";
import { applyPendingMigrations, decideMigration, readTaggedMigrations } from "./deployMigrations";

/**
 * First step of `npm run build` (see package.json). On a Vercel Production
 * build it applies pending migrations before `next build` runs; a non-zero
 * exit stops the build, so Vercel never promotes the deployment and the
 * current one keeps serving. A no-op everywhere else (local builds, Preview).
 * See src/db/deployMigrations.ts for the full rationale.
 */
async function main() {
  const decision = decideMigration(process.env);
  if (decision.action === "skip") {
    console.log(`[migrate-on-deploy] skipped: ${decision.reason}`);
    return;
  }
  if (decision.action === "fail") throw new Error(decision.reason);

  const migrations = readTaggedMigrations(path.join(process.cwd(), "src/db/migrations"));
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { applied } = await applyPendingMigrations(client, migrations, {
      log: (msg) => console.log(`[migrate-on-deploy] ${msg}`),
    });
    console.log(
      applied.length === 0
        ? `[migrate-on-deploy] Production schema up to date (${migrations.length} migrations), nothing applied.`
        : `[migrate-on-deploy] applied ${applied.length} migration(s): ${applied.join(", ")}`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`[migrate-on-deploy] FAILED — build stopped, the current Production deployment keeps serving.\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
