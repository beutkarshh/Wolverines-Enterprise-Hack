// agentEngine.js — Generic AI voice agent engine
// Replaces hardcoded MHT-CET functions in geminiEngine.js with business-driven prompts.
// Works for any business: education, clinic, real estate, retail, etc.

import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config({ override: true });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL = 'gemini-2.5-flash';

// ─── Call-type intent sets ─────────────────────────────────────────────────────
// Each call type maps to different terminal intents + conversation goals.

const CALL_TYPE_CONFIG = {
  outbound_lead: {
    goal: 'Introduce the business, generate interest, qualify the lead, and close with a commitment (RSVP, appointment, or callback).',
    intents: ['interested', 'not_interested', 'callback_requested', 'rsvp_yes', 'rsvp_no', 'question', 'goodbye'],
    terminal: ['not_interested', 'rsvp_yes', 'rsvp_no', 'goodbye'],
    flow: `
CONVERSATION FLOW:
1. WARM INTRO (10-15 seconds): Greet respectfully, state who you are and who you represent.
2. HOOK: In 1-2 sentences, say WHY you're calling — the benefit for them.
3. QUALIFY: Ask 1 short question to check relevance (e.g. "Are you looking for X?").
4. PITCH: If relevant, explain the offer in 2-3 sentences. Keep it conversational.
5. HANDLE OBJECTIONS: Address doubts briefly and factually.
6. CLOSE: Ask for a commitment — "Can I book you in?" / "Would you like more details on WhatsApp?"
7. WRAP UP: Confirm next step, thank them, say goodbye.`
  },

  appointment_booking: {
    goal: 'Schedule a specific appointment, consultation, or visit. Collect: preferred date/time, contact details, any relevant pre-visit info.',
    intents: ['booked', 'rescheduling', 'callback_requested', 'not_interested', 'question', 'goodbye'],
    terminal: ['booked', 'not_interested', 'goodbye'],
    flow: `
CONVERSATION FLOW:
1. INTRO: Greet, introduce yourself and the business.
2. PURPOSE: State you're calling to help them schedule an appointment.
3. AVAILABILITY: Ask for their preferred date and time.
4. CONFIRM DETAILS: Repeat back the booking details to confirm.
5. COLLECT INFO: Get any pre-visit info needed (name, concern, special requirements).
6. CONFIRM: Tell them what to expect and how to reach you if they need to reschedule.
7. CLOSE: Thank them and wish them well.`
  },

  survey: {
    goal: 'Collect structured responses to a set of predefined questions. Be polite, brief, and move through questions at the caller\'s pace.',
    intents: ['completed', 'partial', 'refused', 'callback_requested', 'goodbye'],
    terminal: ['completed', 'refused', 'goodbye'],
    flow: `
CONVERSATION FLOW:
1. INTRO: Greet, introduce yourself, explain this is a brief survey (mention how many questions / how long).
2. CONSENT: Ask if they have 2-3 minutes.
3. QUESTIONS: Ask each survey question in the knowledge base one at a time. Wait for answer before next.
4. ACKNOWLEDGE: Briefly acknowledge each answer ("Thank you", "Got it", "I see").
5. CLOSE: Thank them for their time, tell them how the feedback will be used.`
  },

  inbound_support: {
    goal: 'Handle incoming enquiries. Answer questions from the knowledge base, assist with products/services, and escalate to a human when needed.',
    intents: ['resolved', 'escalated', 'callback_requested', 'question', 'goodbye'],
    terminal: ['resolved', 'escalated', 'goodbye'],
    flow: `
CONVERSATION FLOW:
1. GREETING: Answer warmly, state business name and agent name.
2. LISTEN: Understand what the caller needs.
3. ASSIST: Answer from your knowledge base. Be accurate — don't guess.
4. CLARIFY: If unsure, say "Let me check that for you" and look it up.
5. ESCALATE: If you can't help or the caller asks for a human, offer a callback or transfer.
6. CLOSE: Confirm the resolution, ask if there's anything else, then say goodbye.`
  }
};

// ─── System prompt builder ─────────────────────────────────────────────────────

