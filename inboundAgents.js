// inboundAgents.js — Gemini function-calling inbound call orchestrator

import { GoogleGenerativeAI } from '@google/generative-ai';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ override: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, 'ai-caller', 'data', 'inbound-knowledge.db');

// ── Knowledge Base helpers ────────────────────────────────────────────────────

function getDB() {
  return new Database(DB_FILE);
}

function searchKnowledge(query) {
  const db = getDB();
  const q = `%${query}%`;
  const rows = db.prepare(
    `SELECT category, question, answer FROM knowledge_base
     WHERE question LIKE ? OR answer LIKE ? OR keywords LIKE ?
     ORDER BY priority DESC LIMIT 3`
  ).all(q, q, q);
  db.close();
  return rows;
}

function getCounselingPackages() {
  const db = getDB();
  const rows = db.prepare('SELECT * FROM counseling_packages WHERE is_active = 1').all();
  db.close();
  return rows;
}

function getUpcomingEvents() {
  const db = getDB();
  const rows = db.prepare('SELECT * FROM social_events WHERE is_active = 1').all();
  db.close();
  return rows;
}

function logWhatsApp(callSid, recipient, content, status = 'sent') {
  const db = getDB();
  db.prepare(
    'INSERT INTO whatsapp_messages (call_sid, recipient_number, message_content, status, provider, created_at) VALUES (?,?,?,?,?,datetime("now"))'
  ).run(callSid, recipient, content, status, 'twilio_sandbox');
  db.close();
}

function saveInboundCall(data) {
  const db = getDB();
  db.prepare(`INSERT OR REPLACE INTO inbound_calls
    (id, call_sid, caller_number, caller_name, detected_language, detected_topics, conversation_summary,
     escalated, escalation_reason, escalation_type, callback_requested, whatsapp_sent, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`
  ).run(
    data.id, data.callSid, data.callerNumber || null, data.callerName || null,
    data.language || 'en', JSON.stringify(data.topics || []), data.summary || null,
    data.escalated ? 1 : 0, data.escalationReason || null, data.escalationType || null,
    data.callbackRequested ? 1 : 0, data.whatsappSent ? 1 : 0,
    data.status || 'active'
  );
  db.close();
}

function saveTurn(callSid, turnNum, role, message, intent, toolsCalled) {
  const db = getDB();
  db.prepare(
    `INSERT INTO conversation_turns (call_sid, turn_number, role, message, intent, tools_called, created_at)
     VALUES (?,?,?,?,?,?,datetime('now'))`
  ).run(callSid, turnNum, role, message, intent || null, JSON.stringify(toolsCalled || []));
  db.close();
}

// ── Gemini Tool Definitions ───────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'search_knowledge',
    description: 'Search the Campus Dekho knowledge base for answers to student questions about MHT-CET, admissions, documents, etc.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query'],
    },
  },
  {
    name: 'get_counseling_packages',
    description: 'Retrieve all available Campus Dekho counseling packages with prices and features',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_upcoming_events',
    description: 'Get upcoming social media events, workshops, and seminars from Campus Dekho',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'send_package_whatsapp',
    description: 'Send counseling package details to the caller via WhatsApp',
    parameters: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Caller phone number' },
        package_name: { type: 'string', description: 'Name of the package to send details for' },
      },
      required: ['phone', 'package_name'],
    },
  },
  {
    name: 'send_event_whatsapp',
    description: 'Send event/workshop invitation to the caller via WhatsApp',
    parameters: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Caller phone number' },
        event_title: { type: 'string', description: 'Title of the event' },
      },
      required: ['phone', 'event_title'],
    },
  },
  {
    name: 'send_document_checklist',
    description: 'Send document submission checklist to the caller via WhatsApp',
    parameters: {
      type: 'object',
      properties: { phone: { type: 'string', description: 'Caller phone number' } },
      required: ['phone'],
    },
  },
  {
    name: 'escalate_to_human',
    description: 'Escalate the call to a human agent when the AI cannot answer or the caller requests it',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Reason for escalation' },
        caller_concern: { type: 'string', description: 'Summary of what caller needs' },
      },
      required: ['reason'],
    },
  },
  {
    name: 'schedule_callback',
    description: 'Schedule a callback for the caller at their preferred time',
    parameters: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Caller phone number' },
        preferred_time: { type: 'string', description: 'When they want to be called back' },
      },
      required: ['phone', 'preferred_time'],
    },
  },
  {
    name: 'send_general_info',
    description: 'Send general Campus Dekho information and contact details via WhatsApp',
    parameters: {
      type: 'object',
      properties: { phone: { type: 'string', description: 'Caller phone number' } },
      required: ['phone'],
    },
  },
];

// ── Tool Executor ─────────────────────────────────────────────────────────────

