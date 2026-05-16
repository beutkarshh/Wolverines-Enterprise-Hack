-- ============================================
-- Campus Dekho Inbound Call System - Database Schema
-- ============================================

-- Knowledge Base (FAQs for CET, Admissions, Documents, General)
CREATE TABLE IF NOT EXISTS knowledge_base (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL, -- 'cet', 'documents', 'general', 'admissions'
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  keywords TEXT, -- comma-separated for search
  priority INTEGER DEFAULT 0, -- higher = more relevant
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kb_category ON knowledge_base(category);
CREATE INDEX idx_kb_priority ON knowledge_base(priority DESC);

-- Counseling Packages
CREATE TABLE IF NOT EXISTS counseling_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  price REAL,
  currency TEXT DEFAULT 'INR',
  features TEXT, -- JSON array: ["Feature 1", "Feature 2"]
  whatsapp_message_template TEXT,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Social Media Events (Instagram, Facebook)
CREATE TABLE IF NOT EXISTS social_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL, -- 'instagram', 'facebook', 'linkedin'
  title TEXT NOT NULL,
  description TEXT,
  event_date TEXT, -- ISO format or readable
  event_time TEXT,
  location TEXT,
  post_url TEXT,
  image_url TEXT,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_events_platform ON social_events(platform);
CREATE INDEX idx_events_date ON social_events(event_date);

-- Inbound Call Logs
CREATE TABLE IF NOT EXISTS inbound_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_sid TEXT UNIQUE NOT NULL,
  caller_number TEXT NOT NULL,
  caller_name TEXT,
  detected_language TEXT DEFAULT 'en', -- en, hi, mr
  detected_topics TEXT, -- JSON array: ["counseling", "cet_doubts"]
  conversation_summary TEXT,
  escalated BOOLEAN DEFAULT 0,
  escalation_reason TEXT,
  escalation_type TEXT, -- 'live_transfer', 'callback_scheduled', 'none'
  callback_requested BOOLEAN DEFAULT 0,
  callback_scheduled_at DATETIME,
  callback_status TEXT, -- 'pending', 'completed', 'failed'
  whatsapp_sent BOOLEAN DEFAULT 0,
  whatsapp_content TEXT,
  duration INTEGER, -- seconds
  status TEXT DEFAULT 'active', -- 'active', 'completed', 'failed'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

CREATE INDEX idx_inbound_caller ON inbound_calls(caller_number);
CREATE INDEX idx_inbound_status ON inbound_calls(status);
CREATE INDEX idx_inbound_escalated ON inbound_calls(escalated);
CREATE INDEX idx_inbound_callback ON inbound_calls(callback_requested, callback_status);

-- Agent Availability (for human escalation)
CREATE TABLE IF NOT EXISTS agent_availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name TEXT NOT NULL,
  agent_phone TEXT NOT NULL,
  available BOOLEAN DEFAULT 0,
  available_from TIME, -- HH:MM format
  available_to TIME,   -- HH:MM format
  days_of_week TEXT,   -- JSON array: ["monday", "tuesday"]
  current_calls INTEGER DEFAULT 0,
  max_concurrent_calls INTEGER DEFAULT 3,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Conversation Turns (for analytics and training)
CREATE TABLE IF NOT EXISTS conversation_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_sid TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  role TEXT NOT NULL, -- 'user', 'agent', 'system'
  agent_type TEXT, -- 'orchestrator', 'counseling', 'cet', 'documents', 'events'
  message TEXT NOT NULL,
  intent TEXT, -- detected user intent
  confidence REAL, -- intent confidence score
  tools_called TEXT, -- JSON array of tool calls
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (call_sid) REFERENCES inbound_calls(call_sid)
);

CREATE INDEX idx_turns_call ON conversation_turns(call_sid);

-- WhatsApp Messages Log
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_sid TEXT,
  recipient_number TEXT NOT NULL,
  message_content TEXT NOT NULL,
  media_url TEXT, -- optional image/pdf link
  status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'failed'
  provider TEXT DEFAULT 'twilio', -- 'twilio', 'exotel'
  provider_message_id TEXT,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME,
  FOREIGN KEY (call_sid) REFERENCES inbound_calls(call_sid)
);

CREATE INDEX idx_whatsapp_status ON whatsapp_messages(status);

-- ============================================
-- Sample Data Insertion
-- ============================================

