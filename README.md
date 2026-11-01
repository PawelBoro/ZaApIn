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

Requirements: Node >= 20, and for Entra database auth the Azure CLI (`az`).

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
