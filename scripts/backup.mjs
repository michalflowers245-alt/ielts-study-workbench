import { constants, chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defaultDataDir } from '../lib/store.mjs';

const databaseName = 'workbench.sqlite';
const manifestName = 'backup.json';
const format = 'ielts-workbench-backup';
const dataDir = resolve(process.env.IELTS_DATA_DIR || defaultDataDir);
const usage = 'npm run backup -- create [备份目录]\nnpm run backup -- restore <备份目录> [空目录或新目录]';

function pathInfo(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function requireFile(path) {
  if (!pathInfo(path)?.isFile()) throw new Error(`需要普通文件 ${path}`);
}

function requireDirectory(path) {
  if (!pathInfo(path)?.isDirectory()) throw new Error(`需要普通目录 ${path}`);
}

function snapshot(source, destination) {
  requireFile(source);
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF;');
    db.prepare('VACUUM INTO ?').run(destination);
  } finally {
    db.close();
  }
  chmodSync(destination, 0o600);
}

function mediaReferences(database) {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    db.exec('PRAGMA trusted_schema=OFF;');
    if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') {
      throw new Error('数据库完整性检查失败。');
    }
    db.prepare('SELECT key, value FROM settings LIMIT 0').all();
    db.prepare('SELECT id, date, root_id, payload, review, findings, corrected FROM attempts LIMIT 0').all();
    const rows = db.prepare('SELECT original, playback FROM recordings').all();
    return new Set(rows.flatMap(({ original, playback }) => [original, ...(playback === null ? [] : [playback])]));
  } finally {
    db.close();
  }
}

function copyMedia(source, destination, references) {
  mkdirSync(destination, { mode: 0o700 });
  if (references.size === 0) return;
  requireDirectory(source);
  for (const reference of references) {
    if (typeof reference !== 'string' || /[\\:\0]/.test(reference)) {
      throw new Error('数据库中的录音相对路径无效。');
    }
    const parts = reference.split('/');
    if (parts.some((part) => part === '' || part === '.' || part === '..')) {
      throw new Error('数据库中的录音相对路径无效。');
    }
    let parent = source;
    for (const part of parts.slice(0, -1)) {
      parent = join(parent, part);
      requireDirectory(parent);
    }
    const sourceFile = join(source, ...parts);
    const outputFile = join(destination, ...parts);
    requireFile(sourceFile);
    mkdirSync(dirname(outputFile), { recursive: true, mode: 0o700 });
    copyFileSync(sourceFile, outputFile, constants.COPYFILE_EXCL);
    chmodSync(outputFile, 0o600);
  }
}

function publishDirectory(destination, allowEmpty, populate) {
  function checkDestination() {
    const info = pathInfo(destination);
    if (info && !(allowEmpty && info.isDirectory() && readdirSync(destination).length === 0)) {
      throw new Error(`目标路径已有内容或不可用 ${destination}`);
    }
  }
  checkDestination();
  const parent = dirname(destination);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const staging = mkdtempSync(join(parent, '.ielts-backup-'));
  try {
    populate(staging);
    checkDestination();
    renameSync(staging, destination);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function create(destination) {
  publishDirectory(destination, false, (staging) => {
    const database = join(staging, databaseName);
    snapshot(join(dataDir, databaseName), database);
    copyMedia(join(dataDir, 'media'), join(staging, 'media'), mediaReferences(database));
    writeFileSync(join(staging, manifestName), JSON.stringify({
      format, version: 1, createdAt: new Date().toISOString(),
    }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  });
  console.log(`备份已创建 ${destination}`);
}

function restore(bundle, destination) {
  requireDirectory(bundle);
  const manifest = join(bundle, manifestName);
  requireFile(manifest);
  const data = JSON.parse(readFileSync(manifest, 'utf8'));
  if (data.format !== format || data.version !== 1) throw new Error('备份格式或版本无效。');
  publishDirectory(destination, true, (staging) => {
    const database = join(staging, databaseName);
    snapshot(join(bundle, databaseName), database);
    copyMedia(join(bundle, 'media'), join(staging, 'media'), mediaReferences(database));
  });
  console.log(`已恢复到 ${destination}`);
}

const [command, first, second, ...extra] = process.argv.slice(2);
try {
  if (command === 'create' && second === undefined) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    create(resolve(first || join(dirname(dataDir), 'IELTS Workbench Backups', stamp)));
  } else if (command === 'restore' && first && extra.length === 0) {
    restore(resolve(first), resolve(second || dataDir));
  } else if (command === '--help' || command === '-h') {
    console.log(usage);
  } else {
    throw new Error(usage);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
