#!/usr/bin/env node
// Sensor emulator: sends synthetic or Open-Meteo values to the ZAI API.
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

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
  --backfill <hours>   send past values with timestamps, then exit
  --count <n>          number of values (backfill default 24; live default unlimited)
  --interval <s>       seconds between values (default 60)
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
  const config = {
    dryRun,
    api: values.api ?? env.ZAI_API_URL,
    key: values.key ?? env.SENSOR_API_KEY,
    interval: num(values, "interval", { fallback: 60, positive: true }),
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

  if (values.backfill !== undefined) {
    config.backfill = num(values, "backfill", { positive: true });
  }
  config.count = num(values, "count", {
    fallback: config.backfill !== undefined ? 24 : undefined,
    positive: true,
    integer: true,
  });

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

function main() {
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
  if (config.dryRun) {
    console.log("Dry run: nothing will be sent.");
    return;
  }
  console.log("Sending is not implemented yet.");
}

// Run only when started from the command line, not when imported by a test.
// pathToFileURL encodes spaces (%20) the same way import.meta.url does.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
