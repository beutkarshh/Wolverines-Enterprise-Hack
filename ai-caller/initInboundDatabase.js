import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'data', 'inbound-knowledge.db');
const SCHEMA_PATH = path.join(__dirname, 'data', 'inbound-schema.sql');

console.log('🚀 Initializing Campus Dekho Inbound Call Database...\n');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('✅ Created data directory');
}

// Read schema file
const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
console.log('✅ Loaded schema file');

// Initialize database
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL'); // Better concurrency

// Execute entire schema at once
try {
  db.exec(schema);
  console.log('✅ Schema executed successfully');
} catch (err) {
  console.error('❌ Error executing schema:', err.message);
  process.exit(1);
}

// Verify tables
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
).all();

console.log('\n📊 Database Tables:');
tables.forEach(t => console.log(`   • ${t.name}`));

// Print sample data counts
console.log('\n📈 Sample Data:');
const counts = {
  'Knowledge Base': db.prepare('SELECT COUNT(*) as count FROM knowledge_base').get().count,
  'Counseling Packages': db.prepare('SELECT COUNT(*) as count FROM counseling_packages').get().count,
  'Social Events': db.prepare('SELECT COUNT(*) as count FROM social_events').get().count,
  'Agent Availability': db.prepare('SELECT COUNT(*) as count FROM agent_availability').get().count,
};

Object.entries(counts).forEach(([name, count]) => {
  console.log(`   • ${name}: ${count} entries`);
});

db.close();

console.log('\n✅ Database initialized successfully!');
console.log(`📁 Location: ${DB_PATH}\n`);
