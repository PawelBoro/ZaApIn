#!/usr/bin/env node
// Sample data (F11): four Warsaw weather series filled with Open-Meteo hourly
// values, all through the API (admin login, series, sensors, measurements).
// Safe to run again: existing series are reused and a series that already has
// enough measurements is skipped.
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import readline from "node:readline/promises";
import { sendWithRetry, describe } from "./lib/api.mjs";
import { fetchBackfill } from "./lib/openMeteo.mjs";

const LAT = 52.23;
const LON = 21.01;

export const SERIES = [
  { name: "Warszawa – temperatura", unit: "°C", minValue: -40, maxValue: 50, color: "#d62728", icon: "thermometer", variable: "temperature_2m" },
  { name: "Warszawa – wilgotność", unit: "%", minValue: 0, maxValue: 100, color: "#1f77b4", icon: "droplet", variable: "relative_humidity_2m" },
  { name: "Warszawa – ciśnienie", unit: "hPa", minValue: 900, maxValue: 1100, color: "#2ca02c", icon: "gauge", variable: "surface_pressure" },
  { name: "Warszawa – wiatr", unit: "km/h", minValue: 0, maxValue: 200, color: "#9467bd", icon: "wind", variable: "wind_speed_10m" },
];

const USAGE = `Usage: node seed-weather.mjs [options]

  --api <url>        API base URL (env ZAI_API_URL)
  --user <name>      admin login (env ZAI_ADMIN_USER)
                     password: env ZAI_ADMIN_PASSWORD, otherwise a hidden prompt
  --hours <n>        hours of Open-Meteo data to send (default 48)
  --min-count <n>    skip a series that already has this many values (default 15)
  --dry-run          show the plan, change nothing (no login)
  --help             show this help`;

// Pure: pairs each wanted series with the existing one of the same name, or null.
// The name is the key, so a second run finds what the first one created.
export function planSeries(existing, wanted) {
  return wanted.map((def) => ({ def, series: existing.find((s) => s.name === def.name) ?? null }));
}

// Pure: a series with at least minCount values already has its sample data.
export function needsBackfill(count, minCount) {
  return count < minCount;
}

// Pure: only values newer than the newest one stored, so a run that stopped
// half way does not send the same hours twice.
export function newerThan(measurements, lastTimestamp) {
  if (!lastTimestamp) return measurements;
  const lastMs = Date.parse(lastTimestamp);
  return measurements.filter((m) => Date.parse(m.timestamp) > lastMs);
}

class ApiError extends Error {}

// JSON request to the API. The first one may wait ~1 min while Render wakes up.
async function request(api, method, path, { token, body } = {}) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      Accept: "application/json, application/problem+json",
      ...(body && { "Content-Type": "application/json" }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(70_000),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // e.g. an HTML error page from the proxy while the app wakes up
  }
  if (!res.ok) throw new ApiError(`${method} ${path}: HTTP ${res.status} ${data?.detail ?? ""}`);
  return data;
}

// How many values a series has and the newest timestamp (sorted newest first).
async function seriesStats(api, id) {
  const all = await request(api, "GET", `/api/measurements?series=${id}&limit=10000&sort=-timestamp`);
  return { count: all.length, last: all[0]?.timestamp };
}

// Reads a line without echoing it, so the password is not on screen.
async function promptHidden(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  process.stdout.write(question);
  rl._writeToOutput = () => {}; // swallow the typed characters
  const answer = await rl.question("");
  rl.close();
  process.stdout.write("\n");
  return answer;
}

async function seedOne(api, token, { def, series }, { hours, minCount }) {
  const stats = series ? await seriesStats(api, series.id) : { count: 0 };
  if (!needsBackfill(stats.count, minCount)) {
    console.log(`${def.name}: ma już ${stats.count} wyników, pomijam`);
    return;
  }
  const { unit, measurements } = await fetchBackfill({ lat: LAT, lon: LON, variable: def.variable, hours });
  if (unit !== def.unit) {
    console.warn(`${def.name}: Open-Meteo zwróciło jednostkę ${unit}, seria ma ${def.unit}; pomijam`);
    return;
  }
  const toSend = newerThan(measurements, stats.last);
  if (toSend.length === 0) {
    console.log(`${def.name}: brak nowych godzin (jest ${stats.count}), pomijam`);
    return;
  }
  // The key lives only in this variable; it is never printed or saved.
  const sensor = await request(api, "POST", "/api/sensors", {
    token,
    body: { name: `Open-Meteo Warszawa – ${def.name.split(" – ")[1]}`, seriesId: series.id },
  });
  const conn = { api, key: sensor.apiKey };
  let sent = 0;
  for (const m of toSend) {
    const result = await sendWithRetry(conn, m);
    if (result.outcome === "created") sent++;
    else console.log(`  ${describe(result, m)}`);
    if (result.outcome === "unauthorized" || result.outcome === "fatal") break;
  }
  console.log(`${def.name}: czujnik ${sensor.id}, wysłano ${sent}/${toSend.length}`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      api: { type: "string" },
      user: { type: "string" },
      hours: { type: "string", default: "48" },
      "min-count": { type: "string", default: "15" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) return console.log(USAGE);
  const api = (values.api ?? process.env.ZAI_API_URL ?? "").replace(/\/+$/, "");
  const user = values.user ?? process.env.ZAI_ADMIN_USER;
  const hours = Number(values.hours);
  const minCount = Number(values["min-count"]);
  if (!api || !(hours > 0) || !(minCount > 0)) {
    console.error(`Error: --api is required, --hours and --min-count must be positive.\n\n${USAGE}`);
    process.exit(2);
  }

  // GET /api/series and /api/measurements are public, so the plan needs no login.
  const plan = planSeries(await request(api, "GET", "/api/series"), SERIES);
  if (values["dry-run"]) {
    for (const { def, series } of plan) {
      const count = series ? (await seriesStats(api, series.id)).count : 0;
      const action = !series ? "utworzę serię i wyślę dane"
        : needsBackfill(count, minCount) ? `wyślę dane (jest ${count})`
        : `pominę (jest ${count})`;
      console.log(`${def.name}: ${action}`);
    }
    return;
  }

  if (!user) {
    console.error("Error: --user (or env ZAI_ADMIN_USER) is required.");
    process.exit(2);
  }
  const password = process.env.ZAI_ADMIN_PASSWORD ?? (await promptHidden(`Hasło dla ${user}: `));
  const { accessToken: token } = await request(api, "POST", "/api/auth/login", { body: { username: user, password } });

  try {
    for (const item of plan) {
      if (!item.series) {
        const { variable, ...body } = item.def;
        item.series = await request(api, "POST", "/api/series", { token, body });
        console.log(`${item.def.name}: utworzono serię ${item.series.id}`);
      }
      await seedOne(api, token, item, { hours, minCount });
    }
  } finally {
    await request(api, "POST", "/api/auth/logout", { token });
  }

  console.log("\nPodsumowanie:");
  for (const { def, series } of plan) {
    const { count } = await seriesStats(api, series.id);
    console.log(`  ${def.name.padEnd(24)} id=${series.id}  wyników=${count}`);
  }
  console.log("Weather data by Open-Meteo.com (CC BY 4.0)");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`BŁĄD: ${err.message}`);
    process.exitCode = 1;
  });
}
