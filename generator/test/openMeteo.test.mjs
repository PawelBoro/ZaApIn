import { test } from "node:test";
import assert from "node:assert/strict";
import { backfillUrl, currentUrl, parseCurrent, selectBackfill, OpenMeteoError } from "../lib/openMeteo.mjs";

const H = 3600;
// "Now" is 18:47 UTC; the data runs from 14:00 to 21:00, like a real response
// that ends with forecast hours.
const NOW_MS = Date.parse("2026-11-01T18:47:00Z");
const T14 = Date.parse("2026-11-01T14:00:00Z") / 1000;
const hourly = {
  time: Array.from({ length: 8 }, (_, i) => T14 + i * H), // 14:00 .. 21:00
  temperature_2m: [7.1, 7.4, null, 7.9, 8.2, 8.0, 7.6, 7.3],
};

const hoursOf = (rows) => rows.map((r) => r.timestamp.slice(11, 16));

test("drops forecast hours after now", () => {
  const rows = selectBackfill(hourly, "temperature_2m", { hours: 48, nowMs: NOW_MS });
  // 19:00, 20:00 and 21:00 are in the future; 16:00 is null.
  assert.deepEqual(hoursOf(rows), ["14:00", "15:00", "17:00", "18:00"]);
  assert.ok(rows.every((r) => Date.parse(r.timestamp) <= NOW_MS));
});

test("keeps only the last N hours", () => {
  // (15:47, 18:47]: 16:00 is null, so 17:00 and 18:00 remain.
  const rows = selectBackfill(hourly, "temperature_2m", { hours: 3, nowMs: NOW_MS });
  assert.deepEqual(hoursOf(rows), ["17:00", "18:00"]);
  assert.deepEqual(rows.map((r) => r.value), [7.9, 8.2]);
});

test("an hour exactly now is kept; one exactly N hours ago is not", () => {
  const now = Date.parse("2026-11-01T18:00:00Z");
  const rows = selectBackfill(hourly, "temperature_2m", { hours: 2, nowMs: now });
  // (16:00, 18:00]: 17:00 and 18:00.
  assert.deepEqual(hoursOf(rows), ["17:00", "18:00"]);
});

test("output is oldest first even if the input is not", () => {
  const shuffled = { time: [...hourly.time].reverse(), temperature_2m: [...hourly.temperature_2m].reverse() };
  const rows = selectBackfill(shuffled, "temperature_2m", { hours: 48, nowMs: NOW_MS });
  assert.deepEqual(hoursOf(rows), ["14:00", "15:00", "17:00", "18:00"]);
});

test("a response without the variable is an error", () => {
  assert.throws(() => selectBackfill(hourly, "wind_speed_10m", { hours: 3, nowMs: NOW_MS }), OpenMeteoError);
  assert.throws(() => selectBackfill(undefined, "temperature_2m", { hours: 3, nowMs: NOW_MS }), OpenMeteoError);
});

test("backfill URL asks for whole past days and unix time", () => {
  const url = new URL(backfillUrl({ lat: 52.23, lon: 21.01, variable: "temperature_2m", hours: 49 }));
  assert.equal(url.searchParams.get("past_days"), "3");
  assert.equal(url.searchParams.get("forecast_days"), "1");
  assert.equal(url.searchParams.get("timeformat"), "unixtime");
  assert.equal(url.searchParams.get("hourly"), "temperature_2m");
});

test("current value: time and value are read, a missing value is an error", () => {
  const body = { current: { time: 1793560500, interval: 900, temperature_2m: 7.7 }, current_units: { temperature_2m: "°C" } };
  assert.deepEqual(parseCurrent(body, "temperature_2m"), { time: 1793560500, value: 7.7, unit: "°C" });
  assert.throws(() => parseCurrent({ current: { time: 1793560500, temperature_2m: null } }, "temperature_2m"), OpenMeteoError);
  assert.throws(() => parseCurrent({}, "temperature_2m"), OpenMeteoError);
});

test("current URL asks for one variable in unix time", () => {
  const url = new URL(currentUrl({ lat: 52.23, lon: 21.01, variable: "wind_speed_10m" }));
  assert.equal(url.searchParams.get("current"), "wind_speed_10m");
  assert.equal(url.searchParams.get("timeformat"), "unixtime");
  assert.equal(url.searchParams.get("hourly"), null);
});
