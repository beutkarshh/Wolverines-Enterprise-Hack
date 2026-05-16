# Agentic Calling System — Progress & Status

**Project**: Campus Dekho AI Voice Agent  
**Last Updated**: 2026-05-03  
**Repository**: https://github.com/beutkarshh/Agentic-Calling.git

---

## What's Built

### 1. Outbound AI Calling (Exotel + Gemini + ElevenLabs)
- AI agent **Priya** calls MHT-CET students on behalf of campusdekho.ai
- **Gemini 2.0 Flash** powers the conversation engine
- **ElevenLabs TTS** generates natural voice (English, Hindi, Marathi voices)
- Promotes 24 seminar venues across Maharashtra (Apr–May 2026)
- INTENT detection: `rsvp_yes`, `rsvp_no`, `not_interested`, `need_info`
- Bulk calling support with configurable delay between calls
- Session management via `activeCalls` Map (callSid → studentInfo)

### 2. Inbound Call System (Agentic AI)
- Multi-agent orchestrator using Gemini 2.0 Flash with function calling (9 tools)
- Handles counseling packages, MHT-CET doubts, document submission, social events
- **WhatsApp integration** via Twilio sandbox — sends packages, events, checklists
- **Human escalation**: live transfer or callback scheduling
- SQLite database (`inbound-knowledge.db`) with 8 tables
- Admin dashboard at `/inbound-dashboard.html`

### 3. Dashboard & Infrastructure
- Real-time dashboard at `http://localhost:3001`
- WebSocket-based live updates
- SQLite contact database with CSV import
- Queue processor for batch campaigns (up to 4000 contacts)
- Character budget manager for ElevenLabs (1000 chars/day, 30K/month)

### 4. Telephony Stack
- **Exotel** for real phone calls (account: `campusdekhoai1`, region: Singapore)
- ExoPhone: `020-485-63118` (Pune landline)
- **ngrok** (`https://hardcover-punk-glider.ngrok-free.dev`) for local webhook exposure
- Auth: API Key as Basic auth username (not Account SID)

---

## Current Status: Exotel Outbound Integration

### What Works
- Exotel API authentication ✅
- Call initiation via `POST /api/exotel/call` returns valid CallSid ✅
- Ngrok tunneling to local server ✅
- Status callback webhook (`/webhook/exotel-call-status`) ✅
- Inbound call simulation dashboard ✅
- AI conversation engine (Gemini + ElevenLabs) logic ✅

### What Doesn't Work Yet
- **Student's phone never rings** during API-initiated outbound calls
- The `Url` webhook (`/webhook/exotel-call-connect`) is never called by Exotel

---

## Core Problem: Exotel Landing Flow Conflict

### Root Cause
The ExoPhone `020-485-63118` has a **Landing Flow app** (`campusdekhoai1 Landing Flow`, App ID: 1205665) assigned to it. This Landing Flow intercepts ALL outbound calls made via the API.

### What We Tried (and why it failed)

| Attempt | Result |
|---|---|
| Passthru applet → return AI greeting ExoML | `<Gather>` timeout → `<Hangup>` → call died in 6s, phone never rang |
| Passthru → return `<Response></Response>` (empty) | Call died in 2s |
| Passthru → return 404 | Call died in 2s |
| Passthru → return `200 OK` plain text | Call died in 2s |
| Removed Passthru from Landing Flow | Phone still doesn't ring — Connect applet issue |

### Key Findings
1. Exotel's Passthru ExoML **fully replaces** the rest of the Landing Flow — the Connect applet never runs if Passthru is present
2. Exotel ExoML has **no `<Dial>` verb** — we cannot call the student from within a Passthru ExoML response
3. The student's phone number is **not passed** to the Passthru webhook (both `CallTo` and `CallFrom` show the Exotel number)
4. Even after removing the Passthru, the Connect applet does **not** dial the student — it appears to be configured for inbound agent routing, not dynamic outbound dialing
5. The `Url` parameter in `Calls/connect.json` is **never called** — the Landing Flow prevents it

