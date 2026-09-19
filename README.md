# Stocka

Stocka is a hybrid desktop + web retail app:
- Desktop mode (Electron) for local operations and printer integration.
- Web mode (Vercel) for remote client testing and cloud-backed data entry.

## Local Development

- Desktop dev: `npm run dev`
- Web dev only: `npm run dev:web`
- Desktop production build: `npm run build`
- Web production build: `npm run build:web`

## Cloud Setup (Supabase)

1. Create a Supabase project.
2. Run the SQL in `supabase/schema.sql`.
3. Copy `.env.example` to `.env` and set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

## Vercel Deployment

1. Import this repo into Vercel.
2. Set environment variables from `.env.example`.
3. Vercel uses `vercel.json` and runs `npm run build:web`.

## Backups

Stocka backs itself up automatically and checks every copy before it counts. See
[`docs/backup.md`](docs/backup.md) for how the system is built and which decisions
are load-bearing — read it before changing anything under
`electron/database/backupEngine.js`, `externalBackup.js` or `offsiteBackup.js`.

- Local backups: `%APPDATA%/Stocka/backups`
- External drive and off-site copy: Settings → Backups
- Protection status: the strip on the Dashboard, and a sign-in warning when the
  external copy goes stale

## Sync Workflow

- Desktop users can open Settings -> Cloud Sync.
- Use **Upload local changes** to push local edits to cloud.
- Use **Download cloud changes** to pull web/client edits into local DB.
- The app creates a local backup snapshot before each sync action.




