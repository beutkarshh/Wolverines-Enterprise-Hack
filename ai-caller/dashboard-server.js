// dashboard-server.js — Enhanced Express + WebSocket server with automation controls and multilingual monitoring

import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { initGemini, startConversation, continueConversation, getSeminarDetails, startMHTCETConversation, continueMHTCETConversation, continueMHTCETConversationStream, parseMHTCETResponse } from './geminiEngine.js';
import { startCall as agentStartCall, continueCall as agentContinueCall, continueCallStream as agentContinueCallStream, parseAgentResponse } from './agentEngine.js';
import { speak } from './voiceEngine.js';
import { loadContacts, saveResults, getStats } from './contactQueue.js';
import QueueProcessor from './queueProcessor.js';
import AICallerDatabase from './database.js';
import LanguageEngine from './languageEngine.js';
import CharacterManager from './characterManager.js';
import MultilingualVoiceEngine from './voiceEngine.js';
import TwilioCallManager from './twilioIntegration.js';
import ExotelCaller from './exotelIntegration.js';
import WhatsAppManager from './whatsappIntegration.js';
import InboundAgentOrchestrator from './inboundAgents.js';
import * as kb from './knowledgeBase.js';
import BusinessManager from './businessManager.js';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import ffmpegLib from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { transcribe } from './sttEngine.js';
ffmpegLib.setFfmpegPath(ffmpegPath.path);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static('public'));

// Enhanced State Management
let contacts = [];
let activeSessions = new Map(); // phone -> { chat, contact, transcript }
const outboundSessions = new Map(); // sessionId -> { chat, transcript, language, startTime }
function generateSessionId() { return `ob_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`; }
// Pick language-specific ElevenLabs voice (ELEVENLABS_VOICE_HI, _MR, _EN) or fallback to default
function getVoiceId(lang) {
  return process.env[`ELEVENLABS_VOICE_${(lang || 'en').toUpperCase()}`] || process.env.ELEVENLABS_VOICE_ID;
}
const RESULTS_FILE = process.env.RESULTS_FILE || 'results.csv';
const CSV_FILE = process.env.CSV_FILE || 'contacts.csv';

// New Automation Components
let queueProcessor = null;
let database = null;
let languageEngine = null;
let characterManager = null;
let voiceEngine = null;
let twilioManager = null;
let exotelCaller = null;
let whatsappManager = null;
let inboundOrchestrator = null;
let businessManager = null;
let automationEnabled = false;

// Initialize Systems
async function initializeSystems() {
  console.log('🚀 Initializing enhanced dashboard systems...');

  // Initialize legacy system
  initGemini(process.env.GEMINI_API_KEY);

  // Initialize new automation components
  try {
    database = new AICallerDatabase();
    businessManager = new BusinessManager();
    languageEngine = new LanguageEngine();
    characterManager = new CharacterManager();
    voiceEngine = new MultilingualVoiceEngine();
    // Pre-generate filler audio files in background (non-blocking)
    voiceEngine.generateFillerAudio('./public/audio').catch(e => console.warn('Filler gen skipped:', e.message));
    exotelCaller = new ExotelCaller(businessManager);
    whatsappManager = new WhatsAppManager();
    inboundOrchestrator = new InboundAgentOrchestrator();

    // Initialize queue processor
    queueProcessor = new QueueProcessor();
    setupAutomationEventHandlers();

    // Load existing contacts into database
    await migrateContactsToDatabase();

    console.log('✅ All systems initialized successfully');
    automationEnabled = true;

  } catch (error) {
    console.error('❌ Failed to initialize automation systems:', error);
    console.log('📝 Falling back to manual dashboard mode');
    automationEnabled = false;
  }
}

async function migrateContactsToDatabase() {
  if (fs.existsSync(CSV_FILE)) {
    contacts = loadContacts(CSV_FILE, process.env.PHONE_COLUMN || 'phone');
    console.log(`📊 Loaded ${contacts.length} contacts from CSV`);

    // Import into database
    const importResult = await database.importContactsFromCSV(contacts);
    console.log(`💾 Database import: ${importResult.imported} imported, ${importResult.skipped} skipped`);
  } else {
    // Use default test contacts
    contacts = [
      { id: 1, phone: '+919876543210', name: 'Rahul Sharma', status: 'pending', rsvp: false, notes: '', calledAt: null },
      { id: 2, phone: '+919823456789', name: 'Priya Patel', status: 'pending', rsvp: false, notes: '', calledAt: null },
      { id: 3, phone: '+919745678901', name: 'Arjun Mehta', status: 'pending', rsvp: false, notes: '', calledAt: null },
      { id: 4, phone: '+919834567890', name: 'Sneha Gupta', status: 'pending', rsvp: false, notes: '', calledAt: null },
      { id: 5, phone: '+919812345678', name: 'Kiran Rao', status: 'pending', rsvp: false, notes: '', calledAt: null },
    ];

    for (const contact of contacts) {
      await database.addContact(contact.phone, contact.name);
    }
  }
}

function setupAutomationEventHandlers() {
  if (!queueProcessor) return;

  queueProcessor.on('automation:started', (data) => {
    broadcastAutomationUpdate({ type: 'automation_started', data });
  });

  queueProcessor.on('automation:paused', () => {
    broadcastAutomationUpdate({ type: 'automation_paused' });
  });

  queueProcessor.on('automation:resumed', () => {
    broadcastAutomationUpdate({ type: 'automation_resumed' });
  });

  queueProcessor.on('automation:stopped', () => {
    broadcastAutomationUpdate({ type: 'automation_stopped' });
  });

  queueProcessor.on('call:completed', (data) => {
    broadcastAutomationUpdate({ type: 'call_completed', data });
  });

  queueProcessor.on('call:failed', (data) => {
    broadcastAutomationUpdate({ type: 'call_failed', data });
  });

  queueProcessor.on('progress:update', (data) => {
    broadcastAutomationUpdate({ type: 'progress_update', data });
  });

  queueProcessor.on('batch:completed', (data) => {
    broadcastAutomationUpdate({ type: 'batch_completed', data });
  });
}

