// Sends one measurement to the ZAI API and turns the response into an outcome.
// This module says what happened; the caller decides whether to go on.

// Outcomes:
//   created       201, stored
//   rejected      422, this value was refused (e.g. out of range); go on
//   invalid       400, this request was malformed; go on
//   unauthorized  401, the key does not work; every next request fails too
//   retryable     5xx, 408 or 429: a problem that may pass
//   fatal         any other status, e.g. 404 when --api points elsewhere

export async function sendMeasurement({ api, key }, { value, timestamp }) {
  // Without a timestamp the server uses its own time.
  const body = timestamp === undefined ? { value } : { value, timestamp };
  const res = await fetch(`${api}/api/measurements`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, application/problem+json",
      "X-API-Key": key,
    },
    body: JSON.stringify(body),
  });
  return interpret(res.status, await readJson(res));
}

// A proxy in front of a sleeping app may answer 502/503 with HTML, so the body
// is read as text first; anything that is not JSON becomes null.
async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Pure: status code and parsed body (or null) -> outcome object.
export function interpret(status, body) {
  if (status === 201) return { outcome: "created", status, measurement: body };
  // Problem Details (RFC 9457): detail, plus errors[] with field and message.
  const detail = body?.detail ?? body?.title ?? `HTTP ${status}`;
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  if (status === 422) return { outcome: "rejected", status, detail, errors };
  if (status === 400) return { outcome: "invalid", status, detail, errors };
  if (status === 401) return { outcome: "unauthorized", status, detail };
  // 408 and 429 are the 4xx codes that mean "try again later", not "fix it".
  if (status >= 500 || status === 408 || status === 429) return { outcome: "retryable", status, detail };
  return { outcome: "fatal", status, detail };
}

function formatErrors(errors) {
  return errors.map((e) => `\n    - ${e.field ?? "?"}: ${e.message}`).join("");
}

// One human-readable line (plus validation errors) for an outcome.
export function describe(result, sent) {
  switch (result.outcome) {
    case "created": {
      const m = result.measurement;
      return `OK      id=${m?.id} value=${m?.value} time=${m?.timestamp}`;
    }
    case "rejected":
      return `ODRZUCONO value=${sent.value}: ${result.detail}${formatErrors(result.errors)}`;
    case "invalid":
      return `BŁĄD 400 value=${sent.value}: ${result.detail}${formatErrors(result.errors)}`;
    case "unauthorized":
      return "BŁĄD 401: klucz nieprawidłowy lub czujnik wyrejestrowany.";
    case "retryable":
      return `BŁĄD SERWERA ${result.status}: ${result.detail}`;
    default:
      return `BŁĄD ${result.status}: ${result.detail} (czy --api wskazuje na aplikację ZAI?)`;
  }
}
