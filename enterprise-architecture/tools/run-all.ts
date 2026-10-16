// Runs several checks, all of them, and exits with the worst outcome: 1 if any failed, else 3 if
// any was incomplete, else 0. Chaining with && would stop at the first INCOMPLETE and hide the rest.
// Usage: node enterprise-architecture/tools/run-all.ts <script> [<script> ...]

import { spawnSync } from 'node:child_process';

const codes = process.argv.slice(2).map((script) => spawnSync(process.execPath, [script], { stdio: 'inherit' }).status ?? 1);
process.exitCode = codes.some((c) => c !== 0 && c !== 3) ? 1 : codes.includes(3) ? 3 : 0;
