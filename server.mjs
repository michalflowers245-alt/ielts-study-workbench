import { createServer } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { readFile, rename, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { inspectAudio, transcribe } from './lib/audio.mjs';
import { resources, curriculum, selectPracticeResource } from './lib/curriculum.mjs';
import { openStore, todayDate } from './lib/store.mjs';
import { buildToday, calculateProgress, promptKey, skillLabels } from './lib/progress.mjs';
import { analyzeTranscript, feedbackReady } from './lib/feedback.mjs';
import { attemptPayload, linkAttempt, Problem, reviewPayload, validId } from './lib/validation.mjs';

const appDir = fileURLToPath(new URL('.', import.meta.url));
const MAX_AUDIO = 80 * 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.aac': 'audio/aac', '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
};
const staticFiles = { '/': 'index.html', '/index.html': 'index.html', '/styles.css': 'styles.css', '/app.js': 'app.js' };

function headers(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'; img-src 'self' data:; media-src 'self' blob:");
}

function send(response, code, payload) {
  response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function secureEqual(first, second) {
  const a = Buffer.from(first);
  const b = Buffer.from(second);
  return a.length === b.length && timingSafeEqual(a, b);
}

function allow(request, port, remote) {
  const host = (request.headers.host ?? '').toLowerCase();
  const forwarded = request.headers['x-forwarded-host']?.toLowerCase();
  const local = new Set(['localhost', '127.0.0.1'].map((value) => value + ':' + port));
  const proxyRequest = Boolean(forwarded || request.headers['tailscale-user-login'] || request.headers['x-forwarded-proto']);
  let authority;
  let scheme;
  if (!proxyRequest && local.has(host)) {
    authority = host;
    scheme = 'http';
  } else {
    const login = request.headers['tailscale-user-login'];
    if (!remote.host || !remote.user || typeof login !== 'string' || !secureEqual(login, remote.user)
      || (forwarded || host) !== remote.host || request.headers['x-forwarded-proto'] && request.headers['x-forwarded-proto'] !== 'https') {
      throw new Problem(403, '此工作台仅限本机及已授权的私有访问。');
    }
    authority = remote.host;
    scheme = 'https';
  }
  const origin = request.headers.origin;
  if (request.headers['sec-fetch-site'] === 'cross-site' && !['GET', 'HEAD'].includes(request.method)) {
    throw new Problem(403, '请在工作台内提交。');
  }
  if (origin && origin !== scheme + '://' + authority) throw new Problem(403, '请在工作台内提交。');
}

async function readJson(request) {
  if (!/^application\/json\b/i.test(request.headers['content-type'] ?? '')) throw new Problem(415, '请提交 JSON。');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_048_576) throw new Problem(413, '记录过长。');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* Response below includes a user-readable error. */ }
  throw new Problem(400, '提交内容不是有效的记录。');
}

function uploadFilename(header) {
  let value;
  try { value = typeof header === 'string' && decodeURIComponent(header); } catch { /* Use the default name. */ }
  return (value || 'recording.m4a').replace(/[\\/\p{Cc}]/gu, '_').slice(0, 180);
}

