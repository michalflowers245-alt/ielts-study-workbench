import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inspectAudio, transcribe } from '../lib/audio.mjs';

const ffmpeg = process.env.IELTS_FFMPEG || 'ffmpeg';
const ffprobe = process.env.IELTS_FFPROBE || 'ffprobe';
const whisper = process.env.IELTS_WHISPER_CLI || 'whisper-cli';
const model = process.env.IELTS_WHISPER_MODEL || join(
  homedir(), '.cache', 'whisper', 'ggml-large-v3-turbo.bin',
);
const sample = process.env.IELTS_TEST_PUBLIC_SAMPLE || '/opt/homebrew/opt/whisper.cpp/share/whisper.cpp/jfk.wav';

function hasTool(command) {
  try {
    execFileSync(command, ['-h'], { stdio: 'ignore', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

const hasFFmpeg = hasTool(ffmpeg) && hasTool(ffprobe);

async function temporaryDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ielts-audio-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('inspectAudio validates audio content and rejects video-only, corrupt and over-length files', {
  skip: !hasFFmpeg && '需要本机 FFmpeg 和 FFprobe',
}, async (t) => {
  const dir = await temporaryDir(t);
  const video = join(dir, 'video.mp4');
  const corrupt = join(dir, 'corrupt.m4a');
  const short = join(dir, 'short.wav');
  const long = join(dir, 'long.wav');
  await writeFile(corrupt, 'This is a fake audio file.');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=32x32:r=1',
    '-t', '1', '-c:v', 'mpeg4', video]);
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono',
    '-t', '1', short, '-t', '961', '-c:a', 'pcm_u8', long]);

  assert.deepEqual(await inspectAudio(short), { durationMs: 1000 });
  await assert.rejects(inspectAudio(video), /没有音轨/);
  await assert.rejects(inspectAudio(corrupt), /无法读取录音/);
  await assert.rejects(inspectAudio(long), /16 分钟/);
});

test('public sample produces timestamped English and AAC, preserving source and prior output on failure', {
  skip: !(hasFFmpeg && hasTool(whisper) && existsSync(model) && existsSync(sample))
    && '需要本机 Whisper 模型和公开 JFK 样本',
}, async (t) => {
  const dir = await temporaryDir(t);
  const inputPath = join(dir, '源录音.m4a');
  const outputPath = join(dir, '播放.m4a');
  const scratchDir = join(dir, 'scratch');
  execFileSync(ffmpeg, ['-v', 'error', '-i', sample, '-c:a', 'aac', inputPath]);
  const original = await readFile(inputPath);
  const result = await transcribe({ inputPath, outputPath, scratchDir });

  assert.match(result.segments.map(({ text }) => text).join(' '), /fellow Americans/i);
  assert.ok(result.durationMs >= 10_900 && result.durationMs <= 11_200);
  assert.ok(result.model);
  assert.equal(new Set(result.segments.map(({ id }) => id)).size, result.segments.length);
  for (const { startMs, endMs, id } of result.segments) {
    assert.ok(startMs >= 0 && startMs < endMs && endMs <= result.durationMs);
    assert.ok(id.startsWith(`s-${startMs}-${endMs}-`));
  }
  assert.deepEqual(await readFile(inputPath), original);
  assert.deepEqual(await readdir(scratchDir), []);
  assert.ok((await inspectAudio(outputPath)).durationMs > 10_900);
  const codec = execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries',
    'stream=codec_name', '-of', 'csv=p=0', outputPath], { encoding: 'utf8' });
  assert.equal(codec.trim(), 'aac');

  const playable = await readFile(outputPath);
  const originalWhisper = process.env.IELTS_WHISPER_CLI;
  process.env.IELTS_WHISPER_CLI = '/usr/bin/false';
  try {
    await assert.rejects(transcribe({ inputPath, outputPath, scratchDir }), /本机转写失败/);
  } finally {
    if (originalWhisper === undefined) {
      delete process.env.IELTS_WHISPER_CLI;
    } else {
      process.env.IELTS_WHISPER_CLI = originalWhisper;
    }
  }
  assert.deepEqual(await readFile(outputPath), playable);
  assert.deepEqual(await readFile(inputPath), original);
  assert.deepEqual(await readdir(scratchDir), []);
  assert.equal((await readdir(dir)).filter((name) => name.startsWith('.audio-')).length, 0);
});
