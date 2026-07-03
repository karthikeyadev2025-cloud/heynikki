# Nikki — 2-Day Presentation Sprint
# READ THIS FIRST. DO EXACTLY IN ORDER.
# ══════════════════════════════════════

## HOUR 1 — Accounts (YOU DO THIS, I write code in parallel)

### 1. Supabase (FREE — 5 min)
- Go to: supabase.com/dashboard
- New project → name: nikki → region: Southeast Asia (Singapore)
- Settings → API → copy: Project URL + anon key + service_role key
- SAVE THESE 3 VALUES

### 2. Sarvam AI (FREE credits — 5 min)
- Go to: dashboard.sarvam.ai
- Sign up → Verify email
- API Keys → Create key → Copy it
- You get free credits (enough for 100+ test calls)

### 3. LiveKit Cloud (FREE tier — 5 min)
- Go to: cloud.livekit.io
- Sign up → Create project → name: nikki
- Settings → copy: URL (wss://...) + API Key + API Secret

### 4. Google AI Studio (FREE — 3 min)
- Go to: aistudio.google.com/apikey
- Create API key → Copy it (Gemini 2.5 Flash)

### 5. Exotel (PAID — 15 min)
- Go to: exotel.com → Sign up
- Minimum recharge: ₹1,000 (mandatory for Indian numbers)
- Buy 1 DID number (₹250/month)
- Get: SID + API Key + API Token + your DID number
- NOTE: Exotel verification takes 24-48h — buy NOW

### 6. Vercel (FREE — 2 min)
- Go to: vercel.com → Sign up with GitHub
- Done

### 7. Domain (OPTIONAL for presentation)
- namecheap.com → search jovio.in → buy (~₹800/year)
- OR use free Vercel subdomain: nikki.vercel.app

---

## HOUR 2 — Database Setup

### Run schema in Supabase:
1. Open Supabase dashboard → your nikki project
2. SQL Editor → New Query
3. Paste contents of: supabase/001_schema.sql
4. Click RUN
5. Should say "Success" with no errors

### Create .env file:
1. Copy .env.example → rename to .env
2. Fill in all values you collected above
3. NEVER commit this file to git

---

## HOUR 3 — Voice Pipeline Deployment

### Option A: Local (fastest for presentation)
```bash
cd voice-pipeline
pip install -r requirements.txt
cp ../.env.example .env  # fill in values
python main.py
# Pipeline running at http://localhost:8000
```

### Option B: Railway.app (online in 10 min)
1. railway.app → New Project → Deploy from GitHub
2. Add repo, select voice-pipeline folder
3. Add all env vars from .env
4. Deploy → get URL like: nikki-pipeline.railway.app

### Test the pipeline:
```bash
curl http://localhost:8000/health
# Should return: {"status":"ok","service":"nikki-voice-pipeline"}
```

---

## HOUR 4-5 — Marketing Website Deployment

### Create Next.js app:
```bash
npx create-next-app@latest nikki-web --typescript --tailwind --app --no-src-dir
cd nikki-web
# Replace app/page.tsx with contents of web/page.tsx
npm run dev
# Opens at http://localhost:3000
```

### Deploy to Vercel:
```bash
# Push to GitHub first
git init && git add . && git commit -m "Nikki website"
# Then: vercel.com → New Project → Import from GitHub
# OR:
npm i -g vercel
vercel --prod
```

### Your website is LIVE at: https://nikki.vercel.app

---

## HOUR 6-8 — Demo Call Setup (Most Important for Presentation)

### Connect Exotel to your pipeline:
1. Exotel dashboard → ExoPhone → your DID number
2. Set webhook: POST https://your-pipeline-url/api/v1/call/inbound
3. Add header: X-Internal-Secret: (your INTERNAL_SECRET value)
4. Save

### Test your first Telugu AI call:
1. Call your Exotel DID number from your phone
2. AI should answer in Telugu within 2 seconds
3. Try: "హలో, నాకు appointment కావాలి"
4. AI books appointment and sends WhatsApp

### If Exotel not ready (takes 24-48h to activate):
Use this demo script instead:
- Open the web demo player on the website
- Show the animated Telugu conversation
- Tell audience: "This is running live — here's the real call recording"
- Pre-record a call using Sarvam STT/TTS API directly

---

## DAY 2 — Dashboard UI (Customer Portal)

### Fastest approach — use Supabase + Next.js:
```bash
cd nikki-web
npm install @supabase/supabase-js @supabase/ssr recharts lucide-react
```

### Pages to build for presentation (priority order):
1. /signup — email signup form (Supabase auth)
2. /dashboard — reception log (live calls, missed calls, appointments)
3. /setup — voice profile picker + business form

### Quick dashboard starter:
- Use shadcn/ui: npx shadcn@latest init
- Tables from Supabase real-time subscriptions
- Show: 1 active call ticker, 5 missed calls, 3 appointments booked

---

## PRESENTATION SCRIPT (2 minutes demo)

"Nikki gives any Telugu business a fully automated AI receptionist.

[SHOW WEBSITE]
Client opens our website, signs up, takes 60 seconds.
They pick 'Nikki Telugu Receptionist — Clinic'. 
Enter their clinic name, hours, services. Done.

[MAKE LIVE CALL — call your Exotel DID]
I'm now calling the AI receptionist for a demo clinic.
[Speak Telugu]: 'హలో, నాకు రేపు appointment కావాలి'
[AI answers in Telugu, books appointment]
[WhatsApp message arrives]

[SHOW DASHBOARD]
Owner sees: call handled, appointment booked, WhatsApp sent.
Full transcript. Recording. One dashboard.

Cost: ₹3.28/minute to us. We charge ₹12–25/minute.
3–7× gross margin on every call."

---

## TROUBLESHOOTING

### Sarvam STT returns empty string:
- Check audio is 8kHz WAV format
- Verify API key in .env is correct
- Check Sarvam dashboard for credit balance

### Exotel webhook not firing:
- Pipeline URL must be HTTPS (not localhost)
- Use Railway/Render for deployment
- Check Exotel logs: ExoPhone → Call Logs

### Gemini returns error:
- Check GEMINI_API_KEY is correct
- Gemini 2.5 Flash might have quota — fall back to gemini-1.5-flash
- Change model in main.py line: "gemini-2.0-flash-exp" → "gemini-1.5-flash"

### Supabase RLS blocking inserts:
- For pipeline server, use SERVICE_KEY (not anon key)
- Service key bypasses RLS — never expose to frontend
