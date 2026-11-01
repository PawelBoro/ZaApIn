// Sends one measurement to the ZAI API and turns the response into an outcome.
// This module says what happened; the caller decides whether to go on.

// Outcomes:
//   created       201, stored
//   rejected      422, this value was refused (e.g. out of range); go on
//   invalid       400, this request was malformed; go on
//   unauthorized  401, the key does not work; every next request fails too
//   retryable     5xx, 408 or 429: a problem that may pass
//   fatal         any other status, e.g. 404 when --api points elsewhere

import { setTimeout as sleepMs } from "node:timers/promises";

// A free host may sleep and need about a minute to answer the first request.
export const RETRY_DEFAULTS = { retries: 3, timeoutMs: 70_000, baseDelayMs: 2_000, maxDelayMs: 60_000 };

// One attempt. Throws on a network error or when no response comes in time.
export async function sendMeasurement({ api, key }, { value, timestamp }, { timeoutMs = RETRY_DEFAULTS.timeoutMs } = {}) {
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
    // fetch has no useful timeout of its own.
    signal: AbortSignal.timeout(timeoutMs),
  });
  const result = interpret(res.status, await readJson(res));
  if (result.outcome === "retryable") result.retryAfter = parseRetryAfter(res.headers.get("retry-after"));
  return result;
}

// Retry-After in seconds; the HTTP-date form is rare and ignored.
function parseRetryAfter(header) {
  return header && /^\d+$/.test(header) ? Number(header) : undefined;
}

// Only network failures become retryable; any other error is a bug and is rethrown.
function networkFailure(err, timeoutMs) {
  if (err?.name === "TimeoutError") {
    return { outcome: "retryable", status: null, detail: `brak odpowiedzi w ciągu ${timeoutMs / 1000} s` };
  }
  if (err instanceof TypeError && err.message === "fetch failed") {
    // The real reason (ECONNREFUSED, ENOTFOUND, ...) is in err.cause.
    return { outcome: "retryable", status: null, detail: err.cause?.code ?? err.cause?.message ?? err.message };
  }
  throw err;
}

// Sends with up to `retries` more attempts for retryable outcomes, waiting
// baseDelayMs * 2^n between them (or longer, if Retry-After asks for it).
// POST is not idempotent: if the server stored the value but the response was
// lost, the retry stores it a second time. The contract has no idempotency
// key, so a rare duplicate is accepted over losing a measurement.
export async function sendWithRetry(conn, measurement, opts = {}) {
  const { retries, timeoutMs, baseDelayMs, maxDelayMs } = { ...RETRY_DEFAULTS, ...opts };
  const send = opts.send ?? sendMeasurement;
  const sleep = opts.sleep ?? sleepMs;
  const onRetry = opts.onRetry ?? (() => {});
  for (let attempt = 0; ; attempt++) {
    let result;
    try {
      result = await send(conn, measurement, { timeoutMs });
    } catch (err) {
      result = networkFailure(err, timeoutMs);
    }
    if (result.outcome !== "retryable" || attempt === retries) return { ...result, attempts: attempt + 1 };
    const backoffMs = baseDelayMs * 2 ** attempt;
    const delayMs = Math.min(maxDelayMs, Math.max(backoffMs, (result.retryAfter ?? 0) * 1000));
    onRetry({ attempt: attempt + 1, retries, delayMs, result });
    await sleep(delayMs);
  }
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
      return result.status === null
        ? `BŁĄD SIECI: ${result.detail}`
        : `BŁĄD SERWERA ${result.status}: ${result.detail}`;
    default:
      return `BŁĄD ${result.status}: ${result.detail} (czy --api wskazuje na aplikację ZAI?)`;
  }
}
