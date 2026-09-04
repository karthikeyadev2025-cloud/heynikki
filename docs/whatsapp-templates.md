# WhatsApp templates

All five onboarding templates were **submitted to WABA `1082855697732160` and
are PENDING** Meta review. Nothing to do here unless one is rejected.

Until they are approved these steps fall through to free-form text — which the
API **accepts and then silently drops** outside the 24-hour window, so the send
looks successful and nothing arrives.

## Rule that rejected four of them on the first attempt

> Variables can't be at the start or end of the template.
> *(error_user_title: "Leading or trailing params not allowed")*

`శుభవార్త! {{1}} కోసం మీ KYC verify అయింది.` is rejected; `శుభవార్త! {{1}} కోసం …` is accepted.
The bodies below are the corrected, submitted versions. Any new template has to
open and close with literal text.

The `name` and `language` below must match exactly what the code sends
(`WA_TEMPLATES` in `api-server/src/index.ts`). A mismatch returns error 132001,
"Template name does not exist in the translation".

Category for all five: **UTILITY** — they are transactional account updates,
not marketing. Submitting them as MARKETING invites rejection and, where a
user has opted out of marketing, silent non-delivery.

---

## 1. `onboarding_welcome` · te · UTILITY
{{1}} = business name

```
నమస్కారం {{1}}! HeyNikki ని ఎంచుకున్నందుకు ధన్యవాదాలు.

మీ account ready అయింది — 100 free minutes కూడా add చేశాము.
మీ business number setup కోసం మా team త్వరలో సంప్రదిస్తుంది.
```
Sample: `Ravi Clinic`

## 2. `onboarding_kyc_verified` · te · UTILITY
{{1}} = business name

```
శుభవార్త! {{1}} కోసం మీ KYC verify అయింది.

ఇప్పుడు మీ business number assign చేస్తున్నాము.
Number live అయిన వెంటనే మీకు message వస్తుంది.
```
Sample: `Ravi Clinic`

## 3. `onboarding_number_live` · te · UTILITY
{{1}} = business name, {{2}} = the assigned number

```
అభినందనలు! {{1}} కోసం మీ HeyNikki number live అయింది: {{2}}

ఈ number కి call చేసి Nikki ని మీరే test చేయండి.
ప్రతి call మీ dashboard లో కనిపిస్తుంది.
```
Sample: `Ravi Clinic`, `8633502033`

> Two variables. `sendWhatsApp` now accepts `template_params`, and the
> onboarding job passes `[business_name, did_number]` for this step.

## 4. `onboarding_setup_reminder` · te · UTILITY
{{1}} = business name

```
గుర్తు చేస్తున్నాము: {{1}} కోసం మీ Nikki ఇంకా పూర్తిగా setup కాలేదు.

మీ services మరియు timings చెప్తే, Nikki మీ customers కి సరిగ్గా answer చేస్తుంది.
Dashboard లో Setup page చూడండి.
```
Sample: `Ravi Clinic`

## 5. `onboarding_credits_low` · te · UTILITY
{{1}} = business name

```
గమనిక: {{1}} కోసం మీ free minutes అయిపోతున్నాయి.

Calls ఆగిపోకుండా ఉండాలంటే dashboard లో plan activate చేయండి.
```
Sample: `Ravi Clinic`

---

## Already approved (do not resubmit)

| name | lang | used for |
|---|---|---|
| `appointment_confirmed` | en | in-call booking confirmation |
| `missed_call_followup` | en | unanswered inbound call |
| `interested_lead_brochure` | en | brochure after a qualified call — **MARKETING category**, so it is blocked for anyone opted out of marketing. Worth resubmitting as UTILITY. |

## Still missing, and worth adding

- **`booking_incomplete_callback`** — below. Not yet submitted. Until it is
  approved the two-hour abandoned-booking chase reports success and delivers
  nothing, because a caller phoning us does not open the 24-hour window.

### Do not trust this section without checking

`appointment_reminder` and `lead_capture_ack` were listed here as missing
long after Meta had approved both. Acting on that stale note, a reminder
failure was diagnosed that did not exist. The WABA is the source of truth,
not this file:

```
curl -s "https://graph.facebook.com/$META_WA_API_VERSION/$META_WA_WABA_ID/message_templates?fields=name,status,language,category&limit=100" \
  -H "Authorization: Bearer $META_WA_TOKEN"
```

