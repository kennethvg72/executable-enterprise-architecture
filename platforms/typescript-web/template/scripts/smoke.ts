// Starts the application as `npm run dev` would, waits until it is ready, and stops it.
// Proves the whole thing works end to end, in one command an agent can run (BOOTSTRAP step 8).
// Usage: npm run smoke

import { spawn } from 'node:child_process';

const port = process.env.PORT ?? '8443';
const host = process.env.HOST ?? '127.0.0.1';
const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'src/main.ts'], { stdio: ['ignore', 'pipe', 'inherit'] });
let output = '';
child.stdout.on('data', (c: Buffer) => { output += c.toString(); });

const deadline = Date.now() + 20_000;
let ready = false;
while (!ready && Date.now() < deadline && child.exitCode === null) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const res = await fetch(`http://${host}:${port}/health/ready`);
    ready = res.status === 200;
    if (ready) console.log(`Ready: ${await res.text()}`);
  } catch { /* not listening yet */ }
}
child.kill('SIGTERM');
if (!ready) {
  console.error(`Not ready within 20 seconds.${child.exitCode !== null ? ` The process exited with ${child.exitCode}.` : ''}`);
  console.error(output.split('\n').slice(-10).join('\n'));
  process.exit(1);
}
