#!/usr/bin/env python3
# fix3.py — Definitive IVR fix. Run on VPS: python3 /var/www/ai-caller/fix3.py
import os, re

BASE = '/var/www/ai-caller'

# ── 1. exotelIntegration.js ───────────────────────────────────────────────────
p = os.path.join(BASE, 'exotelIntegration.js')
with open(p) as f: c = f.read()

print('=== Current makeCall format ===')
if 'CallType' in c:  print('  CallType:  PRESENT')
else:                print('  CallType:  MISSING  ← needs fix')
if 'CallerId' in c:  print('  CallerId:  present (From=Customer format)')
else:                print('  From:      ExoPhone format (standard)')
if 'exotel-ivr' in c: print('  Url:       exotel-ivr  ✅')
else:                  print('  Url:       NOT exotel-ivr  ← needs fix')

# Replace the entire connectUrl / callData block using regex (handles any partial state)
# Target: everything from "const base" through end of callData stringify block
pattern = re.compile(
    r"(    const base = \(process\.env\.BASE_URL[^\n]+\.replace[^\n]+;)\s*"
    r".*?"             # any existing url/variable lines
    r"(    const callData = querystring\.stringify\(\{)"
    r".*?"             # existing fields
    r"(    \}\);)",
    re.DOTALL
)

replacement = r"""\1
    const ivrUrl = testMode
      ? `${base}/webhook/exotel-test`
      : `${base}/webhook/exotel-ivr`;
    console.log(`\U0001f4de Calling ${studentPhone} (${normalizedTo}) | Url: ${ivrUrl}`);

    \2
      From: this.fromNumber,
      To: normalizedTo,
      CallType: 'trans',
      TimeLimit: '1800',
      TimeOut: '30',
      Url: ivrUrl,
      StatusCallback: `${base}/webhook/exotel-call-status`,
      StatusCallbackMethod: 'POST'
    \3"""

new_c, n = pattern.subn(replacement, c, count=1)
if n == 1:
    c = new_c
    print('✅ callData block replaced (CallType=trans, Url=exotel-ivr)')
else:
    print('⚠️  Regex did not match — applying targeted field patches...')
    # Targeted fallback patches
    c = re.sub(r"    const connectUrl\s*=\s*testMode[^\n]*\n[^\n]*exotel-call-connect[^\n]*;",
               "    const ivrUrl = testMode\n      ? `${base}/webhook/exotel-test`\n      : `${base}/webhook/exotel-ivr`;",
               c)
    c = re.sub(r"const connectUrl\s*=\s*testMode[^\n]*\n[^\n]*exotel-call-connect[^\n]*;",
               "const ivrUrl = testMode\n      ? `${base}/webhook/exotel-test`\n      : `${base}/webhook/exotel-ivr`;",
               c)
    c = c.replace('      From: this.fromNumber,\n      To: normalizedTo,',
                  "      From: this.fromNumber,\n      To: normalizedTo,\n      CallType: 'trans',")
    c = c.replace("      TimeLimit: '300',", "      TimeLimit: '1800',")
    c = c.replace("      Url: connectUrl,", "      Url: ivrUrl,")
    c = c.replace("      Url: ivrUrl,\n      Url: ivrUrl,", "      Url: ivrUrl,")  # dedup
    c = c.replace('connectUrl', 'ivrUrl')
    if 'CallType' in c: print('✅ Fallback patches applied')
    else:               print('❌ Could not patch — check file manually')

# Also fix test webhook URL var if still referencing old name
c = c.replace("console.log(`📞 Using Url: ${connectUrl}", "console.log(`📞 Using Url: ${ivrUrl}")

with open(p, 'w') as f: f.write(c)

# Verify
with open(p) as f: verify = f.read()
print()
print('=== Verification ===')
print('  CallType=trans:', 'CallType' in verify)
print('  exotel-ivr url:', 'exotel-ivr' in verify)
print('  ivrUrl var:    ', 'ivrUrl' in verify)
print()

# ── 2. dashboard-server.js — add IVR endpoints ────────────────────────────────
p2 = os.path.join(BASE, 'dashboard-server.js')
with open(p2) as f: c2 = f.read()

