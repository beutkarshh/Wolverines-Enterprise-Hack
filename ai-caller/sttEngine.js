// sttEngine.js — Speech-to-text engine
// Primary: Gemini multimodal (reuses existing API key, no extra cost)
// Fallback: Sarvam AI Saarika v2.5 (best for Hindi/Marathi telephony, ₹30/hr)

import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config({ override: true });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Language hint map for better accuracy
const LANGUAGE_HINTS = {
  en: 'English (Indian accent)',
  hi: 'Hindi (Devanagari script)',
  mr: 'Marathi (Devanagari script)',
  auto: 'Hindi, Marathi, or English — detect automatically'
};

// Gemini model for audio transcription
const GEMINI_AUDIO_MODEL = 'gemini-2.5-flash';

/**
 * Transcribe an audio file using Gemini multimodal.
 * Accepts: MP3, WAV, OGG, FLAC, M4A, WEBM
 * Returns: { text, language, confidence }
 */
export async function transcribeWithGemini(audioPathOrBuffer, language = 'auto') {
  try {
    const model = genAI.getGenerativeModel({ model: GEMINI_AUDIO_MODEL });

    let audioData;
    let mimeType;

    if (Buffer.isBuffer(audioPathOrBuffer)) {
      audioData = audioPathOrBuffer.toString('base64');
      mimeType = 'audio/wav'; // assume WAV for raw buffers from Exotel
    } else {
      const ext = path.extname(audioPathOrBuffer).toLowerCase();
      const mimeMap = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.flac': 'audio/flac',
        '.m4a': 'audio/mp4',
        '.webm': 'audio/webm',
        '.aac': 'audio/aac'
      };
      mimeType = mimeMap[ext] || 'audio/wav';
      const fileBuffer = fs.readFileSync(audioPathOrBuffer);
      audioData = fileBuffer.toString('base64');
    }

    const langHint = LANGUAGE_HINTS[language] || LANGUAGE_HINTS.auto;

    const prompt = language === 'auto'
      ? `Transcribe this audio exactly as spoken. The speaker may use Hindi, Marathi, or English (or a mix). Return ONLY the transcribed text, nothing else. If the audio is silent or unclear, return empty string.`
      : `Transcribe this audio exactly as spoken in ${langHint}. Return ONLY the transcribed text, nothing else. If the audio is silent or unclear, return empty string.`;

    const result = await model.generateContent([
      { inlineData: { data: audioData, mimeType } },
      prompt
    ]);

    const text = result.response.text().trim();

    // Detect language from transcription
    const detectedLang = detectLanguageFromText(text);

    console.log(`🎙️ [Gemini STT] Transcribed (${detectedLang}): "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);

    return { text, language: detectedLang, confidence: 0.9, engine: 'gemini' };

  } catch (err) {
    console.error('❌ Gemini STT failed:', err.message);
    throw err;
  }
}

/**
 * Transcribe using Sarvam AI Saarika v2.5 — best for Indian languages + telephony 8kHz audio.
 * Requires SARVAM_API_KEY in .env
 */
export async function transcribeWithSarvam(audioPathOrBuffer, language = 'auto') {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) throw new Error('SARVAM_API_KEY not set in .env');

  try {
    let audioBuffer;
    let filename;

    if (Buffer.isBuffer(audioPathOrBuffer)) {
      audioBuffer = audioPathOrBuffer;
      filename = 'audio.wav';
    } else {
      audioBuffer = fs.readFileSync(audioPathOrBuffer);
      filename = path.basename(audioPathOrBuffer);
    }

    // Map language codes
    const langMap = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', auto: 'unknown' };
    const sarvamLang = langMap[language] || 'unknown';

    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/wav' });
    formData.append('file', blob, filename);
    formData.append('model', 'saarika:v2.5');
    if (sarvamLang !== 'unknown') formData.append('language_code', sarvamLang);
    formData.append('with_timestamps', 'false');
    formData.append('with_disfluencies', 'false');

    const response = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: { 'api-subscription-key': apiKey },
      body: formData
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Sarvam STT error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const text = data.transcript || '';
    const detectedLang = data.language_code?.split('-')[0] || detectLanguageFromText(text);

    console.log(`🎙️ [Sarvam STT] Transcribed (${detectedLang}): "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);

    return { text, language: detectedLang, confidence: 0.95, engine: 'sarvam' };

  } catch (err) {
    console.error('❌ Sarvam STT failed:', err.message);
    throw err;
  }
}

/**
 * Main transcription function — tries Gemini first, falls back to Sarvam if available.
 * For telephony (Exotel recordings): audio is typically 8kHz WAV mono.
 */
export async function transcribe(audioPathOrBuffer, language = 'auto') {
  // Try Gemini first (no extra API cost)
  try {
    return await transcribeWithGemini(audioPathOrBuffer, language);
  } catch (geminiErr) {
    console.warn('⚠️ Gemini STT failed, trying Sarvam...', geminiErr.message);

    // Fallback to Sarvam if key available
    if (process.env.SARVAM_API_KEY) {
      try {
        return await transcribeWithSarvam(audioPathOrBuffer, language);
      } catch (sarvamErr) {
        console.error('❌ Both STT engines failed');
        throw new Error(`STT failed — Gemini: ${geminiErr.message} | Sarvam: ${sarvamErr.message}`);
      }
    }

    throw geminiErr;
  }
}

/**
 * Download a recording from Exotel and transcribe it.
 * Exotel recording URLs require Basic Auth: AccountSid:AuthToken
 */
export async function transcribeExotelRecording(recordingUrl, language = 'auto') {
  const accountSid = process.env.EXOTEL_ACCOUNT_SID;
  const authToken = process.env.EXOTEL_AUTH_TOKEN;

  if (!accountSid || !authToken) throw new Error('EXOTEL_ACCOUNT_SID or EXOTEL_AUTH_TOKEN not set');

  console.log(`📥 Downloading Exotel recording...`);

  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const response = await fetch(recordingUrl, {
    headers: { Authorization: `Basic ${credentials}` }
  });

  if (!response.ok) {
    throw new Error(`Failed to download Exotel recording (${response.status}): ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = Buffer.from(arrayBuffer);

  console.log(`📥 Downloaded ${Math.round(audioBuffer.length / 1024)}KB audio`);

  return transcribe(audioBuffer, language);
}

/**
 * Heuristic language detection from transcribed text.
 * Checks Unicode ranges for Devanagari script.
 */
export function detectLanguageFromText(text) {
  if (!text) return 'en';

  const devanagariChars = (text.match(/[ऀ-ॿ]/g) || []).length;
  const totalChars = text.replace(/\s/g, '').length;

  if (totalChars === 0) return 'en';

  const devanagariRatio = devanagariChars / totalChars;

  if (devanagariRatio > 0.3) {
    // Marathi-specific words/characters
    const marathiMarkers = /\b(आहे|आणि|मला|तुम्ही|काय|नाही|हो|ठीक|धन्यवाद|मराठी)\b/;
    if (marathiMarkers.test(text)) return 'mr';
    return 'hi'; // Default Devanagari to Hindi
  }

  return 'en';
}

export default {
  transcribe,
  transcribeWithGemini,
  transcribeWithSarvam,
  transcribeExotelRecording,
  detectLanguageFromText
};
