// Test helper: a fresh in-memory PostgreSQL (PGlite) with the full Drizzle schema, for tests that need
// real transactions. Nothing here touches a real database.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@workspace/db/schema";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
let migrationSql: string[] | null = null;

async function schemaSql(): Promise<string[]> {
  if (migrationSql) return migrationSql;
  const kit = require_("drizzle-kit/api") as typeof import("drizzle-kit/api");
  const empty = kit.generateDrizzleJson({});
  const full = kit.generateDrizzleJson(schema as Record<string, unknown>);
  migrationSql = await kit.generateMigration(empty, full);
  return migrationSql;
}

export async function freshDb() {
  const client = new PGlite();
  for (const stmt of await schemaSql()) await client.exec(stmt);
  const db = drizzle(client, { schema });
  return { client, db: db as any };
}
