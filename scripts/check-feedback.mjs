import assert from 'node:assert/strict';
import { analyzeTranscript, feedbackReady } from '../lib/feedback.mjs';

if (!await feedbackReady()) throw new Error('Enable the local model and finish downloading it before this check.');
const examples = [
  {
    source: 'He go to work every day because he enjoys his job.',
    check: (rows) => rows.some((item) => item.category === 'grammar' && /\bgoes\b/i.test(item.correction)),
  },
  {
    source: 'I am interested on urban transport because I use the subway every day.',
    check: (rows) => rows.some((item) => /\binterested in\b/i.test(item.correction)),
  },
  {
    source: 'My sister lives near the library, so she usually walks there after work.',
    check: (rows) => rows.length === 0,
  },
  {
    source: "I’d improve the bus network because that would make it easier for people to get to work.",
    check: (rows) => rows.length === 0,
  },
];

let failures = 0;
for (const { source, check } of examples) {
  try {
    const findings = await analyzeTranscript({ segments: [{ id: 'sample', startMs: 0, endMs: 5000, text: source }] });
    assert.ok(check(findings));
    assert.ok(findings.every((item) => !item.confirmed && item.source === 'text'));
    console.log('PASS ' + source);
  } catch (error) {
    failures += 1;
    console.error('FAIL ' + source + ' (' + error.message + ')');
  }
}
if (failures) process.exitCode = 1;
