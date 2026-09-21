// node tools/versus.mjs [candidate.ts=main.ts] [opponent.ts=tools/prev.ts] [games=12]
// Self-battle over several map densities; prints per-config and overall win rate (sides swap every game).
import { spawnSync } from 'node:child_process';
const [a = 'main.ts', b = 'tools/prev.ts', n = '12'] = process.argv.slice(2);
let wins = 0, losses = 0, draws = 0;
for (const div of ['12', '22', '40']) {
  const r = spawnSync('node', ['tools/referee.mjs', a, b, n], { env: { ...process.env, REG_DIV: div }, encoding: 'utf8' });
  const last = r.stdout.trim().split('\n').at(-1);
  const m = last.match(/wins (\d+), .* wins (\d+), draws (\d+); avg (\d+) vs (\d+)/);
  console.log(`region divisor ${div}: ${last}`);
  if (m) { wins += +m[1]; losses += +m[2]; draws += +m[3]; }
}
console.log(`\nOVERALL ${a} vs ${b}: ${wins}W ${losses}L ${draws}D (${(100 * wins / (wins + losses + draws)).toFixed(0)}%)`);
