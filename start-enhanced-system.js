#!/usr/bin/env node

// start-enhanced-system.js — Launch script for multilingual AI caller automation

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

console.log(`
╔══════════════════════════════════════════════════════════════════════════════════╗
║                🎯 MULTILINGUAL AI CALLER AUTOMATION SYSTEM                      ║
║                          Enhanced for 4000 Contacts                             ║
╚══════════════════════════════════════════════════════════════════════════════════╝

🌟 SYSTEM CAPABILITIES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Automated Processing: 4000 contacts in daily batches (500-1000/day)
✅ Multilingual Support: English, Hindi, Marathi with AI detection
✅ Smart Voice Allocation: 30K ElevenLabs characters across 3 languages
✅ Concurrent Processing: 3-5 simultaneous conversations with rate limiting
✅ Database-Backed: SQLite with full conversation logging and analytics
✅ Real-time Dashboard: Automation controls, progress tracking, language stats
✅ Production Ready: Error recovery, retry logic, graceful shutdown

🎯 KEY FEATURES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 AI-Powered Language Detection: Detects student's preferred language mid-conversation
🎙️ Smart Voice Budget: Optimizes ElevenLabs usage across Marathi/Hindi/English
📊 Character Management: 334/333/333 daily allocation with cross-language borrowing
🔄 Queue Processing: Persistent queues with resume capability after interruptions
💬 Cultural Adaptation: Respectful conversation flows for Indian students
📈 Analytics Dashboard: Real-time monitoring of calls, success rates, language distribution
🛡️ Enterprise Reliability: Rate limiting, error handling, comprehensive logging

`);

// Check environment setup
function checkEnvironment() {
  console.log('🔍 Checking system environment...\n');

  const requiredEnvVars = [
    'GEMINI_API_KEY',
    'ELEVENLABS_API_KEY',
    'ELEVENLABS_VOICE_EN',
    'SEMINAR_NAME',
    'SEMINAR_DATE',
    'SEMINAR_TOPIC'
  ];

  const missing = requiredEnvVars.filter(key => !process.env[key] || process.env[key] === 'your_api_key_here');

  if (missing.length > 0) {
    console.log('⚠️ MISSING ENVIRONMENT VARIABLES:');
    missing.forEach(key => console.log(`   - ${key}`));
    console.log('\n📝 Please update your .env file with the required API keys and configuration.');
    console.log('📖 See .env.example for reference.\n');
    return false;
  }

  console.log('✅ Environment configuration: OK');
  return true;
}

// Check dependencies
function checkDependencies() {
  console.log('📦 Checking dependencies...');

  try {
    const package_json = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
    const required = ['better-sqlite3', 'p-retry', 'p-limit', 'uuid'];

    const missing = required.filter(dep => !package_json.dependencies[dep]);

    if (missing.length > 0) {
      console.log('❌ Missing dependencies:', missing.join(', '));
      console.log('🔧 Run: npm install');
      return false;
    }

    console.log('✅ Dependencies: OK');
    return true;
  } catch (error) {
    console.log('❌ Error checking dependencies:', error.message);
    return false;
  }
}

// Display launch options
function displayLaunchOptions() {
  console.log(`
🚀 LAUNCH OPTIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣  ENHANCED DASHBOARD (Recommended for setup and monitoring)
    └── Full automation controls + manual mode
    └── Real-time progress tracking and language analytics
    └── Command: npm run dashboard

2️⃣  TEST SYSTEM (Run first to validate setup)
    └── Tests all components with 50+ multilingual scenarios
    └── Validates API connections and character budgets
    └── Command: node test-multilingual-automation.js

3️⃣  AUTOMATION MODE (For production batch processing)
    └── Processes 4000 contacts in scheduled daily batches
    └── Fully autonomous operation with monitoring
    └── Command: node queueProcessor.js (via dashboard preferred)

📊 RECOMMENDED WORKFLOW:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Step 1: npm run dashboard (start the enhanced dashboard)
Step 2: Open http://localhost:3000 in browser
Step 3: Click "Test System" to validate all components
Step 4: Upload your 4000 contacts CSV file
Step 5: Configure daily batch size (500-1000 contacts)
Step 6: Start automation and monitor progress

💡 VOICE SETUP TIPS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎙️ Get multilingual voices at elevenlabs.io
🔧 Update .env with ELEVENLABS_VOICE_HI and ELEVENLABS_VOICE_MR
🎯 Starter plan (30K chars) = ~750 daily conversations with smart allocation
📈 Upgrade to Creator/Pro plans for higher volume campaigns

`);
}

// Main execution
function main() {
  const envOk = checkEnvironment();
  const depsOk = checkDependencies();

  console.log();

  if (!envOk || !depsOk) {
    console.log('❌ Setup incomplete. Please resolve the issues above before launching.\n');
    process.exit(1);
  }

  console.log('🎉 System ready for launch!\n');
  displayLaunchOptions();

  const args = process.argv.slice(2);

  if (args.includes('--dashboard')) {
    console.log('🚀 Launching Enhanced Dashboard...\n');
    execSync('npm run dashboard', { stdio: 'inherit' });
  } else if (args.includes('--test')) {
    console.log('🧪 Running System Tests...\n');
    execSync('node test-multilingual-automation.js', { stdio: 'inherit' });
  } else {
    console.log('💡 Use --dashboard or --test flags, or run commands manually.\n');
    console.log('Quick start: node start-enhanced-system.js --dashboard');
  }
}

main();