// Legacy API routes (maintained for backward compatibility)
app.get('/api/contacts', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const filter = req.query.filter || 'all';

  let filtered = contacts;
  if (filter !== 'all') filtered = contacts.filter(c => c.status === filter);

  const start = (page - 1) * limit;
  res.json({
    contacts: filtered.slice(start, start + limit),
    total: filtered.length,
    stats: getStats(contacts),
  });
});

app.get('/api/stats', (req, res) => {
  res.json(getStats(contacts));
});

// Enhanced API Routes for Automation
app.get('/api/automation/status', async (req, res) => {
  if (!automationEnabled) {
    return res.json({ enabled: false, message: 'Automation system not available' });
  }

  try {
    const systemHealth = await queueProcessor.getSystemHealth();
    res.json({ enabled: true, ...systemHealth });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/automation/start', async (req, res) => {
  if (!automationEnabled || !queueProcessor) {
    return res.status(503).json({ error: 'Automation system not available' });
  }

  try {
    const { batchSize } = req.body;
    const success = await queueProcessor.startAutomation(batchSize);

    if (success) {
      res.json({ message: 'Automation started successfully' });
    } else {
      res.status(400).json({ error: 'Failed to start automation' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/automation/pause', async (req, res) => {
  if (!queueProcessor) {
    return res.status(503).json({ error: 'Queue processor not available' });
  }

  try {
    const success = await queueProcessor.pauseAutomation();
    res.json({ success, message: success ? 'Automation paused' : 'Failed to pause' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/automation/resume', async (req, res) => {
  if (!queueProcessor) {
    return res.status(503).json({ error: 'Queue processor not available' });
  }

  try {
    const success = await queueProcessor.resumeAutomation();
    res.json({ success, message: success ? 'Automation resumed' : 'Failed to resume' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/automation/stop', async (req, res) => {
  if (!queueProcessor) {
    return res.status(503).json({ error: 'Queue processor not available' });
  }

  try {
    const success = await queueProcessor.stopAutomation();
    res.json({ success, message: success ? 'Automation stopped' : 'Failed to stop' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Language and Character Management APIs
app.get('/api/languages/usage', async (req, res) => {
  if (!characterManager) {
    return res.status(503).json({ error: 'Character manager not available' });
  }

  try {
    const dailyUsage = await characterManager.getDailyUsage();
    const analytics = await characterManager.getUsageAnalytics(7);
    const suggestions = await characterManager.getOptimizationSuggestions();

    res.json({
      daily: dailyUsage,
      analytics,
      suggestions
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/languages/stats', async (req, res) => {
  if (!database) {
    return res.status(503).json({ error: 'Database not available' });
  }

  try {
    const languageStats = await database.getLanguageUsageStats();
    const contactStats = await database.getContactStatusStats();
    const systemStats = await database.getSystemStats();

    res.json({
      languageDistribution: languageStats,
      contactStats,
      systemOverview: systemStats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/voice/test/:language', async (req, res) => {
  if (!voiceEngine) {
    return res.status(503).json({ error: 'Voice engine not available' });
  }

  try {
    const { language } = req.params;
    const result = await voiceEngine.testVoice(language);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/voice/stats', async (req, res) => {
  if (!voiceEngine) {
    return res.status(503).json({ error: 'Voice engine not available' });
  }

  try {
    const stats = await voiceEngine.getVoiceStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Database Management APIs
app.get('/api/database/contacts', async (req, res) => {
  if (!database) {
    return res.status(503).json({ error: 'Database not available' });
  }

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const status = req.query.status || 'all';
    const language = req.query.language || 'all';

    // Build query conditions
    let whereClause = '';
    const params = [];

    if (status !== 'all') {
      whereClause += ' WHERE status = ?';
      params.push(status);
    }

    if (language !== 'all') {
      whereClause += (whereClause ? ' AND' : ' WHERE') + ' language_preference = ?';
      params.push(language);
    }

    const offset = (page - 1) * limit;

    const contacts = database.db.prepare(`
      SELECT * FROM contacts ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const totalCount = database.db.prepare(`
      SELECT COUNT(*) as count FROM contacts ${whereClause}
    `).get(...params).count;

    res.json({
      contacts,
      pagination: {
        page,
        limit,
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/database/batches', async (req, res) => {
  if (!database) {
    return res.status(503).json({ error: 'Database not available' });
  }

  try {
    const batches = database.db.prepare(`
      SELECT * FROM daily_batches
      ORDER BY created_at DESC
      LIMIT 10
    `).all();

    res.json(batches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/database/logs', async (req, res) => {
  if (!database) {
    return res.status(503).json({ error: 'Database not available' });
  }

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const logs = database.db.prepare(`
      SELECT cl.*, c.phone, c.name
      FROM call_logs cl
      JOIN contacts c ON cl.contact_id = c.id
      ORDER BY cl.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── OUTBOUND CALL (MHT-CET Agent — no contact needed) ─────────────────────────

app.post('/api/outbound/start', async (req, res) => {
  try {
    const sessionId = generateSessionId();
    const preferredLanguage = req.body?.language || 'en';

    // Use active business if available, else fall back to legacy MHT-CET
    let chat, text, intent, language;
    if (businessManager) {
      const biz = businessManager.getActiveBusiness();
      if (biz) {
        const knowledge = businessManager.getKnowledge(biz.id);
        const callType = biz.call_types?.[0] || 'outbound_lead';
        const result = await agentStartCall(biz, callType, preferredLanguage, knowledge);
        chat = result.chat; text = result.text; intent = result.intent; language = result.language;
      }
    }
    if (!chat) {
      // fallback — legacy MHT-CET
      ({ chat, text, intent, language } = await startMHTCETConversation(preferredLanguage));
    }

    outboundSessions.set(sessionId, {
      chat,
      transcript: [{ role: 'agent', text, time: new Date().toISOString() }],
      language: language || preferredLanguage,
      startTime: new Date().toISOString(),
    });

    let audioPath = null;
    if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY !== 'your_elevenlabs_api_key_here') {
      audioPath = await speak(text, process.env.ELEVENLABS_API_KEY, getVoiceId(language || preferredLanguage), './public/audio');
      audioPath = audioPath ? `/audio/${path.basename(audioPath)}` : null;
    }

    res.json({ sessionId, text, intent, audioPath, language: language || preferredLanguage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/outbound/respond', async (req, res) => {
  const { sessionId, message, language } = req.body;
  const session = outboundSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    session.transcript.push({ role: 'user', text: message, time: new Date().toISOString() });

    // Inject mandatory language instruction when user has selected a non-English language
    let messageForGemini = message;
    if (language && language !== 'en') {
      const langName = language === 'hi' ? 'Hindi (हिंदी)' : 'Marathi (मराठी)';
      const langScript = language === 'hi' ? 'हिंदी' : 'मराठी';
      messageForGemini = `[CRITICAL LANGUAGE OVERRIDE — NON-NEGOTIABLE]
The student has MANUALLY selected ${langName}. You MUST:
1. Respond ENTIRELY in ${langName} — zero English words allowed
2. Use ${langScript} script throughout your response
3. MHT-CET terms like "PCM", "percentile" can stay, but all explanations must be in ${langName}
4. This overrides your default English setting permanently until changed
Student's message: "${message}"
[Reminder: Your ENTIRE response must be in ${langName} only]`;
    }

    // Use agentEngine for active-business sessions, fall back to legacy for old sessions
    const callType = session.callType || 'outbound_lead';
    const { text, intent, language: detectedLang } = await agentContinueCall(session.chat, messageForGemini, callType);
    session.transcript.push({ role: 'agent', text, time: new Date().toISOString() });
    session.language = language || detectedLang || session.language;

    let audioPath = null;
    if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY !== 'your_elevenlabs_api_key_here') {
      audioPath = await speak(text, process.env.ELEVENLABS_API_KEY, getVoiceId(session.language), './public/audio');
      audioPath = audioPath ? `/audio/${path.basename(audioPath)}` : null;
    }

    res.json({ text, intent, audioPath, language: session.language });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── STREAMING ENDPOINT — Gemini stream → sentence TTS → SSE audio chunks ──────
app.post('/api/outbound/respond-stream', async (req, res) => {
  const { sessionId, message, language } = req.body;
  const session = outboundSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    session.transcript.push({ role: 'user', text: message, time: new Date().toISOString() });

    // Build language-overridden message (same logic as non-stream endpoint)
    let msgForGemini = message;
    if (language && language !== 'en') {
      const langName = language === 'hi' ? 'Hindi (हिंदी)' : 'Marathi (मराठी)';
      const langScript = language === 'hi' ? 'हिंदी' : 'मराठी';
      msgForGemini = `[CRITICAL LANGUAGE OVERRIDE — NON-NEGOTIABLE]\nThe student has MANUALLY selected ${langName}. Respond ENTIRELY in ${langName} only.\nStudent's message: "${message}"`;
    }

    let sentenceBuffer = '';
    let fullText = '';
    let chunkIndex = 0;

    // Regex: sentence boundary for EN + Hindi/Marathi danda
    const SENT_END = /^([\s\S]*?[।.!?]+)\s+([\s\S]*)$/;

    const flushSentence = async (sentence) => {
      sentence = sentence.trim();
      if (sentence.length < 4) return;
      // Strip the INTENT line if it leaked into a sentence
      sentence = sentence.replace(/INTENT:\s*\{.*?\}/s, '').trim();
      if (!sentence) return;

      send({ type: 'text_chunk', text: sentence, index: chunkIndex });

      if (voiceEngine && process.env.ELEVENLABS_API_KEY) {
        try {
          const buf = await voiceEngine.streamVoiceToBuffer(sentence, session.language || 'en');
          send({ type: 'audio', chunk: buf.toString('base64'), index: chunkIndex });
        } catch (e) {
          console.warn('TTS chunk error:', e.message);
        }
      }
      chunkIndex++;
    };

    for await (const token of agentContinueCallStream(session.chat, msgForGemini)) {
      sentenceBuffer += token;
      fullText += token;

      // Flush complete sentences as they accumulate
      let match;
      while ((match = SENT_END.exec(sentenceBuffer)) !== null) {
        await flushSentence(match[1]);
        sentenceBuffer = match[2];
      }
    }

    // Flush whatever remains (last sentence may have no trailing punctuation)
    if (sentenceBuffer.trim()) await flushSentence(sentenceBuffer);

    // Parse intent from the complete response using generic parser
    const callType = session.callType || 'outbound_lead';
    const { text: cleanText, intent, language: detectedLang } = parseAgentResponse(fullText, callType);
    session.transcript.push({ role: 'agent', text: cleanText, time: new Date().toISOString() });
    session.language = language || detectedLang || session.language;

    send({ type: 'done', fullText: cleanText, intent, language: session.language });
    res.end();
  } catch (err) {
    send({ type: 'error', message: err.message });
    res.end();
  }
});

app.post('/api/outbound/end', (req, res) => {
  const { sessionId } = req.body;
  const session = outboundSessions.get(sessionId);
  const exchanges = session ? session.transcript.length : 0;
  outboundSessions.delete(sessionId);
  res.json({ success: true, exchanges });
});

// ── LEGACY CALL ENDPOINTS ─────────────────────────────────────────────────────

// Legacy call endpoints (maintained for manual dashboard)
app.post('/api/call/start', async (req, res) => {
  const { contactId } = req.body;
  const contact = contacts.find(c => c.id === contactId);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  try {
    const seminar = getSeminarDetails();
    const { chat, text, intent } = await startConversation(contact, seminar);

    activeSessions.set(contactId, { chat, contact, transcript: [], intent });
    activeSessions.get(contactId).transcript.push({ role: 'aria', text, time: new Date().toISOString() });

    // TTS
    let audioPath = null;
    if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY !== 'your_elevenlabs_api_key_here') {
      audioPath = await speak(text, process.env.ELEVENLABS_API_KEY, process.env.ELEVENLABS_VOICE_ID, './public/audio');
      audioPath = audioPath ? `/audio/${path.basename(audioPath)}` : null;
    }

    res.json({ text, intent, audioPath, sessionActive: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/call/respond', async (req, res) => {
  const { contactId, message } = req.body;
  const session = activeSessions.get(contactId);
  if (!session) return res.status(404).json({ error: 'No active session' });

  try {
    session.transcript.push({ role: 'student', text: message, time: new Date().toISOString() });

    const { text, intent } = await continueConversation(session.chat, message);
    session.transcript.push({ role: 'aria', text, time: new Date().toISOString() });
    session.intent = intent;

    let audioPath = null;
    if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY !== 'your_elevenlabs_api_key_here') {
      audioPath = await speak(text, process.env.ELEVENLABS_API_KEY, process.env.ELEVENLABS_VOICE_ID, './public/audio');
      audioPath = audioPath ? `/audio/${path.basename(audioPath)}` : null;
    }

    res.json({ text, intent, audioPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/call/end', (req, res) => {
  const { contactId, status, rsvp, notes } = req.body;
  const session = activeSessions.get(contactId);
  const contact = contacts.find(c => c.id === contactId);

  if (contact) {
    contact.status = status || 'called';
    contact.rsvp = rsvp || false;
    contact.calledAt = new Date().toISOString();
    contact.notes = notes || (session ? session.transcript.map(t => `[${t.role}]: ${t.text}`).join('\n') : '');
  }

  activeSessions.delete(contactId);
  saveResults(contacts, RESULTS_FILE);

  broadcastStats();
  res.json({ success: true, stats: getStats(contacts) });
});

// WebSocket Broadcasting
function broadcastStats() {
  const stats = getStats(contacts);
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify({ type: 'stats_update', stats }));
    }
  });
}

function broadcastAutomationUpdate(update) {
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify({ type: 'automation_update', ...update }));
    }
  });
}

// WebSocket Connection Handling — routes by path:
//   /ws/voicebot  → Exotel AgentStream VoiceBot (real phone calls)
//   anything else → Dashboard browser client
wss.on('connection', (ws, req) => {
  const url = req.url || '';

  if (url.startsWith('/ws/voicebot')) {
    handleVoiceBotConnection(ws, req);
  } else {
    handleDashboardConnection(ws);
  }
});

// ── Dashboard WebSocket clients ──────────────────────────────────────────────
function handleDashboardConnection(ws) {
  console.log('📱 Dashboard client connected');

  ws.send(JSON.stringify({
    type: 'connection_status',
    automationEnabled,
    timestamp: new Date().toISOString()
  }));

  if (automationEnabled && queueProcessor) {
    ws.send(JSON.stringify({
      type: 'automation_status',
      status: queueProcessor.getProgressStats()
    }));
  }

  ws.on('close', () => {
    console.log('📱 Dashboard client disconnected');
  });
}

// ── Exotel AgentStream VoiceBot ──────────────────────────────────────────────
// Exotel sends: { event: "start"|"media"|"stop", ... }
// We send back: { event: "media", media: { payload: "<base64 ulaw_8000>" } }
//
// Audio pipeline per turn (~800ms latency target):
//   Exotel PCM chunks → buffer → STT (Gemini) → Gemini chat → ElevenLabs TTS
//   → ffmpeg ulaw_8000 encode → base64 chunks → Exotel

const voiceBotSessions = new Map(); // callSid → session

async function handleVoiceBotConnection(ws, req) {
  console.log('📞 [VoiceBot] AgentStream WebSocket connected');

  let callSid = null;
  let session = null;

  // Audio accumulation buffer — collect chunks until user stops speaking
  let audioChunks = [];
  let silenceTimer = null;
  const SILENCE_MS = 700; // wait 700ms after last chunk before processing

  async function processAccumulatedAudio() {
    if (audioChunks.length === 0) return;

    const rawBuffer = Buffer.concat(audioChunks.map(b64 => Buffer.from(b64, 'base64')));
    audioChunks = [];

    if (!session) return;

    console.log(`🎙️  [VoiceBot] Processing ${Math.round(rawBuffer.length / 16)}ms of audio`);

    try {
      // STT — Gemini transcription of raw PCM WAV
      // Wrap raw PCM in a minimal WAV header for Gemini
      const wavBuffer = pcmToWav(rawBuffer, 8000, 1, 16);
      const sttResult = await transcribe(wavBuffer, 'auto');
      const userText = sttResult.text?.trim();

      if (!userText) {
        console.log('🔇 [VoiceBot] Silence/empty — not responding');
        return;
      }

      console.log(`👂 [VoiceBot] User said: "${userText}"`);

      // Update language
      if (sttResult.language) session.language = sttResult.language;

      // Send "clear" to stop any currently playing audio (barge-in)
      wsSend(ws, { event: 'clear' });

      // Gemini response via generic agent engine
      const aiResult = await agentContinueCall(session.aiChat, userText, session.callType || 'outbound_lead');
      const aiText = aiResult.text || 'I see. How can I help you further?';
      const intent = aiResult.intent;

      console.log(`🤖 [VoiceBot] AI response: "${aiText.substring(0, 80)}..."`);

      // TTS → ulaw_8000 for Exotel
      const mp3Buffer = await voiceEngine.streamVoiceToBuffer(aiText, session.language);
      const ulawBuffer = await transcodeToUlaw(mp3Buffer);

      // Stream audio back in 3200-byte chunks (100ms at 8kHz ulaw)
      const CHUNK_SIZE = 3200;
      for (let i = 0; i < ulawBuffer.length; i += CHUNK_SIZE) {
        const chunk = ulawBuffer.slice(i, i + CHUNK_SIZE);
        wsSend(ws, { event: 'media', media: { payload: chunk.toString('base64') } });
      }

      // End call on terminal intents
      const terminalIntents = ['rsvp_yes', 'rsvp_no', 'not_interested', 'goodbye', 'end_call'];
      if (terminalIntents.includes(intent)) {
        console.log(`📞 [VoiceBot] Ending call — intent: ${intent}`);
        wsSend(ws, { event: 'stop' });
        ws.close();
      }

    } catch (err) {
      console.error('❌ [VoiceBot] Pipeline error:', err.message);
    }
  }

  ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    switch (msg.event) {
      case 'start': {
        callSid = msg.start?.callSid || msg.callSid || `vb_${Date.now()}`;
        let aiResult = null;
        // Use active business if available
        if (businessManager) {
          const biz = businessManager.getActiveBusiness();
          if (biz) {
            const knowledge = businessManager.getKnowledge(biz.id);
            const callType = biz.call_types?.[0] || 'outbound_lead';
            aiResult = await agentStartCall(biz, callType, biz.default_language, knowledge).catch(e => {
              console.error('❌ [VoiceBot] agentEngine failed:', e.message);
              return null;
            });
            if (aiResult) aiResult._callType = callType;
          }
        }
        if (!aiResult) {
          aiResult = await startMHTCETConversation('en').catch(() => null);
        }

        if (!aiResult) { ws.close(); return; }

        session = { aiChat: aiResult.chat, language: aiResult.language || 'en', callType: aiResult._callType || 'outbound_lead' };
        voiceBotSessions.set(callSid, session);
        console.log(`📞 [VoiceBot] Session started | callSid: ${callSid}`);

        // Send greeting
        const greetingMp3 = await voiceEngine.streamVoiceToBuffer(aiResult.text, 'en');
        const greetingUlaw = await transcodeToUlaw(greetingMp3);
        const CHUNK_SIZE = 3200;
        for (let i = 0; i < greetingUlaw.length; i += CHUNK_SIZE) {
          const chunk = greetingUlaw.slice(i, i + CHUNK_SIZE);
          wsSend(ws, { event: 'media', media: { payload: chunk.toString('base64') } });
        }
        break;
      }

      case 'media': {
        if (!msg.media?.payload) break;
        audioChunks.push(msg.media.payload);

        // Reset silence timer — process when user stops speaking
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(processAccumulatedAudio, SILENCE_MS);
        break;
      }

      case 'stop': {
        console.log(`📞 [VoiceBot] Call ended | callSid: ${callSid}`);
        if (silenceTimer) clearTimeout(silenceTimer);
        if (callSid) voiceBotSessions.delete(callSid);
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log(`📞 [VoiceBot] WebSocket closed | callSid: ${callSid}`);
    if (silenceTimer) clearTimeout(silenceTimer);
    if (callSid) voiceBotSessions.delete(callSid);
  });

  ws.on('error', (err) => {
    console.error('❌ [VoiceBot] WebSocket error:', err.message);
  });
}

function wsSend(ws, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

// Wrap raw PCM bytes in a WAV container header
function pcmToWav(pcmBuffer, sampleRate, channels, bitsPerSample) {
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28); header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36); header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuffer]);
}

// Transcode MP3 buffer → ulaw_8000 mono buffer using ffmpeg
function transcodeToUlaw(mp3Buffer) {
  return new Promise((resolve, reject) => {
    const tmpIn = path.join(tmpdir(), `vb_in_${randomBytes(4).toString('hex')}.mp3`);
    const tmpOut = path.join(tmpdir(), `vb_out_${randomBytes(4).toString('hex')}.raw`);

    try { fs.writeFileSync(tmpIn, mp3Buffer); } catch (e) { return reject(e); }

    ffmpegLib(tmpIn)
      .audioCodec('pcm_mulaw')
      .audioChannels(1)
      .audioFrequency(8000)
      .format('mulaw')
      .output(tmpOut)
      .on('end', () => {
        try {
          const out = fs.readFileSync(tmpOut);
          try { fs.unlinkSync(tmpIn); fs.unlinkSync(tmpOut); } catch {}
          resolve(out);
        } catch (e) { reject(e); }
      })
      .on('error', (e) => {
        try { fs.unlinkSync(tmpIn); } catch {}
        reject(e);
      })
      .run();
  });
}

// Serve dashboard HTML
app.get('/', (req, res) => {
  res.sendFile(path.resolve('./public/index.html'));
});

// ── BUSINESS MANAGEMENT API ───────────────────────────────────────────────────

// GET  /api/businesses          — list all businesses
app.get('/api/businesses', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'Not initialized' });
  res.json({ businesses: businessManager.listBusinesses() });
});

// GET  /api/businesses/active   — get the currently active business
app.get('/api/businesses/active', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'Not initialized' });
  const biz = businessManager.getActiveBusiness();
  if (!biz) return res.status(404).json({ error: 'No active business' });
  res.json(biz);
});

// POST /api/businesses          — create new business
app.post('/api/businesses', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'Not initialized' });
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const biz = businessManager.createBusiness(req.body);
    res.status(201).json(biz);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET  /api/businesses/:id      — get a single business + its knowledge base
app.get('/api/businesses/:id', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'Not initialized' });
  const biz = businessManager.getBusiness(req.params.id);
  if (!biz) return res.status(404).json({ error: 'Business not found' });
  const knowledge = businessManager.getKnowledge(req.params.id);
  res.json({ ...biz, knowledge });
});

// PUT  /api/businesses/:id      — update business fields
app.put('/api/businesses/:id', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'Not initialized' });
  const biz = businessManager.updateBusiness(req.params.id, req.body);
  if (!biz) return res.status(404).json({ error: 'Business not found' });
  res.json(biz);
});

// POST /api/businesses/:id/activate  — set as active business
app.post('/api/businesses/:id/activate', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'Not initialized' });
  const biz = businessManager.setActiveBusiness(req.params.id);
  if (!biz) return res.status(404).json({ error: 'Business not found' });
  console.log(`🏢 Active business switched to: ${biz.name}`);
  res.json({ success: true, business: biz });
});

// DELETE /api/businesses/:id    — delete business and all its knowledge
app.delete('/api/businesses/:id', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'Not initialized' });
  businessManager.deleteBusiness(req.params.id);
  res.json({ success: true });
});

// ── Knowledge base CRUD ────────────────────────────────────────────────────────

// GET  /api/businesses/:id/knowledge           — list all KB entries
app.get('/api/businesses/:id/knowledge', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'Not initialized' });
  const { category } = req.query;
  const entries = businessManager.getKnowledge(req.params.id, category || null);
  res.json({ entries });
});

// GET  /api/businesses/:id/knowledge/search    — search KB
app.get('/api/businesses/:id/knowledge/search', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'Not initialized' });
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q param required' });
  const results = businessManager.searchKnowledge(req.params.id, q);
  res.json({ results });
});

