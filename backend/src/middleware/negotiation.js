const express = require("express");
const { problem } = require("../lib/problem");

function acceptJson(req, res, next) {
  if (!req.accepts(["application/json", "application/problem+json"])) {
    return problem(res, 406, "Not Acceptable", "This API only produces application/json.");
  }
  next();
}

// type-is treats "Content-Length: 0" as a body, so a bodiless POST (logout)
// would get 415; check the length ourselves.
function hasBody(req) {
  return req.headers["transfer-encoding"] !== undefined || Number(req.headers["content-length"]) > 0;
}

function requireJsonBody(req, res, next) {
  if (hasBody(req) && !req.is("application/json")) {
    return problem(res, 415, "Unsupported Media Type", "Request body must be application/json.");
  }
  next();
}

module.exports = [acceptJson, requireJsonBody, express.json()];
