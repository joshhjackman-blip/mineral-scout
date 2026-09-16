-- Call log rows keep date/time (called_at), a designation, and notes.
-- outcome stays the phone-button result; 'logged' covers a typed-in entry.
--
-- Idempotent; run in the Supabase SQL editor if the table already exists.

alter table public.deal_phone_calls
  add column if not exists notes text;

alter table public.deal_phone_calls
  add column if not exists designation text;

alter table public.deal_phone_calls
  drop constraint if exists deal_phone_calls_outcome_check;

alter table public.deal_phone_calls
  add constraint deal_phone_calls_outcome_check
  check (outcome in (
    'no_answer',
    'voicemail',
    'connected',
    'wrong_number',
    'busy',
    'do_not_call',
    'logged'
  ));