-- Sample Knowledge Base Entries
INSERT OR IGNORE INTO knowledge_base (category, question, answer, keywords, priority) VALUES
  ('cet', 'What is MHT-CET?', 'MHT-CET (Maharashtra Common Entrance Test) is a state-level entrance exam for admissions to engineering, pharmacy, and agriculture courses in Maharashtra colleges.', 'mht-cet,exam,entrance,maharashtra', 10),
  ('cet', 'When is MHT-CET 2026?', 'MHT-CET 2026 exam dates are expected to be announced in February 2026. Typically, the exam is held in May.', 'date,schedule,2026,exam', 10),
  ('cet', 'What is the eligibility for MHT-CET?', 'Candidates must have passed 12th with Physics, Chemistry, and Mathematics/Biology from a recognized board and should be domiciled in Maharashtra or All India.', 'eligibility,qualification,12th', 9),
  ('cet', 'How to apply for MHT-CET?', 'Apply online through the official MHT-CET website. Registration opens in January/February each year.', 'application,registration,how to apply', 8),

  ('documents', 'What documents are needed for MHT-CET?', 'Required documents: 10th mark sheet, 12th mark sheet, domicile certificate, caste certificate (if applicable), passport-size photos, and Aadhaar card.', 'documents,required,needed,list', 10),
  ('documents', 'How to submit documents after admission?', 'After CAP rounds, submit original documents at the allotted college within the specified date. Keep photocopies for records.', 'submission,upload,process,cap', 8),

  ('admissions', 'What is CAP rounds?', 'CAP (Centralized Admission Process) is conducted by the Maharashtra state for admissions to engineering colleges based on MHT-CET ranks.', 'cap,admission,rounds,process', 9),
  ('admissions', 'How many CAP rounds are there?', 'Typically, there are 3 CAP rounds followed by an institute-level round for remaining seats.', 'cap rounds,number,how many', 8),

  ('general', 'What services does Campus Dekho provide?', 'Campus Dekho - the admission corridor - provides admission counseling, college selection guidance, document verification assistance, and connects students with top colleges across India.', 'services,what,provide,help', 10),
  ('general', 'How can I contact Campus Dekho?', 'You can visit our website campusdekho.ai, follow us on Instagram/Facebook, or call our helpline for personalized assistance.', 'contact,reach,phone,email', 9);

-- Sample Counseling Packages (Placeholders)
INSERT OR IGNORE INTO counseling_packages (name, description, price, features, whatsapp_message_template) VALUES
  ('Basic Package', 'Essential counseling for college admissions', 999, '["College shortlisting", "CAP round guidance", "Basic document checklist"]', 'Hi! Here are the details of our Basic Package (₹999):\n✅ College shortlisting\n✅ CAP round guidance\n✅ Document checklist\n\nBook now: campusdekho.ai/packages'),
  ('Premium Package', 'Comprehensive admission support', 2999, '["Personalized counseling", "Mock CAP registration", "Document verification", "College tours"]', 'Hi! Check out our Premium Package (₹2999):\n🌟 Personalized counseling\n🌟 Mock CAP registration\n🌟 Document verification\n🌟 College tours\n\nLearn more: campusdekho.ai/packages'),
  ('Elite Package', 'End-to-end admission assistance', 5999, '["Dedicated counselor", "24/7 support", "College visits with parents", "Scholarship guidance", "Post-admission support"]', 'Hi! Our Elite Package (₹5999) includes:\n💎 Dedicated counselor\n💎 24/7 support\n💎 College visits with parents\n💎 Scholarship guidance\n💎 Post-admission support\n\nEnroll now: campusdekho.ai/packages');

-- Sample Social Events
INSERT OR IGNORE INTO social_events (platform, title, description, event_date, event_time, location, post_url) VALUES
  ('instagram', 'MHT-CET 2026 Preparation Workshop', 'Free workshop covering exam pattern, important topics, and time management strategies', '2026-04-15', '10:00 AM', 'Pune - Fergusson College', 'https://instagram.com/p/campusdekho-event1'),
  ('facebook', 'College Campus Tour - Pune Edition', 'Visit top engineering colleges with Campus Dekho team and parents', '2026-04-20', '09:00 AM', 'Pune - Multiple Colleges', 'https://facebook.com/events/campusdekho-tour'),
  ('instagram', 'Live Q&A Session with Admission Experts', 'Ask your CET and admission-related doubts live!', '2026-04-10', '06:00 PM', 'Instagram Live', 'https://instagram.com/campusdekho');

-- Sample Agent Availability
INSERT OR IGNORE INTO agent_availability (agent_name, agent_phone, available, available_from, available_to, days_of_week, max_concurrent_calls) VALUES
  ('Rahul Sharma', '+919876543210', 1, '09:00', '18:00', '["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]', 3),
  ('Sneha Patil', '+919876543211', 1, '10:00', '19:00', '["monday", "tuesday", "wednesday", "thursday", "friday"]', 2);