// POST /api/businesses/:id/knowledge           — add KB entry
app.post('/api/businesses/:id/knowledge', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'Not initialized' });
  const { title, content, category, tags, priority } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'title and content required' });
  const entry = businessManager.addKnowledge(req.params.id, { category, title, content, tags, priority });
  res.status(201).json(entry);
});

// PUT  /api/knowledge/:entryId                 — update KB entry
app.put('/api/knowledge/:entryId', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'Not initialized' });
  businessManager.updateKnowledge(req.params.entryId, req.body);
  res.json({ success: true });
});

// DELETE /api/knowledge/:entryId               — delete KB entry
app.delete('/api/knowledge/:entryId', (req, res) => {
  if (!businessManager) return res.status(503).json({ error: 'Not initialized' });
  businessManager.deleteKnowledge(req.params.entryId);
  res.json({ success: true });
});

// ── EXOTEL WEBHOOK ENDPOINTS ──────────────────────────────────────────────
// These endpoints handle real phone calls via Exotel cloud telephony

app.use(express.urlencoded({ extended: true })); // For Exotel form data

// Webhook: Landing Flow Passthru — returns 200 with non-XML so Exotel falls back
// to Landing Flow's Connect applet, which dials the student.
app.all('/webhook/exotel-passthru-notify', (req, res) => {
  const callSid = req.body.CallSid || req.query.CallSid;
  console.log(`📡 Passthru fired | callSid: ${callSid} | returning plain 200 to trigger Landing Flow fallback`);
  res.status(200).send('OK');
});

