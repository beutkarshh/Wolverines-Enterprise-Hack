import AICallerDatabase from './database.js';
import dotenv from 'dotenv';

dotenv.config();

class CharacterManager {
    constructor() {
        this.db = new AICallerDatabase();

        // Configuration from environment
        this.config = {
            monthlyLimit: parseInt(process.env.ELEVENLABS_CHAR_LIMIT) || 30000,
            dailyBudget: parseInt(process.env.ELEVENLABS_DAILY_BUDGET) || 1000,
            languageAllocation: this.parseLanguageAllocation(),
            borrowingEnabled: process.env.ENABLE_CHAR_BORROWING !== 'false',
            warningThreshold: 0.8, // 80% usage warning
            emergencyThreshold: 0.95 // 95% usage emergency stop
        };

        // Cache for performance
        this.todayUsageCache = null;
        this.monthlyUsageCache = null;
        this.lastCacheUpdate = null;

        console.log('💰 CharacterManager initialized');
        console.log(`📊 Budget: ${this.config.dailyBudget}/day (${this.config.monthlyLimit}/month)`);
        console.log(`🌐 Language allocation: MR:${this.config.languageAllocation.mr}, HI:${this.config.languageAllocation.hi}, EN:${this.config.languageAllocation.en}`);
    }

    parseLanguageAllocation() {
        const allocation = process.env.LANGUAGE_CHAR_ALLOCATION?.split(',').map(Number) || [334, 333, 333];
        return {
            mr: allocation[0] || 334, // Marathi
            hi: allocation[1] || 333, // Hindi
            en: allocation[2] || 333  // English
        };
    }

    // Main usage tracking methods
    async addUsage(language, characterCount, context = {}) {
        try {
            if (!['en', 'hi', 'mr'].includes(language)) {
                console.warn(`Invalid language code: ${language}, defaulting to 'en'`);
                language = 'en';
            }

            // Update database with usage
            await this.recordUsage(language, characterCount, context);

            // Update cache
            await this.updateCache();

            // Check if approaching limits
            await this.checkLimits(language);

            console.log(`💸 Used ${characterCount} characters for ${language.toUpperCase()}`);

            return { success: true, remainingBudget: await this.getRemainingBudget(language) };

        } catch (error) {
            console.error('Error adding character usage:', error);
            return { success: false, error: error.message };
        }
    }

