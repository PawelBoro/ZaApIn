const pool = require("../db");
const { problem } = require("../lib/problem");
const { sha256 } = require("../lib/hash");

function unauthorized(res) {
  res.set("WWW-Authenticate", "Bearer");
  return problem(res, 401, "Unauthorized", "Missing, invalid or expired access token.");
}

async function requireAdmin(req, res, next) {
  const match = /^Bearer (\S+)$/i.exec(req.get("Authorization") ?? "");
  if (!match) return unauthorized(res);
  const { rows } = await pool.query(
    `SELECT s.id AS session_id, a.id, a.username
       FROM sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [sha256(match[1])]
  );
  if (rows.length === 0) return unauthorized(res);
  req.admin = { id: rows[0].id, username: rows[0].username };
  req.sessionId = rows[0].session_id;
  next();
}

module.exports = { requireAdmin };
