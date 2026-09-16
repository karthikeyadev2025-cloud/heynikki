-- One calls row per FreeSWITCH channel.
--
-- The pipeline retries /webhooks/freeswitch/inbound when it times out, and
-- each attempt inserted a row: on 13 Sep one outbound call to 8885490495
-- produced two rows at the same instant (one 'missed' 0s, one 'completed' 8s).
-- The hangup hook's .single() then matched neither, so the call was never
-- completed or billed. The API now reuses an existing row; this index makes
-- that a guarantee under a concurrent retry.
--
-- Existing duplicates (2 channels as of 16 Sep) are detached, not deleted:
-- the oldest row keeps the channel id, later ones keep their data with a
-- NULL livekit_room_id so the index can be built.
with ranked as (
  select id,
         row_number() over (partition by livekit_room_id order by created_at, id) as rn
  from calls
  where livekit_room_id is not null
)
update calls c
   set livekit_room_id = null,
       status = case when c.status = 'active' then 'failed' else c.status end
  from ranked r
 where c.id = r.id and r.rn > 1;

create unique index if not exists calls_livekit_room_id_uniq
  on calls (livekit_room_id) where livekit_room_id is not null;
