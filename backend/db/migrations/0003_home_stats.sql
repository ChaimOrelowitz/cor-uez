-- 0003_home_stats.sql
-- Two admin-editable "ticker" numbers shown on the client home/intro screen
-- (applications submitted, grants left). Manually set for now via the new
-- admin Home Stats page (PUT /api/uez/admin/home-stats).
-- Run this manually against the production Supabase project (SQL editor or psql).
-- Safe to run more than once (guarded with if-not-exists checks).
--
-- Single-row config table, same shape as uez_signup_layout: one row keyed
-- id='default'. GET /api/uez/home-stats already falls back to {0, 0} if this
-- table or row doesn't exist yet, so running this migration isn't strictly
-- required for the app to keep working - only for the numbers to persist.

create table if not exists uez_home_stats (
  id text primary key,
  applications_submitted integer not null default 0,
  grants_left integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into uez_home_stats (id, applications_submitted, grants_left)
values ('default', 0, 0)
on conflict (id) do nothing;