async function executeTool(name, args, callSid, callerPhone) {
  switch (name) {
    case 'search_knowledge': {
      const results = searchKnowledge(args.query);
      if (!results.length) return { found: false, message: 'No specific information found.' };
      return { found: true, results: results.map(r => ({ question: r.question, answer: r.answer })) };
    }
    case 'get_counseling_packages': {
      const pkgs = getCounselingPackages();
      return { packages: pkgs.map(p => ({ name: p.name, price: p.price, description: p.description })) };
    }
    case 'get_upcoming_events': {
      const evts = getUpcomingEvents();
      return { events: evts.map(e => ({ title: e.title, platform: e.platform, date: e.event_date, description: e.description })) };
    }
    case 'send_package_whatsapp': {
      const phone = args.phone || callerPhone;
      const pkgs = getCounselingPackages();
      const pkg = pkgs.find(p => p.name.toLowerCase().includes(args.package_name.toLowerCase())) || pkgs[0];
      const msg = pkg ? `📦 *${pkg.name}* — ₹${pkg.price}\n${pkg.description}` : 'Package info not found';
      logWhatsApp(callSid, phone, msg);
      return { sent: true, phone, package: pkg?.name };
    }
    case 'send_event_whatsapp': {
      const phone = args.phone || callerPhone;
      const evts = getUpcomingEvents();
      const evt = evts.find(e => e.title.toLowerCase().includes(args.event_title.toLowerCase())) || evts[0];
      const msg = evt ? `🎉 *${evt.title}*\n${evt.description}\n📅 ${evt.event_date || 'Coming soon'}` : 'Event info not found';
      logWhatsApp(callSid, phone, msg);
      return { sent: true, phone, event: evt?.title };
    }
    case 'send_document_checklist': {
      const phone = args.phone || callerPhone;
      const msg = `📋 *Document Checklist for MHT-CET Admissions*\n1. MHT-CET Score Card\n2. SSC (10th) Marksheet\n3. HSC (12th) Marksheet\n4. Domicile Certificate\n5. Caste Certificate (if applicable)\n6. Income Certificate\n7. Aadhaar Card\n8. Passport Photos\n\nFor CAP round: All originals + 2 sets of self-attested copies.`;
      logWhatsApp(callSid, phone, msg);
      return { sent: true, phone };
    }
    case 'escalate_to_human':
      return { escalated: true, reason: args.reason, message: 'Connecting you to a human agent. Please hold.' };
    case 'schedule_callback':
      return { scheduled: true, phone: args.phone || callerPhone, time: args.preferred_time, message: 'Callback scheduled successfully.' };
    case 'send_general_info': {
      const phone = args.phone || callerPhone;
      const msg = `🎓 *Campus Dekho*\nIndia's leading education guidance platform.\n\n📞 Helpline: +91-XXXXXXXXXX\n🌐 campusdekho.ai\n📧 support@campusdekho.ai\n\nServices: MHT-CET Guidance, College Admissions, Campus Tours, Counseling.`;
      logWhatsApp(callSid, phone, msg);
      return { sent: true, phone };
    }
    default:
      return { error: 'Unknown tool' };
  }
}

// ── System Prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(language = 'en') {
  const langNote = {
    hi: 'CRITICAL: Respond ENTIRELY in Hindi (हिंदी). Zero English.',
    mr: 'CRITICAL: Respond ENTIRELY in Marathi (मराठी). Zero English.',
    en: '',
  }[language] || '';

  return `You are Priya, Campus Dekho's friendly AI voice assistant handling INBOUND calls.
Campus Dekho (campusdekho.ai) is India's leading education guidance platform.

YOUR ROLE: Answer student/parent inquiries about MHT-CET, admissions, counseling packages, campus tours, and events.

AVAILABLE TOOLS (use them whenever relevant):
- search_knowledge: Look up MHT-CET facts, eligibility, dates, documents
- get_counseling_packages: Show our guidance packages (₹999, ₹2999, ₹5999)
- get_upcoming_events: Show workshops, seminars, live sessions
- send_*_whatsapp: Send info directly to caller's WhatsApp (always ask for phone if not known)
- escalate_to_human: Transfer if unable to help after 2 attempts or caller insists
- schedule_callback: Book a callback at their preferred time

STYLE:
- Warm, helpful, concise (2-4 sentences per response — this is a phone call)
- Use caller's name if known
- Auto-detect language and respond in the same language
- Never be pushy; always be helpful first
${langNote}

After EVERY response append exactly:
INTENT: {"intent": "ongoing|resolved|escalate|follow_up|questions|callback", "language": "en|hi|mr", "continue": true|false, "tools_called": []}`;
}

// ── Session Manager ───────────────────────────────────────────────────────────

const activeSessions = new Map();

