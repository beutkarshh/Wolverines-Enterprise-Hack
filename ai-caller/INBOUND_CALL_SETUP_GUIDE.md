# Campus Dekho - Inbound Call System Documentation

## 🎯 Overview

The **Campus Dekho Inbound Call System** is an agentic AI-powered solution that handles incoming calls from prospective students and parents. It uses **Gemini 2.0 Flash with function calling** to provide intelligent, context-aware responses across multiple topics.

### Key Features

✅ **Multi-Agent Architecture** - Specialized agents for different topics
✅ **Multi-Language Support** - English, Hindi, Marathi
✅ **WhatsApp Integration** - Send documents/links via WhatsApp (Twilio)
✅ **Human Escalation** - Smart routing to human agents
✅ **Knowledge Base** - SQLite-powered FAQ system
✅ **Real-Time Monitoring** - Web dashboard for testing and monitoring

---

## 📋 Architecture

```
┌─────────────────────────────────────────────────────┐
│        EXOTEL INBOUND CALL WEBHOOK                  │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│     🎯 MASTER ORCHESTRATOR AGENT (Gemini 2.0)      │
│  • Greets: "campusdekho.ai - the admission corridor"│
│  • Detects user intent/topic from speech            │
│  • Routes to appropriate knowledge/tool              │
│  • Handles human escalation                         │
└────────────────────┬────────────────────────────────┘
                     │
        ┌────────────┴─────────┬──────────┬──────────┐
        ▼                      ▼          ▼          ▼
┌──────────────┐  ┌──────────────┐  ┌────────────┐  ┌────────────┐
│ 📦 Counseling│  │ 📚 CET Doubts│  │ 📄 Documents│ │ 🎉 Events  │
│    Tools     │  │    Tools     │  │   Tools    │  │   Tools    │
└──────────────┘  └──────────────┘  └────────────┘  └────────────┘
```

---

## 🗂️ File Structure

```
ai-caller/
├── data/
│   ├── inbound-knowledge.db        # SQLite database (auto-created)
│   └── inbound-schema.sql          # Database schema
├── public/
│   └── inbound-dashboard.html      # Admin monitoring UI
├── inboundAgents.js                # Orchestrator + Agent logic
├── knowledgeBase.js                # Database query functions
├── whatsappService.js              # Twilio WhatsApp integration
├── initInboundDatabase.js          # Database initialization script
└── dashboard-server.js             # Express API + endpoints
```

---

## 🚀 Quick Start

### 1. Initialize Database

```bash
cd ai-caller-system/ai-caller
node initInboundDatabase.js
```

**Output:**
```
✅ Database initialized successfully!
📁 Location: D:\Projects\AI Voice agents\...\data\inbound-knowledge.db
📊 Database Tables: 8 tables
📈 Sample Data: 10 FAQs, 3 Packages, 3 Events, 2 Agents
```

### 2. Start Server

```bash
npm start
```

**Server runs on:** `http://localhost:3001`

### 3. Open Admin Dashboard

Visit: **http://localhost:3001/inbound-dashboard.html**

---

## 📊 Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `knowledge_base` | FAQs for MHT-CET, admissions, documents |
| `counseling_packages` | Admission counseling service packages |
| `social_events` | Instagram/Facebook events |
| `inbound_calls` | Call logs with metadata |
| `conversation_turns` | Message-by-message conversation history |
| `agent_availability` | Human agent schedules |
| `whatsapp_messages` | WhatsApp message delivery logs |

### Sample Query

```javascript
// Search knowledge base
import * as kb from './knowledgeBase.js';

const results = kb.searchKnowledge('MHT-CET exam date', 'cet');
// Returns: [{ question: 'When is MHT-CET 2026?', answer: '...' }]
```

---

## 🔧 API Endpoints

### Inbound Call Endpoints

#### `POST /api/inbound/start`

Start a new inbound call session.

**Request:**
```json
{
  "callSid": "CA12345...",
  "callerNumber": "+919876543210"
}
```

**Response:**
```json
{
  "success": true,
  "callSid": "CA12345...",
  "text": "Namaste! Welcome to Campus Dekho...",
  "audioPath": "/audio/greeting.mp3",
  "language": "en"
}
```

---

#### `POST /api/inbound/respond`

Send user message and get AI response.

**Request:**
```json
{
  "callSid": "CA12345...",
  "message": "I want admission counseling",
  "language": "en"
}
```

