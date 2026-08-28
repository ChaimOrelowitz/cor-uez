-- 0001_case_workbench.sql
-- Admin Case Workbench Refactor — first migration.
-- Run this manually against the production Supabase project (SQL editor or psql).
-- Safe to run more than once (every statement is guarded with if-not-exists / if-exists checks).
--
-- What this adds, and why:
--   1. uez_status_events.metadata   — technical detail behind an admin-only "show details" disclosure
--   2. uez_case_notes               — the admin notes journal (hard delete, per Chaim's instruction)
--   3. uez_process_steps            — the admin's operational-state overlay per UEZ step, layered on
--                                     top of (never replacing) the existing factual status columns
--   4. uez_applications.tax_clearance_status — a real tax-clearance review enum; tax_clearance_good
--                                     is kept in sync for backward compatibility only
--   5. uez_action_runs              — durable "I delegated a task, here's what happened" records,
--                                     so an action's Working/Succeeded/Failed/Ambiguous result
--                                     survives a page reload instead of living only in React state
--   6. uez_email_log.attachments    — records what was actually attached to a sent email

-- 1. Activity log: add metadata + an index for the admin Activity panel
alter table uez_status_events
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_uez_status_events_application_created
  on uez_status_events (application_id, created_at desc);

-- 2. Notes journal (hard delete — no deleted_at column)
create table if not exists uez_case_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references uez_applications(id) on delete cascade,
  author_id uuid references auth.users(id),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists idx_uez_case_notes_application
  on uez_case_notes (application_id, created_at desc);

-- 3. Process-step operational overlay
create table if not exists uez_process_steps (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references uez_applications(id) on delete cascade,
  step_key text not null check (step_key in (
    'formation', 'brc', 'pbs_mynj', 'tax_clearance',
    'uez_enrollment', 'ldc_application', 'grant_submission', 'payment'
  )),
  state text not null default 'not_started' check (state in (
    'not_started', 'in_progress', 'waiting', 'complete', 'not_applicable', 'manual'
  )),
  waiting_on text check (waiting_on in ('applicant', 'accountant', 'nj_state', 'document', 'cor_follow_up')),
  waiting_since date,
  waiting_reason text,
  manual_note text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (application_id, step_key)
);

create index if not exists idx_uez_process_steps_application
  on uez_process_steps (application_id);

-- 4. Tax clearance status enum (new review step; tax_clearance_good kept for compatibility)
alter table uez_applications
  add column if not exists tax_clearance_status text not null default 'not_started'
  check (tax_clearance_status in (
    'not_started', 'submitted_checking', 'obtained', 'issue', 'waiting', 'needs_follow_up'
  ));

update uez_applications
  set tax_clearance_status = 'obtained'
  where tax_clearance_good = true and tax_clearance_status = 'not_started';

-- 5. Durable action-run records (Working / Succeeded / Failed / Ambiguous, survives reload)
create table if not exists uez_action_runs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references uez_applications(id) on delete cascade,
  action_type text not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'ambiguous')),
  result_summary text,
  metadata jsonb not null default '{}'::jsonb,
  initiated_by uuid references auth.users(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_uez_action_runs_application
  on uez_action_runs (application_id, started_at desc);

-- 6. Email attachments (Resend supports attachments; nothing in the app used them until now)
alter table uez_email_log
  add column if not exists attachments jsonb not null default '[]'::jsonb;
