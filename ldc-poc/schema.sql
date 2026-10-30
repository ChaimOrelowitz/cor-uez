-- UEZ Zone Dashboard (pilot: LDC Lakewood)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- All tables have RLS on with no policies: only the backend (service key) can read/write them.

create table if not exists uez_zones (
  name text primary key,                 -- e.g. LAKEWOOD (as the state portal spells it)
  state_zone_id int,                     -- e.g. 19
  created_at timestamptz not null default now()
);

create table if not exists uez_zone_orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,                    -- e.g. LDC Lakewood
  zone_name text references uez_zones(name),
  created_at timestamptz not null default now()
);

create table if not exists uez_zone_members (
  org_id uuid not null references uez_zone_orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('admin', 'staff')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- One state-portal login per zone org (encrypted with UEZ_ENCRYPTION_KEY, same as uez_credentials).
create table if not exists uez_zone_portal_logins (
  org_id uuid primary key references uez_zone_orgs(id) on delete cascade,
  username_enc bytea not null,
  password_enc bytea not null,
  portal_user text,
  status text not null default 'untested' check (status in ('untested', 'ok', 'failed')),
  last_checked_at timestamptz,
  last_error text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists uez_zone_businesses (
  file_no text primary key,
  zone_name text not null,
  permit_no text,
  name text,
  trade_name text,
  status text,                           -- A = active, I = inactive
  cert_date date,
  last_annual_date date,
  last_recert_date date,
  extension_date date,
  next_annual_due date,                  -- from detail page
  next_recert_due date,                  -- from detail page
  email text,
  phone text,
  owner_name text,
  owner_title text,
  street text, city text, state text, zip text, block text, lot text,
  mailing_address text,
  sic_code text, sic_desc text, naics_code text, naics_desc text, nature text,
  entity_type text, business_size text, began_date date,
  minority_owned boolean, women_owned boolean, new_business boolean,
  employment jsonb,
  state_notes jsonb,
  -- From the statewide Companies Due / Late reports
  report_type text,                      -- AR (annual report) or RCRT (recertification)
  report_next_due date,
  report_days_late int,
  on_due_report boolean not null default false,
  on_late_report boolean not null default false,
  ft_orig int,
  ft_curr int,
  report_contact_name text,
  report_contact_phone text,
  report_contact_email text,
  -- Bookkeeping
  in_zone_listing boolean not null default false,
  listing_synced_at timestamptz,
  detail_synced_at timestamptz,
  report_synced_at timestamptz,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists uez_zone_businesses_zone_idx on uez_zone_businesses (zone_name, status);

create table if not exists uez_zone_business_events (
  id bigserial primary key,
  file_no text not null references uez_zone_businesses(file_no) on delete cascade,
  zone_name text not null,
  kind text not null,                    -- new_business, annual_filed, recertified, inactivated, reactivated
  detail jsonb,
  detected_at timestamptz not null default now()
);
create index if not exists uez_zone_business_events_zone_idx on uez_zone_business_events (zone_name, detected_at desc);

create table if not exists uez_zone_sync_runs (
  id bigserial primary key,
  org_id uuid references uez_zone_orgs(id) on delete set null,
  zone_name text,
  trigger text not null,                 -- nightly, manual, connect
  status text not null default 'running' check (status in ('running', 'ok', 'failed')),
  stats jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Local outreach log. Only the business's own zone can write here (enforced in the API).
create table if not exists uez_zone_outreach (
  id uuid primary key default gen_random_uuid(),
  file_no text not null references uez_zone_businesses(file_no) on delete cascade,
  org_id uuid not null references uez_zone_orgs(id) on delete cascade,
  user_id uuid references auth.users(id),
  user_email text,
  channel text not null check (channel in ('call', 'email', 'text', 'visit', 'note')),
  outcome text,                          -- reached, left_message, no_answer, helped_file, wrong_contact, other
  note text,
  follow_up_on date,
  created_at timestamptz not null default now()
);
create index if not exists uez_zone_outreach_file_idx on uez_zone_outreach (file_no, created_at desc);

alter table uez_zones enable row level security;
alter table uez_zone_orgs enable row level security;
alter table uez_zone_members enable row level security;
alter table uez_zone_portal_logins enable row level security;
alter table uez_zone_businesses enable row level security;
alter table uez_zone_business_events enable row level security;
alter table uez_zone_sync_runs enable row level security;
alter table uez_zone_outreach enable row level security;

-- Pilot org
insert into uez_zones (name, state_zone_id) values ('LAKEWOOD', 19) on conflict (name) do nothing;
insert into uez_zone_orgs (name, zone_name)
select 'LDC Lakewood', 'LAKEWOOD'
where not exists (select 1 from uez_zone_orgs where name = 'LDC Lakewood');

-- v2: myNJ login (required before the UEZ portal)
alter table uez_zone_portal_logins add column if not exists mynj_username_enc bytea;
alter table uez_zone_portal_logins add column if not exists mynj_password_enc bytea;

-- v3: email (Resend), per-zone settings, per-user profile
-- Per-user profile + their own portal logins (optional; org login is the fallback).
alter table uez_zone_members add column if not exists first_name text;
alter table uez_zone_members add column if not exists last_name text;
alter table uez_zone_members add column if not exists phone text;
alter table uez_zone_members add column if not exists email text;
alter table uez_zone_members add column if not exists mynj_username_enc bytea;
alter table uez_zone_members add column if not exists mynj_password_enc bytea;
alter table uez_zone_members add column if not exists uez_username_enc bytea;
alter table uez_zone_members add column if not exists uez_password_enc bytea;

-- Per-zone email identity + reminder settings.
alter table uez_zone_orgs add column if not exists from_name text;          -- e.g. "Lakewood UEZ"
alter table uez_zone_orgs add column if not exists reply_to text;           -- zone inbox replies go to
alter table uez_zone_orgs add column if not exists signature text;          -- closing line in emails
alter table uez_zone_orgs add column if not exists recert_video_url text;   -- how-to-recertify video
alter table uez_zone_orgs add column if not exists pbs_login_url text default 'https://portal03.nj.gov/ords_apex_oit/f?p=404:LOGIN';
alter table uez_zone_orgs add column if not exists reminder_days int[] default '{60,30,7}';
alter table uez_zone_orgs add column if not exists send_thankyou boolean default true;
-- Safety: emails only reach real businesses when live. Off = log only (test mode).
alter table uez_zone_orgs add column if not exists email_live boolean default false;
alter table uez_zone_orgs add column if not exists test_recipient text;     -- where test/suppressed mail goes

create table if not exists uez_zone_email_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references uez_zone_orgs(id) on delete cascade,
  file_no text references uez_zone_businesses(file_no) on delete set null,
  kind text not null,                       -- reminder_ar, reminder_recert, thankyou, test
  to_email text,
  subject text,
  status text not null,                      -- sent, suppressed, failed
  provider_id text,                          -- Resend message id
  error text,
  sent_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists uez_zone_email_log_idx on uez_zone_email_log (org_id, created_at desc);
create index if not exists uez_zone_email_log_file_idx on uez_zone_email_log (file_no, created_at desc);

alter table uez_zone_email_log enable row level security;

-- Default identity for the pilot org
update uez_zone_orgs set from_name = 'Lakewood UEZ'
  where name = 'LDC Lakewood' and from_name is null;

-- Pilot defaults: Lakewood recert how-to video
update uez_zone_orgs set recert_video_url = 'https://thelcsc.org/uezrecert'
  where name = 'LDC Lakewood' and recert_video_url is null;
