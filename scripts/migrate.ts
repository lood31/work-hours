import { readFile } from "node:fs/promises";
import { getDB } from "../lib/db";
async function main() {
  const db = getDB();
  await db.query(
    "CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
  );
  await db.transaction(async (tx) => {
    const found = await tx.query(
      "SELECT name FROM migrations WHERE name='001_initial'",
    );
    if (found.rows.length) {
      console.log("Migration already applied");
      return;
    }
    const sql = await readFile("migrations/001_initial.sql", "utf8");
    // This migration contains plain DDL only (no function bodies or semicolons in literals).
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await tx.query(statement);
    await tx.query("INSERT INTO migrations(name) VALUES('001_initial')");
  });
  console.log("Database ready");
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
