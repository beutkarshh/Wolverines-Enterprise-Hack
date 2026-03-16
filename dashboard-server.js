// dashboard-server.js — Enhanced Express + WebSocket server with automation controls and multilingual monitoring

import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { initGemini, startConversation, continueConversation, getSeminarDetails, startMHTCETConversation, continueMHTCETConversation } from './geminiEngine.js';
import { speak } from './voiceEngine.js';
import { loadContacts, saveResults, getStats } from './contactQueue.js';
import QueueProcessor from './queueProcessor.js';
import AICallerDatabase from './database.js';
import LanguageEngine from './languageEngine.js';
import CharacterManager from './characterManager.js';
import MultilingualVoiceEngine from './voiceEngine.js';
import TwilioCallManager from './twilioIntegration.js';
import ExotelCaller from './exotelIntegration.js';
import fs from 'fs';
import path from 'path';

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
let automationEnabled = false;

// Initialize Systems
async function initializeSystems() {
  console.log('🚀 Initializing enhanced dashboard systems...');

  // Initialize legacy system
  initGemini(process.env.GEMINI_API_KEY);

  // Initialize new automation components
  try {
    database = new AICallerDatabase();
    languageEngine = new LanguageEngine();
    characterManager = new CharacterManager();
    voiceEngine = new MultilingualVoiceEngine();
    exotelCaller = new ExotelCaller();

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
    const preferredLanguage = req.body?.language || 'en';  // language selected before call
    const { chat, text, intent, language } = await startMHTCETConversation(preferredLanguage);

    outboundSessions.set(sessionId, {
      chat,
      transcript: [{ role: 'priya', text, time: new Date().toISOString() }],
      language: language || 'en',
      startTime: new Date().toISOString(),
    });

    let audioPath = null;
    if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY !== 'your_elevenlabs_api_key_here') {
      audioPath = await speak(text, process.env.ELEVENLABS_API_KEY, getVoiceId(preferredLanguage), './public/audio');
      audioPath = audioPath ? `/audio/${path.basename(audioPath)}` : null;
    }

    res.json({ sessionId, text, intent, audioPath, language: language || 'en' });
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

    const { text, intent, language: detectedLang } = await continueMHTCETConversation(session.chat, messageForGemini);
    session.transcript.push({ role: 'priya', text, time: new Date().toISOString() });
    // Trust user-selected language over auto-detected if explicitly set
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

// WebSocket Connection Handling
wss.on('connection', (ws) => {
  console.log('📱 Dashboard client connected');

  // Send initial status
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
});

// Serve dashboard HTML
app.get('/', (req, res) => {
  res.sendFile(path.resolve('./public/index.html'));
});

// ── EXOTEL WEBHOOK ENDPOINTS ──────────────────────────────────────────────
// These endpoints handle real phone calls via Exotel cloud telephony

app.use(express.urlencoded({ extended: true })); // For Exotel form data

// Webhook: Called when student answers the phone
app.post('/webhook/exotel-call-connect', async (req, res) => {
  console.log('🔗 Exotel call connected:', req.body);
  const callSid = req.body.CallSid;

  if (exotelCaller) {
    await exotelCaller.handleCallConnect(callSid, req, res);
  } else {
    res.status(503).send('Exotel caller not initialized');
  }
});

// Webhook: Handles student input (DTMF digits or speech)
app.post('/webhook/exotel-gather', async (req, res) => {
  console.log('👂 Exotel gather input:', req.body);
  const callSid = req.body.CallSid;
  const digits = req.body.Digits;
  const speechResult = req.body.SpeechResult;

  if (exotelCaller) {
    await exotelCaller.handleGather(callSid, digits, speechResult, req, res);
  } else {
    res.status(503).send('Exotel caller not initialized');
  }
});

// Webhook: Handles call timeouts
app.post('/webhook/exotel-timeout', async (req, res) => {
  console.log('⏰ Exotel call timeout:', req.body);
  const callSid = req.body.CallSid;

  if (exotelCaller) {
    exotelCaller.handleTimeout(callSid, req, res);
  } else {
    res.status(503).send('Exotel caller not initialized');
  }
});

// Webhook: Call status updates (answered, completed, failed, etc.)
app.post('/webhook/exotel-call-status', (req, res) => {
  console.log('📊 Exotel call status update:', req.body);
  const callSid = req.body.CallSid;
  const callStatus = req.body.CallStatus;
  const callDuration = req.body.CallDuration;

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
