// Largest value of a PostgreSQL INTEGER column.
const MAX_INT = 2147483647;

// Returns a positive integer id from a path parameter, or null, so that ids
// like "abc", "1.5" or "99999999999" become 404 instead of a database error.
function parseId(value) {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return id <= MAX_INT ? id : null;
}

// Same for BIGSERIAL ids; capped at the largest integer a JS number holds exactly.
function parseBigId(value) {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return id <= Number.MAX_SAFE_INTEGER ? id : null;
}

module.exports = { MAX_INT, parseId, parseBigId };
