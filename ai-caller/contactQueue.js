// contactQueue.js — loads CSV, cleans numbers, manages call queue

import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

export function loadContacts(csvPath, phoneColumn = 'phone') {
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true });

  const contacts = [];
  const skipped = [];

  for (let i = 0; i < records.length; i++) {
    const row = records[i];

    // Try to find phone column (case-insensitive)
    const colKey = Object.keys(row).find(
      k => k.toLowerCase().replace(/\s/g, '') === phoneColumn.toLowerCase().replace(/\s/g, '')
        || k.toLowerCase().includes('phone')
        || k.toLowerCase().includes('mobile')
        || k.toLowerCase().includes('number')
    );

    if (!colKey) {
      skipped.push({ row: i + 1, reason: 'No phone column found' });
      continue;
    }

    const rawPhone = row[colKey]?.toString().trim();
    const cleaned = cleanPhone(rawPhone);

    if (!cleaned) {
      skipped.push({ row: i + 1, reason: `Invalid number: ${rawPhone}` });
      continue;
    }

    contacts.push({
      id: i + 1,
      phone: cleaned,
      name: row['name'] || row['Name'] || row['NAME'] || `Student ${i + 1}`,
      status: 'pending',   // pending | called | interested | not_interested | callback | no_answer
      rsvp: false,
      notes: '',
      calledAt: null,
    });
  }

  console.log(`✅ Loaded ${contacts.length} valid contacts (${skipped.length} skipped)`);
  return contacts;
}

function cleanPhone(raw) {
  if (!raw) return null;
  // Remove all non-digits
  let digits = raw.replace(/\D/g, '');
  // Handle Indian numbers
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 13 && digits.startsWith('091')) return `+${digits.slice(1)}`;
  // Generic: keep if 10-15 digits
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function saveResults(contacts, outputPath) {
  const rows = contacts.map(c => ({
    id: c.id,
    phone: c.phone,
    name: c.name,
    status: c.status,
    rsvp: c.rsvp ? 'YES' : 'NO',
    notes: c.notes,
    calledAt: c.calledAt || '',
  }));

  const csv = stringify(rows, { header: true });
  fs.writeFileSync(outputPath, csv);
  console.log(`💾 Results saved to ${outputPath}`);
}

export function getStats(contacts) {
  const total = contacts.length;
  const called = contacts.filter(c => c.status !== 'pending').length;
  const interested = contacts.filter(c => c.status === 'interested').length;
  const rsvp = contacts.filter(c => c.rsvp).length;
  const callback = contacts.filter(c => c.status === 'callback').length;
  const notInterested = contacts.filter(c => c.status === 'not_interested').length;

  return { total, called, interested, rsvp, callback, notInterested, pending: total - called };
}
