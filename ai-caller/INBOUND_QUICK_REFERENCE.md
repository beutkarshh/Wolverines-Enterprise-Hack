# Campus Dekho Inbound Call System - Quick Reference

## 🚀 Quick Start (30 seconds)

```bash
# 1. Initialize database
node initInboundDatabase.js

# 2. Start server
npm start

# 3. Open dashboard
http://localhost:3001/inbound-dashboard.html
```

---

## 📊 System Components

| Component | File | Purpose |
|-----------|------|---------|
| **Orchestrator** | `inboundAgents.js` | Main AI agent (Gemini 2.0) |
| **Knowledge Base** | `knowledgeBase.js` | FAQ queries |
| **WhatsApp** | `whatsappService.js` | Twilio messaging |
| **Database** | `data/inbound-knowledge.db` | SQLite storage |
| **API** | `dashboard-server.js` | Express endpoints |
| **UI** | `public/inbound-dashboard.html` | Admin dashboard |

---

## 🔧 Key API Endpoints

```javascript
POST /api/inbound/start        // Start call
POST /api/inbound/respond      // Send message
POST /api/inbound/end          // End call
GET  /api/inbound/knowledge/search?q=query
GET  /api/inbound/packages
GET  /api/inbound/events
```

---

## 🤖 AI Agent Capabilities

**Topics:**
- 📚 MHT-CET Doubts (exam dates, eligibility, syllabus)
- 📦 Counseling Packages (pricing, features)
- 📄 Documents (checklist, submission process)
- 🎉 Events (Instagram/Facebook events)
- 💬 General Info (about Campus Dekho)

**Actions:**
- Send WhatsApp messages (packages, events, checklists)
- Search knowledge base (10+ FAQs)
- Escalate to human agents (if available)
- Schedule callbacks (if agents busy)

---

## 📱 WhatsApp Messages

**Automatically sends:**
- Counseling package details (Basic/Premium/Elite)
- Event invitations (Instagram/Facebook)
- Document checklists (MHT-CET requirements)
- General Campus Dekho info

**Twilio Setup:**
- Trial sandbox: `whatsapp:+14155238886`
- Users must join sandbox first
- Prod: Apply for WhatsApp Business API

---

## 👥 Human Escalation

**Triggers:**
1. User says: "I want to talk to a human"
2. Agent can't answer after 2 attempts
3. Sensitive topics (complaints, refunds)

**Behavior:**
- ✅ **Agent available** → Live transfer
- ❌ **Agent busy** → Schedule callback (within 2 hours)

**Agent Schedule:**
- Rahul Sharma: Mon-Sat, 9:00-18:00
- Sneha Patil: Mon-Fri, 10:00-19:00

---

## 🗂️ Database Tables

```sql
knowledge_base          -- FAQs (10 entries)
counseling_packages     -- Packages (3 entries)
social_events           -- Events (3 entries)
inbound_calls           -- Call logs
conversation_turns      -- Message history
agent_availability      -- Human agents (2 active)
whatsapp_messages       -- WhatsApp logs
```

**Add FAQ:**
```javascript
import * as kb from './knowledgeBase.js';
kb.addKnowledge({
  category: 'cet',
  question: 'How to register for MHT-CET?',
  answer: 'Visit cetcell.mahacet.org...',
  keywords: 'registration,apply',
  priority: 9
});
```

---

## 🧪 Testing

**Web Dashboard:**
1. Click "▶️ Start Call"
2. Type: "I want admission counseling"
3. See AI response + tools called

**cURL Test:**
```bash
curl -X POST http://localhost:3001/api/inbound/start \
  -H "Content-Type: application/json" \
  -d '{"callSid":"TEST123","callerNumber":"+919876543210"}'
```

---

## 🌐 Multi-Language

- **English (en)** - Default
- **हिंदी (hi)** - Hindi voice
- **मराठी (mr)** - Marathi voice

ElevenLabs voices auto-selected based on detected language.

---

## 📈 Stats Dashboard

Visit: `http://localhost:3001/inbound-dashboard.html`

**Displays:**
- Total FAQs: 10
- Packages: 3
- Events: 3
- Available Agents: 2

---

## 🔐 Environment Variables

```bash
GEMINI_API_KEY=AIzaSy...              # Gemini AI
ELEVENLABS_API_KEY=sk_e8bceb...      # Text-to-speech
TWILIO_ACCOUNT_SID=ACf645...          # WhatsApp
TWILIO_AUTH_TOKEN=b466a72e...
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
```

---

## 🐛 Troubleshooting

**Issue:** Database not found
```bash
node initInboundDatabase.js
```

**Issue:** WhatsApp not sending
- Check Twilio credentials in `.env`
- Ensure user joined Twilio sandbox
- Check logs: `whatsapp_messages` table

**Issue:** Agent not responding
- Check Gemini API key
- Check API quota/rate limits
- View logs in terminal

---

## 📚 Full Documentation

See `INBOUND_CALL_SETUP_GUIDE.md` for:
- Architecture details
- API reference
- Human escalation logic
- Future roadmap

---

## 🎯 Conversation Examples

**Example 1:**
```
User: "What packages do you offer?"
Agent: "We have 3 packages: Basic (₹999), Premium (₹2999), Elite (₹5999)..."
User: "Send Premium on WhatsApp"
Agent: "✅ Sent to your WhatsApp!"
```

**Example 2:**
```
User: "When is MHT-CET 2026?"
Agent: "Expected in May 2026. Registration opens Feb 2026."
User: "What documents do I need?"
Agent: "10th/12th marksheet, domicile, Aadhaar... Should I send checklist on WhatsApp?"
```

**Example 3:**
```
User: "I want to talk to someone"
Agent: "Transferring you to Rahul Sharma..." [Live transfer]
```

---

**Quick Help:**
- Dashboard: http://localhost:3001/inbound-dashboard.html
- API Base: http://localhost:3001/api/inbound/
- Database: `data/inbound-knowledge.db`

---

**Version:** 1.0 | **Updated:** March 2026
