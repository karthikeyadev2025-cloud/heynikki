# Nikki — AWS Production Deployment Guide

**Target:** Ubuntu 24.04 EC2 (`t3.small` or larger) in `ap-south-1` (Mumbai), with
Nginx fronting the API + voice pipeline, CloudWatch for logs/metrics, certbot for TLS.

---

## Architecture

```
                  Internet (Exotel, browsers, mobile apps)
                              │
                              ▼
                  Route 53  (heynikki.in, api.heynikki.in, pipeline.heynikki.in)
                              │
                              ▼
                ┌─────────────────────────┐
                │ EC2 t3.small ap-south-1 │
                │                         │
                │ Nginx (80/443) ─┐       │
                │                 ├──▶ 127.0.0.1:4000  (api-server, Node)
                │                 └──▶ 127.0.0.1:8000  (voice-pipeline, FastAPI)
                │                                                              │
                │ CloudWatch Agent ──▶ logs + metrics to CloudWatch (regional) │
                └─────────────────────────┘
                              │
                              ▼
                  Supabase  (ap-south-1, Mumbai)
                  - Postgres
                  - Storage (recordings/, voice-samples/)
                  - Auth
```

When you outgrow one EC2: put an **ALB** in front and add 2-3 EC2s in an
Auto Scaling Group. The application code is already proxy-aware
(`trust proxy: 1` adapts via `X-Forwarded-For`).

---

## One-time setup

### 1. EC2 instance

- AMI: Ubuntu Server 24.04 LTS
- Type: `t3.small` (recommended) or `t3.micro` (free tier, tight)
- Region: `ap-south-1` (Mumbai)
- Storage: 30 GB gp3
- Security group: SSH (your IP only), HTTP 80, HTTPS 443. Do NOT expose 4000 or 8000 publicly — Nginx fronts them.

### 2. IAM role for CloudWatch (REQUIRED before installing the CW agent)

In **IAM Console → Roles → Create role**:

- Trusted entity: AWS service → EC2
- Permissions: attach AWS-managed policy **CloudWatchAgentServerPolicy**
- Role name: `nikki-ec2-cloudwatch`

Then **EC2 Console → Instance → Actions → Security → Modify IAM role** → select `nikki-ec2-cloudwatch`.

### 3. Bootstrap the instance

SSH in, then:

```bash
git clone https://github.com/karthikeyadev2025-cloud/heynikki.git
cd heynikki
bash voice-pipeline/setup_ec2_ubuntu24.sh    # existing script — installs deps
```

### 4. Environment files

The systemd units read secrets from files outside the repo so they never get
committed accidentally.

```bash
sudo mkdir -p /etc/nikki
sudo chown root:ubuntu /etc/nikki
sudo chmod 0750 /etc/nikki

sudo nano /etc/nikki/voice-pipeline.env
# Paste — see voice-pipeline/.env.example for the full list.
# Critical: HEYNIKKI_RECORDING_KEY, SARVAM_API_KEY, GEMINI_API_KEY, LIVEKIT_*

sudo nano /etc/nikki/api-server.env
# Paste — see api-server/.env.example for the full list.
# Critical: RAZORPAY_*, EXOTEL_WEBHOOK_TOKEN, SUPABASE_SERVICE_KEY,
# WATI_*, INTERNAL_SECRET

sudo chmod 0640 /etc/nikki/*.env
sudo chown root:ubuntu /etc/nikki/*.env
```

**Generate the secrets:**

```bash
# AES-256 recording key (32 bytes, base64) — keep this safe and BACK IT UP
python3 -c "import secrets,base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"

# Exotel shared-secret token (hex)
openssl rand -hex 24

# Internal service-to-service auth secret
openssl rand -hex 32
```

### 5. systemd services

Stop Supervisor's old configs first (if you ran the original setup script):

```bash
sudo supervisorctl stop nikki-pipeline nikki-api 2>/dev/null || true
sudo rm -f /etc/supervisor/conf.d/nikki-pipeline.conf /etc/supervisor/conf.d/nikki-api.conf
sudo supervisorctl reread && sudo supervisorctl update
```

Install systemd units:

> **NOTE:** `infra/systemd/` is not in this repo — these two unit files exist
> only on the server. If you are rebuilding a box from scratch, copy them off
> the running instance (`/etc/systemd/system/nikki-*.service`) first, or
> recreate them. This step cannot work from a clean checkout as written.

```bash
sudo cp infra/systemd/nikki-pipeline.service /etc/systemd/system/
sudo cp infra/systemd/nikki-api.service      /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nikki-pipeline nikki-api

# Verify
sudo systemctl status nikki-pipeline nikki-api
curl -fsS http://127.0.0.1:4000/health
curl -fsS http://127.0.0.1:8000/health  # if pipeline exposes one
```

### 6. Nginx

