import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class AICallerDatabase {
    constructor(dbPath = path.join(__dirname, 'ai_caller.db')) {
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL'); // Enable Write-Ahead Logging for better concurrency
        this.db.pragma('synchronous = NORMAL'); // Optimize for performance
        this.db.pragma('foreign_keys = ON'); // Enable foreign key constraints

        this.initializeTables();
        this.prepareStatements();
    }

    initializeTables() {
        // Contacts table with multilingual support
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS contacts (
                id TEXT PRIMARY KEY,
                phone TEXT UNIQUE NOT NULL,
                name TEXT,
                email TEXT,
                status TEXT DEFAULT 'not_called' CHECK (status IN ('not_called', 'calling', 'interested', 'callback', 'not_interested', 'completed')),
                rsvp TEXT DEFAULT 'none' CHECK (rsvp IN ('none', 'yes', 'no', 'maybe')),
                language_preference TEXT DEFAULT 'en' CHECK (language_preference IN ('en', 'hi', 'mr')),
                detected_language TEXT CHECK (detected_language IN ('en', 'hi', 'mr') OR detected_language IS NULL),
                notes TEXT,
                retry_count INTEGER DEFAULT 0,
                last_attempt_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Call queue table for batch processing
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS call_queue (
                id TEXT PRIMARY KEY,
                contact_id TEXT NOT NULL,
                batch_id TEXT,
                priority INTEGER DEFAULT 1,
                scheduled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (contact_id) REFERENCES contacts(id)
            )
        `);

        // Call logs table for conversation tracking
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS call_logs (
                id TEXT PRIMARY KEY,
                contact_id TEXT NOT NULL,
                batch_id TEXT,
                conversation_language TEXT CHECK (conversation_language IN ('en', 'hi', 'mr')),
                start_time DATETIME,
                end_time DATETIME,
                duration_seconds INTEGER,
                transcript TEXT,
                ai_messages_count INTEGER DEFAULT 0,
                student_responses_count INTEGER DEFAULT 0,
                final_status TEXT,
                final_rsvp TEXT,
                character_usage INTEGER DEFAULT 0,
                voice_used BOOLEAN DEFAULT FALSE,
                error_message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (contact_id) REFERENCES contacts(id)
            )
        `);

        // Daily batches table for progress management
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS daily_batches (
                id TEXT PRIMARY KEY,
                date DATE NOT NULL,
                target_size INTEGER NOT NULL,
                processed_count INTEGER DEFAULT 0,
                successful_count INTEGER DEFAULT 0,
                failed_count INTEGER DEFAULT 0,
                character_usage_total INTEGER DEFAULT 0,
                character_usage_en INTEGER DEFAULT 0,
                character_usage_hi INTEGER DEFAULT 0,
                character_usage_mr INTEGER DEFAULT 0,
                status TEXT DEFAULT 'created' CHECK (status IN ('created', 'processing', 'paused', 'completed', 'failed')),
                started_at DATETIME,
                completed_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Language templates table for pre-translated messages
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS language_templates (
                id TEXT PRIMARY KEY,
                template_key TEXT NOT NULL,
                language TEXT NOT NULL CHECK (language IN ('en', 'hi', 'mr')),
                content TEXT NOT NULL,
                character_count INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(template_key, language)
            )
        `);

        // Create indexes for better performance
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
            CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
            CREATE INDEX IF NOT EXISTS idx_contacts_language_preference ON contacts(language_preference);
            CREATE INDEX IF NOT EXISTS idx_call_queue_status ON call_queue(status);
            CREATE INDEX IF NOT EXISTS idx_call_queue_batch ON call_queue(batch_id);
            CREATE INDEX IF NOT EXISTS idx_call_logs_contact ON call_logs(contact_id);
            CREATE INDEX IF NOT EXISTS idx_call_logs_batch ON call_logs(batch_id);
        `);

        console.log('✅ Database tables initialized');
    }

    prepareStatements() {
        // Contact operations
        this.statements = {
            insertContact: this.db.prepare(`
                INSERT INTO contacts (id, phone, name, email, language_preference)
                VALUES (?, ?, ?, ?, ?)
            `),

            getContact: this.db.prepare('SELECT * FROM contacts WHERE phone = ?'),

            updateContactStatus: this.db.prepare(`
                UPDATE contacts
                SET status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `),

            updateContactLanguage: this.db.prepare(`
                UPDATE contacts
                SET detected_language = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `),

            updateContactResult: this.db.prepare(`
                UPDATE contacts
                SET status = ?, rsvp = ?, notes = ?, last_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `),

            // Queue operations
            addToQueue: this.db.prepare(`
                INSERT INTO call_queue (id, contact_id, batch_id, priority)
                VALUES (?, ?, ?, ?)
            `),

            getNextInQueue: this.db.prepare(`
                SELECT cq.*, c.phone, c.name, c.language_preference, c.detected_language
                FROM call_queue cq
                JOIN contacts c ON c.id = cq.contact_id
                WHERE cq.status = 'pending'
                ORDER BY cq.priority DESC, cq.scheduled_at ASC
                LIMIT ?
            `),

            updateQueueItemStatus: this.db.prepare(`
                UPDATE call_queue
                SET status = ?
                WHERE id = ?
            `),

            // Batch operations
            createBatch: this.db.prepare(`
                INSERT INTO daily_batches (id, date, target_size, status)
                VALUES (?, ?, ?, ?)
            `),

            getBatchStats: this.db.prepare('SELECT * FROM daily_batches WHERE id = ?'),

            updateBatchProgress: this.db.prepare(`
                UPDATE daily_batches
                SET processed_count = ?, successful_count = ?, failed_count = ?,
                    character_usage_total = ?, character_usage_en = ?,
                    character_usage_hi = ?, character_usage_mr = ?
                WHERE id = ?
            `),

            // Language template operations
            insertTemplate: this.db.prepare(`
                INSERT OR REPLACE INTO language_templates (id, template_key, language, content, character_count)
                VALUES (?, ?, ?, ?, ?)
            `),

            getTemplate: this.db.prepare(`
                SELECT content FROM language_templates
                WHERE template_key = ? AND language = ?
            `),

            // Analytics and reporting
            getContactsByStatus: this.db.prepare('SELECT status, COUNT(*) as count FROM contacts GROUP BY status'),

            getLanguageStats: this.db.prepare(`
                SELECT
                    conversation_language,
                    COUNT(*) as contact_count,
                    AVG(character_usage) as avg_character_usage
                FROM call_logs
                WHERE conversation_language IS NOT NULL
                GROUP BY conversation_language
            `),

            getTodaysBatchProgress: this.db.prepare(`
                SELECT * FROM daily_batches
                WHERE date = date('now')
                ORDER BY created_at DESC
                LIMIT 1
            `)
        };
    }

    // Contact Management Methods
    async addContact(phone, name = '', email = '', languagePreference = 'en') {
        const id = uuidv4();
        try {
            this.statements.insertContact.run(id, phone, name, email, languagePreference);
            return { success: true, id, phone };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getContact(phone) {
        return this.statements.getContact.get(phone);
    }

    async updateContactLanguage(contactId, detectedLanguage) {
        this.statements.updateContactLanguage.run(detectedLanguage, contactId);
    }

    async updateContactResult(contactId, status, rsvp, notes = '') {
        this.statements.updateContactResult.run(status, rsvp, notes, contactId);
    }

    // Queue Management Methods
    async addContactsToQueue(contacts, batchId, priority = 1) {
        const transaction = this.db.transaction((contacts, batchId, priority) => {
            for (const contact of contacts) {
                const queueId = uuidv4();
                this.statements.addToQueue.run(queueId, contact.id, batchId, priority);
            }
        });

        return transaction(contacts, batchId, priority);
    }

    async getNextCallsInQueue(limit = 10) {
        return this.statements.getNextInQueue.all(limit);
    }

    async updateQueueStatus(queueId, status) {
        this.statements.updateQueueItemStatus.run(status, queueId);
    }

    // Batch Management Methods
    async createDailyBatch(targetSize) {
        const id = uuidv4();
        const today = new Date().toISOString().split('T')[0];

        this.statements.createBatch.run(id, today, targetSize, 'created');
        return id;
    }

    async getBatchStats(batchId) {
        return this.statements.getBatchStats.get(batchId);
    }

    async updateBatchProgress(batchId, stats) {
        const { processed, successful, failed, charUsage } = stats;
        this.statements.updateBatchProgress.run(
            processed, successful, failed,
            charUsage.total, charUsage.en, charUsage.hi, charUsage.mr,
            batchId
        );
    }

    // Language Template Methods
    async addLanguageTemplate(templateKey, language, content) {
        const id = uuidv4();
        const characterCount = content.length;

        this.statements.insertTemplate.run(id, templateKey, language, content, characterCount);
    }

    async getLanguageTemplate(templateKey, language) {
        const result = this.statements.getTemplate.get(templateKey, language);
        return result ? result.content : null;
    }

    // Analytics Methods
    async getContactStatusStats() {
        return this.statements.getContactsByStatus.all();
    }

    async getLanguageUsageStats() {
        return this.statements.getLanguageStats.all();
    }

    async getTodaysBatch() {
        return this.statements.getTodaysBatchProgress.get();
    }

    // Call Logging Methods
    async logCall(callLog) {
        const id = uuidv4();
        const insertCallLog = this.db.prepare(`
            INSERT INTO call_logs (
                id, contact_id, batch_id, conversation_language,
                start_time, end_time, duration_seconds, transcript,
                ai_messages_count, student_responses_count,
                final_status, final_rsvp, character_usage, voice_used, error_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        insertCallLog.run(
            id, callLog.contactId, callLog.batchId, callLog.language,
            callLog.startTime, callLog.endTime, callLog.duration,
            JSON.stringify(callLog.transcript), callLog.aiMessages,
            callLog.studentResponses, callLog.finalStatus, callLog.finalRsvp,
            callLog.characterUsage, callLog.voiceUsed ? 1 : 0, callLog.error
        );

        return id;
    }

    // Import existing CSV contacts
    async importContactsFromCSV(contacts) {
        const transaction = this.db.transaction((contacts) => {
            let imported = 0, skipped = 0;

            for (const contact of contacts) {
                try {
                    const result = this.addContact(contact.phone, contact.name, contact.email);
                    if (result.success) imported++;
                    else skipped++;
                } catch (error) {
                    skipped++;
                }
            }

            return { imported, skipped };
        });

        return transaction(contacts);
    }

    // Utility method to close database connection
    close() {
        this.db.close();
    }

    // Get database statistics
    async getSystemStats() {
        const totalContacts = this.db.prepare('SELECT COUNT(*) as count FROM contacts').get().count;
        const queuePending = this.db.prepare("SELECT COUNT(*) as count FROM call_queue WHERE status = 'pending'").get().count;
        const todaysBatch = await this.getTodaysBatch();
        const languageStats = await this.getLanguageUsageStats();

        return {
            totalContacts,
            queuePending,
            todaysBatch,
            languageDistribution: languageStats
        };
    }
}

export default AICallerDatabase;