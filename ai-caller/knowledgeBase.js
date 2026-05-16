/**
 * Campus Dekho - Knowledge Base Service
 * RAG-style query system for FAQs and knowledge
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, 'data', 'inbound-knowledge.db');

/**
 * Search knowledge base by query (keyword matching + category filter)
 * @param {string} query - User query string
 * @param {string} category - Optional category filter ('cet', 'documents', 'admissions', 'general')
 * @param {number} limit - Max results to return
 * @returns {Array} Matching knowledge entries
 */
export function searchKnowledge(query, category = null, limit = 5) {
  const db = new Database(DB_PATH, { readonly: true });

  try {
    const keywords = query.toLowerCase().split(/\s+/);

    let sql = `
      SELECT id, category, question, answer, keywords, priority
      FROM knowledge_base
      WHERE 1=1
    `;

    const params = [];

    // Category filter
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    // Keyword matching (OR logic)
    if (keywords.length > 0) {
      sql += ` AND (${keywords.map(() =>
        '(question LIKE ? OR answer LIKE ? OR keywords LIKE ?)'
      ).join(' OR ')})`;

      keywords.forEach(kw => {
        params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
      });
    }

    sql += ' ORDER BY priority DESC, id ASC LIMIT ?';
    params.push(limit);

    const results = db.prepare(sql).all(...params);
    return results;
  } finally {
    db.close();
  }
}

/**
 * Get knowledge by category
 * @param {string} category - Category name
 * @param {number} limit - Max results
 * @returns {Array}
 */
export function getKnowledgeByCategory(category, limit = 10) {
  const db = new Database(DB_PATH, { readonly: true });

  try {
    return db.prepare(
      'SELECT * FROM knowledge_base WHERE category = ? ORDER BY priority DESC LIMIT ?'
    ).all(category, limit);
  } finally {
    db.close();
  }
}

/**
 * Get all counseling packages
 * @param {boolean} activeOnly - Return only active packages
 * @returns {Array}
 */
export function getCounselingPackages(activeOnly = true) {
  const db = new Database(DB_PATH, { readonly: true });

  try {
    const sql = activeOnly
      ? 'SELECT * FROM counseling_packages WHERE is_active = 1 ORDER BY price ASC'
      : 'SELECT * FROM counseling_packages ORDER BY price ASC';

    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

/**
 * Get package by ID
 * @param {number} id - Package ID
 * @returns {Object|null}
 */
export function getPackageById(id) {
  const db = new Database(DB_PATH, { readonly: true });

  try {
    return db.prepare('SELECT * FROM counseling_packages WHERE id = ?').get(id);
  } finally {
    db.close();
  }
}

/**
 * Get upcoming social events
 * @param {string} platform - Optional platform filter
 * @param {number} limit - Max results
 * @returns {Array}
 */
export function getUpcomingEvents(platform = null, limit = 10) {
  const db = new Database(DB_PATH, { readonly: true });

  try {
    let sql = 'SELECT * FROM social_events WHERE is_active = 1';

    if (platform) {
      sql += ' AND platform = ?';
      return db.prepare(sql + ' ORDER BY event_date ASC LIMIT ?').all(platform, limit);
    }

    return db.prepare(sql + ' ORDER BY event_date ASC LIMIT ?').all(limit);
  } finally {
    db.close();
  }
}

/**
 * Get event by ID
 * @param {number} id - Event ID
 * @returns {Object|null}
 */
export function getEventById(id) {
  const db = new Database(DB_PATH, { readonly: true });

  try {
    return db.prepare('SELECT * FROM social_events WHERE id = ?').get(id);
  } finally {
    db.close();
  }
}

/**
 * Check if human agent is available
 * @returns {Object|null} Available agent or null
 */
export function getAvailableAgent() {
  const db = new Database(DB_PATH, { readonly: true });

  try {
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

    const agents = db.prepare(`
      SELECT * FROM agent_availability
      WHERE available = 1
        AND current_calls < max_concurrent_calls
        AND time(?) BETWEEN time(available_from) AND time(available_to)
      ORDER BY current_calls ASC
      LIMIT 1
    `).all(currentTime);

    // Filter by day of week
    const availableAgent = agents.find(agent => {
      try {
        const days = JSON.parse(agent.days_of_week || '[]');
        return days.includes(currentDay);
      } catch {
        return false;
      }
    });

    return availableAgent || null;
  } finally {
    db.close();
  }
}

/**
 * Increment agent call count
 * @param {number} agentId - Agent ID
 */
export function incrementAgentCalls(agentId) {
  const db = new Database(DB_PATH);

  try {
    db.prepare('UPDATE agent_availability SET current_calls = current_calls + 1 WHERE id = ?').run(agentId);
  } finally {
    db.close();
  }
}

/**
 * Decrement agent call count
 * @param {number} agentId - Agent ID
 */
export function decrementAgentCalls(agentId) {
  const db = new Database(DB_PATH);

  try {
    db.prepare('UPDATE agent_availability SET current_calls = MAX(0, current_calls - 1) WHERE id = ?').run(agentId);
  } finally {
    db.close();
  }
}

/**
 * Add FAQ to knowledge base
 * @param {Object} data - FAQ data
 */
export function addKnowledge(data) {
  const db = new Database(DB_PATH);

  try {
    const stmt = db.prepare(`
      INSERT INTO knowledge_base (category, question, answer, keywords, priority)
      VALUES (?, ?, ?, ?, ?)
    `);

    return stmt.run(
      data.category,
      data.question,
      data.answer,
      data.keywords || '',
      data.priority || 0
    );
  } finally {
    db.close();
  }
}

/**
 * Get statistics for dashboard
 * @returns {Object}
 */
export function getKnowledgeStats() {
  const db = new Database(DB_PATH, { readonly: true });

  try {
    const stats = {
      totalFAQs: db.prepare('SELECT COUNT(*) as count FROM knowledge_base').get().count,
      totalPackages: db.prepare('SELECT COUNT(*) as count FROM counseling_packages WHERE is_active = 1').get().count,
      totalEvents: db.prepare('SELECT COUNT(*) as count FROM social_events WHERE is_active = 1').get().count,
      totalAgents: db.prepare('SELECT COUNT(*) as count FROM agent_availability WHERE available = 1').get().count,
      faqsByCategory: {},
    };

    const categories = db.prepare('SELECT category, COUNT(*) as count FROM knowledge_base GROUP BY category').all();
    categories.forEach(cat => {
      stats.faqsByCategory[cat.category] = cat.count;
    });

    return stats;
  } finally {
    db.close();
  }
}

export default {
  searchKnowledge,
  getKnowledgeByCategory,
  getCounselingPackages,
  getPackageById,
  getUpcomingEvents,
  getEventById,
  getAvailableAgent,
  incrementAgentCalls,
  decrementAgentCalls,
  addKnowledge,
  getKnowledgeStats,
};
