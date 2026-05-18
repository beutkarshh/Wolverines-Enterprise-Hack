#!/bin/bash
# deploy_exotel_fix.sh
# Run on VPS: bash deploy_exotel_fix.sh
# This applies all Exotel phone-not-ringing fixes

set -e
cd /var/www/ai-caller

echo "=== Backing up current files ==="
cp exotelIntegration.js exotelIntegration.js.bak2
cp dashboard-server.js dashboard-server.js.bak2
echo "✅ Backups: *.bak2"

# ── Fix 1: Phone number normalization ────────────────────────────────────────
# Add normalizePhone method if not present
if ! grep -q 'normalizePhone' exotelIntegration.js; then
python3 - <<'PYEOF'
path = '/var/www/ai-caller/exotelIntegration.js'
with open(path) as f: c = f.read()

method = """  // Normalize to Exotel format: 0XXXXXXXXXX (11 digits) for Indian numbers
  normalizePhone(phone) {
    const digits = String(phone).replace(/\\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) return '0' + digits.slice(2);
    if (digits.length === 10) return '0' + digits;
    if (digits.length === 11 && digits.startsWith('0')) return digits;
    return digits;
  }

  """
c = c.replace('  // Make outbound call to student', method + '  // Make outbound call to student', 1)

with open(path, 'w') as f: f.write(c)
print('✅ normalizePhone added')
PYEOF
fi

# ── Fix 2: Use normalized phone in makeCall ───────────────────────────────────
python3 - <<'PYEOF'
import re
path = '/var/www/ai-caller/exotelIntegration.js'
with open(path) as f: c = f.read()

# Normalize the To parameter
c = re.sub(
    r"(const callData = querystring\.stringify\(\{\s*From: this\.fromNumber,\s*To: )(studentPhone)(",)",
    r"\1this.normalizePhone(studentPhone)\3",
    c
)

# Fix audio path (missing slash between BASE_URL and audioPath)
c = re.sub(
    r'\$\{process\.env\.BASE_URL \|\| [\'"]http://localhost:3001[\'"]\}\$\{audioPath\}',
    r"${(process.env.BASE_URL||'http://localhost:3001').replace(/\\/$/,'')}/${audioPath.replace(/^\\//, '')}",
    c
)

with open(path, 'w') as f: f.write(c)
print('✅ makeCall phone normalization applied')
PYEOF

# ── Fix 3: Change app.post → app.all for exotel webhooks ─────────────────────
python3 - <<'PYEOF'
import re
path = '/var/www/ai-caller/dashboard-server.js'
with open(path) as f: c = f.read()

# Change app.post to app.all for all exotel webhook routes
c = re.sub(r"app\.post\('(/webhook/exotel-[^']+)'", r"app.all('\1'", c)

with open(path, 'w') as f: f.write(c)
print('✅ Changed app.post → app.all for exotel webhooks')
PYEOF

# ── Fix 4: Fix status callback to log everything ──────────────────────────────
python3 - <<'PYEOF'
path = '/var/www/ai-caller/dashboard-server.js'
with open(path) as f: c = f.read()

old = """app.all('/webhook/exotel-call-status', (req, res) => {
  console.log('📊 Exotel call status update:', req.body);
  const callSid = req.body.CallSid;
  const callStatus = req.body.CallStatus;
  const callDuration = req.body.CallDuration;"""

new = """app.all('/webhook/exotel-call-status', (req, res) => {
  const data = { ...req.query, ...req.body };
  console.log('📊 STATUS BODY:', JSON.stringify(req.body), 'QUERY:', JSON.stringify(req.query));
  const callSid = data.CallSid || data.call_sid || data.Sid;
  const callStatus = data.CallStatus || data.call_status || data.Status || data.status;
  const callDuration = data.CallDuration || data.call_duration || data.Duration || data.duration;
  console.log('📊 Call', callSid, 'status:', callStatus, 'duration:', callDuration + 's');"""

if old in c:
    c = c.replace(old, new)
    print('✅ Fixed status callback')
else:
    print('⚠️  Status callback pattern not found — may already be patched')

with open(path, 'w') as f: f.write(c)
PYEOF

# ── Fix 5: Add test webhook + dial-whom (if missing) ─────────────────────────
python3 - <<'PYEOF'
path = '/var/www/ai-caller/dashboard-server.js'
with open(path) as f: c = f.read()

