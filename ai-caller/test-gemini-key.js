import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config({ override: true });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

console.log('🔍 Testing Gemini API Key...\n');
console.log(`Key: ${GEMINI_API_KEY?.substring(0, 20)}...`);

async function testGeminiKey() {
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    console.log('\n📤 Sending test message to Gemini...');

    const result = await model.generateContent('Say "Hello from Campus Dekho!" in exactly those words.');
    const response = result.response;
    const text = response.text();

    console.log('\n✅ API Key is VALID!');
    console.log(`📥 Response: ${text}\n`);

    return true;
  } catch (error) {
    console.error('\n❌ API Key FAILED!');
    console.error(`Error: ${error.message}\n`);

    if (error.message.includes('API_KEY_INVALID')) {
      console.log('🔧 Fix: Get a new API key from https://aistudio.google.com/app/apikey');
    } else if (error.message.includes('quota')) {
      console.log('⚠️  Quota exceeded. Wait or upgrade your plan.');
    } else if (error.message.includes('404')) {
      console.log('⚠️  Model not available. Try "gemini-1.5-flash" instead.');
    }

    return false;
  }
}

testGeminiKey();