if '/webhook/exotel-ivr' not in c2:
    ivr_block = r"""
// ── Direct IVR: student answers → Exotel calls this ─────────────────────────
app.all('/webhook/exotel-ivr', (req, res) => {
  const data = { ...req.query, ...req.body };
  console.log('📞 IVR hit:', req.method, JSON.stringify(data));
  const base = (process.env.BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
  res.set('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-IN">Hello! I am Priya from Campus Dekho A I. Press 1 for upcoming M H T C E T events. Press 2 for counselling packages. Press 9 to request a callback. Press 0 to hear this again.</Say>
  <Gather timeout="10" numDigits="1" action="${base}/webhook/exotel-ivr-gather" method="POST"></Gather>
  <Redirect method="POST">${base}/webhook/exotel-ivr</Redirect>
</Response>`);
});

app.all('/webhook/exotel-ivr-gather', (req, res) => {
  const data = { ...req.query, ...req.body };
  const digits = data.Digits || data.digits || '';
  console.log('📞 IVR gather digits:', digits, JSON.stringify(data));
  const base = (process.env.BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
  res.set('Content-Type', 'application/xml');

  if (digits === '1') {
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-IN">We have M H T C E T preparation events across Pune, Kolhapur, Sangli, and Satara from April 20 to May 10 2026. Events include expert counselling, campus tours, and college admission guidance. Press 1 for Pune dates. Press 2 for Kolhapur. Press 3 for Sangli. Press 4 for Satara. Press 0 for main menu.</Say>
  <Gather timeout="10" numDigits="1" action="${base}/webhook/exotel-ivr-city" method="POST"></Gather>
  <Redirect method="POST">${base}/webhook/exotel-ivr</Redirect>
</Response>`);
  } else if (digits === '2') {
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-IN">Campus Dekho offers three counselling packages. Basic at 999 rupees, Premium at 2999 rupees, and Elite at 5999 rupees. Each includes expert guidance for M H T C E T college admissions. Press 9 to talk to a counsellor now. Press 0 for main menu.</Say>
  <Gather timeout="10" numDigits="1" action="${base}/webhook/exotel-ivr-gather" method="POST"></Gather>
  <Redirect method="POST">${base}/webhook/exotel-ivr</Redirect>
</Response>`);
  } else if (digits === '9') {
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-IN">Thank you for your interest in Campus Dekho! Our expert counsellor will call you back within 24 hours. You can also visit us at campusdekho dot a i. Goodbye and best of luck!</Say>
  <Hangup/>
</Response>`);
  } else {
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${base}/webhook/exotel-ivr</Redirect>
</Response>`);
  }
});

app.all('/webhook/exotel-ivr-city', (req, res) => {
  const data = { ...req.query, ...req.body };
  const digits = data.Digits || data.digits || '';
  const base = (process.env.BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
  const cityMap = {
    '1': 'Pune events: April 27 at Symbiosis, April 28 at COEP, May 3 at VIT, and May 4 at MIT. All events are from 10 AM to 4 PM.',
    '2': 'Kolhapur events: April 20 at Shivaji University, April 22 at DY Patil, April 24 at Rajaram College, April 26 at KIT, and April 28 at DKTE.',
    '3': 'Sangli events: April 21 at Walchand College, April 23 at KIT Walchand, April 25 at Annasaheb Dange College, April 27 at Bharati Vidyapeeth, and April 29 at TKIET.',
    '4': 'Satara events: April 22 at Rayat Shikshan, April 24 at Karmaveer Bhaurao, April 26 at Yashavantrao Chavan, and April 28 at Satara College.'
  };
  const text = cityMap[digits] || 'Sorry, I did not catch that. Let me take you back to the main menu.';
  res.set('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-IN">${text} Press 9 to request a callback. Press 0 for main menu.</Say>
  <Gather timeout="10" numDigits="1" action="${base}/webhook/exotel-ivr-gather" method="POST"></Gather>
  <Redirect method="POST">${base}/webhook/exotel-ivr</Redirect>
</Response>`);
});

"""
    # Insert before call-status webhook (or before call-connect, or at end)
    for marker in ["app.all('/webhook/exotel-call-status'",
                   "app.all('/webhook/exotel-call-connect'",
                   "app.post('/webhook/exotel-call-status'",
                   "app.post('/webhook/exotel-call-connect'"]:
        if marker in c2:
            c2 = c2.replace(marker, ivr_block + marker, 1)
            print(f'✅ IVR endpoints injected before {marker}')
            break
    else:
        c2 += '\n' + ivr_block
        print('✅ IVR endpoints appended to end of file')
else:
    print('ℹ️  /webhook/exotel-ivr already present')

with open(p2, 'w') as f: f.write(c2)
print('✅ dashboard-server.js saved')

print("""
╔══════════════════════════════════════════════════════════════╗
║  fix3.py complete — now run:                                 ║
║                                                              ║
║  pm2 restart ai-caller && sleep 3 && pm2 logs ai-caller --lines 0
║                                                              ║
║  Then from another terminal, trigger a test call:           ║
║  curl -s -X POST http://194.238.17.210/api/exotel/call \\    ║
║       -H 'Content-Type: application/json' \\                 ║
║       -d '{"phone":"8379955419"}'                            ║
╚══════════════════════════════════════════════════════════════╝
""")