// Webhook: Agent-side gather after passthru (student answered or gather timed out)
app.all('/webhook/exotel-agent-gather', (req, res) => {
  console.log('📡 Agent gather callback:', req.body.CallSid || req.query.CallSid);
  res.set('Content-Type', 'application/xml');
  res.send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
});

// Webhook: Called when student answers the phone (Exotel sends GET or POST)
app.all('/webhook/exotel-call-connect', async (req, res) => {
  const callSid = req.body.CallSid || req.query.CallSid;
  console.log('🔗 Exotel call connected:', callSid, '| method:', req.method);
  console.log('   body:', req.body, '| query:', req.query);

  if (exotelCaller) {
    await exotelCaller.handleCallConnect(callSid, req, res);
  } else {
    res.status(503).send('Exotel caller not initialized');
  }
});

// Webhook: Recording complete — STT → Gemini → TTS → continue call
// Exotel POSTs RecordingUrl, CallSid, RecordingDuration here after <Record> finishes
app.all('/webhook/exotel-recording', async (req, res) => {
  const callSid = req.body.CallSid || req.query.CallSid;
  const recordingUrl = req.body.RecordingUrl || req.query.RecordingUrl;
  console.log(`🎙️  Recording webhook | callSid: ${callSid} | url: ${recordingUrl}`);

  if (!callSid) {
    console.warn('⚠️  /webhook/exotel-recording called without CallSid');
    return res.status(400).send('Missing CallSid');
  }

  if (exotelCaller) {
    await exotelCaller.handleRecording(callSid, recordingUrl, req, res);
  } else {
    res.status(503).set('Content-Type', 'application/xml').send(
      '<?xml version="1.0"?><Response><Say>Service unavailable</Say><Hangup/></Response>'
    );
  }
});

