import { test } from "node:test";
import assert from "node:assert/strict";
import { backfillTimes, formatSummary, parseConfig } from "../sensor.mjs";

test("backfill times are oldest first, evenly spaced, ending now", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  const times = backfillTimes(3, 3600, now).map((d) => d.toISOString());
  assert.deepEqual(times, ["2026-11-01T10:00:00.000Z", "2026-11-01T11:00:00.000Z", "2026-11-01T12:00:00.000Z"]);
});

test("synthetic backfill covers the hours by default", () => {
  const base = ["--mode", "uniform", "--min", "0", "--max", "1", "--dry-run"];
  assert.equal(parseConfig([...base, "--backfill", "6"], {}).count, 6);
  assert.equal(parseConfig([...base, "--backfill", "2", "--interval", "600"], {}).count, 12);
  assert.equal(parseConfig([...base, "--backfill", "6", "--count", "3"], {}).count, 3);
});

test("summary lists counts and why the run stopped early", () => {
  const base = { sent: 3, rejected: 1, errors: 0, skipped: 0 };
  assert.equal(formatSummary(base, 12_340), "Podsumowanie (12.3 s): wysłane 3, odrzucone 1, błędy 0");
  assert.equal(
    formatSummary({ ...base, errors: 1, skipped: 2, stopReason: "zatrzymano przez Ctrl+C" }, 500),
    "Podsumowanie (0.5 s): wysłane 3, odrzucone 1, błędy 1, pominięte (bez zmian) 2\nZakończono wcześniej: zatrzymano przez Ctrl+C."
  );
});

test("--outlier needs no --mode", () => {
  const config = parseConfig(["--outlier", "999", "--dry-run"], {});
  assert.equal(config.outlier, 999);
  assert.equal(config.mode, undefined);
});
