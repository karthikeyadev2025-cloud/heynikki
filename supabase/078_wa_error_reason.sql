-- ══════════════════════════════════════════════════════════════
-- 078 — why a WhatsApp message failed
--
-- wa_dispatch_log said "failed" and nothing else. Meta says why — 131047
-- (outside the 24-hour window), 131026 (not on WhatsApp), 132000 (wrong
-- template parameters, which is what failed the daily summary nine evenings
-- running) — both in the send reply and in the delivery receipt, and both
-- were thrown away. Written by sendWhatsApp and the /webhooks/whatsapp
-- status handler; both carry on without it until this is applied.
-- ══════════════════════════════════════════════════════════════

alter table wa_dispatch_log
  add column if not exists error_reason text;
