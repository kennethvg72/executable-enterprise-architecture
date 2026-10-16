// Runs inside a network namespace for the network authority (authority-run.ts): listens on ports,
// or makes connection attempts from given source addresses and reports what happened.
//
//   node authority-helper.ts listen <tcp ports> <udp address:port,...>   prints "ready", then serves until killed
//   node authority-helper.ts probe <file.json>                                 [{ src, dst, port, protocol }] -> JSON outcomes

import { createSocket } from 'node:dgram';
import { readFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';

const TIMEOUT_MS = 400;

function tcpAttempt(src: string, dst: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: dst, port, localAddress: src });
    const done = (open: boolean) => { socket.destroy(); resolve(open); };
    socket.setTimeout(TIMEOUT_MS, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function udpAttempt(src: string, dst: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    const timer = setTimeout(() => { socket.close(); resolve(false); }, TIMEOUT_MS);
    socket.once('message', () => { clearTimeout(timer); socket.close(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); socket.close(); resolve(false); });
    socket.bind(0, src, () => socket.send('probe', port, dst));
  });
}

const [mode, a, b] = process.argv.slice(2);
if (mode === 'listen') {
  const tcp = (a ?? '').split(',').filter(Boolean).map(Number);
  // UDP answers from exactly the address it was asked on, so each address gets its own socket: a
  // wildcard socket lets the kernel pick the reply's source, and connection tracking then (rightly)
  // doesn't recognize the reply.
  const udp = (b ?? '').split(',').filter(Boolean).map((x) => { const [addr, port] = x.split(':'); return { addr: addr!, port: Number(port) }; });
  let pending = tcp.length + udp.length;
  const ready = () => { if (--pending === 0) console.log('ready'); };
  if (pending === 0) console.log('ready');
  for (const port of tcp) createServer((s) => s.end()).listen(port, '0.0.0.0', ready);
  for (const { addr, port } of udp) {
    const socket = createSocket('udp4');
    socket.on('message', (_m, from) => socket.send('pong', from.port, from.address));
    socket.bind(port, addr, ready);
  }
} else if (mode === 'probe') {
  const attempts = JSON.parse(readFileSync(a!, 'utf8')) as { src: string; dst: string; port: number; protocol: 'tcp' | 'udp' }[];
  const results: boolean[] = new Array(attempts.length);
  let next = 0;
  const worker = async () => {
    while (next < attempts.length) {
      const i = next++;
      const x = attempts[i]!;
      results[i] = await (x.protocol === 'udp' ? udpAttempt(x.src, x.dst, x.port) : tcpAttempt(x.src, x.dst, x.port));
    }
  };
  await Promise.all(Array.from({ length: 200 }, worker));
  console.log(JSON.stringify(results));
} else {
  console.error('Usage: authority-helper.ts listen <tcp> <udp> | probe <file.json>');
  process.exit(2);
}
