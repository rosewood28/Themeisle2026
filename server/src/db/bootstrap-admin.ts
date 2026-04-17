import { Database } from "bun:sqlite";
import { hashPassword } from "../lib/auth";

const shouldBootstrap = (process.env.ADMIN_BOOTSTRAP || "false").toLowerCase() === "true";
const adminEmails = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const adminEmail = (process.env.ADMIN_EMAIL || adminEmails[0] || "").trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "";
const adminUsernameBase = (process.env.ADMIN_USERNAME || "admin").trim().toLowerCase();

if (!shouldBootstrap) {
  console.log("Skipping admin bootstrap (ADMIN_BOOTSTRAP is not true).");
  process.exit(0);
}

if (!adminEmail || !adminPassword) {
  console.log("Skipping admin bootstrap (ADMIN_EMAIL or ADMIN_PASSWORD missing).");
  process.exit(0);
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

const passwordHash = await hashPassword(adminPassword);
const nowUnixSeconds = Math.floor(Date.now() / 1000);

const existingByEmail = sqlite
  .query("SELECT id, username FROM users WHERE lower(email) = ? LIMIT 1")
  .get(adminEmail) as { id: number; username: string } | null;

if (existingByEmail) {
  sqlite
    .query("UPDATE users SET role = 'admin', password_hash = ?, updated_at = ? WHERE id = ?")
    .run(passwordHash, nowUnixSeconds, existingByEmail.id);
  console.log(
    `Admin bootstrap completed: promoted existing user ${adminEmail} (username=${existingByEmail.username}).`,
  );
  process.exit(0);
}

let candidateUsername = adminUsernameBase || "admin";
let suffix = 1;
while (true) {
  const usernameTaken = sqlite
    .query("SELECT id FROM users WHERE lower(username) = ? LIMIT 1")
    .get(candidateUsername) as { id: number } | null;

  if (!usernameTaken) {
    break;
  }

  suffix += 1;
  candidateUsername = `${adminUsernameBase}${suffix}`;
}

sqlite
  .query(
    "INSERT INTO users (username, email, password_hash, role, balance, created_at, updated_at) VALUES (?, ?, ?, 'admin', 1000, ?, ?)",
  )
  .run(candidateUsername, adminEmail, passwordHash, nowUnixSeconds, nowUnixSeconds);

console.log(`Admin bootstrap completed: created ${adminEmail} (username=${candidateUsername}).`);

