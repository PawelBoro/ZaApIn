// Sends an RFC 9457 Problem Details response.
function problem(res, status, title, detail, errors) {
  const body = { type: "about:blank", title, status };
  if (detail) body.detail = detail;
  if (errors?.length) body.errors = errors;
  return res.status(status).type("application/problem+json").json(body);
}

// Turns zod issues into [{ field, message }].
function validationErrors(zodError) {
  return zodError.issues.map((i) => ({ field: i.path.join(".") || "body", message: i.message }));
}

module.exports = { problem, validationErrors };
