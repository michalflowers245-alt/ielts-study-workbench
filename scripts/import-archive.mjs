import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resources } from '../lib/curriculum.mjs';
import { openStore } from '../lib/store.mjs';
import { attemptPayload, reviewPayload, text } from '../lib/validation.mjs';

const filename = process.argv[2];
if (!filename) {
  console.error('Usage: npm run import-archive -- /path/to/private-manifest.json');
  process.exit(1);
}

const bundle = JSON.parse(await readFile(filename, 'utf8'));
if (!bundle || typeof bundle !== 'object' || !Array.isArray(bundle.entries)) throw new Error('Expected an archive object with entries.');
const store = openStore();
let imported = 0;
let existing = 0;

try {
  store.db.exec('BEGIN IMMEDIATE');
  if (bundle.resume) {
    const { title, description, sourceLabel, reading, tasks } = bundle.resume;
    const previous = store.setting('resume');
    if (!previous || (previous.title === title && !previous.reading && reading)) {
      store.setSetting('resume', {
        title: text(title, '续学标题', 140),
        description: text(description, '续学说明', 900),
        sourceLabel: text(sourceLabel, '续学来源', 1000),
        reading: text(reading, '阅读材料', 6000),
        tasks: Array.isArray(tasks) ? tasks.slice(0, 6).map((task) => text(task, '阅读问题', 1200)).filter(Boolean) : undefined,
      });
    }
  }
  for (const entry of bundle.entries) {
    const externalId = text(entry.key, '原记录标识', 300);
    const privateSource = text(entry.source, '原文位置', 1800);
    if (!externalId || !privateSource || !entry.date || !entry.status) throw new Error('Archive entries require key, source, date and status.');
    const id = 'archive-' + createHash('sha256').update(externalId).digest('hex').slice(0, 28);
    if (store.raw(id)) {
      existing += 1;
      continue;
    }
    const validated = attemptPayload({
      id, skill: entry.skill, period: entry.period ?? 'extra',
      date: entry.date, status: entry.status, prompt: entry.prompt, answer: entry.answer, notes: entry.notes,
    }, resources);
    const attempt = store.add({ ...validated, privateSource }, id);
    if (entry.findings?.length) {
      const result = reviewPayload({
        findings: entry.findings.map((item) => ({ ...item, source: 'text' })),
      }, attempt, store.raw(id));
      store.saveReview(id, result);
    }
    imported += 1;
  }
  store.db.exec('COMMIT');
} catch (error) {
  store.db.exec('ROLLBACK');
  throw error;
} finally {
  store.db.close();
}

console.log('Imported ' + imported + ' archive entries. Already present: ' + existing + '.');
