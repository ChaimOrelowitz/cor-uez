-- 0004_messages.sql
-- Client communications pulled from / sent through Gmail, shown on each case's
-- timeline next to the activity log. One row per (case, Gmail message): the
-- same message can belong to two cases if they share an email address.
-- Run this manually against the production Supabase project (SQL editor).
-- Safe to run more than once.

create table if not exists uez_messages (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references uez_applications(id) on delete cascade,
  channel text not null default 'email',
  direction text not null check (direction in ('inbound', 'outbound')),
  provider text not null default 'gmail',
  gmail_message_id text not null,
  gmail_thread_id text,
  rfc_message_id text,
  from_address text,
  from_name text,
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  subject text,
  snippet text,
  body_text text,
  -- [{ filename, mimeType, size, storagePath, contentId }]
  attachments jsonb not null default '[]'::jsonb,
  template_key text,
  sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (application_id, gmail_message_id)
);

create index if not exists idx_uez_messages_application_sent
  on uez_messages (application_id, sent_at desc);

create index if not exists idx_uez_messages_gmail_id
  on uez_messages (gmail_message_id);

-- Which client addresses have had their full Gmail history imported. Anything
-- not in here (a new case, a new owner email) gets backfilled on the next sync.
create table if not exists uez_gmail_backfill (
  email text primary key,
  message_count integer not null default 0,
  backfilled_at timestamptz not null default now()
);

-- Single-row incremental sync cursor (Gmail historyId).
create table if not exists uez_gmail_sync (
  id text primary key,
  history_id text,
  last_synced_at timestamptz
);

alter table uez_messages enable row level security;
alter table uez_gmail_backfill enable row level security;
alter table uez_gmail_sync enable row level security;
