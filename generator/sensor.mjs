#!/usr/bin/env node
// Sensor emulator: sends synthetic or Open-Meteo values to the ZAI API.
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { uniform, walkStart, walkStep, sine } from "./lib/values.mjs";
import { sendWithRetry, describe } from "./lib/api.mjs";
import { fetchBackfill, fetchCurrent, UNITS, OpenMeteoError } from "./lib/openMeteo.mjs";

const MODES = ["uniform", "walk", "sine", "open-meteo"];
const VARIABLES = ["temperature_2m", "relative_humidity_2m", "surface_pressure", "wind_speed_10m"];

const USAGE = `Usage: node sensor.mjs --mode <mode> [options]

Connection (flags override environment variables):
  --api <url>          API base URL            (env ZAI_API_URL)
  --key <key>          sensor API key          (env SENSOR_API_KEY, preferred)

Value source:
  --mode <mode>        uniform | walk | sine | open-meteo
  --min, --max <n>     value range (uniform, walk, sine)
  --step <n>           max change per value (walk; default (max-min)/20)
  --period <s>         sine period in seconds (default 3600)
  --noise <n>          random noise added to sine (default 0)
  --lat, --lon <deg>   location (open-meteo)
  --variable <name>    ${VARIABLES.join(" | ")}
                       (open-meteo; default temperature_2m)

Timing:
  --backfill <hours>   send past values with timestamps, ending now, then exit
  --count <n>          number of values
                       (backfill default: enough to cover the hours; live: unlimited)
  --interval <s>       seconds between values (default 60; backfill 3600)
  --outlier <value>    send this one value and exit

  --dry-run            print what would be sent, send nothing
  --help               show this help

Negative numbers need "=", e.g. --min=-40 (otherwise -40 looks like a flag).`;

export class UsageError extends Error {}

// Every option is a string: parseArgs has no number type.
const OPTIONS = {
  api: { type: "string" },
  key: { type: "string" },
  mode: { type: "string" },
  min: { type: "string" },
  max: { type: "string" },
  step: { type: "string" },
  period: { type: "string" },
  noise: { type: "string" },
  lat: { type: "string" },
  lon: { type: "string" },
  variable: { type: "string" },
  backfill: { type: "string" },
  count: { type: "string" },
  interval: { type: "string" },
  outlier: { type: "string" },
  "dry-run": { type: "boolean", default: false },
  help: { type: "boolean", default: false },
};

// Number("") and Number(" ") are 0, so an empty value must be rejected first.
function num(values, name, { fallback, min, max, positive, integer } = {}) {
  const raw = values[name];
  if (raw === undefined) return fallback;
  const n = raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(n)) throw new UsageError(`--${name} must be a number, got "${raw}".`);
  if (integer && !Number.isInteger(n)) throw new UsageError(`--${name} must be an integer.`);
  if (positive && n <= 0) throw new UsageError(`--${name} must be greater than 0.`);
  if (min !== undefined && n < min) throw new UsageError(`--${name} must be at least ${min}.`);
  if (max !== undefined && n > max) throw new UsageError(`--${name} must be at most ${max}.`);
  return n;
}

function required(value, name, envName) {
  if (value === undefined || value === "") {
    throw new UsageError(`Missing --${name}${envName ? ` (or env ${envName})` : ""}.`);
  }
  return value;
}

// Turns argv and env into a validated config, or throws UsageError.
export function parseConfig(argv, env) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: false }));
  } catch (err) {
    // Unknown flag, missing value, positional argument.
    throw new UsageError(err.message);
  }
  if (values.help) return { help: true };

  const dryRun = values["dry-run"];
  const backfill = num(values, "backfill", { positive: true });
  const config = {
    dryRun,
    api: values.api ?? env.ZAI_API_URL,
    key: values.key ?? env.SENSOR_API_KEY,
    // Backfill defaults to hourly values, like Open-Meteo's hourly data;
    // Open-Meteo's current values change every 15 minutes.
    interval: num(values, "interval", {
      fallback: backfill !== undefined ? 3600 : values.mode === "open-meteo" ? 900 : 60,
      positive: true,
    }),
  };

  // A dry run sends nothing, so it may run without the connection details.
  if (!dryRun) {
    required(config.api, "api", "ZAI_API_URL");
    required(config.key, "key", "SENSOR_API_KEY");
  }
  if (config.api !== undefined) {
    let url;
    try {
      url = new URL(config.api);
    } catch {
      throw new UsageError(`--api is not a valid URL: "${config.api}".`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new UsageError("--api must start with http:// or https://.");
    }
    config.api = url.origin;
  }

  if (values.outlier !== undefined) {
    if (values.backfill !== undefined) throw new UsageError("--outlier cannot be combined with --backfill.");
    config.outlier = num(values, "outlier");
    return config;
  }

  config.mode = required(values.mode, "mode");
  if (!MODES.includes(config.mode)) {
    throw new UsageError(`--mode must be one of: ${MODES.join(", ")}.`);
  }

  if (backfill !== undefined) config.backfill = backfill;
  // Synthetic backfill: by default enough values to cover the hours.
  // Open-Meteo backfill takes what the hourly data has; live runs until stopped.
  const coverHours = backfill !== undefined && config.mode !== "open-meteo"
    ? Math.max(1, Math.floor((backfill * 3600) / config.interval))
    : undefined;
  config.count = num(values, "count", { fallback: coverHours, positive: true, integer: true });

  if (config.mode === "open-meteo") {
    config.lat = num(values, "lat", { min: -90, max: 90 });
    config.lon = num(values, "lon", { min: -180, max: 180 });
    required(config.lat, "lat");
    required(config.lon, "lon");
    config.variable = values.variable ?? "temperature_2m";
    if (!VARIABLES.includes(config.variable)) {
      throw new UsageError(`--variable must be one of: ${VARIABLES.join(", ")}.`);
    }
    return config;
  }

  // Synthetic modes.
  config.min = required(num(values, "min"), "min");
  config.max = required(num(values, "max"), "max");
  if (config.min >= config.max) throw new UsageError("--min must be less than --max.");
  if (config.mode === "walk") {
    config.step = num(values, "step", { fallback: (config.max - config.min) / 20, positive: true });
  }
  if (config.mode === "sine") {
    config.period = num(values, "period", { fallback: 3600, positive: true });
    config.noise = num(values, "noise", { fallback: 0, min: 0 });
  }
  return config;
}

