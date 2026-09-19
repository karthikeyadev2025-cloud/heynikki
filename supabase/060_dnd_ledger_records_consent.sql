-- The compliance ledger was empty of every call we actually placed.
--
-- dnd_scrub_results only accepted source 'provider' or 'unavailable', and
-- scrubDnd returned before writing anything on the two branches that decide
-- a real dial: a withdrawal ("stop calling me") and consent. With no DND
-- provider configured, consent is the ONLY branch that lets a call through —
-- so the table recorded the lookups we never made and none of the calls we
-- did. An auditor asking on what basis a number was rung had nothing to read.
alter table public.dnd_scrub_results
  drop constraint if exists dnd_scrub_results_source_check;

alter table public.dnd_scrub_results
  add constraint dnd_scrub_results_source_check
  check (source in ('provider', 'unavailable', 'consent', 'opted_out'));

comment on column public.dnd_scrub_results.source is
  'provider  = a DND registry answered
   unavailable = we asked and could not get an answer (never served from cache)
   consent   = the number was dialled on recorded consent (call recording,
               a declared list, or a self-submitted enquiry form)
   opted_out = the number had withdrawn; the call was refused';
