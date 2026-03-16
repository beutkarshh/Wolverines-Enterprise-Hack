import pLimit from 'p-limit';
import pRetry from 'p-retry';
import { EventEmitter } from 'events';
import AICallerDatabase from './database.js';
import LanguageEngine from './languageEngine.js';
import CharacterManager from './characterManager.js';
import dotenv from 'dotenv';

dotenv.config();

class QueueProcessor extends EventEmitter {
    constructor() {
        super();

        this.db = new AICallerDatabase();
        this.languageEngine = new LanguageEngine();
        this.characterManager = new CharacterManager();

        // Configuration from environment
        this.config = {
            concurrentCalls: parseInt(process.env.CONCURRENT_CALLS) || 3,
            callInterval: parseInt(process.env.CALL_INTERVAL) || 4000,
            maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
            dailyBatchSize: parseInt(process.env.DAILY_BATCH_SIZE) || 750,
            geminiRateLimit: 15, // 15 requests per minute
            voicePriorityMode: process.env.VOICE_PRIORITY_MODE || 'smart'
        };

        // State management
        this.isRunning = false;
        this.isPaused = false;
        this.currentBatch = null;
        this.activeCallsCount = 0;
        this.processedToday = 0;
        this.successfulToday = 0;
        this.failedToday = 0;

        // Rate limiting
        this.geminiLimiter = pLimit(this.config.geminiRateLimit);
        this.callLimiter = pLimit(this.config.concurrentCalls);
        this.lastGeminiCall = 0;

        // Call statistics
        this.stats = {
            totalProcessed: 0,
            successful: 0,
            failed: 0,
            languageDistribution: { en: 0, hi: 0, mr: 0 },
            characterUsage: { en: 0, hi: 0, mr: 0, total: 0 }
        };

        console.log('🤖 Queue Processor initialized');
        console.log(`📊 Config: ${this.config.concurrentCalls} concurrent calls, ${this.config.callInterval}ms interval`);
    }

    // Main automation methods
    async startAutomation(batchSize = null) {
        if (this.isRunning) {
            console.log('⚠️  Automation already running');
            return false;
        }

        try {
            console.log('🚀 Starting automated batch processing...');

            this.isRunning = true;
            this.isPaused = false;

            // Create or get today's batch
            const targetSize = batchSize || this.config.dailyBatchSize;
            this.currentBatch = await this.createOrGetTodaysBatch(targetSize);

            // Load contacts into queue
            await this.loadContactsIntoQueue();

            // Start processing
            this.emit('automation:started', { batchId: this.currentBatch.id, targetSize });
            await this.processQueue();

            return true;
        } catch (error) {
            console.error('❌ Failed to start automation:', error);
            this.isRunning = false;
            this.emit('automation:error', error);
            return false;
        }
    }

    async pauseAutomation() {
        if (!this.isRunning) return false;

        this.isPaused = true;
        console.log('⏸️  Automation paused - waiting for active calls to complete');
        this.emit('automation:paused');
        return true;
    }

    async resumeAutomation() {
        if (!this.isRunning || !this.isPaused) return false;

        this.isPaused = false;
        console.log('▶️  Automation resumed');
        this.emit('automation:resumed');
        await this.processQueue();
        return true;
    }

