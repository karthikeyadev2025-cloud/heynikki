#!/bin/bash
# ============================================================
# HEYNIKKI — EC2 Setup Script for Ubuntu 24.04
# ============================================================

set -e

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   HEYNIKKI — EC2 Setup Ubuntu 24.04    ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── 1. SYSTEM UPDATE ─────────────────────────────────────
echo "📦 Updating system..."
sudo apt-get update -y
sudo apt-get install -y \
    curl wget git unzip \
    python3 python3-venv python3-pip \
    nginx certbot python3-certbot-nginx \
    supervisor ufw htop build-essential \
    python3-dev libffi-dev libssl-dev gcc g++

# ── 2. CLONE REPO ────────────────────────────────────────
echo "📥 Cloning Hey Nikki repo..."
cd /home/ubuntu
if [ -d "heynikki" ]; then
    cd heynikki && git pull origin main
    cd /home/ubuntu
else
    git clone https://github.com/karthikeyadev2025-cloud/heynikki.git
fi

# ── 3. PYTHON VENV (uses python3 = 3.12 on Ubuntu 24) ───
echo "🐍 Setting up Python environment..."
cd /home/ubuntu/heynikki/voice-pipeline
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip wheel
pip install -r requirements.txt
deactivate
echo "✅ Python dependencies installed"

# ── 4. NODE.JS 20 ────────────────────────────────────────
echo "📦 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
npm --version

# ── 5. API SERVER ────────────────────────────────────────
echo "📦 Installing API server dependencies..."
cd /home/ubuntu/heynikki/api-server
npm install
echo "✅ API server dependencies installed"

# ── 6. SUPERVISOR CONFIG ─────────────────────────────────
echo "⚙️ Configuring Supervisor..."
sudo tee /etc/supervisor/conf.d/heynikki-pipeline.conf << 'EOF'
[program:heynikki-pipeline]
command=/home/ubuntu/heynikki/voice-pipeline/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
directory=/home/ubuntu/heynikki/voice-pipeline
user=ubuntu
autostart=true
autorestart=true
stopasgroup=true
killasgroup=true
stderr_logfile=/var/log/heynikki-pipeline.err.log
stdout_logfile=/var/log/heynikki-pipeline.out.log
environment=HOME="/home/ubuntu",USER="ubuntu",PATH="/home/ubuntu/heynikki/voice-pipeline/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin"
EOF

sudo tee /etc/supervisor/conf.d/heynikki-api.conf << 'EOF'
[program:heynikki-api]
command=/usr/bin/node /home/ubuntu/heynikki/api-server/src/index.ts
directory=/home/ubuntu/heynikki/api-server
user=ubuntu
autostart=false
autorestart=true
stderr_logfile=/var/log/heynikki-api.err.log
stdout_logfile=/var/log/heynikki-api.out.log
EOF

# ── 7. NGINX CONFIG ──────────────────────────────────────
echo "🌐 Configuring Nginx..."
sudo tee /etc/nginx/sites-available/heynikki << 'EOF'
server {
    listen 80 default_server;
    server_name _;

    location / {
        proxy_pass         http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}

server {
    listen 4000;
    server_name _;
    location / {
        proxy_pass http://localhost:4001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/heynikki /etc/nginx/sites-enabled/heynikki
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx

# ── 8. FIREWALL ──────────────────────────────────────────
echo "🔒 Configuring firewall..."
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw allow 8000
sudo ufw allow 4000
sudo ufw --force enable

# ── 9. CREATE .env PLACEHOLDER ───────────────────────────
if [ ! -f /home/ubuntu/heynikki/voice-pipeline/.env ]; then
    cp /home/ubuntu/heynikki/voice-pipeline/.env.ec2 /home/ubuntu/heynikki/voice-pipeline/.env
    echo "⚠️  .env file created from template — fill in your real keys!"
fi

# ── 10. START SERVICES ───────────────────────────────────
sudo supervisorctl reread
sudo supervisorctl update

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  ✅ HEYNIKKI EC2 SETUP COMPLETE!                   ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Next: Add your API keys to .env                ║"
echo "║  Run:  nano /home/ubuntu/heynikki/voice-pipeline/.env ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "After filling .env, run:"
echo "  sudo supervisorctl start heynikki-pipeline"
echo "  curl http://localhost:8000/health"

# ── 7. NEXT STEPS ────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
echo "  Setup complete. For production, also run:"
echo ""
echo "  1. Create /etc/heynikki/voice-pipeline.env and"
echo "     /etc/heynikki/api-server.env (see .env.example)"
echo ""
echo "  2. Switch from Supervisor to systemd:"
echo "       bash infra/aws/AWS_DEPLOYMENT.md  # see step 5"
echo ""
echo "  3. Install Nginx config:"
echo "       sudo cp infra/nginx/heynikki.conf /etc/nginx/sites-available/"
echo "       sudo ln -sf /etc/nginx/sites-available/heynikki.conf \\"
echo "                   /etc/nginx/sites-enabled/heynikki.conf"
echo "       sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "  4. Install CloudWatch agent (needs IAM role on instance):"
echo "       bash infra/aws/setup-cloudwatch.sh"
echo ""
echo "  Full guide: infra/aws/AWS_DEPLOYMENT.md"
echo "════════════════════════════════════════════════════"
