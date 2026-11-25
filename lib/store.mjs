import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { containsQuote } from './evidence.mjs';

export const defaultDataDir = join(homedir(), 'Library', 'Application Support', 'IELTS Workbench');

const parse = (value, fallback) => value ? JSON.parse(value) : fallback;
const json = (value) => JSON.stringify(value);
const now = () => new Date().toISOString();
const LOCAL_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const LOCAL_HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' });

export const todayDate = (date = new Date()) => LOCAL_DATE.format(date);
export const currentPeriod = (date = new Date()) => Number(LOCAL_HOUR.format(date)) < 18 ? 'morning' : 'evening';
export const addDays = (date, count) => new Date(Date.parse(date) + count * 86_400_000).toISOString().slice(0, 10);

function unpack(row) {
  if (!row) return undefined;
  return {
    ...parse(row.payload, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rootId: row.root_id,
    review: parse(row.review, undefined),
    manualFindings: parse(row.findings, []),
    corrected: parse(row.corrected, {}),
  };
}

export function openStore(dataDir = process.env.IELTS_DATA_DIR || defaultDataDir) {
  const dir = resolve(dataDir);
  const mediaDir = join(dir, 'media');
  const scratchDir = join(dir, 'scratch');
  for (const path of [dir, mediaDir, scratchDir]) mkdirSync(path, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dir, 'workbench.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY, date TEXT NOT NULL, root_id TEXT NOT NULL,
      payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      review TEXT, findings TEXT NOT NULL DEFAULT '[]', corrected TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS attempts_date ON attempts(date, created_at);
    CREATE INDEX IF NOT EXISTS attempts_root ON attempts(root_id);
    CREATE TABLE IF NOT EXISTS recordings (
      attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),
      sha256 TEXT NOT NULL, original TEXT NOT NULL, filename TEXT NOT NULL,
      playback TEXT, duration_ms INTEGER NOT NULL, status TEXT NOT NULL,
      error TEXT, model TEXT, segments TEXT NOT NULL DEFAULT '[]',
      feedback_status TEXT NOT NULL DEFAULT 'pending', feedback_error TEXT,
      suggestions TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS recordings_sha ON recordings(sha256);
    PRAGMA user_version = 1;
  `);
  const select = db.prepare('SELECT * FROM attempts WHERE id = ?');
  const selectRecording = db.prepare('SELECT * FROM recordings WHERE attempt_id = ?');

  function recording(id) {
    const row = selectRecording.get(id);
    if (!row) return undefined;
    return {
      id, sha256: row.sha256, original: row.original, filename: row.filename,
      playback: row.playback, status: row.status, durationMs: row.duration_ms, model: row.model,
      error: row.error, feedbackStatus: row.feedback_status, feedbackError: row.feedback_error,
      segments: parse(row.segments, []), suggestions: parse(row.suggestions, []),
    };
  }

  function hydrate(row) {
    const attempt = unpack(row);
    if (!attempt) return undefined;
    const { corrected, manualFindings, ...data } = attempt;
    const audio = recording(data.id);
    const segments = (audio?.segments ?? []).map((segment) => ({ ...segment, correctedText: corrected[segment.id] }));
    const newSuggestions = (audio?.suggestions ?? []).filter((item) => {
      const segment = segments.find(({ id }) => id === item.segmentId);
      return containsQuote(segment?.correctedText ?? segment?.text, item.quote)
        && !manualFindings.some((review) => review.id === item.id || (review.segmentId === item.segmentId && review.quote === item.quote));
    });
    const findings = [...manualFindings, ...newSuggestions];
    return {
      ...data, segments, findings,
      recording: audio && {
        filename: audio.filename, status: audio.status, durationMs: audio.durationMs,
        error: audio.error, model: audio.model, feedbackStatus: audio.feedbackStatus,
        feedbackError: audio.feedbackError, hasPlayback: Boolean(audio.playback),
        hasOriginal: true,
      },
    };
  }

  return {
    dir, mediaDir, scratchDir, db,
    setting(key) {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      return parse(row?.value, undefined);
    },
    setSetting(key, value) {
      db.prepare('INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, json(value));
    },
    get: (id) => hydrate(select.get(id)),
    raw: (id) => unpack(select.get(id)),
    recording,
    list: () => db.prepare('SELECT * FROM attempts ORDER BY date DESC, created_at DESC').all().map(hydrate),
    byRoot: (id) => db.prepare('SELECT * FROM attempts WHERE root_id = ? ORDER BY date, created_at').all(id).map(hydrate),
    add(attempt, rootId) {
      const date = now();
      db.prepare('INSERT OR IGNORE INTO attempts (id,date,root_id,payload,created_at,updated_at) VALUES (?,?,?,?,?,?)')
        .run(attempt.id, attempt.date, rootId, json(attempt), date, date);
      return hydrate(select.get(attempt.id));
    },
    update(attempt) {
      db.prepare('UPDATE attempts SET date=?, payload=?, updated_at=? WHERE id=?').run(attempt.date, json(attempt), now(), attempt.id);
      return hydrate(select.get(attempt.id));
    },
    saveReview(id, { corrected, findings, review }) {
      db.prepare('UPDATE attempts SET corrected=?,findings=?,review=?,updated_at=? WHERE id=?')
        .run(json(corrected), json(findings), review ? json(review) : null, now(), id);
      return hydrate(select.get(id));
    },
    registerAudio(id, { sha256, filename, original, durationMs }) {
      db.prepare('INSERT INTO recordings (attempt_id,sha256,filename,original,duration_ms,status,updated_at) VALUES (?,?,?,?,?,\'queued\',?)')
        .run(id, sha256, filename, original, durationMs, now());
    },
    duplicateAudio(sha256, rootId) {
      return db.prepare(`
        SELECT recordings.attempt_id AS id FROM recordings
        JOIN attempts ON attempts.id=recordings.attempt_id
        WHERE recordings.sha256=? AND attempts.root_id=?
      `).get(sha256, rootId)?.id;
    },
    asrRunning(id) {
      db.prepare("UPDATE recordings SET status='running',error=NULL,updated_at=? WHERE attempt_id=?").run(now(), id);
    },
    asrReady(id, result, playback) {
      db.prepare("UPDATE recordings SET status='ready',error=NULL,playback=?,duration_ms=?,model=?,segments=?,feedback_status='pending',updated_at=? WHERE attempt_id=?")
        .run(playback, result.durationMs, result.model, json(result.segments), now(), id);
    },
    asrFailed(id, message) {
      db.prepare("UPDATE recordings SET status='failed',error=?,updated_at=? WHERE attempt_id=?").run(message, now(), id);
    },
    feedback(id, status, error = null, suggestions = null) {
      db.prepare('UPDATE recordings SET feedback_status=?,feedback_error=?,suggestions=COALESCE(?,suggestions),updated_at=? WHERE attempt_id=?')
        .run(status, error, suggestions ? json(suggestions) : null, now(), id);
    },
    nextJob() {
      return db.prepare(`
        SELECT attempt_id AS id,status FROM recordings
        WHERE status='queued' OR (status='ready' AND feedback_status='pending') ORDER BY updated_at LIMIT 1
      `).get();
    },
    recover() {
      db.exec("UPDATE recordings SET status='queued' WHERE status='running'; UPDATE recordings SET feedback_status='pending' WHERE feedback_status='running';");
    },
    retry(id) {
      db.prepare("UPDATE recordings SET status='queued',error=NULL,updated_at=? WHERE attempt_id=? AND status='failed'").run(now(), id);
      db.prepare("UPDATE recordings SET feedback_status='pending',feedback_error=NULL,updated_at=? WHERE attempt_id=? AND status='ready' AND feedback_status IN ('failed','unavailable')").run(now(), id);
    },
  };
}
