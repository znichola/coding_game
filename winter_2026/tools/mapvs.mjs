// node tools/mapvs.mjs <log.html> [candidate=main.ts] [opponent=tools/old_main.ts] [games=10]
import { spawnSync } from 'node:child_process';
const [log, a = 'main.ts', b = 'tools/old_main.ts', n = '10'] = process.argv.slice(2);
const r = spawnSync('node', ['tools/referee.mjs', a, b, n], { env: { ...process.env, MAPLOG: log }, encoding: 'utf8' });
console.log(r.stdout.trim().split('\n').slice(-3).join('\n'));