// Shows enough of the key to tell sensors apart, never the whole key.
function maskKey(key) {
  return key ? `${key.slice(0, 4)}… (${key.length} chars)` : "(none)";
}

// Returns next(tSeconds) for a synthetic mode. The walk keeps its last value
// here, so the functions in values.mjs stay pure.
export function makeSource(config, rng = Math.random) {
  switch (config.mode) {
    case "uniform":
      return () => uniform(config, rng);
    case "walk": {
      let value = walkStart(config);
      return () => (value = walkStep(value, config, rng));
    }
    case "sine":
      return (t) => sine(t, config, rng);
    default:
      throw new Error(`No synthetic source for mode ${config.mode}`);
  }
}

// `count` instants `intervalS` apart, oldest first, the last one at nowMs.
export function backfillTimes(count, intervalS, nowMs) {
  return Array.from({ length: count }, (_, i) => new Date(nowMs - (count - 1 - i) * intervalS * 1000));
}

// Sends one measurement, prints the outcome, updates stats.
// Returns false when sending more makes no sense.
async function deliver(config, measurement, stats, label, signal) {
  if (config.dryRun) {
    console.log(`${label} DRY-RUN value=${measurement.value}${measurement.timestamp ? ` time=${measurement.timestamp}` : ""}`);
    return true;
  }
  const result = await sendWithRetry(config, measurement, {
    signal,
    onRetry: ({ attempt, retries, delayMs, result: r }) =>
      console.log(`${label} ${describe(r, measurement)} -> ponowienie ${attempt}/${retries} za ${delayMs / 1000} s`),
  });
  console.log(`${label} ${describe(result, measurement)}`);
  switch (result.outcome) {
    case "created":
      stats.sent++;
      return true;
    case "rejected":
      stats.rejected++;
      return true;
    case "invalid":
      stats.errors++;
      return true;
    default:
      // unauthorized, fatal, or retryable after the last retry.
      stats.errors++;
      return false;
  }
}

async function runSyntheticBackfill(config, stats, signal) {
  const next = makeSource(config);
  const times = backfillTimes(config.count, config.interval, Date.now());
  for (const [i, time] of times.entries()) {
    if (signal.aborted) return;
    const measurement = { value: next(time.getTime() / 1000), timestamp: time.toISOString() };
    if (!(await deliver(config, measurement, stats, `[${i + 1}/${times.length}]`, signal))) return;
  }
}

// Waits until the next slot start + k * interval. Slots are counted from the
// start (fixed rate), so the time each send takes does not add up; slots
// missed during long retries are skipped, not sent in a burst.
// Returns false if Ctrl+C came while waiting.
async function waitForNextSlot(startMs, intervalMs, signal) {
  const elapsed = Date.now() - startMs;
  const nextSlot = (Math.floor(elapsed / intervalMs) + 1) * intervalMs;
  try {
    await sleep(startMs + nextSlot - Date.now(), undefined, { signal });
    return true;
  } catch (err) {
    if (err?.name === "AbortError") return false;
    throw err;
  }
}

// One value now, then one per interval, until --count or Ctrl+C. No timestamp:
// the server's clock sets it.
async function runSyntheticLive(config, stats, signal) {
  const next = makeSource(config);
  const startMs = Date.now();
  for (let n = 1; config.count === undefined || n <= config.count; n++) {
    if (signal.aborted) return;
    const label = config.count === undefined ? `[${n}]` : `[${n}/${config.count}]`;
    if (!(await deliver(config, { value: next(Date.now() / 1000) }, stats, label, signal))) return;
    if (n === config.count) return;
    if (!(await waitForNextSlot(startMs, config.interval * 1000, signal))) return;
  }
}

