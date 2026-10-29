# LDC POC: UEZ Zone Dashboard

Standalone proof of concept for LDC Lakewood. It does not touch the signup app's code.

It logs into the state UEZ portal (portal03.nj.gov) with a zone's own login and pulls:
- the full business list for the zone,
- the statewide Companies Due (next 60 days) and Companies Late reports,
- each active business's detail page (contact, address, next annual/recert dates, jobs, state notes; ~400 per night).

Then it shows deadlines, tracks filings and changes, and keeps a local outreach log.
Every zone can view every other zone. Outreach is limited to your own zone.

## Folders
- `schema.sql`: run once in the Supabase SQL editor (already done).
- `backend/`: Node API and sync worker (Docker, for Render).
- `frontend/`: React dashboard (Vite, for Vercel).

## Deploy (all in web dashboards)

**Render: backend**
1. New → Web Service → pick the `cor-uez` repo.
2. Root Directory: `ldc-poc/backend`. Runtime: Docker.
3. Plan: Free works for the POC, but it sleeps when idle, so the nightly sync won't run; use "Sync now" instead. Starter keeps it awake and runs the nightly sync.
4. Environment variables (see `backend/.env.example`):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`: same values as the signup API service
   - `UEZ_ENCRYPTION_KEY`: any long random string
   - `FRONTEND_URL`: the Vercel URL from below (add it after step 2 there)

**Vercel: frontend**
1. Add New → Project → pick the `cor-uez` repo.
2. Root Directory: `ldc-poc/frontend`. Framework: Vite.
3. Environment variables (see `frontend/.env.example`):
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`: same values as the signup site
   - `VITE_API_URL`: the Render URL from above

## First run
Open the Vercel URL and sign in with your COR admin account. LDC Lakewood is already set up, so enter the UEZ portal login.
The first sync starts right away. Use the Admin tab to invite LDC staff.
