#!/bin/bash
# ================================================================
# Hey Nikki — Complete EC2 Ubuntu 22.04 Setup Script
# Run as: sudo bash setup_ec2_complete.sh
# ================================================================

set -e
echo "=== Hey Nikki EC2 Setup ==="
echo "Ubuntu 22.04 | Docker + FreeSWITCH + n8n + Activepieces + Nginx"

# ── 1. System Update ──────────────────────────────────────────
apt-get update -y && apt-get upgrade -y
apt-get install -y \
  curl wget git unzip \
  build-essential \
  nginx certbot python3-certbot-nginx \
  ufw fail2ban \
  htop iotop net-tools \
  python3.11 python3.11-pip python3.11-venv

# ── 2. Docker Install ─────────────────────────────────────────
curl -fsSL https://get.docker.com | sh
usermod -aG docker ubuntu
apt-get install -y docker-compose-plugin

# Ensure docker compose v2
docker compose version

# ── 3. Node.js 20 via NVM ────────────────────────────────────
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm install 20
nvm use 20
nvm alias default 20
node --version
npm --version

# ── 4. Security: UFW Firewall ─────────────────────────────────
echo "=== Configuring UFW Firewall ==="
ufw default deny incoming
ufw default allow outgoing

# SSH — change to your IP for production!
ufw allow 22/tcp

# HTTP/HTTPS for Nginx
ufw allow 80/tcp
ufw allow 443/tcp

# SIP — CRITICAL: restrict to Jio + Vi IP ranges only!
# Add Jio Enterprise SIP gateway IPs here:
# ufw allow from JIO_IP_1 to any port 5060 proto udp
# ufw allow from JIO_IP_2 to any port 5060 proto udp
# Add Vi Business SIP gateway IPs here:
# ufw allow from VI_IP_1 to any port 5060 proto udp
echo "⚠️  IMPORTANT: Manually add Jio + Vi SIP IP ranges to UFW!"
echo "   ufw allow from <JIO_GATEWAY_IP> to any port 5060 proto udp"
echo "   ufw allow from <VI_GATEWAY_IP>  to any port 5060 proto udp"

# RTP media ports for FreeSWITCH
ufw allow 16384:32768/udp

# NEVER expose these ports publicly:
# 8021 (FreeSWITCH ESL) — internal only
# 4000 (API Server) — behind Nginx
# 8000 (Voice Pipeline) — behind Nginx
# 5678 (n8n) — behind Nginx
# 8080 (Activepieces) — behind Nginx

ufw --force enable
ufw status verbose

# ── 5. fail2ban for SIP protection ───────────────────────────
cat > /etc/fail2ban/jail.d/freeswitch.conf << 'EOF'
[freeswitch]
enabled  = true
port     = 5060,5061
protocol = udp
filter   = freeswitch
logpath  = /var/log/freeswitch/freeswitch.log
maxretry = 5
bantime  = 3600
EOF
systemctl restart fail2ban

# ── 6. Create directory structure ────────────────────────────
mkdir -p /opt/heynikki
chown ubuntu:ubuntu /opt/heynikki

# ── 7. Clone or update repo ───────────────────────────────────
echo "=== Cloning Hey Nikki repo ==="
if [ -d "/opt/heynikki/.git" ]; then
  cd /opt/heynikki && git pull origin main
else
  git clone https://github.com/karthikeyadev2025-cloud/heynikki.git /opt/heynikki
fi
cd /opt/heynikki

# ── 8. Environment setup ──────────────────────────────────────
if [ ! -f "infra/.env" ]; then
  cp infra/.env.example infra/.env
  echo ""
  echo "⚠️  CRITICAL: Edit infra/.env with your real credentials!"
  echo "   nano /opt/heynikki/infra/.env"
  echo ""
fi

# ── 9. Docker Compose up ──────────────────────────────────────
echo "=== Starting Docker services ==="
cd /opt/heynikki/infra
docker compose pull
docker compose up -d --build

# Wait for services
sleep 10
docker compose ps

# ── 10. SSL Certificates ──────────────────────────────────────
echo ""
echo "=== SSL Certificate Setup ==="
echo "Run these commands after DNS is pointed to this server:"
echo ""
echo "certbot certonly --webroot -w /opt/heynikki/infra/nginx/certbot/www \\"
echo "  -d api.heynikki.in \\"
echo "  -d pipeline.heynikki.in \\"
echo "  -d n8n.heynikki.in \\"
echo "  -d activepieces.heynikki.in \\"
echo "  --agree-tos --non-interactive --email your@email.com"
echo ""
echo "Then: docker compose restart nginx"

# ── 11. Health check ─────────────────────────────────────────
echo ""
echo "=== Health Checks ==="
sleep 5
curl -sf http://localhost:4000/health && echo "✅ API Server: healthy" || echo "❌ API Server: not ready"
curl -sf http://localhost:8000/health && echo "✅ Voice Pipeline: healthy" || echo "❌ Voice Pipeline: not ready"
curl -sf http://localhost:5678/healthz && echo "✅ n8n: healthy" || echo "❌ n8n: not ready"

echo ""
echo "==================================================="
echo "✅ Hey Nikki EC2 setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit /opt/heynikki/infra/.env with real credentials"
echo "2. Add Jio + Vi SIP IP ranges to UFW (see above)"
echo "3. Point DNS records to this server's public IP"
echo "4. Run certbot SSL commands (see above)"
echo "5. Import n8n workflows from infra/n8n/workflows/"
echo "==================================================="
