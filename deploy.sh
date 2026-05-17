#!/bin/bash
# deploy.sh — One-shot deployment for Hostinger KVM2 (Ubuntu)
# Run as root on the VPS: bash deploy.sh

set -e
echo "🚀 Starting AI Caller System deployment..."

# ── 1. System deps ────────────────────────────────────────────────────────────
apt-get update -y && apt-get upgrade -y
apt-get install -y curl git nginx build-essential python3

# ── 2. Node.js 22 ─────────────────────────────────────────────────────────────
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
echo "✅ Node $(node -v) installed"

# ── 3. PM2 ───────────────────────────────────────────────────────────────────
npm install -g pm2
pm2 startup systemd -u root --hp /root
echo "✅ PM2 installed"

# ── 4. App directory ──────────────────────────────────────────────────────────
mkdir -p /var/www/ai-caller
cd /var/www/ai-caller

# If deploying via git:
# git clone https://github.com/beutkarshh/CD-Calling-Agents.git .
# Otherwise upload files via SFTP/SCP and continue from here

# ── 5. Install dependencies ───────────────────────────────────────────────────
npm install --production
mkdir -p logs
echo "✅ Dependencies installed"

# ── 6. .env — EDIT THIS before running ───────────────────────────────────────
if [ ! -f .env ]; then
  echo "⚠️  No .env file found!"
  echo "    Create /var/www/ai-caller/.env with your API keys before continuing."
  echo "    Required: GEMINI_API_KEY, ELEVENLABS_API_KEY, TWILIO_*, EXOTEL_*"
  exit 1
fi

# ── 7. Start with PM2 ────────────────────────────────────────────────────────
pm2 delete ai-caller 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save
echo "✅ App started with PM2"

# ── 8. nginx ─────────────────────────────────────────────────────────────────
SERVER_IP=$(curl -s ifconfig.me)
sed "s/YOUR_SERVER_IP_OR_DOMAIN/$SERVER_IP/g" nginx.conf > /etc/nginx/sites-available/ai-caller
ln -sf /etc/nginx/sites-available/ai-caller /etc/nginx/sites-enabled/ai-caller
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
echo "✅ nginx configured"

# ── 9. Firewall ───────────────────────────────────────────────────────────────
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
echo "✅ Firewall configured"

echo ""
echo "════════════════════════════════════════"
echo "  ✅ DEPLOYMENT COMPLETE"
echo "  Open: http://$SERVER_IP"
echo "  Admin: http://$SERVER_IP/admin"
echo "  Inbound: http://$SERVER_IP/inbound-dashboard"
echo "  Onboard: http://$SERVER_IP/onboard"
echo ""
echo "  PM2 commands:"
echo "    pm2 status         — check app status"
echo "    pm2 logs ai-caller — view live logs"
echo "    pm2 restart ai-caller — restart app"
echo "════════════════════════════════════════"
