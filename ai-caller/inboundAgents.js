/**
 * Campus Dekho - Inbound Call Agent System
 * Multi-agent orchestration using Gemini 2.0 Flash with function calling
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import * as kb from './knowledgeBase.js';
import * as whatsapp from './whatsappService.js';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, 'data', 'inbound-knowledge.db');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ============================================
// GEMINI FUNCTION DEFINITIONS (Tools)
// ============================================

const INBOUND_TOOLS = [
  {
    name: 'search_knowledge',
    description: 'Search the knowledge base for FAQs about MHT-CET, admissions, documents, or general queries. Use this to answer user questions.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query extracted from user question',
        },
        category: {
          type: 'string',
          enum: ['cet', 'documents', 'admissions', 'general'],
          description: 'Knowledge category filter (optional)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_counseling_packages',
    description: 'Get list of admission counseling packages with pricing and features',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'send_package_whatsapp',
    description: 'Send counseling package details to user via WhatsApp',
    parameters: {
      type: 'object',
      properties: {
        package_id: {
          type: 'number',
          description: 'Package ID (1=Basic, 2=Premium, 3=Elite)',
        },
        phone_number: {
          type: 'string',
          description: 'User phone number (E.164 format)',
        },
      },
      required: ['package_id', 'phone_number'],
    },
  },
  {
    name: 'get_upcoming_events',
    description: 'Get upcoming Campus Dekho events from Instagram/Facebook',
    parameters: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['instagram', 'facebook', 'linkedin'],
          description: 'Social media platform filter (optional)',
        },
      },
    },
  },
  {
    name: 'send_event_whatsapp',
    description: 'Send event details to user via WhatsApp',
    parameters: {
      type: 'object',
      properties: {
        event_id: {
          type: 'number',
          description: 'Event ID from database',
        },
        phone_number: {
          type: 'string',
          description: 'User phone number (E.164 format)',
        },
      },
      required: ['event_id', 'phone_number'],
    },
  },
  {
    name: 'send_document_checklist',
    description: 'Send MHT-CET document checklist to user via WhatsApp',
    parameters: {
      type: 'object',
      properties: {
        phone_number: {
          type: 'string',
          description: 'User phone number (E.164 format)',
        },
      },
      required: ['phone_number'],
    },
  },
  {
    name: 'send_general_info',
    description: 'Send general Campus Dekho information via WhatsApp',
    parameters: {
      type: 'object',
      properties: {
        phone_number: {
          type: 'string',
          description: 'User phone number (E.164 format)',
        },
      },
      required: ['phone_number'],
    },
  },
  {
    name: 'escalate_to_human',
    description: 'Escalate call to human agent (live transfer if available, otherwise schedule callback)',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Reason for escalation',
        },
      },
      required: ['reason'],
    },
  },
  {
    name: 'schedule_callback',
    description: 'Schedule a callback request for user',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Reason for callback',
        },
        preferred_time: {
          type: 'string',
          description: 'User preferred time (optional)',
        },
      },
      required: ['reason'],
    },
  },
];

// ============================================
// FUNCTION IMPLEMENTATIONS
// ============================================

async function executeTool(toolName, args, callSid) {
  console.log(`🔧 Executing tool: ${toolName}`, args);

  switch (toolName) {
    case 'search_knowledge':
      return kb.searchKnowledge(args.query, args.category);

    case 'get_counseling_packages':
      return kb.getCounselingPackages();

    case 'send_package_whatsapp': {
      const result = await whatsapp.sendCounselingPackage(
        args.phone_number,
        args.package_id,
        callSid
      );
      return result;
    }

    case 'get_upcoming_events':
      return kb.getUpcomingEvents(args.platform);

    case 'send_event_whatsapp': {
      const result = await whatsapp.sendEventDetails(
        args.phone_number,
        args.event_id,
        callSid
      );
      return result;
    }

    case 'send_document_checklist': {
      const result = await whatsapp.sendDocumentChecklist(
        args.phone_number,
        callSid
      );
      return result;
    }

    case 'send_general_info': {
      const result = await whatsapp.sendGeneralInfo(
        args.phone_number,
        callSid
      );
      return result;
    }

    case 'escalate_to_human': {
      const agent = kb.getAvailableAgent();
      if (agent) {
        kb.incrementAgentCalls(agent.id);
        return {
          type: 'live_transfer',
          agent: agent,
          message: `Transferring you to ${agent.agent_name}...`,
        };
      } else {
        return {
          type: 'callback_scheduled',
          message: 'All agents are busy. We will call you back within 2 hours.',
        };
      }
    }

    case 'schedule_callback':
      return {
        success: true,
        message: 'Callback scheduled successfully.',
        preferred_time: args.preferred_time,
      };

    default:
      return { error: 'Unknown tool' };
  }
}

// ============================================
// SYSTEM PROMPTS
// ============================================

const ORCHESTRATOR_SYSTEM_PROMPT = `You are PRIYA, a friendly and knowledgeable AI assistant for Campus Dekho - the admission corridor. You're here to help students and parents navigate the complex world of college admissions in Maharashtra.

**Your Personality:**
- Warm, empathetic, and genuinely excited to help students
- Patient and understanding (remember, this is stressful for students!)
- Professional but conversational (like a helpful elder sister/friend)
- Encouraging and positive about their admission journey

**Your Core Role:**
- Guide students through MHT-CET preparation and admission process
- Provide accurate information about counseling packages, documents, events
- Offer personalized recommendations based on student's situation
- Send helpful resources via WhatsApp when requested
- Connect students with human counselors when needed

**Topics You Handle:**
1. **Counseling Packages** - Explain benefits clearly, help them choose based on needs
2. **MHT-CET Preparation** - Exam dates, pattern, eligibility, preparation tips, cutoffs
3. **Documents & CAP Process** - Checklist, submission deadlines, common mistakes to avoid
4. **Events & Workshops** - Free prep sessions, college tours, live Q&A on Instagram
5. **General Guidance** - College selection, career advice, scholarship info

**Conversation Best Practices:**

1. **Start Warm & Personal:**
   - "Hi! I'm Priya from Campus Dekho. How can I help you today?"
   - If they seem nervous: "Don't worry, we've helped 1000+ students. You're in good hands!"

2. **Ask Clarifying Questions:**
   - "Are you preparing for MHT-CET 2026 or 2027?"
   - "Which stream are you interested in - Engineering or Medical?"
   - "What's your location? I can suggest nearby events."

3. **Provide Context:**
   - Don't just say dates - explain why it matters
   - Example: "Registration opens Feb 1st, so you have 3 weeks to gather documents"
   - Example: "Premium package includes mock CAP registration - this helps 90% of students avoid last-minute panic"

4. **Use Simple Language:**
   - Explain jargon: "CAP means Centralized Admission Process - it's how Maharashtra colleges allocate seats"
   - Avoid technical terms unless necessary
   - Use examples: "Think of it like college application ka Swiggy - one platform for all colleges"

5. **Be Proactive:**
   - If they ask about exam dates, also mention preparation tips
   - If they ask about packages, understand their needs first
   - Always offer WhatsApp for detailed info: "Should I send you the complete checklist on WhatsApp?"

6. **Handle Sensitive Topics Carefully:**
   - If they're stressed: "Take a deep breath! We'll sort this out together."
   - If they're confused: "No problem, let me explain it step by step."
   - If financial concerns: "We have packages starting at ₹999. Let's find what works for you."

7. **Use Natural Language:**
   ✅ "MHT-CET is usually in May. If you're starting prep now, you have 2 months - plenty of time with the right strategy!"
   ❌ "MHT-CET 2026 exam dates are expected to be announced in February 2026."

**CRITICAL RULES:**

1. **ALWAYS use tools** to fetch accurate data (dates, packages, events)
2. **NEVER make up information** - if unsure, say "Let me check that for you" and use search_knowledge
3. **Confirm phone numbers** before sending WhatsApp: "Your number is +91XXXXXXXXXX, right?"
4. **Escalate intelligently:**
   - Complex financial queries → human counselor
   - Emotional distress → human counselor
   - Technical issues you can't solve → human counselor
   - After 2 failed attempts to help → human counselor

5. **Track conversation context:**
   - Remember what they asked earlier in the conversation
   - Reference previous topics: "Earlier you mentioned you're in Pune..."
   - Don't make them repeat information

6. **End gracefully:**
   ✅ "Anything else I can help with? Or should I connect you with our admission team for the next steps?"
   ❌ "Thank you for contacting Campus Dekho. Goodbye."

**Language Handling:**
- Detect language from user's first message
- Respond in their preferred language (English/Hindi/Marathi)
- Code-mix naturally if they do: "MHT-CET ka exam pattern kaafi simple hai"
- Keep technical terms in English: "MHT-CET", "CAP rounds", "percentile"

**Example Conversations:**

USER: "MHT-CET kab hai?"
PRIYA: "MHT-CET 2026 ki exam likely May mein hogi. Registration February se start hogi. Aap konse year ka exam de rahe ho? Main aapko preparation tips bhi bata sakti hoon! 😊"

USER: "I'm very confused about documents"
PRIYA: "I totally understand - documents can be overwhelming! Let me make it simple for you. For MHT-CET admission, you need: 10th & 12th marksheets, domicile, Aadhaar, and photos. Should I send you the complete checklist on WhatsApp so you can keep it handy?"

USER: "Counseling packages?"
PRIYA: "Great question! Tell me a bit about yourself first - are you targeting top colleges in Pune or keeping options open across Maharashtra? This will help me suggest the right package for you. We have 3 options starting from ₹999."

Remember: You're not just answering questions - you're guiding students through one of the biggest decisions of their lives. Be helpful, be human, be hopeful! 🎓✨`;

// ============================================
// INBOUND AGENT ORCHESTRATOR
// ============================================

export class InboundAgentOrchestrator {
  constructor() {
    this.model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',  // Changed from gemini-2.5-flash-exp
      systemInstruction: ORCHESTRATOR_SYSTEM_PROMPT,
    });

    this.sessions = new Map(); // callSid -> { chat, history, metadata }
  }

  /**
   * Start new inbound call conversation
   * @param {string} callSid - Unique call identifier
   * @param {string} callerNumber - Caller phone number
   * @returns {Promise<string>} Greeting message
   */
  async startConversation(callSid, callerNumber) {
    console.log(`📞 Starting inbound call: ${callSid} from ${callerNumber}`);

    // Log to database
    this.logInboundCall(callSid, callerNumber, 'active');

    // Create new chat session with tools
    const chat = this.model.startChat({
      tools: [{ functionDeclarations: INBOUND_TOOLS }],
      history: [],
    });

    this.sessions.set(callSid, {
      chat,
      history: [],
      metadata: {
        callerNumber,
        detectedLanguage: 'en',
        detectedTopics: [],
        startTime: Date.now(),
      },
    });

    const greeting = `Namaste! Welcome to Campus Dekho - the admission corridor. I'm Priya, your AI assistant. How can I help you today?`;

    this.logConversationTurn(callSid, 'agent', greeting, 'orchestrator');

    return greeting;
  }

  /**
   * Process user message and generate response
   * @param {string} callSid - Call SID
   * @param {string} userMessage - User message
   * @returns {Promise<Object>} { text, toolCalls, needsEscalation }
   */
  async processMessage(callSid, userMessage) {
    const session = this.sessions.get(callSid);
    if (!session) {
      throw new Error('Session not found. Call startConversation first.');
    }

    console.log(`💬 [${callSid}] User: ${userMessage}`);

    // Log user message
    this.logConversationTurn(callSid, 'user', userMessage);

    try {
      // Send message to Gemini
      const result = await session.chat.sendMessage(userMessage);
      const response = result.response;

      let responseText = '';
      const toolCalls = [];
      const functionResults = [];

      // Check for function calls
      const calls = response.functionCalls();

      if (calls && calls.length > 0) {
        console.log(`🔧 Function calls detected: ${calls.length}`);

        // Execute each function call
        for (const call of calls) {
          const toolResult = await executeTool(
            call.name,
            call.args,
            callSid
          );

          functionResults.push({
            name: call.name,
            response: toolResult,
          });

          toolCalls.push({ name: call.name, args: call.args, result: toolResult });
        }

        // Send function results back to Gemini
        const followUp = await session.chat.sendMessage(
          functionResults.map(fr => ({
            functionResponse: {
              name: fr.name,
              response: fr.response,
            },
          }))
        );

        responseText = followUp.response.text();
      } else {
        responseText = response.text();
      }

      console.log(`🤖 [${callSid}] Agent: ${responseText}`);

      // Log agent response
      this.logConversationTurn(
        callSid,
        'agent',
        responseText,
        'orchestrator',
        null,
        null,
        toolCalls.length > 0 ? JSON.stringify(toolCalls.map(tc => tc.name)) : null
      );

      // Check if escalation happened
      const needsEscalation = toolCalls.some(tc => tc.name === 'escalate_to_human');
      const escalationData = needsEscalation
        ? toolCalls.find(tc => tc.name === 'escalate_to_human')?.result
        : null;

      return {
        text: responseText,
        toolCalls,
        needsEscalation,
        escalationData,
      };
    } catch (error) {
      console.error('❌ Error processing message:', error);

      // Fallback response
      const fallback = "I'm sorry, I'm having trouble processing your request. Would you like me to connect you with a human agent?";
      this.logConversationTurn(callSid, 'agent', fallback, 'orchestrator');

      return {
        text: fallback,
        toolCalls: [],
        needsEscalation: false,
        error: error.message,
      };
    }
  }

  /**
   * End conversation and cleanup
   * @param {string} callSid - Call SID
   */
  async endConversation(callSid) {
    const session = this.sessions.get(callSid);
    if (!session) return;

    const duration = Math.floor((Date.now() - session.metadata.startTime) / 1000);

    console.log(`📴 Ending call: ${callSid} (${duration}s)`);

    // Update database
    this.updateCallLog(callSid, 'completed', duration);

    // Cleanup
    this.sessions.delete(callSid);

    return { status: 'ended', duration };
  }

  /**
   * Log inbound call to database
   */
  logInboundCall(callSid, callerNumber, status) {
    const db = new Database(DB_PATH);

    try {
      db.prepare(`
        INSERT OR IGNORE INTO inbound_calls
        (call_sid, caller_number, status)
        VALUES (?, ?, ?)
      `).run(callSid, callerNumber, status);
    } catch (error) {
      console.error('❌ Failed to log call:', error.message);
    } finally {
      db.close();
    }
  }

  /**
   * Update call log
   */
  updateCallLog(callSid, status, duration = null) {
    const db = new Database(DB_PATH);

    try {
      db.prepare(`
        UPDATE inbound_calls
        SET status = ?, duration = ?, completed_at = datetime('now')
        WHERE call_sid = ?
      `).run(status, duration, callSid);
    } catch (error) {
      console.error('❌ Failed to update call:', error.message);
    } finally {
      db.close();
    }
  }

  /**
   * Log conversation turn
   */
  logConversationTurn(
    callSid,
    role,
    message,
    agentType = null,
    intent = null,
    confidence = null,
    toolsCalled = null
  ) {
    const db = new Database(DB_PATH);

    try {
      const turnNumber = db.prepare(
        'SELECT COUNT(*) as count FROM conversation_turns WHERE call_sid = ?'
      ).get(callSid).count + 1;

      db.prepare(`
        INSERT INTO conversation_turns
        (call_sid, turn_number, role, agent_type, message, intent, confidence, tools_called)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(callSid, turnNumber, role, agentType, message, intent, confidence, toolsCalled);
    } catch (error) {
      console.error('❌ Failed to log turn:', error.message);
    } finally {
      db.close();
    }
  }

  /**
   * Get conversation history
   */
  getConversationHistory(callSid) {
    const db = new Database(DB_PATH, { readonly: true });

    try {
      return db.prepare(`
        SELECT * FROM conversation_turns
        WHERE call_sid = ?
        ORDER BY turn_number ASC
      `).all(callSid);
    } finally {
      db.close();
    }
  }
}

export default InboundAgentOrchestrator;
