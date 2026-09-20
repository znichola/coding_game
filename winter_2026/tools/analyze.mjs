// node tools/analyze.mjs <log file>
// 1. checks my scoring model against the real score changes and the game's ACT (active connection) data
// 2. prints a per-turn timeline: scores, tracks, inking, timing, what the bot chose
import { parseLog } from './loglib.mjs';

const g = parseLog(process.argv[2]);
const { W, H, N, towns, myId, regionOf, terrain } = g;
const foeId = 1 - myId;
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
const townAt = new Set(towns.map(t => t.y * W + t.x));

// desired pairs, requester first
const pairs = [], seen = new Set();
for (const t of towns) for (const w of t.wants) {
  const k = Math.min(t.id, w) + '-' + Math.max(t.id, w);
  if (seen.has(k) || !towns[w]) continue;
  seen.add(k); pairs.push([t, towns.find(o => o.id === w)]);
}
function model(own) {
  const pts = [0, 0], cells = new Map();
  const byFrom = new Map();
  for (const [a, b] of pairs) (byFrom.get(a.id) ?? byFrom.set(a.id, []).get(a.id)).push([a, b]);
  for (const [fid, list] of byFrom) {
    const f = towns.find(t => t.id === fid), src = f.y * W + f.x;
    const par = new Array(N).fill(-2); par[src] = -1; const q = [src];
    for (let h = 0; h < q.length; h++) {
      const c = q[h], cx = c % W, cy = (c / W) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d], ny = cy + DY[d]; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx; if (par[ni] !== -2 || (own[ni] === '.' && !townAt.has(ni))) continue;
        par[ni] = c; q.push(ni);
      }
    }
    for (const [, b] of list) {
      let c = b.y * W + b.x; if (par[c] === -2) continue;
      const path = [];
      while (c !== src) { const o = own[c]; if (o === '0') pts[0]++; else if (o === '1') pts[1]++; path.push(c); c = par[c]; }
      cells.set(f.id + '-' + b.id, path);
    }
  }
  return { pts, cells };
}

let scoreMismatch = 0, actMismatch = 0, actChecked = 0;
const lines = [];
let selfHits = 0;
const hitsByMe = {};
for (let i = 0; i < g.turns.length; i++) {
  const t = g.turns[i], prev = g.turns[i - 1];
  const m = model(t.own);
  // real score change over the previous turn's end should equal the rates of the position we see now
  if (prev) {
    const dMe = t.me - prev.me, dFoe = t.foe - prev.foe;
    if (dMe !== m.pts[myId] || dFoe !== m.pts[foeId]) {
      scoreMismatch++;
      if (scoreMismatch <= 8) console.log(`SCORE MISMATCH turn ${t.n}: real +${dMe}/+${dFoe} (me/foe) model +${m.pts[myId]}/+${m.pts[foeId]}`);
    }
  }
  // active connection cells according to the game
  if (t.act && t.act !== '-') {
    const real = new Map();
    for (const s of t.act.split(';')) {
      const k = s.indexOf('='); const c = +s.slice(0, k);
      for (const p of s.slice(k + 1).split(',')) {
        const [a, b] = p.split('-').map(Number); const key = Math.min(a, b) + '-' + Math.max(a, b);
        (real.get(key) ?? real.set(key, new Set()).get(key)).add(c);
      }
    }
    for (const [key, set] of real) {
      actChecked++;
      const [a, b] = key.split('-').map(Number);
      const mine = [...m.cells.entries()].find(([k]) => { const [x, y] = k.split('-').map(Number); return Math.min(x, y) === a && Math.max(x, y) === b; });
      const mset = new Set(mine ? mine[1] : []);
      // the game may or may not list the town cells; compare on track cells only
      const strip = s => new Set([...s].filter(c => !townAt.has(c)));
      const A = strip(set), B = strip(mset);
      if (A.size !== B.size || [...A].some(c => !B.has(c))) {
        actMismatch++;
        if (actMismatch <= 5) console.log(`ACT MISMATCH turn ${t.n} pair ${key}: game ${A.size} track cells, model ${B.size}`);
      }
    }
  }
  const count = ch => [...t.own].filter(c => c === ch).length;
  const inkedN = t.inked === '-' ? 0 : t.inked.split(',').length;
  const out = (t.out ?? '').replace(/PLACE_TRACKS /g, 'P').slice(0, 90);
  lines.push(`t${String(t.n).padStart(3)} score ${t.me}-${t.foe} rate ${m.pts[myId]}/${m.pts[foeId]} tracks me ${count(String(myId))} foe ${count(String(foeId))} neutral ${count('2')} inked ${inkedN} | ${out} | ${(t.dbg ?? '').match(/lvl=\d took=\d+ms/)?.[0] ?? ''}`);
  const dis = (t.out ?? '').match(/DISRUPT (\d+)/);
  if (dis) {
    const r = +dis[1]; hitsByMe[r] = (hitsByMe[r] ?? 0) + 1;
    if ([...t.own].some((c, k) => c === String(myId) && regionOf[k] === r)) selfHits++;
  }
}
console.log(lines.join('\n'));
console.log(`\nturns ${g.turns.length}; score-model mismatches ${scoreMismatch}; ACT pairs checked ${actChecked}, mismatched ${actMismatch}; my DISRUPT calls on regions holding my tracks ${selfHits}`);
const last = g.turns.at(-1);
if (last) console.log(`final seen: me ${last.me} foe ${last.foe} (turn ${last.n})`);