async function consumeUpload(request, destination) {
  const declared = Number(request.headers['content-length']);
  if (declared > MAX_AUDIO) throw new Problem(413, '录音文件最多 80 MB。');
  let size = 0;
  const hash = createHash('sha256');
  const meter = new Transform({
    transform(chunk, encoding, callback) {
      size += chunk.length;
      if (size > MAX_AUDIO) return callback(new Problem(413, '录音文件最多 80 MB。'));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(request, meter, createWriteStream(destination, { mode: 0o600, flags: 'wx' }));
  if (!size) throw new Problem(400, '录音文件为空。');
  return hash.digest('hex');
}

async function playFile(request, response, file, mime, downloadName) {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new Problem(404, '录音文件暂不可用。');
  const length = info.size;
  const header = request.headers.range;
  const details = { 'Accept-Ranges': 'bytes', 'Content-Type': mime };
  if (downloadName) details['Content-Disposition'] = "attachment; filename*=UTF-8''" + encodeURIComponent(downloadName).replace(/'/g, '%27');
  let start = 0;
  let end = length - 1;
  if (header) {
    const bounds = /^bytes=(\d*)-(\d*)$/.exec(header);
    if (bounds && (bounds[1] || bounds[2])) {
      start = bounds[1] ? Number(bounds[1]) : Math.max(0, length - Number(bounds[2]));
      end = bounds[1] && bounds[2] ? Math.min(Number(bounds[2]), end) : end;
    }
    if (!bounds || !(bounds[1] || bounds[2]) || start > end || start >= length) {
      response.writeHead(416, { ...details, 'Content-Range': 'bytes */' + length });
      response.end();
      return;
    }
    details['Content-Range'] = 'bytes ' + start + '-' + end + '/' + length;
  }
  details['Content-Length'] = end - start + 1;
  response.writeHead(header ? 206 : 200, details);
  if (request.method === 'HEAD') return response.end();
  await pipeline(createReadStream(file, { start, end }), response);
}

function markdown(attempts, resume) {
  const lines = ['# 雅思学习记录', '', '导出日期 ' + todayDate(), ''];
  if (resume) lines.push('续学线索 ' + resume.title, resume.description, '');
  for (const attempt of attempts) {
    const resource = resources.find(({ id }) => id === attempt.resourceId);
    const take = { first: '首次作答', retake: '同题重录', transfer: '陌生题复测' }[attempt.take];
    const status = { started: '进行中', done: '完成', partial: '部分完成', skipped: '未完成' }[attempt.status];
    lines.push('## ' + attempt.date + ' · ' + skillLabels[attempt.skill] + ' · ' + take, '',
      '- 状态 ' + status, '- 实际用时 ' + (attempt.minutes == null ? '未记录' : attempt.minutes + ' 分钟'));
    if (resource || attempt.prompt) lines.push('- 题目 ' + (resource?.title || attempt.prompt));
    if (resource?.sourceLabel) lines.push('- 题源 ' + resource.sourceLabel);
    if (attempt.privateSource) lines.push('- 原始学习资料 ' + attempt.privateSource);
    if (attempt.correct != null) lines.push('- 正确数 ' + attempt.correct + '/' + attempt.total);
    if (attempt.band != null) lines.push('- 分档 ' + attempt.band + '（' + attempt.assessmentSource + '）');
    if (attempt.notes) lines.push('', attempt.notes);
    if (attempt.originalAnswer && attempt.originalAnswer !== attempt.answer) {
      lines.push('', '首次提交', '', attempt.originalAnswer);
    }
    if (attempt.answer) lines.push('', '作答', '', attempt.answer);
    if (attempt.assessmentNotes) lines.push('', '评阅意见', '', attempt.assessmentNotes);
    for (const segment of attempt.segments) {
      lines.push('', '[' + (segment.startMs / 1000).toFixed(2) + 's] ' + segment.text);
      if (segment.correctedText !== undefined) lines.push('校订 ' + segment.correctedText);
    }
    for (const finding of attempt.findings) {
      lines.push('', (finding.confirmed ? '已核 ' : '待核 ') + finding.category + '｜' + finding.quote
        + ' → ' + finding.correction, '复练 ' + finding.drill);
    }
    if (attempt.review) lines.push('', '复测结论 ' + ({ passed: '通过', failed: '仍需练习', untested: '证据不足' })[attempt.review.outcome]
      + '，复现 ' + attempt.review.errors + '/' + attempt.review.opportunities);
    lines.push('');
  }
  return lines.join('\n');
}

export function createWorkbench({
  port = Number(process.env.IELTS_PORT || 4385), dataDir,
  remote = { host: process.env.IELTS_REMOTE_HOST?.toLowerCase(), user: process.env.IELTS_REMOTE_USER },
} = {}) {
  const store = openStore(dataDir);
  const uploads = new Set();
  let active = false;
  let stopped = false;

  const asrHealth = () => existsSync(process.env.IELTS_WHISPER_MODEL ?? join(homedir(), '.cache', 'whisper', 'ggml-large-v3-turbo.bin'));
  const health = async () => ({ asr: asrHealth(), feedback: await feedbackReady() });

  async function processJob(job) {
    const audio = store.recording(job.id);
    if (job.status === 'queued') {
      store.asrRunning(job.id);
      try {
        const playback = job.id + '.play.m4a';
        const result = await transcribe({
          inputPath: join(store.mediaDir, audio.original), outputPath: join(store.mediaDir, playback), scratchDir: store.scratchDir,
        });
        store.asrReady(job.id, result, playback);
      } catch (error) {
        store.asrFailed(job.id, error.message || '转写失败，请重试。');
        return;
      }
    }
    if (stopped) return;
    if (!await feedbackReady()) {
      store.feedback(job.id, 'unavailable', '本机文字反馈服务未就绪。仍可回听与手动纠错。');
      return;
    }
    store.feedback(job.id, 'running');
    try {
      const attempt = store.get(job.id);
      const resource = resources.find(({ id }) => id === attempt.resourceId);
      const suggestions = await analyzeTranscript({ segments: attempt.segments, prompt: resource?.prompt || attempt.prompt });
      store.feedback(job.id, 'ready', null, suggestions);
    } catch (error) {
      store.feedback(job.id, 'failed', error.message || '文字反馈失败，可重试。');
    }
  }

  function work() {
    if (active || stopped) return;
    active = true;
    setImmediate(async () => {
      try {
        let job;
        while (!stopped && (job = store.nextJob())) await processJob(job);
      } catch (error) {
        console.error('Recording worker:', error.message);
      } finally {
        active = false;
      }
    });
  }

  async function upload(request, id) {
    const attempt = store.get(id);
    if (!attempt) throw new Problem(404, '找不到练习。');
    if (attempt.skill !== 'speaking') throw new Problem(400, '请把录音关联到口语练习。');
    if (uploads.has(id)) throw new Problem(409, '这条录音正在上传，请稍候。');
    uploads.add(id);
    const scratch = join(store.scratchDir, 'upload-' + randomUUID());
    let moved;
    try {
      const sha256 = await consumeUpload(request, scratch);
      const existing = store.recording(id);
      if (existing) {
        if (existing.sha256 === sha256) return store.get(id);
        throw new Problem(409, '这条练习已有原录音。请为新的尝试保存一条练习。');
      }
      if (store.duplicateAudio(sha256, attempt.rootId)) throw new Problem(409, '这段录音已记录在本组，请上传新的录音。');
      const filename = uploadFilename(request.headers['x-file-name']);
      const original = id + '.original' + (MIME[extname(filename).toLowerCase()] ? extname(filename).toLowerCase() : '.audio');
      let audio;
      try {
        audio = await inspectAudio(scratch);
      } catch (error) {
        throw new Problem(422, error.message);
      }
      await rename(scratch, join(store.mediaDir, original));
      moved = join(store.mediaDir, original);
      if (store.duplicateAudio(sha256, attempt.rootId)) throw new Problem(409, '这段录音已记录在本组，请上传新的录音。');
      store.registerAudio(id, { sha256, filename, original, durationMs: audio.durationMs });
      moved = undefined;
      work();
      return store.get(id);
    } finally {
      await rm(scratch, { force: true });
      if (moved) await rm(moved, { force: true });
      uploads.delete(id);
    }
  }

  async function route(request, response) {
    headers(response);
    allow(request, port || server.address().port, remote);
    const path = new URL(request.url, 'http://localhost').pathname;
    const method = request.method;
    if (Object.hasOwn(staticFiles, path) && ['GET', 'HEAD'].includes(method)) {
      const file = staticFiles[path];
      const data = await readFile(join(appDir, 'public', file));
      response.writeHead(200, { 'Content-Type': MIME[extname(file)], 'Content-Length': data.length });
      return response.end(method === 'HEAD' ? undefined : data);
    }
    if (path === '/api/health' && method === 'GET') return send(response, 200, { ok: true, service: 'ielts-study-workbench', ...await health() });
    if (path === '/api/state' && method === 'GET') {
      const attempts = store.list();
      const completed = new Set(attempts.filter((item) => item.status === 'done').map((item) => item.resourceId));
      const catalogue = resources.map((item) => completed.has(item.id) ? item : ({ ...item, answerUrl: undefined }));
      return send(response, 200, {
        today: buildToday(store.setting('started'), curriculum, attempts, store.setting('resume')),
        resources: catalogue, attempts, progress: calculateProgress(attempts), health: await health(),
      });
    }
    if (path === '/api/start' && method === 'POST') {
      await readJson(request);
      if (!store.setting('started')) store.setSetting('started', todayDate());
      return send(response, 200, { started: store.setting('started') });
    }
    if (path === '/api/attempts' && method === 'POST') {
      const body = await readJson(request);
      const existing = validId(body.id) ? store.get(body.id) : undefined;
      if (existing) return send(response, 200, { attempt: existing });
      const attempt = attemptPayload(body, resources);
      return send(response, 201, { attempt: store.add(attempt, linkAttempt(attempt, store)) });
    }
    if (path === '/api/export' && method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="ielts-' + todayDate() + '.md"' });
      return response.end(markdown(store.list(), store.setting('resume')));
    }

    const match = /^\/api\/attempts\/([A-Za-z0-9_-]{1,64})(?:\/(audio|original|review|retry|next))?$/.exec(path);
    if (match) {
      const [, id, action] = match;
      const attempt = store.get(id);
      if (!attempt) throw new Problem(404, '找不到练习。');
      if (action === 'audio' && method === 'PUT') return send(response, 200, { attempt: await upload(request, id) });
      if (['audio', 'original'].includes(action) && ['GET', 'HEAD'].includes(method)) {
        const audio = store.recording(id);
        const original = action === 'original';
        const file = original ? audio?.original : audio?.playback;
        if (!file) throw new Problem(404, '此录音仍待处理。');
        return playFile(request, response, join(store.mediaDir, file), MIME[extname(file)] || 'application/octet-stream', original ? audio.filename : undefined);
      }
      if (action === 'review' && method === 'PATCH') {
        const body = await readJson(request);
        const current = store.get(id);
        const result = reviewPayload(body, current, store.raw(id));
        const updated = store.saveReview(id, result);
        return send(response, 200, { attempt: updated });
      }
      if (action === 'retry' && method === 'POST') {
        await readJson(request);
        if (!store.recording(id)) throw new Problem(400, '请先保存录音。');
        store.retry(id);
        work();
        return send(response, 200, { attempt: store.get(id) });
      }
      if (action === 'next' && method === 'GET') {
        const usedIds = new Set(store.list().map((item) => item.resourceId).filter(Boolean));
        const issueCategory = attempt.findings.find((finding) => finding.confirmed)?.category;
        return send(response, 200, { resource: selectPracticeResource({ skill: attempt.skill, usedIds, issueCategory }) ?? null });
      }
      if (!action && method === 'GET') return send(response, 200, { attempt });
      if (!action && method === 'PATCH') {
        const body = await readJson(request);
        const current = store.get(id);
        const updated = attemptPayload(body, resources, current);
        if (updated.skill !== current.skill || updated.take !== current.take || updated.parentId !== current.parentId) {
          throw new Problem(400, '科目和作答轮次在创建后固定。');
        }
        if (promptKey(updated) !== promptKey(current) && store.byRoot(attempt.rootId).length > 1) {
          throw new Problem(400, '已经关联重录或复测的练习需保留原题。');
        }
        linkAttempt(updated, store);
        const saved = store.update(updated);
        if (current.answer !== saved.answer) {
          const result = reviewPayload({}, saved, store.raw(id));
          return send(response, 200, { attempt: store.saveReview(id, result) });
        }
        return send(response, 200, { attempt: saved });
      }
    }
    throw new Problem(404, '找不到这个页面或记录。');
  }

  const server = createServer((request, response) => {
    route(request, response).catch((error) => {
      if (response.headersSent || response.destroyed) return;
      if (error.status && Number.isInteger(error.status)) return send(response, error.status, { error: error.message });
      console.error('Workbench:', error.message);
      send(response, 500, { error: '操作未完成，请重试。' });
    });
  });
  server.requestTimeout = 300_000;
  server.keepAliveTimeout = 5000;
  return {
    server, store,
    start() {
      store.recover();
      return new Promise((ready, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', reject);
          work();
          ready(server.address());
        });
      });
    },
    async close() {
      stopped = true;
      await new Promise((complete) => server.close(complete));
      while (active) await new Promise((finish) => setTimeout(finish, 25));
      store.db.close();
    },
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const app = createWorkbench();
  const address = await app.start();
  console.log('IELTS Workbench listening at http://127.0.0.1:' + address.port);
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => app.close().finally(() => process.exit(0)));
}
