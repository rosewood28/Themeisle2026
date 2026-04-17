import { Database } from "bun:sqlite";

const identifier = process.argv[2]?.trim();

if (!identifier) {
  console.log("Usage: bun run admin:promote -- <email-or-username>");
  process.exit(1);
}

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

const normalized = identifier.toLowerCase();
sqlite
  .query(
    "UPDATE users SET role = 'admin' WHERE lower(email) = ? OR lower(username) = ?",
  )
  .run(normalized, normalized);

const promoted = sqlite
  .query("SELECT id, username, email FROM users WHERE role = 'admin' AND (lower(email) = ? OR lower(username) = ?)")
  .all(normalized, normalized) as Array<{ id: number; username: string; email: string }>;

if (promoted.length === 0) {
  console.log(`No matching user found for "${identifier}".`);
  process.exit(1);
}

console.log("Promoted user(s) to admin:");
for (const user of promoted) {
  console.log(`- id=${user.id} username=${user.username} email=${user.email}`);
}

