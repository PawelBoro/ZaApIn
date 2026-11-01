// Weather data by Open-Meteo.com (CC BY 4.0), free tier: 10 000 requests/day.

const BASE_URL = "https://api.open-meteo.com/v1/forecast";

// Open-Meteo's default units; the target series must use the same ones.
export const UNITS = {
  temperature_2m: "°C",
  relative_humidity_2m: "%",
  surface_pressure: "hPa",
  wind_speed_10m: "km/h",
};

export class OpenMeteoError extends Error {}

// Hourly data from ceil(hours / 24) past days up to the end of today.
// The result includes forecast hours after now; selectBackfill drops them.
export function backfillUrl({ lat, lon, variable, hours }) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: variable,
    past_days: String(Math.ceil(hours / 24)),
    forecast_days: "1",
    timeformat: "unixtime",
  });
  return `${BASE_URL}?${params}`;
}

// Pure: from hourly.time[] (Unix seconds) and hourly[variable][], keeps the
// hours in (now - hours, now], skipping nulls (no model data for that hour).
// Oldest first, as { value, timestamp } ready to send.
export function selectBackfill(hourly, variable, { hours, nowMs }) {
  const times = hourly?.time;
  const values = hourly?.[variable];
  if (!Array.isArray(times) || !Array.isArray(values)) {
    throw new OpenMeteoError(`Odpowiedź Open-Meteo nie zawiera godzinowych danych ${variable}.`);
  }
  const oldestMs = nowMs - hours * 3600 * 1000;
  const selected = [];
  for (let i = 0; i < times.length; i++) {
    const ms = times[i] * 1000;
    const value = values[i];
    if (ms > nowMs) continue; // forecast, not a measurement
    if (ms <= oldestMs) continue; // older than asked for
    if (value === null || value === undefined) continue;
    selected.push({ value, timestamp: new Date(ms).toISOString() });
  }
  return selected.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// GET with a timeout; Open-Meteo errors come as { error: true, reason }.
export async function fetchJson(url, { timeoutMs = 30_000 } = {}) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const why = err?.name === "TimeoutError" ? `brak odpowiedzi w ciągu ${timeoutMs / 1000} s` : (err.cause?.code ?? err.message);
    throw new OpenMeteoError(`Open-Meteo nieosiągalne: ${why}`);
  }
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Left null: reported below.
  }
  if (!res.ok || body?.error) {
    throw new OpenMeteoError(`Open-Meteo ${res.status}: ${body?.reason ?? text.slice(0, 200)}`, { cause: { status: res.status } });
  }
  if (body === null) throw new OpenMeteoError("Open-Meteo zwróciło odpowiedź, która nie jest JSON-em.");
  return body;
}

// Current conditions. Open-Meteo updates them every 15 minutes; current.time
// is the start of that 15-minute block.
export function currentUrl({ lat, lon, variable }) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: variable,
    timeformat: "unixtime",
  });
  return `${BASE_URL}?${params}`;
}

// Pure: { time (Unix seconds), value } from a `current` response.
export function parseCurrent(body, variable) {
  const time = body?.current?.time;
  const value = body?.current?.[variable];
  if (typeof time !== "number" || typeof value !== "number") {
    throw new OpenMeteoError(`Odpowiedź Open-Meteo nie zawiera bieżącej wartości ${variable}.`);
  }
  return { time, value, unit: body.current_units?.[variable] };
}

export async function fetchCurrent({ lat, lon, variable }) {
  return parseCurrent(await fetchJson(currentUrl({ lat, lon, variable })), variable);
}

// Hourly values of the last `hours` hours, plus the unit Open-Meteo used.
export async function fetchBackfill({ lat, lon, variable, hours }, nowMs = Date.now()) {
  const body = await fetchJson(backfillUrl({ lat, lon, variable, hours }));
  return {
    unit: body.hourly_units?.[variable],
    measurements: selectBackfill(body.hourly, variable, { hours, nowMs }),
  };
}
