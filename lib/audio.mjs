import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const maxDurationMs = 16 * 60 * 1000;
const localAudioInputs = [
  '-protocol_whitelist', 'file',
  '-format_whitelist', 'aac,aiff,caf,flac,matroska,webm,mov,mp4,m4a,3gp,3g2,mj2,mp3,ogg,wav',
];

async function runLocal(command, args, timeout, failureMessage) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch (cause) {
    if (cause.code === 'ENOENT') {
      throw new Error(`本机缺少 ${basename(command)}，请检查安装或路径配置。`, { cause });
    }
    if (cause.killed) {
      throw new Error(`${failureMessage}本次处理已超时，可以重试。`, { cause });
    }
    throw new Error(failureMessage, { cause });
  }
}

export async function inspectAudio(inputPath) {
  const input = resolve(inputPath);
  const file = await stat(input).catch((cause) => {
    throw new Error('找不到要处理的录音文件。', { cause });
  });
  if (!file.isFile() || file.size === 0) {
    throw new Error('请选择有效的录音文件。');
  }

  const raw = await runLocal(process.env.IELTS_FFPROBE || 'ffprobe', [
    '-v', 'error', ...localAudioInputs, '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_type,duration:format=duration',
    '-of', 'json', '-i', input,
  ], 15_000, '无法读取录音。请确认文件可播放，或尝试 M4A、MP3、WAV。');
  const info = JSON.parse(raw);
  const audio = info.streams?.[0];
  if (audio?.codec_type !== 'audio') {
    throw new Error('文件里没有音轨。');
  }

  const seconds = [audio.duration, info.format?.duration]
    .map(Number)
    .find((duration) => Number.isFinite(duration) && duration > 0);
  if (seconds === undefined) {
    throw new Error('无法确定录音时长。请保存为 M4A、MP3 或 WAV 后重新导入。');
  }
  if (seconds * 1000 > maxDurationMs) {
    throw new Error('单次录音限 16 分钟，请截取需要练习的部分。');
  }
  return { durationMs: Math.max(1, Math.round(seconds * 1000)) };
}

function isSilentWave(wave) {
  // FFmpeg generated this RIFF WAV as mono signed 16-bit PCM.
  for (let offset = 12; offset + 8 <= wave.length;) {
    const size = wave.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = Math.min(start + size, wave.length);
    if (wave.toString('ascii', offset, offset + 4) === 'data') {
      for (let index = start; index + 1 < end; index += 2) {
        if (Math.abs(wave.readInt16LE(index)) > 4) return false;
      }
      return true;
    }
    offset = start + size + (size % 2);
  }
  return false;
}

export async function transcribe({ inputPath, outputPath, scratchDir }) {
  const input = resolve(inputPath);
  const output = resolve(outputPath);
  if (input === output) {
    throw new Error('原始录音和播放文件需要使用不同的路径。');
  }
  await inspectAudio(input);

  const modelPath = resolve(process.env.IELTS_WHISPER_MODEL || join(
    homedir(), '.cache', 'whisper', 'ggml-large-v3-turbo.bin',
  ));
  const modelFile = await stat(modelPath).catch((cause) => {
    throw new Error('找不到本机 Whisper 模型，请检查 IELTS_WHISPER_MODEL 配置。', { cause });
  });
  if (!modelFile.isFile() || modelFile.size === 0) {
    throw new Error('本机 Whisper 模型文件无效。');
  }

  const scratch = resolve(scratchDir);
  const outputDir = dirname(output);
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const jobDir = await mkdtemp(join(scratch, 'whisper-'));
  try {
    // The playback file is staged beside its destination so publishing it needs one rename.
    const stageDir = await mkdtemp(join(outputDir, '.audio-'));
    try {
      const wavePath = join(jobDir, 'input.wav');
      const stagingPath = join(stageDir, 'playback.m4a');
      const decodeLimit = String(maxDurationMs / 1000 + 1);
      await runLocal(process.env.IELTS_FFMPEG || 'ffmpeg', [
        '-nostdin', '-hide_banner', '-v', 'error', '-xerror',
        ...localAudioInputs, '-i', input,
        '-map', '0:a:0', '-t', decodeLimit, '-ac', '1', '-ar', '16000',
        '-c:a', 'pcm_s16le', wavePath,
        '-map', '0:a:0', '-t', decodeLimit, '-ac', '1', '-ar', '44100',
        '-map_metadata', '-1', '-map_chapters', '-1',
        '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '96k', '-movflags', '+faststart',
        stagingPath,
      ], 120_000, '录音转码失败。');

      const { durationMs } = await inspectAudio(wavePath);
      if (isSilentWave(await readFile(wavePath))) {
        throw new Error('这段录音几乎完全静音。原文件已保存，请回听后重录。');
      }
      const transcriptPrefix = join(jobDir, 'transcript');
      await runLocal(process.env.IELTS_WHISPER_CLI || 'whisper-cli', [
        '-l', 'en', '-m', modelPath, '-f', wavePath,
        '-oj', '-of', transcriptPrefix, '-np',
      ], 12 * 60_000, '本机转写失败。请检查录音质量和 Whisper 模型后重试。');

      const { transcription } = JSON.parse(await readFile(`${transcriptPrefix}.json`, 'utf8'));
      if (!Array.isArray(transcription)) {
        throw new Error('Whisper 返回的转写格式无效。');
      }
      const segments = [];
      for (const [index, segment] of transcription.entries()) {
        const text = typeof segment.text === 'string' ? segment.text.trim() : '';
        const { from, to } = segment.offsets || {};
        if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || !/\p{L}/u.test(text)) {
          continue;
        }
        if (/^[[(]\s*(?:blank[ _]audio|silence|no speech|music)\s*[)\]]$/i.test(text)) {
          continue;
        }
        const startMs = Math.max(0, from);
        const endMs = Math.min(durationMs, to);
        if (startMs < endMs) {
          segments.push({ id: `s-${startMs}-${endMs}-${index + 1}`, startMs, endMs, text });
        }
      }
      if (segments.length === 0) {
        throw new Error('这段录音没有生成可用的英文转写，请回听后重录或重试。');
      }

      await chmod(stagingPath, 0o600);
      await rename(stagingPath, output);
      return { durationMs, model: basename(modelPath, '.bin'), segments };
    } finally {
      await rm(stageDir, { recursive: true, force: true });
    }
  } finally {
    await rm(jobDir, { recursive: true, force: true });
  }
}
