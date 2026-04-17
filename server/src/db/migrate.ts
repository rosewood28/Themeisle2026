import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as schema from "./schema";

const dbFile = process.env.DB_FILE_NAME || "prediction_market.db";
const sqlite = new Database(dbFile);
const db = drizzle(sqlite, { schema });

console.log("Running migrations...");
await migrate(db, { migrationsFolder: "./drizzle" });

// Backfill for environments that already had the old users table
// before `balance` was introduced in the schema.
const usersColumns = sqlite
  .query("PRAGMA table_info(users)")
  .all() as Array<{ name: string }>;
const hasBalanceColumn = usersColumns.some((column) => column.name === "balance");
const hasRoleColumn = usersColumns.some((column) => column.name === "role");

if (!hasBalanceColumn) {
  console.log("Applying users.balance backfill migration...");
  sqlite.exec("ALTER TABLE users ADD COLUMN balance REAL NOT NULL DEFAULT 1000");
}

if (!hasRoleColumn) {
  console.log("Applying users.role backfill migration...");
  sqlite.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
}

const adminUsernames = (process.env.ADMIN_USERNAMES || "admin")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (adminUsernames.length > 0) {
  const quoted = adminUsernames.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ");
  sqlite.exec(`UPDATE users SET role = 'admin' WHERE lower(username) IN (${quoted.toLowerCase()})`);
}

console.log("✅ Migrations completed");
