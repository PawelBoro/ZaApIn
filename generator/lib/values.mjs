// Synthetic value generators. Pure functions: no I/O, no hidden state.
// Randomness comes in as `rng` (returns [0, 1)), so tests can make it fixed.

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Two decimals: more would be false precision for a sensor reading.
export function round(value, decimals = 2) {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

// Any value in [min, max], each equally likely.
export function uniform({ min, max }, rng = Math.random) {
  return round(min + rng() * (max - min));
}

// Next value of a random walk: prev moved by at most `step` either way.
// A move past a bound is reflected back (clamping alone would leave the walk
// stuck flat on the bound); clamp only covers a step larger than the range.
export function walkStep(prev, { min, max, step }, rng = Math.random) {
  let next = prev + (rng() * 2 - 1) * step;
  if (next > max) next = max - (next - max);
  if (next < min) next = min + (min - next);
  return round(clamp(next, min, max));
}

// Starting point of a walk: the middle of the range.
export function walkStart({ min, max }) {
  return round((min + max) / 2);
}

// Sine between min and max at time `t` (Unix seconds). The phase depends on
// absolute time, so backfilled and live values form one continuous curve.
// Noise may push the value past a bound, so the result is clamped.
export function sine(t, { min, max, period, noise = 0 }, rng = Math.random) {
  const mid = (min + max) / 2;
  const amplitude = (max - min) / 2;
  const value = mid + amplitude * Math.sin((2 * Math.PI * t) / period) + noise * (rng() * 2 - 1);
  return round(clamp(value, min, max));
}
