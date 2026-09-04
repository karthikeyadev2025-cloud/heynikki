-- Calls that produced an appointment row were filed with the intent of their
-- LAST turn (usually "enquiry" — the caller's closing "సరే, థాంక్స్"), so the
-- dashboard's Appointment filter showed 0 calls for a clinic with four
-- bookings. The pipeline now files a booked call as "appointment" at hangup
-- (NikkiAgent.final_intent); this relabels the ones already on record.
update calls
   set intent = 'appointment'
 where appointment_created = true
   and coalesce(intent, '') not in ('appointment', 'emergency');
