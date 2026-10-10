-- ══════════════════════════════════════════════════════════════
-- 072 — the photo a customer sent on WhatsApp
--
-- wa_inbound (036) kept a message's text and nothing else, so a photo, a
-- voice note or a document arrived as the word "[image]". Meta does not
-- send the file — it sends an id the file can be fetched under — and the id
-- was not stored, so the picture could not be shown anywhere. The platform
-- number is on the Cloud API and cannot be opened in the WhatsApp app, which
-- left those messages unreadable by anyone.
--
--   media_id    the id Meta serves the file under (about 30 days)
--   media_mime  image/jpeg, audio/ogg, application/pdf …
--   media_name  the file name, for documents
--
-- A caption, when there is one, is the message body.
-- ══════════════════════════════════════════════════════════════

alter table wa_inbound
  add column if not exists media_id   text,
  add column if not exists media_mime text,
  add column if not exists media_name text;