    async recordUsage(language, characterCount, context) {
        const today = new Date().toISOString().split('T')[0];

        // Insert usage record
        const insertUsage = this.db.db.prepare(`
            INSERT INTO character_usage (
                id, date, language, character_count, context, created_at
            ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);

        // Create table if it doesn't exist
        this.db.db.exec(`
            CREATE TABLE IF NOT EXISTS character_usage (
                id TEXT PRIMARY KEY,
                date DATE NOT NULL,
                language TEXT NOT NULL CHECK (language IN ('en', 'hi', 'mr')),
                character_count INTEGER NOT NULL,
                context TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        insertUsage.run(
            `usage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            today,
            language,
            characterCount,
            JSON.stringify(context)
        );

        // Update daily batch statistics
        const todaysBatch = await this.db.getTodaysBatch();
        if (todaysBatch) {
            const updateField = `character_usage_${language}`;
            const currentUsage = todaysBatch[updateField] || 0;

            const updateBatchUsage = this.db.db.prepare(`
                UPDATE daily_batches
                SET ${updateField} = ?, character_usage_total = character_usage_total + ?
                WHERE id = ?
            `);

            updateBatchUsage.run(currentUsage + characterCount, characterCount, todaysBatch.id);
        }
    }

    // Budget checking methods
    async canAffordUsage(language, characterCount) {
        try {
            const usage = await this.getTodayUsage();
            const remainingBudget = await this.getRemainingBudget(language);

            // Check direct budget
            if (remainingBudget >= characterCount) {
                return { canAfford: true, reason: 'within_budget' };
            }

            // Check if borrowing is enabled and possible
            if (this.config.borrowingEnabled) {
                const borrowResult = await this.canBorrowFromOtherLanguages(language, characterCount);
                if (borrowResult.canBorrow) {
                    return { canAfford: true, reason: 'borrowed', fromLanguage: borrowResult.fromLanguage };
                }
            }

            // Check monthly limit
            const monthlyUsage = await this.getMonthlyUsage();
            const monthlyRemaining = this.config.monthlyLimit - monthlyUsage.total;

            if (monthlyRemaining < characterCount) {
                return { canAfford: false, reason: 'monthly_limit_exceeded' };
            }

            return { canAfford: false, reason: 'daily_budget_exceeded' };

        } catch (error) {
            console.error('Error checking budget:', error);
            return { canAfford: false, reason: 'error', error: error.message };
        }
    }

    async canBorrowFromOtherLanguages(targetLanguage, neededChars) {
        const usage = await this.getTodayUsage();
        const allocation = this.config.languageAllocation;

        // Check each other language for unused budget
        for (const [lang, dailyAllocation] of Object.entries(allocation)) {
            if (lang === targetLanguage) continue;

            const languageUsed = usage[lang] || 0;
            const languageAvailable = dailyAllocation - languageUsed;

            if (languageAvailable >= neededChars) {
                return { canBorrow: true, fromLanguage: lang, availableAmount: languageAvailable };
            }
        }

        return { canBorrow: false };
    }

    async getRemainingBudget(language) {
        const usage = await this.getTodayUsage();
        const allocation = this.config.languageAllocation[language] || 333;
        const used = usage[language] || 0;

        return Math.max(0, allocation - used);
    }

    // Usage retrieval methods
    async getTodayUsage() {
        // Use cache if recent
        if (this.todayUsageCache && this.isCacheValid()) {
            return this.todayUsageCache;
        }

        const today = new Date().toISOString().split('T')[0];

        const usage = this.db.db.prepare(`
            SELECT
                language,
                SUM(character_count) as total_chars
            FROM character_usage
            WHERE date = ?
            GROUP BY language
        `).all(today);

        const result = { en: 0, hi: 0, mr: 0, total: 0 };

        for (const row of usage) {
            result[row.language] = row.total_chars;
            result.total += row.total_chars;
        }

        // Update cache
        this.todayUsageCache = result;
        this.lastCacheUpdate = Date.now();

        return result;
    }

    async getMonthlyUsage() {
        // Use cache if recent
        if (this.monthlyUsageCache && this.isCacheValid()) {
            return this.monthlyUsageCache;
        }

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const usage = this.db.db.prepare(`
            SELECT
                language,
                SUM(character_count) as total_chars
            FROM character_usage
            WHERE date >= ?
            GROUP BY language
        `).all(startOfMonth.toISOString().split('T')[0]);

        const result = { en: 0, hi: 0, mr: 0, total: 0 };

        for (const row of usage) {
            result[row.language] = row.total_chars;
            result.total += row.total_chars;
        }

        // Update cache
        this.monthlyUsageCache = result;
        this.lastCacheUpdate = Date.now();

        return result;
    }

    async getDailyUsage() {
        const todayUsage = await this.getTodayUsage();
        const allocation = this.config.languageAllocation;

        return {
            usage: todayUsage,
            allocation: allocation,
            remaining: {
                en: Math.max(0, allocation.en - todayUsage.en),
                hi: Math.max(0, allocation.hi - todayUsage.hi),
                mr: Math.max(0, allocation.mr - todayUsage.mr),
                total: Math.max(0, this.config.dailyBudget - todayUsage.total)
            },
            percentageUsed: {
                en: Math.round((todayUsage.en / allocation.en) * 100),
                hi: Math.round((todayUsage.hi / allocation.hi) * 100),
                mr: Math.round((todayUsage.mr / allocation.mr) * 100),
                total: Math.round((todayUsage.total / this.config.dailyBudget) * 100)
            }
        };
    }

    // Limit checking and alerts
    async checkLimits(language) {
        const dailyUsage = await this.getDailyUsage();
        const monthlyUsage = await this.getMonthlyUsage();

        // Check daily limits
        const dailyPercentage = dailyUsage.percentageUsed[language];
        if (dailyPercentage >= this.config.emergencyThreshold * 100) {
            console.error(`🚨 EMERGENCY: ${language.toUpperCase()} daily budget at ${dailyPercentage}%!`);
            this.emit('limit:emergency', { language, percentage: dailyPercentage, type: 'daily' });
        } else if (dailyPercentage >= this.config.warningThreshold * 100) {
            console.warn(`⚠️  WARNING: ${language.toUpperCase()} daily budget at ${dailyPercentage}%`);
            this.emit('limit:warning', { language, percentage: dailyPercentage, type: 'daily' });
        }

        // Check monthly limits
        const monthlyPercentage = (monthlyUsage.total / this.config.monthlyLimit) * 100;
        if (monthlyPercentage >= this.config.emergencyThreshold * 100) {
            console.error(`🚨 EMERGENCY: Monthly budget at ${monthlyPercentage}%!`);
            this.emit('limit:emergency', { language: 'all', percentage: monthlyPercentage, type: 'monthly' });
        } else if (monthlyPercentage >= this.config.warningThreshold * 100) {
            console.warn(`⚠️  WARNING: Monthly budget at ${monthlyPercentage}%`);
            this.emit('limit:warning', { language: 'all', percentage: monthlyPercentage, type: 'monthly' });
        }
    }

    // Cache management
    isCacheValid() {
        const CACHE_TTL = 60000; // 1 minute
        return this.lastCacheUpdate && (Date.now() - this.lastCacheUpdate) < CACHE_TTL;
    }

    async updateCache() {
        this.todayUsageCache = null;
        this.monthlyUsageCache = null;
        this.lastCacheUpdate = null;

        // Refresh cache
        await this.getTodayUsage();
        await this.getMonthlyUsage();
    }

    // Analytics and reporting
    async getUsageAnalytics(days = 7) {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - days);

        const analytics = this.db.db.prepare(`
            SELECT
                date,
                language,
                SUM(character_count) as daily_chars,
                COUNT(*) as usage_count
            FROM character_usage
            WHERE date >= ? AND date <= ?
            GROUP BY date, language
            ORDER BY date DESC, language
        `).all(
            startDate.toISOString().split('T')[0],
            endDate.toISOString().split('T')[0]
        );

        return this.processAnalytics(analytics);
    }

    processAnalytics(rawData) {
        const processed = {
            daily: {},
            totals: { en: 0, hi: 0, mr: 0, total: 0 },
            averages: { en: 0, hi: 0, mr: 0, total: 0 }
        };

        const dayCount = new Set();

        for (const row of rawData) {
            if (!processed.daily[row.date]) {
                processed.daily[row.date] = { en: 0, hi: 0, mr: 0, total: 0 };
            }

            processed.daily[row.date][row.language] = row.daily_chars;
            processed.daily[row.date].total += row.daily_chars;

            processed.totals[row.language] += row.daily_chars;
            processed.totals.total += row.daily_chars;

            dayCount.add(row.date);
        }

        // Calculate averages
        const numDays = dayCount.size;
        if (numDays > 0) {
            processed.averages.en = Math.round(processed.totals.en / numDays);
            processed.averages.hi = Math.round(processed.totals.hi / numDays);
            processed.averages.mr = Math.round(processed.totals.mr / numDays);
            processed.averages.total = Math.round(processed.totals.total / numDays);
        }

        return processed;
    }

    // Optimization suggestions
    async getOptimizationSuggestions() {
        const dailyUsage = await this.getDailyUsage();
        const monthlyUsage = await this.getMonthlyUsage();
        const analytics = await this.getUsageAnalytics(7);

        const suggestions = [];

        // Check for underutilized languages
        for (const [lang, percentage] of Object.entries(dailyUsage.percentageUsed)) {
            if (lang === 'total') continue;

            if (percentage < 50) {
                suggestions.push({
                    type: 'underutilization',
                    language: lang,
                    message: `${lang.toUpperCase()} is only ${percentage}% utilized. Consider promoting voice usage for ${lang.toUpperCase()} responses.`,
                    priority: 'medium'
                });
            }
        }

        // Check for over-utilization
        for (const [lang, percentage] of Object.entries(dailyUsage.percentageUsed)) {
            if (lang === 'total') continue;

            if (percentage > 90) {
                suggestions.push({
                    type: 'overutilization',
                    language: lang,
                    message: `${lang.toUpperCase()} budget is ${percentage}% used. Consider reducing voice usage or enabling text fallback.`,
                    priority: 'high'
                });
            }
        }

        // Monthly trajectory warning
        if (monthlyUsage.total > this.config.monthlyLimit * 0.8) {
            const daysLeft = 30 - new Date().getDate();
            const projectedUsage = (monthlyUsage.total / new Date().getDate()) * 30;

            if (projectedUsage > this.config.monthlyLimit) {
                suggestions.push({
                    type: 'monthly_trajectory',
                    message: `On track to exceed monthly limit. Projected: ${Math.round(projectedUsage)} chars. Consider reducing voice usage.`,
                    priority: 'high'
                });
            }
        }

        return suggestions;
    }

    // Utility methods
    async resetDailyCache() {
        this.todayUsageCache = null;
        this.lastCacheUpdate = null;
        await this.getTodayUsage();
    }

    async close() {
        // Character manager doesn't maintain persistent connections
        // Just clear cache
        this.todayUsageCache = null;
        this.monthlyUsageCache = null;
    }

    // Event emitter methods (if extending EventEmitter)
    emit(event, data) {
        // Simple console logging for now, can be extended to proper event emission
        console.log(`📊 CharacterManager Event: ${event}`, data);
    }
}

export default CharacterManager;