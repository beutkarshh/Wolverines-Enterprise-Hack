// businessManager.js — Multi-business profile manager
// Stores all business configs, knowledge bases, and campaigns in ai_caller.db
// One business can be "active" at a time — the active business drives all calls.

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class BusinessManager {
  constructor(dbPath = path.join(__dirname, 'ai_caller.db')) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._initTables();
    this._seed();
  }

  // ─── Schema ───────────────────────────────────────────────────────────────────

  _initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS businesses (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        agent_name    TEXT NOT NULL DEFAULT 'Aria',
        industry      TEXT,
        description   TEXT,
        call_goal     TEXT,
        call_types    TEXT DEFAULT '["outbound_lead"]',
        default_language TEXT DEFAULT 'en',
        languages     TEXT DEFAULT '["en","hi","mr"]',
        website       TEXT,
        phone         TEXT,
        custom_prompt TEXT,
        active        INTEGER DEFAULT 0,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS biz_knowledge (
        id           TEXT PRIMARY KEY,
        business_id  TEXT NOT NULL,
        category     TEXT NOT NULL DEFAULT 'faq',
        title        TEXT NOT NULL,
        content      TEXT NOT NULL,
        tags         TEXT,
        priority     INTEGER DEFAULT 1,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS biz_campaigns (
        id             TEXT PRIMARY KEY,
        business_id    TEXT NOT NULL,
        name           TEXT NOT NULL,
        call_type      TEXT NOT NULL DEFAULT 'outbound_lead',
        goal           TEXT,
        status         TEXT DEFAULT 'draft',
        contacts_count INTEGER DEFAULT 0,
        created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_biz_knowledge_business ON biz_knowledge(business_id);
      CREATE INDEX IF NOT EXISTS idx_biz_knowledge_category ON biz_knowledge(business_id, category);
      CREATE INDEX IF NOT EXISTS idx_biz_campaigns_business ON biz_campaigns(business_id);
    `);
  }

  // ─── Auto-seed: Campus Dekho as first business ───────────────────────────────

  _seed() {
    const existing = this.db.prepare('SELECT COUNT(*) as n FROM businesses').get();
    if (existing.n > 0) return; // already seeded

    const id = uuidv4();

    this.db.prepare(`
      INSERT INTO businesses (id, name, agent_name, industry, description, call_goal,
        call_types, default_language, languages, website, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      id,
      'Campus Dekho',
      'Priya',
      'Education Counseling',
      'Campus Dekho (campusdekho.ai) is India\'s leading education guidance platform. We help students navigate MHT-CET preparation, college admissions, and campus visits across Maharashtra.',
      'Invite students to free MHT-CET preparation seminars, answer their doubts, and collect RSVP. Also promote campus tours and professional admission counseling.',
      JSON.stringify(['outbound_lead', 'inbound_support']),
      'en',
      JSON.stringify(['en', 'hi', 'mr']),
      'https://campusdekho.ai'
    );

    // ── Knowledge base entries ──────────────────────────────────────────────────

    const kb = [
      // Call opening
      {
        category: 'script',
        title: 'Call Opening',
        content: `Hi! I'm Priya from Campus Dekho. I'm calling to help you with MHT-CET preparation and invite you to our free seminar. Are you currently preparing for MHT-CET?`,
        tags: ['opening', 'greeting']
      },

      // MHT-CET overview
      {
        category: 'faq',
        title: 'What is MHT-CET?',
        content: `MHT-CET (Maharashtra Common Entrance Test) 2026 is conducted by the State Common Entrance Test Cell, Government of Maharashtra for B.E./B.Tech, B.Pharmacy, B.Planning and related courses for Academic Year 2026-27. Official website: www.mahacet.org. Helpdesk: 18002090191.`,
        tags: ['mhtcet', 'overview', 'exam']
      },
      {
        category: 'faq',
        title: 'MHT-CET Exam Groups',
        content: `Two groups: (1) PCM Group for Engineering/B.Planning — Physics + Chemistry + Maths. (2) PCB Group for Pharmacy — Physics + Chemistry + Biology. Students can appear for ONE or BOTH groups. NEW in 2026: Two attempts per group — best score used for admission. No negative marking — attempt all questions!`,
        tags: ['mhtcet', 'exam', 'groups', 'pattern']
      },
      {
        category: 'faq',
        title: 'MHT-CET Exam Pattern',
        content: `PCM: 180 minutes total. First 90 min: Physics (50Q, 50 marks) + Chemistry (50Q, 50 marks). Next 90 min: Maths (50Q, 100 marks). Total: 150 questions, 200 marks. PCB: 180 minutes. First 90 min: Physics + Chemistry. Next 90 min: Biology (100Q, 100 marks). Total: 200 questions, 200 marks. Computer-Based Test at exam centres across Maharashtra.`,
        tags: ['mhtcet', 'exam', 'pattern', 'marks']
      },
      {
        category: 'faq',
        title: 'MHT-CET Eligibility',
        content: `Must have passed Std XII (or appearing) with Physics, Chemistry, and Maths/Biology from Maharashtra State Board or equivalent. General category: minimum 45% in PCM/PCB. Reserved category (SC/ST/OBC/PwD): minimum 40%. Diploma holders and NRI candidates have separate provisions.`,
        tags: ['mhtcet', 'eligibility']
      },

      // Events / Seminar schedule
      {
        category: 'event',
        title: 'MHT-CET Seminar Schedule — Kolhapur District',
        content: `Kolhapur: Apr 19 (Sunday) 4:00-6:30 PM\nBidri: Apr 20 (Monday) 4:00-6:30 PM\nGadhinglaj: Apr 20 (Monday) 10:00 AM-12:30 PM\nIchalkaranji: Apr 21 (Tuesday) 4:00-6:30 PM\nWarna: Apr 21 (Tuesday) 10:00 AM-12:30 PM`,
        tags: ['event', 'seminar', 'kolhapur', 'venue']
      },
      {
        category: 'event',
        title: 'MHT-CET Seminar Schedule — Sangli District',
        content: `Sangli: Apr 22 (Wednesday) 10:00 AM-12:30 PM\nTasgoan: Apr 23 (Thursday) 10:00 AM-12:30 PM\nKavtemahakal: Apr 23 (Thursday) 4:00-6:30 PM\nVita: Apr 24 (Friday) 10:00 AM-12:30 PM\nIslampur: Apr 25 (Saturday) 10:00 AM-12:30 PM`,
        tags: ['event', 'seminar', 'sangli', 'venue']
      },
      {
        category: 'event',
        title: 'MHT-CET Seminar Schedule — Satara District',
        content: `Karad: Apr 26 (Sunday) 10:00 AM-12:30 PM\nSatara (Session 1): Apr 26 (Sunday) 4:00-6:30 PM\nSatara (Session 2): Apr 27 (Monday) 10:00 AM-12:30 PM\nWai: Apr 27 (Monday) 4:00-6:30 PM`,
        tags: ['event', 'seminar', 'satara', 'venue']
      },
      {
        category: 'event',
        title: 'MHT-CET Seminar Schedule — Pune District',
        content: `Indapur: Apr 28 (Tuesday) 10:00 AM-12:30 PM\nBaramati (Session 1): Apr 28 (Tuesday) 4:00-6:30 PM\nBaramati (Session 2): Apr 29 (Wednesday) 4:00-6:30 PM\nAlandi: Apr 30 (Thursday) 4:00-6:30 PM`,
        tags: ['event', 'seminar', 'pune', 'venue']
      },
      {
        category: 'event',
        title: 'MHT-CET Seminar Schedule — Other Cities',
        content: `Sambhajinagar (Aurangabad): May 1 (Sunday) 4:00-6:30 PM\nAhilyanagar (Ahmednagar): May 2 (Saturday) 4:00-6:30 PM\nKopargoan: May 3 (Friday) 10:00 AM-12:30 PM\nNashik: May 3 (Friday) 4:00-7:00 PM`,
        tags: ['event', 'seminar', 'nashik', 'aurangabad', 'ahmednagar', 'venue']
      },

      // Services / Products
      {
        category: 'product',
        title: 'Admission Counseling — Basic Package',
        content: `Price: ₹999. Includes: College shortlisting based on MHT-CET score, application guidance for 5 colleges, email support. Best for students who need direction on college selection.`,
        tags: ['product', 'counseling', 'basic', 'pricing']
      },
      {
        category: 'product',
        title: 'Admission Counseling — Premium Package',
        content: `Price: ₹2999. Includes: Personalized counseling session (1 hour), college shortlisting for 10+ colleges, CAP round guidance, document checklist, WhatsApp support. Best for students who want hands-on help through the entire admission process.`,
        tags: ['product', 'counseling', 'premium', 'pricing']
      },
      {
        category: 'product',
        title: 'Admission Counseling — Elite Package',
        content: `Price: ₹5999. Includes: 3 counseling sessions, unlimited college shortlisting, end-to-end CAP round support, interview preparation, dedicated counselor, priority WhatsApp support. Best for students who want complete support from score to admission.`,
        tags: ['product', 'counseling', 'elite', 'pricing']
      },
      {
        category: 'product',
        title: 'Campus Tour Program',
        content: `Visit Pune university campuses with parents. Minimal fee (details at seminar). Hands-on experience of college facilities and campus life. Helps make informed college choices. Scheduled alongside seminar venues.`,
        tags: ['product', 'campus', 'tour', 'pune']
      },

      // Objection handling
      {
        category: 'objection',
        title: 'Student says they are busy',
        content: `Acknowledge their busy schedule. Mention the seminar is only 2.5 hours and completely free. Offer to send details on WhatsApp so they can decide later. If they are near a venue, mention the specific date and time closest to them.`,
        tags: ['objection', 'busy', 'time']
      },
      {
        category: 'objection',
        title: 'Student already has coaching',
        content: `Great! Campus Dekho is a complement to coaching, not a replacement. The seminar covers college admission strategy, CAP rounds, and venue visits — things coaching institutes don't cover. It's free and only 2.5 hours.`,
        tags: ['objection', 'coaching', 'already']
      },
      {
        category: 'objection',
        title: 'Student asks about cost',
        content: `The MHT-CET seminars are completely FREE. There is no registration fee. Just bring a notepad and your questions. The counseling packages (₹999–₹5999) are optional and only for students who want personalised admission help.`,
        tags: ['objection', 'cost', 'free', 'price']
      },
    ];

    const insertKB = this.db.prepare(`
      INSERT INTO biz_knowledge (id, business_id, category, title, content, tags, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((entries) => {
      for (const e of entries) {
        insertKB.run(uuidv4(), id, e.category, e.title, e.content, JSON.stringify(e.tags || []), e.priority || 1);
      }
    });

    insertMany(kb);

    console.log('🌱 Auto-seeded Campus Dekho as first business (active)');
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────────

  createBusiness(data) {
    const id = uuidv4();
    const {
      name, agent_name = 'Aria', industry = '', description = '',
      call_goal = '', call_types = ['outbound_lead'],
      default_language = 'en', languages = ['en', 'hi', 'mr'],
      website = '', phone = '', custom_prompt = ''
    } = data;

    this.db.prepare(`
      INSERT INTO businesses (id, name, agent_name, industry, description, call_goal,
        call_types, default_language, languages, website, phone, custom_prompt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, name, agent_name, industry, description, call_goal,
      JSON.stringify(call_types), default_language, JSON.stringify(languages),
      website, phone, custom_prompt
    );

    return this.getBusiness(id);
  }

  listBusinesses() {
    const rows = this.db.prepare('SELECT * FROM businesses ORDER BY created_at ASC').all();
    return rows.map(this._parse);
  }

  getBusiness(id) {
    const row = this.db.prepare('SELECT * FROM businesses WHERE id = ?').get(id);
    return row ? this._parse(row) : null;
  }

  getActiveBusiness() {
    const row = this.db.prepare('SELECT * FROM businesses WHERE active = 1 LIMIT 1').get();
    return row ? this._parse(row) : null;
  }

  setActiveBusiness(id) {
    const t = this.db.transaction(() => {
      this.db.prepare('UPDATE businesses SET active = 0').run();
      this.db.prepare('UPDATE businesses SET active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    });
    t();
    return this.getBusiness(id);
  }

  updateBusiness(id, data) {
    const allowed = ['name', 'agent_name', 'industry', 'description', 'call_goal',
      'call_types', 'default_language', 'languages', 'website', 'phone', 'custom_prompt'];

    const fields = [];
    const values = [];
    for (const [k, v] of Object.entries(data)) {
      if (!allowed.includes(k)) continue;
      fields.push(`${k} = ?`);
      values.push(Array.isArray(v) ? JSON.stringify(v) : v);
    }
    if (fields.length === 0) return this.getBusiness(id);

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    this.db.prepare(`UPDATE businesses SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getBusiness(id);
  }

  deleteBusiness(id) {
    this.db.prepare('DELETE FROM businesses WHERE id = ?').run(id);
    return { success: true };
  }

  // ─── Knowledge base ───────────────────────────────────────────────────────────

  addKnowledge(businessId, { category = 'faq', title, content, tags = [], priority = 1 }) {
    const id = uuidv4();
    this.db.prepare(`
      INSERT INTO biz_knowledge (id, business_id, category, title, content, tags, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, businessId, category, title, content, JSON.stringify(tags), priority);
    return { id, businessId, category, title, content, tags, priority };
  }

  getKnowledge(businessId, category = null) {
    const q = category
      ? this.db.prepare('SELECT * FROM biz_knowledge WHERE business_id = ? AND category = ? ORDER BY priority DESC, created_at ASC')
      : this.db.prepare('SELECT * FROM biz_knowledge WHERE business_id = ? ORDER BY category, priority DESC, created_at ASC');
    const rows = category ? q.all(businessId, category) : q.all(businessId);
    return rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') }));
  }

  searchKnowledge(businessId, query) {
    const rows = this.db.prepare(`
      SELECT * FROM biz_knowledge
      WHERE business_id = ?
        AND (title LIKE ? OR content LIKE ? OR tags LIKE ?)
      ORDER BY priority DESC
      LIMIT 5
    `).all(businessId, `%${query}%`, `%${query}%`, `%${query}%`);
    return rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') }));
  }

  updateKnowledge(id, data) {
    const { title, content, category, tags, priority } = data;
    this.db.prepare(`
      UPDATE biz_knowledge SET title = COALESCE(?, title), content = COALESCE(?, content),
        category = COALESCE(?, category), tags = COALESCE(?, tags), priority = COALESCE(?, priority)
      WHERE id = ?
    `).run(title, content, category, tags ? JSON.stringify(tags) : null, priority, id);
  }

  deleteKnowledge(id) {
    this.db.prepare('DELETE FROM biz_knowledge WHERE id = ?').run(id);
  }

  // ─── Campaigns ────────────────────────────────────────────────────────────────

  createCampaign(businessId, { name, call_type = 'outbound_lead', goal = '' }) {
    const id = uuidv4();
    this.db.prepare(`
      INSERT INTO biz_campaigns (id, business_id, name, call_type, goal)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, businessId, name, call_type, goal);
    return { id, businessId, name, call_type, goal, status: 'draft' };
  }

  getCampaigns(businessId) {
    return this.db.prepare('SELECT * FROM biz_campaigns WHERE business_id = ? ORDER BY created_at DESC').all(businessId);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  _parse(row) {
    return {
      ...row,
      call_types: JSON.parse(row.call_types || '["outbound_lead"]'),
      languages: JSON.parse(row.languages || '["en"]'),
      active: row.active === 1
    };
  }

  close() {
    this.db.close();
  }
}

export default BusinessManager;
