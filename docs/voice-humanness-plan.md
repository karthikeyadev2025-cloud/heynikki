# Nikki Humanness Build Plan
**Goal: the most human-sounding Telugu phone agent on the market. Ranking metric: perceived-humanness gain ÷ engineering cost. Latency variance and turn-taking beat features.**

---

## Competitive read

Every serious India platform (Sarvam, Gnani, Ori, Rezo, Skit, Verloop, even Meesho's ElevenLabs deployment) *claims* Telugu but publicly *demonstrates* Hindi/Hinglish — Sarvam's own flagship demo ran Hindi/Tamil/Bengali, rates its Telugu code-switching only "medium," and third-party Sarvam tests skipped Telugu entirely. The one identical-positioning competitor is Zudu AI (Telugu-first, Tenglish, sub-1s claim), but it is demo-gated with no published pricing, and the crowd below it (Edesy, Vomyra, Outpero, Bolna) are SEO wrappers on the same Sarvam pipeline Nikki already runs — meaning nobody underneath us has a *different engine*, only different tuning. Meanwhile marketing latency claims cluster at 380–600ms but real integrations measure 1.2–4s, so a genuinely measured sub-1s P95 on Indian cellular calls beats most shipped product regardless of model choice. **The single sharpest differentiator to press: receipts.** Publish real recorded Telugu phone calls — Telangana/Coastal/Rayalaseema callers, Tenglish, backchannels handled correctly, per-stage latency numbers on screen — because in a market where Telugu is claimed everywhere and demonstrated nowhere, the vendor who plays the tape wins the Hyderabad sales conversation. Everything below is in service of making that tape undeniable.

---

## A. This-week quick wins (ranked by humanness/cost)

### A1. Per-stage latency instrumentation (prerequisite for verifying everything else)
- **WHAT:** Timestamp every turn at endpoint, STT-done, LLM-first-token, TTS-first-broadcast; persist per-call arrays; compute fleet p50/p95.
- **WHY:** Sierra's practice of per-stage timing traces is what makes latency work verifiable; the industry gap between vendor claims and production is 2–4x and only fleet percentiles reveal it. Targets: <800ms p50, <1400ms p95 (2026 production benchmarks).
- **HOW:** Capture `time.monotonic()` in `_run_turn` (main.py:2880–2926) at each stage; append a compact array to the call row in the cleanup `updates` dict (main.py:3529); add a percentile view to `/health`.
- **EFFORT:** 3–4 hours.
- **VERIFY:** Dashboard shows p50/p95 per stage over last 100 calls. This is the ruler for A2–B5.

### A2. Barge-in confirmation window + backchannel set
- **WHAT:** Stop `uuid_break` firing on a single 20ms frame; require ~250ms of sustained voiced energy, and never yield to Telugu backchannels.
- **WHY:** PolyAI's doctrine: *a false barge-in is more damaging than a missed one* — an agent that stops for coughs/TV reads worse than briefly talking over a caller. False barge-in on Indian backchannels ('haan'/'avunu'/'sare') is the documented #1 vernacular failure mode; Vapi ships `voiceSeconds` 0.2s + `numWords` 2–3 as defaults for exactly this.
- **HOW:** In the receive loop (main.py:3468–3473), replace the single-frame `if is_speech and speaking["until"]` with a `barge_confirm_frames` counter (~250ms ÷ `frame_secs` consecutive speech frames) before `uuid_break`. Keep an instant path only for energy ≫ threshold sustained ≥2 frames. When B1 (streaming STT) lands, add the semantic layer: yield only if interim transcript ≥2 words AND not in {హా, ఆ, అవును, సరే, ఓకే, హ్మ్, అవునండి, సరేనండి}.
- **EFFORT:** Half a day.
- **VERIFY:** Test calls with a TV/traffic noise track playing while Nikki speaks: zero mid-word cutoffs. Test caller saying "సరే" mid-reply: Nikki finishes her sentence. Count false-barge-ins per 20 scripted calls before/after.

### A3. Gate the turn-start filler on a soft timeout
- **WHAT:** Play the filler only when the real reply is genuinely slow (>~1.0–1.2s); cancel it the instant the first reply chunk is ready.
- **WHY:** HCI research: fillers shorten perceived wait but make task-oriented agents rate *less intelligent* — reserve for genuinely long waits (ElevenLabs soft timeout pattern, recommended ~3.0s; we can afford 1.2s). Today a cached-TTS answer collides with the filler mid-word — an audible glitch, since `uuid_broadcast` interrupts.
- **HOW:** In `_play_filler` (main.py:2936–2957) prepend `await asyncio.sleep(1.1)`; pass the task handle into `_speak_chunked` (or set an `asyncio.Event`) and cancel it before the first broadcast (main.py:2890, 2603–2634).
- **EFFORT:** 2 hours.
- **VERIFY:** Cached-reply turns play no filler and no audio glitch; slow tool-call turns still get covered. A/B 10 calls: zero filler-answer collisions.

### A4. TTS text-normalization layer on the phone path
- **WHAT:** A `normalize_for_tts()` applied in `_speak_chunked`: markdown strip + numbers, times, prices, phone numbers to spoken Telugu forms + ZWNJ in loanwords.
- **WHY:** bulbul:v3 docs: numbers over 4 digits without commas may fail; register research: '10:30' read as 'పది ముప్పై' is unnatural — real speech is పదిన్నర with day-part words; phone numbers are digit-by-digit in 5-5 groups with సున్నా and డబల్. Today raw LLM output goes straight to bulbul and `_clean_for_speech` only runs on the browser path (main.py:1617–1637, sole call site 1766).
- **HOW:** New function called from `_speak_chunked` (main.py:2611–2618) and `on_speech`'s audio path: (1) `_clean_for_speech`; (2) 10-digit numbers → digit words 5-5 grouped with comma pauses; (3) `HH:MM` → పదిన్నర/నాలుగున్నర + పొద్దున/మధ్యాహ్నం/సాయంత్రం; (4) round rupee amounts → రెండొందలు/ఐదొందలు/వెయ్యి; (5) commas into remaining >4-digit numbers; (6) ZWNJ-after-halant lexicon for known English loans (అపాయింట్‌మెంట్). Mirror the rules in `TELUGU_PHONE_PERSONA` (main.py:243–310) so the model cooperates. Full rules in the Register Pack below.
- **EFFORT:** 1–1.5 days incl. the lexicon.
- **VERIFY:** Regression script of 30 strings (times, phone numbers, prices, markdown) synthesized and listened to through an 8kHz mu-law simulation; zero numerals or asterisks vocalized.

### A5. Remove the 20-word TTS truncation
- **WHAT:** Delete `words[:20]` in `_synthesize_uncached` (main.py:512–516).
- **WHY:** The tail of multi-sentence replies — often the actual question — is amputated mid-sentence; your own LLM-side fix note says truncation "reads like a broken model." bulbul accepts 2,500 chars.
- **HOW:** Remove the cap; if cost guarding is wanted, split oversize text into more sentence chunks in `_speak_chunked` instead of discarding.
- **EFFORT:** 30 minutes.
- **VERIFY:** Synthesize a 40-word reply; the audio contains every word.

### A6. Chunk-boundary clipping fix
- **WHAT:** Stop cutting the last ~150ms of each chunk on multi-chunk replies.
- **WHY:** Phrase-final lengthening + falling pitch is *the* prosodic turn-yield cue listeners use to parse turn structure (Local/Couper-Kuhlen; semantic-VAD design); clipping word-final syllables every chunk is a per-reply robot tell.
- **HOW:** In `_speak_chunked` (main.py:2630–2633), sleep the full `dur + 0.05` before broadcasting the next chunk — the next synthesis already ran concurrently, so the 0.15s early send saves nothing.
- **EFFORT:** 30 minutes.
- **VERIFY:** Record a 3-chunk reply; waveform shows no truncated syllables at chunk seams.

### A7. Greeting register fix
- **WHAT:** Replace 'కి స్వాగతం! ... మీకు ఏం కావాలి?' with the real receptionist frame.
- **WHY:** Register research: స్వాగతం is un-phone-like (real openings: 'హలో, [business] అండి, చెప్పండి'); bare 'ఏం కావాలి?' without అండి is the documented disrespect failure mode. It's the first thing every caller judges.
- **HOW:** `_greeting_text` (main.py:2525–2529) → default: 'హలో, {biz} అండి. నేను {name}. చెప్పండి!'; returning: '{biz} అండి — మళ్ళీ కాల్ చేసినందుకు థాంక్యూ! చెప్పండి...'. Cache keys include the text hash so it propagates automatically.
- **EFFORT:** 1 hour.
- **VERIFY:** Two native-speaker listeners rate old vs new opening blind; new preferred.

### A8. Graded STT repair (one-repair rule)
- **WHAT:** Escalating, non-repeating repair lines on failed transcription, mirroring `_stall_reply`.
- **WHY:** Repeating the identical reprompt is the most-disliked repair pattern (Frontiers 2024 voice-assistant repair study); enterprise guidelines prescribe changing strategy after one failed clarification.
- **HOW:** Add `NikkiAgent._stt_failures` counter used at main.py:1155–1162 and 1252–1254: (1) 'సారీ అండి, మళ్ళీ చెప్తారా?' (2) 'వినపడట్లేదండి — కొంచెం నెమ్మదిగా, గట్టిగా చెప్తారా?' (3) callback/WhatsApp offer. Reset on success. Pre-cache all three in the TTS disk cache.
- **EFFORT:** 3 hours.
- **VERIFY:** Feed three consecutive garbage-audio turns; three *different* repair lines play, third offers callback.

### A9. Silent-caller re-engagement
- **WHAT:** Check in at ~12s of caller silence, escalate at ~25s, close politely at ~40s — instead of 120s of dead air then a drop.
- **WHY:** Jefferson's ~1s "standard maximum" makes long silence read as trouble; Vapi's rule is wait 10–15s, check in once, then assess; Retell ships `reminder_trigger_ms=10000`.
- **HOW:** Track `last_activity` on every endpointed utterance/reply completion; per-frame check in the receive loop (main.py:3441–3505); broadcast pre-cached clips ('వినపడుతుందా అండి? చెప్పండి' → callback offer → close). Guard on `speaking["until"]` and no turn in flight.
- **EFFORT:** Half a day.
- **VERIFY:** Call, say nothing after greeting: check-in at ~12s, polite close by ~45s, call row logs the reason.

### A10. Post-interruption context note
- **WHAT:** After barge-in, tell the LLM what the caller actually heard.
- **WHY:** Vapi tracks playback position and injects "you were interrupted while saying X"; PolyAI shows the model where it was cut so it answers the interjection without losing its thread. Today the full reply is committed to history before playback (main.py:1198–1199), so Nikki refers back to things the caller never heard.
- **HOW:** In `_speak_chunked`, track fully-broadcast chunks + elapsed fraction of the current one at `CancelledError`; rewrite `agent.history[-1]["content"]` to the spoken prefix and inject '[You were interrupted while saying: "…"; the caller did not hear the rest.]' into the next turn's facts block. Chunk granularity suffices.
- **EFFORT:** Half a day.
- **VERIFY:** Scripted call: interrupt Nikki mid-list, then ask "what were you saying?" — she resumes the unheard part, doesn't assume it was heard.

### A11. Comfort noise / room tone
- **WHAT:** Loop a quiet ambience WAV under the whole call.
- **WHY:** G.711 App II / RFC 3389 exist because pure digital silence makes callers think the line dropped — acute on Indian mobile networks; Vapi defaults phone calls to 'office' background sound.
- **HOW:** One 8kHz low-volume room-tone asset staged like the fillers; `displace_session ... m loop` at call start so it mixes *under* broadcasts rather than being interrupted by them (main.py:2959–3000 area).
- **EFFORT:** Half a day incl. asset prep.
- **VERIFY:** Record a call with a 3s tool-call gap; the gap contains audible room tone, not zero-signal silence; no 'hello? hello?' from test callers.

### A12. Prompt upgrades: few-shots, SILENT sentinel, granthika ban, energy matching
- **WHAT:** Add to `TELUGU_PHONE_PERSONA` (main.py:243–310): the three register-pack sample dialogues (~600 chars trimmed), a hold sentinel, the officialese ban list, spoken-form number rules, and two lines of energy matching.
- **WHY:** Vapi's guide prescribes ≥3 few-shot transcripts (happy path, edge case, recovery) — they encode register more reliably than abstract rules; Retell's `NO_RESPONSE_NEEDED` pattern handles 'hold on' with silence instead of chatter; LLMs drafting Telugu default to the granthika 'government notice' register.
- **HOW:** Append `[EXAMPLES]` section; add 'If the caller asks you to wait (ఆగండి, ఒక్క నిమిషం, hold on), reply exactly SILENT' and have `on_speech` (main.py:1145–1254) suppress TTS on that sentinel and arm the A9 reminder timer; ban list per Register Pack. Re-measure prefill cost (prompt length ≈ 1ms/char noted in code) — stable prefix + implicit caching amortizes it.
- **EFFORT:** 1 day incl. re-measurement.
- **VERIFY:** 20-call script: 'ఆగండి' produces silence then one check-in; zero granthika phrases in transcripts; register spot-check by native speaker.

### A13. TTS prosody knobs: temperature + dynamic pace
- **WHAT:** `temperature: 0.7` in the synthesize payload; pace 0.85 on chunks containing digits/time words, 1.0–1.1 elsewhere.
- **WHY:** Sarvam's own docs: temperature 0.7–0.8 = warm/expressive vs 0.3–0.5 IVR-flat; conversation research says slow down for numbers/OTPs (readback comprehension), and bulbul:v3 has no other prosody controls — pace and temperature are the entire lever set.
- **HOW:** main.py:527–541: add `temperature`; make `pace` a `synthesize()` parameter driven by `normalize_for_tts` detecting digit/time content. Verify or remove the undocumented `eng_interpolation_wt: 100`.
- **EFFORT:** 2–3 hours + listening A/B.
- **VERIFY:** Blind A/B of 10 phrases (through 8kHz channel) old vs new settings with 3 native listeners; phone-number readback transcribed correctly by listeners at higher rate.

### A14. Delete gemini_client.py, fix the onboarding NameError
- **WHAT:** Remove the stale module; route `_save_onboarding_draft` through `agent.llm` or the `_enrich_appointment` httpx pattern.
- **WHY:** main.py:3020 calls `gemini_generate` without importing it — onboarding extraction silently fails on every call (swallowed at 3506–3508); the module also pins retired models and the stall line your own docs call the biggest drag on call quality.
- **HOW:** Delete `voice-pipeline/gemini_client.py`; reuse the pattern at main.py:2718–2726.
- **EFFORT:** 2 hours.
- **VERIFY:** Onboarding call produces a saved draft; grep confirms one Gemini config in the repo.

---

## B. This-month structural (the latency re-architecture)

**Ordering note:** B1→B3 are one coherent project — streaming everything — and are the prerequisite for B4–B7. Realistic outcome with the same vendors: endpoint +320–400ms → transcript free → Gemini first sentence ~350–600ms → first bulbul audio ~200–400ms later = **600–900ms to real first words**, matching Retell (~600ms) and tuned Vapi builds (~465ms) on equivalent cascaded stacks.

### B1. Streaming STT: saaras:v3-realtime WebSocket
- **WHAT:** Replace the batch `/speech-to-text` POST with a per-call realtime WebSocket fed the same 20ms frames the FreeSWITCH handler already receives.
- **WHY:** Batch STT after end-of-speech is the expensive pattern (Coval: ~1–2s serial post-turn); saaras:v3-realtime delivers interim transcripts *during* speech (<150ms TTFT), making the transcript free at endpoint time — and it's the prerequisite for speculative prefill, semantic endpointing, and semantic barge-in.
- **HOW:** Hand-rolled WebSocket client (the Python SDK forces `audio/wav`; send raw `pcm_s16le` 8kHz). Replace `SarvamSTT.transcribe` (main.py:398–427); feed frames continuously in the receive loop (main.py:3445–3505); on VAD silence trigger, read the already-final transcript. Keep the batch path as fallback (the existing Google Chirp2 chain stays).
- **EFFORT:** 3–4 days incl. reconnect/error handling.
- **VERIFY:** A1 dashboard: STT leg on the critical path drops from ~300–600ms to ~0–50ms; p50 end-to-end falls correspondingly.

### B2. Streaming LLM + sentence-piped TTS
- **WHAT:** `:streamGenerateContent` with a warm shared `httpx.AsyncClient(http2=True)`; dispatch the first sentence/clause to TTS while generation continues.
- **WHY:** flash-lite's benchmarked TTFT is ~240–290ms vs the ~1s measured here — ~700ms is recoverable overhead (cold connections, non-streamed call). ElevenLabs starts TTS after "enough words and a comma," not full replies.
- **HOW:** main.py:592–601 endpoint change; module-level shared client replacing the per-attempt `AsyncClient` (main.py:686–698); in `_run_turn`, consume the token stream and fire the first ~55-char clause (reuse `_speech_chunks` boundary logic, main.py:2566–2601) to TTS mid-generation. Keep the system-prompt prefix byte-identical for implicit caching; confirm Mumbai-region routing.
- **EFFORT:** 3–4 days.
- **VERIFY:** A1 dashboard: LLM-first-token p50 ≤350ms; time-to-first-audio p50 under 900ms.

### B3. Streaming TTS: bulbul:v3 WebSocket
- **WHAT:** Per-call (or small warm pool) bulbul WebSocket; send sentence fragments with flush at sentence ends; spool received audio to per-sentence WAVs for the existing `uuid_broadcast` path.
- **WHY:** Batch REST pays a ~700ms Sarvam floor per chunk (your own code comment, main.py:474–478); WebSocket streaming starts audio at sub-250ms first-byte. Keeping file+`uuid_broadcast` playback preserves FreeSWITCH's pacing (practitioner reports found `mod_audio_stream` bidirectional playback unreliable — don't fight it).
- **HOW:** Replace `_synthesize_uncached` (main.py:511–549) internals; keep the disk cache for full-phrase hits; keep chunks <500 chars split at sentence boundaries (Telugu's agglutinative words make sub-clause chunking risky).
- **EFFORT:** 3–4 days.
- **VERIFY:** TTS-first-audio leg p50 ≤300ms on uncached text (A1 dashboard); no prosody breaks at sentence seams in a 10-call listening pass.

### B4. Speculative ("greedy") LLM prefill
- **WHAT:** Fire Gemini on the interim transcript at ~150ms of silence; commit at 400ms; cancel/re-fire if the final transcript differs materially.
- **WHY:** Vapi's greedy inference and Deepgram Flux's EagerEndOfTurn hide 200–400ms of endpointing wait; the cost is 50–70% extra LLM calls — nearly free on flash-lite.
- **HOW:** In the receive loop, on interim-transcript-stable + ~150ms silence, `asyncio.create_task` the generate; on the 400ms commit compare final vs speculated transcript (normalized string match), keep or cancel. Requires B1+B2.
- **EFFORT:** 2 days.
- **VERIFY:** p50 time-to-first-audio drops a further 200–300ms; wasted-call rate logged and <70%.

### B5. Telugu semantic endpointing (dynamic silence window)
- **WHAT:** Make `silence_needed` per-pause dynamic from the interim transcript.
- **WHY:** Fixed-window endpointing is fundamentally lossy (LiveKit); clipping a caller mid-phone-number is the fastest way to feel broken and correct behavior extends to 2s+ during dictation. No off-the-shelf turn detector covers Telugu (LiveKit's 14 languages exclude it) — but Telugu SOV morphology gives free signal: finite -ండి/-ఆను/-ఆరు verbs and question -ఆ close clauses; trailing 'అంటే/మరి/కానీ/ఇంకా' or digits predict continuation.
- **HOW:** ~30-line regex over the interim transcript replacing the fixed value at main.py:3437: ends in digits/digit-words (సున్నా, డబల్, ఒకటి…తొమ్మిది, nine/double) or continuation marker → 1.5–2s; ends in finite verb/question suffix → 300–400ms. This is Vapi's dynamic-wait formula, Teluguized, at near-zero cost.
- **VERIFY:** Scripted dictation test: caller reads a 10-digit number with a 1s mid-number pause across 20 calls — zero clipped numbers; clean-sentence turns still answered ≤400ms wait.
- **EFFORT:** 1–2 days incl. test set.

### B6. Adaptive VAD noise floor
- **WHAT:** Rolling per-call noise baseline with hysteresis, replacing the fixed RMS 200.
- **WHY:** Vapi's production VAD uses a dynamic baseline at the 85th percentile of a rolling window; clinic/jeweller calls on speakerphone/street noise are exactly the case where a fixed threshold either storms (floor >200) or goes deaf (soft caller <200).
- **HOW:** Deque of last ~5s frame RMS, `threshold = max(200, p85 * 1.5)`, updated only while the agent is silent; separate enter/exit thresholds (main.py:2349, 3448–3450). Longer term, consume saaras:v3-realtime's server VAD events (tunable `positive_speech_threshold`) and keep local RMS only as the barge-in fast path.
- **EFFORT:** 1–2 days.
- **VERIFY:** Replay 10 recorded noisy calls through the pipeline: endpoint fires on all; barge-in storm count = 0. Soft-speech test call is heard.

### B7. Classify short utterances instead of discarding them
- **WHAT:** Stop throwing away sub-0.7s caller audio during agent turns; transcribe and classify: backchannel → ignore; command ('ఆగండి', 'హలో', 'human') → act; else → queue as next turn.
- **WHY:** Retell runs a semantic classifier precisely because duration alone cannot separate 'uh-huh' from 'wait'; today a genuine 'ఆగండి' gets no reply and no record (main.py:3484–3497 — including the double-clear bug where `utterance_pcm` is dropped).
- **HOW:** With B1, the interim transcript already exists — route it through the backchannel/command sets from A2; queue non-backchannels for after reply completion. Fix the double-clear.
- **EFFORT:** 1–2 days.
- **VERIFY:** Say 'ఆగండి' mid-reply: Nikki stops and waits. Say 'సరే': she continues. Say 'ఒక్క డౌట్': she finishes, then answers it.

### B8. Agent-side backchannels during long caller turns
- **WHAT:** Soft 'హా'/'ఊ'/'అర్థమైంది' clips played while the caller narrates.
- **WHY:** Indian phone pragmatics backchannel every 5–10s (denser than the English ~23s CANDOR average); a silent listener triggers 'హలో? హలో?' line-checks — silence reads as a dropped line, not politeness. Retell ships this as a knob; no Telugu competitor advertises it — a cheap, demo-visible naturalness win.
- **HOW:** In the receive loop: when continuous caller speech exceeds ~6s (`speech_count * frame_secs`) and energy dips (clause-final trough — Ward & Tsukahara's low-pitch cue approximated by RMS), `uuid_broadcast` one of 3–4 pre-synthesized soft bulbul clips, ≤1 per 7s, randomized, never repeating, never while `speaking["until"]` is active. Reuse the `_stage_fillers` mechanism (main.py:2422–2441) with a `backchannels/` directory. Ensure A2 prevents the agent's own backchannel echo triggering barge-in.
- **EFFORT:** 1–2 days.
- **VERIFY:** 60-second caller monologue test: 6–10 backchannels placed at pauses, none mid-word over the caller; native listeners rate "was she listening?" before/after.

### B9. STT codemix mode + language follow
- **WHAT:** `mode=codemix` (or auto language detect on saaras v3/v4) instead of pinned te-IN transcribe.
- **WHY:** 39.7% of tokens in Telugu bilingual conversation are English; codemix output writes 'appointment' in Latin and Telugu in Telugu script — exactly what the code-mixed persona and `_detect_intent` want (which currently maintains duplicate keyword lists in both scripts, main.py:1332–1338). The persona promises to follow callers into Hindi/English but the pipeline forces Telugu.
- **HOW:** main.py:413–419: add mode param / drop pinned `language_code`; pass detected language to the LLM context; simplify `_detect_intent` lists.
- **EFFORT:** 1 day + regression on intent detection.
- **VERIFY:** Test calls in Tenglish and pure English: intents detected, replies follow the caller's language; intent-keyword unit tests pass with single-script lists.

### B10. Per-tenant pronunciation dictionary
- **WHAT:** One Sarvam v3 pronunciation dictionary per deployment: business name, doctor names, recurring mispronounced loans; `dict_id` stored in the voice profile, passed per call.
- **WHY:** Sarvam explicitly recommends the dictionary for names/brands over phonetic-spelling hacks; the code's own rule 'Never re-spell the business name' (main.py:295–296) is a symptom of this gap. Names are the most trust-sensitive words a receptionist says.
- **HOW:** Onboarding step generates/uploads the JSON; `synthesize()` payload gains `dict_id`.
- **EFFORT:** 1–2 days.
- **VERIFY:** Tenant-name pronunciation A/B judged by the tenant themselves during onboarding — this doubles as a sales moment.

### B11. Noisy Telugu entity-accuracy test set
- **WHAT:** 50–100 real recorded calls (with consent), annotated for names, phone numbers, times, amounts; entity accuracy (not WER) as the metric; benchmark saaras vs Google vs ElevenLabs Scribe v2 Realtime in shadow mode.
- **WHY:** The only independent noisy-Telugu benchmark shows 33–47% WER across *all* vendors (Google best 33.2%, Sarvam 46.5% raw but near-Google on domain terms) — clean-speech numbers are meaningless for clinic calls; and real gains come from VAD tuning + keyword biasing + LLM transcript repair, which need a ruler. It also builds the data moat no Telugu competitor has (no public corpus exists).
- **HOW:** Consent line already exists (TRAI disclosure); add a per-call opt-in flag, export pipeline, annotation sheet. Shadow-mode Scribe v2 (~₹25/hr, mu-law input, best published clean-Telugu WER) on the same audio.
- **EFFORT:** 3–5 days spread over the month.
- **VERIFY:** Entity-accuracy table per vendor per noise band; publish the methodology — it's marketing ammunition ("we measured; here's why we chose X").

---

## C. Later / moonshots

### C1. Bulbul v4 bakeoff the week it ships
- **WHY:** Announced July 30, 2026 ('richer emotion, greater vocal range', Telugu included) — same vendor, likely drop-in; your realistic next humanness ceiling raise. No API string/pricing yet.
- **HOW:** Watch docs.sarvam.ai/changelog; on release, run your A4 regression script + the three register-pack dialogues through v3 vs v4 via 8kHz mu-law, blind-rated by 5 native listeners. **EFFORT:** 1 day when it lands. **VERIFY:** Preference ≥60% before switching.

### C2. Owner-voice cloning for SMB tenants
- **WHY:** Vomyra's entire pitch is a 10-second owner clone; a jeweller's shop answering in the owner's voice is a viscerally human demo. Bulbul has *no* self-serve cloning — requires ElevenLabs (USD, and v3 isn't realtime) or Gnani Vachana zero-shot Indic cloning when/if API-available. Park until a realtime Telugu cloning path exists; prototype with pre-rendered greetings only (greeting is cached anyway, so a cloned *greeting* + bulbul body works today).
- **EFFORT:** 2–3 days for the cloned-greeting hybrid; full-call cloning blocked on vendors. **VERIFY:** Tenant blind-recognizes their own greeting; demo conversion rate.

### C3. Cartesia Sonic 3.6 latency bakeoff
- **WHY:** ~90ms TTFB vs bulbul's ~200–250ms, native 8kHz mulaw streaming, similar price — but it *lost* the Indian-language blind test to bulbul v3 and its Telugu is publicly unproven. Treat strictly as a latency play, only if B1–B4 leave TTS as the bottleneck. **EFFORT:** 1 day. **VERIFY:** Only switch if blind Telugu listening is ≥parity AND ≥100ms p50 saved.

### C4. Trained Telugu turn-detector
- **WHY:** B5's regex heuristic will plateau; LiveKit's open turn-detector architecture (semantic+acoustic fusion) is replicable, and B11's corpus is the training data. This becomes a real technical moat — nobody has Telugu endpointing data. **EFFORT:** 2–4 weeks. **VERIFY:** Premature-endpoint rate vs B5 heuristic on held-out calls (Vapi's combined approach cut premature interruptions 73% vs fixed timeouts — that's the bar).

### C5. The public receipts page
- **WHY:** The competitive wedge (see read above): recorded real Telugu calls across all three dialect regions, side-by-side with robotic Google-TTS Telugu, live per-stage latency stats from A1, and an uptime page (Verloop's verified 94-minute outage shows reliability sells; no Telugu competitor publishes uptime). **EFFORT:** 2–3 days once B-tier lands. **VERIFY:** Demo-page → trial conversion.

### C6. Self-hosted IndicF5
- **WHY:** The only path to potentially exceeding bulbul-v3 humanness for Telugu today (MIT license, 'near-human') — but no published latency, F5-style diffusion is hard to stream <300ms, and it needs GPU ops. Rational only above ~100M chars/month or for on-prem deals. **VERIFY:** Don't start until the spend math or a data-residency contract says so.

---

## D. Things the research says NOT to do

1. **Don't switch TTS to ElevenLabs v3 for "more human."** v3 cannot stream in real time (ElevenLabs' own guidance: use Flash v2.5 for live agents), Flash v2.5 has *no Telugu*, and v3 costs ~3x. And in the only independent blind test covering Telugu at 8kHz telephony (Josh Talks, 20K+ votes), bulbul:v3 *beat* ElevenLabs v3 alpha at phone quality. You are already on the demonstrated-best engine for this exact channel.
2. **Don't play fillers on every turn or before facts.** HCI research: fillers make task-oriented agents rate less intelligent, and Brennan & Williams: 'um' before an answer signals low feeling-of-knowing — a filler before an appointment time or fee *undermines trust in that exact fact*. Fillers gate on genuine delay (A3); times, names, and prices are delivered fluently, zero disfluency.
3. **Don't chase uniformly instant (<300–500ms) replies.** Consistently sub-500ms reads as robotic/interruptive on business calls — humans take longer on substantive answers (famulor; Stivers shows the human mode is 0–200ms *for simple turn handoffs*, not considered answers). Add 100–300ms deliberate variable delay on substantive answers once B-tier makes you fast enough for this to matter.
4. **Don't script Telangana dialect morphology into Nikki's own speech.** ఏంది/గిట్ల/వస్తున్రు carry a rustic/comic film stereotype; real Hyderabad receptionists — including native Telangana speakers — use standard vyavaharika + heavy English on business calls. Output stays standard-with-light-coloring (తారీఖు fine); *comprehension* must accept full Telangana and Rayalaseema forms.
5. **Don't jump to speech-to-speech APIs.** OpenAI Realtime measured p50 1.1s / p95 1.9s on real phone calls — above the 900ms disengagement threshold; Gemini Live has ~15-min session caps, ~10-min WebSocket life, no PSTN, 16kHz input expectations. The cascaded Sarvam+flash-lite pipeline with B-tier turn-taking beats both on latency *and* control for Telugu telephony today. (Watch PolyAI Dialog-RSN-1 and Gnani Inya as the direction of travel — Gnani only sells to banks.)
6. **Don't shrink the 400ms silence window further.** It's already at the aggressive end (Deepgram practitioners: 300ms + 1000ms utterance-end); the wins come from speculative prefill (B4) and *extending* the window during dictation (B5), not from shaving the base.
7. **Don't switch STT vendors chasing accuracy.** On noisy Telugu everyone is bad (33–47% WER) and Sarvam preserves domain terms nearly as well as Google at a fraction of the cost; gains come from VAD tuning, keyword biasing, and LLM-side transcript repair (B6, B10, B11). Only Scribe v2 Realtime earns a shadow-mode trial — on data, not vibes.
8. **Don't let the LLM produce pure-Telugu vocabulary.** నియామకం for appointment / వైద్యుడు for doctor / ధన్యవాదములు sounds like a government notice and breaks the receptionist illusion instantly; measured urban mixing is ~30–40% English tokens. The register pack's ban list enforces this.

---

## Telugu Register Pack (paste-ready)

### Prompt rules (append to TELUGU_PHONE_PERSONA)

```
[REGISTER]
- Standard spoken (vyavaharika) Telugu + natural English mixing. ~one English content word per clause.
- ALWAYS: మీరు (never నువ్వు); గారు after every name/title (రమేష్ గారు, డాక్టర్ గారు); every imperative in -ండి (చెప్పండి, రండి, పంపండి); అండి on bare answers (అవునండి, లేదండి, సరేనండి).
- English loans stay English, with Telugu case suffixes: అపాయింట్‌మెంట్‌కి, డాక్టర్ గారికి, టైంలో, హాస్పిటల్ దగ్గర. Allowed set: అపాయింట్‌మెంట్, టైం, డాక్టర్, హాస్పిటల్, క్లినిక్, నంబర్, ఫోన్, కాల్, మెసేజ్, వాట్సాప్, స్లాట్, బుక్, క్యాన్సిల్, ఫీజు, రిపోర్ట్, టెస్ట్, స్కాన్, సర్, మేడం, ఓకే, సారీ, థాంక్యూ.
- BANNED (written/official register): దయచేసి వేచి యుండగలరు, తెలియజేయడమైనది, ధన్యవాదములు, సందర్శించండి, వీడ్కోలు, శుభదినం, స్వాగతం, నియామకం, వైద్యుడు.
- Deflections: softener + reason + redirect ('అదండీ... డాక్టర్ గారు చూశాకే చెప్పగలరండి. అపాయింట్‌మెంట్ పెట్టమంటారా?') — never a flat refusal.
- Bad news / wrong number: open with అయ్యో or పర్వాలేదండి softeners.
- Fixed frames — opening: 'హలో, [business] అండి. చెప్పండి!' | hold: 'ఒక్క నిమిషం లైన్లో ఉండండి అండి' | confirm: 'సరేనండి / నోట్ చేసుకున్నానండి' | close: 'సరేనండి... థాంక్యూ అండి, మంచిది' or 'ఉంటానండి'.
- If the caller asks you to wait (ఆగండి / ఒక్క నిమిషం / hold on): reply exactly SILENT.
- Energy match: hurried caller → shorter turns, no fillers; confused/elderly caller → slower, one fact per turn, confirm each step.
[NUMBERS — write exactly as spoken]
- Times: పదిన్నర (10:30), నాలుగున్నర (4:30), పదింబావు (10:15), పావు తక్కువ పది (9:45), on-the-hour పది గంటలకు; always with day-part: పొద్దున / మధ్యాహ్నం / సాయంత్రం / రాత్రి. Never '10:30' or 'PM'.
- Phone numbers: digit-by-digit, 5-5 groups, comma between groups, సున్నా for 0, డబల్ for repeated digits. Never numerals.
- Money: round figures in Telugu — రెండొందలు, మూడొందలు, ఐదొందలు, వెయ్యి, నూట యాభై; frame with ఫీజు ('కన్సల్టేషన్ ఫీజు మూడొందలు అండి'). Complex amounts in English words.
- Dates: 'సెప్టెంబర్ రెండో తారీఖు'.
```

### Few-shot dialogues (append as [EXAMPLES], trim to fit)

1. **Booking:** C: 'హలో, డాక్టర్ గారు రేపు ఉంటారా? అపాయింట్మెంట్ కావాలి.' → N: 'డాక్టర్ గారు రేపు పొద్దున పది నుంచి ఒంటి గంట వరకు ఉంటారండి. మీ పేరు చెప్తారా సర్?' → C: 'రమేష్.' → N: 'సరే రమేష్ గారు, రేపు పదిన్నరకి అపాయింట్‌మెంట్ పెడుతున్నానండి. పది నిమిషాలు ముందుగా వచ్చేయండి సర్.'
2. **Price deflection:** C: 'రూట్ కెనాల్‌కి ఎంత అవుతుందండి?' → N: 'అదండీ... డాక్టర్ గారు ఒకసారి చూశాకే కరెక్ట్‌గా చెప్పగలరండి. కన్సల్టేషన్ ఫీజు మాత్రం మూడొందలు అండి. అపాయింట్‌మెంట్ పెట్టమంటారా?'
3. **Wrong number:** C: 'హలో, సురేష్ ట్రావెల్స్ ఆ?' → N: 'కాదండి, ఇది శ్రీ క్లినిక్ అండి. నంబర్ తప్పు పడినట్టుందండి.' → C: 'అయ్యో సారీ.' → N: 'పర్వాలేదండి, మంచిది.'

### normalize_for_tts rules (code-side, applied in _speak_chunked)

| Input | Output |
|---|---|
| `10:30` | పదిన్నర (+ day-part word from context, else 'ten thirty' if reply is code-mixed) |
| `9848012345` | తొమ్మిది ఎనిమిది నాలుగు ఎనిమిది సున్నా, ఒకటి రెండు మూడు నాలుగు ఐదు (5-5, comma pause; English-digit-words mode as per-tenant option) |
| `99` in a number | డబల్ తొమ్మిది |
| `₹300` / `300 rupees` | మూడొందలు |
| `10000` | `10,000` minimum (bulbul may fail without commas); prefer పది వేలు |
| Markdown `* _ #` lists, emoji | stripped (`_clean_for_speech`) |
| English loans in Telugu script | ZWNJ after halant from lexicon: అపాయింట్‌మెంట్, ట్రీట్‌మెంట్, డిపార్ట్‌మెంట్ |

### NLU/ASR comprehension set (understand, never speak)

- Telangana: ఏంది, ఎట్లా, గిట్ల, ఏడ/ఆడ/ఈడ, ఉంటది/అయితది, వచ్చిండు/వచ్చిన్రు, -ఆలె obligatives (రావాలె); Urdu loans: దవాఖానా, కిరాయి, పైసలు, తారీఖు, జల్దీ, పరేషాన్, తక్లీఫ్.
- Rayalaseema: -ina- pasts (వచ్చినాడు/వచ్చినారు), అప్పా/అమ్మా sentence particles, ఏమప్పా openers.
- Backchannels (never treat as barge-in): హా, ఆ, ఊ, హ్మ్, అవును, అవునండి, సరే, సరేనండి, ఓకే, కదండీ.
- Commands (always act): ఆగండి, ఒక్క నిమిషం, హలో?, మనిషి, స్టాఫ్, హ్యూమన్, ట్రాన్స్ఫర్.
- Continuation markers (extend endpoint wait): అంటే, మరి, కానీ, ఇంకా, and any trailing digit sequence.

### TTS QA checklist (freeze in pronunciation lexicon once passing)

ళ vs ల (కళ్ళు), conjuncts క్ష/జ్ఞ/స్త్ర in names (లక్ష్మి, జ్ఞానేశ్వర్), geminates (చెప్పండి), every allowed English loan in both Telugu script (with ZWNJ) and Latin script — pick per word whichever the chosen voice renders naturally; all judged **after 8kHz mu-law downsampling**, never on studio output (narrowband caps MOS at ~4.2 and destroys sibilance — the phone channel is the only channel that matters).

---

## The one-line strategy

Ship A2+A3 this week (false barge-in and filler collisions are today's loudest robot tells), land the streaming trio B1–B3 this month to reach a measured 600–900ms first-audio, layer Telugu-specific turn-taking (B5, B7, B8) that no competitor has built for this language, and then publish the tape — because in a market where every vendor claims Telugu and none demonstrates it, the measurable recording *is* the moat.