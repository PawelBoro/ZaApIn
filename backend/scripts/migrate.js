require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const pool = require("../src/db");

const dir = path.join(__dirname, "..", "db", "migrations");

async function main() {
  const client = await pool.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name       TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    );
    const done = new Set(
      (await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name)
    );
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    let applied = 0;

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`applied ${file}`);
        applied++;
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`${file} failed: ${err.message}`);
      }
    }
    if (applied === 0) console.log("nothing to apply");
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
