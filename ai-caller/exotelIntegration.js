// exotelIntegration.js — Exotel telephony integration for Campus Dekho
// Architecture: Webhook Record Loop (Phase 1) — ~3-5s per turn
//   call-connect → Play greeting → Record → POST webhook → STT → Gemini → TTS (8kHz WAV) → Play → Record → ...
// Phase 2 (future): AgentStream WebSocket for ~800ms latency

import https from 'https';
import querystring from 'querystring';
import path from 'path';
import MultilingualVoiceEngine from './voiceEngine.js';
import { startCall, continueCall, parseAgentResponse } from './agentEngine.js';
import { transcribeExotelRecording, detectLanguageFromText } from './sttEngine.js';
import dotenv from 'dotenv';

dotenv.config({ override: true });

const MAX_TURNS = 15;        // end call after N conversation turns
const RECORD_TIMEOUT = 10;   // seconds to wait for speech before timeout
const RECORD_MAX_LENGTH = 30; // max seconds for a single recording

class ExotelCaller {
  // businessManager is optional — if provided, uses active business for calls.
  // If not provided, falls back to a simple default config.
  constructor(businessManager = null) {
    this.accountSid = process.env.EXOTEL_SID;
    this.apiKey = process.env.EXOTEL_API_KEY;
    this.authToken = process.env.EXOTEL_TOKEN;
    this.fromNumber = process.env.EXOTEL_FROM_NUMBER;
    this.baseWebUrl = process.env.BASE_URL || 'http://localhost:3001';
    this.businessManager = businessManager;

    if (!this.accountSid || !this.apiKey || !this.authToken || !this.fromNumber) {
      console.log('⚠️  Exotel credentials missing. Required in .env:');
      console.log('   EXOTEL_SID, EXOTEL_API_KEY, EXOTEL_TOKEN, EXOTEL_FROM_NUMBER');
    }

    // Exotel API auth: apiKey:authToken (NOT SID:TOKEN)
    this.authHeader = 'Basic ' + Buffer.from(`${this.apiKey}:${this.authToken}`).toString('base64');
    this.apiBase = `https://api.exotel.com/v1/Accounts/${this.accountSid}`;

    this.voiceEngine = new MultilingualVoiceEngine();
    this.activeCalls = new Map(); // callSid → session

    console.log('📞 Exotel integration initialized');
  }

  // Resolve active business config + knowledge base
  _getBusinessConfig() {
    if (this.businessManager) {
      const biz = this.businessManager.getActiveBusiness();
      if (biz) {
        const knowledge = this.businessManager.getKnowledge(biz.id);
        return { business: biz, knowledge, callType: biz.call_types?.[0] || 'outbound_lead' };
      }
    }
    // Fallback minimal config when no business manager
    return {
      business: {
        id: 'default',
        name: process.env.BUSINESS_NAME || 'Our Company',
        agent_name: 'Aria',
        description: process.env.BUSINESS_DESC || '',
        call_goal: 'Have a helpful conversation with the caller.',
        default_language: 'en',
        languages: ['en']
      },
      knowledge: [],
      callType: 'outbound_lead'
    };
  }

  // ─── Outbound call initiation ────────────────────────────────────────────────

