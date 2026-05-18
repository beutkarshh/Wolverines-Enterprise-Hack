#!/usr/bin/env python3
"""
patch_server.py — Run this on the VPS to apply all Exotel fixes at once.
Usage: python3 patch_server.py
"""
import subprocess, os, sys

SERVER_DIR = '/var/www/ai-caller'

def run(cmd):
    r = subprocess.run(cmd, shell=True, cwd=SERVER_DIR, capture_output=True, text=True)
    print(f'$ {cmd}')
    if r.stdout.strip(): print(r.stdout.strip())
    if r.stderr.strip(): print('STDERR:', r.stderr.strip())
    return r.returncode

# ── 1. Backup originals ────────────────────────────────────────────────────
run('cp exotelIntegration.js exotelIntegration.js.bak')
run('cp dashboard-server.js dashboard-server.js.bak')
print('✅ Backups created')

# ── 2. Fix phone number format in exotelIntegration.js ────────────────────
exotel_path = os.path.join(SERVER_DIR, 'exotelIntegration.js')
with open(exotel_path, 'r') as f:
    content = f.read()

# Add normalizePhone method before makeCall if not already present
if 'normalizePhone' not in content:
    normalize_method = '''  // Normalize to Exotel format: 0XXXXXXXXXX (11 digits) for Indian numbers
  normalizePhone(phone) {
    const digits = String(phone).replace(/\\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) return '0' + digits.slice(2);
    if (digits.length === 10) return '0' + digits;
    if (digits.length === 11 && digits.startsWith('0')) return digits;
    return digits;
  }

  '''
    content = content.replace('  // Make outbound call to student', normalize_method + '  // Make outbound call to student')
    print('✅ Added normalizePhone method')

# Fix the makeCall To parameter to use normalized number
if 'const normalizedTo = this.normalizePhone(studentPhone)' not in content:
    content = content.replace(
        'async makeCall(studentPhone, studentName = \'Student\') {',
        'async makeCall(studentPhone, studentName = \'Student\', testMode = false) {'
    )
    content = content.replace(
        "    const callData = querystring.stringify({\n      From: this.fromNumber,\n      To: studentPhone,",
        """    const normalizedTo = this.normalizePhone(studentPhone);
    console.log(`📱 Phone: ${studentPhone} → ${normalizedTo}`);
    const base = (process.env.BASE_URL || 'http://localhost:3001').replace(/\\/$/, '');
    const connectUrl = testMode ? `${base}/webhook/exotel-test` : `${base}/webhook/exotel-call-connect`;
    console.log(`📞 Url: ${connectUrl}`);
    const callData = querystring.stringify({
      From: this.fromNumber,
      To: normalizedTo,"""
    )
    print('✅ Fixed makeCall phone normalization')

# Fix audio path (missing slash between BASE_URL and audioPath)
content = content.replace(
    '`${process.env.BASE_URL || \'http://localhost:3001\'}${audioPath}`',
    '`${(process.env.BASE_URL||\'http://localhost:3001\').replace(/\\/$/,\'\')}/${audioPath.replace(/^\\//, \'\')}`'
)
content = content.replace(
    'Url: `${process.env.BASE_URL || \'http://localhost:3001\'}/webhook/exotel-call-connect`',
    'Url: connectUrl'
)
content = content.replace(
    'StatusCallback: `${process.env.BASE_URL || \'http://localhost:3001\'}/webhook/exotel-call-status`',
    'StatusCallback: `${base}/webhook/exotel-call-status`'
)

with open(exotel_path, 'w') as f:
    f.write(content)
print('✅ exotelIntegration.js patched')

# ── 3. Fix dashboard-server.js webhooks ───────────────────────────────────
server_path = os.path.join(SERVER_DIR, 'dashboard-server.js')
with open(server_path, 'r') as f:
    content = f.read()

# Change app.post to app.all for all exotel webhooks
import re
content = re.sub(r"app\.post\('(/webhook/exotel-[^']+)'", r"app.all('\1'", content)
print('✅ Changed app.post → app.all for exotel webhooks')

# Fix status callback to log everything and try multiple field names
old_status = """app.all('/webhook/exotel-call-status', (req, res) => {
  console.log('📊 Exotel call status update:', req.body);
  const callSid = req.body.CallSid;
  const callStatus = req.body.CallStatus;
  const callDuration = req.body.CallDuration;"""