### Why n8n Appeared to Work Previously
The n8n workflow used `https://synthomind.cloud/webhook/exotel-call-connect` as the webhook URL. At the time, `synthomind.cloud` (Hostinger domain) was not running the Node.js server, so Exotel received an HTML page (200 + non-XML). This caused some different behavior — but "successfully executed" in n8n only means the API call returned a CallSid, not that the phone actually rang.

---

## What Needs to Be Solved

### Problem 1 (Blocking): Landing Flow prevents outbound AI calls
**Options to investigate:**
- [ ] **Disconnect Landing Flow from ExoPhone** — go to Exotel dashboard → ExoPhones → find edit/disconnect button for `020-485-63118`. This is the cleanest fix.
- [ ] **Contact Exotel support** — ask them to unassign the Landing Flow app from the ExoPhone
- [ ] **Create a dedicated outbound ExoPhone** — purchase/use a second Exotel number with no Landing Flow, use it only for API outbound calls
- [ ] **Understand the Connect applet config** — open Landing Flow editor → click Connect applet → check what number it's configured to dial and whether it can use dynamic `To` variable

### Problem 2 (Next): Wire AI into the call once phone rings
Once the phone rings, `/webhook/exotel-call-connect` needs to:
1. Generate Priya's AI greeting via Gemini
2. Call ElevenLabs TTS (3–5s latency — may need pre-generation before call)
3. Return ExoML `<Play>` + `<Gather>` to student
4. Loop conversation via `/webhook/exotel-gather`

**Known latency risk**: ElevenLabs audio generation takes 3–5 seconds. Exotel's webhook response timeout may be shorter. Consider pre-generating the greeting audio before the call is placed.

### Problem 3 (Future): Deploy to stable URL
- `synthomind.cloud` is the user's Hostinger domain
- Deploy Node.js server there to eliminate ngrok dependency
- Hostinger supports Node.js apps — requires deployment configuration

---

## File Structure

```
ai-caller/
├── dashboard-server.js          # Main Express server (port 3001) + all webhooks
├── geminiEngine.js              # Gemini AI engine + MHT-CET conversation logic
├── exotelIntegration.js         # Exotel outbound calling class
├── voiceEngine.js               # ElevenLabs TTS (speak() function)
├── inboundAgents.js             # Inbound call orchestrator (Gemini function calling)
├── knowledgeBase.js             # SQLite knowledge base queries
├── whatsappService.js           # Twilio WhatsApp integration
├── initInboundDatabase.js       # DB setup script (run once)
├── start-enhanced-system.js     # Entry point
├── public/
│   ├── index.html               # Main dashboard UI
│   └── inbound-dashboard.html   # Inbound monitoring dashboard
├── data/
│   └── inbound-knowledge.db     # SQLite DB (gitignored)
└── .env                         # API keys (gitignored — never commit)
```

---

## API Keys & Credentials (stored in .env only)
- Gemini API Key
- ElevenLabs API Key + Voice IDs (EN/HI/MR)
- Exotel SID, API Key, Token, Phone Number
- Twilio Account SID, Auth Token, WhatsApp Number
- ngrok static domain

---

## Webhook Endpoints (current)

| Endpoint | Method | Purpose |
|---|---|---|
| `/webhook/exotel-passthru-notify` | GET/POST | Landing Flow Passthru (currently returns `200 OK` plain text) |
| `/webhook/exotel-call-connect` | GET/POST | Fires when student answers — returns AI greeting ExoML |
| `/webhook/exotel-gather` | GET/POST | Handles student DTMF/speech input |
| `/webhook/exotel-timeout` | GET/POST | Handles gather timeout |
| `/webhook/exotel-call-status` | GET/POST | Call status updates from Exotel |
| `/api/exotel/call` | POST | Initiates outbound call |
| `/api/exotel/bulk-call` | POST | Bulk calling campaign |
| `/api/inbound/start` | POST | Start inbound session |
| `/api/inbound/respond` | POST | Process inbound message |
