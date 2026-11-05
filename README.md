# ZaApIn

Project of a web application for studies in Warsaw University of Technology

## Project structure

The application is split into separate frontend and backend projects:

```text
backend/
└── src/       # Backend application source
frontend/
├── public/    # Static files served by the frontend
└── src/       # Frontend application source
generator/     # Sensor emulator: sends measurements to the API
```

## Backend setup

Requirements: Node 22, and for Entra database auth the Azure CLI (`az`).

```bash
cd backend
npm install
cp .env.example .env     # then edit .env (it is git-ignored, never commit it)
```

Fill in `.env`:

- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` - Azure PostgreSQL connection. Use the dev database (`postgres-test`) locally.
- `DB_AUTH=entra` - no password; a token is fetched via the Azure CLI, so run `az login` first (`az login --use-device-code` in WSL).
  Use `DB_AUTH=password` and set `DB_PASSWORD` for a password-based role.
- `ADMIN_USERNAME`, `ADMIN_PASSWORD` - the admin account (password at least 8 characters).

### Database

```bash
npm run migrate        # applies db/migrations/*.sql in order; safe to run again
npm run create-admin   # creates or updates the admin from ADMIN_USERNAME / ADMIN_PASSWORD
```

### Run

```bash
npm start              # or `npm run dev` to restart on changes in src/ or .env
curl -s localhost:3000/api/health    # {"status":"ok"}
```

## Deployment

The API runs on Render (free Web Service, Frankfurt) and uses the production
database `postgres` on the Azure PostgreSQL flexible server. Two database roles:

- **Entra admin** (you, after `az login`): runs migrations, grants and
  `create-admin` from your machine. Owns the tables.
- **`zai_app`** (password login): used by the app on Render. Data only
  (SELECT/INSERT/UPDATE/DELETE), cannot create tables or roles.

### Steps (in this order)

1. Azure portal -> server -> Authentication: *PostgreSQL and Microsoft Entra
   authentication* (Render has no `az` CLI, so the app needs a password).
2. As the Entra admin, in `psql` on database `postgres`:
   `CREATE ROLE zai_app LOGIN;` then `\password zai_app`.
3. Create `backend/.env.production` (git-ignored) like `.env`, with
   `DB_NAME=postgres`, `DB_AUTH=entra` and the production admin credentials, then:
   ```bash
   npm run migrate:prod        # asks for confirmation, shows DB_HOST/DB_NAME
   psql "host=<DB_HOST> dbname=postgres user=<entra-admin> sslmode=require" \
     -v app_role=zai_app -f db/grants.sql
   npm run create-admin:prod
   ```
4. Render -> New Web Service from this repo: Root Directory `backend`,
   Build `npm ci`, Start `npm start`, Health Check Path `/api/health`.
   Node version comes from `engines` in `package.json`.
5. Azure -> Networking: add firewall rules for Render's outbound IP ranges
   (`node scripts/cidr-to-range.mjs <cidr>...` converts them to start/end).

### Environment variables on Render

`DB_HOST`, `DB_PORT` (5432), `DB_NAME` (`postgres`), `DB_USER` (`zai_app`),
`DB_AUTH` (`password`), `DB_PASSWORD`, `TOKEN_TTL_SECONDS`, `NODE_ENV`
(`production`). `PORT` is set by Render. `ADMIN_*` is not needed there: the
admin is created once from your machine, the running app never reads it.

### Free plan

The service sleeps after ~15 minutes without traffic; the next request wakes it
and can take about a minute. Auto-Deploy redeploys on every push to `main`.

## Sensor emulator (generator)

`generator/` is a command-line sensor that sends measurements with a sensor's
API key: synthetic values (uniform, random walk, sine) or real weather from
Open-Meteo, live or backfilled with past timestamps (sample data). Node >= 20,
no dependencies.

```bash
cd generator
export ZAI_API_URL=http://localhost:3000
read -rs SENSOR_API_KEY && export SENSOR_API_KEY   # key from POST /api/sensors
node sensor.mjs --mode open-meteo --lat 52.23 --lon 21.01 --backfill 48
node sensor.mjs --outlier 999                       # shows a rejected value
node --test                                         # unit tests
```

Keep the key in the environment, never in files or the command line. Options,
modes, exit codes and the Open-Meteo attribution are in
[generator/README.md](generator/README.md).

Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0).

## Sample data

`generator/seed-weather.mjs` fills the app with sample data (requirement F11):
four series of real Warsaw weather (52.23, 21.01) from the last 48 hours of
Open-Meteo hourly data, one value per hour.

| Series | Unit | Range | Icon | Open-Meteo variable |
|---|---|---|---|---|
| Warszawa – temperatura | °C | −40..50 | thermometer | `temperature_2m` |
| Warszawa – wilgotność | % | 0..100 | droplet | `relative_humidity_2m` |
| Warszawa – ciśnienie | hPa | 900..1100 | gauge | `surface_pressure` |
| Warszawa – wiatr | km/h | 0..200 | wind | `wind_speed_10m` |

Everything goes through the API, never straight into the database: the script
logs in as admin, creates the missing series, registers one sensor per series
and sends the values with that sensor's key, so they pass the same validation
as any other measurement.

```bash
cd generator
export ZAI_API_URL=http://localhost:3000 ZAI_ADMIN_USER=admin
node seed-weather.mjs --dry-run        # plan only, no login, nothing changes
node seed-weather.mjs                  # asks for the admin password (hidden)
```

| Option | Default | Meaning |
|---|---|---|
| `--api <url>` | env `ZAI_API_URL` | API base URL |
| `--user <name>` | env `ZAI_ADMIN_USER` | admin login; password from env `ZAI_ADMIN_PASSWORD` or a hidden prompt |
| `--hours <n>` | 48 | hours of data to send |
| `--min-count <n>` | 15 | skip a series that already has this many values |
| `--dry-run` | | show the plan, change nothing |

Running it again is safe: series are found by name, a series with at least
`--min-count` values is skipped, and only hours newer than the last stored
value are sent. Sensor API keys stay in the process memory only; to send live
data later, register a new sensor in the app.

Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0); the script prints
the same attribution after each run.
