import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createWorkbench } from '../server.mjs';
import { openStore } from '../lib/store.mjs';
import { calculateProgress, overall, skills } from '../lib/progress.mjs';
import { curriculum, resources, selectPracticeResource } from '../lib/curriculum.mjs';
import { groundFindings } from '../lib/feedback.mjs';
import { attemptPayload } from '../lib/validation.mjs';

async function fixture(t, remote) {
  const path = await mkdtemp(join(tmpdir(), 'ielts-web-test-'));
  let app;
  async function start() {
    app = createWorkbench({ port: 0, dataDir: path, remote });
    const address = await app.start();
    return 'http://127.0.0.1:' + address.port;
  }
  async function close() {
    if (!app) return;
    await app.close();
    app = undefined;
  }
  t.after(async () => {
    await close();
    await rm(path, { recursive: true, force: true });
  });
  return { path, start, close };
}

const json = (data, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
const status = (actual, expected) => assert.equal(actual.status, expected);
const requestAttempt = (origin, payload) => fetch(origin + '/api/attempts', json(payload));
const asrSample = process.env.IELTS_TEST_PUBLIC_SAMPLE || '/opt/homebrew/opt/whisper.cpp/share/whisper.cpp/jfk.wav';
const asrModel = process.env.IELTS_WHISPER_MODEL || join(homedir(), '.cache', 'whisper', 'ggml-large-v3-turbo.bin');
const mayTranscribe = existsSync(asrSample) && existsSync(asrModel);

function sampleAttempt(id, extra = {}) {
  return { id, date: '2026-11-25', skill: 'speaking', status: 'done', prompt: 'An original oral question', ...extra };
}

async function until(origin, id, predicate) {
  for (let i = 0; i < 160; i += 1) {
    const { attempt } = await (await fetch(origin + '/api/attempts/' + id)).json();
    if (predicate(attempt)) return attempt;
    await delay(125);
  }
  assert.fail('Recording job did not reach the expected state');
}

test('curriculum keeps 14 days, correct time budget and resolvable resources', () => {
  assert.equal(curriculum.length, 14);
  for (const item of curriculum) {
    assert.equal(item.morning.minutes + item.evening.minutes, 60);
    for (const block of [item.morning, item.evening, item.special]) {
      if (block?.resourceId) assert.ok(resources.some(({ id }) => id === block.resourceId));
    }
  }
  const used = new Set();
  const first = selectPracticeResource({ skill: 'speaking', usedIds: used, issueCategory: 'grammar' });
  used.add(first.id);
  const second = selectPracticeResource({ skill: 'speaking', usedIds: used, issueCategory: 'grammar' });
  assert.equal(first.kind, 'original');
  assert.equal(second.kind, 'original');
  assert.notEqual(first.id, second.id);
});

test('grading uses complete first timed samples, distinct Cambridge tests and verified reviewers', () => {
  assert.equal(overall([7, 7, 7.5, 7.5]), 7.5);
  assert.equal(overall([8.5, 8, 7, 7.5]), 8);
  assert.equal(overall([8.5, 8, 7]), undefined);
  const mocks = (testNumber, date, band, overrides = {}) => skills.map((skill) => ({
    id: testNumber + skill, date, createdAt: 'Z', mode: 'mock', skill, take: 'first', status: 'done',
    timed: true, unseen: true, assessmentKind: ['writing', 'speaking'].includes(skill) ? 'teacher' : 'publisher',
    assessmentSource: 'fixture', resourceId: 'cambridge-19-' + skill, prompt: 'Test ' + testNumber,
    mockId: date, band, total: 40, correct: 35, full: true, continuous: true, ...overrides,
  }));
  const first = mocks(1, '2026-11-20', 7.5);
  const second = mocks(2, '2026-11-21', 8);
  assert.deepEqual(calculateProgress([...first, ...second]).mock, { count: 2, lastBand: 8, at75: true, at80: false });
  assert.equal(calculateProgress([...first, ...mocks(1, '2026-11-21', 8)]).mock.count, 1);
  assert.equal(calculateProgress([...first, ...second.map((a) => a.skill === 'speaking' ? { ...a, assessmentKind: 'publisher' } : a)]).mock.count, 1);
  assert.throws(() => attemptPayload(sampleAttempt('estimate', {
    mode: 'mock', band: 8, mockId: 'x', full: true, assessmentKind: 'publisher', assessmentSource: 'AI',
  }), resources), /人工评阅/);
});

test('model output is grounded on verbatim source and never locks an issue as confirmed', () => {
  const segment = { id: 's1', startMs: 100, endMs: 2000, text: 'He go to work every day.' };
  const correction = { segmentId: 's1', category: 'grammar', quote: 'He go to work', correction: 'He goes to work', drill: '换一个人作主语。' };
  const findings = groundFindings({ findings: [correction] }, [segment]);
  assert.equal(findings[0].confirmed, false);
  assert.equal(findings[0].startMs, 100);
  assert.throws(() => groundFindings({ findings: [{ ...correction, quote: 'not in the segment' }] }, [segment]), /原句/);
  assert.throws(() => groundFindings({ findings: [{ ...correction, category: 'pronunciation' }] }, [segment]), /原句/);
  assert.deepEqual(groundFindings({ findings: [] }, [segment]), []);
});

test('daily records, source reveal, fresh retest, evidence and export persist after restart', async (t) => {
  const server = await fixture(t);
  let url = await server.start();
  const getState = async () => (await fetch(url + '/api/state')).json();
  assert.equal((await getState()).today.started, false);
  status(await fetch(url + '/api/start', json({})), 200);
  const before = (await getState()).resources.find(({ id }) => id === 'baseline-listening');
  assert.equal(before.answerUrl, undefined);

  const listening = { id: 'listening-1', skill: 'listening', status: 'done', mode: 'baseline', take: 'first',
    timed: true, unseen: true, correct: 30, total: 40, resourceId: 'baseline-listening' };
  status(await requestAttempt(url, listening), 201);
  status(await requestAttempt(url, listening), 200);
  assert.ok((await getState()).resources.find(({ id }) => id === 'baseline-listening').answerUrl);
  assert.equal((await getState()).progress.baseline.listening.correct, 30);

  const source = sampleAttempt('oral-1', { answer: 'She go to work early.' });
  status(await requestAttempt(url, source), 201);
  const target = { category: 'grammar', quote: 'She go', correction: 'She goes', drill: '用第三人称说一次。', confirmed: true, source: 'text' };
  status(await fetch(url + '/api/attempts/oral-1/review', json({ findings: [{ ...target, category: 'pronunciation' }] }, 'PATCH')), 400);
  status(await fetch(url + '/api/attempts/oral-1/review', json({ findings: [target] }, 'PATCH')), 200);
  const next = await (await fetch(url + '/api/attempts/oral-1/next')).json();
  assert.equal(next.resource.kind, 'original');
  status(await requestAttempt(url, sampleAttempt('old-1', { parentId: 'oral-1', take: 'transfer', unseen: true })), 400);
  status(await requestAttempt(url, sampleAttempt('oral-2', {
    parentId: 'oral-1', resourceId: next.resource.id, take: 'transfer', unseen: true,
  })), 201);
  status(await fetch(url + '/api/attempts/oral-2/review', json({ outcome: 'passed', category: 'grammar', opportunities: 2, errors: 0 }, 'PATCH')), 200);
  assert.deepEqual((await getState()).progress.transfer, { passed: 1, total: 1 });

  await server.close();
  url = await server.start();
  const after = await getState();
  assert.equal(after.today.started, true);
  assert.equal(after.attempts.length, 3);
  assert.deepEqual(after.progress.recurrence, [{ category: 'grammar', opportunities: 2, errors: 0 }]);
  const edit = await fetch(url + '/api/attempts/oral-1', json({ answer: 'She goes to work early.' }, 'PATCH'));
  status(edit, 200);
  const { attempt: revised } = await edit.json();
  assert.equal(revised.originalAnswer, 'She go to work early.');
  assert.equal(revised.findings[0].confirmed, false);
  status(await requestAttempt(url, sampleAttempt('second-root', { prompt: 'A different question' })), 201);
  status(await requestAttempt(url, sampleAttempt('seen-transfer', {
    parentId: 'second-root', resourceId: next.resource.id, take: 'transfer', unseen: true,
  })), 400);
  const record = await (await fetch(url + '/api/export')).text();
  assert.match(record, /She go to work early/);
  assert.match(record, /陌生题复测/);
});

test('serves private proxy only for configured owner and rejects mismatched browser origin', async (t) => {
  const remote = { host: 'example-device.test.ts.net', user: 'owner@example.test' };
  const server = await fixture(t, remote);
  const url = await server.start();
  const proxy = { 'X-Forwarded-Host': remote.host, 'X-Forwarded-Proto': 'https' };
  status(await fetch(url + '/api/state', { headers: proxy }), 403);
  status(await fetch(url + '/api/state', { headers: { ...proxy, 'Tailscale-User-Login': 'other@example.test' } }), 403);
  status(await fetch(url + '/api/state', { headers: { ...proxy, 'Tailscale-User-Login': remote.user } }), 200);
  const params = json({});
  params.headers.Origin = 'https://unexpected.test';
  status(await fetch(url + '/api/start', params), 403);
});

test('M4A upload survives page close, supports byte seek and dedupes original and retake', {
  skip: !mayTranscribe && 'Requires local public sample and Whisper model',
}, async (t) => {
  const server = await fixture(t);
  let url = await server.start();
  const clip = join(server.path, 'clip.m4a');
  execFileSync('ffmpeg', ['-v', 'error', '-i', asrSample, '-c:a', 'aac', clip]);
  const input = await readFile(clip);
  status(await requestAttempt(url, sampleAttempt('day-1')), 201);
  const put = (id, data) => fetch(url + '/api/attempts/' + id + '/audio', {
    method: 'PUT', headers: { 'X-File-Name': encodeURIComponent('手机语音.m4a') }, body: data,
  });
  status(await put('day-1', 'corrupt'), 422);
  status(await put('day-1', input), 200);
  status(await put('day-1', input), 200);
  const complete = await until(url, 'day-1', (one) => one.recording.status === 'ready');
  assert.ok(complete.recording.hasPlayback);
  assert.match(complete.segments.map((part) => part.text).join(' '), /fellow Americans/i);
  const playback = await fetch(url + '/api/attempts/day-1/audio', { headers: { Range: 'bytes=0-15' } });
  status(playback, 206);
  assert.equal((await playback.arrayBuffer()).byteLength, 16);
  const original = await fetch(url + '/api/attempts/day-1/original');
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), input);
  status(await requestAttempt(url, sampleAttempt('redo-1', { take: 'retake', parentId: 'day-1' })), 201);
  status(await put('redo-1', input), 409);

  const segment = complete.segments[0];
  status(await fetch(url + '/api/attempts/day-1/review', json({
    segments: [{ id: segment.id, text: segment.text + ' [reviewed]' }],
  }, 'PATCH')), 200);

  await server.close();
  const store = openStore(server.path);
  store.add({ ...sampleAttempt('restored-queue'), take: 'first' }, 'restored-queue');
  await writeFile(join(store.mediaDir, 'restore.original.m4a'), input, { mode: 0o600 });
  store.registerAudio('restored-queue', { sha256: 'fixture', original: 'restore.original.m4a', filename: 'clip.m4a', durationMs: 11_000 });
  store.asrRunning('restored-queue');
  store.db.close();
  url = await server.start();
  const recovered = await until(url, 'restored-queue', (one) => one.recording.status === 'ready');
  assert.ok(recovered.segments.length);
  const { attempt } = await (await fetch(url + '/api/attempts/day-1')).json();
  assert.equal(attempt.segments[0].text, segment.text);
  assert.equal(attempt.segments[0].correctedText, segment.text + ' [reviewed]');

  const quiet = join(server.path, 'quiet.m4a');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '1', '-c:a', 'aac', quiet]);
  status(await requestAttempt(url, sampleAttempt('quiet')), 201);
  status(await put('quiet', await readFile(quiet)), 200);
  const silent = await until(url, 'quiet', (one) => ['ready', 'failed'].includes(one.recording.status));
  assert.equal(silent.recording.status, 'failed');
  assert.equal(silent.recording.hasOriginal, true);
});