```bash
sudo cp infra/nginx/nikki.conf /etc/nginx/sites-available/nikki
sudo ln -sf /etc/nginx/sites-available/nikki /etc/nginx/sites-enabled/nikki
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 7. TLS (certbot)

```bash
sudo certbot --nginx -d api.heynikki.in -d pipeline.heynikki.in
# Choose redirect-to-HTTPS
# Auto-renewal is enabled by the certbot deb package; verify:
sudo systemctl list-timers | grep certbot
```

### 8. CloudWatch agent

```bash
bash infra/aws/setup-cloudwatch.sh
# Verify:
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a status
```

Logs appear in CloudWatch under log groups starting with `/nikki/`. Metrics
under the `Nikki/EC2` namespace.

### 9. Route 53 health checks

In **Route 53 → Health checks → Create**:

- Name: `nikki-api-health`
- What to monitor: Endpoint by domain name
- Domain: `api.heynikki.in`
- Path: `/health`
- Port: 443, HTTPS
- Request interval: 30 seconds
- Failure threshold: 3

Repeat for `pipeline.heynikki.in`. Optionally wire an SNS topic to notify your
phone/email when these fail.

---

## Operations

### Tailing logs

```bash
# Live tail on the box
sudo journalctl -u nikki-pipeline -f
sudo journalctl -u nikki-api -f

# Or the file form (what CloudWatch ingests)
sudo tail -f /var/log/nikki-api.out.log /var/log/nikki-pipeline.err.log
```

### Restart after deploying new code

```bash
cd /home/ubuntu/heynikki
git pull

# api-server: BUILD, then restart. `npm start` runs dist/index.js, and dist/
# is gitignored — it is never in the pull. Without this step a deploy pulls
# new source and keeps running the old compiled JS, so nothing changes and
# the service looks fine. `--omit=dev` is deliberately NOT used here:
# TypeScript is a devDependency and the build needs it.
cd api-server
npm install
npm run build

cd ../voice-pipeline && source venv/bin/activate && pip install -r requirements.txt && deactivate

sudo systemctl restart nikki-pipeline nikki-api

# Confirm the restart actually took — uptime_ms should be near zero.
sleep 3 && curl -s localhost:4000/health | head -c 200; echo
```

If `uptime_ms` is still large, the units did not restart and the running
process is the old one.

### Rolling back

```bash
cd /home/ubuntu/heynikki
git log --oneline -5
git checkout <commit-sha>
sudo systemctl restart nikki-pipeline nikki-api
```

---

## Backups

Supabase already takes daily backups on the Free/Pro plans (Mumbai region).
Verify in: **Supabase dashboard → Database → Backups**.

For the EC2 itself, **enable EBS snapshots**:

- EC2 Console → Volume → Actions → Create snapshot lifecycle policy
- Daily, retain 7 days

Cost: ~₹15-30/month for a 30 GB volume.

---

## When to migrate to ALB

Move from single-EC2 to ALB + ASG when ANY of these happen:

- You routinely exceed 70% CPU
- You need zero-downtime deploys (currently restart = ~5s gap)
- You're handling >50 concurrent calls
- You need to put EC2 behind a WAF

Application code is already proxy-aware (`trust proxy: 1`). Migration steps:

1. Spin up 2nd EC2 from an AMI of the current one
2. Create ALB in front, target group on port 80 (Nginx), health check `/health`
3. Point `api.heynikki.in` and `pipeline.heynikki.in` at the ALB
4. Each EC2's Nginx still terminates SSL — or move SSL to ALB and Nginx talks plain HTTP

NO code change required for the move.

---

## Cost estimate (single t3.small in ap-south-1)

| Item | ₹/month |
|---|---|
| EC2 t3.small (24×7)            | ~1,650 |
| EBS 30 GB gp3                  | ~250   |
| EBS snapshots (7-day rotation) | ~30    |
| Data transfer (5 GB out)       | ~50    |
| CloudWatch (logs ~5 GB/mo)     | ~140   |
| Route 53 hosted zone           | ~40    |
| **Total**                      | **~₹2,160/mo** |

Supabase (Pro tier): ₹2,100/mo separately if you outgrow Free.

---

## Security checklist

- [ ] SSH only from your IP (or set up AWS Session Manager and disable SSH)
- [ ] All secrets in `/etc/nikki/*.env`, mode 0640, owner root:ubuntu — NEVER in repo
- [ ] `HEYNIKKI_RECORDING_KEY` backed up to encrypted password manager (losing it = unrecoverable recordings)
- [ ] `EXOTEL_WEBHOOK_TOKEN` configured in Exotel dashboard webhook URLs
- [ ] CloudWatch alarms on: `/health` failures, CPU > 80%, disk > 80%, memory > 80%
- [ ] AWS GuardDuty enabled (one click, free tier)
- [ ] AWS root account secured with hardware MFA, not used for daily operations
