// voiceEngine.js — Enhanced ElevenLabs text-to-speech with multilingual support

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import CharacterManager from './characterManager.js';
import dotenv from 'dotenv';

dotenv.config();

const execAsync = promisify(exec);

class MultilingualVoiceEngine {
  constructor() {
    this.characterManager = new CharacterManager();
    this.apiKey = process.env.ELEVENLABS_API_KEY;

    // Language-specific voice configuration
    this.voiceConfig = {
      en: {
        voiceId: process.env.ELEVENLABS_VOICE_EN || process.env.ELEVENLABS_VOICE_ID || 'vLYc04lY2PxDBuUe7Fx1',
        model: 'eleven_multilingual_v2',
        settings: {
          stability: 0.35,
          similarity_boost: 0.80,
          style: 0.45,
          use_speaker_boost: true
        }
      },
      hi: {
        voiceId: process.env.ELEVENLABS_VOICE_HI || process.env.ELEVENLABS_VOICE_ID || 'vLYc04lY2PxDBuUe7Fx1',
        model: 'eleven_multilingual_v2',
        settings: {
          stability: 0.40,
          similarity_boost: 0.80,
          style: 0.40,
          use_speaker_boost: true
        }
      },
      mr: {
        voiceId: process.env.ELEVENLABS_VOICE_MR || process.env.ELEVENLABS_VOICE_ID || 'vLYc04lY2PxDBuUe7Fx1',
        model: 'eleven_multilingual_v2',
        settings: {
          stability: 0.40,
          similarity_boost: 0.80,
          style: 0.40,
          use_speaker_boost: true
        }
      }
    };

    // Audio management
    this.outputDir = './audio';
    this.webOutputDir = './public/audio';
    this.maxAudioFiles = 100; // Auto-cleanup threshold

    this.initializeDirectories();

    console.log('🎙️  Multilingual Voice Engine initialized');
    console.log(`📊 Supported languages: ${Object.keys(this.voiceConfig).join(', ').toUpperCase()}`);
  }

  initializeDirectories() {
    [this.outputDir, this.webOutputDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  async speak(text, language = 'en', options = {}) {
    try {
      // Validate language
      if (!this.voiceConfig[language]) {
        console.warn(`Unsupported language: ${language}, falling back to English`);
        language = 'en';
      }

      // Check character budget before proceeding
      const budgetCheck = await this.characterManager.canAffordUsage(language, text.length);

      if (!budgetCheck.canAfford) {
        console.warn(`💰 Budget exceeded for ${language.toUpperCase()}: ${budgetCheck.reason}`);

        // Fallback strategies
        if (budgetCheck.reason === 'daily_budget_exceeded') {
          console.log(`🔇 Text fallback: ${text.substring(0, 50)}...`);
          return { success: false, reason: 'budget_exceeded', fallback: 'text', text };
        } else if (budgetCheck.reason === 'monthly_limit_exceeded') {
          console.error('🚨 Monthly ElevenLabs limit reached! All voice disabled.');
          return { success: false, reason: 'monthly_limit', fallback: 'text', text };
        }
      }

      // Generate voice
      const result = await this.generateVoice(text, language, options);

      if (result.success) {
        // Record character usage
        await this.characterManager.addUsage(language, text.length, {
          voiceId: this.voiceConfig[language].voiceId,
          model: this.voiceConfig[language].model,
          audioFile: result.filePath,
          timestamp: new Date().toISOString()
        });

        console.log(`🔊 [${language.toUpperCase()}] Voice generated: ${result.fileName} (${text.length} chars)`);
      }

      return result;

    } catch (error) {
      console.error(`❌ Voice generation failed for ${language}:`, error.message);
      return {
        success: false,
        reason: 'generation_error',
        error: error.message,
        fallback: 'text',
        text
      };
    }
  }

  async generateVoice(text, language, options = {}) {
    const config = this.voiceConfig[language];
    const useWebOutput = options.webOutput || false;
    const outputDir = useWebOutput ? this.webOutputDir : this.outputDir;

    const filename = `${language}_speech_${Date.now()}.mp3`;
    const filepath = path.join(outputDir, filename);

    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': this.apiKey,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            text,
            model_id: config.model,
            voice_settings: {
              ...config.settings,
              ...options.voiceSettings // Allow override
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();

        // Handle specific ElevenLabs errors
        if (response.status === 429) {
          throw new Error('Rate limit exceeded - too many requests per minute');
        } else if (response.status === 401) {
          throw new Error('Invalid API key or quota exceeded');
        } else if (response.status === 422) {
          throw new Error('Invalid voice ID or text content');
        }

        throw new Error(`ElevenLabs API error (${response.status}): ${errorText}`);
      }

      const buffer = await response.arrayBuffer();
      fs.writeFileSync(filepath, Buffer.from(buffer));

      // Auto-play if enabled
      if (!options.skipPlayback && process.env.VOICE_AUTO_PLAY !== 'false') {
        await this.playAudio(filepath);
      }

      // Cleanup old files
      await this.cleanupOldAudioFiles(outputDir);

      return {
        success: true,
        filePath: filepath,
        fileName: filename,
        language,
        characterCount: text.length,
        webPath: useWebOutput ? `/audio/${filename}` : null
      };

    } catch (error) {
      // Clean up failed file if it exists
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }

      throw error;
    }
  }

