const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { Pool } = require("pg");

const run = promisify(execFile);

// Entra access tokens live ~1h; cache one and refresh it a bit earlier.
const TOKEN_CACHE_MS = 30 * 60 * 1000;
let cachedToken = null;
let cachedAt = 0;

async function entraToken() {
  if (cachedToken && Date.now() - cachedAt < TOKEN_CACHE_MS) return cachedToken;
  const { stdout } = await run("az", [
    "account", "get-access-token",
    "--resource-type", "oss-rdbms",
    "--query", "accessToken",
    "-o", "tsv",
  ]);
  cachedToken = stdout.trim();
  cachedAt = Date.now();
  return cachedToken;
}

// DB_AUTH=entra -> token from `az login`; otherwise DB_PASSWORD is used.
const password =
  process.env.DB_AUTH === "entra" ? entraToken : process.env.DB_PASSWORD;

// Azure PostgreSQL requires TLS; ssl: true also verifies the server certificate.
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password,
  ssl: true,
  connectionTimeoutMillis: 10000,
});

// Without a listener, a dropped idle connection would crash the process.
pool.on("error", (err) => console.error("Idle database client error:", err.message));

module.exports = pool;
