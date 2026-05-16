/**
 * Campus Dekho - Twilio WhatsApp Service
 * Handles sending WhatsApp messages via Twilio API
 */

import twilio from 'twilio';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';
const DB_PATH = path.join(__dirname, 'data', 'inbound-knowledge.db');

/**
 * Send WhatsApp message via Twilio
 * @param {string} toNumber - Recipient phone number (E.164 format)
 * @param {string} message - Message content
 * @param {string} callSid - Optional call SID for logging
 * @param {string} mediaUrl - Optional media URL (image/PDF)
 * @returns {Promise<Object>} Result with status and message SID
 */
export async function sendWhatsAppMessage(toNumber, message, callSid = null, mediaUrl = null) {
  try {
    // Ensure number is in WhatsApp format
    const formattedNumber = toNumber.startsWith('whatsapp:')
      ? toNumber
      : `whatsapp:${toNumber.startsWith('+') ? toNumber : '+91' + toNumber}`;

    console.log(`📱 Sending WhatsApp to ${formattedNumber}...`);

    const messageOptions = {
      from: TWILIO_WHATSAPP_FROM,
      to: formattedNumber,
      body: message,
    };

    if (mediaUrl) {
      messageOptions.mediaUrl = [mediaUrl];
    }

    const sentMessage = await twilioClient.messages.create(messageOptions);

    console.log(`✅ WhatsApp sent! SID: ${sentMessage.sid}`);

    // Log to database
    logWhatsAppMessage({
      call_sid: callSid,
      recipient_number: formattedNumber,
      message_content: message,
      media_url: mediaUrl,
      status: 'sent',
      provider_message_id: sentMessage.sid,
    });

    return {
      success: true,
      messageSid: sentMessage.sid,
      status: sentMessage.status,
    };
  } catch (error) {
    console.error('❌ WhatsApp send failed:', error.message);

    // Log failure to database
    logWhatsAppMessage({
      call_sid: callSid,
      recipient_number: toNumber,
      message_content: message,
      media_url: mediaUrl,
      status: 'failed',
      error_message: error.message,
    });

    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Send counseling package details via WhatsApp
 * @param {string} toNumber - Recipient phone number
 * @param {number} packageId - Package ID from database
 * @param {string} callSid - Optional call SID
 * @returns {Promise<Object>}
 */
export async function sendCounselingPackage(toNumber, packageId, callSid = null) {
  const db = new Database(DB_PATH, { readonly: true });

  try {
    const pkg = db.prepare('SELECT * FROM counseling_packages WHERE id = ? AND is_active = 1').get(packageId);

    if (!pkg) {
      throw new Error('Package not found or inactive');
    }

    const message = pkg.whatsapp_message_template ||
      `Hi! Here are the details of our ${pkg.name}:\n\n${pkg.description}\n\nPrice: ₹${pkg.price}\n\nVisit campusdekho.ai for more details.`;

    return await sendWhatsAppMessage(toNumber, message, callSid);
  } catch (error) {
    console.error('❌ Failed to send package:', error.message);
    return { success: false, error: error.message };
  } finally {
    db.close();
  }
}

/**
 * Send event details via WhatsApp
 * @param {string} toNumber - Recipient phone number
 * @param {number} eventId - Event ID from database
 * @param {string} callSid - Optional call SID
 * @returns {Promise<Object>}
 */
export async function sendEventDetails(toNumber, eventId, callSid = null) {
  const db = new Database(DB_PATH, { readonly: true });

  try {
    const event = db.prepare('SELECT * FROM social_events WHERE id = ? AND is_active = 1').get(eventId);

    if (!event) {
      throw new Error('Event not found or inactive');
    }

    const message = `📅 *${event.title}*\n\n${event.description}\n\n` +
      `📍 Location: ${event.location || 'TBA'}\n` +
      `🗓️ Date: ${event.event_date || 'TBA'}${event.event_time ? ' at ' + event.event_time : ''}\n\n` +
      `${event.post_url ? `More details: ${event.post_url}\n\n` : ''}` +
      `Follow us on ${event.platform} for updates!\n` +
      `campusdekho.ai - the admission corridor`;

    return await sendWhatsAppMessage(toNumber, message, callSid, event.image_url);
  } catch (error) {
    console.error('❌ Failed to send event:', error.message);
    return { success: false, error: error.message };
  } finally {
    db.close();
  }
}

/**
 * Send MHT-CET document checklist via WhatsApp
 * @param {string} toNumber - Recipient phone number
 * @param {string} callSid - Optional call SID
 * @returns {Promise<Object>}
 */
export async function sendDocumentChecklist(toNumber, callSid = null) {
  const message = `📋 *MHT-CET 2026 Document Checklist*

✅ Required Documents:
• 10th mark sheet (original + photocopy)
• 12th mark sheet (original + photocopy)
• Domicile certificate
• Caste certificate (if applicable)
• Passport-size photos (5 copies)
• Aadhaar card (photocopy)
• School leaving certificate
• Migration certificate (if from other board)

📌 Keep originals + 2 photocopies of each document ready!

Need help? Reply to this message or visit campusdekho.ai

- Campus Dekho
  the admission corridor`;

  return await sendWhatsAppMessage(toNumber, message, callSid);
}

/**
 * Send general Campus Dekho info via WhatsApp
 * @param {string} toNumber - Recipient phone number
 * @param {string} callSid - Optional call SID
 * @returns {Promise<Object>}
 */
export async function sendGeneralInfo(toNumber, callSid = null) {
  const message = `Welcome to Campus Dekho! 🎓

*the admission corridor*

We provide:
✅ Admission counseling (Engineering & Medical)
✅ MHT-CET preparation guidance
✅ College tours with parents
✅ Document verification support
✅ CAP round assistance

🌐 Visit: campusdekho.ai
📧 Email: info@campusdekho.ai
📱 Follow us: @campusdekho (Instagram/Facebook)

Let's make your admission journey smooth!`;

  return await sendWhatsAppMessage(toNumber, message, callSid);
}

/**
 * Log WhatsApp message to database
 * @param {Object} data - Message data
 */
function logWhatsAppMessage(data) {
  const db = new Database(DB_PATH);

  try {
    const stmt = db.prepare(`
      INSERT INTO whatsapp_messages
      (call_sid, recipient_number, message_content, media_url, status, provider_message_id, error_message, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    stmt.run(
      data.call_sid,
      data.recipient_number,
      data.message_content,
      data.media_url || null,
      data.status,
      data.provider_message_id || null,
      data.error_message || null
    );
  } catch (error) {
    console.error('❌ Failed to log WhatsApp message:', error.message);
  } finally {
    db.close();
  }
}

/**
 * Get WhatsApp message history for a call
 * @param {string} callSid - Call SID
 * @returns {Array} Message history
 */
export function getWhatsAppHistory(callSid) {
  const db = new Database(DB_PATH, { readonly: true });

  try {
    const messages = db.prepare(`
      SELECT * FROM whatsapp_messages
      WHERE call_sid = ?
      ORDER BY created_at DESC
    `).all(callSid);

    return messages;
  } finally {
    db.close();
  }
}

export default {
  sendWhatsAppMessage,
  sendCounselingPackage,
  sendEventDetails,
  sendDocumentChecklist,
  sendGeneralInfo,
  getWhatsAppHistory,
};
