const { Pool } = require("pg");

// Azure PostgreSQL requires TLS; ssl: true also verifies the server certificate.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: true,
  connectionTimeoutMillis: 10000,
});

module.exports = pool;
