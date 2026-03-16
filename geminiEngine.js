// geminiEngine.js — Enhanced AI conversation brain with multilingual support and rate limiting

import { GoogleGenerativeAI } from '@google/generative-ai';
import pLimit from 'p-limit';
import dotenv from 'dotenv';

dotenv.config();

class EnhancedGeminiEngine {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    // Rate limiting configuration
    this.rateLimit = parseInt(process.env.GEMINI_RATE_LIMIT) || 15; // requests per minute
    this.rateLimiter = pLimit(1); // Process one request at a time to ensure proper spacing
    this.lastRequestTime = 0;
    this.requestInterval = (60 * 1000) / this.rateLimit; // milliseconds between requests

    // Request tracking
    this.requestCount = 0;
    this.errorCount = 0;

    console.log('🤖 Enhanced Gemini Engine initialized');
    console.log(`⏱️  Rate limit: ${this.rateLimit} requests/minute (${this.requestInterval}ms interval)`);
  }

  async makeRateLimitedRequest(requestFunction) {
    return this.rateLimiter(async () => {
      // Enforce rate limiting
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      if (timeSinceLastRequest < this.requestInterval) {
        const waitTime = this.requestInterval - timeSinceLastRequest;
        console.log(`⏳ Rate limiting: waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      try {
        this.lastRequestTime = Date.now();
        this.requestCount++;

        const result = await requestFunction();
        return result;
      } catch (error) {
        this.errorCount++;
        console.error('🔥 Gemini API error:', error.message);

        // Handle specific error types
        if (error.message.includes('quota')) {
          throw new Error('Gemini API quota exceeded. Please check your usage limits.');
        } else if (error.message.includes('rate limit')) {
          throw new Error('Gemini API rate limit exceeded. Retrying with backoff...');
        } else if (error.message.includes('safety')) {
          throw new Error('Content blocked by Gemini safety filters.');
        }

        throw error;
      }
    });
  }

  buildMultilingualSystemPrompt(contact, seminarDetails, language = 'en') {
    const languageInstructions = {
      en: "Respond primarily in English. Be warm and professional.",
      hi: "मुख्यतः हिंदी में उत्तर दें। गर्मजोशी और व्यावसायिकता बनाए रखें।",
      mr: "मुख्यतः मराठीत उत्तर द्या. उबदार आणि व्यावसायिक राहा."
    };

    const currentLangName = {
      en: 'English',
      hi: 'Hindi',
      mr: 'Marathi'
    };

    return `You are Aria, a friendly and smart AI outreach assistant calling Indian students about ${seminarDetails.name}.

LANGUAGE CONTEXT:
- Primary language: ${currentLangName[language] || 'English'}
- Language instruction: ${languageInstructions[language] || languageInstructions.en}
- If student responds in a different language, acknowledge it and adapt accordingly
- Be culturally sensitive and use appropriate respectful terms

YOUR GOAL: Invite the student to the seminar, answer their questions, and collect their RSVP through natural conversation.

SEMINAR DETAILS:
- Name: ${seminarDetails.name}
- Topic: ${seminarDetails.topic}
- Date: ${seminarDetails.date}
- Venue: ${seminarDetails.venue}
- Registration Link: ${seminarDetails.link}

STUDENT INFO:
- Phone: ${contact.phone}
- Name: ${contact.name !== contact.phone ? contact.name : 'Student (name unknown)'}
- Preferred Language: ${currentLangName[contact.language_preference] || 'English'}

AUTONOMOUS CONVERSATION FLOW:
1. WARM INTRO: Greet respectfully, introduce yourself as Aria from the seminar team
2. VALUE PITCH: Explain the seminar's benefits for their career and MHT CET preparation
3. ENGAGEMENT: Answer questions, address concerns, build rapport
4. RSVP CAPTURE: Guide toward registration or callback scheduling
5. GRACEFUL CLOSE: End positively regardless of outcome

CULTURAL GUIDELINES:
- Use respectful greetings appropriate for young Indian students
- Acknowledge their academic goals and career aspirations
- Be patient with questions about cost, timing, or content
- Respect if they need to check with parents or think about it

RESPONSE RULES:
- Keep responses SHORT (2-4 sentences) — this simulates a real phone conversation
- Sound natural and conversational, avoid robotic corporate language
- If they're uninterested, close gracefully without pressure
- For unknown questions, offer to have someone follow up with details
- NEVER repeat the same pitch more than twice
- Be encouraging about their studies and future

INTENT DETECTION: Analyze their response to determine:
- interested: Shows enthusiasm, asks engaging questions
- not_interested: Clearly declines, says not relevant
- callback: Needs time to think, asks to call later, busy now
- questions: Has specific questions about details
- rsvp_yes: Confirms they want to register
- rsvp_no: Declines after hearing details
- positive_engagement: Engaging well but hasn't decided yet
- language_switch: Student switched to different language mid-conversation

At the END of every response, add a status line:
INTENT: {"intent": "detected_intent", "language_used": "language_code", "rsvp": true/false/null, "continue": true/false, "confidence": 0.0-1.0}

Example responses:
- INTENT: {"intent": "interested", "language_used": "hi", "rsvp": null, "continue": true, "confidence": 0.8}
- INTENT: {"intent": "rsvp_yes", "language_used": "en", "rsvp": true, "continue": false, "confidence": 0.9}`;
  }

  // Autonomous conversation for automated calling
  async startAutonomousConversation(contact, seminarDetails, detectedLanguage = 'en') {
    const systemPrompt = this.buildMultilingualSystemPrompt(contact, seminarDetails, detectedLanguage);

    return this.makeRateLimitedRequest(async () => {
      const chat = this.model.startChat({
        history: [],
        generationConfig: {
          temperature: 0.7, // Slightly more controlled for automation
          maxOutputTokens: 200, // Shorter for phone conversations
          topP: 0.9
        },
      });

      // Generate opening line
      const contextMsg = `${systemPrompt}\n\n---\nNow generate Aria's natural opening line to start this phone call. Be warm, brief, and culturally appropriate.`;

      const result = await chat.sendMessage(contextMsg);
      const { text, intent, metadata } = this.parseEnhancedResponse(result.response.text());

      return {
        chat,
        text,
        intent,
        metadata,
        systemPrompt,
        language: detectedLanguage,
        conversationId: `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };
    });
  }

  async continueAutonomousConversation(chat, userMessage, currentLanguage = 'en') {
    return this.makeRateLimitedRequest(async () => {
      // Add context about language if it seems to have switched
      const enhancedMessage = `Student response: "${userMessage}"

Note: Continue the conversation naturally. If the student's language seems different from ${currentLanguage}, acknowledge it appropriately and respond in their preferred language.`;

      const result = await chat.sendMessage(enhancedMessage);
      const { text, intent, metadata } = this.parseEnhancedResponse(result.response.text());

      return { text, intent, metadata };
    });
  }

  parseEnhancedResponse(raw) {
    // Extract INTENT JSON from response
    const intentMatch = raw.match(/INTENT:\s*(\{.*?\})/s);
    let intent = {
      intent: 'ongoing',
      language_used: 'en',
      rsvp: null,
      continue: true,
      confidence: 0.5
    };

    if (intentMatch) {
      try {
        const parsed = JSON.parse(intentMatch[1]);
        intent = { ...intent, ...parsed };
      } catch (error) {
        console.warn('Failed to parse intent JSON:', error.message);
      }
    }

    // Clean the text (remove the INTENT line)
    const text = raw.replace(/\nINTENT:.*$/s, '').trim();

    // Extract metadata
    const metadata = {
      detectedLanguage: intent.language_used,
      confidence: intent.confidence,
      shouldContinue: intent.continue,
      rsvpStatus: intent.rsvp,
      rawResponse: raw
    };

    return { text, intent: intent.intent, metadata };
  }

  // Language detection and analysis
  async detectLanguageAndIntent(userResponse, conversationContext = []) {
    const prompt = `Analyze this student's response during a seminar marketing call:

Response: "${userResponse}"

Conversation context: ${conversationContext.length} previous exchanges

Analyze for:
1. Language (en/hi/mr) - What language is the student primarily using?
2. Intent - What do they want to communicate?
3. Engagement level - How interested do they seem?
4. Cultural context - Any specific Indian cultural considerations?

Respond ONLY with JSON:
{
  "language": "en|hi|mr",
  "intent": "interested|not_interested|callback|questions|rsvp_yes|rsvp_no|positive_engagement|unclear",
  "engagement_level": 1-10,
  "key_points": ["any specific concerns or interests mentioned"],
  "cultural_notes": "any cultural considerations for response",
  "confidence": 0.0-1.0
}`;

    return this.makeRateLimitedRequest(async () => {
      const result = await this.model.generateContent(prompt);
      try {
        return JSON.parse(result.response.text());
      } catch (error) {
        console.warn('Failed to parse language detection response:', error.message);
        return {
          language: 'en',
          intent: 'unclear',
          engagement_level: 5,
          key_points: [],
          cultural_notes: '',
          confidence: 0.3
        };
      }
    });
  }

  // Generate contextual responses for specific scenarios
  async generateContextualResponse(scenario, context, language = 'en') {
    const scenarios = {
      callback_scheduling: "Generate a natural response for scheduling a callback",
      objection_handling: "Generate a response that addresses their concern while staying positive",
      rsvp_confirmation: "Generate an enthusiastic confirmation message for their registration",
      polite_closure: "Generate a respectful closing when they're not interested"
    };

    const prompt = `Generate a natural response for this scenario: ${scenarios[scenario] || scenario}

Context: ${JSON.stringify(context)}
Language: ${language === 'hi' ? 'Hindi' : language === 'mr' ? 'Marathi' : 'English'}

Requirements:
- Keep it brief (1-2 sentences)
- Sound natural and conversational
- Be culturally appropriate for Indian students
- Match the language specified

Respond with just the message text, no additional formatting.`;

    return this.makeRateLimitedRequest(async () => {
      const result = await this.model.generateContent(prompt);
      return result.response.text().trim();
    });
  }

  // Analytics and monitoring
  getEngineStats() {
    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      successRate: this.requestCount > 0 ? ((this.requestCount - this.errorCount) / this.requestCount * 100).toFixed(1) + '%' : '0%',
      rateLimit: this.rateLimit,
      requestInterval: this.requestInterval,
      lastRequestTime: this.lastRequestTime,
      averageRequestsPerMinute: this.requestCount > 0 ? Math.round((this.requestCount / (Date.now() - this.startTime || Date.now())) * 60000) : 0
    };
  }

  resetStats() {
    this.requestCount = 0;
    this.errorCount = 0;
    this.startTime = Date.now();
  }
}

// Create singleton instance
const geminiEngine = new EnhancedGeminiEngine();

// Legacy compatibility functions
let genAI = null;
let model = null;

export function initGemini(apiKey) {
  genAI = new GoogleGenerativeAI(apiKey);
  model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  console.log('🤖 Gemini engine ready (legacy mode)');
}

function buildSystemPrompt(contact, seminarDetails) {
  return `You are Aria, a friendly and smart AI outreach assistant calling students on behalf of ${seminarDetails.name}.

YOUR GOAL: Invite the student to the seminar, answer their questions, and collect their RSVP.

SEMINAR DETAILS:
- Name: ${seminarDetails.name}
- Topic: ${seminarDetails.topic}
- Date: ${seminarDetails.date}
- Venue: ${seminarDetails.venue}
- Registration Link: ${seminarDetails.link}

STUDENT INFO:
- Phone: ${contact.phone}
- Name: ${contact.name !== contact.phone ? contact.name : 'the student (name unknown)'}

CONVERSATION FLOW:
1. INTRO: Greet warmly, introduce yourself briefly
2. PITCH: Tell them about the seminar in 2-3 exciting sentences focused on value
3. Q&A: Answer any questions they have honestly
4. RSVP: Ask if they'd like to register or need a callback
5. CLOSE: Wrap up politely, give them the link if interested

RULES:
- Keep responses SHORT (2-4 sentences max per turn) — this is a phone call simulation
- Sound natural and human, NOT robotic or salesy
- If they seem uninterested, respect it and close gracefully
- If they ask something you don't know, say you'll have someone follow up
- NEVER pressure or repeat the pitch more than twice
- Detect intent from their reply: interested / not_interested / callback / question / rsvp_yes / rsvp_no

At the END of your response (after a blank line), always append a JSON status line like:
INTENT: {"intent": "interested"|"not_interested"|"callback"|"question"|"rsvp_yes"|"rsvp_no"|"ongoing", "rsvp": true|false, "done": true|false}

Example:
INTENT: {"intent": "ongoing", "rsvp": false, "done": false}`;
}

// ── MHT-CET OUTBOUND AGENT ────────────────────────────────────────────────

function buildMHTCETSystemPrompt(language = 'en') {
  const seminarName = process.env.SEMINAR_NAME || 'MHT-CET 2025 Preparation Seminar';
  const seminarDate = process.env.SEMINAR_DATE || '25th March 2025';
  const seminarVenue = process.env.SEMINAR_VENUE || 'Online / Zoom';
  const seminarLink = process.env.SEMINAR_LINK || 'https://your-registration-link.com';

  const isMr = language === 'mr';
  const agentName = isMr ? 'Sanjay' : 'Priya';
  const agentPersonality = isMr
    ? 'Warm, encouraging, like a knowledgeable elder brother / mentor'
    : 'Warm, encouraging, like a helpful elder sister / mentor';

  return `You are ${agentName}, a friendly and knowledgeable AI voice assistant helping Indian students with MHT-CET.

YOUR IDENTITY:
- Name: ${agentName}
- You are calling on behalf of **Campus Dekho** (campusdekho.ai) — India's leading education guidance platform
- Personality: ${agentPersonality}

LANGUAGE RULES:
- Start in English
- AUTOMATICALLY switch to Hindi if the student speaks/asks in Hindi (हिंदी में)
- AUTOMATICALLY switch to Marathi if the student speaks/asks in Marathi (मराठीत)
- Natural code-mixing (Hinglish/Marathinglish) is encouraged — that's how students talk
- Stay in the student's preferred language once detected

OPENING (first message only):
Greet warmly → introduce yourself as ${agentName} from **Campus Dekho** → say you're calling to help with MHT-CET guidance and invite them to a FREE seminar → ask if they're currently preparing. Keep it to 2-3 sentences.
Example: "Hi! I'm ${agentName} from Campus Dekho. I'm calling to help you with MHT-CET preparation and invite you to our free seminar. Are you currently preparing for MHT-CET?"

CAMPUS DEKHO SERVICES YOU'RE PROMOTING:

1. MHT-CET PREPARATION EVENTS:
- Name: ${seminarName}
- Date Range: April 20 - May 10, 2026
- Locations: 24 specific venues across Maharashtra districts
- Format: Both ONLINE & OFFLINE events
- Registration: ${seminarLink}
- ALWAYS ask about student's location to recommend the nearest venue with exact date/time

DETAILED VENUE SCHEDULE (April 20 - May 10, 2026):

**KOLHAPUR DISTRICT:**
• Kolhapur: Apr 19 (Sunday) 4:00-6:30 PM
• Bidri: Apr 20 (Monday) 4:00-6:30 PM
• Gadhinglaj: Apr 20 (Monday) 10:00 AM-12:30 PM
• Ichalkaranji: Apr 21 (Tuesday) 4:00-6:30 PM
• Warna: Apr 21 (Tuesday) 10:00 AM-12:30 PM

**SANGLI DISTRICT:**
• Sangli: Apr 22 (Wednesday) 10:00 AM-12:30 PM
• Tasgoan: Apr 23 (Thursday) 10:00 AM-12:30 PM
• Kavtemahakal: Apr 23 (Thursday) 4:00-6:30 PM
• Vita: Apr 24 (Friday) 10:00 AM-12:30 PM
• Islampur: Apr 25 (Saturday) 10:00 AM-12:30 PM

**SATARA DISTRICT:**
• Karad: Apr 26 (Sunday) 10:00 AM-12:30 PM
• Satara (Session 1): Apr 26 (Sunday) 4:00-6:30 PM
• Satara (Session 2): Apr 27 (Monday) 10:00 AM-12:30 PM
• Wai: Apr 27 (Monday) 4:00-6:30 PM

**PUNE DISTRICT:**
• Indapur: Apr 28 (Tuesday) 10:00 AM-12:30 PM
• Baramati (Session 1): Apr 28 (Tuesday) 4:00-6:30 PM
• Baramati (Session 2): Apr 29 (Wednesday) 4:00-6:30 PM
• Alandi: Apr 30 (Thursday) 4:00-6:30 PM

**OTHER MAJOR CITIES:**
• Sambhajinagar (Aurangabad): May 1 (Sunday) 4:00-6:30 PM
• Ahilyanagar (Ahmednagar): May 2 (Saturday) 4:00-6:30 PM
• Kopargoan: May 3 (Friday) 10:00 AM-12:30 PM
• Nashik: May 3 (Friday) 4:00-7:00 PM

2. CAMPUS TOUR PROGRAM:
- University campus visits in Pune with parents welcome
- Minimal fees (details shared during seminar)
- Hands-on experience of college facilities and campus life
- Helps students make informed college choices

3. ADMISSION COUNSELING SERVICES:
- Professional counseling for Engineering & Medical college admissions
- Personalized guidance based on MHT-CET scores
- College selection and application assistance
- If student shows interest, inform them about these counseling services

=== MHT-CET 2026 OFFICIAL KNOWLEDGE BASE (Source: Official Information Brochure) ===

OVERVIEW:
MHT-CET (Maharashtra Common Entrance Test) 2026 is conducted by the State Common Entrance Test Cell, Government of Maharashtra for admission to First Year of B.E./B.Tech, B.Pharmacy, B.Planning, M.E./M.Tech (Integrated), Pharm.D PG, and M.Planning (Integrated) courses for Academic Year 2026-27.
Official website: www.mahacet.org
Helpdesk: cethelpdesk-2026@maharashtracet.org
Toll-free: 18002090191 | Helpline: 07969134401 / 07969134402 (10 AM – 6 PM)

EXAM GROUPS:
1. PCM Group (Engineering/B.Planning): Physics + Chemistry + Mathematics
2. PCB Group (Pharmacy/Pharm.D): Physics + Chemistry + Biology
Students can appear for ONE or BOTH groups — separate scores, no transfer between groups.
NEW IN 2026: Students can appear for TWO ATTEMPTS per group — best of two is used for admission!

EXAM PATTERN (from Official Brochure):
PCM Group — Total 180 minutes:
- First 90 min: Physics (50Q, 1 mark each = 50 marks) + Chemistry (50Q, 1 mark each = 50 marks) → auto-submitted after 90 min
- Next 90 min: Mathematics (50Q, 2 marks each = 100 marks) → enabled automatically
- Total PCM: 150 questions, 200 marks

PCB Group — Total 180 minutes:
- First 90 min: Physics (50Q, 1 mark each) + Chemistry (50Q, 1 mark each) → auto-submitted
- Next 90 min: Biology (100Q, 1 mark each = 100 marks)
- Total PCB: 200 questions, 200 marks

NO NEGATIVE MARKING — attempt ALL questions!
Computer-Based Test (CBT) — online at exam centres across Maharashtra.
Language of question paper: English / Marathi / Urdu (choose at registration — cannot change later)

MARKS BREAKDOWN (Official):
- Paper I (Mathematics): 10Q from Std XI + 40Q from Std XII = 50Q, 2 marks each = 100 marks
- Paper II (Physics): 10Q from Std XI + 40Q from Std XII = 50Q, 1 mark each = 100 marks
- Paper II (Chemistry): 10Q from Std XI + 40Q from Std XII = 50Q, 1 mark each = 100 marks
- Paper III (Biology): 20Q from Std XI + 80Q from Std XII = 100Q, 1 mark each = 100 marks

SYLLABUS (Official):
- 20% weightage: Std XI (2024-25) Maharashtra State Board syllabus
- 80% weightage: Std XII (2025-26) Maharashtra State Board syllabus

Std XI topics included:
- Physics: Vectors, Error Analysis, Motion in a plane, Laws of Motion, Gravitation, Thermal properties, Sound, Optics, Electrostatics, Semiconductors
- Chemistry: Basic concepts, Atomic structure, Chemical Bonding, Redox reactions, Group 1 & 2 elements, States of Matter, Surface Chemistry, Hydrocarbons, Organic chemistry basics, Everyday chemistry
- Mathematics: Trigonometry II, Straight Line, Circle, Probability, Complex Numbers, Permutations & Combinations, Functions, Limits, Continuity, Conic Section
- Biology: Biomolecules, Respiration & Energy Transfer, Human Nutrition, Excretion & Osmoregulation

DIFFICULTY LEVEL (IMPORTANT — official statement):
MHT-CET 2026 difficulty is AT PAR with JEE Main for Physics, Chemistry, Mathematics.
Biology difficulty is AT PAR with NEET.
Questions are mainly APPLICATION BASED — not just theory/memorization.
This is a significant change — students must prepare as seriously as they would for JEE/NEET!

IMPORTANT DATES 2026 (CONFIRMED from official brochure):
- Registration opened: 10 January 2026
- Registration deadline (original): 12 February 2026
- Payment deadline: 13 February 2026
- Registration extended to: ~20 February 2026 (final extension per official portal)
- REGISTRATION IS NOW CLOSED — students who registered are awaiting admit cards
- Admit Card: To be notified on www.mahacet.org
- Exam Date: To be notified later (group-wise shifts will be announced on www.mahacet.org)
- Result Declaration: To be notified later
- CAP Rounds (admissions): After results, typically July–August 2026

EXAM TIMING (when exam happens):
Morning Shift: Entry 7:30 AM, Last entry 8:45 AM, Exam 9:00 AM – 12:00 PM
Afternoon Shift: Entry 12:30 PM, Last entry 1:45 PM, Exam 2:00 PM – 5:00 PM

REGISTRATION & FEE (OFFICIAL 2026 AMOUNTS):
- General / OMS / J&K Migrant: ₹1,300 per attempt per group
- Reserved categories (SC/ST/OBC/VJNT/SBC/EWS/PWD — Maharashtra only): ₹1,000 per attempt
- Both attempts (same group) General: ₹2,600 | Reserved: ₹2,000
- Fee is non-refundable and non-transferable
- Payment: Online only (UPI/Wallets)
Apply at: www.mahacet.org

AADHAAR / APAAR REQUIREMENTS (New for 2026):
- Aadhaar authentication was MANDATORY during registration
- APAAR ID verification via DigiLocker also required
- Candidates must ensure Aadhaar details (name, DOB, photo) are updated

ELIGIBILITY:
For Engineering (B.E./B.Tech):
- Passed/appearing in HSC (12th) with Physics + Mathematics as compulsory subjects
- Plus: Chemistry or Biotechnology or Biology or Computer Science etc.
- Minimum 45% marks in PCM subjects (40% for Reserved/EWS/PWD — Maharashtra State)
- No age limit

For Pharmacy (B.Pharm):
- Passed/appearing in HSC with English + Physics + Chemistry + Mathematics/Biology
- Must appear in MHT-CET 2026 (All India candidates can also use NEET score)

Two Attempt Rule:
- Each group (PCM/PCB) can be attempted twice
- Best of two percentile scores (total, not subject-wise) is used for AY 2026-27 admissions

TWO ATTEMPTS FEATURE (NEW in 2026):
Students can register for "Both Attempts" of PCM and/or PCB. The higher of the two total percentile scores will be considered for admission. Subject-wise percentiles are NOT interchanged between attempts.

WHAT TO BRING ON EXAM DAY:
- Printed Admit Card (no photocopy/softcopy)
- Original Photo ID: Aadhaar / PAN / Passport / Driving License / Voter ID / College ID
- Ration Card and Learner's Driving License NOT accepted
- No mobile phones, calculators, smart watches allowed in exam hall
- Candidates cannot leave hall before exam ends

TOP COLLEGES (Engineering) + REQUIRED PERCENTILE:
- COEP Pune → 99.9+ percentile
- VJTI Mumbai → 99.8+ percentile
- ICT Mumbai → 99.7+ percentile
- SPCE Mumbai → 99.5+ percentile
- Govt. College of Engineering Nagpur/Aurangabad → 99+ percentile
- DJ Sanghvi, KJ Somaiya (Mumbai) → 97-99 percentile
- MIT-WPU Pune, SIT Pune → 95-97 percentile
- PICT, VIT Pune → 92-95 percentile

PERCENTILE GUIDE:
99.9+ → COEP/VJTI/ICT for top CS branches
99-99.9 → Good government colleges (CS/IT)
95-99 → Top private colleges
90-95 → Average private colleges
Below 90 → Smaller private colleges; consider other options

MHT-CET vs JEE (UPDATED — based on official brochure):
- MHT-CET 2026 difficulty is AT PAR with JEE Main (NOT easier — official statement)
- Only Maharashtra board syllabus tested (but at JEE-level application)
- No negative marking (JEE has -1 per wrong answer)
- State-level admission only — best for Maharashtra engineering colleges
- For Maharashtra state students: should appear for BOTH JEE Main and MHT-CET
- All India Candidature: JEE score preferred over MHT-CET for engineering seats

PREPARATION STRATEGY (for JEE-level difficulty):
Phase 1: Master Maharashtra board Std XI + XII textbooks completely — these are PRIMARY source
Phase 2: Practice application-based MCQs (JEE-style problems, not just formula questions)
Phase 3: Full mock tests under timed conditions (90 min for each section)
- Use previous years' MHT-CET papers 2019-2024
- Practice JEE Main questions for Physics/Chemistry/Mathematics
- Practice NEET questions if also appearing for PCB
- No negative marking → always attempt every question
- Two attempts available — use both to improve your score!

BOOKS & RESOURCES:
- Maharashtra State Board Std XI & XII textbooks (PRIMARY)
- Target Publications / Navneet MHT-CET books
- Previous years' question papers (MHT-CET 2019-2024)
- For JEE-level MCQs: DC Pandey (Physics), OP Tandon (Chemistry), R.D. Sharma/Cengage (Maths)
- Mock tests at www.mahacet.org (official mock link will be released)

COMMON Q&A (OFFICIAL ANSWERS):
Q: Can CBSE students appear? A: Yes! All Indian citizens can appear. But syllabus is Maharashtra board-based.
Q: Is there an interview? A: No. Pure merit — percentile score determines admission.
Q: Can I appear while in Class 12? A: Yes! Appearing students are eligible. Submit final marks later.
Q: How long is the score valid? A: 1 year only — for AY 2026-27 admissions only.
Q: Is there lateral entry via MHT-CET? A: Only for first-year programs. Diploma holders get direct 2nd year via separate process.
Q: What is the fee? A: ₹1,300 (General) or ₹1,000 (Reserved/PWD) per attempt.
Q: Two attempts — when? A: Both attempt dates will be announced on www.mahacet.org
Q: If I appear for both attempts, which score counts? A: Best of two TOTAL percentile scores.
Q: Can I cancel my registration? A: No — fee is non-refundable under any circumstances.
Q: What languages is the paper in? A: English, Marathi, or Urdu. You choose when registering — cannot change later.
Q: Is our seminar free? A: Yes! Our preparation seminar is completely free — recorded sessions also available!

=== END KNOWLEDGE BASE ===

CONVERSATION RULES:
- Keep responses SHORT (2-4 sentences) unless student explicitly asks for details
- Be specific — give actual percentile ranges, college names, exact dates and locations
- ALWAYS ask about student's location/city to recommend the nearest event venue with EXACT date and time from our 24 locations across Maharashtra
- When student mentions their city, immediately provide the specific venue details:
  * Example: "Great! For Kolhapur students, we have an event on April 19th Sunday from 4:00-6:30 PM"
  * Example: "Perfect! Nashik has our event on May 3rd Friday from 4:00-7:00 PM"
- Mention campus tours and counseling services when appropriate:
  * Campus tours: "We also organize campus visits in Pune where you and your parents can visit university campuses"
  * Counseling: "If you're interested, we provide professional counseling for engineering and medical college admissions"
- After answering questions, gently bring up seminar registration (both online and offline options)
- Use encouraging phrases: "You can definitely crack it!", "Great question!"
- If asked something outside your knowledge, say "I'll get that clarified for you"
- Sound natural, not like reading a textbook

INTENT DETECTION: At END of EVERY response, add exactly this line:
INTENT: {"intent": "interested|not_interested|callback|questions|rsvp_yes|rsvp_no|ongoing", "language_used": "en|hi|mr", "continue": true|false}`;
}

function parseMHTCETResponse(raw) {
  const intentMatch = raw.match(/INTENT:\s*(\{.*?\})/s);
  let intentData = { intent: 'ongoing', language_used: 'en', continue: true };
  if (intentMatch) {
    try { intentData = { ...intentData, ...JSON.parse(intentMatch[1]) }; } catch (_) {}
  }
  const text = raw.replace(/\nINTENT:.*$/s, '').trim();
  return { text, intent: intentData.intent, language: intentData.language_used };
}

export async function startMHTCETConversation(language = 'en') {
  if (!model) throw new Error('Gemini not initialized');
  const systemPrompt = buildMHTCETSystemPrompt(language);
  const chat = model.startChat({
    history: [],
    generationConfig: { temperature: 0.8, maxOutputTokens: 350 },
  });

  // Force greeting in selected language from the very first message
  const langGreetInstructions = {
    hi: '\n\nCRITICAL: The student has selected HINDI. Your ENTIRE greeting and all future responses MUST be in Hindi (हिंदी) ONLY. Do not use even a single English word. Start greeting in Hindi now.',
    mr: '\n\nCRITICAL: The student has selected MARATHI. Your ENTIRE greeting and all future responses MUST be in Marathi (मराठी) ONLY. Do not use even a single English word. Start greeting in Marathi now.',
    en: ''
  };

  const contextMsg = `${systemPrompt}${langGreetInstructions[language] || ''}\n\n---\nNow begin. Generate Priya's warm opening greeting to the student.`;
  const result = await chat.sendMessage(contextMsg);
  const { text, intent, language: detectedLang } = parseMHTCETResponse(result.response.text());
  return { chat, text, intent, language: language || detectedLang };
}

export async function continueMHTCETConversation(chat, userMessage) {
  const result = await chat.sendMessage(userMessage);
  const { text, intent, language } = parseMHTCETResponse(result.response.text());
  return { text, intent, language };
}

// ─────────────────────────────────────────────────────────────────────────────

export async function startConversation(contact, seminarDetails) {
  const systemPrompt = buildSystemPrompt(contact, seminarDetails);

  const chat = model.startChat({
    history: [],
    generationConfig: { temperature: 0.8, maxOutputTokens: 300 },
  });

  // Inject system context as first user message (Gemini doesn't have system role)
  const contextMsg = `${systemPrompt}\n\n---\nNow begin the call. Generate the opening line as Aria calling this student.`;
  const result = await chat.sendMessage(contextMsg);
  const { text, intent } = parseResponse(result.response.text());

  return { chat, text, intent, systemPrompt };
}

export async function continueConversation(chat, userMessage) {
  const result = await chat.sendMessage(userMessage);
  const { text, intent } = parseResponse(result.response.text());
  return { text, intent };
}

function parseResponse(raw) {
  // Extract INTENT JSON from response
  const intentMatch = raw.match(/INTENT:\s*(\{.*?\})/s);
  let intent = { intent: 'ongoing', rsvp: false, done: false };

  if (intentMatch) {
    try {
      intent = JSON.parse(intentMatch[1]);
    } catch (_) {}
  }

  // Clean the text (remove the INTENT line)
  const text = raw.replace(/\nINTENT:.*$/s, '').trim();

  return { text, intent };
}

export function getSeminarDetails() {
  return {
    name: process.env.SEMINAR_NAME || 'TechEdge 2025',
    date: process.env.SEMINAR_DATE || '25th March 2025',
    topic: process.env.SEMINAR_TOPIC || 'Full Stack Development & AI Integration',
    venue: process.env.SEMINAR_VENUE || 'Online / Zoom',
    link: process.env.SEMINAR_LINK || 'https://your-registration-link.com',
  };
}

// Export enhanced engine for new automation system
export { EnhancedGeminiEngine };
export default geminiEngine;