if '/webhook/exotel-test' not in c:
    inject = """
// Simple test webhook — no TTS, confirms phone can ring
app.all('/webhook/exotel-test', (req, res) => {
  const data = { ...req.query, ...req.body };
  console.log('🔬 TEST WEBHOOK HIT:', req.method, JSON.stringify(data));
  res.set('Content-Type', 'application/xml');
  res.send('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="woman">Hello! Test call from Campus Dekho AI. System working. Thank you.</Say><Hangup/></Response>');
});

"""
    c = c.replace('// Webhook: Called when student answers', inject + '// Webhook: Called when student answers', 1)
    print('✅ Added /webhook/exotel-test')

if '/webhook/exotel-dial-whom' not in c:
    inject = """
// Dial Whom — Exotel Landing Flow Connect applet calls this for the number to dial
app.all('/webhook/exotel-dial-whom', (req, res) => {
  const data = { ...req.query, ...req.body };
  console.log('📞 DIAL WHOM HIT:', req.method, JSON.stringify(data));
  let phone = '08379955419';
  if (typeof exotelCaller !== 'undefined' && exotelCaller && exotelCaller.activeCalls && exotelCaller.activeCalls.size > 0) {
    for (const [, session] of exotelCaller.activeCalls.entries()) {
      if (session.studentPhone) { phone = session.studentPhone; break; }
    }
  }
  console.log('📞 Dial Whom returning:', phone);
  res.set('Content-Type', 'text/plain');
  res.send(phone);
});

"""
    c = c.replace('// Webhook: Called when student answers', inject + '// Webhook: Called when student answers', 1)
    print('✅ Added /webhook/exotel-dial-whom')

if '/api/exotel/test-call' not in c:
    inject = """
// Test call API — simple XML, no TTS/AI, just confirms phone rings
app.post('/api/exotel/test-call', async (req, res) => {
  const { phone } = req.body;
  if (!exotelCaller) return res.status(503).json({ error: 'Exotel caller not initialized' });
  if (!phone) return res.status(400).json({ error: 'Phone number required' });
  try {
    const call = await exotelCaller.makeCall(phone, 'Test', true);
    res.json({ success: true, callSid: call.Sid, message: `Test call initiated to ${phone}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

"""
    c = c.replace('// API: Start real outbound call', inject + '// API: Start real outbound call', 1)
    print('✅ Added /api/exotel/test-call')

with open(path, 'w') as f: f.write(c)
PYEOF

# ── Fix 6: Fix handleCallConnect to create session if missing ─────────────────
python3 - <<'PYEOF'
path = '/var/www/ai-caller/exotelIntegration.js'
with open(path) as f: c = f.read()

old = """    const callSession = this.activeCalls.get(callSid);
    if (!callSession) {
      console.log('❌ Unknown call session');
      return this.endCall(res);
    }"""

new = """    let callSession = this.activeCalls.get(callSid);
    if (!callSession) {
      console.log('🆕 New session from webhook:', callSid);
      callSession = { studentPhone: req.body?.From || 'unknown', studentName: 'Student', aiSession: null, startTime: Date.now() };
      this.activeCalls.set(callSid, callSession);
    }"""

if old in c:
    c = c.replace(old, new)
    print('✅ Fixed handleCallConnect session creation')
else:
    print('ℹ️  handleCallConnect already fixed or pattern changed')

with open(path, 'w') as f: f.write(c)
PYEOF

# ── Restart PM2 ───────────────────────────────────────────────────────────────
echo ""
echo "=== Restarting PM2 ==="
pm2 restart ai-caller
sleep 3
pm2 status

echo ""
echo "=== FIXES APPLIED ==="
echo ""
echo "Now run this TEST CALL (simple, no TTS — just confirms phone rings):"
echo "  curl -s -X POST http://194.238.17.210/api/exotel/test-call \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"phone\":\"8379955419\"}'"
echo ""
echo "Watch logs:"
echo "  pm2 logs ai-caller --lines 0"
echo ""
echo "Also watch nginx logs:"
echo "  tail -f /var/log/nginx/access.log"
echo ""
echo "If phone still doesn't ring, check Exotel portal:"
echo "  Settings > Test Numbers — verify 8379955419 is whitelisted"