function generateId() {
  return 'inb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

export async function startInboundCall(callerPhone = null, language = 'en') {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    tools: [{ functionDeclarations: TOOLS }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 400 },
  });

  const callSid = generateId();
  const systemPrompt = buildSystemPrompt(language);

  const chat = model.startChat({ history: [] });
  const result = await chat.sendMessage(
    `${systemPrompt}\n\n---\nAn inbound call just connected${callerPhone ? ` from ${callerPhone}` : ''}. Generate a warm greeting.`
  );

  const { text, intent, toolsCalled } = await processResponse(result, chat, callSid, callerPhone);

  const session = { callSid, chat, callerPhone, language, turnCount: 1, toolsCalled: [], topics: [], escalated: false, callbackRequested: false, whatsappSent: false };
  activeSessions.set(callSid, session);

  saveInboundCall({ id: callSid, callSid, callerNumber: callerPhone, language, status: 'active' });
  saveTurn(callSid, 1, 'agent', text, intent, toolsCalled);

  return { callSid, text, intent, language };
}

export async function continueInboundCall(callSid, userMessage) {
  const session = activeSessions.get(callSid);
  if (!session) throw new Error('Session not found: ' + callSid);

  session.turnCount++;
  saveTurn(callSid, session.turnCount, 'user', userMessage, null, []);

  const result = await session.chat.sendMessage(userMessage);
  const { text, intent, toolsCalled } = await processResponse(result, session.chat, callSid, session.callerPhone);

  session.turnCount++;
  session.toolsCalled.push(...toolsCalled);
  saveTurn(callSid, session.turnCount, 'agent', text, intent, toolsCalled);

  if (intent === 'callback') session.callbackRequested = true;
  if (toolsCalled.some(t => t.includes('whatsapp'))) session.whatsappSent = true;
  if (intent === 'escalate') session.escalated = true;

  return { text, intent, language: session.language, toolsCalled, turnCount: session.turnCount };
}

export function endInboundCall(callSid) {
  const session = activeSessions.get(callSid);
  if (!session) return null;

  const db = getDB();
  db.prepare(
    'UPDATE inbound_calls SET status=?, completed_at=datetime("now"), escalated=?, callback_requested=?, whatsapp_sent=? WHERE id=?'
  ).run('completed', session.escalated ? 1 : 0, session.callbackRequested ? 1 : 0, session.whatsappSent ? 1 : 0, callSid);
  db.close();

  activeSessions.delete(callSid);
  return { callSid, turns: session.turnCount };
}

export function getInboundStats() {
  const db = getDB();
  const total = db.prepare('SELECT COUNT(*) as n FROM inbound_calls').get().n;
  const today = db.prepare("SELECT COUNT(*) as n FROM inbound_calls WHERE date(created_at) = date('now')").get().n;
  const escalated = db.prepare("SELECT COUNT(*) as n FROM inbound_calls WHERE escalated = 1").get().n;
  const waSent = db.prepare("SELECT COUNT(*) as n FROM inbound_calls WHERE whatsapp_sent = 1").get().n;
  const recent = db.prepare('SELECT * FROM inbound_calls ORDER BY created_at DESC LIMIT 20').all();
  const kbCount = db.prepare('SELECT COUNT(*) as n FROM knowledge_base').get().n;
  const pkgCount = db.prepare('SELECT COUNT(*) as n FROM counseling_packages WHERE is_active=1').get().n;
  const evtCount = db.prepare('SELECT COUNT(*) as n FROM social_events WHERE is_active=1').get().n;
  db.close();
  return { total, today, escalated, whatsappSent: waSent, activeSessions: activeSessions.size, recent, kbCount, pkgCount, evtCount };
}

export function searchInboundKB(query) {
  return searchKnowledge(query);
}

export function listPackages() {
  return getCounselingPackages();
}

export function listEvents() {
  return getUpcomingEvents();
}

// ── Internal: handle function calling loop ────────────────────────────────────

async function processResponse(result, chat, callSid, callerPhone) {
  let response = result.response;
  const toolsCalled = [];

  // Handle function call loop (Gemini may request multiple tools)
  let iterations = 0;
  while (iterations < 5) {
    const parts = response.candidates?.[0]?.content?.parts || [];
    const fnCalls = parts.filter(p => p.functionCall);
    if (!fnCalls.length) break;

    const fnResults = [];
    for (const part of fnCalls) {
      const { name, args } = part.functionCall;
      toolsCalled.push(name);
      const output = await executeTool(name, args, callSid, callerPhone);
      fnResults.push({ functionResponse: { name, response: output } });
    }

    const followUp = await chat.sendMessage(fnResults);
    response = followUp.response;
    iterations++;
  }

  const raw = response.text();
  const intentMatch = raw.match(/INTENT:\s*(\{.*?\})/s);
  let intentData = { intent: 'ongoing', language: 'en', continue: true };
  if (intentMatch) {
    try { intentData = { ...intentData, ...JSON.parse(intentMatch[1]) }; } catch (_) {}
  }
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/\nINTENT:.*$/s, '').trim();

  return { text, intent: intentData.intent, language: intentData.language, toolsCalled };
}
