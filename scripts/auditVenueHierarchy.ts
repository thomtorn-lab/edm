// One-off, read-only Production audit for the venue-hierarchy/sub-venues
// task — mirrors src/db/inspectSource.ts's withReadOnlyTx safety pattern
// (BEGIN; SET LOCAL default_transaction_read_only = on; ...; ROLLBACK).
// Answers: does a separate Byhaven/Black Box/Red Box venue row exist, and
// does any event's venueId reference something outside the curated
// src/lib/data/venues.ts registry (which is the only write path to this
// table — see src/db/referenceData.ts::seedVenues)?
import { Client } from "pg";
import { VENUES } from "../src/lib/data/venues.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set.");
}

const client = new Client({ connectionString });
await client.connect();

function log(title, rows) {
  console.log(`\n-- ${title} (${rows.length} rows) --`);
  console.log(JSON.stringify(rows, null, 2));
}

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL default_transaction_read_only = on");
  await client.query("SET LOCAL statement_timeout = '20s'");

  const suspectVenues = await client.query(`
    SELECT id, slug, name, aliases
    FROM venues
    WHERE name ILIKE '%byhaven%' OR name ILIKE '%black box%' OR name ILIKE '%red box%'
       OR slug ILIKE '%byhaven%' OR slug ILIKE '%black-box%' OR slug ILIKE '%red-box%'
       OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE a ILIKE '%byhaven%' OR a ILIKE '%black box%' OR a ILIKE '%red box%')
  `);
  log("Venue rows matching Byhaven/Black Box/Red Box by name/slug/alias", suspectVenues.rows);

  const allVenues = await client.query(`SELECT id, slug, name FROM venues ORDER BY name`);
  const registryIds = new Set(VENUES.map((v) => v.id));
  const orphanRegistryRows = allVenues.rows.filter((r) => !registryIds.has(r.id));
  log("All venue rows in Production", allVenues.rows);
  log("Venue rows in Production NOT present in the src/lib/data/venues.ts registry", orphanRegistryRows);

  const pumpehusetVenue = allVenues.rows.find((r) => r.slug === "pumpehuset");
  const cultureBoxVenue = allVenues.rows.find((r) => r.slug === "culture-box");

  if (pumpehusetVenue) {
    const byhavenEvents = await client.query(
      `SELECT id, slug, title, start_datetime, published
       FROM events WHERE venue_id = $1 AND title ILIKE '%byhaven%'
       ORDER BY start_datetime`,
      [pumpehusetVenue.id],
    );
    log("Pumpehuset-linked events with 'Byhaven' in the title", byhavenEvents.rows);
  }

  if (cultureBoxVenue) {
    const cultureBoxEvents = await client.query(
      `SELECT id, slug, title, start_datetime, published,
              (description ILIKE '%black box%' OR description ILIKE '%red box%') AS description_mentions_rooms,
              (title ILIKE '%black box%' OR title ILIKE '%red box%') AS title_mentions_rooms
       FROM events WHERE venue_id = $1
       ORDER BY start_datetime`,
      [cultureBoxVenue.id],
    );
    log("Culture Box-linked events (room-mention check)", cultureBoxEvents.rows);
  }

  const eventVenueOrphans = await client.query(`
    SELECT e.id, e.slug, e.title, e.venue_id
    FROM events e
    LEFT JOIN venues v ON v.id = e.venue_id
    WHERE v.id IS NULL
  `);
  log("Events whose venue_id has no matching venues row (should be empty — FK should prevent this)", eventVenueOrphans.rows);

  await client.query("ROLLBACK");
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  throw err;
} finally {
  await client.end();
}
