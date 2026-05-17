// businessManager.js — SQLite-backed multi-business profile manager

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve DB path: use ai-caller/ai_caller.db if it exists (legacy location), else local
const LEGACY_DB = path.join(__dirname, 'ai-caller', 'ai_caller.db');
const LOCAL_DB  = path.join(__dirname, 'ai_caller.db');
const DB_PATH   = fs.existsSync(LEGACY_DB) ? LEGACY_DB : LOCAL_DB;

export class BusinessManager {
  constructor() {
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this._initTables();
    this._seedCampusDekho();
    console.log('🏢 BusinessManager initialized');
  }

  _generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  _initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS businesses (
        id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        name        TEXT NOT NULL,
        agent_name  TEXT DEFAULT 'Priya',
        industry    TEXT DEFAULT 'education',
        description TEXT,
        call_goal   TEXT,
        call_types  TEXT DEFAULT '["outbound_lead"]',
        default_language TEXT DEFAULT 'en',
        languages   TEXT DEFAULT '["en","hi","mr"]',
        phone       TEXT,
        website     TEXT,
        custom_prompt TEXT,
        active      INTEGER DEFAULT 0,
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS biz_knowledge (
        id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        category    TEXT NOT NULL,
        title       TEXT NOT NULL,
        content     TEXT NOT NULL,
        tags        TEXT,
        priority    INTEGER DEFAULT 5,
        created_at  TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS biz_campaigns (
        id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        call_type   TEXT DEFAULT 'outbound_lead',
        status      TEXT DEFAULT 'draft',
        created_at  TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS call_transcripts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT NOT NULL,
        business_id TEXT,
        phone       TEXT,
        transcript  TEXT,
        intent_data TEXT,
        duration_s  INTEGER,
        created_at  TEXT DEFAULT (datetime('now'))
      );
    `);
  }

  _seedCampusDekho() {
    const existing = this.db.prepare('SELECT COUNT(*) as n FROM businesses').get();
    if (existing.n > 0) return;

    const bizId = this._generateId();
    this.db.prepare(`
      INSERT INTO businesses (id, name, agent_name, industry, description, call_goal, call_types, default_language, languages, website, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      bizId,
      'Campus Dekho',
      'Priya',
      'Education Counseling',
      "Campus Dekho (campusdekho.ai) is India's leading education guidance platform. We help students navigate MHT-CET preparation, college admissions, and campus visits across Maharashtra.",
      'Invite students to free MHT-CET preparation seminars, answer their doubts, and collect RSVP. Also promote campus tours and professional admission counseling.',
      '["outbound_lead","inbound_support"]',
      'en',
      '["en","hi","mr"]',
      'https://campusdekho.ai'
    );

    const insertKb = this.db.prepare(`
      INSERT INTO biz_knowledge (id, business_id, category, title, content, tags, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const entries = [
      ['script', 'Opening Greeting', "Hi! I'm Priya from Campus Dekho. I'm calling to help you with MHT-CET preparation and invite you to our free seminar. Are you currently preparing for MHT-CET?", 'greeting,opener', 10],
      ['faq', 'What is Campus Dekho?', "Campus Dekho (campusdekho.ai) is India's leading education guidance platform helping students with MHT-CET preparation, college admissions, campus tours, and professional counseling.", 'company,about', 9],
      ['faq', 'MHT-CET Events 2026', 'Free MHT-CET preparation seminars across 24 Maharashtra venues (April 19 - May 3, 2026). Cities: Kolhapur, Sangli, Satara, Pune, Aurangabad, Ahmednagar, Nashik. Both online and offline. Registration link: https://campusdekho.ai/mht-cet-registration', 'event,seminar,venue', 9],
      ['faq', 'MHT-CET 2026 Exam Pattern', 'PCM: 150 questions, 200 marks, 180 min. PCB: 200 questions, 200 marks, 180 min. No negative marking. Computer-based. 2 attempts per group — best score counts. Difficulty at par with JEE Main/NEET.', 'exam,pattern,mhtcet', 8],
      ['faq', 'MHT-CET 2026 Registration', 'Registration closed ~Feb 20, 2026. Exam dates to be announced on mahacet.org. Fee: Rs 1300 (General), Rs 1000 (Reserved). Admit cards TBA.', 'registration,dates,fee', 8],
      ['faq', 'Top Engineering Colleges', 'COEP Pune: 99.9+ percentile. VJTI Mumbai: 99.8+. MIT-WPU/SIT Pune: 95-97. PICT/VIT Pune: 92-95. Choose college based on your target percentile.', 'colleges,percentile,engineering', 7],
      ['event', 'Kolhapur Events', 'Kolhapur: Apr 19 (Sun) 4-6:30 PM. Bidri: Apr 20 (Mon) 4-6:30 PM. Gadhinglaj: Apr 20 (Mon) 10 AM-12:30 PM. Ichalkaranji: Apr 21 (Tue) 4-6:30 PM. Warna: Apr 21 (Tue) 10 AM-12:30 PM.', 'kolhapur,venue,schedule', 8],
      ['event', 'Sangli/Satara Events', 'Sangli: Apr 22 (Wed) 10 AM. Tasgoan: Apr 23 (Thu) 10 AM. Karad: Apr 26 (Sun) 10 AM. Satara: Apr 26 (Sun) 4 PM & Apr 27 (Mon) 10 AM. Wai: Apr 27 (Mon) 4 PM.', 'sangli,satara,venue,schedule', 8],
      ['event', 'Pune Events', 'Indapur: Apr 28 (Tue) 10 AM. Baramati: Apr 28 (Tue) 4 PM & Apr 29 (Wed) 4 PM. Alandi: Apr 30 (Thu) 4 PM.', 'pune,venue,schedule', 8],
      ['event', 'Other City Events', 'Aurangabad: May 1 (Sun) 4-6:30 PM. Ahmednagar: May 2 (Sat) 4-6:30 PM. Kopargaon: May 3 (Fri) 10 AM-12:30 PM. Nashik: May 3 (Fri) 4-7 PM.', 'nashik,aurangabad,venue,schedule', 8],
      ['product', 'Campus Tour Program', 'University campus visits in Pune with parents welcome. Minimal fees. Hands-on experience of college facilities and campus life. Helps students make informed college choices.', 'campus,tour,visit', 7],
      ['product', 'Admission Counseling', 'Professional counseling for Engineering and Medical college admissions. Personalized guidance based on MHT-CET scores. College selection and application assistance.', 'counseling,admission,guidance', 7],
      ['product', 'Basic Counseling Package', 'Rs 999. College shortlisting, application guidance, 2 counseling sessions. Best for self-directed students who need direction.', 'package,counseling,basic', 6],
      ['product', 'Premium Counseling Package', 'Rs 2999. Everything in Basic + CAP round support, document verification, 5 sessions. Most popular choice.', 'package,counseling,premium', 6],
      ['objection', 'Not interested / busy', 'Totally understand! Our seminar is just 2.5 hours and covers exam pattern, high-yield topics, and college selection. Would a different time work better?', 'objection,busy', 5],
      ['objection', 'Already have coaching', 'Great that you have coaching! Our seminar complements it perfectly — we focus on the admission strategy side: college choices, percentile targets, and campus visits that coaching centers don\'t cover.', 'objection,coaching', 5],
      ['objection', 'Online/offline preference', 'We have both options! The online session is just as interactive, or you can join us in person at the nearest venue. Which would you prefer?', 'objection,online,offline', 5],
    ];

    const insertMany = this.db.transaction((rows) => {
      for (const [category, title, content, tags, priority] of rows) {
        insertKb.run(this._generateId(), bizId, category, title, content, tags, priority);
      }
    });
    insertMany(entries);

    console.log(`✅ Campus Dekho seeded as default business (${entries.length} KB entries)`);
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  listBusinesses() {
    return this.db.prepare('SELECT * FROM businesses ORDER BY created_at DESC').all();
  }

  getBusiness(id) {
    return this.db.prepare('SELECT * FROM businesses WHERE id = ?').get(id);
  }

  getActiveBusiness() {
    return this.db.prepare('SELECT * FROM businesses WHERE active = 1 LIMIT 1').get() || null;
  }

  createBusiness(data) {
    const bizId = this._generateId();
    this.db.prepare(`
      INSERT INTO businesses (id, name, agent_name, industry, description, languages, phone, website, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      bizId,
      data.name,
      data.agent_name || 'Priya',
      data.industry || 'general',
      data.tagline || data.description || '',
      JSON.stringify((data.languages || 'en').split(',').map(l => l.trim())),
      data.phone || '',
      data.website || '',
    );
    return this.getBusiness(bizId);
  }

  updateBusiness(id, data) {
    const allowed = { name: data.name, agent_name: data.agent_name, industry: data.industry,
      description: data.tagline || data.description, languages: data.languages, phone: data.phone, website: data.website };
    const entries = Object.entries(allowed).filter(([, v]) => v !== undefined);
    if (!entries.length) return this.getBusiness(id);
    const sets = entries.map(([k]) => `${k} = ?`).join(', ');
    this.db.prepare(`UPDATE businesses SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(
      ...entries.map(([, v]) => v), id
    );
    return this.getBusiness(id);
  }

  deleteBusiness(id) {
    return this.db.prepare('DELETE FROM businesses WHERE id = ?').run(id).changes > 0;
  }

  setActiveBusiness(id) {
    this.db.transaction(() => {
      this.db.prepare('UPDATE businesses SET active = 0').run();
      this.db.prepare('UPDATE businesses SET active = 1 WHERE id = ?').run(id);
    })();
    return this.getBusiness(id);
  }

  // ── KNOWLEDGE BASE ────────────────────────────────────────────────────────

  getKnowledge(businessId, category = null) {
    if (category) {
      return this.db.prepare(
        'SELECT * FROM biz_knowledge WHERE business_id = ? AND category = ? ORDER BY priority DESC'
      ).all(businessId, category);
    }
    return this.db.prepare(
      'SELECT * FROM biz_knowledge WHERE business_id = ? ORDER BY priority DESC'
    ).all(businessId);
  }

  searchKnowledge(businessId, query) {
    const q = `%${query}%`;
    return this.db.prepare(`
      SELECT * FROM biz_knowledge
      WHERE business_id = ?
        AND (title LIKE ? OR content LIKE ? OR tags LIKE ?)
      ORDER BY priority DESC
      LIMIT 5
    `).all(businessId, q, q, q);
  }

  addKnowledge(businessId, data) {
    const kbId = this._generateId();
    this.db.prepare(`
      INSERT INTO biz_knowledge (id, business_id, category, title, content, tags, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      kbId,
      businessId,
      data.category || data.type || 'faq',
      data.title,
      data.content,
      data.tags || '',
      data.priority || 5
    );
    return this.db.prepare('SELECT * FROM biz_knowledge WHERE id = ?').get(kbId);
  }

  updateKnowledge(id, data) {
    const allowed = { category: data.category || data.type, title: data.title, content: data.content, tags: data.tags, priority: data.priority };
    const entries = Object.entries(allowed).filter(([, v]) => v !== undefined);
    if (!entries.length) return;
    const sets = entries.map(([k]) => `${k} = ?`).join(', ');
    this.db.prepare(`UPDATE biz_knowledge SET ${sets} WHERE id = ?`).run(
      ...entries.map(([, v]) => v), id
    );
  }

  deleteKnowledge(id) {
    return this.db.prepare('DELETE FROM biz_knowledge WHERE id = ?').run(id).changes > 0;
  }

  // ── TRANSCRIPTS ───────────────────────────────────────────────────────────

  saveTranscript(sessionId, businessId, phone, transcript, intentData, durationS) {
    this.db.prepare(`
      INSERT INTO call_transcripts (session_id, business_id, phone, transcript, intent_data, duration_s)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      businessId || null,
      phone || null,
      JSON.stringify(transcript),
      JSON.stringify(intentData || {}),
      durationS || 0
    );
  }

  getTranscripts(businessId, limit = 20) {
    return this.db.prepare(
      'SELECT * FROM call_transcripts WHERE business_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(businessId, limit);
  }
}

export default BusinessManager;
