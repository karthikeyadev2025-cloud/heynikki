#!/bin/bash
# ============================================================
# HEYNIKKI — Quick Deploy / Update Script
# Run this every time you push new code
# Usage: bash deploy.sh
# ============================================================

set -e

echo "🚀 HeyNikki — Deploying latest code..."

cd /home/ubuntu/heynikki
git pull origin main

# Update voice pipeline
echo "📦 Updating Python dependencies..."
cd /home/ubuntu/heynikki/voice-pipeline
source venv/bin/activate
pip install -r requirements.txt --quiet
deactivate

# Update API server
echo "📦 Updating Node dependencies..."
cd /home/ubuntu/heynikki/api-server
npm install --quiet
npm run build 2>/dev/null || true

# Restart services
echo "🔄 Restarting services..."
sudo supervisorctl restart heynikki-pipeline
sudo supervisorctl restart heynikki-api

# Health check
sleep 3
echo "🏥 Health check..."
curl -s http://localhost:8000/health && echo "" || echo "⚠️ Pipeline not responding yet, check logs"
curl -s http://localhost:4000/health && echo "" || echo "⚠️ API not responding yet, check logs"

echo ""
echo "✅ Deploy complete!"
echo "📋 Logs: sudo tail -f /var/log/heynikki-pipeline.out.log"
