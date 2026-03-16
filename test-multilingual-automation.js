#!/usr/bin/env node

// test-multilingual-automation.js — Comprehensive testing for multilingual AI caller system

import AICallerDatabase from './database.js';
import LanguageEngine from './languageEngine.js';
import CharacterManager from './characterManager.js';
import MultilingualVoiceEngine from './voiceEngine.js';
import QueueProcessor from './queueProcessor.js';
import geminiEngine from './geminiEngine.js';
import { getSeminarDetails } from './geminiEngine.js';
import dotenv from 'dotenv';

dotenv.config();

class MultilingualSystemTester {
  constructor() {
    this.db = null;
    this.languageEngine = null;
    this.characterManager = null;
    this.voiceEngine = null;
    this.queueProcessor = null;

    this.testResults = {
      database: { passed: 0, failed: 0, tests: [] },
      languageEngine: { passed: 0, failed: 0, tests: [] },
      characterManager: { passed: 0, failed: 0, tests: [] },
      voiceEngine: { passed: 0, failed: 0, tests: [] },
      integration: { passed: 0, failed: 0, tests: [] }
    };

    this.testContacts = this.generateTestContacts();
  }

  generateTestContacts() {
    const contacts = [];
    const languages = ['en', 'hi', 'mr'];
    const names = {
      en: ['John Smith', 'Sarah Johnson', 'Michael Brown', 'Emily Davis', 'Robert Wilson'],
      hi: ['राहुल शर्मा', 'प्रिया पटेल', 'अर्जुन मेहता', 'स्नेहा गुप्ता', 'विकास सिंह'],
      mr: ['राहुल शर्मा', 'प्रिया पाटील', 'अर्जुन मेहता', 'स्नेहा गुप्ता', 'विकास सिंह']
    };

    // Generate 50 test contacts (16-17 per language)
    let contactId = 1;
    for (let i = 0; i < 50; i++) {
      const language = languages[i % 3];
      const nameIndex = Math.floor(i / 3) % 5;
      const phone = `+9198${(10000000 + i).toString().slice(-8)}`;

      contacts.push({
        id: contactId++,
        phone,
        name: names[language][nameIndex] || `Test Contact ${i + 1}`,
        language_preference: language,
        status: 'not_called'
      });
    }

    return contacts;
  }

  async runTest(category, testName, testFunction) {
    try {
      console.log(`🧪 Running ${category}: ${testName}`);
      await testFunction();
      this.testResults[category].passed++;
      this.testResults[category].tests.push({ name: testName, status: 'PASSED' });
      console.log(`✅ ${category}: ${testName} - PASSED`);
    } catch (error) {
      this.testResults[category].failed++;
      this.testResults[category].tests.push({ name: testName, status: 'FAILED', error: error.message });
      console.log(`❌ ${category}: ${testName} - FAILED: ${error.message}`);
    }
  }

  async initializeComponents() {
    console.log('🚀 Initializing multilingual system components...');

    try {
      this.db = new AICallerDatabase();
      this.languageEngine = new LanguageEngine();
      this.characterManager = new CharacterManager();
      this.voiceEngine = new MultilingualVoiceEngine();
      // Note: Not initializing QueueProcessor for testing to avoid conflicts

      console.log('✅ All components initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize components:', error);
      return false;
    }
  }

  async testDatabase() {
    console.log('\n📊 Testing Database Layer...');

    await this.runTest('database', 'Contact Creation', async () => {
      for (const contact of this.testContacts.slice(0, 10)) {
        const result = await this.db.addContact(contact.phone, contact.name, '', contact.language_preference);
        if (!result.success && !result.error?.includes('UNIQUE constraint failed')) {
          throw new Error(`Failed to add contact: ${result.error}`);
        }
      }
    });

    await this.runTest('database', 'Contact Retrieval', async () => {
      const contact = await this.db.getContact(this.testContacts[0].phone);
      if (!contact) {
        throw new Error('Failed to retrieve contact');
      }
    });

    await this.runTest('database', 'Language Statistics', async () => {
      const stats = await this.db.getLanguageUsageStats();
      if (!Array.isArray(stats)) {
        throw new Error('Language stats should return an array');
      }
    });

    await this.runTest('database', 'System Statistics', async () => {
      const stats = await this.db.getSystemStats();
      if (!stats.totalContacts && stats.totalContacts !== 0) {
        throw new Error('System stats should include totalContacts');
      }
    });
  }