  async playAudio(filepath) {
    const platform = process.platform;
    let cmd;

    if (platform === 'darwin') {
      cmd = `afplay "${filepath}"`;
    } else if (platform === 'win32') {
      cmd = `start "" "${filepath}"`;
    } else {
      cmd = `mpg123 "${filepath}" 2>/dev/null || aplay "${filepath}" 2>/dev/null || ffplay -nodisp -autoexit "${filepath}" 2>/dev/null`;
    }

    try {
      await execAsync(cmd);
    } catch (error) {
      console.log(`🔊 Audio saved to: ${filepath} (auto-play failed: ${error.message})`);
    }
  }

  async cleanupOldAudioFiles(directory) {
    try {
      const files = fs.readdirSync(directory)
        .filter(file => file.endsWith('.mp3'))
        .map(file => ({
          name: file,
          path: path.join(directory, file),
          stats: fs.statSync(path.join(directory, file))
        }))
        .sort((a, b) => b.stats.mtime - a.stats.mtime); // Newest first

      if (files.length > this.maxAudioFiles) {
        const filesToDelete = files.slice(this.maxAudioFiles);

        for (const file of filesToDelete) {
          fs.unlinkSync(file.path);
          console.log(`🗑️  Cleaned up old audio file: ${file.name}`);
        }
      }
    } catch (error) {
      console.warn('Warning: Audio cleanup failed:', error.message);
    }
  }

  // Testing methods for different languages
  async testVoice(language = 'en') {
    console.log(`🎙️  Testing ${language.toUpperCase()} voice...`);

    const testMessages = {
      en: 'Hello! I am Aria, your AI calling assistant. Voice test successful.',
      hi: 'नमस्कार! मैं आर्या हूँ, आपकी AI कॉलिंग असिस्टेंट। आवाज़ परीक्षण सफल।',
      mr: 'नमस्कार! मी आर्या आहे, तुमची AI कॉलिंग असिस्टंट. आवाजाची चाचणी यशस्वी.'
    };

    const testText = testMessages[language] || testMessages.en;
    const result = await this.speak(testText, language, { skipPlayback: false });

    if (result.success) {
      console.log(`✅ ${language.toUpperCase()} voice test complete`);
    } else {
      console.log(`❌ ${language.toUpperCase()} voice test failed: ${result.reason}`);
    }

    return result;
  }

  async testAllVoices() {
    console.log('🎙️  Testing all multilingual voices...');

    const results = {};
    for (const language of Object.keys(this.voiceConfig)) {
      results[language] = await this.testVoice(language);

      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('✅ All voice tests completed');
    return results;
  }

  // Voice optimization methods
  async optimizeForBudget(text, preferredLanguage) {
    const budgetStatus = await this.characterManager.getDailyUsage();

    // If preferred language is near budget, check alternatives
    if (budgetStatus.percentageUsed[preferredLanguage] > 85) {
      console.log(`💡 ${preferredLanguage.toUpperCase()} budget low, checking alternatives...`);

      // Find language with most remaining budget
      let bestAlternative = preferredLanguage;
      let bestRemaining = budgetStatus.remaining[preferredLanguage];

      for (const [lang, remaining] of Object.entries(budgetStatus.remaining)) {
        if (lang !== 'total' && remaining > bestRemaining) {
          bestAlternative = lang;
          bestRemaining = remaining;
        }
      }

      if (bestAlternative !== preferredLanguage && bestRemaining >= text.length) {
        console.log(`💰 Switching to ${bestAlternative.toUpperCase()} (${bestRemaining} chars available)`);
        return bestAlternative;
      }
    }

    return preferredLanguage;
  }

  // Analytics and monitoring
  async getVoiceStats() {
    const charStats = await this.characterManager.getDailyUsage();
    const suggestions = await this.characterManager.getOptimizationSuggestions();

    return {
      characterUsage: charStats,
      optimizationSuggestions: suggestions,
      voiceConfiguration: this.voiceConfig,
      supportedLanguages: Object.keys(this.voiceConfig)
    };
  }

  async close() {
    await this.characterManager.close();
  }
}

// Legacy function compatibility (for existing code)
export async function speak(text, apiKey, voiceId, outputDir = './audio') {
  console.warn('⚠️  Using legacy speak function. Consider migrating to MultilingualVoiceEngine for full features.');

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const filename = `speech_${Date.now()}.mp3`;
  const filepath = path.join(outputDir, filename);

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.35,
            similarity_boost: 0.80,
            style: 0.45,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`ElevenLabs error: ${err}`);
    }

    const buffer = await response.arrayBuffer();
    fs.writeFileSync(filepath, Buffer.from(buffer));

    // Auto-play based on OS
    await playAudio(filepath);

    return filepath;
  } catch (err) {
    console.error(`❌ Voice error: ${err.message}`);
    console.log(`🔇 (Text fallback): ${text}`);
    return null;
  }
}

async function playAudio(filepath) {
  const platform = process.platform;
  let cmd;

  if (platform === 'darwin') cmd = `afplay "${filepath}"`;
  else if (platform === 'win32') cmd = `start "" "${filepath}"`;
  else cmd = `mpg123 "${filepath}" 2>/dev/null || aplay "${filepath}" 2>/dev/null || ffplay -nodisp -autoexit "${filepath}" 2>/dev/null`;

  try {
    await execAsync(cmd);
  } catch (_) {
    console.log(`🔊 Audio saved to: ${filepath} (play manually if auto-play failed)`);
  }
}

export async function testVoice(apiKey, voiceId) {
  console.log('🎙️  Testing ElevenLabs voice (legacy mode)...');
  await speak('Hello! I am Aria, your AI calling assistant. Voice test successful.', apiKey, voiceId);
  console.log('✅ Voice test complete');
}

// Export the enhanced voice engine
export { MultilingualVoiceEngine };
export default MultilingualVoiceEngine;