Verified against WABA 1082855697732160 on 2026-09-03: 13 templates, all
APPROVED — appointment_confirmed, appointment_reminder, daily_business_summary,
hello_world, interested_lead_brochure, lead_brochure_details, lead_capture_ack,
missed_call_followup, onboarding_account_ready, onboarding_credits_low,
onboarding_kyc_verified, onboarding_number_active, onboarding_setup_reminder.

---

## 6. `booking_incomplete_callback` · te · UTILITY — NOT YET SUBMITTED

Sent two hours after a call where Nikki opened an appointment and never got a
date and time. The caller phoned us, which does **not** open the 24-hour
service window, so this only ever works as an approved template.

Meta Business Manager → WhatsApp Manager → Message templates → Create template.
Paste these exactly:

| Field | Value |
|---|---|
| Name | `booking_incomplete_callback` |
| Category | **Utility** (not Marketing — it is a reply to their own request) |
| Language | Telugu (`te`) |
| Header | none |
| Footer | none |
| Buttons | none |

Body — one variable, `{{1}}` = business name:

```
నమస్కారం! మీరు {{1}} కి appointment కోసం call చేశారు, కానీ మనం date మరియు time confirm చేయలేదు.

మీకు అనుకూలమైన సమయం చెప్పడానికి మళ్ళీ call చేయండి. ధన్యవాదాలు! 🙏
```

Sample value for `{{1}}`: `Ravi Clinic`

Nothing in the code changes when it is approved — `WA_TEMPLATES.booking_incomplete`
already points at this exact name and language, and the scheduler passes the
business name as the single parameter. Confirm it went live with:

```
curl -s "https://graph.facebook.com/$META_WA_API_VERSION/$META_WA_WABA_ID/message_templates?fields=name,status&limit=100" \
  -H "Authorization: Bearer $META_WA_TOKEN" | grep -o 'booking_incomplete_callback[^}]*'
```

---

## 7. `appointment_confirmed_slot` · te · UTILITY — NOT YET SUBMITTED

The approved `appointment_confirmed` (en) takes only the business name, so
every confirmation ever delivered said the appointment was confirmed and never
**when**. The date and time went in a free-text follow-up that Meta drops
outside the 24-hour window — and a phone call never opens that window. This
template carries the slot itself. The code already prefers it
(`WA_TEMPLATE_PREFERRED.confirmation`) and falls back to the old one until Meta
approves it, so nothing changes on approval day.

| Field | Value |
|---|---|
| Name | `appointment_confirmed_slot` |
| Category | **Utility** |
| Language | Telugu (`te`) |
| Header / Footer / Buttons | none |

Body — `{{1}}` business name, `{{2}}` date, `{{3}}` time:

```
{{1}} లో మీ appointment confirm అయింది.

📅 {{2}}
⏰ {{3}}

మార్చాలంటే లేదా రద్దు చేయాలంటే ఈ message కి reply చేయండి. ధన్యవాదాలు! 🙏
```

Samples: `Ravi Clinic` · `Thu, 4 Sep 2026` · `8:30 PM`

## 8. `appointment_reminder_today` · te · UTILITY — NOT YET SUBMITTED

`appointment_reminder` says "రేపు" in its fixed text, so it cannot be used
for a same-day reminder. The scheduler sends this one 90–180 minutes before
the slot for any confirmed appointment that did not get the evening-before
reminder — same-day bookings, and bookings made after 21:00 for the next
morning. Until it is approved those sends fail and are retried on each tick
inside that window; nobody receives a wrong "tomorrow".

| Field | Value |
|---|---|
| Name | `appointment_reminder_today` |
| Category | **Utility** |
| Language | Telugu (`te`) |
| Header / Footer / Buttons | none |

Body — `{{1}}` business name, `{{2}}` time:

```
గుర్తు చేస్తున్నాము: {{1}} లో మీ appointment ఈరోజు {{2}} కి ఉంది.

రాలేకపోతే ఈ message కి reply చేయండి, మేము వేరే time ఇస్తాము.
```

Samples: `Ravi Clinic` · `8:30 PM`

Both can also be submitted from the shell instead of Business Manager:

```
curl -s -X POST "https://graph.facebook.com/$META_WA_API_VERSION/$META_WA_WABA_ID/message_templates" \
  -H "Authorization: Bearer $META_WA_TOKEN" -H "Content-Type: application/json" \
  -d @docs/templates/appointment_confirmed_slot.json
```