    async stopAutomation() {
        console.log('🛑 Stopping automation...');
        this.isRunning = false;
        this.isPaused = false;

        // Wait for active calls to complete
        while (this.activeCallsCount > 0) {
            console.log(`⏳ Waiting for ${this.activeCallsCount} active calls to complete...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log('✅ Automation stopped gracefully');
        this.emit('automation:stopped');
        return true;
    }

    // Batch Management
    async createOrGetTodaysBatch(targetSize) {
        let batch = await this.db.getTodaysBatch();

        if (!batch) {
            console.log(`📅 Creating new daily batch for ${targetSize} contacts`);
            const batchId = await this.db.createDailyBatch(targetSize);
            batch = await this.db.getBatchStats(batchId);
        } else {
            console.log(`📅 Resuming existing batch: ${batch.processed_count}/${batch.target_size} processed`);
        }

        return batch;
    }

    async loadContactsIntoQueue() {
        // Get unprocessed contacts from database
        const contacts = await this.db.db.prepare(`
            SELECT c.* FROM contacts c
            LEFT JOIN call_queue cq ON c.id = cq.contact_id AND cq.batch_id = ?
            WHERE c.status IN ('not_called', 'callback') AND cq.id IS NULL
            LIMIT ?
        `).all(this.currentBatch.id, this.currentBatch.target_size - this.currentBatch.processed_count);

        if (contacts.length === 0) {
            console.log('📋 No contacts available for processing');
            return;
        }

        // Add contacts to queue with priority (callbacks get higher priority)
        await this.db.addContactsToQueue(
            contacts.map(c => ({
                ...c,
                priority: c.status === 'callback' ? 2 : 1
            })),
            this.currentBatch.id
        );

        console.log(`✅ Added ${contacts.length} contacts to processing queue`);
    }

    // Core Queue Processing
    async processQueue() {
        while (this.isRunning) {
            if (this.isPaused) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }

            // Get next batch of contacts to process
            const queueItems = await this.db.getNextCallsInQueue(this.config.concurrentCalls);

            if (queueItems.length === 0) {
                console.log('📋 Queue empty, checking for batch completion...');
                await this.checkBatchCompletion();
                break;
            }

            // Process calls concurrently with rate limiting
            const callPromises = queueItems.map(item =>
                this.callLimiter(() => this.processCall(item))
            );

            await Promise.allSettled(callPromises);

            // Brief pause between batches to respect rate limits
            if (this.isRunning) {
                await new Promise(resolve => setTimeout(resolve, this.config.callInterval));
            }
        }
    }

    async processCall(queueItem) {
        this.activeCallsCount++;
        const startTime = new Date();

        try {
            console.log(`📞 Starting call: ${queueItem.phone} (${queueItem.name})`);

            // Update queue item status
            await this.db.updateQueueStatus(queueItem.id, 'processing');

            // Rate limit Gemini API calls
            await this.enforceGeminiRateLimit();

            // Import CallManager here to avoid circular dependency
            const { default: CallManager } = await import('./callManager.js');
            const callManager = new CallManager(queueItem, this.languageEngine, this.characterManager);

            // Process the actual call
            const result = await pRetry(
                () => callManager.startCall(),
                {
                    retries: this.config.maxRetries,
                    onFailedAttempt: error => {
                        console.warn(`🔄 Call attempt failed for ${queueItem.phone}:`, error.message);
                        this.emit('call:retry', { queueItem, attempt: error.attemptNumber });
                    }
                }
            );

            // Log successful call
            await this.logCallResult(queueItem, result, startTime);
            await this.db.updateQueueStatus(queueItem.id, 'completed');

            this.stats.successful++;
            this.successfulToday++;

            console.log(`✅ Call completed: ${queueItem.phone} -> ${result.finalStatus}`);
            this.emit('call:completed', { queueItem, result });

        } catch (error) {
            // Log failed call
            await this.logCallResult(queueItem, { error: error.message }, startTime);
            await this.db.updateQueueStatus(queueItem.id, 'failed');

            this.stats.failed++;
            this.failedToday++;

            console.error(`❌ Call failed: ${queueItem.phone} - ${error.message}`);
            this.emit('call:failed', { queueItem, error });
        } finally {
            this.activeCallsCount--;
            this.stats.totalProcessed++;
            this.processedToday++;

            // Update batch progress
            await this.updateBatchProgress();

            this.emit('progress:update', this.getProgressStats());
        }
    }

    async enforceGeminiRateLimit() {
        const now = Date.now();
        const timeSinceLastCall = now - this.lastGeminiCall;
        const minInterval = (60 * 1000) / this.config.geminiRateLimit; // milliseconds between calls

        if (timeSinceLastCall < minInterval) {
            const waitTime = minInterval - timeSinceLastCall;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        this.lastGeminiCall = Date.now();
    }

    async logCallResult(queueItem, result, startTime) {
        const endTime = new Date();
        const duration = Math.floor((endTime - startTime) / 1000);

        const callLog = {
            contactId: queueItem.contact_id,
            batchId: this.currentBatch.id,
            language: result.language || 'en',
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            duration,
            transcript: result.transcript || [],
            aiMessages: result.aiMessages || 0,
            studentResponses: result.studentResponses || 0,
            finalStatus: result.finalStatus || 'failed',
            finalRsvp: result.finalRsvp || 'none',
            characterUsage: result.characterUsage || 0,
            voiceUsed: result.voiceUsed || false,
            error: result.error || null
        };

        await this.db.logCall(callLog);

        // Update character usage stats
        if (result.characterUsage) {
            const language = result.language || 'en';
            this.stats.characterUsage[language] += result.characterUsage;
            this.stats.characterUsage.total += result.characterUsage;
        }

        // Update language distribution
        if (result.language) {
            this.stats.languageDistribution[result.language]++;
        }
    }

    async updateBatchProgress() {
        const stats = {
            processed: this.processedToday,
            successful: this.successfulToday,
            failed: this.failedToday,
            charUsage: this.stats.characterUsage
        };

        await this.db.updateBatchProgress(this.currentBatch.id, stats);
    }

    async checkBatchCompletion() {
        if (this.processedToday >= this.currentBatch.target_size) {
            console.log('🎉 Daily batch completed!');

            // Update batch status to completed
            await this.db.db.prepare(`
                UPDATE daily_batches
                SET status = 'completed', completed_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(this.currentBatch.id);

            this.emit('batch:completed', {
                batchId: this.currentBatch.id,
                stats: this.getProgressStats()
            });

            await this.stopAutomation();
        }
    }

    // Statistics and Monitoring
    getProgressStats() {
        return {
            batchId: this.currentBatch?.id,
            isRunning: this.isRunning,
            isPaused: this.isPaused,
            activeCallsCount: this.activeCallsCount,
            progress: {
                processed: this.processedToday,
                successful: this.successfulToday,
                failed: this.failedToday,
                target: this.currentBatch?.target_size || 0,
                percentage: this.currentBatch ? Math.round((this.processedToday / this.currentBatch.target_size) * 100) : 0
            },
            characterUsage: this.stats.characterUsage,
            languageDistribution: this.stats.languageDistribution,
            totalStats: {
                totalProcessed: this.stats.totalProcessed,
                successful: this.stats.successful,
                failed: this.stats.failed,
                successRate: this.stats.totalProcessed > 0 ? Math.round((this.stats.successful / this.stats.totalProcessed) * 100) : 0
            }
        };
    }

    async getSystemHealth() {
        const dbStats = await this.db.getSystemStats();
        const charManager = await this.characterManager.getDailyUsage();

        return {
            processor: this.getProgressStats(),
            database: dbStats,
            characterManager: charManager,
            rateLimit: {
                geminiLastCall: this.lastGeminiCall,
                geminiLimit: this.config.geminiRateLimit,
                concurrentLimit: this.config.concurrentCalls,
                activeCalls: this.activeCallsCount
            }
        };
    }

    // Graceful shutdown
    async shutdown() {
        console.log('🔄 Shutting down Queue Processor...');

        if (this.isRunning) {
            await this.stopAutomation();
        }

        // Close connections
        await this.languageEngine.close();
        this.db.close();

        console.log('✅ Queue Processor shutdown complete');
    }
}

export default QueueProcessor;