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

/**
 * Component tests model a desktop (sm and up) viewport. Since the 2026-11-24
 * mobile redesign, EventRow and the homepage list render a mobile-only layout
 * next to the desktop one, switched purely by CSS (`sm:hidden`), which jsdom
 * does not apply. Elements marked `data-mobile-only` are therefore hidden here
 * exactly as a browser at sm+ hides them: `display: none` (so ByRole queries
 * skip them) and ignored by ByText queries. Mobile-layout tests opt back in
 * explicitly (see EventRow.test.tsx, "mobile layout").
 */
if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = "[data-mobile-only] { display: none; }";
  document.head.appendChild(style);
  const { configure } = await import("@testing-library/react");
  configure({ defaultIgnore: "script, style, [data-mobile-only], [data-mobile-only] *" });
}

export {};
