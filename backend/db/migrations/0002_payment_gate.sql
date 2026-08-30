-- 0002_payment_gate.sql
-- Payment moved to the penultimate step, admin-triggered, client gated until paid.
-- Run this manually against the production Supabase project (SQL editor or psql).
-- Safe to run more than once (guarded with if-not-exists checks).
--
-- What this adds, and why:
--   1. uez_applications.payment_requested_at — set when an admin explicitly asks
--      the client to pay (new "Request Payment" action), instead of the payment
--      card always being visible to the client from the moment they sign up.
--      Null = client sees no payment ask yet.

alter table uez_applications
  add column if not exists payment_requested_at timestamptz;
