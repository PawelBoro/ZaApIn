require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("../src/db");

async function main() {
  const { ADMIN_USERNAME: username, ADMIN_PASSWORD: password } = process.env;
  if (!username || !password) {
    throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD must be set in .env");
  }
  if (password === "change-me" || password === "CHANGE_ME_BEFORE_RUNNING") {
    throw new Error("ADMIN_PASSWORD is still a placeholder - set a real one in .env");
  }
  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters");
  }

  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO admins (username, password_hash) VALUES ($1, $2)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [username, hash]
  );
  console.log(`admin "${username}" created or updated`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