**Response:**
```json
{
  "success": true,
  "text": "We offer 3 packages: Basic (₹999), Premium (₹2999), Elite (₹5999)...",
  "audioPath": "/audio/response.mp3",
  "toolCalls": [
    {
      "name": "get_counseling_packages",
      "result": [...]
    }
  ],
  "needsEscalation": false
}
```

---

#### `POST /api/inbound/end`

End call session and get summary.

**Request:**
```json
{
  "callSid": "CA12345..."
}
```

**Response:**
```json
{
  "success": true,
  "status": "ended",
  "duration": 180
}
```

---

### Knowledge Base Endpoints

#### `GET /api/inbound/knowledge/stats`

Get system statistics.

**Response:**
```json
{
  "success": true,
  "stats": {
    "totalFAQs": 10,
    "totalPackages": 3,
    "totalEvents": 3,
    "totalAgents": 2,
    "faqsByCategory": {
      "cet": 4,
      "documents": 2,
      "admissions": 2,
      "general": 2
    }
  }
}
```

---

#### `GET /api/inbound/knowledge/search?q=<query>&category=<category>`

Search knowledge base.

**Example:**
```
GET /api/inbound/knowledge/search?q=MHT-CET%20eligibility&category=cet
```

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "id": 3,
      "category": "cet",
      "question": "What is the eligibility for MHT-CET?",
      "answer": "Candidates must have passed 12th with PCM/PCB...",
      "priority": 9
    }
  ]
}
```

---

#### `GET /api/inbound/packages`

Get all counseling packages.

---

#### `GET /api/inbound/events?platform=<instagram|facebook>`

Get upcoming events.

---

## 🤖 Gemini Tools (Function Calling)

The agent has access to these tools:

| Tool Name | Purpose | Example Trigger |
|-----------|---------|-----------------|
| `search_knowledge` | Search FAQs | "When is MHT-CET?" |
| `get_counseling_packages` | List packages | "What packages do you offer?" |
| `send_package_whatsapp` | Send package details via WhatsApp | "Send me details on WhatsApp" |
| `get_upcoming_events` | Fetch events | "Any events happening?" |
| `send_event_whatsapp` | Send event via WhatsApp | "Send event details" |
| `send_document_checklist` | Send docs checklist | "What documents do I need?" |
| `send_general_info` | Send Campus Dekho info | "Tell me about your services" |
| `escalate_to_human` | Transfer to human | "I want to talk to someone" |
| `schedule_callback` | Schedule callback | "Can someone call me back?" |

---

## 📱 WhatsApp Integration (Twilio)

### Setup

1. **Twilio Sandbox (Trial Mode)**
   - Already configured in `.env`:
     ```
     TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
     ```
   - Users must send "join <sandbox-code>" to Twilio number first

2. **Sending Messages**
   ```javascript
   import * as whatsapp from './whatsappService.js';

   // Send package details
   await whatsapp.sendCounselingPackage('+919876543210', packageId, callSid);

   // Send document checklist
   await whatsapp.sendDocumentChecklist('+919876543210', callSid);

   // Send event
   await whatsapp.sendEventDetails('+919876543210', eventId, callSid);
   ```

### WhatsApp Templates

Templates are stored in `counseling_packages.whatsapp_message_template`:

```
Hi! Here are the details of our Premium Package (₹2999):
🌟 Personalized counseling
🌟 Mock CAP registration
🌟 Document verification
🌟 College tours

Learn more: campusdekho.ai/packages
```

---

## 👥 Human Escalation Logic

### Automatic Escalation Triggers

1. User explicitly requests: *"I want to talk to a human"*
2. Agent can't answer after 2 failed attempts
3. Sensitive topics: complaints, refunds

### Escalation Flow

```javascript
// Check agent availability
const agent = kb.getAvailableAgent();

if (agent) {
  // Live transfer (Exotel Conference API)
  return {
    type: 'live_transfer',
    agent: agent,
    message: `Transferring you to ${agent.agent_name}...`
  };
} else {
  // Schedule callback
  return {
    type: 'callback_scheduled',
    message: 'All agents are busy. We will call you back within 2 hours.'
  };
}
```

### Agent Availability Rules

Configured in `agent_availability` table:

```sql
INSERT INTO agent_availability (
  agent_name,
  agent_phone,
  available_from,
  available_to,
  days_of_week
) VALUES (
  'Rahul Sharma',
  '+919876543210',
  '09:00',
  '18:00',
  '["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]'
);
```

---

## 🧪 Testing

### 1. Web Dashboard Test

1. Open `http://localhost:3001/inbound-dashboard.html`
2. Click **"▶️ Start Call"**
3. Type user messages in the input
4. See AI responses + tool calls in real-time

### 2. API Test (cURL)

