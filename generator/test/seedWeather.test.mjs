import { test } from "node:test";
import assert from "node:assert/strict";
import { SERIES, planSeries, needsBackfill, newerThan } from "../seed-weather.mjs";

test("existing series are matched by name, missing ones are planned for creation", () => {
  const existing = [{ id: 7, name: "Warszawa – wilgotność" }, { id: 9, name: "Other" }];
  const plan = planSeries(existing, SERIES);
  assert.equal(plan.length, 4);
  assert.deepEqual(plan.map((p) => p.series?.id ?? null), [null, 7, null, null]);
});

test("the four series differ by icon, not only by colour", () => {
  assert.equal(new Set(SERIES.map((s) => s.icon)).size, SERIES.length);
});

test("a series with enough values is skipped", () => {
  assert.equal(needsBackfill(0, 15), true);
  assert.equal(needsBackfill(14, 15), true);
  assert.equal(needsBackfill(15, 15), false);
  assert.equal(needsBackfill(48, 15), false);
});

test("only values newer than the last stored one are sent", () => {
  const ms = ["2026-11-04T10:00:00.000Z", "2026-11-04T11:00:00.000Z", "2026-11-04T12:00:00.000Z"].map((timestamp, i) => ({ value: i, timestamp }));
  assert.deepEqual(newerThan(ms, undefined), ms);
  assert.deepEqual(newerThan(ms, "2026-11-04T11:00:00Z").map((m) => m.value), [2]);
  assert.deepEqual(newerThan(ms, "2026-11-04T12:00:00.000Z"), []);
});
