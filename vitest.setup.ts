/**
 * Unit tests never talk to a real database (every DB-touching test mocks
 * src/db/client or the module above it). A DATABASE_URL inherited from the
 * shell, a cloud environment or a CI step must therefore never reach them —
 * neither to connect nor to end up in a test's output — and neither must
 * the guard's per-run opt-in (src/db/localDatabaseGuard.ts). Tests that need
 * a value set it themselves. Only the test process is affected: workflows
 * and app runs read their own environment as before.
 */
delete process.env.DATABASE_URL;
delete process.env.ALLOW_HOSTED_DATABASE;
