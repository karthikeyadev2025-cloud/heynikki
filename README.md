<p align="center">
  <img src="assets/nikki-logo.jpg" width="120" alt="Nikki Logo" />
</p>

<h1 align="center">Nikki — Telugu AI Receptionist</h1>
<p align="center">
  <strong>Powered by Nikki Tech Labs</strong><br/>
  Your business never misses a call.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Telugu-First%20AI-10B981?style=flat-square" />
  <img src="https://img.shields.io/badge/Response-<700ms-F97316?style=flat-square" />
  <img src="https://img.shields.io/badge/Cost-₹3.28%2Fmin-10B981?style=flat-square" />
  <img src="https://img.shields.io/badge/Stack-Sarvam%20%2B%20Gemini%20%2B%20LiveKit-8B5CF6?style=flat-square" />
</p>

---

> Upload your number. Pick a voice profile. Go live in 60 seconds.
> Nikki answers every call in Telugu, books appointments, and sends
> WhatsApp confirmations — fully automated. The entire AI engine is invisible to your clients.

## Project Structure

```
nikki/
├── voice-pipeline/     # Python FastAPI — Sarvam STT/TTS + Gemini LLM + LiveKit
├── api-server/         # Node.js — Webhooks, Razorpay, WhatsApp, Tenant APIs
├── dashboard/          # Next.js 14 — Customer web dashboard
├── super-admin/        # Next.js 14 — Nikki Super Admin control panel
├── web/                # Next.js 14 — Marketing website (jovio.in)
├── flutter-app/        # Flutter 3.x — iOS + Android customer app
├── supabase/           # SQL schema + migrations
└── assets/             # Nikki brand assets + logo
```

## Quick Start

### 1. Database
```bash
# Supabase SQL Editor → paste and run:
supabase/001_schema.sql
```

### 2. Voice Pipeline
```bash
cd voice-pipeline
pip install -r requirements.txt
cp .env.example .env   # fill in your keys
python main.py
# Runs at http://localhost:8000
```

### 3. API Server
```bash
cd api-server
npm install
cp .env.example .env
npm run dev
# Runs at http://localhost:4000
```

### 4. Customer Dashboard
```bash
cd dashboard
npm install
cp .env.example .env.local
npm run dev
# Runs at http://localhost:3001
```

### 5. Flutter App
```bash
cd flutter-app
flutter pub get
flutter run
```

## Environment Variables
Copy `.env.example` → `.env` in each folder and fill in your values.
**Never commit real `.env` files.**

## Voice Pipeline Architecture
```
Caller → Exotel (inbound) / Plivo (outbound)
       → LiveKit AgentStream (WebSocket)
       → Sarvam Saaras V3 (Telugu STT) <150ms
       → Gemini 2.5 Flash (LLM, 4-turn window) <80ms
       → Sarvam Bulbul V3 (Telugu TTS) <250ms
       → Caller (first audio byte <700ms total)
              ↓ async
       → Supabase (transcript, appointment, intent)
              ↓ async
       → Wati WhatsApp (confirmation/reminder)
```

## Cost per Call Minute
| Component | Cost |
|-----------|------|
| Exotel (inbound) | ₹0.45 |
| Sarvam STT | ₹1.50 |
| Gemini LLM | ₹0.08 |
| Sarvam TTS | ₹0.75 |
| LiveKit Infra | ₹0.30 |
| DB & Misc | ₹0.20 |
| **Total** | **₹3.28/min** |
| You charge | ₹12–25/min |
| **Gross margin** | **3.7–7.6×** |

## Tech Stack
| Layer | Technology |
|-------|-----------|
| STT | Sarvam Saaras V3 (Telugu primary) + Google Chirp 2 (fallback) |
| TTS | Sarvam Bulbul V3 (8kHz telephony) + Azure Shruti (fallback) |
| LLM | Gemini 2.5 Flash (primary) + GPT-4o-mini (fallback) |
| Orchestration | LiveKit Agents (self-hosted, AWS Mumbai) |
| Telephony | Exotel AgentStream (inbound) + Plivo (outbound) |
| Database | Supabase PostgreSQL + RLS |
| Auth | Supabase Auth + Google OAuth |
| Payments | Razorpay Subscriptions |
| WhatsApp | Wati / 360dialog |
| Frontend | Next.js 14 + Tailwind CSS |
| Mobile | Flutter 3.x (iOS + Android) |
| Deploy | Vercel (web) + AWS Mumbai ap-south-1 (pipeline) |

## Subscription Plans
| Plan | Price | Minutes | Profiles |
|------|-------|---------|---------|
| Starter | ₹1,999/mo | 200 | 1 |
| Growth | ₹4,999/mo | 600 | 3 |
| Scale | ₹9,999/mo | 1,500 | 10 |

## Security
- Multi-tenant RLS at DB level (cross-tenant leak structurally impossible)
- Triple gate: JWT + tenant_id ownership + plan tier on every endpoint
- `voice_profile_id` naming throughout (never `agent_id`)
- All external vendors hidden behind internal proxy routes
- TRAI mandatory disclosure on every inbound call
- AES-256 encrypted call recordings

---

<p align="center">
  <strong>© 2026 Nikki Technologies</strong><br/>
  <em>Powered by Nikki Tech Labs</em>
</p>
