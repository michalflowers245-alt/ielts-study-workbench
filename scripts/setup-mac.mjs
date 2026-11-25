import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { defaultDataDir } from '../lib/store.mjs';

const label = 'local.ielts-study-workbench';
const port = Number(process.env.IELTS_PORT || 4385);
const program = fileURLToPath(new URL('../server.mjs', import.meta.url));
const appData = resolve(process.env.IELTS_DATA_DIR || defaultDataDir);
const agents = join(homedir(), 'Library', 'LaunchAgents');
const plist = join(agents, label + '.plist');
const domain = 'gui/' + process.getuid();
const flags = new Set(process.argv.slice(2));
const macClient = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', timeout: 15_000, ...options });
}

function tailscale(...args) {
  const binary = existsSync(macClient) ? macClient : 'tailscale';
  return run(binary, args, { env: { ...process.env, TAILSCALE_BE_CLI: '1' } });
}

function string(value) {
  return '<string>' + String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</string>';
}

const environment = {
  PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
  IELTS_PORT: port,
  IELTS_DATA_DIR: appData,
  IELTS_ENABLE_FEEDBACK: flags.has('--feedback') ? '1' : '0',
  ...(process.env.IELTS_FEEDBACK_MODEL ? { IELTS_FEEDBACK_MODEL: process.env.IELTS_FEEDBACK_MODEL } : {}),
  ...(process.env.IELTS_WHISPER_MODEL ? { IELTS_WHISPER_MODEL: process.env.IELTS_WHISPER_MODEL } : {}),
};
let remoteAddress;
if (flags.has('--remote')) {
  const output = tailscale('status', '--json');
  if (output.status !== 0) throw new Error('请先打开 Tailscale 并登录。');
  const state = JSON.parse(output.stdout);
  const host = state.Self?.DNSName?.replace(/\.$/, '').toLowerCase();
  const owner = state.User?.[state.Self?.UserID]?.LoginName;
  if (state.BackendState !== 'Running' || !host?.endsWith('.ts.net') || !owner) {
    throw new Error('Tailscale 尚未连接到已登录的个人网络。');
  }
  const routes = tailscale('serve', 'status', '--json');
  if (routes.status !== 0) throw new Error('无法确认 Tailscale Serve 当前配置。');
  const existing = JSON.parse(routes.stdout || '{}') || {};
  const target = 'http://127.0.0.1:' + port;
  for (const [key, route] of Object.entries(existing.Web || {})) {
    if (key === host + ':443' && Object.entries(route.Handlers || {}).some(([path, handler]) => path !== '/' || handler.Proxy !== target)) {
      throw new Error('远程默认 HTTPS 已被其他应用占用。');
    }
  }
  if (existing.AllowFunnel?.[host + ':443']) throw new Error('默认 HTTPS 正用于公共入口。');
  environment.IELTS_REMOTE_HOST = host;
  environment.IELTS_REMOTE_USER = owner;
  remoteAddress = 'https://' + host;
}

mkdirSync(agents, { recursive: true });
mkdirSync(appData, { recursive: true, mode: 0o700 });
const environmentXML = Object.entries(environment).map(([key, value]) => '<key>' + key + '</key>' + string(value)).join('\n');
const config = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key>${string(label)}
<key>ProgramArguments</key><array>${string(process.execPath)}${string(program)}</array>
<key>WorkingDirectory</key>${string(fileURLToPath(new URL('..', import.meta.url)))}
<key>EnvironmentVariables</key><dict>${environmentXML}</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>5</integer>
<key>StandardOutPath</key>${string(join(appData, 'service.log'))}
<key>StandardErrorPath</key>${string(join(appData, 'error.log'))}
</dict></plist>
`;
const service = domain + '/' + label;
const loaded = () => run('/bin/launchctl', ['print', service]).status === 0;
let check;
if (loaded() && existsSync(plist) && readFileSync(plist, 'utf8') === config) {
  check = run('/bin/launchctl', ['kickstart', '-k', service]);
  if (check.status !== 0) throw new Error(check.stderr || '工作台未重启。');
} else {
  const staging = plist + '.next';
  writeFileSync(staging, config, { mode: 0o600 });
  check = run('/usr/bin/plutil', ['-lint', staging]);
  if (check.status !== 0) throw new Error(check.stderr || check.stdout);
  if (loaded()) {
    check = run('/bin/launchctl', ['bootout', service]);
    if (check.status !== 0) throw new Error('工作台的旧服务未能停止。' + check.stderr);
    for (let attempt = 0; attempt < 12 && loaded(); attempt += 1) await delay(300);
  }
  renameSync(staging, plist);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    check = run('/bin/launchctl', ['bootstrap', domain, plist]);
    if (check.status === 0 || loaded()) break;
    await delay(600);
  }
  if (check.status !== 0 && !loaded()) throw new Error(check.stderr || '工作台自启安装未完成。');
}
const localAddress = 'http://127.0.0.1:' + port;
let ready;
for (let attempt = 0; attempt < 20; attempt += 1) {
  try {
    const response = await fetch(localAddress + '/api/health', { signal: AbortSignal.timeout(500) });
    const state = response.ok ? await response.json() : null;
    if (state?.service === 'ielts-study-workbench') {
      ready = state;
      break;
    }
  } catch { /* The worker may still be starting. */ }
  await delay(250);
}
if (!ready) throw new Error('本机工作台尚未响应。请检查端口和应用数据目录中的 error.log。');
console.log('Mac ' + localAddress + '/');
if (remoteAddress) {
  const result = tailscale('serve', '--bg', '--https=443', 'http://127.0.0.1:' + port);
  if (result.status !== 0) {
    console.error(result.stdout || result.stderr || '请先在 Tailscale 里启用 HTTPS 证书和 Serve。');
    process.exitCode = 1;
  } else {
    console.log('Private ' + remoteAddress + '/');
  }
}
