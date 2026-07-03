# Nikki — EC2 Mumbai Deployment Guide
## AWS Free Tier · t3.micro · ap-south-1 · Ubuntu 22.04

---

## STEP 1 — Launch EC2 Instance (5 min)

1. Go to **console.aws.amazon.com** → EC2 → **Launch Instance**

2. Settings:
   - **Name:** nikki-voice-server
   - **AMI:** Ubuntu Server 22.04 LTS (Free tier eligible)
   - **Instance type:** t3.micro (Free tier — 750 hours/month free)
   - **Region:** Asia Pacific (Mumbai) — ap-south-1
   - **Key pair:** Create new → name it `nikki-key` → Download .pem file → SAVE IT

3. Network settings → **Edit**:
   - Allow SSH from your IP
   - Allow HTTP (port 80) from anywhere
   - Allow HTTPS (port 443) from anywhere
   - Add custom rule: Port 8000 from anywhere (voice pipeline)
   - Add custom rule: Port 4000 from anywhere (API server)

4. Storage: 20 GB gp3 (free tier gives 30GB)

5. Click **Launch Instance**

---

## STEP 2 — Connect to EC2 (2 min)

```bash
# On your Windows machine — open Command Prompt or Git Bash:

# Fix key permissions (Windows Git Bash):
chmod 400 nikki-key.pem

# SSH in (replace with your EC2 Public IP):
ssh -i nikki-key.pem ubuntu@YOUR_EC2_PUBLIC_IP

# Example:
ssh -i nikki-key.pem ubuntu@13.233.xx.xx
```

---

## STEP 3 — Run Setup Script (10 min, automated)

```bash
# Once inside EC2:

# Download and run the setup script
curl -o setup_ec2.sh https://raw.githubusercontent.com/jovioglobaltechnologies/jovi/main/voice-pipeline/setup_ec2.sh
bash setup_ec2.sh

# This installs: Python 3.11, Node.js 20, Nginx, Supervisor, Docker, UFW
# Clones the repo, sets up venvs, configures process manager
```

---

## STEP 4 — Add Your Environment Variables

```bash
# Create .env file with your real keys:
nano /home/ubuntu/jovi/voice-pipeline/.env

# Paste this content and fill in values:
SUPABASE_URL=https://wnawozdmmxuziucavngw.supabase.co
SUPABASE_SERVICE_KEY=<paste_your_service_role_key>
SARVAM_API_KEY=<paste_your_sarvam_key>
GEMINI_API_KEY=<paste_your_gemini_key>
LIVEKIT_URL=wss://nikki-7xgvqaga.livekit.cloud
LIVEKIT_API_KEY=<paste_your_livekit_api_key>
LIVEKIT_API_SECRET=<paste_your_livekit_secret>
INTERNAL_SECRET=nikki-internal-2026

# Press Ctrl+X → Y → Enter to save

# Restart the pipeline to load new env:
sudo supervisorctl restart nikki-pipeline
```

---

## STEP 5 — Test It's Working

```bash
# Test voice pipeline health:
curl http://localhost:8000/health

# Expected response:
# {"status":"ok","service":"nikki-voice-pipeline","timestamp":"..."}

# Test from your laptop (replace with your EC2 IP):
curl http://YOUR_EC2_IP:8000/health

# Check logs if something's wrong:
sudo tail -f /var/log/nikki-pipeline.out.log
sudo tail -f /var/log/nikki-pipeline.err.log
```

---

## STEP 6 — Connect Exotel Webhook

Once Exotel activates your DID number:

1. Exotel Dashboard → ExoPhone → your number → App
2. Set webhook URL: `http://YOUR_EC2_IP:8000/webhooks/exotel/inbound`  
   (or `https://pipeline.jovio.in/webhooks/exotel/inbound` if you add domain)
3. Add header: `X-Internal-Secret: nikki-internal-2026`
4. Call your Exotel number → Nikki AI answers in Telugu! 🎉

---

## STEP 7 — Add Domain + SSL (Optional but recommended)

```bash
# If you have jovio.in domain:
# Point pipeline.jovio.in → your EC2 public IP in DNS

# Then get free SSL:
sudo certbot --nginx -d pipeline.jovio.in -d api.jovio.in

# Nginx auto-configured for HTTPS ✅
```

---

## Daily Operations

```bash
# Check status of all services:
sudo supervisorctl status

# Restart voice pipeline:
sudo supervisorctl restart nikki-pipeline

# View live logs:
sudo tail -f /var/log/nikki-pipeline.out.log

# Deploy new code after git push:
bash /home/ubuntu/jovi/voice-pipeline/deploy.sh

# Check EC2 resource usage:
htop
```

---

## Cost Breakdown

| Resource | Cost |
|---|---|
| EC2 t3.micro (ap-south-1) | FREE for 12 months (750 hrs/month) |
| 20GB EBS storage | FREE (30GB free tier) |
| Data transfer | FREE (15GB/month) |
| Elastic IP | FREE if attached to running instance |
| **Total Year 1** | **₹0** |
| After 12 months | ~₹700-800/month |

---

## Architecture on EC2

```
EC2 t3.micro (Mumbai ap-south-1)
├── Supervisor (process manager)
│   ├── nikki-pipeline → uvicorn main:app :8000
│   └── nikki-api → node dist/index.js :4000
├── Nginx (reverse proxy)
│   ├── pipeline.jovio.in → :8000
│   └── api.jovio.in → :4000
└── UFW firewall (22, 80, 443, 8000, 4000)
```

---

*Jovio Global Technologies · Powered by Nikki Tech Labs*
