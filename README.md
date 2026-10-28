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
npm start              # or `npm run dev` to restart on file changes
curl -s localhost:3000/api/health    # {"status":"ok"}
```
