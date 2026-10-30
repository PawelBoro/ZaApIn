const { STATUS_CODES } = require("node:http");
const { problem } = require("../lib/problem");

function apiNotFound(req, res) {
  problem(res, 404, "Not Found", "The requested resource does not exist.");
}

// Final error handler: details go to the server log only, the client gets a
// generic Problem Details body, so stack traces and internals never leak.
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  // PostgreSQL check_violation: a CHECK constraint rejected the data.
  if (err.code === "23514") {
    console.warn(`${req.method} ${req.originalUrl} -> 422: ${err.message}`);
    return problem(res, 422, "Unprocessable Content", "The data violates a validation rule.");
  }
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) {
    console.error(err);
    return problem(res, 500, "Internal Server Error");
  }
  console.warn(`${req.method} ${req.originalUrl} -> ${status}: ${err.message}`);
  if (err.type === "entity.parse.failed") {
    return problem(res, 400, "Bad Request", "Request body is not valid JSON.");
  }
  return problem(res, status, STATUS_CODES[status] ?? "Error");
}

module.exports = { apiNotFound, errorHandler };
