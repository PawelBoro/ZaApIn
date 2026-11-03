# Sensor emulator

A command-line sensor for the ZAI API. It sends measurements to
`POST /api/measurements` with a sensor's API key: synthetic values (uniform,
random walk, sine) or real weather data from Open-Meteo, either live or
backfilled with past timestamps (sample data, F11).

Node >= 20, no dependencies: built-in `fetch`, `node:util` `parseArgs` and
`node:test`. Nothing to install.

```text
generator/
├── sensor.mjs          # CLI: options, mode selection, send loop, summary
├── lib/values.mjs      # synthetic value generators (pure functions)
├── lib/openMeteo.mjs   # Open-Meteo requests and time filtering
├── lib/api.mjs         # sending to the API, retries, response handling
└── test/               # unit tests (node --test)
```

## Setup

1. Start the API (`cd backend && npm run dev`) or use the deployed one.
2. Create a series and register a sensor for it (admin token required). The
   response to `POST /api/sensors` contains the sensor's `apiKey`. It is shown
   once; the database keeps only its hash.
3. Put the URL and the key in environment variables:

```bash
export ZAI_API_URL=http://localhost:3000
read -rs SENSOR_API_KEY && export SENSOR_API_KEY   # paste the key, then Enter
```

**Keep the key out of files and the command line.** `--key <key>` works, but
the key then lands in the shell history (`~/.bash_history`) and is visible to
other users in `ps`. `read -s` also keeps it off the screen, which matters when
recording. Never commit a key; if one leaks, delete the sensor
(`DELETE /api/sensors/{id}`) and register a new one.

## Options

