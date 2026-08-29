# WhatsApp templates to submit

Five onboarding templates. Until Meta approves them, those steps fall through
to free-form text — which the API **accepts and then silently drops** outside
the 24-hour window, so the send looks successful and nothing arrives.

Submit at **Meta Business Suite → WhatsApp Manager → Message templates**, on
WABA `1082855697732160`.

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
{{1}} — మీ KYC verify అయింది.

ఇప్పుడు మీ business number assign చేస్తున్నాము.
Number live అయిన వెంటనే మీకు message వస్తుంది.
```
Sample: `Ravi Clinic`

## 3. `onboarding_number_live` · te · UTILITY
{{1}} = business name, {{2}} = the assigned number

```
{{1}} — మీ HeyNikki number live అయింది: {{2}}

ఈ number కి call చేసి Nikki ని మీరే test చేయండి.
ప్రతి call మీ dashboard లో కనిపిస్తుంది.
```
Sample: `Ravi Clinic`, `8633502033`

> Two variables. `sendTemplateViaMeta` currently passes one (the business
> name). Wire the number in when this one is approved, or submit it with a
> single variable and keep the number in the free-text follow-up.

## 4. `onboarding_setup_reminder` · te · UTILITY
{{1}} = business name

```
{{1}} — మీ Nikki ఇంకా పూర్తిగా setup కాలేదు.

మీ services మరియు timings చెప్తే, Nikki మీ customers కి సరిగ్గా answer చేస్తుంది.
Dashboard లో Setup page చూడండి.
```
Sample: `Ravi Clinic`

## 5. `onboarding_credits_low` · te · UTILITY
{{1}} = business name

```
{{1}} — మీ free minutes అయిపోతున్నాయి.

Calls ఆగిపోకుండా ఉండాలంటే dashboard లో plan activate చేయండి.
```
Sample: `Ravi Clinic`

---

## Already approved (do not resubmit)

| name | lang | used for |
|---|---|---|
| `appointment_confirmed` | en | in-call booking confirmation |
| `missed_call_followup` | en | unanswered inbound call |
| `interested_lead_brochure` | en | brochure after a qualified call |

## Still missing, and worth adding

- **`appointment_reminder`** — the 24-hour reminder job sends free text today,
  so it only lands if the customer happens to have replied within the window.
- **`lead_capture_ack`** — the website-form acknowledgement, same problem.

Both currently report success and deliver nothing outside the window.