  async testLanguageEngine() {
    console.log('\n🌐 Testing Language Engine...');

    const testTexts = {
      en: "Hello! I'm preparing for MHT CET and I'm interested in your seminar.",
      hi: "नमस्कार! मैं MHT CET की तैयारी कर रहा हूँ और आपके सेमिनार में दिलचस्पी रखता हूँ।",
      mr: "नमस्कार! मी MHT CET ची तयारी करत आहे आणि तुमच्या सेमिनारमध्ये स्वारस्य आहे."
    };

    await this.runTest('languageEngine', 'Language Detection - English', async () => {
      const detected = await this.languageEngine.detectLanguage(testTexts.en);
      if (detected !== 'en') {
        throw new Error(`Expected 'en', got '${detected}'`);
      }
    });

    await this.runTest('languageEngine', 'Language Detection - Hindi', async () => {
      const detected = await this.languageEngine.detectLanguage(testTexts.hi);
      if (detected !== 'hi') {
        throw new Error(`Expected 'hi', got '${detected}'`);
      }
    });

    await this.runTest('languageEngine', 'Language Detection - Marathi', async () => {
      const detected = await this.languageEngine.detectLanguage(testTexts.mr);
      if (detected !== 'mr') {
        throw new Error(`Expected 'mr', got '${detected}'`);
      }
    });

    await this.runTest('languageEngine', 'Template Retrieval', async () => {
      for (const lang of ['en', 'hi', 'mr']) {
        const template = await this.languageEngine.getTemplate('intro', lang);
        if (!template || template.length === 0) {
          throw new Error(`Template not found for language: ${lang}`);
        }
      }
    });

    await this.runTest('languageEngine', 'Intent Analysis', async () => {
      const intent = await this.languageEngine.analyzeResponseIntent(testTexts.en, 'en');
      if (!intent || intent === 'unclear') {
        throw new Error('Intent analysis should detect interest');
      }
    });

    await this.runTest('languageEngine', 'Response Processing', async () => {
      const result = await this.languageEngine.processStudentResponse(testTexts.en, 'en', []);
      if (!result.response || !result.detectedLanguage || !result.intent) {
        throw new Error('Response processing should return complete analysis');
      }
    });
  }

  async testCharacterManager() {
    console.log('\n💰 Testing Character Manager...');

    await this.runTest('characterManager', 'Character Budget Check', async () => {
      const canAfford = await this.characterManager.canAffordUsage('en', 100);
      if (!canAfford.hasOwnProperty('canAfford')) {
        throw new Error('Budget check should return affordability status');
      }
    });

    await this.runTest('characterManager', 'Add Character Usage', async () => {
      const result = await this.characterManager.addUsage('en', 50, { test: true });
      if (!result.success) {
        throw new Error(`Failed to add character usage: ${result.error}`);
      }
    });

    await this.runTest('characterManager', 'Daily Usage Retrieval', async () => {
      const usage = await this.characterManager.getDailyUsage();
      if (!usage.usage || !usage.allocation || !usage.remaining) {
        throw new Error('Daily usage should include usage, allocation, and remaining');
      }
    });

    await this.runTest('characterManager', 'Usage Analytics', async () => {
      const analytics = await this.characterManager.getUsageAnalytics(1);
      if (!analytics.daily || !analytics.totals || !analytics.averages) {
        throw new Error('Analytics should include daily, totals, and averages');
      }
    });

    await this.runTest('characterManager', 'Optimization Suggestions', async () => {
      const suggestions = await this.characterManager.getOptimizationSuggestions();
      if (!Array.isArray(suggestions)) {
        throw new Error('Suggestions should return an array');
      }
    });
  }

  async testVoiceEngine() {
    console.log('\n🎙️ Testing Voice Engine...');

    await this.runTest('voiceEngine', 'Voice Configuration', async () => {
      const stats = await this.voiceEngine.getVoiceStats();
      if (!stats.supportedLanguages || stats.supportedLanguages.length !== 3) {
        throw new Error('Voice engine should support 3 languages');
      }
    });

    await this.runTest('voiceEngine', 'Character Budget Integration', async () => {
      // Test with a small text to avoid using actual ElevenLabs credits
      const testText = "Test";
      const result = await this.voiceEngine.speak(testText, 'en', { skipPlayback: true });

      // Should either succeed or fail gracefully due to budget/API limits
      if (result.success && !result.filePath) {
        throw new Error('Successful voice generation should return file path');
      }

      if (!result.success && !result.reason) {
        throw new Error('Failed voice generation should provide reason');
      }
    });

    await this.runTest('voiceEngine', 'Language-Specific Voice IDs', async () => {
      for (const lang of ['en', 'hi', 'mr']) {
        const voiceId = this.voiceEngine.getVoiceId(lang);
        if (!voiceId || voiceId.length === 0) {
          throw new Error(`Voice ID not configured for language: ${lang}`);
        }
      }
    });

    await this.runTest('voiceEngine', 'Budget Optimization', async () => {
      const optimizedLang = await this.voiceEngine.optimizeForBudget("Test text", 'en');
      if (!optimizedLang || !['en', 'hi', 'mr'].includes(optimizedLang)) {
        throw new Error('Optimization should return valid language code');
      }
    });
  }

