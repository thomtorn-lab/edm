import path from "node:path";
import { Client } from "pg";
import { applyPendingMigrations, decideMigration, listPendingMigrations, readTaggedMigrations } from "./deployMigrations";

/**
 * First step of `npm run build` (see package.json). On a Vercel Production
 * build it applies pending migrations before `next build` runs; a non-zero
 * exit stops the build, so Vercel never promotes the deployment and the
 * current one keeps serving. A no-op everywhere else (local builds, Preview);
 * a Vercel build that cannot tell its environment only verifies, read-only.
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
  // Bounded connect: an unreachable database must fail the build promptly, not stall it until Vercel's build timeout.
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 20_000 });
  await client.connect();
  try {
    if (decision.action === "verify") {
      console.log(`[migrate-on-deploy] ${decision.reason}`);
      const pending = await listPendingMigrations(client, migrations);
      if (pending.length > 0) {
        throw new Error(
          `${pending.length} migration(s) not yet applied to this build's database: ${pending.join(", ")}. ` +
            "Refusing to build code ahead of its schema. Apply them with the \"Prepare Production Database\" " +
            "workflow (migrations_only), then redeploy.",
        );
      }
      console.log("[migrate-on-deploy] database already has every migration; continuing (nothing applied).");
      return;
    }
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