// The API knows nothing about units: humidity in % would pass the range check
// of a °C series. So the unit is shown, and a surprise is warned about.
function reportUnit(variable, unit) {
  console.log(`Open-Meteo: ${variable} w ${unit} (seria musi mieć tę samą jednostkę). Weather data by Open-Meteo.com (CC BY 4.0)`);
  if (unit !== UNITS[variable]) {
    console.warn(`UWAGA: oczekiwano jednostki ${UNITS[variable]}, Open-Meteo zwróciło ${unit}.`);
  }
}

async function runOpenMeteoBackfill(config, stats, signal) {
  const { unit, measurements } = await fetchBackfill({ ...config, hours: config.backfill });
  reportUnit(config.variable, unit);
  const selected = config.count === undefined ? measurements : measurements.slice(-config.count);
  console.log(`Open-Meteo: ${selected.length} wartości godzinowych z ostatnich ${config.backfill} h.`);
  for (const [i, measurement] of selected.entries()) {
    if (signal.aborted) return;
    if (!(await deliver(config, measurement, stats, `[${i + 1}/${selected.length}]`, signal))) return;
  }
}

// Polls current conditions every interval and sends only when current.time
// has changed: Open-Meteo updates every 15 minutes, so polling more often
// would otherwise store the same value several times. The last time is kept
// in memory only, so a restart may send the current block once more.
// The value is sent with current.time, the time it describes, not the
// (later) time it happened to be polled.
async function runOpenMeteoLive(config, stats, signal) {
  if (config.interval < 300) {
    console.warn(`UWAGA: Open-Meteo odświeża dane co 15 min; przy --interval ${config.interval} większość zapytań zwróci tę samą wartość (zalecane 300–900 s).`);
  }
  const startMs = Date.now();
  let lastTime;
  let unitShown = false;
  let delivered = 0;
  for (let poll = 1; config.count === undefined || delivered < config.count; poll++) {
    if (signal.aborted) return;
    const label = `[${poll}]`;
    try {
      const current = await fetchCurrent(config);
      if (!unitShown) {
        reportUnit(config.variable, current.unit);
        unitShown = true;
      }
      if (current.time === lastTime) {
        stats.skipped++;
        console.log(`${label} bez zmian (blok ${new Date(current.time * 1000).toISOString()}), pomijam`);
      } else {
        const measurement = { value: current.value, timestamp: new Date(current.time * 1000).toISOString() };
        if (!(await deliver(config, measurement, stats, label, signal))) return;
        lastTime = current.time;
        delivered++;
      }
    } catch (err) {
      // A passing Open-Meteo problem (network, 429, 5xx) must not end a long run.
      if (!(err instanceof OpenMeteoError)) throw err;
      stats.errors++;
      console.log(`${label} BŁĄD: ${err.message}; spróbuję w następnym cyklu`);
    }
    if (config.count !== undefined && delivered >= config.count) return;
    if (!(await waitForNextSlot(startMs, config.interval * 1000, signal))) return;
  }
}

// First Ctrl+C: finish the current request, then stop with a summary.
// Second Ctrl+C: exit at once.
function stopSignalOnCtrlC() {
  const controller = new AbortController();
  const onSignal = () => {
    if (controller.signal.aborted) {
      console.log("\nPrzerwano natychmiast.");
      process.exit(130);
    }
    console.log("\nZatrzymywanie po bieżącym wyniku... (Ctrl+C ponownie: natychmiast)");
    controller.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  return controller.signal;
}

async function main() {
  let config;
  try {
    config = parseConfig(process.argv.slice(2), process.env);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(`Error: ${err.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (config.help) {
    console.log(USAGE);
    return;
  }
  console.log("Config:", { ...config, key: maskKey(config.key) });
  if (config.dryRun) console.log("Dry run: nothing will be sent.");

  const stats = { sent: 0, rejected: 0, errors: 0, skipped: 0 };
  const signal = stopSignalOnCtrlC();
  try {
    if (config.mode !== "open-meteo") {
      if (config.backfill !== undefined) await runSyntheticBackfill(config, stats, signal);
      else await runSyntheticLive(config, stats, signal);
    } else if (config.backfill !== undefined) {
      await runOpenMeteoBackfill(config, stats, signal);
    } else {
      await runOpenMeteoLive(config, stats, signal);
    }
  } catch (err) {
    if (!(err instanceof OpenMeteoError)) throw err;
    console.error(`BŁĄD: ${err.message}`);
    stats.errors++;
  }
  const skipped = stats.skipped ? `, pominięte (bez zmian) ${stats.skipped}` : "";
  console.log(`Podsumowanie: wysłane ${stats.sent}, odrzucone ${stats.rejected}, błędy ${stats.errors}${skipped}`);
  if (stats.errors > 0) process.exitCode = 1;
}

// Run only when started from the command line, not when imported by a test.
// pathToFileURL encodes spaces (%20) the same way import.meta.url does.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