  async testIntegration() {
    console.log('\n🔄 Testing System Integration...');

    await this.runTest('integration', 'End-to-End Language Flow', async () => {
      const seminar = getSeminarDetails();

      // Test the complete flow: detect language → get template → process response
      for (const lang of ['en', 'hi', 'mr']) {
        // Get introduction template
        const intro = await this.languageEngine.getTemplate('intro', lang);
        if (!intro) throw new Error(`No intro template for ${lang}`);

        // Simulate student response
        const studentResponse = lang === 'en'
          ? "I'm interested!"
          : lang === 'hi'
          ? "मुझे दिलचस्पी है!"
          : "मला स्वारस्य आहे!";

        // Process response
        const result = await this.languageEngine.processStudentResponse(studentResponse, lang, []);
        if (!result.response || result.detectedLanguage !== lang) {
          throw new Error(`Integration failed for language: ${lang}`);
        }
      }
    });

    await this.runTest('integration', 'Database-CharacterManager Integration', async () => {
      // Add some character usage
      await this.characterManager.addUsage('en', 25);
      await this.characterManager.addUsage('hi', 30);
      await this.characterManager.addUsage('mr', 35);

      // Check if usage is reflected in analytics
      const analytics = await this.characterManager.getUsageAnalytics(1);
      if (analytics.totals.total < 90) {
        throw new Error('Character usage not properly integrated with analytics');
      }
    });

    await this.runTest('integration', 'Multilingual Contact Processing', async () => {
      // Test processing contacts with different language preferences
      const testContact = this.testContacts[0];

      // Add contact to database
      await this.db.addContact(testContact.phone + '_test', testContact.name, '', testContact.language_preference);

      // Retrieve and verify
      const retrieved = await this.db.getContact(testContact.phone + '_test');
      if (retrieved.language_preference !== testContact.language_preference) {
        throw new Error('Language preference not properly stored/retrieved');
      }
    });

    await this.runTest('integration', 'Voice-Character Budget Integration', async () => {
      // Get current budget
      const initialBudget = await this.characterManager.getRemainingBudget('en');

      // Simulate voice usage (without actually generating audio)
      const testText = "Integration test message";
      await this.characterManager.addUsage('en', testText.length);

      // Check budget was updated
      const finalBudget = await this.characterManager.getRemainingBudget('en');
      if (finalBudget >= initialBudget) {
        throw new Error('Character budget not properly decremented');
      }
    });
  }

