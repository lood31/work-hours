import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/node-postgres";
import { drizzle as drizzleLite } from "drizzle-orm/pglite";
export interface DB {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
  transaction<T>(fn: (tx: DB) => Promise<T>): Promise<T>;
}
// The ORM is exposed for typed read models; SQL transactions below keep row locks explicit.
function wrapLite(client: PGlite): DB {
  return {
    query: (s, p) => client.query(s, p),
    transaction: (fn) =>
      client.transaction((t) =>
        fn({
          query: (s, p) => t.query(s, p),
          transaction: () => {
            throw new Error("Nested transaction is not supported");
          },
        }),
      ),
  };
}
// SAFETY: This module exclusively owns these process-local cache slots and only assigns DB adapters created above/below.
const globals = globalThis as typeof globalThis & {
  workDB?: DB;
  workORM?: unknown;
};
export function getDB(): DB {
  if (globals.workDB) return globals.workDB;
  if (process.env.DB_DRIVER === "pglite") {
    if (process.env.VERCEL)
      throw new Error("Vercel 必须使用 Neon/Postgres，不能使用临时磁盘PGlite");
    const path = resolve(
      /* turbopackIgnore: true */ process.env.PGLITE_PATH ?? ".data/postgres",
    );
    mkdirSync(dirname(path), { recursive: true });
    const p = new PGlite(path);
    globals.workORM = drizzleLite(p);
    globals.workDB = wrapLite(p);
  } else {
    if (!process.env.DATABASE_URL)
      throw new Error(
        "请配置 DATABASE_URL，或本地设置 DB_DRIVER=pglite 后执行迁移",
      );
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
    });
    globals.workORM = drizzle(pool);
    globals.workDB = {
      query: async <T>(s: string, p?: unknown[]) => ({
        rows: (await pool.query(s, p)).rows as T[],
      }),
      transaction: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const result = await fn({
            query: async <T>(s: string, p?: unknown[]) => ({
              rows: (await c.query(s, p)).rows as T[],
            }),
            transaction: () => {
              throw new Error("Nested transaction");
            },
          });
          await c.query("COMMIT");
          return result;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
    };
  }
  return globals.workDB;
}
export function setTestDB(db: DB) {
  if (process.env.NODE_ENV !== "test") throw new Error("Test only");
  globals.workDB = db;
}
export { wrapLite };