new_status = """app.all('/webhook/exotel-call-status', (req, res) => {
  const data = { ...req.query, ...req.body };
  console.log('📊 Exotel status BODY:', JSON.stringify(req.body), 'QUERY:', JSON.stringify(req.query));
  const callSid = data.CallSid || data.call_sid || data.Sid;
  const callStatus = data.CallStatus || data.call_status || data.Status || data.status;
  const callDuration = data.CallDuration || data.call_duration || data.Duration || data.duration;
  console.log(`📊 Call ${callSid} status: ${callStatus}, duration: ${callDuration}s`);"""

if old_status in content:
    content = content.replace(old_status, new_status)
    print('✅ Fixed status callback logging')

# Fix call-connect to log method+body+query
old_connect = """app.all('/webhook/exotel-call-connect', async (req, res) => {
  console.log('🔗 Exotel call connected:', req.body);
  const callSid = req.body.CallSid;"""

new_connect = """app.all('/webhook/exotel-call-connect', async (req, res) => {
  const data = { ...req.query, ...req.body };
  console.log('🔗 Exotel call-connect HIT:', req.method, JSON.stringify(data));
  const callSid = data.CallSid || data.call_sid;"""

if old_connect in content:
    content = content.replace(old_connect, new_connect)
    print('✅ Fixed call-connect webhook')

# Add test webhook and dial-whom if not present
if '/webhook/exotel-test' not in content:
    test_webhooks = """
// Webhook: Simple test — confirm phone rings without TTS/AI complexity
app.all('/webhook/exotel-test', (req, res) => {
  const data = { ...req.query, ...req.body };
  console.log('🔬 TEST WEBHOOK HIT:', req.method, JSON.stringify(data));
  res.set('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="woman">Hello! This is a test call from Campus Dekho AI. The system is working correctly. Thank you for your time.</Say><Hangup/></Response>`);
});

"""
    content = content.replace(
        "// Webhook: Called when student answers the phone",
        test_webhooks + "// Webhook: Called when student answers the phone"
    )
    print('✅ Added /webhook/exotel-test endpoint')

if '/webhook/exotel-dial-whom' not in content:
    dial_whom = """
// Webhook: Dial Whom — Landing Flow Connect applet calls this for the number to dial
app.all('/webhook/exotel-dial-whom', (req, res) => {
  const data = { ...req.query, ...req.body };
  console.log('📞 Dial Whom HIT:', req.method, JSON.stringify(data));
  let phone = '08379955419';
  if (exotelCaller && exotelCaller.activeCalls && exotelCaller.activeCalls.size > 0) {
    for (const [sid, session] of exotelCaller.activeCalls.entries()) {
      if (session.studentPhone) { phone = session.studentPhone; break; }
    }
  }
  console.log('📞 Dial Whom returning:', phone);
  res.set('Content-Type', 'text/plain');
  res.send(phone);
});

"""
    content = content.replace(
        "// Webhook: Called when student answers the phone",
        dial_whom + "// Webhook: Called when student answers the phone"
    )
    print('✅ Added /webhook/exotel-dial-whom endpoint')

# Add test-call API if not present
if '/api/exotel/test-call' not in content:
    test_call_api = """
// API: Test call — simple XML, confirms phone rings without TTS/AI
app.post('/api/exotel/test-call', async (req, res) => {
  const { phone } = req.body;
  if (!exotelCaller) return res.status(503).json({ error: 'Exotel caller not initialized' });
  if (!phone) return res.status(400).json({ error: 'Phone number required' });
  try {
    const call = await exotelCaller.makeCall(phone, 'Test', true);
    res.json({ success: true, callSid: call.Sid, normalizedPhone: exotelCaller.normalizePhone(phone), message: `Test call to ${phone}` });
  } catch (error) {
    console.error('❌ Test call failed:', error);
    res.status(500).json({ error: error.message });
  }
});

"""
    content = content.replace(
        "// API: Start real outbound call to a student",
        test_call_api + "// API: Start real outbound call to a student"
    )
    print('✅ Added /api/exotel/test-call endpoint')

with open(server_path, 'w') as f:
    f.write(content)
print('✅ dashboard-server.js patched')

# ── 4. Restart PM2 ────────────────────────────────────────────────────────
print('\n🔄 Restarting PM2...')
run('pm2 restart ai-caller')
import time
time.sleep(3)
run('pm2 status')
print('\n✅ Done! Now test with:')
print('  curl -X POST http://194.238.17.210/api/exotel/test-call -H "Content-Type: application/json" -d \'{"phone":"8379955419"}\'')
print('  pm2 logs ai-caller --lines 20')