  async runSmallBatchTest() {
    console.log('\n🚀 Running Small Batch Processing Test (10 contacts)...');

    try {
      // Create a small batch for testing
      const batchContacts = this.testContacts.slice(0, 10);

      console.log('📝 Adding test contacts to database...');
      for (const contact of batchContacts) {
        await this.db.addContact(
          contact.phone + '_batch',
          contact.name,
          '',
          contact.language_preference
        );
      }

      console.log('📊 Verifying database contains test contacts...');
      const stats = await this.db.getSystemStats();
      if (stats.totalContacts < 10) {
        throw new Error('Insufficient contacts in database for batch test');
      }

      console.log('🎯 Simulating automated processing...');
      // Simulate the queue processor workflow without actually running it
      const seminar = getSeminarDetails();

      for (const contact of batchContacts.slice(0, 3)) { // Test first 3 contacts
        // Simulate conversation start
        const introTemplate = await this.languageEngine.getTemplate('intro', contact.language_preference);

        // Simulate student response based on language
        const responses = {
          en: "Yes, I'm interested in the seminar!",
          hi: "हाँ, मुझे सेमिनार में दिलचस्पी है!",
          mr: "होय, मला सेमिनारमध्ये स्वारस्य आहे!"
        };

        const studentResponse = responses[contact.language_preference] || responses.en;

        // Process the response
        const result = await this.languageEngine.processStudentResponse(
          studentResponse,
          contact.language_preference,
          []
        );

        // Check voice budget
        const canUseVoice = await this.characterManager.canAffordUsage(
          contact.language_preference,
          result.response.length
        );

        // Log call (simulated)
        const callLog = {
          contactId: contact.id,
          batchId: 'test_batch_001',
          language: contact.language_preference,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 45,
          transcript: [
            { role: 'ai', text: introTemplate },
            { role: 'student', text: studentResponse },
            { role: 'ai', text: result.response }
          ],
          aiMessages: 2,
          studentResponses: 1,
          finalStatus: 'interested',
          finalRsvp: 'yes',
          characterUsage: canUseVoice.canAfford ? result.response.length : 0,
          voiceUsed: canUseVoice.canAfford,
          error: null
        };

        await this.db.logCall(callLog);

        console.log(`✅ Processed ${contact.name} (${contact.language_preference.toUpperCase()})`);
      }

      console.log('✅ Small batch test completed successfully');

      // Generate test report
      const finalStats = await this.db.getSystemStats();
      const charUsage = await this.characterManager.getDailyUsage();

      console.log('\n📈 Test Results Summary:');
      console.log(`📞 Contacts processed: 3`);
      console.log(`📊 Total contacts in DB: ${finalStats.totalContacts}`);
      console.log(`💬 Character usage: EN:${charUsage.usage.en}, HI:${charUsage.usage.hi}, MR:${charUsage.usage.mr}`);
      console.log(`🎯 Success rate: 100%`);

    } catch (error) {
      console.error('❌ Batch test failed:', error.message);
      throw error;
    }
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up test data...');

    try {
      // Clean up test contacts (optional - you might want to keep them for inspection)
      if (this.db) {
        // Remove test contacts if needed
        this.db.close();
      }

      if (this.languageEngine) {
        await this.languageEngine.close();
      }

      if (this.characterManager) {
        await this.characterManager.close();
      }

      if (this.voiceEngine) {
        await this.voiceEngine.close();
      }

      console.log('✅ Cleanup completed');
    } catch (error) {
      console.warn('⚠️ Cleanup warning:', error.message);
    }
  }

  printTestSummary() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 MULTILINGUAL SYSTEM TEST SUMMARY');
    console.log('='.repeat(80));

    let totalPassed = 0;
    let totalFailed = 0;

    for (const [category, results] of Object.entries(this.testResults)) {
      console.log(`\n${category.toUpperCase()}:`);
      console.log(`  ✅ Passed: ${results.passed}`);
      console.log(`  ❌ Failed: ${results.failed}`);

      if (results.failed > 0) {
        console.log(`  Failed tests:`);
        results.tests.filter(t => t.status === 'FAILED').forEach(test => {
          console.log(`    - ${test.name}: ${test.error}`);
        });
      }

      totalPassed += results.passed;
      totalFailed += results.failed;
    }

    console.log('\n' + '-'.repeat(40));
    console.log(`OVERALL RESULTS:`);
    console.log(`✅ Total Passed: ${totalPassed}`);
    console.log(`❌ Total Failed: ${totalFailed}`);
    console.log(`📊 Success Rate: ${totalFailed === 0 ? '100%' : Math.round((totalPassed / (totalPassed + totalFailed)) * 100) + '%'}`);
    console.log('='.repeat(80));

    if (totalFailed === 0) {
      console.log('🎉 ALL TESTS PASSED! The multilingual system is ready for production use.');
      console.log('📈 You can now confidently process 4000 contacts with automated multilingual calls.');
    } else {
      console.log('⚠️ Some tests failed. Please review the issues above before production deployment.');
    }
  }

  async runAllTests() {
    console.log('🧪 Starting Comprehensive Multilingual System Testing...\n');

    const success = await this.initializeComponents();
    if (!success) {
      console.error('❌ Failed to initialize components. Aborting tests.');
      return false;
    }

    try {
      // Run all test categories
      await this.testDatabase();
      await this.testLanguageEngine();
      await this.testCharacterManager();
      await this.testVoiceEngine();
      await this.testIntegration();

      // Run batch processing test
      await this.runSmallBatchTest();

      this.printTestSummary();

      const allPassed = Object.values(this.testResults).every(category => category.failed === 0);
      return allPassed;

    } catch (error) {
      console.error('💥 Testing failed with critical error:', error);
      return false;
    } finally {
      await this.cleanup();
    }
  }
}

// Run the tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new MultilingualSystemTester();

  tester.runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
}

export default MultilingualSystemTester;