```bash
# Start call
curl -X POST http://localhost:3001/api/inbound/start \
  -H "Content-Type: application/json" \
  -d '{"callSid":"TEST123","callerNumber":"+919876543210"}'

# Send message
curl -X POST http://localhost:3001/api/inbound/respond \
  -H "Content-Type: application/json" \
  -d '{"callSid":"TEST123","message":"I want admission counseling"}'

# End call
curl -X POST http://localhost:3001/api/inbound/end \
  -H "Content-Type: application/json" \
  -d '{"callSid":"TEST123"}'
```

### 3. Conversation Examples

**Example 1: Counseling Package Inquiry**
```
User: "I want admission counseling"
Agent: "We offer 3 packages: Basic (₹999), Premium (₹2999), Elite (₹5999)..."
User: "Send me Premium package details on WhatsApp"
Agent: "I've sent the Premium package details to your WhatsApp! Check it now."
```

**Example 2: MHT-CET Doubt**
```
User: "When is MHT-CET 2026?"
Agent: "MHT-CET 2026 exam dates are expected to be announced in February 2026. The exam is typically held in May."
User: "What is the eligibility?"
Agent: "Candidates must have passed 12th with Physics, Chemistry, and Mathematics/Biology from a recognized board..."
```

**Example 3: Human Escalation**
```
User: "I want to talk to a human"
Agent: "Transferring you to Rahul Sharma..." [Live transfer]

OR

Agent: "All agents are busy. We will call you back within 2 hours." [Callback scheduled]
```

---

## 🌐 Multi-Language Support

### Supported Languages

- **English (en)** - Default
- **हिंदी (hi)** - Hindi
- **मराठी (mr)** - Marathi

### Voice Selection

Configured in `.env`:
```
ELEVENLABS_VOICE_EN=hyfnu3H2biW7xNFFVMIa
ELEVENLABS_VOICE_HI=CpLFIATEbkaZdJr01erZ
ELEVENLABS_VOICE_MR=RBxPIvrKOP4ugCK2jVHD
```

### Language Detection

Agent auto-detects language from user input via Gemini's multilingual capabilities.

---

## 📝 Adding Knowledge Base Content

### Add FAQs

```javascript
import * as kb from './knowledgeBase.js';

kb.addKnowledge({
  category: 'cet',
  question: 'How to register for MHT-CET?',
  answer: 'Visit the official website cetcell.mahacet.org and click on "New Registration"...',
  keywords: 'registration,apply,online,website',
  priority: 9
});
```

### Import from PDF

For importing MHT-CET brochure content:

1. Extract text from PDF manually or using OCR
2. Format as Q&A pairs
3. Insert via SQL or `addKnowledge()` function
4. Categorize appropriately

---

## 🔒 Security Best Practices

1. **API Authentication** (TODO): Add JWT/API keys for production
2. **Rate Limiting** (TODO): Prevent abuse with express-rate-limit
3. **Input Sanitization**: Already handled by Gemini safety filters
4. **Database**: Use prepared statements (✅ implemented)
5. **WhatsApp**: Store Twilio credentials in `.env` (✅ done)

---

## 🚧 Future Enhancements

### Phase 2 Features

- [ ] **Voice STT Integration** - Real-time speech-to-text (Whisper API)
- [ ] **Sentiment Analysis** - Detect frustrated users for priority escalation
- [ ] **Analytics Dashboard** - Call volume, resolution rates, popular topics
- [ ] **CRM Integration** - Sync with Zoho/Salesforce
- [ ] **Multi-Agent Handoff** - Route to specialized human agents (Tech, Billing, etc.)
- [ ] **Proactive Callbacks** - Auto-dial scheduled callbacks

### Phase 3 Features

- [ ] **RAG with Vector DB** - ChromaDB/Pinecone for semantic search
- [ ] **Fine-Tuned Models** - Custom Gemini fine-tuning for Campus Dekho
- [ ] **Multi-Channel** - Telegram, Instagram DMs, Facebook Messenger
- [ ] **SMS Fallback** - Send summaries via SMS if WhatsApp fails
- [ ] **Live Dashboard Streaming** - WebSocket real-time call monitoring

---

## 📞 Contact

**Campus Dekho Team**
- Website: campusdekho.ai
- GitHub: https://github.com/beutkarshh/CD-Calling-Agents
- Support: info@campusdekho.ai

---

## 📄 License

This project is proprietary to Campus Dekho. Unauthorized use is prohibited.

---

**Documentation Version:** 1.0 (March 2026)
**Last Updated:** 2026-03-23
