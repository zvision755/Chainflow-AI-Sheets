// Mac-only setup utility. It is never imported by the deployed website.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'darwin') throw new Error('此配置只适用于 Mac 本地服务。');
const root = fileURLToPath(new URL('..', import.meta.url));
if (!existsSync(join(root, 'node_modules/vinext/dist/cli.js'))) {
  throw new Error('请先在项目目录执行 npm ci，安装项目内依赖。');
}
// Prefer a stable Homebrew link that survives runtime version upgrades.
const node = ['/opt/homebrew/bin/node', '/usr/local/bin/node', process.execPath]
  .find(path => existsSync(path));
const label = 'ai.chainflow.sheets';
const output = join(root, 'outputs');
const destination = join(homedir(), 'Library/LaunchAgents', `${label}.plist`);
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const string = value => `<string>${xml(value)}</string>`;
const args = [node, join(root, 'scripts/run-framework.mjs'), 'dev', '--host', '127.0.0.1', '--port', '3002'];
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key>${string(label)}
  <key>ProgramArguments</key><array>${args.map(string).join('')}</array>
  <key>WorkingDirectory</key>${string(root)}
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key>${string(`${dirname(node)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>ProcessType</key><string>Background</string>
  <key>ExitTimeOut</key><integer>20</integer>
  <key>StandardOutPath</key>${string(join(output, 'launchd.stdout.log'))}
  <key>StandardErrorPath</key>${string(join(output, 'launchd.stderr.log'))}
</dict></plist>
`;
mkdirSync(output, { recursive: true });
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, plist, { mode: 0o644 });
execFileSync('/usr/bin/plutil', ['-lint', destination], { stdio: 'inherit' });
console.log(`已保存用户启动项：${destination}`);
console.log('在 LaunchManager → Launch Agents → User 中刷新，搜索 ai.chainflow.sheets。');
console.log('首次点击 Load；已加载时点击 Start。请先停止旧的独立预览进程，避免占用 3002。');
console.log('登录后自动启动；KeepAlive 关闭，手动 Stop 后不会立即自动重启。');
