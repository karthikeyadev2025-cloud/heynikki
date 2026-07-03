-- 010_outbound_call_sid.sql
--
-- Adds the column that makes outbound call dispatch actually correlate-
-- able back to a specific campaign recipient once the call connects.
--
-- Why this exists: Exotel's CustomField parameter is documented as being
-- passed to Passthru/Greeting applets via GET request — it's NOT
-- confirmed (in the docs available) that it threads through to a
-- Voicebot Applet's WebSocket `start` event the same way. Rather than
-- guess and risk silent correlation failures on a real call, this uses
-- the Exotel CallSid instead — which IS guaranteed present in the start
-- event (already used for inbound calls today) — as the correlation key.
-- Store it here at dispatch time, look it up when the call connects.

alter table public.outbound_recipients
  add column if not exists exotel_call_sid text;

create index if not exists idx_outbound_recipients_call_sid
  on public.outbound_recipients(exotel_call_sid)
  where exotel_call_sid is not null;
