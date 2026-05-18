#!/usr/bin/env python3
# fix2.py — Run on VPS: python3 /var/www/ai-caller/fix2.py
import os, re

BASE = '/var/www/ai-caller'

# ── exotelIntegration.js ──────────────────────────────────────────────────────
p = os.path.join(BASE, 'exotelIntegration.js')
with open(p) as f: c = f.read()

# Change "To: studentPhone," → "To: this.normalizePhone(studentPhone),"
c = c.replace('      To: studentPhone,', '      To: this.normalizePhone(studentPhone),', 1)
print('normalizePhone in To:', 'this.normalizePhone(studentPhone)' in c)

# Fix audio path: BASE_URL + audioPath (no slash) → BASE_URL + / + audioPath
# Pattern: ${process.env.BASE_URL || 'http://localhost:3001'}${audioPath}
c = c.replace(
    "${process.env.BASE_URL || 'http://localhost:3001'}${audioPath}",
    "${(process.env.BASE_URL||'http://localhost:3001').replace(/\\/$/,'')}/${audioPath.replace(/^\\//, '')}"
)
print('audio path fixed:', 'replace(/\\/$/' in c)

with open(p, 'w') as f: f.write(c)
print('✅ exotelIntegration.js Fix 2 done')

# ── dashboard-server.js ───────────────────────────────────────────────────────
p = os.path.join(BASE, 'dashboard-server.js')
with open(p) as f: c = f.read()

# 1) app.post → app.all for exotel webhooks
c_new = re.sub(r"app\.post\('(/webhook/exotel-[^']+)'", r"app.all('\1'", c)
changed = c_new != c
c = c_new
print('app.post → app.all:', changed)

# 2) Fix status callback
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
  console.log('📊 Call', callSid, 'status:', callStatus, 'duration:', (callDuration||'?') + 's');"""

if old in c:
    c = c.replace(old, new)
    print('✅ status callback fixed')
else:
    print('ℹ️  status callback already patched or pattern changed')

# 3) Fix call-connect webhook logging
old2 = """app.all('/webhook/exotel-call-connect', async (req, res) => {
  console.log('🔗 Exotel call connected:', req.body);
  const callSid = req.body.CallSid;"""

new2 = """app.all('/webhook/exotel-call-connect', async (req, res) => {
  const data = { ...req.query, ...req.body };
  console.log('🔗 CALL-CONNECT HIT:', req.method, JSON.stringify(data));
  const callSid = data.CallSid || data.call_sid;"""

if old2 in c:
    c = c.replace(old2, new2)
    print('✅ call-connect webhook fixed')
else:
    print('ℹ️  call-connect already patched or pattern changed')

# 4) Add test webhook if missing
if '/webhook/exotel-test' not in c:
    inject = """
// Simple test webhook — no TTS/AI, just confirms phone can ring
app.all('/webhook/exotel-test', (req, res) => {
  const d = { ...req.query, ...req.body };
  console.log('\\u{1F52C} TEST WEBHOOK HIT:', req.method, JSON.stringify(d));
  res.set('Content-Type', 'application/xml');
  res.send('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="woman">Hello! Test call from Campus Dekho AI. System is working. Goodbye.</Say><Hangup/></Response>');
});

"""
    # Insert before call-connect webhook
    marker = "app.all('/webhook/exotel-call-connect'"
    if marker in c:
        c = c.replace(marker, inject + marker, 1)
        print('✅ /webhook/exotel-test added')
    else:
        print('⚠️  Could not find insertion point for test webhook')
else:
    print('ℹ️  /webhook/exotel-test already present')

# 5) Add dial-whom if missing
if '/webhook/exotel-dial-whom' not in c:
    inject = """
// Dial Whom — Exotel Landing Flow Connect applet calls this for number to dial
app.all('/webhook/exotel-dial-whom', (req, res) => {
  const d = { ...req.query, ...req.body };
  console.log('\\u{1F4DE} DIAL WHOM HIT:', req.method, JSON.stringify(d));
  let phone = '08379955419';
  if (typeof exotelCaller !== 'undefined' && exotelCaller && exotelCaller.activeCalls) {
    for (const [, s] of exotelCaller.activeCalls.entries()) {
      if (s.studentPhone) { phone = s.studentPhone; break; }
    }
  }
  console.log('\\u{1F4DE} Dial Whom returning:', phone);
  res.set('Content-Type', 'text/plain');
  res.send(phone);
});

"""
    marker = "app.all('/webhook/exotel-call-connect'"
    if marker in c:
        c = c.replace(marker, inject + marker, 1)
        print('✅ /webhook/exotel-dial-whom added')
    else:
        print('⚠️  Could not find insertion point for dial-whom webhook')
else:
    print('ℹ️  /webhook/exotel-dial-whom already present')

# 6) Add test-call API if missing
if '/api/exotel/test-call' not in c:
    inject = """
// Test call — simple XML, confirms phone rings without TTS/AI
app.post('/api/exotel/test-call', async (req, res) => {
  const { phone } = req.body;
  if (!exotelCaller) return res.status(503).json({ error: 'Exotel caller not initialized' });
  if (!phone) return res.status(400).json({ error: 'Phone number required' });
  try {
    const call = await exotelCaller.makeCall(phone, 'Test', true);
    res.json({ success: true, callSid: call.Sid, message: 'Test call initiated to ' + phone });
  } catch (e) {
    console.error('Test call failed:', e);
    res.status(500).json({ error: e.message });
  }
});

"""
    marker = "// API: Start real outbound call to a student"
    if marker in c:
        c = c.replace(marker, inject + marker, 1)
        print('✅ /api/exotel/test-call added')
    else:
        print('⚠️  Could not find insertion point for test-call API')
else:
    print('ℹ️  /api/exotel/test-call already present')

# 7) Fix handleCallConnect session creation in exotelIntegration.js
pe = os.path.join(BASE, 'exotelIntegration.js')
with open(pe) as f: ce = f.read()

old3 = """    const callSession = this.activeCalls.get(callSid);
    if (!callSession) {
      console.log('❌ Unknown call session');
      return this.endCall(res);
    }"""

new3 = """    let callSession = this.activeCalls.get(callSid);
    if (!callSession) {
      console.log('\U0001f195 New session from webhook:', callSid);
      callSession = { studentPhone: (req.body && req.body.From) || 'unknown', studentName: 'Student', aiSession: null, startTime: Date.now() };
      this.activeCalls.set(callSid, callSession);
    }"""

if old3 in ce:
    ce = ce.replace(old3, new3)
    print('✅ handleCallConnect session-creation fixed')
else:
    print('ℹ️  handleCallConnect already fixed or pattern changed')

with open(pe, 'w') as f: f.write(ce)

with open(p, 'w') as f: f.write(c)
print('\n✅ All fixes applied. Now run: pm2 restart ai-caller')