| Option | Default | Meaning |
|---|---|---|
| `--api <url>` | env `ZAI_API_URL` | API base URL, e.g. `http://localhost:3000` |
| `--key <key>` | env `SENSOR_API_KEY` | sensor API key (prefer the env variable) |
| `--mode <mode>` | | `uniform`, `walk`, `sine` or `open-meteo` |
| `--min`, `--max <n>` | | value range (`uniform`, `walk`, `sine`) |
| `--step <n>` | (max-min)/20 | `walk`: largest change between values |
| `--period <s>` | 86400 | `sine`: period in seconds (one day) |
| `--noise <n>` | 0 | `sine`: random noise of up to ±n |
| `--lat`, `--lon <deg>` | | `open-meteo`: location |
| `--variable <name>` | `temperature_2m` | `open-meteo`: see [Open-Meteo](#open-meteo) |
| `--backfill <hours>` | | send past values with timestamps, then exit |
| `--count <n>` | see below | number of values |
| `--interval <s>` | 60 / 900 / 3600 | seconds between values (live / Open-Meteo live / backfill) |
| `--outlier <value>` | | send this one value and exit |
| `--dry-run` | | print what would be sent, send nothing (no key needed) |
| `--help` | | show the help |

All options are checked before anything is sent; a usage error exits with
code 2. Negative numbers need `=`: `--min=-40` (`--min -40` is read as a
flag).

## Modes

**Value source** (`--mode`):

- `uniform`: each value drawn evenly from `[min, max]`.
- `walk`: each value moves at most `--step` from the previous one, starting in
  the middle of the range and bouncing off its bounds.
- `sine`: a sine wave between `min` and `max` with `--period`, plus optional
  `--noise` (clamped to the range). The phase follows the clock, so a backfill
  and a later live run join into one curve. The default period is one day, a
  daily cycle like temperature. Keep `--interval` well below `--period`: if it
  is a whole multiple of it, every sample hits the same phase and the curve
  is a flat line (aliasing); the generator warns about it.
- `open-meteo`: real weather data, see below.

**Timing:**

- **Live** (default): one value now and one every `--interval` seconds until
  `--count` values or Ctrl+C. Synthetic values are sent without a timestamp,
  so the server's clock sets it. The schedule is fixed-rate: the time a request
  takes does not shift later values.
- **Backfill** (`--backfill <hours>`): past values with timestamps, oldest
  first, the last one at "now". Synthetic modes send `--count` values
  `--interval` seconds apart (default: hourly values covering the hours, so
  `--backfill 24` sends 24). Open-Meteo sends its hourly values of the last N
  hours.
- **Outlier** (`--outlier <value>`): one value, no timestamp, then exit. Meant
  to show a rejected value (422) in a demo.

**Ctrl+C** stops gracefully: the request in flight finishes (so its result is
known), waiting is cut short, and the summary is printed. A second Ctrl+C exits
at once (code 130).

## Examples

```bash
# Preview a sine backfill without sending anything
node sensor.mjs --mode sine --min=-40 --max 50 --period 86400 --backfill 24 --dry-run

# Sample data: 48 hourly random-walk values for the last two days
node sensor.mjs --mode walk --min=-10 --max 30 --step 1.5 --backfill 48

# Live: a uniform value every 10 s, 30 values
node sensor.mjs --mode uniform --min 18 --max 24 --interval 10 --count 30

# Real temperature in Warsaw for the last 48 hours (series in °C)
node sensor.mjs --mode open-meteo --lat 52.23 --lon 21.01 --backfill 48

# Live weather: check every 10 minutes, send only new readings
node sensor.mjs --mode open-meteo --lat 52.23 --lon 21.01 --interval 600

# Demo of a rejected value (series range e.g. -40..50)
node sensor.mjs --outlier 999
```

## Open-Meteo

Weather data by [Open-Meteo.com](https://open-meteo.com/)
([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). Using it requires
this attribution; the generator also prints it on every Open-Meteo run.

| `--variable` | Unit (Open-Meteo default) | Series should be |
|---|---|---|
| `temperature_2m` | °C | temperature in °C |
| `relative_humidity_2m` | % | humidity in % (0..100) |
| `surface_pressure` | hPa | pressure in hPa (e.g. 900..1100) |
| `wind_speed_10m` | km/h | wind speed in km/h |

- **The unit must match the series.** The API only checks the range, so a
  wrong variable is not always rejected: humidity of 45 % fits a -40..50 °C
  series and is silently stored as 45 °C. The generator prints the unit it got;
  check it against the series before sending.
- **Backfill** asks for `ceil(hours/24)` past days of hourly data. The answer
  also contains today's forecast hours; those, hours older than N, and missing
  (`null`) values are dropped.
- **Live** asks for current conditions, which Open-Meteo updates every
  15 minutes. A reading is sent only when its time has changed since the last
  one sent, so polling more often does not store duplicates. Use an interval
  of **300–900 s**: shorter ones mostly fetch the same reading again. The
  value is sent with the time of the reading. The last reading's time is kept
  in memory only, so a restart may send the current reading once more.
- The free tier allows **10 000 requests per day** (non-commercial use). One
  live generator at 300 s makes 288 requests a day.

## Results and exit codes

Each value prints one line:

| Response | Line | Then |
|---|---|---|
| 201 | `OK id=… value=… time=…` | go on |
| 422 | `ODRZUCONO value=…: <detail>` with the errors from Problem Details | go on |
| 400 | `BŁĄD 400 …` with the validation errors | go on |
| 401 | `BŁĄD 401: klucz nieprawidłowy lub czujnik wyrejestrowany.` | stop |
| network error, timeout, 5xx, 408, 429 | `BŁĄD SIECI …` / `BŁĄD SERWERA …` | retry up to 3 times (2, 4, 8 s, or as `Retry-After` says), then stop |
| any other status | `BŁĄD <status> … (czy --api wskazuje na aplikację ZAI?)` | stop |

Each request times out after 70 s: a free host may sleep, and its first
request can take about a minute.

At the end: `Podsumowanie (<time>): wysłane N, odrzucone N, błędy N`, plus the
reason if the run stopped early.

| Exit code | Meaning |
|---|---|
| 0 | no errors (rejected values do not count as errors) |
| 1 | at least one error (400, 401, unreachable server, Open-Meteo failure) |
| 2 | invalid options |
| 130 | stopped by a second Ctrl+C |

## Troubleshooting

- **Rejections do not fail the run.** A 422 means the server worked and said
  no, so the exit code stays 0 (that is what `--outlier` relies on). When
  preparing data, check `odrzucone` in the summary.
- **The last backfill value is rejected as "in the future".** The server
  accepts timestamps up to 5 minutes after its own clock; if this machine's
  clock runs ahead by more, the newest values are rejected. Sync the clock.
  Live synthetic values are not affected (the server sets their time).
- **Duplicates after retries.** POST is not idempotent: if the server stored a
  value but the response was lost (timeout, dropped connection), the retry
  stores it again. Backfill duplicates have the same timestamp and value.
- **`--min -40` is an error.** Write `--min=-40`.
- **First request is slow.** A sleeping free host wakes up on the first
  request; the generator waits up to 70 s and then retries.

## Tests

```bash
cd generator
node --test     # or: npm test
```

The tests use a fixed or seeded random source and a fixed "now", so they are
repeatable and need no network.
