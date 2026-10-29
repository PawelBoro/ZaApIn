const crypto = require("node:crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const pool = require("../db");
const { problem, validationErrors } = require("../lib/problem");
const { sha256 } = require("../lib/hash");

const TOKEN_TTL_SECONDS = Number.parseInt(process.env.TOKEN_TTL_SECONDS ?? "3600", 10);
if (!(TOKEN_TTL_SECONDS > 0)) throw new Error("TOKEN_TTL_SECONDS must be a positive integer");
const BCRYPT_COST = 12;
// Compared against when the username doesn't exist, so an unknown user
// takes as long as a wrong password and can't be detected by timing.
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser", BCRYPT_COST);

const loginSchema = z.object({ username: z.string(), password: z.string() });

const router = express.Router();

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return problem(res, 400, "Bad Request", "Invalid login request.", validationErrors(parsed.error));
  }
  const { username, password } = parsed.data;
  const { rows } = await pool.query("SELECT id, password_hash FROM admins WHERE username = $1", [username]);
  const admin = rows[0];
  const valid = await bcrypt.compare(password, admin?.password_hash ?? DUMMY_HASH);
  if (!admin || !valid) return problem(res, 401, "Unauthorized", "Invalid username or password.");

  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO sessions (admin_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(secs => $3))`,
    [admin.id, sha256(token), TOKEN_TTL_SECONDS]
  );
  res.set("Cache-Control", "no-store");
  res.json({ accessToken: token, tokenType: "Bearer", expiresIn: TOKEN_TTL_SECONDS });
});

module.exports = router;