  async makeCall(studentPhone, studentName = 'Student') {
    if (!this.accountSid) throw new Error('Exotel not configured — missing credentials in .env');

    const callData = querystring.stringify({
      From: this.fromNumber,
      To: studentPhone,
      TimeLimit: '1800',
      TimeOut: '30',
      Url: `${this.baseWebUrl}/webhook/exotel-call-connect`,
      StatusCallback: `${this.baseWebUrl}/webhook/exotel-call-status`,
      StatusCallbackMethod: 'POST',
      Record: 'false' // we handle recording ourselves via <Record> in TwiML
    });

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.exotel.com',
        path: `/v1/Accounts/${this.accountSid}/Calls/connect.json`,
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(callData)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.Call) {
              console.log(`📞 Call initiated to ${studentPhone} — SID: ${result.Call.Sid}`);
              this._createSession(result.Call.Sid, studentPhone, studentName);
              resolve(result.Call);
            } else {
              reject(new Error(`Exotel call failed: ${data}`));
            }
          } catch {
            reject(new Error(`Invalid Exotel response: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(callData);
      req.end();
    });
  }

  // ─── Session management ───────────────────────────────────────────────────────

  _createSession(callSid, studentPhone, studentName = 'Student') {
    this.activeCalls.set(callSid, {
      studentPhone,
      studentName,
      aiChat: null,
      language: 'en',
      turnCount: 0,
      startTime: Date.now()
    });
  }

  _getSession(callSid) {
    return this.activeCalls.get(callSid) || null;
  }

  _deleteSession(callSid) {
    this.activeCalls.delete(callSid);
  }

  // ─── Webhook: call connected ─────────────────────────────────────────────────

  async handleCallConnect(callSid, req, res) {
    console.log(`🔗 Call connected: ${callSid}`);

    // Auto-create session if call was initiated externally (n8n / Exotel dashboard)
    if (!this._getSession(callSid)) {
      const studentName = req.body?.student_name || req.query?.student_name || 'Student';
      const studentPhone = req.body?.To || req.body?.CallTo || 'unknown';
      console.log(`📲 External call — creating session for ${studentName} (${studentPhone})`);
      this._createSession(callSid, studentPhone, studentName);
    }

    const session = this._getSession(callSid);

    try {
      // Load active business config and start generic conversation
      const { business, knowledge, callType } = this._getBusinessConfig();
      const aiResult = await startCall(business, callType, business.default_language, knowledge);

      session.aiChat = aiResult.chat;
      session.language = aiResult.language || business.default_language;
      session.callType = callType;

      // Generate greeting as 8kHz WAV for Exotel
      const { webUrl } = await this.voiceEngine.speakForPhone(aiResult.text, session.language);

      console.log(`🏢 Call using business: ${business.name} | type: ${callType}`);
      res.set('Content-Type', 'application/xml');
      res.send(this._buildRecordXml(webUrl));

    } catch (err) {
      console.error('❌ handleCallConnect error:', err.message);
      this._sendEndXml(res, 'Sorry, we are experiencing technical difficulties. Please try again later.');
      this._deleteSession(callSid);
    }
  }

  // ─── Webhook: recording complete → STT → Gemini → TTS ────────────────────────

  async handleRecording(callSid, recordingUrl, req, res) {
    const session = this._getSession(callSid);

    if (!session || !session.aiChat) {
      console.warn(`⚠️  No session for callSid ${callSid} — ending call`);
      return this._sendEndXml(res);
    }

    // Turn limit guard
    session.turnCount++;
    if (session.turnCount > MAX_TURNS) {
      console.log(`🔚 Turn limit reached for ${callSid}`);
      const { webUrl } = await this.voiceEngine.speakForPhone(
        'It was great speaking with you! We look forward to seeing you at the event. Have a wonderful day!',
        session.language
      ).catch(() => ({ webUrl: null }));
      this._sendEndXml(res, null, webUrl);
      this._deleteSession(callSid);
      return;
    }

    console.log(`🎙️  Recording received for ${callSid} (turn ${session.turnCount}/${MAX_TURNS})`);

    try {
      // Download and transcribe the recording
      const sttResult = await transcribeExotelRecording(recordingUrl, 'auto');
      const userText = sttResult.text?.trim();

      // Update detected language
      if (sttResult.language && sttResult.language !== 'auto') {
        session.language = sttResult.language;
      }

      console.log(`👂 [${session.language.toUpperCase()}] Student said: "${userText || '(silence)'}"`);

      // Handle silence/empty transcription — re-prompt
      if (!userText) {
        const prompt = session.language === 'hi'
          ? 'क्षमा करें, मुझे आपकी बात सुनाई नहीं दी। कृपया दोबारा बोलें।'
          : session.language === 'mr'
          ? 'माफ करा, मला तुमचे ऐकू आले नाही. कृपया पुन्हा सांगा.'
          : 'Sorry, I could not hear you. Please speak after the beep.';

        const { webUrl } = await this.voiceEngine.speakForPhone(prompt, session.language);
        res.set('Content-Type', 'application/xml');
        res.send(this._buildRecordXml(webUrl));
        return;
      }

      // Get Gemini response via generic agent engine
      const aiResult = await continueCall(session.aiChat, userText, session.callType || 'outbound_lead');
      const aiText = aiResult.text || 'I see. Let me help you with that.';
      const intent = aiResult.intent;

      // Update language if detected from AI response
      if (aiResult.language) session.language = aiResult.language;

      // Generate phone-compatible TTS
      const { webUrl } = await this.voiceEngine.speakForPhone(aiText, session.language);

      // End call when agent says conversation is done
      if (!aiResult.continue) {
        console.log(`📞 Ending call — intent: ${intent}`);
        this._sendEndXml(res, null, webUrl);
        this._deleteSession(callSid);
        return;
      }

      // Continue conversation
      res.set('Content-Type', 'application/xml');
      res.send(this._buildRecordXml(webUrl));

    } catch (err) {
      console.error(`❌ handleRecording error for ${callSid}:`, err.message);
      const errMsg = 'Sorry, something went wrong. Please call us back and we will assist you.';
      this._sendEndXml(res, errMsg);
      this._deleteSession(callSid);
    }
  }

  // ─── Webhook: timeout (no speech detected) ───────────────────────────────────

  async handleTimeout(callSid, req, res) {
    console.log(`⏰ Timeout for call: ${callSid}`);
    const session = this._getSession(callSid);

    const timeoutMsg = session?.language === 'hi'
      ? 'आपसे बात करके अच्छा लगा। अगर आप चाहें तो हमें वापस कॉल करें। धन्यवाद!'
      : session?.language === 'mr'
      ? 'तुमच्याशी बोलून छान वाटले. आम्हाला परत कॉल करा. धन्यवाद!'
      : 'Thank you for your time. Feel free to call us back anytime. Goodbye!';

    this._sendEndXml(res, timeoutMsg);
    this._deleteSession(callSid);
  }

  // ─── Webhook: call status update ─────────────────────────────────────────────

  handleCallStatus(callSid, callStatus, callDuration, req, res) {
    console.log(`📊 Call ${callSid || 'unknown'} — status: ${callStatus}, duration: ${callDuration || 0}s`);

    if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(callStatus)) {
      this._deleteSession(callSid);
    }

    res.status(200).send('OK');
  }

  // ─── TwiML builders ───────────────────────────────────────────────────────────

  // Plays audio then starts recording next user input
  _buildRecordXml(audioUrl) {
    const recordWebhook = `${this.baseWebUrl}/webhook/exotel-recording`;
    const timeoutWebhook = `${this.baseWebUrl}/webhook/exotel-timeout`;

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n`;

    if (audioUrl) {
      xml += `  <Play>${audioUrl}</Play>\n`;
    }

    xml += `  <Record action="${recordWebhook}" method="POST"
    timeout="${RECORD_TIMEOUT}"
    maxLength="${RECORD_MAX_LENGTH}"
    playBeep="false"
    finishOnKey="#"/>\n`;

    xml += `  <Redirect method="POST">${timeoutWebhook}</Redirect>\n`;
    xml += `</Response>`;

    return xml;
  }

  // End call — optionally play a goodbye message or a pre-generated audio URL
  _sendEndXml(res, textMessage = null, audioUrl = null) {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n`;

    if (audioUrl) {
      xml += `  <Play>${audioUrl}</Play>\n`;
    } else if (textMessage) {
      xml += `  <Say voice="woman" language="en">${textMessage}</Say>\n`;
    }

    xml += `  <Hangup/>\n</Response>`;

    res.set('Content-Type', 'application/xml');
    res.send(xml);
  }

  // ─── Bulk calling ─────────────────────────────────────────────────────────────

  async startBulkCalling(contacts, delayBetweenCalls = 30000) {
    console.log(`🚀 Starting bulk calling — ${contacts.length} contacts`);

    const results = [];
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      try {
        const call = await this.makeCall(contact.phone, contact.name);
        console.log(`✅ Call ${i + 1}/${contacts.length} initiated to ${contact.phone}`);
        results.push({ phone: contact.phone, callSid: call.Sid, status: 'initiated' });
      } catch (err) {
        console.error(`❌ Failed to call ${contact.phone}:`, err.message);
        results.push({ phone: contact.phone, status: 'failed', error: err.message });
      }

      if (i < contacts.length - 1) {
        await new Promise(r => setTimeout(r, delayBetweenCalls));
      }
    }

    return results;
  }

  async close() {
    await this.voiceEngine.close();
  }
}

export default ExotelCaller;
