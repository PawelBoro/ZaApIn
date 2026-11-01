import { test } from "node:test";
import assert from "node:assert/strict";
import { clamp, round, uniform, walkStart, walkStep, sine } from "../lib/values.mjs";

// Small seeded PRNG (mulberry32): the same seed gives the same sequence,
// so a failing run can be reproduced exactly.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RANGE = { min: -40, max: 50 };

test("clamp and round", () => {
  assert.equal(clamp(60, -40, 50), 50);
  assert.equal(clamp(-41, -40, 50), -40);
  assert.equal(clamp(7, -40, 50), 7);
  assert.equal(round(21.456), 21.46);
  assert.equal(round(-0.004), -0);
});

test("uniform maps rng 0 to min and rng near 1 to max", () => {
  assert.equal(uniform(RANGE, () => 0), -40);
  assert.equal(uniform(RANGE, () => 0.5), 5);
  assert.equal(uniform(RANGE, () => 0.99999999), 50);
});

test("uniform stays in range for many random values", () => {
  const rng = seeded(1);
  for (let i = 0; i < 10_000; i++) {
    const v = uniform(RANGE, rng);
    assert.ok(v >= RANGE.min && v <= RANGE.max, `value ${v} out of range`);
  }
});

test("walk moves by at most step", () => {
  const opts = { ...RANGE, step: 2 };
  assert.equal(walkStep(10, opts, () => 0), 8);
  assert.equal(walkStep(10, opts, () => 0.5), 10);
  const rng = seeded(2);
  let v = walkStart(opts);
  for (let i = 0; i < 10_000; i++) {
    const next = walkStep(v, opts, rng);
    assert.ok(Math.abs(next - v) <= opts.step + 1e-9, `jump ${v} -> ${next}`);
    v = next;
  }
});

test("walk reflects off a bound instead of sticking to it", () => {
  const opts = { ...RANGE, step: 2 };
  // 49 + 2 = 51 is 1 past max, so it comes back to 49.
  assert.equal(walkStep(49, opts, () => 0.99999999), 49);
  // -39 - 2 = -41 is 1 below min, so it comes back to -39.
  assert.equal(walkStep(-39, opts, () => 0), -39);
});

test("walk with a step larger than the range still stays in range", () => {
  const opts = { min: 0, max: 1, step: 100 };
  const rng = seeded(3);
  let v = walkStart(opts);
  for (let i = 0; i < 1000; i++) {
    v = walkStep(v, opts, rng);
    assert.ok(v >= 0 && v <= 1, `value ${v} out of range`);
  }
});

test("sine hits mid, max and min at quarter periods", () => {
  const opts = { ...RANGE, period: 3600 };
  assert.equal(sine(0, opts), 5);
  assert.equal(sine(900, opts), 50);
  assert.equal(sine(2700, opts), -40);
  // One full period later the curve repeats.
  assert.equal(sine(900 + 3600, opts), sine(900, opts));
});

test("sine noise never leaves the range", () => {
  const opts = { ...RANGE, period: 600, noise: 10 };
  const rng = seeded(4);
  for (let t = 0; t < 10_000; t += 7) {
    const v = sine(t, opts, rng);
    assert.ok(v >= RANGE.min && v <= RANGE.max, `value ${v} at t=${t} out of range`);
  }
  // At the peak, maximum positive noise is clamped to max.
  assert.equal(sine(150, opts, () => 0.99999999), 50);
});
