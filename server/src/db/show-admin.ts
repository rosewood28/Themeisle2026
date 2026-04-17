import { Database } from "bun:sqlite";

const dbFile = process.env.DB_FILE_NAME || "prediction_market.db";
const sqlite = new Database(dbFile);

const columns = sqlite
  .query("PRAGMA table_info(users)")
  .all() as Array<{ name: string }>;
const hasRole = columns.some((column) => column.name === "role");

if (!hasRole) {
  console.log("The users.role column is missing.");
  console.log("Run: bun run db:migrate");
  process.exit(1);
}

const admins = sqlite
  .query("SELECT id, username, email FROM users WHERE role = 'admin' ORDER BY id ASC")
  .all() as Array<{ id: number; username: string; email: string }>;

if (admins.length === 0) {
  console.log("No admin users found in database.");
  process.exit(0);
}

console.log("Admin users:");
for (const admin of admins) {
  console.log(`- id=${admin.id} username=${admin.username} email=${admin.email}`);
}