// Webhook: Handles call timeouts (no speech within RECORD_TIMEOUT seconds)
app.all('/webhook/exotel-timeout', async (req, res) => {
  const callSid = req.body.CallSid || req.query.CallSid;
  console.log(`⏰ Exotel timeout | callSid: ${callSid}`);

  if (exotelCaller) {
    await exotelCaller.handleTimeout(callSid, req, res);
  } else {
    res.set('Content-Type', 'application/xml').send(
      '<?xml version="1.0"?><Response><Say>Thank you, goodbye!</Say><Hangup/></Response>'
    );
  }
});

// Webhook: Call status updates (answered, completed, failed, etc.)
app.all('/webhook/exotel-call-status', (req, res) => {
  const callSid = req.body.CallSid || req.query.CallSid;
  const callStatus = req.body.CallStatus || req.query.CallStatus;
  const callDuration = req.body.CallDuration || req.query.CallDuration;
  console.log(`📊 Call ${callSid || 'unknown'} — status: ${callStatus}, duration: ${callDuration || 0}s`);

  if (exotelCaller) {
    exotelCaller.handleCallStatus(callSid, callStatus, callDuration, req, res);
  } else {
    res.status(200).send('OK');
  }
});

// API: Start real outbound call to a student
app.post('/api/exotel/call', async (req, res) => {
  const { phone, name } = req.body;

  if (!exotelCaller) {
    return res.status(503).json({ error: 'Exotel caller not initialized' });
  }

  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  try {
    const call = await exotelCaller.makeCall(phone, name || 'Student');
    res.json({
      success: true,
      callSid: call.Sid,
      message: `Call initiated to ${phone}`,
      status: call.Status
    });
  } catch (error) {
    console.error('❌ Failed to start call:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Start bulk calling campaign
app.post('/api/exotel/bulk-call', async (req, res) => {
  const { contactIds, delayMinutes } = req.body;

  if (!exotelCaller) {
    return res.status(503).json({ error: 'Exotel caller not initialized' });
  }

  if (!contactIds || !Array.isArray(contactIds)) {
    return res.status(400).json({ error: 'Contact IDs array required' });
  }

  try {
    const selectedContacts = contacts.filter(c => contactIds.includes(c.id));
    const delayMs = (delayMinutes || 0.5) * 60 * 1000; // Default 30 seconds between calls

    // Start bulk calling in background
    exotelCaller.startBulkCalling(selectedContacts, delayMs);

    res.json({
      success: true,
      message: `Bulk calling started for ${selectedContacts.length} contacts`,
      contactCount: selectedContacts.length,
      delayBetweenCalls: `${delayMinutes || 0.5} minutes`
    });
  } catch (error) {
    console.error('❌ Failed to start bulk calling:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── END EXOTEL WEBHOOKS ──────────────────────────────────────────────────

// ── WHATSAPP INTEGRATION ──────────────────────────────────────────────────

// Webhook: Handle incoming WhatsApp messages from Twilio
app.post('/webhook/whatsapp', async (req, res) => {
  console.log('📱 WhatsApp webhook received:', req.body);

  const from = req.body.From; // Format: whatsapp:+919876543210
  const body = req.body.Body; // Message text
  const senderName = req.body.ProfileName || 'Student';

  if (!whatsappManager) {
    console.error('❌ WhatsApp manager not initialized');
    return res.status(503).send('WhatsApp not configured');
  }

  try {
    await whatsappManager.handleIncomingMessage(from, body, senderName);
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ WhatsApp webhook error:', error);
    res.status(500).send('Error processing message');
  }
});

// API: Send WhatsApp message to a contact
app.post('/api/whatsapp/send', async (req, res) => {
  const { phone, message, mediaUrl } = req.body;

  if (!whatsappManager) {
    return res.status(503).json({ error: 'WhatsApp not configured' });
  }

  if (!phone || !message) {
    return res.status(400).json({ error: 'Phone number and message required' });
  }

  try {
    const result = await whatsappManager.sendMessage(phone, message, mediaUrl);
    res.json(result);
  } catch (error) {
    console.error('❌ Failed to send WhatsApp:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Send welcome message to a contact
app.post('/api/whatsapp/welcome', async (req, res) => {
  const { phone, name } = req.body;

  if (!whatsappManager) {
    return res.status(503).json({ error: 'WhatsApp not configured' });
  }

  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  try {
    const result = await whatsappManager.sendWelcomeMessage(phone, name);
    res.json(result);
  } catch (error) {
    console.error('❌ Failed to send welcome message:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Send bulk WhatsApp messages
app.post('/api/whatsapp/bulk-send', async (req, res) => {
  const { contactIds, messageTemplate } = req.body;

  if (!whatsappManager) {
    return res.status(503).json({ error: 'WhatsApp not configured' });
  }

  if (!contactIds || !messageTemplate) {
    return res.status(400).json({ error: 'Contact IDs and message template required' });
  }

  try {
    const selectedContacts = contacts.filter(c => contactIds.includes(c.id));
    const results = await whatsappManager.sendBulkMessages(selectedContacts, messageTemplate);

    res.json({
      success: true,
      ...results,
      totalContacts: selectedContacts.length
    });
  } catch (error) {
    console.error('❌ Failed to send bulk WhatsApp:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Get active WhatsApp chats
app.get('/api/whatsapp/active-chats', (req, res) => {
  if (!whatsappManager) {
    return res.status(503).json({ error: 'WhatsApp not configured' });
  }

  try {
    const activeSessions = whatsappManager.getAllActiveSessions();
    res.json({
      count: whatsappManager.getActiveChatsCount(),
      sessions: activeSessions
    });
  } catch (error) {
    console.error('❌ Failed to get active chats:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Clear WhatsApp chat session
app.post('/api/whatsapp/clear-session', (req, res) => {
  const { phone } = req.body;

  if (!whatsappManager) {
    return res.status(503).json({ error: 'WhatsApp not configured' });
  }

  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  try {
    const cleared = whatsappManager.clearChatSession(phone);
    res.json({
      success: cleared,
      message: cleared ? 'Session cleared' : 'No active session found'
    });
  } catch (error) {
    console.error('❌ Failed to clear session:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── END WHATSAPP INTEGRATION ──────────────────────────────────────────────

// ── INBOUND CALL SYSTEM ───────────────────────────────────────────────────

/**
 * Start inbound call conversation
 * POST /api/inbound/start
 * Body: { callSid, callerNumber }
 */
app.post('/api/inbound/start', async (req, res) => {
  const { callSid, callerNumber } = req.body;

  if (!callSid || !callerNumber) {
    return res.status(400).json({ error: 'callSid and callerNumber are required' });
  }

  try {
    const greeting = await inboundOrchestrator.startConversation(callSid, callerNumber);

    // Generate TTS audio
    let audioPath = null;
    if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY !== 'your_elevenlabs_api_key_here') {
      audioPath = await speak(greeting, process.env.ELEVENLABS_API_KEY, getVoiceId('en'), './public/audio');
      audioPath = audioPath ? `/audio/${path.basename(audioPath)}` : null;
    }

    res.json({
      success: true,
      callSid,
      text: greeting,
      audioPath,
      language: 'en',
    });
  } catch (error) {
    console.error('❌ Inbound start error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Process user message in inbound call
 * POST /api/inbound/respond
 * Body: { callSid, message, language }
 */
app.post('/api/inbound/respond', async (req, res) => {
  const { callSid, message, language } = req.body;

  if (!callSid || !message) {
    return res.status(400).json({ error: 'callSid and message are required' });
  }

  try {
    const response = await inboundOrchestrator.processMessage(callSid, message);

    // Generate TTS audio
    let audioPath = null;
    if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY !== 'your_elevenlabs_api_key_here') {
      const detectedLang = language || 'en';
      audioPath = await speak(response.text, process.env.ELEVENLABS_API_KEY, getVoiceId(detectedLang), './public/audio');
      audioPath = audioPath ? `/audio/${path.basename(audioPath)}` : null;
    }

    res.json({
      success: true,
      text: response.text,
      audioPath,
      toolCalls: response.toolCalls || [],
      needsEscalation: response.needsEscalation || false,
      escalationData: response.escalationData || null,
    });
  } catch (error) {
    console.error('❌ Inbound respond error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * End inbound call
 * POST /api/inbound/end
 * Body: { callSid }
 */
app.post('/api/inbound/end', async (req, res) => {
  const { callSid } = req.body;

  if (!callSid) {
    return res.status(400).json({ error: 'callSid is required' });
  }

  try {
    const result = await inboundOrchestrator.endConversation(callSid);
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('❌ Inbound end error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get inbound call history
 * GET /api/inbound/history/:callSid
 */
app.get('/api/inbound/history/:callSid', (req, res) => {
  const { callSid } = req.params;

  try {
    const history = inboundOrchestrator.getConversationHistory(callSid);
    res.json({ success: true, history });
  } catch (error) {
    console.error('❌ History fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get knowledge base stats
 * GET /api/inbound/knowledge/stats
 */
app.get('/api/inbound/knowledge/stats', (req, res) => {
  try {
    const stats = kb.getKnowledgeStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('❌ Stats fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Search knowledge base
 * GET /api/inbound/knowledge/search?q=query&category=cet
 */
app.get('/api/inbound/knowledge/search', (req, res) => {
  const { q, category } = req.query;

  if (!q) {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  try {
    const results = kb.searchKnowledge(q, category);
    res.json({ success: true, results });
  } catch (error) {
    console.error('❌ Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get counseling packages
 * GET /api/inbound/packages
 */
app.get('/api/inbound/packages', (req, res) => {
  try {
    const packages = kb.getCounselingPackages();
    res.json({ success: true, packages });
  } catch (error) {
    console.error('❌ Packages fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get upcoming events
 * GET /api/inbound/events
 */
app.get('/api/inbound/events', (req, res) => {
  const { platform } = req.query;

  try {
    const events = kb.getUpcomingEvents(platform);
    res.json({ success: true, events });
  } catch (error) {
    console.error('❌ Events fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── END INBOUND CALL SYSTEM ───────────────────────────────────────────────

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Gracefully shutting down...');

  if (queueProcessor) {
    await queueProcessor.shutdown();
  }

  if (database) {
    database.close();
  }

  if (languageEngine) {
    await languageEngine.close();
  }

  if (characterManager) {
    await characterManager.close();
  }

  if (voiceEngine) {
    await voiceEngine.close();
  }

  if (whatsappManager) {
    console.log('📱 Closing WhatsApp manager...');
  }

  server.close(() => {
    console.log('✅ Server shut down complete');
    process.exit(0);
  });
});

// Start server
const PORT = process.env.PORT || 3000;

initializeSystems().then(() => {
  server.listen(PORT, () => {
    console.log(`\n🚀 Enhanced Dashboard running at http://localhost:${PORT}`);
    console.log(`📊 Features: ${automationEnabled ? 'Full Automation + Manual Mode' : 'Manual Mode Only'}`);
    console.log(`🌐 Languages: ${automationEnabled ? 'English, Hindi, Marathi' : 'English Only'}`);
    console.log(`📱 Open your browser to access the dashboard\n`);
  });
}).catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
