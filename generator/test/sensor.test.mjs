import { test } from "node:test";
import assert from "node:assert/strict";
import { backfillTimes, parseConfig } from "../sensor.mjs";

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
