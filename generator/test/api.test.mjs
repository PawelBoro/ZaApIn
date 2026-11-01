import { test } from "node:test";
import assert from "node:assert/strict";
import { interpret, sendWithRetry } from "../lib/api.mjs";

// Fake send: returns (or throws) the scripted answers in order.
function scripted(...answers) {
  const calls = [];
  const send = async () => {
    const next = answers[calls.length];
    calls.push(next);
    if (next instanceof Error) throw next;
    return next;
  };
  return { send, calls };
}

function recordSleeps() {
  const delays = [];
  return { sleep: async (ms) => delays.push(ms), delays };
}

const fetchFailed = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
const created = interpret(201, { id: 1, value: 5 });

test("retries a 503 and a network error with growing delays, then succeeds", async () => {
  const { send, calls } = scripted(interpret(503, null), fetchFailed(), created);
  const { sleep, delays } = recordSleeps();
  const result = await sendWithRetry({}, { value: 5 }, { send, sleep });
  assert.equal(result.outcome, "created");
  assert.equal(result.attempts, 3);
  assert.equal(calls.length, 3);
  assert.deepEqual(delays, [2000, 4000]);
});

test("gives up after 3 retries and returns the last failure", async () => {
  const { send, calls } = scripted(...Array.from({ length: 5 }, fetchFailed));
  const { sleep, delays } = recordSleeps();
  const result = await sendWithRetry({}, { value: 5 }, { send, sleep });
  assert.equal(result.outcome, "retryable");
  assert.equal(result.detail, "ECONNREFUSED");
  assert.equal(result.attempts, 4);
  assert.equal(calls.length, 4);
  assert.deepEqual(delays, [2000, 4000, 8000]);
});

test("does not retry 401 or 422", async () => {
  for (const status of [401, 422]) {
    const { send, calls } = scripted(interpret(status, null), created);
    const result = await sendWithRetry({}, { value: 5 }, { send, sleep: async () => {} });
    assert.equal(result.outcome, status === 401 ? "unauthorized" : "rejected");
    assert.equal(calls.length, 1);
  }
});

test("waits as long as Retry-After asks, capped at maxDelayMs", async () => {
  const { send } = scripted({ ...interpret(429, null), retryAfter: 30 }, { ...interpret(429, null), retryAfter: 600 }, created);
  const { sleep, delays } = recordSleeps();
  await sendWithRetry({}, { value: 5 }, { send, sleep });
  assert.deepEqual(delays, [30_000, 60_000]);
});

test("after Ctrl+C a failure is not retried or announced as a retry", async () => {
  const controller = new AbortController();
  const { send, calls } = scripted(interpret(503, null), created);
  const retries = [];
  const sending = sendWithRetry({}, { value: 5 }, { send, signal: controller.signal, onRetry: (r) => retries.push(r) });
  controller.abort();
  const result = await sending;
  assert.equal(result.outcome, "retryable");
  assert.equal(calls.length, 1);
  assert.equal(retries.length, 0);
});

test("Ctrl+C during the wait between retries stops at once", async () => {
  const controller = new AbortController();
  const { send, calls } = scripted(fetchFailed(), created);
  const started = Date.now();
  const result = await sendWithRetry({}, { value: 5 }, {
    send,
    baseDelayMs: 10_000,
    signal: controller.signal,
    onRetry: () => controller.abort(),
  });
  assert.equal(result.outcome, "retryable");
  assert.equal(calls.length, 1);
  assert.ok(Date.now() - started < 1000, "waited for the backoff");
});

test("a bug in our code is thrown, not retried", async () => {
  const { send, calls } = scripted(new ReferenceError("oops"), created);
  await assert.rejects(sendWithRetry({}, { value: 5 }, { send, sleep: async () => {} }), ReferenceError);
  assert.equal(calls.length, 1);
});
