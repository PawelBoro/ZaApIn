const pool = require("../db");
const { problem } = require("../lib/problem");
const { sha256 } = require("../lib/hash");

function unauthorized(res) {
  res.set("WWW-Authenticate", 'ApiKey header="X-API-Key"');
  return problem(res, 401, "Unauthorized", "Missing or invalid sensor API key.");
}

// Only X-API-Key is read: an admin Bearer token alone is not enough to send
// measurements. An unregistered (soft-deleted) sensor's key no longer works.
async function requireSensor(req, res, next) {
  const key = req.get("X-API-Key");
  if (!key) return unauthorized(res);
  const { rows } = await pool.query(
    "SELECT id, series_id FROM sensors WHERE api_key_hash = $1 AND deleted_at IS NULL",
    [sha256(key)]
  );
  if (rows.length === 0) return unauthorized(res);
  req.sensor = { id: rows[0].id, seriesId: rows[0].series_id };
  next();
}

module.exports = { requireSensor };
