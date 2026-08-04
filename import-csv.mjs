// import-csv.mjs — Parse job-applications CSV and generate tracker TSV lines
// Usage: node import-csv.mjs [--dry-run]

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(ROOT, 'job-applications-2026-07-24.csv');
const TRACKER_PATH = join(ROOT, 'data', 'applications.md');
const BATCH_DIR = join(ROOT, 'batch', 'tracker-additions');

const DRY_RUN = process.argv.includes('--dry-run');

// --- Read existing tracker to get max # and known company+role keys ---
function readExistingTracker() {
  if (!existsSync(TRACKER_PATH)) return { maxNum: 0, existing: new Set() };
  const content = readFileSync(TRACKER_PATH, 'utf-8');
  const lines = content.split('\n');
  let maxNum = 0;
  const existing = new Set();

  for (const line of lines) {
    // Match tracker rows: | {num} | {date} | {company} | {role} | ...
    const m = line.match(/^\|\s*(\d+)\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/);
    if (!m) continue;
    const num = parseInt(m[1], 10);
    if (num > maxNum) maxNum = num;
    const company = m[2].trim().toLowerCase();
    const role = m[3].trim().toLowerCase();
    existing.add(`${company}::${role}`);
  }
  return { maxNum, existing };
}

// --- Normalize company name for dedup ---
function normalizeCompany(name) {
  return name
    .replace(/\s*@\s*.*/i, '')   // remove " @ Company"
    .replace(/\s*\|.*$/, '')      // remove " | ..."
    .replace(/^"?(.*?)"?$/s, '$1') // strip quotes
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// --- Normalize role for dedup ---
function normalizeRole(role) {
  return role
    .replace(/^"(.*?)"$/s, '$1')  // strip quotes
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// --- Parse CSV ---
function parseCSV() {
  const content = readFileSync(CSV_PATH, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  // Skip header (line 0)
  const entries = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV properly (handle quoted fields with commas)
    const fields = parseCSVLine(line);
    if (fields.length < 9) continue;

    const jobTitle = fields[0]?.trim() || '';
    const companyName = fields[1]?.trim() || '';
    const platform = fields[2]?.trim() || '';
    const appStatus = fields[3]?.trim() || '';
    const dateApplied = fields[6]?.trim() || '';
    const resumeUsed = fields[7]?.trim() || '';
    const jobLink = fields[8]?.trim() || '';

    if (!companyName || !jobTitle) continue;

    entries.push({
      jobTitle,
      companyName,
      platform,
      appStatus,
      dateApplied,
      resumeUsed,
      jobLink,
    });
  }
  return entries;
}

// Simple CSV line parser that handles quoted fields
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

// --- Generate company+role dedup from entries ---
function dedupEntries(entries) {
  const map = new Map(); // key -> first entry
  for (const e of entries) {
    const key = `${normalizeCompany(e.companyName)}::${normalizeRole(e.jobTitle)}`;
    if (!map.has(key)) {
      map.set(key, e);
    }
  }
  return Array.from(map.values());
}

// --- Generate TSV line for a single entry ---
function generateTSV(num, entry) {
  // Parse MM/DD/YYYY format (US locale from CSV)
  let date = '2026-01-01';
  if (entry.dateApplied) {
    const parts = entry.dateApplied.split('/');
    if (parts.length === 3) {
      const month = parts[0].padStart(2, '0');
      const day = parts[1].padStart(2, '0');
      const year = parts[2];
      date = `${year}-${month}-${day}`;
    }
  }
  const company = normalizeCompany(entry.companyName);
  const companySlug = company
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const role = entry.jobTitle
    .replace(/^"(.*?)"$/s, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const resumeUsed = entry.resumeUsed.trim();
  const notes = `Imported from CSV · Resume: ${resumeUsed} · Platform: ${entry.platform} · Link: ${entry.jobLink}`;

  // Format: {num}\t{date}\t{company}\t{role}\t{status}\t{score}/5\t{pdf}\t[{num}](reports/{num}-{slug}-{date}.md)\t{notes}
  return `${num}\t${date}\t${company}\t${role}\tEvaluated\tN/A\t❌\t[${num}](reports/${num}-${companySlug}-${date}.md)\t${notes}`;
}

// --- Main ---
function main() {
  console.log(`Parsing CSV: ${CSV_PATH}`);
  const entries = parseCSV();
  console.log(`Parsed ${entries.length} raw entries`);

  const unique = dedupEntries(entries);
  console.log(`Deduplicated to ${unique.length} unique company+role pairs`);

  const { maxNum, existing } = readExistingTracker();
  console.log(`Tracker max #: ${maxNum}, existing keys: ${existing.size}`);

  // Filter out existing
  const newEntries = unique.filter(e => {
    const key = `${normalizeCompany(e.companyName)}::${normalizeRole(e.jobTitle)}`;
    return !existing.has(key);
  });

  console.log(`New entries to add: ${newEntries.length}`);

  // Group by resume version for stats
  const byResume = {};
  for (const e of newEntries) {
    const r = e.resumeUsed.trim();
    byResume[r] = (byResume[r] || 0) + 1;
  }
  console.log('\nResume distribution (new entries):');
  for (const [k, v] of Object.entries(byResume)) {
    console.log(`  ${k}: ${v}`);
  }

  // Group by platform
  const byPlatform = {};
  for (const e of newEntries) {
    byPlatform[e.platform] = (byPlatform[e.platform] || 0) + 1;
  }
  console.log('\nPlatform distribution (new entries):');
  for (const [k, v] of Object.entries(byPlatform)) {
    console.log(`  ${k}: ${v}`);
  }

  if (DRY_RUN) {
    console.log('\n--- DRY RUN: Would generate these TSV entries ---');
    let num = maxNum + 1;
    for (const e of newEntries.slice(0, 20)) {
      console.log(`\n  #${num}: ${e.companyName} — ${e.jobTitle}`);
      console.log(`  Resume: ${e.resumeUsed} | Platform: ${e.platform} | Date: ${e.dateApplied}`);
      num++;
    }
    if (newEntries.length > 20) {
      console.log(`  ... and ${newEntries.length - 20} more`);
    }
    console.log(`\nTotal TSV files to create: ${newEntries.length}`);
    console.log(`Next tracker number: ${num}`);
    return;
  }

  // Ensure batch directory exists
  if (!existsSync(BATCH_DIR)) {
    writeFileSync(BATCH_DIR, '', { flag: 'wx' });
  }

  let num = maxNum + 1;
  let written = 0;
  for (const e of newEntries) {
    const tsv = generateTSV(num, e);
    const companySlug = normalizeCompany(e.companyName)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const date = e.dateApplied
      ? (() => { const p = e.dateApplied.split('/'); return p.length === 3 ? `${p[2]}-${p[0].padStart(2,'0')}-${p[1].padStart(2,'0')}` : '2026-01-01'; })()
      : '2026-01-01';
    const fileName = `${String(num).padStart(3, '0')}-${companySlug}.tsv`;
    writeFileSync(join(BATCH_DIR, fileName), tsv + '\n', 'utf-8');
    console.log(`  #${num}: ${e.companyName} — ${e.jobTitle.slice(0, 60)} → ${fileName}`);
    num++;
    written++;
  }

  console.log(`\nWrote ${written} TSV files to ${BATCH_DIR}`);
  console.log(`Run: node merge-tracker.mjs`);
}

main();
