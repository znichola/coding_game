// node tools/replay.mjs <log file> <bot.ts> [firstTurn] [lastTurn]
// Re-runs a bot on the recorded positions (the recorded inputs, not a re-simulation) and prints what it would
// have played next to what was actually played. Useful to see how a change in main.ts behaves on a real game.
import { Worker, MessageChannel } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { parseLog, turnInput } from './loglib.mjs';

const [logFile, botFile, from = '1', to = '9999'] = process.argv.slice(2);
const g = parseLog(logFile);
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const { port1, port2 } = new MessageChannel();
const w = new Worker(path.join(here, 'worker.mjs'), { workerData: { bot: pathToFileURL(path.resolve(botFile)).href, port: port2, seed: 1 }, transferList: [port2] });
const outs = [];
port1.on('message', m => outs.push(m));
for (const l of g.init) port1.postMessage(l);
const turns = g.turns.filter(t => t.n >= +from && t.n <= +to);
for (const t of turns) for (const l of turnInput(g, t)) port1.postMessage(l);
const deadline = Date.now() + 60000;
while (outs.length < turns.length && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
turns.forEach((t, i) => {
  const short = s => (s ?? '-').replace(/PLACE_TRACKS /g, 'P');
  console.log(`t${String(t.n).padStart(3)} score ${t.me}-${t.foe}\n   played: ${short(t.out)}\n   replay: ${short(outs[i]?.out)}  (${outs[i]?.ms?.toFixed(1)} ms)`);
});
process.exit(0);