export function buildSystemPrompt(business, callType = 'outbound_lead', knowledgeEntries = []) {
  const config = CALL_TYPE_CONFIG[callType] || CALL_TYPE_CONFIG.outbound_lead;
  const languages = business.languages || ['en'];
  const langNames = { en: 'English', hi: 'Hindi', mr: 'Marathi' };
  const supportedLangs = languages.map(l => langNames[l] || l).join(', ');

  // Build knowledge section from DB entries
  const kbByCategory = {};
  for (const e of knowledgeEntries) {
    if (!kbByCategory[e.category]) kbByCategory[e.category] = [];
    kbByCategory[e.category].push(`• ${e.title}: ${e.content}`);
  }

  const kbSection = Object.entries(kbByCategory)
    .map(([cat, items]) => `\n[${cat.toUpperCase()}]\n${items.join('\n')}`)
    .join('\n');

  const intentList = config.intents.map(i => `  - ${i}`).join('\n');

  return `You are ${business.agent_name}, a friendly and professional AI voice assistant.

YOUR IDENTITY:
- Name: ${business.agent_name}
- Calling on behalf of: ${business.name}
- Industry: ${business.industry || 'General'}
- About the business: ${business.description || ''}

CALL TYPE: ${callType}
YOUR GOAL: ${business.call_goal || config.goal}
${config.flow}

LANGUAGE RULES:
- Supported languages: ${supportedLangs}
- Default language: ${langNames[business.default_language] || 'English'}
- AUTOMATICALLY switch to the language the caller uses
- Natural code-mixing is encouraged — match how the caller speaks
- Once a language preference is detected, stay in that language

${kbSection ? `KNOWLEDGE BASE — use this to answer questions accurately:\n${kbSection}\n` : ''}
${business.custom_prompt ? `\nADDITIONAL INSTRUCTIONS:\n${business.custom_prompt}\n` : ''}
RESPONSE FORMAT:
End EVERY response with a JSON intent block on its own line:
INTENT: {"intent": "<detected_intent>", "language": "<lang_code>", "continue": <true|false>, "data": {}}

Available intents:
${intentList}

"continue": false means the conversation should end after this response.
"data" can include any structured information collected (e.g. {"booked_slot": "...", "name": "..."}).

Examples:
INTENT: {"intent": "interested", "language": "en", "continue": true, "data": {}}
INTENT: {"intent": "rsvp_yes", "language": "hi", "continue": false, "data": {"rsvp": true}}
INTENT: {"intent": "booked", "language": "en", "continue": false, "data": {"slot": "Monday 3pm", "name": "Rahul"}}

IMPORTANT:
- Keep responses concise — this is a phone call, not a chat message. 2-4 sentences max per turn.
- Never read out the INTENT block aloud — it is metadata only.
- Be warm, human, and natural. Avoid sounding scripted.
- If asked something not in the knowledge base, say you'll have someone follow up.`;
}

// ─── Conversation lifecycle ────────────────────────────────────────────────────

export async function startCall(business, callType = 'outbound_lead', language = null, knowledgeEntries = []) {
  const lang = language || business.default_language || 'en';
  const systemPrompt = buildSystemPrompt(business, callType, knowledgeEntries);

  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: systemPrompt
  });

  const chat = model.startChat({ history: [] });

  // Get opening message
  const langInstructions = {
    en: 'Start the call in English.',
    hi: 'Call शुरू करें Hindi में।',
    mr: 'Call सुरू करा Marathi मध्ये.'
  };

  const openingPrompt = langInstructions[lang] || langInstructions.en;
  const result = await chat.sendMessage(openingPrompt);
  const raw = result.response.text();
  const parsed = parseAgentResponse(raw, callType);

  return { chat, text: parsed.text, intent: parsed.intent, language: lang, raw };
}

export async function continueCall(chat, userText, callType = 'outbound_lead') {
  const result = await chat.sendMessage(userText);
  const raw = result.response.text();
  return parseAgentResponse(raw, callType);
}

// Streaming variant — yields text tokens, returns final parsed result
export async function* continueCallStream(chat, userText) {
  const streamResult = await chat.sendMessageStream(userText);
  for await (const chunk of streamResult.stream) {
    yield chunk.text();
  }
}

// ─── Response parser ───────────────────────────────────────────────────────────

export function parseAgentResponse(raw, callType = 'outbound_lead') {
  const config = CALL_TYPE_CONFIG[callType] || CALL_TYPE_CONFIG.outbound_lead;

  let intent = 'question';
  let language = 'en';
  let continueConv = true;
  let data = {};

  // Extract INTENT JSON block
  const intentMatch = raw.match(/INTENT:\s*(\{[^}]+\})/);
  if (intentMatch) {
    try {
      const parsed = JSON.parse(intentMatch[1]);
      intent = parsed.intent || intent;
      language = parsed.language || language;
      continueConv = parsed.continue !== false;
      data = parsed.data || {};
    } catch {}
  }

  // Strip the INTENT block from the spoken text
  const text = raw.replace(/INTENT:\s*\{[^}]+\}/g, '').trim();

  // Override continue for terminal intents
  if (config.terminal.includes(intent)) continueConv = false;

  return { text, intent, language, continue: continueConv, data, raw };
}

// ─── Convenience: build prompt for a business loaded from DB ──────────────────

export async function buildPromptForActiveBusiness(businessManager, callType) {
  const biz = businessManager.getActiveBusiness();
  if (!biz) throw new Error('No active business set');
  const knowledge = businessManager.getKnowledge(biz.id);
  return { business: biz, prompt: buildSystemPrompt(biz, callType, knowledge) };
}

export default {
  buildSystemPrompt,
  startCall,
  continueCall,
  continueCallStream,
  parseAgentResponse,
  buildPromptForActiveBusiness,
  CALL_TYPE_CONFIG
};
